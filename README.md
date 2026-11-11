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
