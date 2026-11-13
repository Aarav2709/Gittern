import {
  BookIcon,
  CommentDiscussionIcon,
  GraphIcon,
  ShieldIcon,
  TableIcon,
  CheckIcon,
  CodeIcon,
  DeviceDesktopIcon,
  CopyIcon,
  EyeIcon,
  FileDirectoryFillIcon,
  FileIcon,
  FileSubmoduleIcon,
  GearIcon,
  GitBranchIcon,
  GitCommitIcon,
  GitPullRequestIcon,
  HistoryIcon,
  IssueOpenedIcon,
  LawIcon,
  LinkIcon,
  PinIcon,
  PlusIcon,
  PlayIcon,
  RepoForkedIcon,
  SearchIcon,
  StarFillIcon,
  StarIcon,
  TagIcon,
  TriangleDownIcon,
} from '@primer/octicons-react';
import { useQuery } from '@tanstack/react-query';
import { type ReactNode, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Link, Navigate, Outlet, useLocation, useNavigate, useOutletContext, useParams } from 'react-router-dom';
import { Avatar, Dropdown, ErrorBox, Loading, Markdown, RepoGlyph, Segmented, Time } from '../components/ui';
import { invoke } from '@tauri-apps/api/core';
import { ACCEPT, gh, gql, invalidate, isTauri, useGh, useGhAll, useGql } from '../lib/api';
import { confirmDialog, promptDialog, toast, toastError } from '../lib/feedback';
import { langColor } from '../lib/langs';
import type { Repo } from '../lib/types';
import { FundingButton } from './Sponsors';
import { toggleFavorite, usePref, useRepoList, visitRepo } from '../lib/store';
import { compact, copyText, encPath, timeAgo } from '../lib/util';

export const useRepo = () => useOutletContext<{ repo: Repo; counts: any }>();

const COUNTS_QUERY = `
query($owner: String!, $name: String!) {
  repository(owner: $owner, name: $name) {
    issues(states: OPEN) { totalCount }
    pullRequests(states: OPEN) { totalCount }
    branches: refs(refPrefix: "refs/heads/") { totalCount }
    tags: refs(refPrefix: "refs/tags/") { totalCount }
    releases { totalCount }
    discussions { totalCount }
    latestRelease { tagName name publishedAt }
    defaultBranchRef { target { ... on Commit { history { totalCount } } } }
  }
}`;

// fetched once per repository
export function useRepoCounts(owner: string | undefined, name: string | undefined, enabled = true) {
  return useGql<any>('repo-counts', COUNTS_QUERY, { owner, name }, enabled && !!owner && !!name);
}

function StarButton({ repo }: { repo: Repo }) {
  const path = `/user/starred/${repo.full_name}`;
  const q = useGh(path);
  const [busy, setBusy] = useState(false);
  const starred = q.isSuccess;
  const toggle = async () => {
    setBusy(true);
    try {
      await gh(path, { method: starred ? 'DELETE' : 'PUT' });
      await Promise.all([invalidate(path), invalidate(`/repos/${repo.full_name}`)]);
    } finally {
      setBusy(false);
    }
  };
  return (
    <button className={`btn ${starred ? 'on' : ''}`} disabled={busy || q.isLoading} onClick={toggle}>
      {starred ? <StarFillIcon /> : <StarIcon />} {starred ? 'Starred' : 'Star'} <span className="count">{compact(repo.stargazers_count)}</span>
    </button>
  );
}

// pulls the upstream default branch into this fork
function SyncFork({ repo }: { repo: Repo }) {
  const [busy, setBusy] = useState(false);
  const sync = async () => {
    setBusy(true);
    try {
      const r = await gh<{ message: string }>(`/repos/${repo.full_name}/merge-upstream`, { method: 'POST', body: { branch: repo.default_branch } });
      toast(r.message || 'Fork is up to date');
      await invalidate(`/repos/${repo.full_name}`);
    } catch (e) {
      toastError(e);
    } finally {
      setBusy(false);
    }
  };
  return (
    <button className="link-btn small" disabled={busy} onClick={sync}>
      {busy ? 'Syncing…' : 'Sync fork'}
    </button>
  );
}

function UseTemplate({ repo }: { repo: Repo }) {
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
  const use = async () => {
    const name = await promptDialog({ title: `New repository from ${repo.name}`, label: 'Repository name', body: 'Created under your account as a private repository.', confirmLabel: 'Create repository' });
    if (!name) return;
    setBusy(true);
    try {
      const me = await gh<{ login: string }>('/user');
      const created = await gh<Repo>(`/repos/${repo.full_name}/generate`, { method: 'POST', body: { owner: me.login, name, private: true } });
      await invalidate('/user/repos');
      navigate(`/${created.full_name}`);
    } catch (e) {
      toastError(e);
    } finally {
      setBusy(false);
    }
  };
  return (
    <button className="btn primary" disabled={busy} onClick={use}>
      {busy ? 'Creating…' : 'Use this template'}
    </button>
  );
}

function ForkButton({ repo }: { repo: Repo }) {
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
  const fork = async () => {
    if (!(await confirmDialog({ title: `Fork ${repo.full_name}?`, body: 'A copy is created under your account.', confirmLabel: 'Fork' }))) return;
    setBusy(true);
    try {
      const created = await gh<any>(`/repos/${repo.full_name}/forks`, { method: 'POST' });
      await invalidate('/user/repos');
      navigate(`/${created.full_name}`);
    } catch (e) {
      toastError(e);
    } finally {
      setBusy(false);
    }
  };
  return (
    <button className="btn" disabled={busy} onClick={fork}>
      <RepoForkedIcon /> {busy ? 'Forking…' : 'Fork'} <span className="count">{compact(repo.forks_count)}</span>
    </button>
  );
}

function WatchButton({ repo }: { repo: Repo }) {
  const path = `/repos/${repo.full_name}/subscription`;
  const q = useGh<any>(path);
  const level = !q.isSuccess ? 'participating' : q.data?.ignored ? 'ignore' : q.data?.subscribed ? 'all' : 'participating';
  const [busy, setBusy] = useState(false);
  const set = async (to: string) => {
    setBusy(true);
    try {
      await gh(path, to === 'participating' ? { method: 'DELETE' } : { method: 'PUT', body: to === 'ignore' ? { ignored: true } : { subscribed: true } });
      await invalidate(path);
    } catch (e) {
      toastError(e);
    } finally {
      setBusy(false);
    }
  };
  const levels: [string, string, string][] = [
    ['participating', 'Participating and @mentions', 'Only when you take part or are mentioned.'],
    ['all', 'All activity', 'Every issue, pull request, release and discussion.'],
    ['ignore', 'Ignore', 'Never, not even when mentioned.'],
  ];
  return (
    <Dropdown align="right" className={`btn ${level === 'all' ? 'on' : ''}`} disabled={busy || q.isLoading} trigger={<><EyeIcon /> {level === 'all' ? 'Watching' : level === 'ignore' ? 'Ignoring' : 'Watch'} <TriangleDownIcon /></>}>
      {(close) => (
        <div className="menu wide" onClick={close}>
          {levels.map(([id, label, note]) => (
            <button key={id} className="menu-rich" onClick={() => id !== level && set(id)}>
              <span className="check">{id === level && <CheckIcon size={14} />}</span>
              <span>
                {label}
                <span className="muted small block">{note}</span>
              </span>
            </button>
          ))}
        </div>
      )}
    </Dropdown>
  );
}

interface RepoTab {
  to: string;
  label: string;
  icon: ReactNode;
  on: string[];
  count?: number;
}

// tabs that don't fit the width move into a "more" menu
function TabBar({ tabs, section }: { tabs: RepoTab[]; section: string }) {
  const ref = useRef<HTMLElement>(null);
  const [fit, setFit] = useState(tabs.length);
  const widths = tabs.map((t) => `${t.label}${t.count ?? ''}`).join('|');
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => {
      const items = [...el.querySelectorAll<HTMLElement>('[data-tab]')];
      const total = items.reduce((w, it) => w + it.offsetWidth + 8, -8);
      if (total <= el.clientWidth) return setFit(items.length);
      let used = 0;
      let n = 0;
      for (const it of items) {
        used += it.offsetWidth + 8;
        if (used > el.clientWidth - 96) break;
        n++;
      }
      setFit(n);
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [widths]);
  const rest = tabs.slice(fit);
  const restActive = rest.some((t) => t.on.includes(section));
  return (
    <nav className="tabs fit" aria-label="Repository" ref={ref}>
      {tabs.map((t, i) => {
        const on = t.on.includes(section);
        return (
          <Link key={t.label} data-tab to={t.to} className={`tab ${on ? 'active' : ''} ${i >= fit ? 'tab-hidden' : ''}`} aria-current={on ? 'page' : undefined} tabIndex={i >= fit ? -1 : undefined}>
            {t.icon}
            {t.label}
            {!!t.count && <span className="count">{compact(t.count)}</span>}
          </Link>
        );
      })}
      {rest.length > 0 && (
        <Dropdown align="right" className={`tab ${restActive ? 'active' : ''}`} trigger={<>More <TriangleDownIcon /></>}>
          {(close) => (
            <div className="menu" onClick={close}>
              {rest.map((t) => (
                <Link key={t.label} to={t.to}>
                  {t.icon}
                  {t.label}
                  {!!t.count && <span className="count">{compact(t.count)}</span>}
                </Link>
              ))}
            </div>
          )}
        </Dropdown>
      )}
    </nav>
  );
}

export function RepoLayout() {
  const { owner, repo: name } = useParams();
  const section = useLocation().pathname.split('/')[3] ?? '';
  const q = useGh<any>(`/repos/${owner}/${name}`);
  const repo = q.data;
  const counts = useRepoCounts(owner, name, q.isSuccess).data?.repository;
  const favorites = useRepoList('favorites');

  useEffect(() => {
    if (repo) visitRepo({ full_name: repo.full_name, avatar_url: repo.owner.avatar_url });
  }, [repo?.full_name]);

  if (q.isLoading) return <Loading />;
  if (q.error) return <ErrorBox error={q.error} retry={q.refetch} />;
  const base = `/${repo.full_name}`;
  const pinned = favorites.some((f) => f.full_name === repo.full_name);
  const tabs: RepoTab[] = [
    { to: base, label: 'Code', icon: <CodeIcon />, on: ['', 'tree', 'blob', 'blame', 'edit', 'new', 'branches', 'search'] },
    ...(repo.has_issues ? [{ to: `${base}/issues`, label: 'Issues', icon: <IssueOpenedIcon />, on: ['issues'], count: counts?.issues.totalCount }] : []),
    { to: `${base}/pulls`, label: 'Pull requests', icon: <GitPullRequestIcon />, on: ['pulls', 'pull', 'compare', 'labels', 'milestones', 'milestone'], count: counts?.pullRequests.totalCount },
    ...(repo.has_discussions ? [{ to: `${base}/discussions`, label: 'Discussions', icon: <CommentDiscussionIcon />, on: ['discussions'], count: counts?.discussions?.totalCount }] : []),
    { to: `${base}/actions`, label: 'Actions', icon: <PlayIcon />, on: ['actions'] },
    ...(repo.has_projects ? [{ to: `${base}/projects`, label: 'Projects', icon: <TableIcon />, on: ['projects'] }] : []),
    ...(repo.has_wiki ? [{ to: `${base}/wiki`, label: 'Wiki', icon: <BookIcon />, on: ['wiki'] }] : []),
    { to: `${base}/commits`, label: 'Commits', icon: <GitCommitIcon />, on: ['commits', 'commit'] },
    { to: `${base}/releases`, label: 'Releases', icon: <TagIcon />, on: ['releases', 'tags'] },
    { to: `${base}/security`, label: 'Security', icon: <ShieldIcon />, on: ['security'] },
    { to: `${base}/insights`, label: 'Insights', icon: <GraphIcon />, on: ['insights', 'forks', 'stargazers', 'watchers', 'deployments'] },
    ...(repo.permissions?.admin ? [{ to: `${base}/settings`, label: 'Settings', icon: <GearIcon />, on: ['settings'] }] : []),
  ];

  return (
    <div className="page">
      <div className="repo-head">
        <h1>
          <RepoGlyph repo={repo} />
          <Link to={`/${repo.owner.login}`}>{repo.owner.login}</Link>
          <span className="muted">/</span>
          <Link to={base} className="strong">
            {repo.name}
          </Link>
          <span className="badge">{repo.private ? 'Private' : 'Public'}</span>
          {repo.archived && <span className="badge">Archived</span>}
        </h1>
        <div className="repo-actions">
          <button
            className={`btn ${pinned ? 'on' : ''}`}
            title={pinned ? 'Unpin from the sidebar' : 'Pin to the sidebar'}
            onClick={() => toggleFavorite({ full_name: repo.full_name, avatar_url: repo.owner.avatar_url })}
          >
            <PinIcon /> {pinned ? 'Pinned' : 'Pin'}
          </button>
          <FundingButton owner={repo.owner.login} name={repo.name} />
          {repo.is_template && <UseTemplate repo={repo} />}
          <WatchButton repo={repo} />
          <ForkButton repo={repo} />
          <StarButton repo={repo} />
        </div>
      </div>
      {repo.parent && (
        <div className="muted small fork-note">
          forked from <Link to={`/${repo.parent.full_name}`}>{repo.parent.full_name}</Link>
          {repo.permissions?.push && <SyncFork repo={repo} />}
        </div>
      )}
      <TabBar tabs={tabs} section={section} />
      <Outlet context={{ repo, counts }} />
    </div>
  );
}

// splits the route splat into ref + path
export function useRefPath(repo: Repo) {
  const splat = useParams()['*'] ?? '';
  const [first, ...rest] = splat ? splat.split('/') : [repo.default_branch];
  const simple = !rest.length || first === repo.default_branch || /^[0-9a-f]{40}$/.test(first);
  const api = `/repos/${repo.full_name}/git/matching-refs`;
  const heads = useGh<{ ref: string }[]>(!simple && `${api}/heads/${encodeURIComponent(first)}`, { staleTime: 5 * 60_000 });
  const tags = useGh<{ ref: string }[]>(!simple && `${api}/tags/${encodeURIComponent(first)}`, { staleTime: 5 * 60_000 });
  if (simple) return { ref: first, path: rest.join('/'), loading: false };
  const names = [...(heads.data ?? []), ...(tags.data ?? [])].map((r) => r.ref.replace(/^refs\/(heads|tags)\//, ''));
  const ref = names.filter((n) => splat === n || splat.startsWith(n + '/')).sort((a, b) => b.length - a.length)[0] ?? first;
  return { ref, path: splat.slice(ref.length + 1), loading: heads.isLoading || tags.isLoading };
}

export function BranchPicker({ repo, current, kind, path }: { repo: Repo; current: string; kind: string; path: string }) {
  return (
    <Dropdown
      trigger={
        <>
          <GitBranchIcon /> {current.length === 40 && /^[0-9a-f]+$/.test(current) ? current.slice(0, 7) : current} <TriangleDownIcon />
        </>
      }
    >
      {(close) => <RefList repo={repo} current={current} kind={kind} path={path} close={close} />}
    </Dropdown>
  );
}

function RefList({ repo, current, kind, path, close }: { repo: Repo; current: string; kind: string; path: string; close: () => void }) {
  const [filter, setFilter] = useState('');
  const [which, setWhich] = useState<'branches' | 'tags'>('branches');
  const refs = useGhAll<{ name: string }>(`/repos/${repo.full_name}/${which}?per_page=100`);
  const shown = refs.items.filter((b) => b.name.toLowerCase().includes(filter.toLowerCase()));
  return (
    <div className="menu wide">
      <input className="input" autoFocus placeholder={`Find a ${which === 'tags' ? 'tag' : 'branch'}…`} value={filter} onChange={(e) => setFilter(e.target.value)} />
      <Segmented
        value={which}
        onChange={setWhich}
        options={[
          { value: 'branches', label: 'Branches' },
          { value: 'tags', label: 'Tags' },
        ]}
      />
      <div className="menu-scroll" onClick={close}>
        {refs.isLoading && <Loading />}
        {shown.map((b) => (
          <Link key={b.name} to={`/${repo.full_name}/${kind}/${b.name}${path ? '/' + path : ''}`}>
            <span className="check">{b.name === current && <CheckIcon size={14} />}</span>
            {b.name}
            {b.name === repo.default_branch && which === 'branches' && <span className="badge">default</span>}
          </Link>
        ))}
        {!refs.isLoading && shown.length === 0 && <p className="menu-note">Nothing matches.</p>}
        {refs.truncated && <p className="menu-note">Showing the first {refs.items.length}.</p>}
      </div>
    </div>
  );
}

export function PathCrumbs({ repo, gitRef, path }: { repo: Repo; gitRef: string; path: string }) {
  const parts = path ? path.split('/') : [];
  const root = `/${repo.full_name}/tree/${gitRef}`;
  return (
    <div className="path-crumbs">
      <Link to={root} className="strong">
        {repo.name}
      </Link>
      {parts.map((p, i) => (
        <span key={i}>
          <span className="muted"> / </span>
          {i === parts.length - 1 ? (
            <strong>{p}</strong>
          ) : (
            <Link to={`${root}/${parts.slice(0, i + 1).join('/')}`}>{p}</Link>
          )}
        </span>
      ))}
    </div>
  );
}

// opens the local clone when there is one, otherwise offers to clone
function LocalActions({ repo, close }: { repo: Repo; close: () => void }) {
  const navigate = useNavigate();
  const [, setLocal] = usePref('local-repo', '');
  const [editor] = usePref('editor', '');
  const clone = useQuery({ queryKey: ['local', 'find_local_clone', repo.full_name], queryFn: () => invoke<string | null>('find_local_clone', { fullName: repo.full_name }), enabled: isTauri });
  if (!isTauri || !clone.data)
    return (
      <Link className="btn block" to={`/local?clone=${encodeURIComponent(repo.full_name)}`}>
        <DeviceDesktopIcon /> {isTauri ? 'Clone in Desktop mode' : 'Open in Desktop mode'}
      </Link>
    );
  const path = clone.data;
  return (
    <div className="clone-actions">
      <button
        className="btn"
        onClick={() => {
          setLocal(path);
          close();
          navigate('/local');
        }}
      >
        <DeviceDesktopIcon /> Open local copy
      </button>
      <button
        className="btn"
        onClick={async () => {
          close();
          const editors = await invoke<{ id: string }[]>('list_editors').catch(() => []);
          const pick = editors.find((e) => e.id === editor) ?? editors[0];
          if (!pick) return toast('No editor found. Pick one in Desktop mode.', 'error');
          await invoke('open_in_editor', { repo: path, editor: pick.id }).catch(toastError);
        }}
      >
        <CodeIcon /> Open in editor
      </button>
    </div>
  );
}

function CloneMenu({ repo, onFind, addTo }: { repo: Repo; onFind: () => void; addTo?: string }) {
  const [copied, setCopied] = useState('');
  const rows = [
    { label: 'HTTPS', value: repo.clone_url },
    { label: 'SSH', value: repo.ssh_url },
    { label: 'GitHub CLI', value: `gh repo clone ${repo.full_name}` },
  ];
  return (
    <Dropdown
      align="right"
      className="btn primary"
      trigger={
        <>
          <CodeIcon /> Code <TriangleDownIcon />
        </>
      }
    >
      {(close) => (
        <div className="menu wide pad">
          <div className="clone-actions" onClick={close}>
            <button className="btn" onClick={onFind}>
              <SearchIcon /> Go to file <kbd>T</kbd>
            </button>
            {addTo && (
              <Link className="btn" to={addTo}>
                <PlusIcon /> Add file
              </Link>
            )}
          </div>
          <strong>Clone</strong>
          {rows.map((r) => (
            <div key={r.label} className="clone-row">
              <span className="muted small">{r.label}</span>
              <code>{r.value}</code>
              <button
                className="icon-btn"
                title="Copy"
                onClick={() => {
                  void copyText(r.value);
                  setCopied(r.label);
                }}
              >
                {copied === r.label ? <CheckIcon /> : <CopyIcon />}
              </button>
            </div>
          ))}
          <LocalActions repo={repo} close={close} />
          <a className="small" href={`${repo.html_url}/archive/refs/heads/${repo.default_branch}.zip`} data-external>
            Download ZIP
          </a>
        </div>
      )}
    </Dropdown>
  );
}

// fuzzy file jump over the whole tree
function FileFinder({ repo, gitRef, onClose }: { repo: Repo; gitRef: string; onClose: () => void }) {
  const navigate = useNavigate();
  const tree = useGh<any>(`/repos/${repo.full_name}/git/trees/${encodeURIComponent(gitRef)}?recursive=1`);
  const [text, setText] = useState('');
  const [active, setActive] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);
  const files = useMemo<string[]>(
    () => (tree.data?.tree ?? []).filter((t: any) => t.type === 'blob').map((t: any) => t.path),
    [tree.data],
  );
  const shown = useMemo(() => {
    const q = text.trim().toLowerCase();
    if (!q) return files.slice(0, 60);
    const scored: [number, string][] = [];
    for (const f of files) {
      const lower = f.toLowerCase();
      const base = lower.slice(lower.lastIndexOf('/') + 1);
      let score = -1;
      if (base.startsWith(q)) score = 0;
      else if (base.includes(q)) score = 1;
      else if (lower.includes(q)) score = 2;
      else {
        // subsequence match
        let i = 0;
        for (const ch of lower) if (ch === q[i]) i++;
        if (i === q.length) score = 3;
      }
      if (score >= 0) scored.push([score * 1000 + f.length, f]);
    }
    return scored.sort((a, b) => a[0] - b[0]).slice(0, 60).map(([, f]) => f);
  }, [files, text]);

  useEffect(() => setActive(0), [text]);
  useEffect(() => {
    listRef.current?.children[active]?.scrollIntoView({ block: 'nearest' });
  }, [active]);
  const open = (f?: string) => {
    if (!f) return;
    onClose();
    navigate(`/${repo.full_name}/blob/${gitRef}/${f}`);
  };

  return (
    <div className="overlay" onMouseDown={onClose}>
      <div className="palette" onMouseDown={(e) => e.stopPropagation()}>
        <div className="palette-input">
          <SearchIcon />
          <input
            autoFocus
            value={text}
            placeholder={`Go to file in ${repo.name}`}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') onClose();
              else if (e.key === 'ArrowDown') {
                e.preventDefault();
                setActive((i) => Math.min(i + 1, shown.length - 1));
              } else if (e.key === 'ArrowUp') {
                e.preventDefault();
                setActive((i) => Math.max(i - 1, 0));
              } else if (e.key === 'Enter') open(shown[active]);
            }}
          />
        </div>
        <div className="palette-list" ref={listRef}>
          {tree.isLoading && <Loading />}
          {tree.error && <ErrorBox error={tree.error} />}
          {tree.data?.truncated && !text && <p className="muted small pad">Large repository: only part of the tree is searchable.</p>}
          {shown.map((f, i) => {
            const cut = f.lastIndexOf('/') + 1;
            return (
              <button key={f} className={i === active ? 'active' : ''} onMouseEnter={() => setActive(i)} onClick={() => open(f)}>
                <FileIcon />
                <span className="palette-label">
                  <span className="muted">{f.slice(0, cut)}</span>
                  {f.slice(cut)}
                </span>
              </button>
            );
          })}
          {!tree.isLoading && !tree.error && shown.length === 0 && <p className="muted pad">No matching files.</p>}
        </div>
      </div>
    </div>
  );
}

interface FileCommit {
  messageHeadline: string;
  committedDate: string;
  oid: string;
}

// last commit per entry
function useTreeCommits(repo: Repo, ref: string, paths: string[]) {
  const limited = paths.slice(0, 1000);
  return useQuery<Record<string, FileCommit>>({
    queryKey: ['tree-commits', repo.full_name, ref, limited.join('\n')],
    enabled: limited.length > 0,
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const chunks: string[][] = [];
      for (let i = 0; i < limited.length; i += 40) chunks.push(limited.slice(i, i + 40));
      const out: Record<string, FileCommit> = {};
      await Promise.all(
        chunks.map(async (chunk) => {
          const fields = chunk
            .map((p, i) => `f${i}: history(first: 1, path: ${JSON.stringify(p)}) { nodes { messageHeadline committedDate oid } }`)
            .join('\n');
          const data = await gql<any>(
            `query($owner: String!, $name: String!, $expr: String!) {
              repository(owner: $owner, name: $name) { object(expression: $expr) { ... on Commit { ${fields} } } }
            }`,
            { owner: repo.owner.login, name: repo.name, expr: ref },
          );
          const obj = data.repository?.object ?? {};
          chunk.forEach((p, i) => {
            const node = obj[`f${i}`]?.nodes?.[0];
            if (node) out[p] = node;
          });
        }),
      );
      return out;
    },
  });
}

export function LatestCommit({ repo, gitRef, path, total }: { repo: Repo; gitRef: string; path: string; total?: number }) {
  const q = useGh<any[]>(
    `/repos/${repo.full_name}/commits?sha=${encodeURIComponent(gitRef)}&per_page=1${path ? `&path=${encodeURIComponent(path)}` : ''}`,
  );
  const c = q.data?.[0];
  return (
    <div className="latest-commit">
      {c ? (
        <>
          <Avatar user={c.author ?? {}} size={22} />
          <strong>{c.author?.login ?? c.commit.author.name}</strong>
          <Link to={`/${repo.full_name}/commit/${c.sha}`} className="commit-msg">
            {c.commit.message.split('\n')[0]}
          </Link>
          <span className="spacer" />
          <code className="muted">{c.sha.slice(0, 7)}</code>
          <span className="muted">
            <Time iso={c.commit.author.date} />
          </span>
        </>
      ) : (
        <span className="spacer" />
      )}
      <Link to={`/${repo.full_name}/commits/${gitRef}${path ? '/' + path : ''}`} className="history-link">
        <HistoryIcon /> {total ? `${total.toLocaleString()} Commits` : 'History'}
      </Link>
    </div>
  );
}

// description, website and topics, editable by admins
function AboutEdit({ repo, onDone }: { repo: Repo; onDone: () => void }) {
  const [description, setDescription] = useState<string>(repo.description ?? '');
  const [homepage, setHomepage] = useState<string>(repo.homepage ?? '');
  const [topics, setTopics] = useState<string>((repo.topics ?? []).join(' '));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const save = async () => {
    setBusy(true);
    setError('');
    try {
      const api = `/repos/${repo.full_name}`;
      await gh(api, { method: 'PATCH', body: { description, homepage } });
      const names = topics.toLowerCase().split(/[\s,]+/).filter(Boolean);
      if (names.join(' ') !== (repo.topics ?? []).join(' ')) await gh(`${api}/topics`, { method: 'PUT', body: { names } });
      await invalidate(api);
      onDone();
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  };
  return (
    <div className="form">
      <label>
        Description
        <textarea className="input" rows={3} value={description} onChange={(e) => setDescription(e.target.value)} />
      </label>
      <label>
        Website
        <input className="input" placeholder="https://" value={homepage} onChange={(e) => setHomepage(e.target.value)} />
      </label>
      <label>
        Topics, separated by spaces
        <input className="input" value={topics} onChange={(e) => setTopics(e.target.value)} />
      </label>
      {error && <span className="small">{error}</span>}
      <div className="form-foot">
        <span className="spacer" />
        <button className="btn" onClick={onDone}>
          Cancel
        </button>
        <button className="btn primary" disabled={busy} onClick={save}>
          {busy ? 'Saving…' : 'Save changes'}
        </button>
      </div>
    </div>
  );
}

function About({ repo, counts }: { repo: Repo; counts: any }) {
  const api = `/repos/${repo.full_name}`;
  const langs = useGh<Record<string, number>>(`${api}/languages`);
  const contributors = useGh<any[]>(`${api}/contributors?per_page=14`);
  const [editing, setEditing] = useState(false);
  const all = Object.entries(langs.data ?? {});
  const total = all.reduce((sum, [, n]) => sum + n, 0);
  // tiny languages only add noise
  const entries = all.filter(([, n]) => n / total >= 0.001);
  const latest = counts?.latestRelease;
  return (
    <aside className="about">
      <section>
        <div className="about-head">
          <h3>About</h3>
          {repo.permissions?.admin && !editing && (
            <button className="icon-btn sm" title="Edit repository details" aria-label="Edit repository details" onClick={() => setEditing(true)}>
              <GearIcon />
            </button>
          )}
        </div>
        {editing ? (
          <AboutEdit repo={repo} onDone={() => setEditing(false)} />
        ) : (
          <>
            <p className={repo.description ? '' : 'muted'}>{repo.description ?? 'No description, website, or topics provided.'}</p>
            {repo.homepage && (
              <a className="about-link" href={repo.homepage}>
                <LinkIcon /> <span>{repo.homepage.replace(/^https?:\/\//, '')}</span>
              </a>
            )}
            {!!repo.topics?.length && (
              <div className="topics">
                {repo.topics.map((t: string) => (
                  <Link key={t} className="topic" to={`/search?q=${encodeURIComponent('topic:' + t)}`}>
                    {t}
                  </Link>
                ))}
              </div>
            )}
          </>
        )}
        <ul className="facts">
          <li>
            <BookIcon /> Readme
          </li>
          {repo.license && (
            <li>
              <LawIcon /> {repo.license.spdx_id !== 'NOASSERTION' ? repo.license.spdx_id : repo.license.name} license
            </li>
          )}
          <li>
            <StarIcon />
            <Link to={`/${repo.full_name}/stargazers`}>
              <strong>{compact(repo.stargazers_count)}</strong> stars
            </Link>
          </li>
          <li>
            <EyeIcon />
            <Link to={`/${repo.full_name}/watchers`}>
              <strong>{compact(repo.subscribers_count ?? 0)}</strong> watching
            </Link>
          </li>
          <li>
            <RepoForkedIcon />
            <Link to={`/${repo.full_name}/forks`}>
              <strong>{compact(repo.forks_count)}</strong> forks
            </Link>
          </li>
        </ul>
      </section>
      {counts?.releases.totalCount > 0 && (
        <section>
          <h3>
            <Link to={`/${repo.full_name}/releases`}>Releases</Link> <span className="count">{counts.releases.totalCount}</span>
          </h3>
          {latest && (
            <Link to={`/${repo.full_name}/releases`} className="about-link">
              <TagIcon />
              <span>
                <strong>{latest.name || latest.tagName}</strong> <span className="badge">Latest</span>
              </span>
            </Link>
          )}
        </section>
      )}
      {!!contributors.data?.length && (
        <section>
          <h3>Contributors</h3>
          <div className="faces">
            {contributors.data.map((c) => (
              <Link key={c.id} to={`/${c.login}`} title={`${c.login} · ${c.contributions} commits`}>
                <Avatar user={c} size={28} />
              </Link>
            ))}
          </div>
        </section>
      )}
      {total > 0 && (
        <section>
          <h3>Languages</h3>
          <div className="lang-bar">
            {entries.map(([name, n]) => (
              <span key={name} style={{ width: `${(n / total) * 100}%`, background: langColor(name) }} title={name} />
            ))}
          </div>
          <div className="lang-legend">
            {entries.slice(0, 8).map(([name, n]) => (
              <span key={name} className="meta-item">
                <span className="lang-dot" style={{ background: langColor(name) }} />
                <strong>{name}</strong> <span className="muted">{((n / total) * 100).toFixed(1)}%</span>
              </span>
            ))}
          </div>
        </section>
      )}
    </aside>
  );
}

// the code tab
export function Code() {
  const { repo, counts } = useRepo();
  const { ref, path, loading } = useRefPath(repo);
  const [finder, setFinder] = useState(false);
  const api = `/repos/${repo.full_name}`;
  const refQ = `?ref=${encodeURIComponent(ref)}`;
  const contents = useGh<any>(!loading && `${api}/contents/${encPath(path)}${refQ}`);
  const readme = useGh<string>(!loading && `${api}/readme${path ? '/' + encPath(path) : ''}${refQ}`, { accept: ACCEPT.html, text: true });
  const entries = useMemo(
    () =>
      Array.isArray(contents.data)
        ? [...contents.data].sort((a, b) => Number(b.type === 'dir') - Number(a.type === 'dir') || a.name.localeCompare(b.name))
        : [],
    [contents.data],
  );
  const commits = useTreeCommits(repo, ref, useMemo(() => entries.map((e) => e.path), [entries])).data ?? {};

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const typing = /^(INPUT|TEXTAREA|SELECT)$/.test((e.target as HTMLElement).tagName);
      if (e.key === 't' && !typing && !e.ctrlKey && !e.metaKey && !e.altKey) {
        e.preventDefault();
        setFinder(true);
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  if (contents.data && !Array.isArray(contents.data)) return <Navigate replace to={`/${repo.full_name}/blob/${ref}/${path}`} />;
  const parent = path.split('/').slice(0, -1).join('/');

  return (
    <div className={path ? 'stack' : 'code-layout'}>
      <div className="stack">
        <div className="toolbar">
          <BranchPicker repo={repo} current={ref} kind="tree" path={path} />
          {path ? (
            <PathCrumbs repo={repo} gitRef={ref} path={path} />
          ) : (
            counts && (
              <>
                <Link to={`/${repo.full_name}/branches`} className="meta-item muted">
                  <GitBranchIcon /> <strong>{counts.branches.totalCount}</strong> Branches
                </Link>
                <Link to={`/${repo.full_name}/tags`} className="meta-item muted">
                  <TagIcon /> <strong>{counts.tags.totalCount}</strong> Tags
                </Link>
              </>
            )
          )}
          <span className="spacer" />
          <CloneMenu repo={repo} onFind={() => setFinder(true)} addTo={repo.permissions?.push ? `/${repo.full_name}/new/${ref}${path ? '/' + path : ''}` : undefined} />
        </div>
        <div className="card">
          <LatestCommit repo={repo} gitRef={ref} path={path} total={path ? undefined : counts?.defaultBranchRef?.target?.history?.totalCount} />
          {contents.isLoading && <Loading />}
          {contents.error &&
            (contents.error.status === 404 && !path ? (
              <p className="muted pad">This repository is empty.</p>
            ) : (
              <ErrorBox error={contents.error} retry={contents.refetch} />
            ))}
          {path && (
            <Link className="file-row" to={`/${repo.full_name}/tree/${ref}${parent ? '/' + parent : ''}`}>
              <span className="file-name">
                <FileDirectoryFillIcon className="dir-icon" /> <span>..</span>
              </span>
            </Link>
          )}
          {entries.map((f) => {
            const c = commits[f.path];
            return (
              <div key={f.path} className="file-row">
                <Link className="file-name" to={`/${repo.full_name}/${f.type === 'dir' ? 'tree' : 'blob'}/${ref}/${f.path}`}>
                  {f.type === 'dir' ? <FileDirectoryFillIcon className="dir-icon" /> : f.type === 'submodule' ? <FileSubmoduleIcon /> : <FileIcon />}
                  <span>{f.name}</span>
                </Link>
                {c ? (
                  <Link className="file-commit" to={`/${repo.full_name}/commit/${c.oid}`}>
                    {c.messageHeadline}
                  </Link>
                ) : (
                  <span className="file-commit" />
                )}
                <span className="file-age" title={c ? new Date(c.committedDate).toLocaleString() : undefined}>
                  {c ? timeAgo(c.committedDate) : ''}
                </span>
              </div>
            );
          })}
        </div>
        {readme.data && (
          <div className="card">
            <div className="card-head">
              <BookIcon /> README
            </div>
            <div className="pad-lg">
              <Markdown html={readme.data} base={{ repo: repo.full_name, ref, dir: path }} />
            </div>
          </div>
        )}
      </div>
      {!path && <About repo={repo} counts={counts} />}
      {finder && <FileFinder repo={repo} gitRef={ref} onClose={() => setFinder(false)} />}
    </div>
  );
}

