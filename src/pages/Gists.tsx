import { CodeSquareIcon, CommentIcon, LockIcon, PlusIcon, RepoForkedIcon, StarFillIcon, StarIcon, TrashIcon } from '@primer/octicons-react';
import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { MarkdownEditor } from '../components/Editor';
import { CopyButton, ErrorBox, ListState, Loading, LoadMore, Segmented, Time } from '../components/ui';
import { ACCEPT, gh, invalidate, useGh, useGhPages } from '../lib/api';
import { useAuth } from '../lib/auth';
import { confirmDialog, useAction } from '../lib/feedback';
import { highlightLines } from '../lib/highlight';
import type { Gist, User } from '../lib/types';
import { formatBytes, plural } from '../lib/util';
import { Comment } from './Issues';

export function GistRow({ g }: { g: Gist }) {
  const names = Object.keys(g.files);
  return (
    <div className="row">
      <span className="state-icon">{g.public ? <CodeSquareIcon /> : <LockIcon />}</span>
      <div className="row-main">
        <div className="row-title">
          <Link to={`/gist/${g.id}`}>{names[0] ?? g.id}</Link>
          {!g.public && <span className="badge">Secret</span>}
          {names.length > 1 && <span className="badge">{plural(names.length, 'file')}</span>}
        </div>
        {g.description && <p className="row-desc">{g.description}</p>}
        <div className="meta">
          {g.owner?.login} · updated <Time iso={g.updated_at} />
        </div>
      </div>
      {g.comments > 0 && (
        <span className="row-side meta-item">
          <CommentIcon size={14} /> {g.comments}
        </span>
      )}
    </div>
  );
}

export function GistList({ path }: { path: string }) {
  const q = useGhPages<Gist>(path);
  return (
    <>
      <div className="card">
        <ListState q={q} count={q.items.length} empty="No gists" />
        {q.items.map((g) => (
          <GistRow key={g.id} g={g} />
        ))}
      </div>
      <LoadMore q={q} />
    </>
  );
}

export function Gists() {
  const [sp, setSp] = useSearchParams();
  const which = sp.get('show') ?? 'mine';
  const path = { mine: '/gists?per_page=30', starred: '/gists/starred?per_page=30', public: '/gists/public?per_page=30' }[which] ?? '/gists?per_page=30';
  return (
    <div className="page narrow">
      <header className="page-head">
        <h1>Gists</h1>
      </header>
      <div className="toolbar">
        <Segmented
          value={which}
          onChange={(v) => setSp(v === 'mine' ? {} : { show: v })}
          options={[
            { value: 'mine', label: 'Yours' },
            { value: 'starred', label: 'Starred' },
            { value: 'public', label: 'Discover' },
          ]}
        />
        <span className="spacer" />
        <Link className="btn primary" to="/gists/new">
          <PlusIcon /> New gist
        </Link>
      </div>
      <GistList key={path} path={path} />
    </div>
  );
}

export function GistDetail() {
  const { id } = useParams();
  const { viewer } = useAuth();
  const navigate = useNavigate();
  const api = `/gists/${id}`;
  const q = useGh<Gist>(api);
  const star = useGh(`${api}/star`);
  const comments = useGhPages<{ id: number; user: User; body: string; body_html?: string; created_at: string }>(`${api}/comments?per_page=100`, { accept: ACCEPT.full });
  const [comment, setComment] = useState('');
  const { busy, run } = useAction();
  const act = (fn: () => Promise<unknown>, done?: string) => run(async () => (await fn(), await invalidate(api)), done);
  if (q.isLoading) return <Loading />;
  if (q.error) return <ErrorBox error={q.error} />;
  const g = q.data!;
  const mine = g.owner?.login === viewer.login;
  const files = Object.values(g.files);
  return (
    <div className="page">
      <div className="repo-head">
        <h1>
          <CodeSquareIcon />
          {g.owner && <Link to={`/${g.owner.login}`}>{g.owner.login}</Link>}
          <span className="muted">/</span>
          <span className="strong">{files[0]?.filename ?? g.id}</span>
          <span className="badge">{g.public ? 'Public' : 'Secret'}</span>
        </h1>
        <div className="repo-actions">
          <button className={`btn ${star.isSuccess ? 'on' : ''}`} disabled={busy} onClick={() => act(() => gh(`${api}/star`, { method: star.isSuccess ? 'DELETE' : 'PUT' }))}>
            {star.isSuccess ? <StarFillIcon /> : <StarIcon />} {star.isSuccess ? 'Starred' : 'Star'}
          </button>
          {!mine && (
            <button className="btn" disabled={busy} onClick={() => run(async () => navigate(`/gist/${(await gh<Gist>(`${api}/forks`, { method: 'POST' })).id}`), 'Forked')}>
              <RepoForkedIcon /> Fork
            </button>
          )}
          {mine && (
            <>
              <Link className="btn" to={`/gist/${g.id}/edit`}>
                Edit
              </Link>
              <button
                className="btn danger"
                disabled={busy}
                onClick={async () => {
                  if (!(await confirmDialog({ title: 'Delete this gist?', body: 'This cannot be undone.', confirmLabel: 'Delete gist', danger: true }))) return;
                  await run(async () => (await gh(api, { method: 'DELETE' }), await invalidate('/gists')), 'Gist deleted');
                  navigate('/gists', { replace: true });
                }}
              >
                <TrashIcon /> Delete
              </button>
            </>
          )}
          <a className="btn" href={g.html_url} data-external>
            Open on GitHub
          </a>
        </div>
      </div>
      {g.description && <p className="muted">{g.description}</p>}
      {files.map((f) => (
        <GistFile key={f.filename} f={f} />
      ))}
      <div className="timeline narrow-col">
        {comments.items.map((c) => (
          <Comment
            key={c.id}
            c={c}
            context=""
            onSave={c.user?.login === viewer.login ? (body) => act(() => gh(`${api}/comments/${c.id}`, { method: 'PATCH', body: { body } })) : undefined}
            onDelete={c.user?.login === viewer.login || mine ? () => act(() => gh(`${api}/comments/${c.id}`, { method: 'DELETE' })) : undefined}
          />
        ))}
        <div className="composer">
          <MarkdownEditor value={comment} onChange={setComment} context="" />
          <div className="form-foot">
            <span className="spacer" />
            <button className="btn primary" disabled={busy || !comment.trim()} onClick={() => act(async () => (await gh(`${api}/comments`, { method: 'POST', body: { body: comment } }), setComment('')))}>
              Comment
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function GistFile({ f }: { f: Gist['files'][string] }) {
  const text = f.content ?? '';
  const html = useMemo(() => highlightLines(text.replace(/\n$/, ''), f.filename), [text, f.filename]);
  return (
    <div className="card blob">
      <div className="card-head">
        <strong className="mono small">{f.filename}</strong>
        <span className="muted small">
          {f.language ? `${f.language} · ` : ''}
          {formatBytes(f.size)}
        </span>
        <span className="spacer" />
        <CopyButton text={text} label="Copy" />
        <a className="btn sm" href={f.raw_url} data-external>
          Raw
        </a>
      </div>
      {f.truncated && <p className="muted small pad">This file is truncated. Open Raw for the rest.</p>}
      <div className="blob-code">
        <div className="blob-lines">
          {html.map((line, i) => (
            <div key={i} className="bl">
              <span className="ln">{i + 1}</span>
              <span className="bl-text" dangerouslySetInnerHTML={{ __html: line || ' ' }} />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

interface Draft {
  name: string;
  content: string;
  // the name it had when loaded, to rename or delete on save
  was?: string;
}

export function GistForm() {
  const { id } = useParams();
  const navigate = useNavigate();
  const existing = useGh<Gist>(id && `/gists/${id}`);
  const [description, setDescription] = useState('');
  const [files, setFiles] = useState<Draft[]>([{ name: '', content: '' }]);
  const [removed, setRemoved] = useState<string[]>([]);
  const { busy, run } = useAction();
  useEffect(() => {
    const g = existing.data;
    if (!g) return;
    setDescription(g.description ?? '');
    setFiles(Object.values(g.files).map((f) => ({ name: f.filename, content: f.content ?? '', was: f.filename })));
  }, [existing.data]);
  if (id && existing.isLoading) return <Loading />;

  const patch = (i: number, change: Partial<Draft>) => setFiles(files.map((f, j) => (j === i ? { ...f, ...change } : f)));
  const save = (isPublic: boolean) =>
    run(async () => {
      const body: Record<string, { content: string; filename?: string } | null> = {};
      files.forEach((f, i) => {
        const name = f.name.trim() || `gistfile${i + 1}.txt`;
        body[f.was ?? name] = { content: f.content, ...(f.was && f.was !== name ? { filename: name } : {}) };
      });
      for (const name of removed) body[name] = null;
      const saved = await gh<Gist>(id ? `/gists/${id}` : '/gists', { method: id ? 'PATCH' : 'POST', body: { description, files: body, ...(id ? {} : { public: isPublic }) } });
      await invalidate('/gists');
      navigate(`/gist/${saved.id}`, { replace: true });
    });
  const ready = files.length > 0 && files.every((f) => f.content.trim());

  return (
    <div className="page narrow">
      <header className="page-head">
        <h1>{id ? 'Edit gist' : 'New gist'}</h1>
      </header>
      <input className="input" placeholder="Description (optional)" value={description} onChange={(e) => setDescription(e.target.value)} aria-label="Description" />
      {files.map((f, i) => (
        <div key={i} className="card">
          <div className="card-head">
            <input className="input name-input" placeholder="Filename including extension…" value={f.name} onChange={(e) => patch(i, { name: e.target.value })} aria-label="Filename" />
            <span className="spacer" />
            {files.length > 1 && (
              <button
                className="icon-btn sm"
                title="Remove file"
                aria-label="Remove file"
                onClick={() => {
                  if (f.was) setRemoved([...removed, f.was]);
                  setFiles(files.filter((_, j) => j !== i));
                }}
              >
                <TrashIcon />
              </button>
            )}
          </div>
          <textarea className="input code-editor flat" spellCheck={false} value={f.content} onChange={(e) => patch(i, { content: e.target.value })} aria-label="File contents" />
        </div>
      ))}
      <div className="form-foot">
        <button className="btn" onClick={() => setFiles([...files, { name: '', content: '' }])}>
          <PlusIcon /> Add file
        </button>
        <span className="spacer" />
        <button className="btn" onClick={() => navigate(-1)}>
          Cancel
        </button>
        {id ? (
          <button className="btn primary" disabled={busy || !ready} onClick={() => save(false)}>
            Update gist
          </button>
        ) : (
          <>
            <button className="btn" disabled={busy || !ready} onClick={() => save(false)}>
              Create secret gist
            </button>
            <button className="btn primary" disabled={busy || !ready} onClick={() => save(true)}>
              Create public gist
            </button>
          </>
        )}
      </div>
    </div>
  );
}
