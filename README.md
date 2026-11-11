# Gittern

Gittern is github.com but native: a fast, monochrome desktop client for GitHub.

- **Browse**: home dashboard, explore, profiles and organizations (people, teams, followers), repositories, code with the last commit per file, blame, line links and permalinks, commits, branches, tags, releases, search (repositories, code, issues, pull requests, commits, users, topics).
- **Issues and pull requests**: timeline, comments, reactions, assignees, labels, milestones, reviewers, issue templates, lock, pin, subscribe. Pull requests add inline review comments and threads, pending reviews, split or unified diffs with syntax highlighting, viewed files, commits and checks tabs, merge with a custom message, auto-merge, update branch, delete branch.
- **Discussions**: categories, upvotes, replies, answers, new discussions.
- **Repositories**: star, watch, fork, create, edit files on a branch or a new one, labels, milestones, projects (read-only board), insights (pulse, contributors, traffic, dependencies), security alerts, deployments, settings (collaborators, branch protection, webhooks, deploy keys, variables, transfer, delete).
- **Actions**: workflows, runs, jobs, steps and searchable logs, run a workflow, re-run and cancel, artifacts and caches.
- **Gists**: browse, create, edit, star, fork, comment.
- **Inbox**: notifications grouped by repository, filters, mark read or done, unsubscribe, desktop notifications.
- **Desktop mode**: the switch beside the logo opens local repositories: clone, see changes and diffs, commit selected files, discard, undo the last commit, switch and create branches, fetch, pull, push, and browse history. It drives the `git` on your machine.
- **Workspace**: tabs with their own history, a sidebar with your work and repositories, a command palette, saved drafts, keyboard navigation.

Built with Tauri 2 (Rust) and React. It talks to the GitHub API directly; the token stays in the
Rust process and is never exposed to the webview.

## Run

```sh
npm install
npm run app            # dev build with hot reload
npm run tauri build    # release bundle
npm run check          # types, lint and tests
```

Sign-in: Gittern uses your GitHub CLI session (`gh auth login`) if there is one, a
`GITTERN_TOKEN` / `GH_TOKEN` / `GITHUB_TOKEN` environment variable, or a personal access token
you paste in, which is stored in the system keyring. GitHub Enterprise Server works too: pick it
on the sign-in screen and enter the hostname.

Browser sign-in (no token, no setup for the person using the app) needs a GitHub OAuth app once per
project: create one at github.com/settings/applications/new, tick **Enable Device Flow**, and paste
its client ID into `src-tauri/oauth_client_id.txt` before building. The client ID is public, not a
secret. `GITTERN_OAUTH_CLIENT_ID` in the environment overrides the file.

Projects need the `read:project` scope: `gh auth refresh -s read:project`.

Videos in readmes and comments play inline when the system has the codecs. On Linux that means
GStreamer's `playbin`, `autoaudiosink` and an H.264 decoder (Arch: `gst-plugins-good gst-libav`);
without them videos open in the browser, because WebKitGTK hangs on a half-installed GStreamer.

## Keys

| Key | Action |
| --- | --- |
| `Ctrl K` or `/` | Search, run a command, jump to `owner/repo`, or paste a GitHub URL |
| `Ctrl T` / `Ctrl W` / `Ctrl Shift T` | New tab / close tab / reopen closed tab |
| `Ctrl Tab`, `Ctrl 1`–`9` | Switch tabs |
| `Ctrl` click or middle click | Open a link in a background tab |
| `Ctrl B` | Show or hide the sidebar |
| `Alt ←` / `Alt →` | Back / forward in the current tab |
| `Ctrl R` | Refresh data |
| `J` / `K`, `Enter` | Move through a list and open the highlighted row |
| `G` then `H` / `N` / `E` | Home / inbox / explore |
| `G` then `C` / `I` / `P` / `A` / `D` | In a repository: code, issues, pulls, actions, discussions |
| `T` | Go to file, on a repository's Files page |
| `Y` / `B` | Copy a permalink / toggle blame, on a file |
| `?` | All shortcuts |
