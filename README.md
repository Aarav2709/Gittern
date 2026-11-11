# Gittern

Gittern is github.com but native: a desktop client for browsing GitHub — dashboard, profiles,
repositories, code, issues, pull requests and diffs, commits, Actions runs, releases,
notifications and search — in a monochrome UI.

Built with Tauri 2 (Rust) and React. It talks to the GitHub API directly; the token stays in the
Rust process and is never exposed to the webview.

## Run

```sh
npm install
npm run app            # dev build with hot reload
npm run tauri build    # release bundle
```

Sign-in: Gittern uses your GitHub CLI session (`gh auth login`) if there is one, a
`GITTERN_TOKEN` / `GH_TOKEN` / `GITHUB_TOKEN` environment variable, or a personal access token
you paste in, which is stored in the system keyring.

## Keys

| Key | Action |
| --- | --- |
| `Ctrl K` or `/` | Search, jump to `owner/repo`, or paste a GitHub URL |
| `Alt ←` / `Alt →` | Back / forward |
| `Ctrl R` | Refresh data |
