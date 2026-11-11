import {
  BookIcon,
  CheckIcon,
  CodeIcon,
  CopyIcon,
  EyeIcon,
  FileDirectoryFillIcon,
  FileIcon,
  FileSubmoduleIcon,
  GitBranchIcon,
  HistoryIcon,
  LawIcon,
  LinkIcon,
  PinIcon,
  RepoForkedIcon,
  SearchIcon,
  StarFillIcon,
  StarIcon,
  TagIcon,
  TriangleDownIcon,
} from '@primer/octicons-react';
import { useQuery } from '@tanstack/react-query';
import hljs from 'highlight.js/lib/common';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, Navigate, Outlet, useNavigate, useOutletContext, useParams } from 'react-router-dom';
import { Avatar, Dropdown, ErrorBox, Loading, Markdown, RepoGlyph, Segmented, Time } from '../components/ui';
import { ACCEPT, gh, gql, invalidate, useGh, useGql } from '../lib/api';
import { toggleFavorite, useRepoList, visitRepo } from '../lib/store';
import { compact, copyText, encPath, formatBytes, shortAgo } from '../lib/util';

/** Monochrome ramp: the biggest language is the brightest segment. */
const tone = (i: number) => `color-mix(in srgb, var(--fg) ${Math.max(14, 92 - i * 20)}%, transparent)`;

export const useRepo = () => useOutletContext<{ repo: any }>();

const COUNTS_QUERY = `
query($owner: String!, $name: String!) {
  repository(owner: $owner, name: $name) {
    issues(states: OPEN) { totalCount }
    pullRequests(states: OPEN) { totalCount }
    branches: refs(refPrefix: "refs/heads/") { totalCount }
    tags: refs(refPrefix: "refs/tags/") { totalCount }
    releases { totalCount }
    latestRelease { tagName name publishedAt }
    defaultBranchRef { target { ... on Commit { history { totalCount } } } }
  }
}`;

/** Shared by the sidebar and the code page, so it is fetched once per repository. */
export function useRepoCounts(owner: string | undefined, name: string | undefined, enabled = true) {
  return useGql<any>('repo-counts', COUNTS_QUERY, { owner, name }, enabled && !!owner && !!name);
}

function StarButton({ repo }: { repo: any }) {
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
    <button className={`btn ${starred ? 'starred' : ''}`} disabled={busy || q.isLoading} onClick={toggle}>
      {starred ? <StarFillIcon /> : <StarIcon />} {starred ? 'Starred' : 'Star'}
      <span className="count">{compact(repo.stargazers_count)}</span>
    </button>
  );
}

export function RepoLayout() {
  const { owner, repo: name } = useParams();
  const q = useGh<any>(`/repos/${owner}/${name}`);
  const repo = q.data;
  const favorites = useRepoList('favorites');

  useEffect(() => {
    if (repo) visitRepo({ full_name: repo.full_name, avatar_url: repo.owner.avatar_url });
  }, [repo?.full_name]);

  if (q.isLoading) return <Loading />;
  if (q.error) return <ErrorBox error={q.error} retry={q.refetch} />;
  const pinned = favorites.some((f) => f.full_name === repo.full_name);

  return (
    <div className="page repo">
      <div className="repo-head">
        <h1>
          <RepoGlyph repo={repo} size={18} />
          <Link to={`/${repo.owner.login}`} className="repo-owner">
            {repo.owner.login}
          </Link>
          <span className="muted">/</span>
          <Link to={`/${repo.full_name}`} className="repo-name">
            {repo.name}
          </Link>
          <span className="badge">{repo.private ? 'Private' : 'Public'}</span>
          {repo.archived && <span className="badge warn">Archived</span>}
        </h1>
        <div className="repo-actions">
          <button
            className={`btn ${pinned ? 'starred' : ''}`}
            title={pinned ? 'Remove from sidebar favorites' : 'Keep in sidebar favorites'}
            onClick={() => toggleFavorite({ full_name: repo.full_name, avatar_url: repo.owner.avatar_url })}
          >
            <PinIcon /> {pinned ? 'Pinned' : 'Pin'}
          </button>
          <a className="btn" href={`${repo.html_url}/fork`} data-external title="Fork on github.com">
            <RepoForkedIcon /> Fork <span className="count">{compact(repo.forks_count)}</span>
          </a>
          <StarButton repo={repo} />
        </div>
      </div>
      {repo.parent && (
        <div className="muted small fork-note">
          forked from <Link to={`/${repo.parent.full_name}`}>{repo.parent.full_name}</Link>
        </div>
      )}
      <Outlet context={{ repo }} />
    </div>
  );
}

/** Splits the router splat into ref + path. Branch names containing "/" aren't resolved yet. */
function useRefPath(repo: any) {
  const splat = useParams()['*'] ?? '';
  const [ref, ...rest] = splat ? splat.split('/') : [repo.default_branch];
  return { ref, path: rest.join('/') };
}

function BranchPicker({ repo, current, kind, path }: { repo: any; current: string; kind: string; path: string }) {
  const [filter, setFilter] = useState('');
  return (
    <Dropdown
      trigger={
        <>
          <GitBranchIcon /> {current} <TriangleDownIcon />
        </>
      }
    >
      {(close) => <BranchList repo={repo} current={current} kind={kind} path={path} filter={filter} setFilter={setFilter} close={close} />}
    </Dropdown>
  );
}

function BranchList({ repo, current, kind, path, filter, setFilter, close }: any) {
  const branches = useGh<any[]>(`/repos/${repo.full_name}/branches?per_page=100`);
  const shown = (branches.data ?? []).filter((b) => b.name.toLowerCase().includes(filter.toLowerCase()));
  return (
    <div className="menu wide">
      <input className="input" autoFocus placeholder="Find a branch…" value={filter} onChange={(e) => setFilter(e.target.value)} />
      <div className="menu-scroll" onClick={close}>
        {branches.isLoading && <Loading />}
        {shown.map((b) => (
          <Link key={b.name} to={`/${repo.full_name}/${kind}/${b.name}${path ? '/' + path : ''}`}>
            <span className="check">{b.name === current && <CheckIcon size={14} />}</span>
            {b.name}
            {b.name === repo.default_branch && <span className="badge">default</span>}
          </Link>
        ))}
      </div>
    </div>
  );
}

function PathCrumbs({ repo, gitRef, path }: { repo: any; gitRef: string; path: string }) {
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

function CloneMenu({ repo }: { repo: any }) {
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
      {() => (
        <div className="menu wide pad">
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
          <a className="small" href={`${repo.html_url}/archive/refs/heads/${repo.default_branch}.zip`} data-external>
            Download ZIP
          </a>
        </div>
      )}
    </Dropdown>
  );
}

/** Fuzzy file jump over the whole tree (press T on a code page). */
function FileFinder({ repo, gitRef, onClose }: { repo: any; gitRef: string; onClose: () => void }) {
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
        // subsequence match: every typed character appears in order
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

/**
 * Last commit per directory entry. REST has no bulk endpoint for this, so it is one
 * GraphQL request per 40 entries with an aliased `history(path:)` for each.
 */
function useTreeCommits(repo: any, ref: string, paths: string[]) {
  const limited = paths.slice(0, 120);
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

function LatestCommit({ repo, gitRef, path, total }: { repo: any; gitRef: string; path: string; total?: number }) {
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
        <HistoryIcon /> {total ? <strong>{total.toLocaleString()}</strong> : null} {total ? 'commits' : 'History'}
      </Link>
    </div>
  );
}

function About({ repo, counts }: { repo: any; counts: any }) {
  const langs = useGh<Record<string, number>>(`/repos/${repo.full_name}/languages`);
  const entries = Object.entries(langs.data ?? {});
  const total = entries.reduce((s, [, n]) => s + n, 0);
  const latest = counts?.latestRelease;
  return (
    <aside className="about">
      <section className="card pad-card">
        <h3>About</h3>
        <p className={repo.description ? '' : 'muted'}>{repo.description ?? 'No description provided.'}</p>
        {repo.homepage && (
          <a className="about-link" href={repo.homepage}>
            <LinkIcon size={14} /> {repo.homepage.replace(/^https?:\/\//, '')}
          </a>
        )}
        {repo.topics?.length > 0 && (
          <div className="topics">
            {repo.topics.map((t: string) => (
              <Link key={t} className="topic" to={`/search?q=${encodeURIComponent('topic:' + t)}`}>
                {t}
              </Link>
            ))}
          </div>
        )}
        <ul className="about-facts">
          {repo.license && (
            <li>
              <LawIcon size={14} /> {repo.license.spdx_id !== 'NOASSERTION' ? repo.license.spdx_id : repo.license.name} license
            </li>
          )}
          <li>
            <StarIcon size={14} /> <strong>{compact(repo.stargazers_count)}</strong> stars
          </li>
          <li>
            <RepoForkedIcon size={14} /> <strong>{compact(repo.forks_count)}</strong> forks
          </li>
          <li>
            <EyeIcon size={14} /> <strong>{compact(repo.subscribers_count)}</strong> watching
          </li>
        </ul>
      </section>
      {counts?.releases.totalCount > 0 && (
        <section className="card pad-card">
          <h3>
            Releases <span className="count">{counts.releases.totalCount}</span>
          </h3>
          {latest && (
            <Link to={`/${repo.full_name}/releases`} className="release-latest">
              <TagIcon size={14} />
              <span>
                <strong>{latest.name || latest.tagName}</strong> <span className="badge ok">Latest</span>
                <span className="muted small">
                  <Time iso={latest.publishedAt} />
                </span>
              </span>
            </Link>
          )}
          <Link className="small muted" to={`/${repo.full_name}/releases`}>
            All releases →
          </Link>
        </section>
      )}
      {total > 0 && (
        <section className="card pad-card">
          <h3>Languages</h3>
          <div className="lang-bar">
            {entries.map(([name, n], i) => (
              <span key={name} style={{ width: `${(n / total) * 100}%`, background: tone(i) }} title={name} />
            ))}
          </div>
          <div className="lang-legend">
            {entries.slice(0, 8).map(([name, n], i) => (
              <span key={name} className="meta-item">
                <span className="lang-dot" style={{ background: tone(i) }} />
                <strong>{name}</strong> <span className="muted">{((n / total) * 100).toFixed(1)}%</span>
              </span>
            ))}
          </div>
        </section>
      )}
    </aside>
  );
}

export function Code() {
  const { repo } = useRepo();
  const { ref, path } = useRefPath(repo);
  const [finder, setFinder] = useState(false);
  const api = `/repos/${repo.full_name}`;
  const refQ = `?ref=${encodeURIComponent(ref)}`;
  const contents = useGh<any>(`${api}/contents/${encPath(path)}${refQ}`);
  const readme = useGh<string>(`${api}/readme${path ? '/' + encPath(path) : ''}${refQ}`, {
    accept: ACCEPT.html,
    text: true,
  });
  const counts = useRepoCounts(repo.owner.login, repo.name).data?.repository;
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

  if (contents.data && !Array.isArray(contents.data))
    return <Navigate replace to={`/${repo.full_name}/blob/${ref}/${path}`} />;

  const parent = path.split('/').slice(0, -1).join('/');
  const onDefault = ref === repo.default_branch;

  return (
    <div className={`code-layout ${path ? 'no-side' : ''}`}>
      <div className="code-main">
        <div className="card files">
          <div className="files-bar">
            <BranchPicker repo={repo} current={ref} kind="tree" path={path} />
            {path ? (
              <PathCrumbs repo={repo} gitRef={ref} path={path} />
            ) : (
              counts && (
                <>
                  <span className="meta-item muted">
                    <GitBranchIcon size={14} /> <strong>{counts.branches.totalCount}</strong> branches
                  </span>
                  <span className="meta-item muted">
                    <TagIcon size={14} /> <strong>{counts.tags.totalCount}</strong> tags
                  </span>
                </>
              )
            )}
            <span className="spacer" />
            <button className="btn" onClick={() => setFinder(true)} title="Go to file (T)">
              <SearchIcon /> Go to file
            </button>
            <CloneMenu repo={repo} />
          </div>
          <LatestCommit
            repo={repo}
            gitRef={ref}
            path={path}
            total={!path && onDefault ? counts?.defaultBranchRef?.target?.history?.totalCount : undefined}
          />
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
                <FileDirectoryFillIcon className="dir-icon" /> ..
              </span>
            </Link>
          )}
          {entries.map((f) => {
            const c = commits[f.path];
            return (
              <div key={f.path} className="file-row">
                <Link className="file-name" to={`/${repo.full_name}/${f.type === 'dir' ? 'tree' : 'blob'}/${ref}/${f.path}`}>
                  {f.type === 'dir' ? (
                    <FileDirectoryFillIcon className="dir-icon" />
                  ) : f.type === 'submodule' ? (
                    <FileSubmoduleIcon />
                  ) : (
                    <FileIcon />
                  )}
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
                  {c ? shortAgo(c.committedDate) : ''}
                </span>
              </div>
            );
          })}
        </div>
        {readme.data && (
          <div className="card readme">
            <div className="card-head">
              <BookIcon /> README
            </div>
            <div className="pad-lg">
              <Markdown html={readme.data} />
            </div>
          </div>
        )}
      </div>
      {!path && <About repo={repo} counts={counts} />}
      {finder && <FileFinder repo={repo} gitRef={ref} onClose={() => setFinder(false)} />}
    </div>
  );
}

const IMAGE_EXT = /\.(png|jpe?g|gif|webp|svg|ico|bmp|avif)$/i;
const MIME: Record<string, string> = { svg: 'image/svg+xml', jpg: 'image/jpeg', ico: 'image/x-icon' };

function decodeBase64(b64: string): { text: string; binary: boolean } {
  const bytes = Uint8Array.from(atob(b64.replace(/\s/g, '')), (c) => c.charCodeAt(0));
  return { text: new TextDecoder().decode(bytes), binary: bytes.subarray(0, 8000).includes(0) };
}

function highlight(code: string, filename: string): string {
  const ext = filename.includes('.') ? filename.split('.').pop()!.toLowerCase() : filename.toLowerCase();
  if (code.length < 200_000 && hljs.getLanguage(ext)) {
    try {
      return hljs.highlight(code, { language: ext, ignoreIllegals: true }).value;
    } catch {
      /* fall through to plain text */
    }
  }
  return code.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export function Blob() {
  const { repo } = useRepo();
  const { ref, path } = useRefPath(repo);
  const api = `/repos/${repo.full_name}/contents/${encPath(path)}?ref=${encodeURIComponent(ref)}`;
  const meta = useGh<any>(api);
  const name = path.split('/').pop() ?? '';
  const isImage = IMAGE_EXT.test(name);
  const isMarkdown = /\.(md|markdown|mdx)$/i.test(name);
  const [mode, setMode] = useState<'preview' | 'code'>('preview');
  // The contents API omits inline content above 1 MB; fetch those raw.
  const tooBig = !!meta.data && !Array.isArray(meta.data) && !meta.data.content && meta.data.size > 0;
  const raw = useGh<string>(tooBig && !isImage && meta.data.size < 5_000_000 && api, { accept: ACCEPT.raw, text: true });
  const rendered = useGh<string>(isMarkdown && mode === 'preview' && api, { accept: ACCEPT.html, text: true });

  const decoded = useMemo(() => {
    if (raw.data != null) return { text: raw.data, binary: false };
    if (!meta.data?.content || isImage) return null;
    try {
      return decodeBase64(meta.data.content);
    } catch {
      return { text: '', binary: true };
    }
  }, [meta.data, raw.data, isImage]);
  const html = useMemo(() => (decoded && !decoded.binary ? highlight(decoded.text, name) : ''), [decoded, name]);

  if (meta.isLoading) return <Loading />;
  if (meta.error) return <ErrorBox error={meta.error} />;
  if (Array.isArray(meta.data)) return <Navigate replace to={`/${repo.full_name}/tree/${ref}/${path}`} />;
  const file = meta.data;
  const lines = decoded ? decoded.text.replace(/\n$/, '').split('\n').length : 0;
  const ext = name.split('.').pop()!.toLowerCase();

  let body;
  if (isImage) {
    body = (
      <div className="blob-image">
        {file.content ? (
          <img src={`data:${MIME[ext] ?? `image/${ext}`};base64,${file.content.replace(/\s/g, '')}`} alt={name} />
        ) : (
          <img src={file.download_url} alt={name} />
        )}
      </div>
    );
  } else if (isMarkdown && mode === 'preview') {
    body = rendered.isLoading ? <Loading /> : <div className="pad-lg">{<Markdown html={rendered.data ?? ''} />}</div>;
  } else if (raw.isLoading) {
    body = <Loading />;
  } else if (!decoded || decoded.binary) {
    body = (
      <p className="muted pad">
        {decoded?.binary ? 'Binary file not shown.' : 'This file is too large to display.'}{' '}
        <a href={file.download_url} data-external>
          Download
        </a>
      </p>
    );
  } else {
    body = (
      <div className="blob-code">
        <pre className="line-nums">{Array.from({ length: lines }, (_, i) => i + 1).join('\n')}</pre>
        <pre className="code">
          <code dangerouslySetInnerHTML={{ __html: html }} />
        </pre>
      </div>
    );
  }

  return (
    <div className="stack">
      <div className="toolbar">
        <BranchPicker repo={repo} current={ref} kind="blob" path={path} />
        <PathCrumbs repo={repo} gitRef={ref} path={path} />
      </div>
      <div className="card files">
        <LatestCommit repo={repo} gitRef={ref} path={path} />
      </div>
      <div className="card blob">
        <div className="card-head">
          {isMarkdown && (
            <Segmented
              value={mode}
              onChange={setMode}
              options={[
                { value: 'preview', label: 'Preview' },
                { value: 'code', label: 'Code' },
              ]}
            />
          )}
          <span className="muted small">
            {lines > 0 && `${lines} lines · `}
            {formatBytes(file.size)}
          </span>
          <span className="spacer" />
          {decoded && !decoded.binary && (
            <button className="btn sm" onClick={() => void copyText(decoded.text)}>
              <CopyIcon /> Copy
            </button>
          )}
          <a className="btn sm" href={file.html_url} data-external>
            Open on github.com
          </a>
        </div>
        {body}
      </div>
    </div>
  );
}
