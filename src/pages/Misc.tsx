import {
  BellSlashIcon,
  CheckIcon,
  CommentDiscussionIcon,
  DotFillIcon,
  FileIcon,
  GitBranchIcon,
  GitCommitIcon,
  GitPullRequestIcon,
  IssueOpenedIcon,
  KebabHorizontalIcon,
  PackageIcon,
  StopIcon,
  TagIcon,
  TrashIcon,
  XIcon,
} from '@primer/octicons-react';
import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { MarkdownEditor } from '../components/Editor';
import { Logo } from '../components/Shell';
import { Avatar, CopyButton, CopyMenuItem, Dropdown, Empty, ErrorBox, Field, ListState, Loading, LoadMore, Markdown, RepoRow, Segmented, Time, UserLink } from '../components/ui';
import { invoke } from '@tauri-apps/api/core';
import { ACCEPT, gh, invalidate, isTauri, useGh, useGhPages, useGql } from '../lib/api';
import type { DeviceCode, SignInApi } from '../lib/auth';
import { confirmDialog, promptDialog, useAction, useDraft } from '../lib/feedback';
import type { Branch, Issue, NotificationThread, Release, Repo, User } from '../lib/types';
import { compact, formatBytes, openExternal, plural, routeFromUrl } from '../lib/util';
import { IssueRow, QueryBox } from './Issues';
import { useRepo } from './Repo';

export function Branches() {
  const { repo } = useRepo();
  const api = `/repos/${repo.full_name}`;
  const q = useGhPages<Branch>(`${api}/branches?per_page=50`);
  const [name, setName] = useState('');
  const [from, setFrom] = useState(repo.default_branch);
  const [filter, setFilter] = useState('');
  const { busy, run } = useAction();
  const canPush = !!repo.permissions?.push;
  const create = () =>
    run(async () => {
      const head = await gh<{ sha: string }>(`${api}/commits/${encodeURIComponent(from)}`);
      await gh(`${api}/git/refs`, { method: 'POST', body: { ref: `refs/heads/${name.trim()}`, sha: head.sha } });
      setName('');
      await invalidate(`${api}/branches`);
    }, `Created ${name.trim()}`);
  const remove = async (b: Branch) => {
    if (!(await confirmDialog({ title: `Delete ${b.name}?`, body: 'Commits only on this branch become unreachable.', confirmLabel: 'Delete branch', danger: true }))) return;
    void run(async () => (await gh(`${api}/git/refs/heads/${b.name.split('/').map(encodeURIComponent).join('/')}`, { method: 'DELETE' }), await invalidate(`${api}/branches`)), `Deleted ${b.name}`);
  };
  const rename = async (b: Branch) => {
    const to = await promptDialog({ title: `Rename ${b.name}`, label: 'New name', initial: b.name, confirmLabel: 'Rename' });
    if (!to || to === b.name) return;
    void run(async () => {
      await gh(`${api}/branches/${encodeURIComponent(b.name)}/rename`, { method: 'POST', body: { new_name: to } });
      await Promise.all([invalidate(`${api}/branches`), invalidate(api)]);
    }, `Renamed to ${to}`);
  };
  const makeDefault = async (b: Branch) => {
    if (!(await confirmDialog({ title: `Make ${b.name} the default branch?`, body: 'New pull requests and clones will use it.', confirmLabel: 'Change default' }))) return;
    void run(async () => (await gh(api, { method: 'PATCH', body: { default_branch: b.name } }), await invalidate(api)), `${b.name} is now the default`);
  };
  const shown = q.items.filter((b) => b.name.toLowerCase().includes(filter.toLowerCase()));
  return (
    <div className="stack">
      <div className="toolbar">
        <input className="input name-input" placeholder="Filter branches…" value={filter} onChange={(e) => setFilter(e.target.value)} aria-label="Filter branches" />
        <span className="spacer" />
        {canPush && (
          <Dropdown align="right" className="btn primary" trigger="New branch">
            {() => (
              <form
                className="menu wide pad"
                onSubmit={(e) => {
                  e.preventDefault();
                  void create();
                }}
              >
                <Field label="Branch name">
                  <input className="input" autoFocus value={name} onChange={(e) => setName(e.target.value)} />
                </Field>
                <Field label="From branch, tag or commit">
                  <input className="input" value={from} onChange={(e) => setFrom(e.target.value)} />
                </Field>
                <button className="btn primary" disabled={busy || !name.trim() || !from.trim()}>
                  Create branch
                </button>
              </form>
            )}
          </Dropdown>
        )}
      </div>
      <div className="card">
        <ListState q={q} count={shown.length} empty="No branches match" />
        {shown.map((b) => (
          <div key={b.name} className="row compact">
            <span className="state-icon">
              <GitBranchIcon />
            </span>
            <div className="row-main">
              <div className="row-title">
                <Link to={`/${repo.full_name}/tree/${b.name}`}>{b.name}</Link>
                {b.name === repo.default_branch && <span className="badge">Default</span>}
                {b.protected && <span className="badge">Protected</span>}
              </div>
            </div>
            <Link className="row-side" to={`/${repo.full_name}/commits/${b.name}`}>
              <code>{b.commit.sha.slice(0, 7)}</code>
            </Link>
            {b.name !== repo.default_branch && (
              <Link className="btn sm" to={`/${repo.full_name}/compare/${repo.default_branch}...${b.name}`}>
                Compare
              </Link>
            )}
            {canPush && b.name !== repo.default_branch && !b.protected && (
              <button className="icon-btn" title="Delete branch" aria-label={`Delete ${b.name}`} disabled={busy} onClick={() => remove(b)}>
                <TrashIcon />
              </button>
            )}
            {canPush && (
              <Dropdown align="right" className="icon-btn" title="More" trigger={<KebabHorizontalIcon />}>
                {(close) => (
                  <div className="menu" onClick={close}>
                    <button onClick={() => rename(b)}>Rename</button>
                    {repo.permissions?.admin && b.name !== repo.default_branch && <button onClick={() => makeDefault(b)}>Make default</button>}
                    <CopyMenuItem text={b.name} label="Copy name" />
                  </div>
                )}
              </Dropdown>
            )}
          </div>
        ))}
      </div>
      <LoadMore q={q} />
    </div>
  );
}

function ReleaseNav({ at }: { at: 'releases' | 'tags' }) {
  const { repo } = useRepo();
  return (
    <div className="toolbar">
      <div className="segmented">
        <Link to={`/${repo.full_name}/releases`} className={at === 'releases' ? 'on' : ''}>
          Releases
        </Link>
        <Link to={`/${repo.full_name}/tags`} className={at === 'tags' ? 'on' : ''}>
          Tags
        </Link>
      </div>
      <span className="spacer" />
      {repo.permissions?.push && (
        <Link className="btn primary" to={`/${repo.full_name}/releases/new`}>
          Draft a new release
        </Link>
      )}
    </div>
  );
}

// ref path with each segment encoded
const refPath = (name: string) => name.split('/').map(encodeURIComponent).join('/');

export function Tags() {
  const { repo } = useRepo();
  const api = `/repos/${repo.full_name}`;
  const q = useGhPages<{ name: string; commit: { sha: string }; zipball_url: string }>(`${api}/tags?per_page=50`);
  const [filter, setFilter] = useState('');
  const [name, setName] = useState('');
  const [from, setFrom] = useState(repo.default_branch);
  const [message, setMessage] = useState('');
  const { busy, run } = useAction();
  const canPush = !!repo.permissions?.push;
  const create = () =>
    run(async () => {
      const tag = name.trim();
      const head = await gh<{ sha: string }>(`${api}/commits/${encodeURIComponent(from.trim())}`);
      let sha = head.sha;
      // a message makes an annotated tag object
      if (message.trim()) sha = (await gh<{ sha: string }>(`${api}/git/tags`, { method: 'POST', body: { tag, message, object: head.sha, type: 'commit' } })).sha;
      await gh(`${api}/git/refs`, { method: 'POST', body: { ref: `refs/tags/${tag}`, sha } });
      setName('');
      setMessage('');
      await invalidate(`${api}/tags`);
    }, `Created ${name.trim()}`);
  const remove = async (tag: string) => {
    if (!(await confirmDialog({ title: `Delete tag ${tag}?`, body: 'A release on this tag turns into a draft.', confirmLabel: 'Delete tag', danger: true }))) return;
    void run(async () => (await gh(`${api}/git/refs/tags/${refPath(tag)}`, { method: 'DELETE' }), await invalidate(`${api}/tags`), await invalidate(`${api}/releases`)), `Deleted ${tag}`);
  };
  const shown = q.items.filter((t) => t.name.toLowerCase().includes(filter.toLowerCase()));
  return (
    <div className="stack">
      <ReleaseNav at="tags" />
      <div className="toolbar">
        <input className="input name-input" placeholder="Filter tags…" value={filter} onChange={(e) => setFilter(e.target.value)} aria-label="Filter tags" />
        <span className="spacer" />
        {canPush && (
          <Dropdown align="right" className="btn" trigger="New tag">
            {() => (
              <form
                className="menu wide pad"
                onSubmit={(e) => {
                  e.preventDefault();
                  void create();
                }}
              >
                <Field label="Tag name">
                  <input className="input" autoFocus placeholder="v1.0.0" value={name} onChange={(e) => setName(e.target.value)} />
                </Field>
                <Field label="From branch, tag or commit">
                  <input className="input" value={from} onChange={(e) => setFrom(e.target.value)} />
                </Field>
                <Field label="Message" hint="Leave empty for a lightweight tag.">
                  <textarea className="input" rows={3} value={message} onChange={(e) => setMessage(e.target.value)} />
                </Field>
                <button className="btn primary" disabled={busy || !name.trim() || !from.trim()}>
                  Create tag
                </button>
              </form>
            )}
          </Dropdown>
        )}
      </div>
      <div className="card">
        <ListState q={q} count={shown.length} empty={filter ? 'No tags match' : 'No tags'} />
        {shown.map((t) => (
          <div key={t.name} className="row compact">
            <span className="state-icon">
              <TagIcon />
            </span>
            <div className="row-main">
              <Link className="row-link" to={`/${repo.full_name}/tree/${t.name}`}>
                {t.name}
              </Link>
            </div>
            <Link className="row-side mono" to={`/${repo.full_name}/commit/${t.commit.sha}`}>
              {t.commit.sha.slice(0, 7)}
            </Link>
            <Link className="btn sm" to={`/${repo.full_name}/releases/tag/${t.name}`}>
              Release
            </Link>
            <a className="btn sm" href={`${repo.html_url}/archive/refs/tags/${t.name}.zip`} data-external>
              zip
            </a>
            {canPush && (
              <button className="icon-btn" title="Delete tag" aria-label={`Delete ${t.name}`} disabled={busy} onClick={() => remove(t.name)}>
                <TrashIcon />
              </button>
            )}
          </div>
        ))}
      </div>
      <LoadMore q={q} />
    </div>
  );
}

function ReleaseCard({ r, latest }: { r: Release; latest: boolean }) {
  const { repo } = useRepo();
  const navigate = useNavigate();
  const { busy, run } = useAction();
  const api = `/repos/${repo.full_name}/releases`;
  const canEdit = !!repo.permissions?.push;
  return (
    <article className="card release">
      <div className="card-head">
        <TagIcon />
        <Link to={`/${repo.full_name}/tree/${r.tag_name}`} className="mono">
          {r.tag_name}
        </Link>
        {latest && <span className="badge ok">Latest</span>}
        {r.prerelease && <span className="badge">Pre-release</span>}
        {r.draft && <span className="badge">Draft</span>}
        <span className="spacer" />
        <span className="muted small">
          {r.author?.login} released <Time iso={r.published_at ?? r.created_at} />
        </span>
        {repo.permissions?.push && (
          <>
            <Link className="btn sm" to={`/${repo.full_name}/releases/edit/${r.id}`}>
              Edit
            </Link>
            <button
              className="icon-btn sm"
              title="Delete release"
              aria-label="Delete release"
              disabled={busy}
              onClick={async () => {
                if (!(await confirmDialog({ title: `Delete ${r.name || r.tag_name}?`, body: 'The tag is kept.', confirmLabel: 'Delete release', danger: true }))) return;
                await run(async () => (await gh(`${api}/${r.id}`, { method: 'DELETE' }), await invalidate(api)), 'Release deleted');
                navigate(`/${repo.full_name}/releases`);
              }}
            >
              <TrashIcon />
            </button>
          </>
        )}
      </div>
      <div className="pad-lg">
        <h2>
          <Link to={`/${repo.full_name}/releases/tag/${r.tag_name}`}>{r.name || r.tag_name}</Link>
        </h2>
        {r.body_html ? <Markdown html={r.body_html} /> : r.body ? <pre className="commit-body">{r.body}</pre> : null}
        <div className="assets">
          <h4>Assets</h4>
          {r.assets.map((a) => (
            <div key={a.id} className="asset">
              <a href={a.browser_download_url} data-external className="asset-link">
                <PackageIcon size={14} /> {a.name}
              </a>
              <span className="spacer" />
              <span className="muted small">
                {compact(a.download_count)} downloads · {formatBytes(a.size)}
              </span>
              {canEdit && (
                <Dropdown align="right" className="icon-btn sm" title="Asset actions" trigger={<KebabHorizontalIcon size={14} />}>
                  {(close) => (
                    <div className="menu" onClick={close}>
                      <button
                        onClick={async () => {
                          const name = await promptDialog({ title: 'Rename asset', label: 'File name', initial: a.name, confirmLabel: 'Rename' });
                          if (name && name !== a.name) void run(async () => (await gh(`${api}/assets/${a.id}`, { method: 'PATCH', body: { name } }), await invalidate(api)), 'Renamed');
                        }}
                      >
                        Rename
                      </button>
                      <button
                        onClick={async () => {
                          if (await confirmDialog({ title: `Delete ${a.name}?`, confirmLabel: 'Delete', danger: true }))
                            void run(async () => (await gh(`${api}/assets/${a.id}`, { method: 'DELETE' }), await invalidate(api)), 'Asset deleted');
                        }}
                      >
                        Delete
                      </button>
                    </div>
                  )}
                </Dropdown>
              )}
            </div>
          ))}
          {canEdit && isTauri && (
            <button
              className="btn sm asset-add"
              disabled={busy}
              onClick={() => run(async () => (await invoke('upload_release_asset', { repo: repo.full_name, release: r.id })) && (await invalidate(api)), undefined)}
            >
              {busy ? 'Uploading…' : 'Attach a file'}
            </button>
          )}
          {!r.draft &&
            ['zip', 'tar.gz'].map((ext) => (
              <a key={ext} href={`${repo.html_url}/archive/refs/tags/${r.tag_name}.${ext}`} data-external className="asset">
                <FileIcon size={14} /> Source code ({ext})
              </a>
            ))}
        </div>
      </div>
    </article>
  );
}

export function Releases() {
  const { repo } = useRepo();
  const q = useGhPages<Release>(`/repos/${repo.full_name}/releases?per_page=10`, { accept: ACCEPT.full });
  const latestId = q.items.find((r) => !r.prerelease && !r.draft)?.id;
  return (
    <div className="stack">
      <ReleaseNav at="releases" />
      <ListState q={q} count={q.items.length} empty="No releases published" />
      {q.items.map((r) => (
        <ReleaseCard key={r.id} r={r} latest={r.id === latestId} />
      ))}
      <LoadMore q={q} />
    </div>
  );
}

export function ReleaseByTag() {
  const { repo } = useRepo();
  const tag = useParams()['*'] ?? '';
  const q = useGh<Release>(`/repos/${repo.full_name}/releases/tags/${encodeURIComponent(tag)}`, { accept: ACCEPT.full });
  return (
    <div className="stack">
      <ReleaseNav at="releases" />
      {q.isLoading && <Loading />}
      {q.error &&
        (q.error.status === 404 ? (
          <Empty title={`No release for ${tag}`}>
            <Link to={`/${repo.full_name}/releases/new?tag=${encodeURIComponent(tag)}`}>Create one from this tag</Link>
          </Empty>
        ) : (
          <ErrorBox error={q.error} />
        ))}
      {q.data && <ReleaseCard r={q.data} latest={false} />}
    </div>
  );
}

// create a release, or edit one when the route has an id
export function ReleaseForm() {
  const { repo } = useRepo();
  const { id } = useParams();
  const [sp] = useSearchParams();
  const navigate = useNavigate();
  const api = `/repos/${repo.full_name}/releases`;
  const existing = useGh<Release>(id && `${api}/${id}`);
  const [tag, setTag] = useState(sp.get('tag') ?? '');
  const [target, setTarget] = useState(repo.default_branch);
  const [name, setName] = useState('');
  const [body, setBody, clearBody] = useDraft(`release:${repo.full_name}:${id ?? 'new'}`);
  const [prerelease, setPre] = useState(false);
  const [latest, setLatest] = useState<'true' | 'false' | 'legacy'>('legacy');
  const [category, setCategory] = useState('');
  const categories = useGql<any>('discussion-categories', 'query($o: String!, $n: String!) { repository(owner: $o, name: $n) { discussionCategories(first: 25) { nodes { name } } } }', { o: repo.owner.login, n: repo.name }, !!repo.has_discussions && !id);
  const categoryNames: string[] = categories.data?.repository?.discussionCategories?.nodes.map((c: { name: string }) => c.name) ?? [];
  const { busy, run } = useAction();
  useEffect(() => {
    const r = existing.data;
    if (!r) return;
    setTag(r.tag_name);
    setTarget(r.target_commitish);
    setName(r.name ?? '');
    setPre(r.prerelease);
    if (!body) setBody(r.body ?? '');
  }, [existing.data]);
  if (!repo.permissions?.push) return <Empty title="You can't publish releases here" />;
  if (id && existing.isLoading) return <Loading />;

  const save = (draft: boolean) =>
    run(async () => {
      const payload = { tag_name: tag.trim(), target_commitish: target.trim(), name, body, draft, prerelease, make_latest: prerelease ? 'false' : latest, ...(category && !id ? { discussion_category_name: category } : {}) };
      const saved = await gh<Release>(id ? `${api}/${id}` : api, { method: id ? 'PATCH' : 'POST', body: payload });
      clearBody();
      await invalidate(api);
      navigate(draft ? `/${repo.full_name}/releases` : `/${repo.full_name}/releases/tag/${saved.tag_name}`, { replace: true });
    }, draft ? 'Draft saved' : 'Release published');
  const generate = () =>
    run(async () => {
      const notes = await gh<{ name: string; body: string }>(`${api}/generate-notes`, { method: 'POST', body: { tag_name: tag.trim(), target_commitish: target.trim() } });
      setBody(notes.body);
      if (!name) setName(notes.name);
    });

  return (
    <div className="stack narrow-form">
      <h2 className="title">{id ? 'Edit release' : 'New release'}</h2>
      <div className="split">
        <Field label="Tag" hint="Created on publish if it doesn't exist yet.">
          <input className="input" autoFocus={!id} placeholder="v1.0.0" value={tag} onChange={(e) => setTag(e.target.value)} />
        </Field>
        <Field label="Target branch or commit">
          <input className="input" value={target} onChange={(e) => setTarget(e.target.value)} />
        </Field>
      </div>
      <Field label="Title">
        <input className="input" placeholder={tag} value={name} onChange={(e) => setName(e.target.value)} />
      </Field>
      <MarkdownEditor value={body} onChange={setBody} context={repo.full_name} placeholder="Describe this release." rows={12} />
      <div className="form-foot">
        <button className="btn" disabled={busy || !tag.trim()} onClick={generate}>
          Generate release notes
        </button>
        <label className="check-row">
          <input type="checkbox" checked={prerelease} onChange={(e) => setPre(e.target.checked)} /> Pre-release
        </label>
        {!prerelease && (
          <select className="input select" value={latest} onChange={(e) => setLatest(e.target.value as typeof latest)} aria-label="Latest release">
            <option value="legacy">Latest by date and version</option>
            <option value="true">Mark as latest</option>
            <option value="false">Don't mark as latest</option>
          </select>
        )}
        {categoryNames.length > 0 && (
          <select className="input select" value={category} onChange={(e) => setCategory(e.target.value)} aria-label="Start a discussion">
            <option value="">No discussion</option>
            {categoryNames.map((c) => (
              <option key={c} value={c}>
                Discuss in {c}
              </option>
            ))}
          </select>
        )}
        <span className="spacer" />
        <button className="btn" disabled={busy || !tag.trim()} onClick={() => save(true)}>
          Save draft
        </button>
        <button className="btn primary" disabled={busy || !tag.trim()} onClick={() => save(false)}>
          {id && !existing.data?.draft ? 'Update release' : 'Publish release'}
        </button>
      </div>
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

const REASONS: Record<string, string> = {
  '': 'Everything',
  review_requested: 'Review requested',
  mention: 'Mentions',
  assign: 'Assigned',
  author: 'Yours',
  team_mention: 'Team mentions',
  ci_activity: 'CI',
};

export function Notifications() {
  const navigate = useNavigate();
  const [sp, setSp] = useSearchParams();
  const all = sp.get('all') === '1';
  const reason = sp.get('reason') ?? '';
  const q = useGhPages<NotificationThread>(`/notifications?all=${all}&per_page=50${sp.get('participating') ? '&participating=true' : ''}`);
  const { run } = useAction();
  const refresh = () => invalidate('/notifications');
  const set = (key: string, value: string) => {
    const next = new URLSearchParams(sp);
    if (value) next.set(key, value);
    else next.delete(key);
    setSp(next);
  };
  const act = (fn: () => Promise<unknown>, done?: string) => run(async () => (await fn(), await refresh()), done);
  const markRead = (id: string) => act(() => gh(`/notifications/threads/${id}`, { method: 'PATCH' }));
  const open = (n: NotificationThread) => {
    if (n.unread) void markRead(n.id);
    const route = n.subject.url && routeFromUrl(n.subject.url);
    if (route) navigate(route);
    else if (n.subject.type === 'Release') navigate(`/${n.repository.full_name}/releases`);
    else if (n.subject.type === 'Discussion') navigate(`/${n.repository.full_name}/discussions`);
    else if (n.subject.type === 'CheckSuite') navigate(`/${n.repository.full_name}/actions`);
    else navigate(`/${n.repository.full_name}`);
  };

  const items = reason ? q.items.filter((n) => n.reason === reason) : q.items;
  const groups = new Map<string, NotificationThread[]>();
  for (const n of items) groups.set(n.repository.full_name, [...(groups.get(n.repository.full_name) ?? []), n]);

  return (
    <div className="page narrow">
      <header className="page-head">
        <h1>Inbox</h1>
      </header>
      <div className="toolbar">
        <Segmented
          value={all ? 'all' : 'unread'}
          onChange={(v) => set('all', v === 'all' ? '1' : '')}
          options={[
            { value: 'unread', label: 'Unread' },
            { value: 'all', label: 'All' },
          ]}
        />
        <select className="input select" value={reason} onChange={(e) => set('reason', e.target.value)} aria-label="Reason">
          {Object.entries(REASONS).map(([k, label]) => (
            <option key={k} value={k}>
              {label}
            </option>
          ))}
        </select>
        <label className="check-row">
          <input type="checkbox" checked={!!sp.get('participating')} onChange={(e) => set('participating', e.target.checked ? '1' : '')} /> Participating
        </label>
        <span className="spacer" />
        <button className="btn" disabled={!q.items.some((n) => n.unread)} onClick={() => act(() => gh('/notifications', { method: 'PUT', body: { read: true } }), 'All marked as read')}>
          <CheckIcon /> Mark all as read
        </button>
      </div>
      {!q.isLoading && !q.error && items.length === 0 ? (
        <div className="card">
          <Empty title="All caught up" icon={<CheckIcon size={22} />}>
            No {all ? '' : 'unread '}notifications{reason ? ' for this filter' : ''}. New ones show up here and as desktop notifications.
          </Empty>
        </div>
      ) : (
        <ListState q={q} count={items.length} empty="" />
      )}
      {[...groups].map(([repo, list]) => (
        <section key={repo}>
          <div className="group-head">
            <Link to={`/${repo}`} className="group-title">
              {repo}
            </Link>
            {list.some((n) => n.unread) && (
              <button className="link-btn small" onClick={() => act(() => gh(`/repos/${repo}/notifications`, { method: 'PUT', body: {} }))}>
                Mark {plural(list.filter((n) => n.unread).length, 'notification')} as read
              </button>
            )}
          </div>
          <div className="card">
            {list.map((n) => {
              const Icon = SUBJECT_ICON[n.subject.type] ?? DotFillIcon;
              const stop = (fn: () => unknown) => (e: React.MouseEvent) => {
                e.stopPropagation();
                fn();
              };
              return (
                <div key={n.id} className={`row notif ${n.unread ? 'unread' : ''}`} onClick={() => open(n)}>
                  <span className="state-icon">
                    <Icon />
                  </span>
                  <div className="row-main">
                    <button className="row-title link-btn" onClick={stop(() => open(n))}>
                      {n.unread && <span className="unread-dot" aria-label="Unread" />}
                      {n.subject.title}
                    </button>
                    <div className="meta">
                      {n.reason.replace(/_/g, ' ')} · <Time iso={n.updated_at} />
                    </div>
                  </div>
                  <button className="icon-btn" title="Unsubscribe from this thread" aria-label="Unsubscribe" onClick={stop(() => act(() => gh(`/notifications/threads/${n.id}/subscription`, { method: 'PUT', body: { ignored: true } }).then(() => gh(`/notifications/threads/${n.id}`, { method: 'DELETE' })), 'Unsubscribed'))}>
                    <BellSlashIcon />
                  </button>
                  <button className="icon-btn" title="Done: remove from inbox" aria-label="Done" onClick={stop(() => act(() => gh(`/notifications/threads/${n.id}`, { method: 'DELETE' })))}>
                    <XIcon />
                  </button>
                  {n.unread && (
                    <button className="icon-btn" title="Mark as read" aria-label="Mark as read" onClick={stop(() => markRead(n.id))}>
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

interface CodeHit {
  sha: string;
  path: string;
  html_url: string;
  repository: Repo;
  text_matches?: { fragment: string }[];
}

export function CodeResults({ query }: { query: string }) {
  const q = useGhPages<CodeHit>(query && `/search/code?q=${encodeURIComponent(query)}&per_page=30`, { pick: (d) => d.items, accept: 'application/vnd.github.text-match+json' });
  return (
    <>
      {q.total != null && <p className="muted small">{plural(q.total, 'result')}</p>}
      <ListState q={q} count={query ? q.items.length : 1} empty="No code matches" />
      {q.items.map((it) => (
        <div key={it.sha + it.repository.full_name + it.path} className="card">
          <div className="card-head">
            <FileIcon />
            <Link to={`/${it.repository.full_name}`} className="muted">
              {it.repository.full_name}
            </Link>
            <Link to={`/${it.repository.full_name}/blob/${it.repository.default_branch ?? 'HEAD'}/${it.path}`} className="strong mono small">
              {it.path}
            </Link>
          </div>
          {it.text_matches?.slice(0, 2).map((m, i) => (
            <pre key={i} className="snippet">
              {m.fragment}
            </pre>
          ))}
        </div>
      ))}
      <LoadMore q={q} />
    </>
  );
}

// code search scoped to one repository
export function RepoSearch() {
  const { repo } = useRepo();
  const [sp] = useSearchParams();
  const query = sp.get('q') ?? '';
  return (
    <div className="stack">
      <div className="toolbar">
        <QueryBox placeholder={`Search code in ${repo.name}`} />
      </div>
      {query ? <CodeResults query={`${query} repo:${repo.full_name}`} /> : <Empty title="Search this repository">Type a term and press Enter.</Empty>}
    </div>
  );
}

type SearchType = 'repositories' | 'code' | 'issues' | 'pulls' | 'users' | 'commits' | 'topics';
const REPO_SORTS: Record<string, string> = { '': 'Best match', stars: 'Most stars', forks: 'Most forks', updated: 'Recently updated' };

export function Search() {
  const [sp, setSp] = useSearchParams();
  const query = sp.get('q') ?? '';
  const type = (sp.get('type') as SearchType) ?? 'repositories';
  const sort = sp.get('sort') ?? '';
  const enc = encodeURIComponent;
  const path = {
    repositories: `/search/repositories?q=${enc(query)}&per_page=30${sort ? `&sort=${sort}` : ''}`,
    issues: `/search/issues?q=${enc(query + ' is:issue')}&per_page=30`,
    pulls: `/search/issues?q=${enc(query + ' is:pr')}&per_page=30`,
    users: `/search/users?q=${enc(query)}&per_page=30`,
    commits: `/search/commits?q=${enc(query)}&per_page=30`,
    topics: `/search/topics?q=${enc(query)}&per_page=30`,
    code: null,
  }[type];
  const q = useGhPages<any>(query && path, { pick: (d) => d.items });

  return (
    <div className="page narrow">
      <header className="page-head">
        <h1>{query ? `“${query}”` : 'Search'}</h1>
        {type !== 'code' && q.total != null && <p className="muted">{plural(q.total, 'result')}</p>}
      </header>
      <div className="toolbar">
        <QueryBox placeholder="Search GitHub" />
      </div>
      <div className="toolbar">
        <Segmented
          value={type}
          onChange={(t) => setSp({ q: query, type: t })}
          options={[
            { value: 'repositories', label: 'Repositories' },
            { value: 'code', label: 'Code' },
            { value: 'issues', label: 'Issues' },
            { value: 'pulls', label: 'Pull requests' },
            { value: 'commits', label: 'Commits' },
            { value: 'users', label: 'Users' },
            { value: 'topics', label: 'Topics' },
          ]}
        />
        <span className="spacer" />
        {type === 'repositories' && (
          <select className="input select" value={sort} onChange={(e) => setSp({ q: query, type, ...(e.target.value ? { sort: e.target.value } : {}) })} aria-label="Sort">
            {Object.entries(REPO_SORTS).map(([k, label]) => (
              <option key={k} value={k}>
                {label}
              </option>
            ))}
          </select>
        )}
      </div>
      {!query ? (
        <Empty title="Search GitHub">Type what you're looking for. Qualifiers like language:rust or stars:&gt;100 work.</Empty>
      ) : type === 'code' ? (
        <CodeResults query={query} />
      ) : (
        <>
          <ListState q={q} count={q.items.length} empty="No results" />
          {q.items.length > 0 && (
            <div className="card">
              {q.items.map((it) =>
                type === 'repositories' ? (
                  <RepoRow key={it.id} repo={it} showOwner />
                ) : type === 'users' ? (
                  <div key={it.id} className="row">
                    <Avatar user={it as User} size={32} />
                    <div className="row-main">
                      <UserLink user={it} />
                      <div className="meta">{it.type}</div>
                    </div>
                  </div>
                ) : type === 'commits' ? (
                  <div key={it.sha} className="row">
                    <span className="state-icon">
                      <GitCommitIcon />
                    </span>
                    <div className="row-main">
                      <Link className="row-link" to={`/${it.repository.full_name}/commit/${it.sha}`}>
                        {it.commit.message.split('\n')[0]}
                      </Link>
                      <div className="meta">
                        <Link to={`/${it.repository.full_name}`}>{it.repository.full_name}</Link>
                        <span>
                          {it.author?.login ?? it.commit.author.name} · <Time iso={it.commit.author.date} />
                        </span>
                      </div>
                    </div>
                  </div>
                ) : type === 'topics' ? (
                  <div key={it.name} className="row">
                    <div className="row-main">
                      <Link className="row-link" to={`/search?q=${enc('topic:' + it.name)}`}>
                        {it.display_name || it.name}
                      </Link>
                      {it.short_description && <p className="row-desc">{it.short_description}</p>}
                    </div>
                  </div>
                ) : (
                  <IssueRow key={it.id} item={it as Issue} showRepo />
                ),
              )}
            </div>
          )}
          <LoadMore q={q} />
        </>
      )}
    </div>
  );
}

const tokenUrl = (host: string) => `https://${host}/settings/tokens/new?scopes=repo,read:org,notifications,gist,user,workflow,project&description=Gittern`;

function DeviceFlow({ api }: { api: SignInApi }) {
  const [code, setCode] = useState<DeviceCode | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    if (!code) return;
    let stop = false;
    const tick = async () => {
      try {
        if (stop || (await api.devicePoll(code.device_code))) return;
        timer = setTimeout(tick, (code.interval + 1) * 1000);
      } catch (e) {
        setError(String(e));
        setCode(null);
      }
    };
    let timer = setTimeout(tick, code.interval * 1000);
    return () => {
      stop = true;
      clearTimeout(timer);
    };
  }, [code]);
  const start = async () => {
    setError('');
    try {
      const c = await api.deviceStart();
      setCode(c);
      openExternal(c.verification_uri);
    } catch (e) {
      setError(String(e));
    }
  };
  if (!code)
    return (
      <>
        <button type="button" className="btn primary block" onClick={start}>
          Sign in with your browser
        </button>
        {error && <p className="small">{error}</p>}
      </>
    );
  return (
    <div className="device-code">
      <span className="muted small">Enter this code at {code.verification_uri.replace('https://', '')}</span>
      <strong>{code.user_code}</strong>
      <CopyButton text={code.user_code} label="Copy code" />
      <span className="muted small">
        <span className="spinner" /> Waiting for you to approve…
      </span>
    </div>
  );
}

export function Login({ api, error }: { api: SignInApi; error?: string }) {
  const [token, setToken] = useState('');
  const [host, setHost] = useState(api.host === 'github.com' ? '' : api.host);
  const [enterprise, setEnterprise] = useState(api.host !== 'github.com');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState(error ?? '');
  const attempt = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setMessage('');
    try {
      await fn();
    } catch (err) {
      setMessage(String(err));
    } finally {
      setBusy(false);
    }
  };
  const effectiveHost = (enterprise && host.trim()) || 'github.com';
  const [manual, setManual] = useState(false);
  const browserFirst = api.deviceFlow && !manual && !enterprise;
  return (
    <div className="login">
      <form
        className="card login-card"
        onSubmit={(e) => {
          e.preventDefault();
          void attempt(() => api.withToken(token, enterprise ? host : undefined));
        }}
      >
        <Logo size={56} />
        <h1>Sign in to Gittern</h1>
        {isTauri ? (
          <>
            {browserFirst && (
              <>
                <p className="muted">Approve Gittern in your browser and you're in. Nothing to copy or configure.</p>
                <DeviceFlow api={api} />
                <button type="button" className="btn block" disabled={busy} onClick={() => attempt(api.withAmbient)}>
                  Use my GitHub CLI session
                </button>
                <button type="button" className="link-btn small" onClick={() => setManual(true)}>
                  Use a token or GitHub Enterprise instead
                </button>
              </>
            )}
            {!browserFirst && (
              <>
                <p className="muted">Paste a personal access token. It's stored in your system keyring and only ever sent to {effectiveHost}.</p>
                {enterprise && <input className="input" placeholder="github.example.com" value={host} onChange={(e) => setHost(e.target.value)} aria-label="GitHub Enterprise host" />}
                <input className="input" type="password" autoFocus placeholder="ghp_… or github_pat_…" value={token} onChange={(e) => setToken(e.target.value)} aria-label="Personal access token" />
                <button className="btn primary block" disabled={!token.trim() || busy || (enterprise && !host.trim())}>
                  {busy ? 'Checking…' : 'Sign in'}
                </button>
                <button type="button" className="btn block" disabled={busy} onClick={() => attempt(api.withAmbient)}>
                  Use my GitHub CLI session
                </button>
                {/* the global link handler lives in the signed-in shell, so these open by hand */}
                <button type="button" className="link-btn small" onClick={() => openExternal(tokenUrl(effectiveHost))}>
                  Create a token on {effectiveHost} →
                </button>
                <button type="button" className="link-btn small" onClick={() => setEnterprise((v) => !v)}>
                  {enterprise ? 'Use github.com instead' : 'Use GitHub Enterprise Server'}
                </button>
                {api.deviceFlow && (
                  <button type="button" className="link-btn small" onClick={() => (setManual(false), setEnterprise(false))}>
                    Sign in with your browser instead
                  </button>
                )}
              </>
            )}
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
