# Gittern

Gittern is github.com but native: a fast, desktop client for GitHub.

https://github.com/user-attachments/assets/11819e07-fb28-4fdb-83ae-c91e3573c0df

- **Browse**: home dashboard, explore, profiles and organizations (people, teams, followers), repositories, code with the last commit per file, blame, line links and permalinks, commits, branches, tags, releases, search (repositories, code, issues, pull requests, commits, users, topics).
- **Issues and pull requests**: timeline, comments, reactions, assignees, labels (and new ones from the picker), milestones, issue types, projects with status, sub-issues, parent and blocking issues, linked branches, issue templates and YAML issue forms, lock with a reason, pin, transfer, close as duplicate, hide comments, subscribe. Lists filter by author, label, assignee and milestone and edit many items at once. Pull requests add team reviewers and re-requests, inline review comments and threads, pending reviews, suggested changes, dismissing reviews, split or unified diffs with syntax highlighting, viewed files, commits and checks tabs, changing the base branch, re-running checks, merge with a custom message, auto-merge, merge queues, update branch, delete and restore branch, revert.
- **Discussions**: categories, upvotes, replies, answers, new discussions, editing, moving, locking, closing with a reason, deleting.
- **Repositories**: star (and star lists), watch at any level, fork, sync a fork, use a template, sponsor, create, edit or upload files on a branch or a new one, a wiki you can edit, codespaces, create and delete tags, rename branches and change the default, release assets, labels, milestones, projects as editable boards and tables, insights (pulse, contributors, traffic, dependencies), security alerts you can dismiss or reopen, deployments, settings (collaborators with roles, branch protection, rulesets, interaction limits, Actions permissions, webhooks with deliveries, deploy keys, variables, encrypted secrets, environments with protection rules, autolinks, secret and code scanning, Pages, transfer, delete).
- **Actions**: workflows, runs, jobs, steps and searchable logs, run a workflow, re-run a run or one job, cancel or force cancel, approve deployments, delete runs and logs, artifacts and caches.
- **Gists**: browse, create, edit, star, fork, comment.
- **Account and organizations**: profile, status, emails, social links, SSH, GPG and signing keys, blocked users, codespaces, invitations, projects, packages, sponsors, organization members, roles, teams and settings (profile, member privileges, webhooks, secrets, variables, blocks, outside collaborators).
- **Inbox**: notifications grouped by repository, filters, mark read or done, unsubscribe, desktop notifications.
- **Desktop mode**: the switch beside the logo opens local repositories: clone, see changes and diffs, commit selected files, amend, discard, stash, undo the last commit, switch, create, rename, merge and delete branches, resolve or abort merges and rebases, fetch, pull (merge or rebase), push and force push, browse history and revert, branch or tag from any commit. Open a repository in your editor (detected, or any app you pick), a terminal or the file manager, also from its GitHub page. It drives the `git` on your machine and runs on Windows, macOS and Linux.
- **Workspace**: tabs with their own history, a sidebar with your work and repositories, a command palette, saved drafts, keyboard navigation.

Built with Tauri 2 (Rust) and React. It talks to the GitHub API directly; the token stays in the
Rust process and is never exposed to the webview.

> Usually like my other projects, AI is generally used for research and bug fixing, or maybe making my work easier. Just FYI, I can understand and comprehend, and also review what AI has done, before pushing anything.
