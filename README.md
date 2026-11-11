# Gittern

Gittern is github.com but native: a fast, monochrome desktop client for GitHub.

- **Browse**: home feed, profiles, repositories, code with the last commit per file, commits, branches, releases, search (repositories, code, issues, pull requests, users).
- **Issues and pull requests**: timeline, comments, reactions, assignees, labels, milestones, reviewers, reviews, checks, merge, close and reopen, new issue, new pull request.
- **Repositories**: star, watch, fork, create, edit description/website/topics, settings, edit, add and delete files.
- **Actions**: runs, jobs, steps and logs, re-run and cancel.
- **Inbox**: notifications grouped by repository, mark read or done.
- **Workspace**: tabs, a sidebar with your work and repositories, a command palette.

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

Videos embedded in readmes and comments open in your browser instead of playing inline.

## Keys

| Key | Action |
| --- | --- |
| `Ctrl K` or `/` | Search, jump to `owner/repo`, or paste a GitHub URL |
| `Ctrl T` / `Ctrl W` | New tab / close tab |
| `Ctrl` click or middle click | Open a link in a background tab |
| `Ctrl B` | Show or hide the sidebar |
| `Alt ←` / `Alt →` | Back / forward |
| `Ctrl R` | Refresh data |
| `T` | Go to file, on a repository's Files page |
