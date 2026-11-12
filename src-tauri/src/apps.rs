// opening a local repository in other apps: editors, a terminal, the file manager

use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};

use serde::Serialize;
use tauri::{AppHandle, State};
use tauri_plugin_dialog::DialogExt;
use tauri_plugin_opener::OpenerExt;

use crate::{quiet, AppState};

#[derive(Serialize, Clone)]
pub struct Editor {
    // stable id for known editors, the app path for ones the user added
    id: String,
    name: String,
    custom: bool,
}

struct Known {
    id: &'static str,
    name: &'static str,
    // commands looked up on PATH
    bins: &'static [&'static str],
    // macos app bundles
    mac: &'static [&'static str],
    // windows paths under %LOCALAPPDATA% or %ProgramFiles%
    win: &'static [&'static str],
    // flatpak app ids
    flatpak: &'static [&'static str],
}

const KNOWN: &[Known] = &[
    Known { id: "vscode", name: "Visual Studio Code", bins: &["code"], mac: &["Visual Studio Code"], win: &[r"Programs\Microsoft VS Code\Code.exe", r"Microsoft VS Code\Code.exe"], flatpak: &["com.visualstudio.code"] },
    Known { id: "vscode-insiders", name: "VS Code Insiders", bins: &["code-insiders"], mac: &["Visual Studio Code - Insiders"], win: &[r"Programs\Microsoft VS Code Insiders\Code - Insiders.exe"], flatpak: &[] },
    Known { id: "vscodium", name: "VSCodium", bins: &["codium", "vscodium"], mac: &["VSCodium"], win: &[r"Programs\VSCodium\VSCodium.exe", r"VSCodium\VSCodium.exe"], flatpak: &["com.vscodium.codium"] },
    Known { id: "cursor", name: "Cursor", bins: &["cursor"], mac: &["Cursor"], win: &[r"Programs\cursor\Cursor.exe"], flatpak: &[] },
    Known { id: "windsurf", name: "Windsurf", bins: &["windsurf"], mac: &["Windsurf"], win: &[r"Programs\Windsurf\Windsurf.exe"], flatpak: &[] },
    Known { id: "zed", name: "Zed", bins: &["zed", "zeditor", "zedit"], mac: &["Zed"], win: &[r"Programs\Zed\Zed.exe"], flatpak: &["dev.zed.Zed"] },
    Known { id: "sublime", name: "Sublime Text", bins: &["subl", "sublime_text"], mac: &["Sublime Text"], win: &[r"Sublime Text\sublime_text.exe", r"Sublime Text 3\sublime_text.exe"], flatpak: &["com.sublimetext.three"] },
    Known { id: "idea", name: "IntelliJ IDEA", bins: &["idea", "intellij-idea-ultimate", "intellij-idea-community", "idea.sh"], mac: &["IntelliJ IDEA", "IntelliJ IDEA CE", "IntelliJ IDEA Ultimate"], win: &[r"JetBrains\Toolbox\scripts\idea.cmd"], flatpak: &["com.jetbrains.IntelliJ-IDEA-Community", "com.jetbrains.IntelliJ-IDEA-Ultimate"] },
    Known { id: "pycharm", name: "PyCharm", bins: &["pycharm", "pycharm-community", "pycharm-professional"], mac: &["PyCharm", "PyCharm CE"], win: &[r"JetBrains\Toolbox\scripts\pycharm.cmd"], flatpak: &["com.jetbrains.PyCharm-Community", "com.jetbrains.PyCharm-Professional"] },
    Known { id: "webstorm", name: "WebStorm", bins: &["webstorm"], mac: &["WebStorm"], win: &[r"JetBrains\Toolbox\scripts\webstorm.cmd"], flatpak: &["com.jetbrains.WebStorm"] },
    Known { id: "goland", name: "GoLand", bins: &["goland"], mac: &["GoLand"], win: &[r"JetBrains\Toolbox\scripts\goland.cmd"], flatpak: &["com.jetbrains.GoLand"] },
    Known { id: "rustrover", name: "RustRover", bins: &["rustrover"], mac: &["RustRover"], win: &[r"JetBrains\Toolbox\scripts\rustrover.cmd"], flatpak: &[] },
    Known { id: "clion", name: "CLion", bins: &["clion"], mac: &["CLion"], win: &[r"JetBrains\Toolbox\scripts\clion.cmd"], flatpak: &["com.jetbrains.CLion"] },
    Known { id: "phpstorm", name: "PhpStorm", bins: &["phpstorm"], mac: &["PhpStorm"], win: &[r"JetBrains\Toolbox\scripts\phpstorm.cmd"], flatpak: &["com.jetbrains.PhpStorm"] },
    Known { id: "rider", name: "Rider", bins: &["rider"], mac: &["Rider"], win: &[r"JetBrains\Toolbox\scripts\rider.cmd"], flatpak: &["com.jetbrains.Rider"] },
    Known { id: "android-studio", name: "Android Studio", bins: &["android-studio", "studio"], mac: &["Android Studio"], win: &[r"Android\Android Studio\bin\studio64.exe"], flatpak: &["com.google.AndroidStudio"] },
    Known { id: "fleet", name: "Fleet", bins: &["fleet"], mac: &["Fleet"], win: &[r"JetBrains\Toolbox\scripts\fleet.cmd"], flatpak: &[] },
    Known { id: "lapce", name: "Lapce", bins: &["lapce"], mac: &["Lapce"], win: &[r"Programs\lapce\lapce.exe"], flatpak: &["dev.lapce.lapce"] },
    Known { id: "xcode", name: "Xcode", bins: &[], mac: &["Xcode"], win: &[], flatpak: &[] },
    Known { id: "notepad++", name: "Notepad++", bins: &[], mac: &[], win: &[r"Notepad++\notepad++.exe"], flatpak: &[] },
    Known { id: "kate", name: "Kate", bins: &["kate"], mac: &["Kate"], win: &[r"Kate\bin\kate.exe"], flatpak: &["org.kde.kate"] },
    Known { id: "gnome-builder", name: "GNOME Builder", bins: &["gnome-builder"], mac: &[], win: &[], flatpak: &["org.gnome.Builder"] },
];

// a program on PATH, honouring PATHEXT on windows
fn which(bin: &str) -> Option<PathBuf> {
    let exts: Vec<String> = if cfg!(windows) {
        std::env::var("PATHEXT").unwrap_or_else(|_| ".EXE;.CMD;.BAT".into()).split(';').map(|e| e.to_ascii_lowercase()).collect()
    } else {
        vec![String::new()]
    };
    let path = std::env::var_os("PATH")?;
    std::env::split_paths(&path).find_map(|dir| exts.iter().map(|e| dir.join(format!("{bin}{e}"))).find(|p| p.is_file()))
}

fn mac_app(name: &str) -> Option<PathBuf> {
    let home = std::env::var_os("HOME").map(PathBuf::from);
    [Some(PathBuf::from("/Applications")), home.map(|h| h.join("Applications"))]
        .into_iter()
        .flatten()
        .map(|d| d.join(format!("{name}.app")))
        .find(|p| p.exists())
}

fn win_app(rel: &str) -> Option<PathBuf> {
    ["LOCALAPPDATA", "ProgramFiles", "ProgramFiles(x86)"]
        .iter()
        .filter_map(std::env::var_os)
        .map(|root| PathBuf::from(root).join(rel))
        .find(|p| p.is_file())
}

fn flatpak_app(id: &str) -> Option<PathBuf> {
    let home = std::env::var_os("HOME").map(PathBuf::from);
    [Some(PathBuf::from("/var/lib/flatpak/exports/bin")), home.map(|h| h.join(".local/share/flatpak/exports/bin"))]
        .into_iter()
        .flatten()
        .map(|d| d.join(id))
        .find(|p| p.is_file())
}

// where a known editor lives on this machine
fn locate(k: &Known) -> Option<PathBuf> {
    if cfg!(target_os = "macos") {
        if let Some(p) = k.mac.iter().find_map(|m| mac_app(m)) {
            return Some(p);
        }
    }
    if cfg!(windows) {
        if let Some(p) = k.win.iter().find_map(|w| win_app(w)) {
            return Some(p);
        }
    }
    if let Some(p) = k.bins.iter().find_map(|b| which(b)) {
        return Some(p);
    }
    if cfg!(target_os = "linux") {
        return k.flatpak.iter().find_map(|f| flatpak_app(f));
    }
    None
}

fn app_name(path: &Path) -> String {
    let stem = path.file_stem().map(|s| s.to_string_lossy().into_owned()).unwrap_or_else(|| path.to_string_lossy().into_owned());
    let mut c = stem.chars();
    c.next().map(|f| f.to_uppercase().collect::<String>() + c.as_str()).unwrap_or(stem)
}

// starts a gui program without waiting for it
fn launch(mut cmd: Command) -> Result<(), String> {
    cmd.stdin(Stdio::null()).stdout(Stdio::null()).stderr(Stdio::null());
    let mut child = cmd.spawn().map_err(|e| format!("Could not start it: {e}"))?;
    // reap it so it never lingers as a zombie
    std::thread::spawn(move || {
        let _ = child.wait();
    });
    Ok(())
}

// runs an app path with the folder, using `open -a` for mac bundles
fn open_with(app: &Path, folder: &Path) -> Result<(), String> {
    if cfg!(target_os = "macos") && app.extension().is_some_and(|e| e == "app") {
        let mut cmd = Command::new("open");
        cmd.arg("-a").arg(app).arg(folder);
        return launch(cmd);
    }
    let mut cmd = quiet(app);
    cmd.arg(folder).current_dir(folder);
    launch(cmd)
}

fn custom_editors(state: &AppState) -> Vec<String> {
    state.settings.lock().unwrap().editors.iter().filter(|p| Path::new(p).exists()).cloned().collect()
}

#[tauri::command(async)]
pub fn list_editors(state: State<'_, AppState>) -> Vec<Editor> {
    let mut out: Vec<Editor> = KNOWN.iter().filter(|k| locate(k).is_some()).map(|k| Editor { id: k.id.into(), name: k.name.into(), custom: false }).collect();
    out.extend(custom_editors(&state).into_iter().map(|p| Editor { name: app_name(Path::new(&p)), id: p, custom: true }));
    out
}

// the app comes from a native picker, never from the webview
#[tauri::command(async)]
pub fn add_editor(app: AppHandle, state: State<'_, AppState>) -> Result<Option<Editor>, String> {
    let dialog = app.dialog().file().set_title("Choose an editor");
    // mac apps are bundles, which the file picker treats as folders
    let picked = if cfg!(target_os = "macos") { dialog.set_directory("/Applications").blocking_pick_file() } else { dialog.blocking_pick_file() };
    let Some(picked) = picked else { return Ok(None) };
    let path = picked.into_path().map_err(|e| e.to_string())?;
    let p = path.to_string_lossy().into_owned();
    state.update_settings(|s| {
        s.editors.retain(|e| e != &p);
        s.editors.push(p.clone());
    });
    Ok(Some(Editor { name: app_name(&path), id: p, custom: true }))
}

#[tauri::command(async)]
pub fn remove_editor(state: State<'_, AppState>, id: String) {
    state.update_settings(|s| s.editors.retain(|e| e != &id));
}

#[tauri::command(async)]
pub fn open_in_editor(state: State<'_, AppState>, repo: String, editor: String) -> Result<(), String> {
    let dir = crate::git::repo_dir(&state, &repo)?;
    if let Some(k) = KNOWN.iter().find(|k| k.id == editor) {
        let app = locate(k).ok_or_else(|| format!("{} isn't installed", k.name))?;
        return open_with(&app, &dir);
    }
    // only apps the user picked earlier can be run
    if custom_editors(&state).contains(&editor) {
        return open_with(Path::new(&editor), &dir);
    }
    Err("That editor isn't set up in Gittern".into())
}

#[tauri::command(async)]
pub fn open_terminal(state: State<'_, AppState>, repo: String) -> Result<(), String> {
    let dir = crate::git::repo_dir(&state, &repo)?;
    if cfg!(target_os = "macos") {
        let mut cmd = Command::new("open");
        cmd.args(["-a", "Terminal"]).arg(&dir);
        return launch(cmd);
    }
    if cfg!(windows) {
        if let Some(wt) = which("wt") {
            let mut cmd = quiet(wt);
            cmd.arg("-d").arg(&dir);
            return launch(cmd);
        }
        #[allow(unused_mut)]
        let mut cmd = Command::new("powershell.exe");
        cmd.current_dir(&dir);
        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            // CREATE_NEW_CONSOLE: this one should have a window
            cmd.creation_flags(0x0000_0010);
        }
        return launch(cmd);
    }
    let preferred = std::env::var("TERMINAL").ok();
    let candidates = preferred
        .iter()
        .map(String::as_str)
        .chain(["x-terminal-emulator", "kgx", "gnome-terminal", "konsole", "xfce4-terminal", "ghostty", "kitty", "alacritty", "foot", "wezterm", "tilix", "terminator", "xterm"]);
    for name in candidates {
        if let Some(bin) = which(name) {
            let mut cmd = Command::new(bin);
            cmd.current_dir(&dir);
            return launch(cmd);
        }
    }
    Err("No terminal app found. Set the TERMINAL environment variable.".into())
}

#[tauri::command(async)]
pub fn reveal_repo(app: AppHandle, state: State<'_, AppState>, repo: String) -> Result<(), String> {
    let dir = crate::git::repo_dir(&state, &repo)?;
    app.opener().open_path(dir.to_string_lossy(), None::<&str>).map_err(|e| e.to_string())
}
