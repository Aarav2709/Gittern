// the github rest shapes gittern reads

export interface User {
  id: number;
  login: string;
  avatar_url: string;
  html_url: string;
  type?: 'User' | 'Organization' | 'Bot';
  name?: string | null;
  bio?: string | null;
  description?: string | null;
  company?: string | null;
  location?: string | null;
  email?: string | null;
  blog?: string | null;
  followers?: number;
  following?: number;
  public_repos?: number;
  public_gists?: number;
  contributions?: number;
}

export interface Label {
  id?: number;
  name: string;
  color?: string;
  description?: string | null;
}

export interface Milestone {
  number: number;
  title: string;
  description?: string | null;
  state: 'open' | 'closed';
  open_issues: number;
  closed_issues: number;
  due_on?: string | null;
  html_url: string;
}

export interface Repo {
  id: number;
  name: string;
  full_name: string;
  owner: User;
  private: boolean;
  fork: boolean;
  archived: boolean;
  description: string | null;
  homepage: string | null;
  html_url: string;
  clone_url: string;
  ssh_url: string;
  default_branch: string;
  language: string | null;
  topics?: string[];
  stargazers_count: number;
  forks_count: number;
  subscribers_count?: number;
  open_issues_count: number;
  pushed_at: string | null;
  updated_at?: string;
  has_issues: boolean;
  has_discussions?: boolean;
  has_wiki?: boolean;
  has_projects?: boolean;
  license?: { spdx_id: string; name: string } | null;
  parent?: Repo;
  permissions?: { admin?: boolean; maintain?: boolean; push?: boolean; triage?: boolean; pull?: boolean };
  allow_squash_merge?: boolean;
  allow_merge_commit?: boolean;
  allow_rebase_merge?: boolean;
  allow_auto_merge?: boolean;
  delete_branch_on_merge?: boolean;
  visibility?: string;
}

export interface Reactions {
  total_count: number;
  '+1': number;
  '-1': number;
  laugh: number;
  hooray: number;
  confused: number;
  heart: number;
  rocket: number;
  eyes: number;
}

export interface Issue {
  id: number;
  node_id: string;
  number: number;
  title: string;
  state: 'open' | 'closed';
  state_reason?: string | null;
  locked: boolean;
  user: User | null;
  labels: Label[];
  assignees: User[];
  milestone: Milestone | null;
  comments: number;
  created_at: string;
  updated_at: string;
  closed_at: string | null;
  body?: string | null;
  body_html?: string;
  html_url: string;
  repository_url: string;
  draft?: boolean;
  pull_request?: { merged_at: string | null; html_url: string };
  reactions?: Reactions;
}

export interface GitRef {
  ref: string;
  label: string;
  sha: string;
  repo: Repo | null;
  user: User | null;
}

export interface PullRequest extends Omit<Issue, 'pull_request'> {
  merged: boolean;
  merged_at: string | null;
  mergeable: boolean | null;
  mergeable_state: string;
  draft: boolean;
  head: GitRef;
  base: GitRef;
  commits: number;
  additions: number;
  deletions: number;
  changed_files: number;
  requested_reviewers: User[];
  requested_teams?: { id: number; name: string; slug: string }[];
  auto_merge: { merge_method: string } | null;
  maintainer_can_modify?: boolean;
}

export interface DiffFileEntry {
  sha: string;
  filename: string;
  previous_filename?: string;
  status: string;
  additions: number;
  deletions: number;
  changes: number;
  patch?: string;
  blob_url?: string;
}

export interface CommitEntry {
  sha: string;
  html_url: string;
  author: User | null;
  committer: User | null;
  commit: {
    message: string;
    author: { name: string; email: string; date: string };
    committer?: { name: string; date: string };
    verification?: { verified: boolean; reason: string };
    comment_count?: number;
  };
  parents: { sha: string }[];
  stats?: { additions: number; deletions: number; total: number };
  files?: DiffFileEntry[];
}

// a line comment on a pull request diff
export interface ReviewComment {
  id: number;
  node_id: string;
  pull_request_review_id: number | null;
  in_reply_to_id?: number;
  path: string;
  line: number | null;
  original_line: number | null;
  start_line?: number | null;
  side: 'LEFT' | 'RIGHT';
  subject_type?: 'line' | 'file';
  diff_hunk: string;
  commit_id: string;
  user: User | null;
  body: string;
  body_html?: string;
  created_at: string;
  updated_at: string;
  html_url: string;
  reactions?: Reactions;
}

export interface NotificationThread {
  id: string;
  unread: boolean;
  reason: string;
  updated_at: string;
  subject: { title: string; url: string | null; latest_comment_url: string | null; type: string };
  repository: Repo;
}

export interface Branch {
  name: string;
  protected: boolean;
  commit: { sha: string };
}

export interface Release {
  id: number;
  tag_name: string;
  name: string | null;
  body?: string | null;
  body_html?: string;
  draft: boolean;
  prerelease: boolean;
  created_at: string;
  published_at: string | null;
  author: User | null;
  html_url: string;
  target_commitish: string;
  assets: { id: number; name: string; size: number; download_count: number; browser_download_url: string }[];
}

export interface Gist {
  id: string;
  description: string | null;
  public: boolean;
  owner?: User;
  html_url: string;
  created_at: string;
  updated_at: string;
  comments: number;
  files: Record<string, { filename: string; language: string | null; size: number; raw_url: string; content?: string; truncated?: boolean }>;
}
