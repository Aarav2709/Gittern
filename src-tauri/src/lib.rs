//! Gittern backend: owns the GitHub token and proxies API calls so the
//! credential never has to live in the webview.

use std::process::Command;
use std::sync::Mutex;

use serde::Serialize;
use tauri::State;

const SERVICE: &str = "dev.gittern.app";
const ACCOUNT: &str = "github-token";
const API: &str = "https://api.github.com";

#[derive(Clone)]
struct Token {
    value: String,
    source: &'static str,
}

struct AppState {
    http: reqwest::Client,
    token: Mutex<Option<Token>>,
}

#[derive(Serialize)]
struct GhResponse {
    status: u16,
    body: String,
    link: Option<String>,
}

#[derive(Serialize)]
struct AuthStatus {
    source: Option<&'static str>,
}

fn keyring_entry() -> Option<keyring::Entry> {
    keyring::Entry::new(SERVICE, ACCOUNT).ok()
}

/// Token lookup order: our own keyring entry, environment, then the GitHub CLI.
fn resolve_token() -> Option<Token> {
    if let Some(value) = keyring_entry().and_then(|e| e.get_password().ok()) {
        if !value.is_empty() {
            return Some(Token { value, source: "keyring" });
        }
    }
    for var in ["GITTERN_TOKEN", "GH_TOKEN", "GITHUB_TOKEN"] {
        if let Ok(value) = std::env::var(var) {
            if !value.trim().is_empty() {
                return Some(Token { value: value.trim().to_string(), source: "env" });
            }
        }
    }
    let out = Command::new("gh").args(["auth", "token"]).output().ok()?;
    if out.status.success() {
        let value = String::from_utf8_lossy(&out.stdout).trim().to_string();
        if !value.is_empty() {
            return Some(Token { value, source: "gh-cli" });
        }
    }
    None
}

async fn send(
    http: &reqwest::Client,
    token: Option<&str>,
    method: &str,
    path: &str,
    body: Option<serde_json::Value>,
    accept: Option<String>,
) -> Result<GhResponse, String> {
    if !path.starts_with('/') {
        return Err("path must start with '/'".into());
    }
    let method = reqwest::Method::from_bytes(method.to_uppercase().as_bytes())
        .map_err(|e| e.to_string())?;
    let needs_body = matches!(method.as_str(), "PUT" | "POST" | "PATCH");
    let mut req = http
        .request(method, format!("{API}{path}"))
        .header("Accept", accept.unwrap_or_else(|| "application/vnd.github+json".into()))
        .header("X-GitHub-Api-Version", "2022-11-28");
    if let Some(t) = token {
        req = req.bearer_auth(t);
    }
    req = match body {
        Some(b) => req.json(&b),
        // GitHub rejects body-less writes without an explicit Content-Length.
        None if needs_body => req.body(""),
        None => req,
    };
    let res = req.send().await.map_err(|e| format!("Network error: {e}"))?;
    let status = res.status().as_u16();
    let link = res
        .headers()
        .get("link")
        .and_then(|v| v.to_str().ok())
        .map(str::to_string);
    let body = res.text().await.map_err(|e| e.to_string())?;
    Ok(GhResponse { status, body, link })
}

#[tauri::command]
async fn github_request(
    state: State<'_, AppState>,
    method: String,
    path: String,
    body: Option<serde_json::Value>,
    accept: Option<String>,
) -> Result<GhResponse, String> {
    let token = state.token.lock().unwrap().clone();
    send(&state.http, token.as_ref().map(|t| t.value.as_str()), &method, &path, body, accept).await
}

#[tauri::command]
fn auth_status(state: State<'_, AppState>) -> AuthStatus {
    AuthStatus { source: state.token.lock().unwrap().as_ref().map(|t| t.source) }
}

/// Validates a personal access token against the API, then stores it in the
/// OS keyring. Returns a warning string if it could only be kept in memory.
#[tauri::command]
async fn set_token(state: State<'_, AppState>, token: String) -> Result<Option<String>, String> {
    let token = token.trim().to_string();
    if token.is_empty() {
        return Err("Token is empty".into());
    }
    let res = send(&state.http, Some(&token), "GET", "/user", None, None).await?;
    if res.status != 200 {
        return Err(format!("GitHub rejected this token (HTTP {})", res.status));
    }
    let warning = match keyring_entry().map(|e| e.set_password(&token)) {
        Some(Ok(())) => None,
        _ => Some("No system keyring available — the token will be forgotten when Gittern quits.".to_string()),
    };
    *state.token.lock().unwrap() = Some(Token { value: token, source: "keyring" });
    Ok(warning)
}

#[tauri::command]
fn sign_out(state: State<'_, AppState>) {
    if let Some(entry) = keyring_entry() {
        let _ = entry.delete_credential();
    }
    *state.token.lock().unwrap() = None;
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let http = reqwest::Client::builder()
        .user_agent(concat!("Gittern/", env!("CARGO_PKG_VERSION")))
        .build()
        .expect("failed to build HTTP client");

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .manage(AppState { http, token: Mutex::new(resolve_token()) })
        .invoke_handler(tauri::generate_handler![github_request, auth_status, set_token, sign_out])
        .run(tauri::generate_context!())
        .expect("error while running Gittern");
}
