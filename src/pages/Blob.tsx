import { HistoryIcon, KebabHorizontalIcon, PencilIcon, TrashIcon } from '@primer/octicons-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom';
import { Avatar, CopyButton, Dropdown, ErrorBox, Loading, Markdown, Segmented } from '../components/ui';
import { ACCEPT, gh, invalidate, useGh, useGql, webUrl } from '../lib/api';
import { confirmDialog, toast, toastError } from '../lib/feedback';
import { escapeHtml, HIGHLIGHT_LIMIT, highlightLines } from '../lib/highlight';
import { copyText, encPath, formatBytes, parseLineHash, shortAgo } from '../lib/util';
import { BranchPicker, LatestCommit, PathCrumbs, useRefPath, useRepo } from './Repo';

const IMAGE_EXT = /\.(png|jpe?g|gif|webp|svg|ico|bmp|avif)$/i;
const MIME: Record<string, string> = { svg: 'image/svg+xml', jpg: 'image/jpeg', ico: 'image/x-icon' };
// lines are rendered in chunks the browser can skip while offscreen
const CHUNK = 200;
const FIRST_LINES = 5000;

function decodeBase64(b64: string): { text: string; binary: boolean } {
  const bytes = Uint8Array.from(atob(b64.replace(/\s/g, '')), (c) => c.charCodeAt(0));
  return { text: new TextDecoder().decode(bytes), binary: bytes.subarray(0, 8000).includes(0) };
}

interface BlameRange {
  startingLine: number;
  endingLine: number;
  commit: { oid: string; messageHeadline: string; committedDate: string; author: { name: string; user: { login: string; avatarUrl: string } | null } | null };
}

const BLAME_QUERY = `
query($owner: String!, $name: String!, $expr: String!, $path: String!) {
  repository(owner: $owner, name: $name) {
    object(expression: $expr) {
      ... on Commit { blame(path: $path) { ranges {
        startingLine endingLine
        commit { oid messageHeadline committedDate author { name user { login avatarUrl } } }
      } } }
    }
  }
}`;

function CodeLines({
  html,
  selected,
  onPick,
  blame,
  repoPath,
}: {
  html: string[];
  selected: [number, number] | null;
  onPick: (line: number, extend: boolean) => void;
  blame?: BlameRange[];
  repoPath: string;
}) {
  const [all, setAll] = useState(false);
  const shown = all || (selected && selected[1] > FIRST_LINES) ? html.length : Math.min(html.length, FIRST_LINES);
  const starts = useMemo(() => new Map((blame ?? []).map((r) => [r.startingLine, r])), [blame]);
  const chunks = [];
  for (let from = 0; from < shown; from += CHUNK) {
    chunks.push(
      <div key={from} className="code-chunk" style={{ containIntrinsicSize: `auto ${Math.min(CHUNK, shown - from) * 20}px` }}>
        {html.slice(from, Math.min(from + CHUNK, shown)).map((line, i) => {
          const n = from + i + 1;
          const on = selected && n >= selected[0] && n <= selected[1];
          const b = starts.get(n);
          return (
            <div key={n} id={`L${n}`} className={`bl ${on ? 'on' : ''} ${b ? 'blame-start' : ''}`}>
              {blame && (
                <span className="blame-cell">
                  {b && (
                    <>
                      <Avatar user={b.commit.author?.user ? { login: b.commit.author.user.login, avatar_url: b.commit.author.user.avatarUrl } : null} size={16} />
                      <Link to={`${repoPath}/commit/${b.commit.oid}`} title={`${b.commit.author?.user?.login ?? b.commit.author?.name ?? ''}: ${b.commit.messageHeadline}`}>
                        {b.commit.messageHeadline}
                      </Link>
                      <span className="muted">{shortAgo(b.commit.committedDate)}</span>
                    </>
                  )}
                </span>
              )}
              <button className="ln" tabIndex={-1} aria-label={`Line ${n}`} onClick={(e) => onPick(n, e.shiftKey)}>
                {n}
              </button>
              <span className="bl-text" dangerouslySetInnerHTML={{ __html: line || ' ' }} />
            </div>
          );
        })}
      </div>,
    );
  }
  return (
    <div className="blob-code">
      <div className="blob-lines">{chunks}</div>
      {shown < html.length && (
        <p className="pad">
          <button className="btn sm" onClick={() => setAll(true)}>
            Show all {html.length.toLocaleString()} lines
          </button>
        </p>
      )}
    </div>
  );
}

export function Blob({ blame }: { blame?: boolean }) {
  const { repo } = useRepo();
  const { ref, path, loading } = useRefPath(repo);
  const loc = useLocation();
  const navigate = useNavigate();
  const api = `/repos/${repo.full_name}/contents/${encPath(path)}?ref=${encodeURIComponent(ref)}`;
  const meta = useGh<any>(!loading && api);
  const name = path.split('/').pop() ?? '';
  const isImage = IMAGE_EXT.test(name);
  const isMarkdown = /\.(md|markdown|mdx)$/i.test(name);
  const [mode, setMode] = useState<'preview' | 'code'>('preview');
  const selected = parseLineHash(loc.hash);
  const showCode = blame || !isMarkdown || mode === 'code' || !!selected;
  // the contents api omits inline content above 1 mb
  const tooBig = !!meta.data && !Array.isArray(meta.data) && !meta.data.content && meta.data.size > 0;
  const raw = useGh<string>(tooBig && !isImage && meta.data.size < 5_000_000 && api, { accept: ACCEPT.raw, text: true });
  const rendered = useGh<string>(isMarkdown && !showCode && !loading && api, { accept: ACCEPT.html, text: true });
  const blameQ = useGql<any>('blame', BLAME_QUERY, { owner: repo.owner.login, name: repo.name, expr: ref, path }, !!blame && !loading);
  const ranges: BlameRange[] | undefined = blameQ.data?.repository?.object?.blame?.ranges;

  const decoded = useMemo(() => {
    if (raw.data != null) return { text: raw.data, binary: false };
    if (!meta.data?.content || isImage) return null;
    try {
      return decodeBase64(meta.data.content);
    } catch {
      return { text: '', binary: true };
    }
  }, [meta.data, raw.data, isImage]);
  const html = useMemo(() => {
    if (!decoded || decoded.binary) return [];
    const text = decoded.text.replace(/\n$/, '');
    return text.length < HIGHLIGHT_LIMIT ? highlightLines(text, name) : text.split('\n').map(escapeHtml);
  }, [decoded, name]);

  const route = (kind: string, hash = '') => `/${repo.full_name}/${kind}/${ref}/${path}${hash}`;
  const permalink = async () => {
    try {
      const sha = await gh<string>(`/repos/${repo.full_name}/commits/${encodeURIComponent(ref)}`, { accept: 'application/vnd.github.sha', text: true });
      await copyText(webUrl(`/${repo.full_name}/blob/${sha}/${path}${loc.hash}`));
      toast('Permalink copied');
    } catch (e) {
      toastError(e);
    }
  };

  // scroll to the selected line when arriving, not when picking one
  const skip = useRef(false);
  useEffect(() => {
    if (skip.current) return void (skip.current = false);
    if (!selected || !html.length) return;
    requestAnimationFrame(() => document.getElementById(`L${selected[0]}`)?.scrollIntoView({ block: 'center' }));
  }, [html.length, loc.hash]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const typing = /^(INPUT|TEXTAREA|SELECT)$/.test((e.target as HTMLElement).tagName);
      if (typing || e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.key === 'y') void permalink();
      else if (e.key === 'b') navigate(route(blame ? 'blob' : 'blame', loc.hash));
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  });

  if (loading || meta.isLoading) return <Loading />;
  if (meta.error) return <ErrorBox error={meta.error} />;
  if (Array.isArray(meta.data)) return <Navigate replace to={`/${repo.full_name}/tree/${ref}/${path}`} />;
  const file = meta.data;
  const ext = name.split('.').pop()!.toLowerCase();
  const remove = async () => {
    if (!(await confirmDialog({ title: `Delete ${name}?`, body: `This commits directly to ${ref}.`, confirmLabel: 'Delete file', danger: true }))) return;
    try {
      await gh(`/repos/${repo.full_name}/contents/${encPath(path)}`, { method: 'DELETE', body: { message: `Delete ${name}`, sha: file.sha, branch: ref } });
      await invalidate(`/repos/${repo.full_name}`);
      navigate(`/${repo.full_name}/tree/${ref}${path.includes('/') ? '/' + path.slice(0, path.lastIndexOf('/')) : ''}`, { replace: true });
    } catch (e) {
      toastError(e);
    }
  };
  const pick = (line: number, extend: boolean) => {
    const from = extend && selected ? Math.min(selected[0], line) : line;
    const to = extend && selected ? Math.max(selected[1], line) : line;
    const same = selected && selected[0] === from && selected[1] === to;
    skip.current = true;
    navigate({ hash: same ? '' : from === to ? `#L${from}` : `#L${from}-L${to}` }, { replace: true });
  };

  let body;
  if (isImage) {
    body = (
      <div className="blob-image">
        {file.content ? <img src={`data:${MIME[ext] ?? `image/${ext}`};base64,${file.content.replace(/\s/g, '')}`} alt={name} /> : <img src={file.download_url} alt={name} />}
      </div>
    );
  } else if (!showCode) {
    body = rendered.isLoading ? (
      <Loading />
    ) : (
      <div className="pad-lg">
        <Markdown html={rendered.data ?? ''} base={{ repo: repo.full_name, ref, dir: path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '' }} />
      </div>
    );
  } else if (raw.isLoading || (blame && blameQ.isLoading)) {
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
    body = <CodeLines html={html} selected={selected} onPick={pick} blame={blame ? (ranges ?? []) : undefined} repoPath={`/${repo.full_name}`} />;
  }

  return (
    <div className="stack">
      <div className="toolbar">
        <BranchPicker repo={repo} current={ref} kind={blame ? 'blame' : 'blob'} path={path} />
        <PathCrumbs repo={repo} gitRef={ref} path={path} />
        <CopyButton text={path} className="icon-btn sm" />
      </div>
      <div className="card">
        <LatestCommit repo={repo} gitRef={ref} path={path} />
      </div>
      <div className="card blob">
        <div className="card-head">
          {blame ? (
            <strong>Blame</strong>
          ) : (
            isMarkdown && (
              <Segmented
                value={showCode ? 'code' : 'preview'}
                onChange={(m) => {
                  setMode(m);
                  if (loc.hash) navigate({ hash: '' }, { replace: true });
                }}
                options={[
                  { value: 'preview', label: 'Preview' },
                  { value: 'code', label: 'Code' },
                ]}
              />
            )
          )}
          <span className="muted small">
            {html.length > 0 && `${html.length.toLocaleString()} lines · `}
            {formatBytes(file.size)}
          </span>
          <span className="spacer" />
          {decoded && !decoded.binary && <CopyButton text={decoded.text} label="Copy" />}
          {!isImage && (
            <Link className={`btn sm ${blame ? 'on' : ''}`} to={route(blame ? 'blob' : 'blame')} title="Toggle blame (B)">
              Blame
            </Link>
          )}
          <Link className="btn sm" to={`/${repo.full_name}/commits/${ref}/${path}`}>
            <HistoryIcon /> History
          </Link>
          {repo.permissions?.push && decoded && !decoded.binary && (
            <Link className="btn sm" to={`/${repo.full_name}/edit/${ref}/${path}`}>
              <PencilIcon /> Edit
            </Link>
          )}
          <Dropdown align="right" className="icon-btn sm" title="More" trigger={<KebabHorizontalIcon />}>
            {(close) => (
              <div className="menu" onClick={close}>
                <a href={file.download_url} data-external>
                  Raw
                </a>
                <button onClick={() => void permalink()}>Copy permalink (Y)</button>
                <a href={file.html_url} data-external>
                  Open on GitHub
                </a>
                {repo.permissions?.push && (
                  <>
                    <hr />
                    <button onClick={remove}>
                      <TrashIcon /> Delete file
                    </button>
                  </>
                )}
              </div>
            )}
          </Dropdown>
        </div>
        {body}
      </div>
    </div>
  );
}
