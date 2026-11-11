// gittern backend

use std::collections::HashMap;
use std::path::PathBuf;
use std::process::Command;
use std::sync::Mutex;

use serde::{Deserialize, Serialize};
use tauri::{Manager, State};

const SERVICE: &str = "dev.gittern.app";
const DEFAULT_HOST: &str = "github.com";
// responses larger than this are not kept for conditional requests
const CACHE_BODY_LIMIT: usize = 1_000_000;
const CACHE_ENTRIES: usize = 400;

#[derive(Clone)]
struct Token {
    value: String,
    source: &'static str,
}

// the little that has to survive a restart and is not a secret
#[derive(Clone, Default, Serialize, Deserialize)]
struct Settings {
    // set on sign-out so ambient tokens stay ignored
    #[serde(default)]
    signed_out: bool,
    // github enterprise server hostname
    #[serde(default)]
    host: Option<String>,
}

struct Cached {
    etag: String,
    body: String,
    link: Option<String>,
}

struct AppState {
    http: reqwest::Client,
    token: Mutex<Option<Token>>,
    // whether the token lookup has run
    resolved: tauri::async_runtime::Mutex<bool>,
    settings: Mutex<Settings>,
    settings_path: PathBuf,
    // etag cache
    cache: Mutex<HashMap<String, Cached>>,
}

impl AppState {
    fn host(&self) -> String {
        self.settings.lock().unwrap().host.clone().unwrap_or_else(|| DEFAULT_HOST.into())
    }

    fn update_settings(&self, change: impl FnOnce(&mut Settings)) {
        let mut s = self.settings.lock().unwrap();
        change(&mut s);
        if let Some(dir) = self.settings_path.parent() {
            let _ = std::fs::create_dir_all(dir);
        }
        if let Ok(json) = serde_json::to_string_pretty(&*s) {
            let _ = std::fs::write(&self.settings_path, json);
        }
    }

    fn set_token(&self, token: Option<Token>) {
        *self.token.lock().unwrap() = token;
        self.cache.lock().unwrap().clear();
    }
}

#[derive(Serialize, Default)]
struct Rate {
    limit: Option<u64>,
    remaining: Option<u64>,
    // unix seconds at which the window resets
    reset: Option<u64>,
    resource: Option<String>,
    retry_after: Option<u64>,
}

#[derive(Serialize)]
struct GhResponse {
    status: u16,
    body: String,
    link: Option<String>,
    rate: Rate,
    // seconds to wait between polls
    poll: Option<u64>,
}

#[derive(Serialize)]
struct AuthStatus {
    source: Option<&'static str>,
    host: String,
    // whether device-flow sign-in is configured
    device_flow: bool,
}

fn valid_host(host: &str) -> bool {
    !host.is_empty()
        && host.len() <= 253
        && !host.starts_with(['.', '-'])
        && host.chars().all(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '-' | ':'))
}

// enterprise has separate rest and graphql roots
fn api_url(host: &str, path: &str) -> String {
    if host == DEFAULT_HOST {
        format!("https://api.github.com{path}")
    } else if path == "/graphql" {
        format!("https://{host}/api/graphql")
    } else {
        format!("https://{host}/api/v3{path}")
    }
}

fn keyring_entry(host: &str) -> Option<keyring::Entry> {
    let account = if host == DEFAULT_HOST { "github-token".to_string() } else { format!("github-token@{host}") };
    keyring::Entry::new(SERVICE, &account).ok()
}

fn client_id() -> Option<String> {
    std::env::var("GITTERN_OAUTH_CLIENT_ID")
        .ok()
        .or_else(|| option_env!("GITTERN_OAUTH_CLIENT_ID").map(str::to_string))
        .filter(|v| !v.trim().is_empty())
}

// token lookup order
fn resolve_token(settings: &Settings) -> Option<Token> {
    let host = settings.host.as_deref().unwrap_or(DEFAULT_HOST);
    if let Some(value) = keyring_entry(host).and_then(|e| e.get_password().ok()) {
        if !value.is_empty() {
            return Some(Token { value, source: "keyring" });
        }
    }
    if settings.signed_out {
        return None;
    }
    for var in ["GITTERN_TOKEN", "GH_TOKEN", "GITHUB_TOKEN"] {
        if let Ok(value) = std::env::var(var) {
            if !value.trim().is_empty() {
                return Some(Token { value: value.trim().to_string(), source: "env" });
            }
        }
    }
    let out = Command::new("gh").args(["auth", "token", "--hostname", host]).output().ok()?;
    if out.status.success() {
        let value = String::from_utf8_lossy(&out.stdout).trim().to_string();
        if !value.is_empty() {
            return Some(Token { value, source: "gh-cli" });
        }
    }
    None
}

fn header_u64(headers: &reqwest::header::HeaderMap, name: &str) -> Option<u64> {
    headers.get(name)?.to_str().ok()?.parse().ok()
}

fn header_string(headers: &reqwest::header::HeaderMap, name: &str) -> Option<String> {
    headers.get(name)?.to_str().ok().map(str::to_string)
}

#[allow(clippy::too_many_arguments)]
async fn send(
    http: &reqwest::Client,
    cache: Option<&Mutex<HashMap<String, Cached>>>,
    host: &str,
    token: Option<&str>,
    method: &str,
    path: &str,
    body: Option<serde_json::Value>,
    accept: Option<String>,
) -> Result<GhResponse, String> {
    if !path.starts_with('/') {
        return Err("path must start with '/'".into());
    }
    let method = reqwest::Method::from_bytes(method.to_uppercase().as_bytes()).map_err(|e| e.to_string())?;
    let needs_body = matches!(method.as_str(), "PUT" | "POST" | "PATCH");
    let accept = accept.unwrap_or_else(|| "application/vnd.github+json".into());
    let cache_key = (method == reqwest::Method::GET).then(|| format!("{accept}\n{path}"));
    let mut req = http
        .request(method, api_url(host, path))
        .header("Accept", &accept)
        .header("X-GitHub-Api-Version", "2022-11-28");
    if let Some(t) = token {
        req = req.bearer_auth(t);
    }
    if let (Some(cache), Some(key)) = (cache, &cache_key) {
        if let Some(hit) = cache.lock().unwrap().get(key) {
            req = req.header("If-None-Match", &hit.etag);
        }
    }
    req = match body {
        Some(b) => req.json(&b),
        // body-less writes need a content-length
        None if needs_body => req.body(""),
        None => req,
    };
    let res = req.send().await.map_err(|e| format!("Network error: {e}"))?;
    let status = res.status().as_u16();
    let headers = res.headers().clone();
    let rate = Rate {
        limit: header_u64(&headers, "x-ratelimit-limit"),
        remaining: header_u64(&headers, "x-ratelimit-remaining"),
        reset: header_u64(&headers, "x-ratelimit-reset"),
        resource: header_string(&headers, "x-ratelimit-resource"),
        retry_after: header_u64(&headers, "retry-after"),
    };
    let poll = header_u64(&headers, "x-poll-interval");
    let link = header_string(&headers, "link");

    if status == 304 {
        if let (Some(cache), Some(key)) = (cache, &cache_key) {
            if let Some(hit) = cache.lock().unwrap().get(key) {
                return Ok(GhResponse { status: 200, body: hit.body.clone(), link: hit.link.clone(), rate, poll });
            }
        }
    }
    let body = res.text().await.map_err(|e| e.to_string())?;
    if let (Some(cache), Some(key)) = (cache, cache_key) {
        let mut cache = cache.lock().unwrap();
        match header_string(&headers, "etag") {
            Some(etag) if status == 200 && body.len() <= CACHE_BODY_LIMIT => {
                if cache.len() >= CACHE_ENTRIES && !cache.contains_key(&key) {
                    cache.clear();
                }
                cache.insert(key, Cached { etag, body: body.clone(), link: link.clone() });
            }
            _ => {
                cache.remove(&key);
            }
        }
    }
    Ok(GhResponse { status, body, link, rate, poll })
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
    let host = state.host();
    send(&state.http, Some(&state.cache), &host, token.as_ref().map(|t| t.value.as_str()), &method, &path, body, accept).await
}

// token lookup runs off the main thread, once
#[tauri::command]
async fn auth_status(state: State<'_, AppState>) -> Result<AuthStatus, String> {
    let mut resolved = state.resolved.lock().await;
    if !*resolved {
        let settings = state.settings.lock().unwrap().clone();
        let token = tauri::async_runtime::spawn_blocking(move || resolve_token(&settings))
            .await
            .map_err(|e| e.to_string())?;
        state.set_token(token);
        *resolved = true;
    }
    Ok(AuthStatus {
        source: state.token.lock().unwrap().as_ref().map(|t| t.source),
        host: state.host(),
        device_flow: client_id().is_some(),
    })
}

// checks a token against the api, then stores it in the os keyring
async fn accept_token(state: &AppState, host: String, token: String) -> Result<Option<String>, String> {
    let res = send(&state.http, None, &host, Some(&token), "GET", "/user", None, None).await?;
    if res.status != 200 {
        return Err(format!("GitHub rejected this token (HTTP {})", res.status));
    }
    let warning = match keyring_entry(&host).map(|e| e.set_password(&token)) {
        Some(Ok(())) => None,
        _ => Some("No system keyring available. The token will be forgotten when Gittern quits.".to_string()),
    };
    state.update_settings(|s| {
        s.signed_out = false;
        s.host = (host != DEFAULT_HOST).then_some(host);
    });
    state.set_token(Some(Token { value: token, source: "keyring" }));
    *state.resolved.lock().await = true;
    Ok(warning)
}

#[tauri::command]
async fn set_token(state: State<'_, AppState>, token: String, host: Option<String>) -> Result<Option<String>, String> {
    let token = token.trim().to_string();
    if token.is_empty() {
        return Err("Token is empty".into());
    }
    let host = host.map(|h| h.trim().trim_start_matches("https://").trim_end_matches('/').to_lowercase());
    let host = host.filter(|h| !h.is_empty()).unwrap_or_else(|| DEFAULT_HOST.into());
    if !valid_host(&host) {
        return Err("That doesn't look like a hostname".into());
    }
    accept_token(&state, host, token).await
}

// goes back to the github cli or environment token after a sign-out
#[tauri::command]
async fn use_ambient_token(state: State<'_, AppState>) -> Result<(), String> {
    let mut settings = state.settings.lock().unwrap().clone();
    settings.signed_out = false;
    let probe = settings.clone();
    let token = tauri::async_runtime::spawn_blocking(move || resolve_token(&probe))
        .await
        .map_err(|e| e.to_string())?
        .ok_or("No GitHub CLI session or token in the environment. Run `gh auth login` first.")?;
    state.update_settings(|s| s.signed_out = false);
    state.set_token(Some(token));
    Ok(())
}

#[tauri::command]
fn sign_out(state: State<'_, AppState>) {
    if let Some(entry) = keyring_entry(&state.host()) {
        let _ = entry.delete_credential();
    }
    state.update_settings(|s| s.signed_out = true);
    state.set_token(None);
}

#[derive(Serialize, Deserialize)]
struct DeviceCode {
    device_code: String,
    user_code: String,
    verification_uri: String,
    interval: u64,
    expires_in: u64,
}

// starts the oauth device flow
#[tauri::command]
async fn device_start(state: State<'_, AppState>) -> Result<DeviceCode, String> {
    let id = client_id().ok_or("Browser sign-in is not configured in this build")?;
    let res = state
        .http
        .post(format!("https://{}/login/device/code", state.host()))
        .header("Accept", "application/json")
        .form(&[("client_id", id.as_str()), ("scope", "repo read:org notifications gist user workflow read:project")])
        .send()
        .await
        .map_err(|e| format!("Network error: {e}"))?;
    res.json::<DeviceCode>().await.map_err(|_| "GitHub did not start the sign-in".to_string())
}

// one poll of the device flow
#[tauri::command]
async fn device_poll(state: State<'_, AppState>, device_code: String) -> Result<Option<String>, String> {
    let id = client_id().ok_or("Browser sign-in is not configured in this build")?;
    let host = state.host();
    let res = state
        .http
        .post(format!("https://{host}/login/oauth/access_token"))
        .header("Accept", "application/json")
        .form(&[
            ("client_id", id.as_str()),
            ("device_code", device_code.as_str()),
            ("grant_type", "urn:ietf:params:oauth:grant-type:device_code"),
        ])
        .send()
        .await
        .map_err(|e| format!("Network error: {e}"))?;
    let json: serde_json::Value = res.json().await.map_err(|e| e.to_string())?;
    if let Some(token) = json.get("access_token").and_then(|v| v.as_str()) {
        let warning = accept_token(&state, host, token.to_string()).await?;
        return Ok(Some(warning.unwrap_or_default()));
    }
    match json.get("error").and_then(|v| v.as_str()) {
        Some("authorization_pending") | Some("slow_down") => Ok(None),
        Some("expired_token") => Err("The code expired. Start again.".into()),
        Some("access_denied") => Err("Sign-in was cancelled.".into()),
        Some(other) => Err(format!("Sign-in failed: {other}")),
        None => Err("Sign-in failed".into()),
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let http = reqwest::Client::builder()
        .user_agent(concat!("Gittern/", env!("CARGO_PKG_VERSION")))
        .build()
        .expect("failed to build HTTP client");

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_window_state::Builder::default().build())
        .setup(move |app| {
            let settings_path = app.path().app_config_dir()?.join("settings.json");
            let settings = std::fs::read_to_string(&settings_path)
                .ok()
                .and_then(|s| serde_json::from_str::<Settings>(&s).ok())
                .map(|mut s| {
                    s.host = s.host.filter(|h| valid_host(h));
                    s
                })
                .unwrap_or_default();
            app.manage(AppState {
                http,
                token: Mutex::new(None),
                resolved: tauri::async_runtime::Mutex::new(false),
                settings: Mutex::new(settings),
                settings_path,
                cache: Mutex::new(HashMap::new()),
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            github_request,
            auth_status,
            set_token,
            use_ambient_token,
            sign_out,
            device_start,
            device_poll
        ])
        .run(tauri::generate_context!())
        .expect("error while running Gittern");
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn api_urls_per_host() {
        assert_eq!(api_url("github.com", "/user"), "https://api.github.com/user");
        assert_eq!(api_url("github.com", "/graphql"), "https://api.github.com/graphql");
        assert_eq!(api_url("git.corp.example", "/user"), "https://git.corp.example/api/v3/user");
        assert_eq!(api_url("git.corp.example", "/graphql"), "https://git.corp.example/api/graphql");
    }

    #[test]
    fn hostnames_are_checked() {
        assert!(valid_host("github.com"));
        assert!(valid_host("git.corp.example:8443"));
        assert!(!valid_host(""));
        assert!(!valid_host("evil.example/path"));
        assert!(!valid_host("user@evil.example"));
        assert!(!valid_host("-flag"));
    }
}
