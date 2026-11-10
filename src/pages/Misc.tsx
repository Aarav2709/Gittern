import {
  CheckCircleFillIcon,
  CheckIcon,
  CommentDiscussionIcon,
  DotFillIcon,
  GitBranchIcon,
  GitCommitIcon,
  GitPullRequestIcon,
  IssueOpenedIcon,
  PackageIcon,
  SkipIcon,
  StopIcon,
  TagIcon,
  XCircleFillIcon,
} from '@primer/octicons-react';
import { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { Logo } from '../components/Shell';
import { Avatar, Empty, ErrorBox, Loading, LoadMore, Markdown, RepoRow, Segmented, Time, UserLink } from '../components/ui';
import { ACCEPT, gh, invalidate, isTauri, useGhPages } from '../lib/api';
import { formatBytes, openExternal, routeFromUrl } from '../lib/util';
import { IssueRow } from './Issues';
import { useRepo } from './Repo';

function RunIcon({ run }: { run: any }) {
  if (run.status !== 'completed') return <DotFillIcon className="s-pending" />;
  switch (run.conclusion) {
    case 'success':
      return <CheckCircleFillIcon className="s-open" />;
    case 'failure':
    case 'timed_out':
    case 'startup_failure':
      return <XCircleFillIcon className="s-closed" />;
    case 'cancelled':
      return <StopIcon className="s-draft" />;
    default:
      return <SkipIcon className="s-draft" />;
  }
}

export function Actions() {
  const { repo } = useRepo();
  const q = useGhPages<any>(`/repos/${repo.full_name}/actions/runs?per_page=30`, { pick: (d) => d.workflow_runs });
  return (
    <div className="stack narrow">
      <h2 className="section-title">
        Workflow runs {q.total != null && <span className="count">{q.total.toLocaleString()}</span>}
      </h2>
      {q.isLoading && <Loading />}
      {q.error && <ErrorBox error={q.error} />}
      {!q.isLoading && !q.error && q.items.length === 0 && <Empty title="No workflow runs yet" />}
      {q.items.length > 0 && (
        <div className="card list">
          {q.items.map((r) => (
            <div key={r.id} className="row issue-row">
              <span className="state-icon">
                <RunIcon run={r} />
              </span>
              <div className="row-main">
                <a href={r.html_url} className="issue-title" data-external>
                  {r.display_title}
                </a>
                <div className="meta">
                  <strong>{r.name}</strong> #{r.run_number} · {r.event} by {r.actor?.login} · <Time iso={r.created_at} />
                </div>
              </div>
              {r.head_branch && (
                <code className="ref">
                  <GitBranchIcon size={12} /> {r.head_branch}
                </code>
              )}
            </div>
          ))}
        </div>
      )}
      <LoadMore q={q} />
    </div>
  );
}

export function Releases() {
  const { repo } = useRepo();
  const q = useGhPages<any>(`/repos/${repo.full_name}/releases?per_page=10`, { accept: ACCEPT.full });
  const latestId = q.items.find((r) => !r.prerelease && !r.draft)?.id;
  return (
    <div className="stack narrow">
      {q.isLoading && <Loading />}
      {q.error && <ErrorBox error={q.error} />}
      {!q.isLoading && !q.error && q.items.length === 0 && <Empty title="No releases published" />}
      {q.items.map((r) => (
        <article key={r.id} className="card release">
          <div className="card-head">
            <TagIcon /> <code>{r.tag_name}</code>
            {r.id === latestId && <span className="badge ok">Latest</span>}
            {r.prerelease && <span className="badge warn">Pre-release</span>}
            {r.draft && <span className="badge">Draft</span>}
            <span className="spacer" />
            <span className="muted small">
              {r.author?.login} released <Time iso={r.published_at ?? r.created_at} />
            </span>
          </div>
          <div className="pad-lg">
            <h2>{r.name || r.tag_name}</h2>
            {r.body_html ? <Markdown html={r.body_html} /> : r.body ? <pre className="commit-body">{r.body}</pre> : null}
            {r.assets.length > 0 && (
              <div className="assets">
                <h4>Assets</h4>
                {r.assets.map((a: any) => (
                  <a key={a.id} href={a.browser_download_url} data-external className="asset">
                    <PackageIcon size={14} /> {a.name}
                    <span className="spacer" />
                    <span className="muted small">{formatBytes(a.size)}</span>
                  </a>
                ))}
              </div>
            )}
          </div>
        </article>
      ))}
      <LoadMore q={q} />
    </div>
  );
}

const SUBJECT_ICON: Record<string, typeof TagIcon> = {
  Issue: IssueOpenedIcon,
  PullRequest: GitPullRequestIcon,
  Release: TagIcon,
  Commit: GitCommitIcon,
  Discussion: CommentDiscussionIcon,
  CheckSuite: StopIcon,
};

export function Notifications() {
  const navigate = useNavigate();
  const [sp, setSp] = useSearchParams();
  const all = sp.get('all') === '1';
  const q = useGhPages<any>(`/notifications?all=${all}&per_page=50`);

  const markRead = async (id: string) => {
    await gh(`/notifications/threads/${id}`, { method: 'PATCH' });
    void invalidate('/notifications');
  };
  const open = (n: any) => {
    if (n.unread) void markRead(n.id);
    const route = n.subject.url && routeFromUrl(n.subject.url);
    if (route) navigate(route);
    else if (n.subject.type === 'Release') navigate(`/${n.repository.full_name}/releases`);
    else if (n.subject.type === 'Discussion') openExternal(`${n.repository.html_url}/discussions`);
    else navigate(`/${n.repository.full_name}`);
  };
  const markAll = async () => {
    await gh('/notifications', { method: 'PUT', body: { read: true } });
    void invalidate('/notifications');
  };

  const groups = new Map<string, any[]>();
  for (const n of q.items) groups.set(n.repository.full_name, [...(groups.get(n.repository.full_name) ?? []), n]);

  return (
    <div className="page narrow stack">
      <div className="toolbar">
        <h2 className="section-title">Notifications</h2>
        <span className="spacer" />
        <Segmented
          value={all ? 'all' : 'unread'}
          onChange={(v) => setSp(v === 'all' ? { all: '1' } : {})}
          options={[
            { value: 'unread', label: 'Unread' },
            { value: 'all', label: 'All' },
          ]}
        />
        <button className="btn" disabled={!q.items.some((n) => n.unread)} onClick={markAll}>
          <CheckIcon /> Mark all as read
        </button>
      </div>
      {q.isLoading && <Loading />}
      {q.error && <ErrorBox error={q.error} />}
      {!q.isLoading && !q.error && q.items.length === 0 && <Empty title="All caught up">No {all ? '' : 'unread '}notifications.</Empty>}
      {[...groups].map(([repo, items]) => (
        <section key={repo}>
          <Link to={`/${repo}`} className="group-title">
            {repo}
          </Link>
          <div className="card list">
            {items.map((n) => {
              const Icon = SUBJECT_ICON[n.subject.type] ?? DotFillIcon;
              return (
                <div key={n.id} className={`row issue-row notif ${n.unread ? 'unread' : ''}`} onClick={() => open(n)}>
                  <span className="state-icon">
                    <Icon />
                  </span>
                  <div className="row-main">
                    <span className="issue-title">{n.subject.title}</span>
                    <div className="meta">
                      {n.reason.replace(/_/g, ' ')} · <Time iso={n.updated_at} />
                    </div>
                  </div>
                  {n.unread && (
                    <button
                      className="icon-btn"
                      title="Mark as read"
                      onClick={(e) => {
                        e.stopPropagation();
                        void markRead(n.id);
                      }}
                    >
                      <CheckIcon />
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        </section>
      ))}
      <LoadMore q={q} />
    </div>
  );
}

const TOKEN_URL = 'https://github.com/settings/tokens/new?scopes=repo,read:org,notifications&description=Gittern';

type SearchType = 'repositories' | 'issues' | 'pulls' | 'users';

export function Search() {
  const [sp, setSp] = useSearchParams();
  const query = sp.get('q') ?? '';
  const type = (sp.get('type') as SearchType) ?? 'repositories';
  const enc = encodeURIComponent;
  const path = {
    repositories: `/search/repositories?q=${enc(query)}&per_page=30`,
    issues: `/search/issues?q=${enc(query + ' is:issue')}&per_page=30`,
    pulls: `/search/issues?q=${enc(query + ' is:pr')}&per_page=30`,
    users: `/search/users?q=${enc(query)}&per_page=30`,
  }[type];
  const q = useGhPages<any>(query && path, { pick: (d) => d.items });

  return (
    <div className="page narrow stack">
      <div className="toolbar">
        <h2 className="section-title">
          {q.total != null ? `${q.total.toLocaleString()} results for ` : 'Results for '}“{query}”
        </h2>
        <span className="spacer" />
        <Segmented
          value={type}
          onChange={(t) => setSp({ q: query, type: t })}
          options={[
            { value: 'repositories', label: 'Repositories' },
            { value: 'issues', label: 'Issues' },
            { value: 'pulls', label: 'Pull requests' },
            { value: 'users', label: 'Users' },
          ]}
        />
      </div>
      {!query && <Empty title="Search GitHub">Press Ctrl+K and type what you're looking for.</Empty>}
      {q.isLoading && <Loading />}
      {q.error && <ErrorBox error={q.error} />}
      {query && !q.isLoading && !q.error && q.items.length === 0 && <Empty title="No results" />}
      {q.items.length > 0 && (
        <div className="card list">
          {q.items.map((it) =>
            type === 'repositories' ? (
              <RepoRow key={it.id} repo={it} showOwner />
            ) : type === 'users' ? (
              <div key={it.id} className="row issue-row">
                <Avatar user={it} size={32} />
                <div className="row-main">
                  <UserLink user={it} />
                  <div className="meta">{it.type}</div>
                </div>
              </div>
            ) : (
              <IssueRow key={it.id} item={it} showRepo />
            ),
          )}
        </div>
      )}
      <LoadMore q={q} />
    </div>
  );
}

export function Login({ signIn, error }: { signIn: (token: string) => Promise<string | null>; error?: string }) {
  const [token, setToken] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState(error ?? '');
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setMessage('');
    try {
      await signIn(token);
    } catch (err) {
      setMessage(String(err));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="login">
      <form className="card login-card" onSubmit={submit}>
        <Logo size={56} />
        <h1>Sign in to Gittern</h1>
        {isTauri ? (
          <>
            <p className="muted">
              Paste a GitHub personal access token. It's stored in your system keyring and never leaves this machine
              except to talk to api.github.com.
            </p>
            <input
              className="input"
              type="password"
              autoFocus
              placeholder="ghp_… or github_pat_…"
              value={token}
              onChange={(e) => setToken(e.target.value)}
            />
            <button className="btn primary block" disabled={!token.trim() || busy}>
              {busy ? 'Checking…' : 'Sign in'}
            </button>
            <a
              className="small"
              href={TOKEN_URL}
              onClick={(e) => {
                // The global link handler lives in the signed-in shell, so route this one by hand.
                e.preventDefault();
                openExternal(TOKEN_URL);
              }}
            >
              Create a token on github.com →
            </a>
            <p className="muted small">
              Already use the GitHub CLI? Run <code>gh auth login</code> and restart — Gittern picks it up automatically.
            </p>
          </>
        ) : (
          <p className="muted">
            Browser preview: start the dev server with <code>VITE_GITHUB_TOKEN</code> set.
          </p>
        )}
        {message && <p className="del-text small">{message}</p>}
      </form>
    </div>
  );
}
