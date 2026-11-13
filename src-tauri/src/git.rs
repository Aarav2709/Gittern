// local git workspace: every command runs the user's git in a folder they picked

use std::path::{Component, Path, PathBuf};
use std::process::Command;

use base64::Engine;
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, State};
use tauri_plugin_dialog::DialogExt;

use crate::{quiet, AppState};

#[derive(Serialize)]
pub struct LocalRepo {
    path: String,
    name: String,
}

#[derive(Serialize)]
pub struct FileChange {
    path: String,
    // new, modified, deleted, renamed or conflict
    status: &'static str,
    untracked: bool,
}

#[derive(Serialize, Default)]
pub struct Status {
    branch: String,
    upstream: Option<String>,
    ahead: u32,
    behind: u32,
    files: Vec<FileChange>,
    // "merge", "rebase", "cherry-pick" or "revert" while one is in progress
    operation: Option<&'static str>,
    // the prepared message during a merge
    merge_message: Option<String>,
}

#[derive(Serialize)]
pub struct Stash {
    index: u32,
    message: String,
    date: String,
}

#[derive(Serialize)]
pub struct Branches {
    current: String,
    all: Vec<String>,
}

#[derive(Serialize)]
pub struct LogEntry {
    sha: String,
    subject: String,
    body: String,
    author: String,
    date: String,
}

#[derive(Deserialize)]
pub struct Discard {
    path: String,
    untracked: bool,
}

fn name_of(path: &Path) -> String {
    path.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_else(|| path.to_string_lossy().into_owned())
}

fn to_repo(path: &str) -> LocalRepo {
    LocalRepo { path: path.to_string(), name: name_of(Path::new(path)) }
}

// only folders the user added through the picker can be operated on
pub(crate) fn repo_dir(state: &AppState, repo: &str) -> Result<PathBuf, String> {
    if state.settings.lock().unwrap().repos.iter().any(|r| r == repo) {
        Ok(PathBuf::from(repo))
    } else {
        Err("That folder isn't one of your local repositories".into())
    }
}

pub fn safe_rel(path: &str) -> Result<&str, String> {
    let p = Path::new(path);
    let ok = !path.is_empty() && !p.is_absolute() && p.components().all(|c| matches!(c, Component::Normal(_)));
    if ok { Ok(path) } else { Err(format!("Unsafe path: {path}")) }
}

pub fn safe_ref(name: &str) -> Result<&str, String> {
    let ok = !name.is_empty()
        && !name.starts_with('-')
        && !name.contains("..")
        && name.chars().all(|c| c.is_ascii_alphanumeric() || matches!(c, '/' | '-' | '_' | '.' | '+' | '@' | '#'));
    if ok { Ok(name) } else { Err(format!("Not a valid branch or commit name: {name}")) }
}

// https urls on the signed-in host, or the usual ssh shorthand
pub fn safe_clone_url(url: &str) -> Result<&str, String> {
    let ok = !url.contains(char::is_whitespace)
        && !url.contains("::")
        && (url.starts_with("https://") || (url.starts_with("git@") && url.contains(':')) || url.starts_with("ssh://"));
    if ok { Ok(url) } else { Err("Use an https:// or git@ clone URL".into()) }
}

pub fn clone_name(url: &str) -> String {
    let tail = url.trim_end_matches('/').rsplit(['/', ':']).next().unwrap_or("repository");
    let name = tail.trim_end_matches(".git");
    if name.is_empty() || name.starts_with('.') { "repository".into() } else { name.to_string() }
}

// the token goes in through the environment so it never shows up in argv
fn auth_env(cmd: &mut Command, state: &AppState, remote: &str) {
    let host = state.host();
    let token = state.token.lock().unwrap().clone();
    let (Some(token), true) = (token, remote.starts_with(&format!("https://{host}/"))) else { return };
    let basic = base64::engine::general_purpose::STANDARD.encode(format!("x-access-token:{}", token.value));
    cmd.env("GIT_CONFIG_COUNT", "2")
        .env("GIT_CONFIG_KEY_0", "credential.helper")
        .env("GIT_CONFIG_VALUE_0", "")
        .env("GIT_CONFIG_KEY_1", format!("http.https://{host}/.extraheader"))
        .env("GIT_CONFIG_VALUE_1", format!("AUTHORIZATION: basic {basic}"));
}

fn base(dir: &Path) -> Command {
    let mut cmd = quiet("git");
    cmd.current_dir(dir).env("GIT_TERMINAL_PROMPT", "0").env("LC_ALL", "C").arg("-c").arg("core.quotepath=off");
    cmd
}

fn finish(mut cmd: Command, ok_codes: &[i32]) -> Result<String, String> {
    let out = cmd.output().map_err(|e| format!("Could not run git: {e}"))?;
    let code = out.status.code().unwrap_or(-1);
    if ok_codes.contains(&code) {
        return Ok(String::from_utf8_lossy(&out.stdout).into_owned());
    }
    let err = String::from_utf8_lossy(&out.stderr);
    let msg = err.lines().rfind(|l| !l.trim().is_empty()).unwrap_or("git failed").trim();
    Err(msg.trim_start_matches("fatal: ").trim_start_matches("error: ").to_string())
}

fn git(dir: &Path, args: &[&str]) -> Result<String, String> {
    let mut cmd = base(dir);
    cmd.args(args);
    finish(cmd, &[0])
}

fn origin(dir: &Path) -> String {
    git(dir, &["remote", "get-url", "origin"]).map(|s| s.trim().to_string()).unwrap_or_default()
}

pub fn parse_status(raw: &str) -> Status {
    let mut st = Status::default();
    let mut parts = raw.split('\0');
    while let Some(entry) = parts.next() {
        if let Some(v) = entry.strip_prefix("# branch.head ") {
            st.branch = v.to_string();
        } else if let Some(v) = entry.strip_prefix("# branch.upstream ") {
            st.upstream = Some(v.to_string());
        } else if let Some(v) = entry.strip_prefix("# branch.ab ") {
            let mut ab = v.split(' ');
            st.ahead = ab.next().and_then(|a| a.trim_start_matches('+').parse().ok()).unwrap_or(0);
            st.behind = ab.next().and_then(|b| b.trim_start_matches('-').parse().ok()).unwrap_or(0);
        } else if let Some(path) = entry.strip_prefix("? ") {
            st.files.push(FileChange { path: path.to_string(), status: "new", untracked: true });
        } else if entry.starts_with("1 ") || entry.starts_with("2 ") || entry.starts_with("u ") {
            let kind = &entry[..1];
            let fields = match kind {
                "1" => 9,
                "2" => 10,
                _ => 11,
            };
            let mut it = entry.splitn(fields, ' ');
            let xy = it.nth(1).unwrap_or("..");
            let Some(path) = it.last() else { continue };
            // a rename carries its old path as the next entry
            if kind == "2" {
                parts.next();
            }
            let status = if kind == "u" {
                "conflict"
            } else if kind == "2" {
                "renamed"
            } else if xy.contains('D') {
                "deleted"
            } else if xy.contains('A') {
                "new"
            } else {
                "modified"
            };
            st.files.push(FileChange { path: path.to_string(), status, untracked: false });
        }
    }
    st
}

fn remember(state: &AppState, path: &Path) -> LocalRepo {
    let path = path.to_string_lossy().into_owned();
    state.update_settings(|s| {
        s.repos.retain(|r| r != &path);
        s.repos.insert(0, path.clone());
    });
    to_repo(&path)
}

#[tauri::command(async)]
pub fn local_repos(state: State<'_, AppState>) -> Vec<LocalRepo> {
    let repos = state.settings.lock().unwrap().repos.clone();
    repos.iter().filter(|p| Path::new(p).is_dir()).map(|p| to_repo(p)).collect()
}

// the folder comes from a native picker, never from the webview
#[tauri::command(async)]
pub fn add_local_repo(app: AppHandle, state: State<'_, AppState>, init: bool) -> Result<Option<LocalRepo>, String> {
    let Some(picked) = app.dialog().file().set_title("Choose a repository folder").blocking_pick_folder() else { return Ok(None) };
    let dir = picked.into_path().map_err(|e| e.to_string())?;
    if init && !dir.join(".git").exists() {
        git(&dir, &["init"])?;
    }
    let top = git(&dir, &["rev-parse", "--show-toplevel"]).map_err(|_| "That folder isn't a Git repository".to_string())?;
    Ok(Some(remember(&state, Path::new(top.trim()))))
}

#[tauri::command(async)]
pub fn remove_local_repo(state: State<'_, AppState>, repo: String) {
    state.update_settings(|s| s.repos.retain(|r| r != &repo));
}

#[tauri::command(async)]
pub fn clone_repo(app: AppHandle, state: State<'_, AppState>, url: String) -> Result<Option<LocalRepo>, String> {
    let url = safe_clone_url(url.trim())?.to_string();
    let Some(picked) = app.dialog().file().set_title("Choose where to clone").blocking_pick_folder() else { return Ok(None) };
    let parent = picked.into_path().map_err(|e| e.to_string())?;
    let dest = parent.join(clone_name(&url));
    if dest.exists() {
        return Err(format!("{} already exists", dest.display()));
    }
    let mut cmd = base(&parent);
    auth_env(&mut cmd, &state, &url);
    cmd.arg("clone").arg("--").arg(&url).arg(&dest);
    finish(cmd, &[0])?;
    Ok(Some(remember(&state, &dest)))
}

#[tauri::command(async)]
pub fn git_status(state: State<'_, AppState>, repo: String) -> Result<Status, String> {
    let dir = repo_dir(&state, &repo)?;
    let mut st = parse_status(&git(&dir, &["status", "--porcelain=v2", "--branch", "-z", "--untracked-files=all"])?);
    st.operation = operation(&dir);
    if st.operation == Some("merge") {
        st.merge_message = git_file(&dir, "MERGE_MSG").map(|m| m.lines().filter(|l| !l.starts_with('#')).collect::<Vec<_>>().join("\n").trim().to_string());
    }
    Ok(st)
}

fn git_file(dir: &Path, name: &str) -> Option<String> {
    let rel = git(dir, &["rev-parse", "--git-path", name]).ok()?;
    std::fs::read_to_string(dir.join(rel.trim())).ok()
}

fn git_path_exists(dir: &Path, name: &str) -> bool {
    git(dir, &["rev-parse", "--git-path", name]).map(|rel| dir.join(rel.trim()).exists()).unwrap_or(false)
}

fn operation(dir: &Path) -> Option<&'static str> {
    if git_path_exists(dir, "MERGE_HEAD") {
        Some("merge")
    } else if git_path_exists(dir, "rebase-merge") || git_path_exists(dir, "rebase-apply") {
        Some("rebase")
    } else if git_path_exists(dir, "CHERRY_PICK_HEAD") {
        Some("cherry-pick")
    } else if git_path_exists(dir, "REVERT_HEAD") {
        Some("revert")
    } else {
        None
    }
}

#[tauri::command(async)]
pub fn git_diff(state: State<'_, AppState>, repo: String, path: String, untracked: bool) -> Result<String, String> {
    let dir = repo_dir(&state, &repo)?;
    let path = safe_rel(&path)?;
    let mut cmd = base(&dir);
    if untracked {
        cmd.args(["diff", "--no-color", "--no-index", "--", if cfg!(windows) { "NUL" } else { "/dev/null" }, path]);
        return finish(cmd, &[0, 1]);
    }
    // before the first commit there is no head to compare with
    let has_head = git(&dir, &["rev-parse", "--verify", "-q", "HEAD"]).is_ok();
    cmd.args(["diff", "--no-color"]).arg(if has_head { "HEAD" } else { "--cached" }).arg("--").arg(path);
    finish(cmd, &[0])
}

#[tauri::command(async)]
pub fn git_commit(state: State<'_, AppState>, repo: String, summary: String, description: String, paths: Vec<String>, amend: Option<bool>) -> Result<(), String> {
    let dir = repo_dir(&state, &repo)?;
    let amend = amend.unwrap_or(false);
    let merging = operation(&dir).is_some();
    if summary.trim().is_empty() || (paths.is_empty() && !amend && !merging) {
        return Err("A commit needs a summary and at least one file".into());
    }
    // a reset would throw away an in-progress merge
    if !merging {
        let _ = git(&dir, &["reset", "-q"]);
    }
    if paths.is_empty() {
        let mut commit = base(&dir);
        commit.args(["commit", "-q", "-m", summary.trim()]);
        if !description.trim().is_empty() {
            commit.args(["-m", description.trim()]);
        }
        if amend {
            commit.arg("--amend");
        }
        return finish(commit, &[0]).map(|_| ());
    }
    let mut add = base(&dir);
    add.args(["add", "-A", "--"]);
    for p in &paths {
        add.arg(safe_rel(p)?);
    }
    finish(add, &[0])?;
    let mut commit = base(&dir);
    commit.args(["commit", "-q", "-m", summary.trim()]);
    if !description.trim().is_empty() {
        commit.args(["-m", description.trim()]);
    }
    if amend {
        commit.arg("--amend");
    }
    finish(commit, &[0]).map(|_| ())
}

// the last commit's message, for amending
#[tauri::command(async)]
pub fn git_last_message(state: State<'_, AppState>, repo: String) -> Result<String, String> {
    let dir = repo_dir(&state, &repo)?;
    git(&dir, &["log", "-1", "--format=%B"]).map(|m| m.trim().to_string())
}

#[tauri::command(async)]
pub fn git_stash_list(state: State<'_, AppState>, repo: String) -> Result<Vec<Stash>, String> {
    let dir = repo_dir(&state, &repo)?;
    let raw = git(&dir, &["stash", "list", "--format=%gs%x1f%cI%x1e"])?;
    Ok(raw
        .split('\x1e')
        .map(str::trim)
        .filter(|r| !r.is_empty())
        .enumerate()
        .map(|(i, r)| {
            let mut f = r.split('\x1f');
            Stash { index: i as u32, message: f.next().unwrap_or("").to_string(), date: f.next().unwrap_or("").to_string() }
        })
        .collect())
}

#[tauri::command(async)]
pub fn git_stash(state: State<'_, AppState>, repo: String, op: String, index: Option<u32>, message: Option<String>) -> Result<(), String> {
    let dir = repo_dir(&state, &repo)?;
    let at = format!("stash@{{{}}}", index.unwrap_or(0));
    let mut cmd = base(&dir);
    match op.as_str() {
        "push" => {
            cmd.args(["stash", "push", "-q", "--include-untracked"]);
            if let Some(m) = message.as_deref().map(str::trim).filter(|m| !m.is_empty()) {
                cmd.args(["-m", m]);
            }
        }
        "pop" | "apply" | "drop" => {
            cmd.args(["stash", op.as_str(), "-q", at.as_str()]);
        }
        _ => return Err("Unknown stash operation".into()),
    }
    finish(cmd, &[0]).map(|_| ())
}

// merges another branch into the current one; conflicts are left to resolve
#[tauri::command(async)]
pub fn git_merge(state: State<'_, AppState>, repo: String, branch: String) -> Result<String, String> {
    let dir = repo_dir(&state, &repo)?;
    let branch = safe_ref(&branch)?;
    let mut cmd = base(&dir);
    cmd.args(["merge", "--no-edit", branch]);
    match finish(cmd, &[0]) {
        Ok(_) => Ok("merged".into()),
        Err(e) if operation(&dir) == Some("merge") => Ok(format!("conflicts: {e}")),
        Err(e) => Err(e),
    }
}

#[tauri::command(async)]
pub fn git_abort(state: State<'_, AppState>, repo: String) -> Result<(), String> {
    let dir = repo_dir(&state, &repo)?;
    let op = operation(&dir).ok_or("Nothing is in progress")?;
    git(&dir, &[op, "--abort"]).map(|_| ())
}

// finishes a rebase, cherry-pick or revert once conflicts are fixed
#[tauri::command(async)]
pub fn git_continue(state: State<'_, AppState>, repo: String) -> Result<(), String> {
    let dir = repo_dir(&state, &repo)?;
    let op = operation(&dir).ok_or("Nothing is in progress")?;
    git(&dir, &["add", "-A"])?;
    let mut cmd = base(&dir);
    cmd.env("GIT_EDITOR", "true").args([op, "--continue"]);
    finish(cmd, &[0]).map(|_| ())
}

#[tauri::command(async)]
pub fn git_delete_branch(state: State<'_, AppState>, repo: String, branch: String, force: bool) -> Result<(), String> {
    let dir = repo_dir(&state, &repo)?;
    let branch = safe_ref(&branch)?;
    git(&dir, &["branch", if force { "-D" } else { "-d" }, branch]).map(|_| ())
}

#[tauri::command(async)]
pub fn git_rename_branch(state: State<'_, AppState>, repo: String, from: String, to: String) -> Result<(), String> {
    let dir = repo_dir(&state, &repo)?;
    git(&dir, &["branch", "-m", safe_ref(&from)?, safe_ref(&to)?]).map(|_| ())
}

// revert, cherry-pick, branch from or check out a commit from history
#[tauri::command(async)]
pub fn git_commit_action(state: State<'_, AppState>, repo: String, sha: String, op: String, name: Option<String>) -> Result<(), String> {
    let dir = repo_dir(&state, &repo)?;
    let sha = safe_ref(&sha)?;
    match op.as_str() {
        "revert" => git(&dir, &["revert", "--no-edit", sha]),
        "cherry-pick" => git(&dir, &["cherry-pick", sha]),
        "branch" => git(&dir, &["switch", "-q", "-c", safe_ref(name.as_deref().unwrap_or(""))?, sha]),
        "tag" => git(&dir, &["tag", safe_ref(name.as_deref().unwrap_or(""))?, sha]),
        "reset" => git(&dir, &["reset", "-q", "--mixed", sha]),
        _ => return Err("Unknown commit action".into()),
    }
    .map(|_| ())
}

#[tauri::command(async)]
pub fn git_discard(state: State<'_, AppState>, repo: String, files: Vec<Discard>) -> Result<(), String> {
    let dir = repo_dir(&state, &repo)?;
    for f in &files {
        let path = safe_rel(&f.path)?;
        let _ = git(&dir, &["reset", "-q", "--", path]);
        let tracked = git(&dir, &["ls-files", "--error-unmatch", "--", path]).is_ok();
        if f.untracked || !tracked {
            git(&dir, &["clean", "-fq", "--", path])?;
        } else {
            git(&dir, &["checkout", "--", path])?;
        }
    }
    Ok(())
}

#[tauri::command(async)]
pub fn git_branches(state: State<'_, AppState>, repo: String) -> Result<Branches, String> {
    let dir = repo_dir(&state, &repo)?;
    let all = git(&dir, &["branch", "--format=%(refname:short)", "--sort=-committerdate"])?;
    let current = git(&dir, &["branch", "--show-current"]).unwrap_or_default();
    Ok(Branches { current: current.trim().to_string(), all: all.lines().map(str::to_string).filter(|b| !b.is_empty()).collect() })
}

#[tauri::command(async)]
pub fn git_switch(state: State<'_, AppState>, repo: String, branch: String, create: bool) -> Result<(), String> {
    let dir = repo_dir(&state, &repo)?;
    let branch = safe_ref(&branch)?;
    let args: &[&str] = if create { &["switch", "-q", "-c", branch] } else { &["switch", "-q", branch] };
    git(&dir, args).map(|_| ())
}

#[tauri::command(async)]
pub fn git_sync(state: State<'_, AppState>, repo: String, op: String) -> Result<(), String> {
    let dir = repo_dir(&state, &repo)?;
    let remote = origin(&dir);
    if remote.is_empty() {
        return Err("This repository has no remote called origin".into());
    }
    let mut cmd = base(&dir);
    auth_env(&mut cmd, &state, &remote);
    match op.as_str() {
        "fetch" => cmd.args(["fetch", "-q", "--prune", "origin"]),
        "pull" => cmd.args(["pull", "-q", "--ff-only"]),
        "pull-merge" => cmd.args(["pull", "-q", "--no-rebase", "--no-edit"]),
        "pull-rebase" => cmd.args(["pull", "-q", "--rebase"]),
        // the first push of a branch also sets its upstream
        "push" => cmd.args(["push", "-q", "-u", "origin", "HEAD"]),
        "force-push" => cmd.args(["push", "-q", "--force-with-lease", "-u", "origin", "HEAD"]),
        "push-tags" => cmd.args(["push", "-q", "origin", "--tags"]),
        _ => return Err("Unknown sync operation".into()),
    };
    finish(cmd, &[0]).map(|_| ())
}

#[tauri::command(async)]
pub fn git_log(state: State<'_, AppState>, repo: String, skip: u32) -> Result<Vec<LogEntry>, String> {
    let dir = repo_dir(&state, &repo)?;
    let skip = format!("--skip={skip}");
    let Ok(raw) = git(&dir, &["log", "-n", "60", &skip, "--format=%H%x1f%s%x1f%an%x1f%aI%x1f%b%x1e"]) else { return Ok(vec![]) };
    Ok(raw
        .split('\x1e')
        .filter_map(|rec| {
            let mut f = rec.trim().split('\x1f');
            Some(LogEntry {
                sha: f.next().filter(|s| !s.is_empty())?.into(),
                subject: f.next()?.into(),
                author: f.next()?.into(),
                date: f.next()?.into(),
                body: f.next().unwrap_or("").trim().into(),
            })
        })
        .collect())
}

#[tauri::command(async)]
pub fn git_show(state: State<'_, AppState>, repo: String, sha: String) -> Result<String, String> {
    let dir = repo_dir(&state, &repo)?;
    git(&dir, &["show", "--no-color", "--format=", "--patch", safe_ref(&sha)?])
}

// takes back the last commit but keeps its changes
#[tauri::command(async)]
pub fn git_undo(state: State<'_, AppState>, repo: String) -> Result<(), String> {
    let dir = repo_dir(&state, &repo)?;
    git(&dir, &["reset", "--soft", "HEAD~1"]).map(|_| ())
}

// "owner/name" from an origin url on the signed-in host
pub fn remote_slug(url: &str, host: &str) -> Option<String> {
    let url = url.trim();
    let rest = [format!("https://{host}/"), format!("git@{host}:"), format!("ssh://git@{host}/")].iter().find_map(|p| url.strip_prefix(p.as_str()).map(str::to_string))?;
    let rest = rest.trim_end_matches('/').trim_end_matches(".git");
    let mut parts = rest.split('/');
    let (owner, name) = (parts.next()?, parts.next()?);
    (parts.next().is_none() && !owner.is_empty() && !name.is_empty()).then(|| format!("{owner}/{name}").to_lowercase())
}

// the local clone of a github repository, if one was added
#[tauri::command(async)]
pub fn find_local_clone(state: State<'_, AppState>, full_name: String) -> Option<String> {
    let host = state.host();
    let want = full_name.to_lowercase();
    let repos = state.settings.lock().unwrap().repos.clone();
    repos.into_iter().filter(|p| Path::new(p).is_dir()).find(|p| remote_slug(&origin(Path::new(p)), &host).as_deref() == Some(want.as_str()))
}

#[tauri::command(async)]
pub fn git_remote(state: State<'_, AppState>, repo: String) -> Result<String, String> {
    Ok(origin(&repo_dir(&state, &repo)?))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_porcelain_status() {
        let raw = "# branch.oid abc\0# branch.head main\0# branch.upstream origin/main\0# branch.ab +2 -1\0\
1 .M N... 100644 100644 100644 a b src/a file.rs\0\
1 A. N... 000000 100644 100644 a b new.rs\0\
1 .D N... 100644 100644 000000 a b gone.rs\0\
2 R. N... 100644 100644 100644 a b R100 to.rs\0from.rs\0\
u UU N... 100644 100644 100644 100644 a b c both.rs\0\
? notes.txt\0";
        let st = parse_status(raw);
        assert_eq!((st.branch.as_str(), st.upstream.as_deref(), st.ahead, st.behind), ("main", Some("origin/main"), 2, 1));
        let got: Vec<_> = st.files.iter().map(|f| (f.path.as_str(), f.status, f.untracked)).collect();
        assert_eq!(
            got,
            vec![
                ("src/a file.rs", "modified", false),
                ("new.rs", "new", false),
                ("gone.rs", "deleted", false),
                ("to.rs", "renamed", false),
                ("both.rs", "conflict", false),
                ("notes.txt", "new", true),
            ]
        );
    }

    #[test]
    fn rejects_unsafe_input() {
        assert!(safe_rel("src/main.rs").is_ok());
        assert!(safe_rel("../secret").is_err());
        assert!(safe_rel("/etc/passwd").is_err());
        assert!(safe_rel("").is_err());
        assert!(safe_ref("feature/login-2").is_ok());
        assert!(safe_ref("--upload-pack=x").is_err());
        assert!(safe_ref("a..b").is_err());
        assert!(safe_ref("a b").is_err());
        assert!(safe_clone_url("https://github.com/cli/cli.git").is_ok());
        assert!(safe_clone_url("git@github.com:cli/cli.git").is_ok());
        assert!(safe_clone_url("ext::sh -c evil").is_err());
        assert!(safe_clone_url("--upload-pack=evil").is_err());
        assert!(safe_clone_url("/tmp/local").is_err());
    }

    #[test]
    fn reads_a_remote_slug() {
        assert_eq!(remote_slug("https://github.com/Cli/Cli.git", "github.com").as_deref(), Some("cli/cli"));
        assert_eq!(remote_slug("git@github.com:a/b", "github.com").as_deref(), Some("a/b"));
        assert_eq!(remote_slug("https://gitlab.com/a/b", "github.com"), None);
        assert_eq!(remote_slug("https://github.com/a/b/c", "github.com"), None);
    }

    #[test]
    fn names_a_clone_folder() {
        assert_eq!(clone_name("https://github.com/cli/cli.git"), "cli");
        assert_eq!(clone_name("git@github.com:rust-lang/rust"), "rust");
        assert_eq!(clone_name("https://github.com/a/b/"), "b");
        assert_eq!(clone_name("https://github.com/a/.git"), "repository");
    }
}

#[derive(Serialize)]
pub struct WikiPage {
    file: String,
    title: String,
}

fn safe_slug(repo: &str) -> Result<&str, String> {
    let ok = repo.split('/').count() == 2 && repo.split('/').all(|p| !p.is_empty() && !p.starts_with('.')) && repo.chars().all(|c| c.is_ascii_alphanumeric() || matches!(c, '/' | '-' | '_' | '.'));
    if ok { Ok(repo) } else { Err("Not a repository name".into()) }
}

// a wiki is its own git repository, kept in the app cache
fn wiki_dir(app: &AppHandle, state: &AppState, repo: &str, sync: bool) -> Result<PathBuf, String> {
    use tauri::Manager;
    let repo = safe_slug(repo)?;
    let host = state.host();
    let dir = app.path().app_cache_dir().map_err(|e| e.to_string())?.join("wikis").join(host.replace(':', "_")).join(repo.replace('/', "__"));
    let url = format!("https://{host}/{repo}.wiki.git");
    if !dir.join(".git").exists() {
        std::fs::create_dir_all(dir.parent().unwrap()).map_err(|e| e.to_string())?;
        let mut cmd = base(dir.parent().unwrap());
        auth_env(&mut cmd, state, &url);
        cmd.args(["clone", "-q", "--", &url]).arg(&dir);
        finish(cmd, &[0]).map_err(|e| if e.contains("not found") || e.contains("not exist") { "This wiki has no pages yet. Create the first one on GitHub.".to_string() } else { e })?;
    } else if sync {
        let mut cmd = base(&dir);
        auth_env(&mut cmd, state, &url);
        cmd.args(["pull", "-q", "--rebase"]);
        // offline: keep showing what we have
        let _ = finish(cmd, &[0]);
    }
    Ok(dir)
}

fn page_title(file: &str) -> String {
    Path::new(file).file_stem().map(|s| s.to_string_lossy().replace('-', " ")).unwrap_or_default()
}

#[tauri::command(async)]
pub fn wiki_pages(app: AppHandle, state: State<'_, AppState>, repo: String) -> Result<Vec<WikiPage>, String> {
    let dir = wiki_dir(&app, &state, &repo, true)?;
    let files = git(&dir, &["ls-files"])?;
    Ok(files
        .lines()
        .filter(|f| !f.is_empty())
        .map(|f| WikiPage { file: f.to_string(), title: page_title(f) })
        .collect())
}

#[tauri::command(async)]
pub fn wiki_read(app: AppHandle, state: State<'_, AppState>, repo: String, file: String) -> Result<String, String> {
    let dir = wiki_dir(&app, &state, &repo, false)?;
    std::fs::read_to_string(dir.join(safe_rel(&file)?)).map_err(|e| e.to_string())
}

#[derive(Deserialize)]
pub struct WikiEdit {
    file: String,
    // none deletes the page
    content: Option<String>,
    // the old file when renaming
    previous: Option<String>,
    message: String,
    name: String,
    email: String,
}

// writes, renames or deletes a page, then pushes
#[tauri::command(async)]
pub fn wiki_write(app: AppHandle, state: State<'_, AppState>, repo: String, edit: WikiEdit) -> Result<(), String> {
    let WikiEdit { file, content, previous, message, name, email } = edit;
    let dir = wiki_dir(&app, &state, &repo, true)?;
    let file = safe_rel(&file)?.to_string();
    if let Some(prev) = previous.as_deref().filter(|p| *p != file) {
        git(&dir, &["rm", "-q", "--", safe_rel(prev)?])?;
    }
    match &content {
        Some(text) => {
            std::fs::write(dir.join(&file), text).map_err(|e| e.to_string())?;
            git(&dir, &["add", "--", &file])?;
        }
        None => {
            git(&dir, &["rm", "-q", "--", &file])?;
        }
    }
    let mut commit = base(&dir);
    // fall back to the github identity when git has none
    if git(&dir, &["config", "user.email"]).map(|e| e.trim().is_empty()).unwrap_or(true) {
        commit.env("GIT_AUTHOR_NAME", &name).env("GIT_AUTHOR_EMAIL", &email).env("GIT_COMMITTER_NAME", &name).env("GIT_COMMITTER_EMAIL", &email);
    }
    commit.args(["commit", "-q", "-m", if message.trim().is_empty() { "Update wiki" } else { message.trim() }]);
    finish(commit, &[0])?;
    let url = format!("https://{}/{}.wiki.git", state.host(), safe_slug(&repo)?);
    let mut push = base(&dir);
    auth_env(&mut push, &state, &url);
    push.args(["push", "-q", "origin", "HEAD"]);
    if let Err(e) = finish(push, &[0]) {
        // leave the clone matching the remote
        let _ = git(&dir, &["reset", "-q", "--hard", "@{u}"]);
        return Err(e);
    }
    Ok(())
}
