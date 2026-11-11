import { GitBranchIcon, GitCommitIcon } from '@primer/octicons-react';
import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { DiffFile } from '../components/Diff';
import { Empty, ErrorBox, Loading } from '../components/ui';
import { gh, invalidate, useGh } from '../lib/api';
import { useAuth } from '../lib/auth';
import { encPath } from '../lib/util';
import { MarkdownEditor } from './Issues';
import { useRepo } from './Repo';

/* ── Repository settings ─────────────────────────────────── */

const FEATURES: [string, string][] = [
  ['has_issues', 'Issues'],
  ['has_wiki', 'Wiki'],
  ['has_projects', 'Projects'],
  ['has_discussions', 'Discussions'],
];
const MERGING: [string, string][] = [
  ['allow_merge_commit', 'Allow merge commits'],
  ['allow_squash_merge', 'Allow squash merging'],
  ['allow_rebase_merge', 'Allow rebase merging'],
  ['delete_branch_on_merge', 'Automatically delete head branches after merging'],
];
const SETTING_KEYS = ['name', 'description', 'homepage', 'default_branch', ...FEATURES.map((f) => f[0]), ...MERGING.map((m) => m[0])];

export function RepoSettings() {
  const { repo } = useRepo();
  const navigate = useNavigate();
  const api = `/repos/${repo.full_name}`;
  const branches = useGh<any[]>(`${api}/branches?per_page=100`);
  const initial = useMemo(() => Object.fromEntries(SETTING_KEYS.map((k) => [k, repo[k] ?? (typeof repo[k] === 'boolean' ? false : '')])), [repo]);
  const [form, setForm] = useState<Record<string, any>>(initial);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  useEffect(() => setForm(initial), [initial]);

  if (!repo.permissions?.admin) return <Empty title="Settings need admin access">You can view this repository but not change its settings.</Empty>;

  const set = (key: string, value: unknown) => setForm((f) => ({ ...f, [key]: value }));
  const changed = Object.fromEntries(Object.entries(form).filter(([k, v]) => v !== initial[k]));
  const dirty = Object.keys(changed).length > 0;

  const patch = async (body: Record<string, unknown>, done: string) => {
    setBusy(true);
    setMessage('');
    try {
      const updated = await gh<any>(api, { method: 'PATCH', body });
      await invalidate('/repos/');
      setMessage(done);
      if (updated.full_name !== repo.full_name) navigate(`/${updated.full_name}/settings`, { replace: true });
    } catch (e) {
      setMessage((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const toggleVisibility = () => {
    const to = repo.private ? 'public' : 'private';
    if (window.confirm(`Make ${repo.full_name} ${to}?${to === 'public' ? ' Anyone on the internet will be able to see it.' : ''}`))
      void patch({ private: !repo.private }, `Repository is now ${to}.`);
  };
  const toggleArchive = () => {
    const verb = repo.archived ? 'Unarchive' : 'Archive';
    if (window.confirm(`${verb} ${repo.full_name}?${repo.archived ? '' : ' It becomes read-only until unarchived.'}`))
      void patch({ archived: !repo.archived }, repo.archived ? 'Repository unarchived.' : 'Repository archived.');
  };

  return (
    <div className="stack narrow-form">
      {message && <div className="banner">{message}</div>}
      <section className="card">
        <div className="card-head">General</div>
        <div className="form-section form">
          <label>
            Repository name
            <input className="input" value={form.name} onChange={(e) => set('name', e.target.value)} />
          </label>
          <label>
            Description
            <textarea className="input" rows={2} value={form.description} onChange={(e) => set('description', e.target.value)} />
          </label>
          <label>
            Website
            <input className="input" placeholder="https://" value={form.homepage} onChange={(e) => set('homepage', e.target.value)} />
          </label>
          <label>
            Default branch
            <select className="input" value={form.default_branch} onChange={(e) => set('default_branch', e.target.value)}>
              {(branches.data ?? [{ name: repo.default_branch }]).map((b) => (
                <option key={b.name}>{b.name}</option>
              ))}
            </select>
          </label>
        </div>
        <div className="form-section form">
          <strong>Features</strong>
          {FEATURES.map(([key, label]) => (
            <label key={key} className="check-row">
              <input type="checkbox" checked={!!form[key]} onChange={(e) => set(key, e.target.checked)} /> {label}
            </label>
          ))}
        </div>
        <div className="form-section form">
          <strong>Pull requests</strong>
          {MERGING.map(([key, label]) => (
            <label key={key} className="check-row">
              <input type="checkbox" checked={!!form[key]} onChange={(e) => set(key, e.target.checked)} /> {label}
            </label>
          ))}
        </div>
        <div className="form-section">
          <div className="form-foot">
            <span className="muted small">{dirty ? `${Object.keys(changed).length} unsaved change${Object.keys(changed).length === 1 ? '' : 's'}` : 'No changes'}</span>
            <span className="spacer" />
            <button className="btn" disabled={!dirty || busy} onClick={() => setForm(initial)}>
              Reset
            </button>
            <button className="btn primary" disabled={!dirty || busy || !String(form.name).trim()} onClick={() => patch(changed, 'Settings saved.')}>
              {busy ? 'Saving…' : 'Save changes'}
            </button>
          </div>
        </div>
      </section>

      <section className="card">
        <div className="card-head">Visibility and state</div>
        <div className="row compact">
          <div className="row-main">
            <strong>This repository is {repo.private ? 'private' : 'public'}</strong>
            <span className="muted">{repo.private ? 'Only people with access can see it.' : 'Anyone can see it.'}</span>
          </div>
          <button className="btn" disabled={busy} onClick={toggleVisibility}>
            Make {repo.private ? 'public' : 'private'}
          </button>
        </div>
        <div className="row compact">
          <div className="row-main">
            <strong>{repo.archived ? 'This repository is archived' : 'Archive this repository'}</strong>
            <span className="muted">Archived repositories are read-only.</span>
          </div>
          <button className="btn" disabled={busy} onClick={toggleArchive}>
            {repo.archived ? 'Unarchive' : 'Archive'}
          </button>
        </div>
        <div className="row compact">
          <div className="row-main">
            <strong>Everything else</strong>
            <span className="muted">Collaborators, branch rules, secrets, webhooks, transfer and deletion stay on github.com.</span>
          </div>
          <a className="btn" href={`${repo.html_url}/settings`} data-external>
            Open on GitHub
          </a>
        </div>
      </section>
    </div>
  );
}

/* ── New repository ──────────────────────────────────────── */

export function NewRepo() {
  const { viewer } = useAuth();
  const navigate = useNavigate();
  const orgs = useGh<any[]>('/user/orgs?per_page=100');
  const [owner, setOwner] = useState(viewer.login);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [isPrivate, setPrivate] = useState(false);
  const [readme, setReadme] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const submit = async () => {
    setBusy(true);
    setError('');
    try {
      const body = { name: name.trim(), description, private: isPrivate, auto_init: readme };
      const created = await gh<any>(owner === viewer.login ? '/user/repos' : `/orgs/${owner}/repos`, { method: 'POST', body });
      await invalidate('/user/repos');
      navigate(`/${created.full_name}`, { replace: true });
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  };
  return (
    <div className="page narrow">
      <header className="page-head">
        <h1>New repository</h1>
        <p className="muted">A repository holds a project's files and their full history.</p>
      </header>
      {error && <div className="banner">{error}</div>}
      <section className="card">
        <div className="form-section form">
          <div className="split">
            <label>
              Owner
              <select className="input" value={owner} onChange={(e) => setOwner(e.target.value)}>
                <option>{viewer.login}</option>
                {orgs.data?.map((o) => <option key={o.id}>{o.login}</option>)}
              </select>
            </label>
            <label>
              Repository name
              <input className="input" autoFocus value={name} onChange={(e) => setName(e.target.value)} />
            </label>
          </div>
          <label>
            Description (optional)
            <input className="input" value={description} onChange={(e) => setDescription(e.target.value)} />
          </label>
        </div>
        <div className="form-section form">
          <label className="check-row">
            <input type="radio" checked={!isPrivate} onChange={() => setPrivate(false)} /> Public: anyone can see it
          </label>
          <label className="check-row">
            <input type="radio" checked={isPrivate} onChange={() => setPrivate(true)} /> Private: only you and people you invite
          </label>
          <label className="check-row">
            <input type="checkbox" checked={readme} onChange={(e) => setReadme(e.target.checked)} /> Add a README
          </label>
        </div>
        <div className="form-section">
          <div className="form-foot">
            <span className="spacer" />
            <button className="btn" onClick={() => navigate(-1)}>
              Cancel
            </button>
            <button className="btn primary" disabled={!name.trim() || busy} onClick={submit}>
              {busy ? 'Creating…' : 'Create repository'}
            </button>
          </div>
        </div>
      </section>
    </div>
  );
}

/* ── File editor: edit an existing file or create a new one ── */

const toBase64 = (text: string) => {
  const bytes = new TextEncoder().encode(text);
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
};
const fromBase64 = (b64: string) => new TextDecoder().decode(Uint8Array.from(atob(b64.replace(/\s/g, '')), (c) => c.charCodeAt(0)));

export function FileEditor({ create }: { create?: boolean }) {
  const { repo } = useRepo();
  const navigate = useNavigate();
  const splat = useParams()['*'] ?? '';
  const [ref = repo.default_branch, ...rest] = splat.split('/').filter(Boolean);
  const path = rest.join('/');
  const api = `/repos/${repo.full_name}/contents`;
  const existing = useGh<any>(!create && `${api}/${encPath(path)}?ref=${encodeURIComponent(ref)}`);
  const [name, setName] = useState('');
  const [text, setText] = useState<string | null>(create ? '' : null);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (create || text !== null || !existing.data) return;
    try {
      setText(fromBase64(existing.data.content ?? ''));
    } catch {
      setError('This file is not text and cannot be edited here.');
    }
  }, [existing.data]);

  if (!repo.permissions?.push) return <Empty title="You can't edit this repository">Fork it to propose changes.</Empty>;
  if (!create && existing.isLoading) return <Loading />;
  if (!create && existing.error) return <ErrorBox error={existing.error} retry={existing.refetch} />;

  const target = create ? [path, name.trim()].filter(Boolean).join('/') : path;
  const fallback = create ? `Create ${name.trim() || 'file'}` : `Update ${path.split('/').pop()}`;
  const commit = async () => {
    setBusy(true);
    setError('');
    try {
      await gh(`${api}/${encPath(target)}`, {
        method: 'PUT',
        body: { message: message.trim() || fallback, content: toBase64(text ?? ''), branch: ref, sha: create ? undefined : existing.data.sha },
      });
      await invalidate(`/repos/${repo.full_name}`);
      navigate(`/${repo.full_name}/blob/${ref}/${target}`, { replace: true });
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  };

  return (
    <div className="stack">
      <div className="toolbar">
        <span className="ref">
          <GitBranchIcon size={12} /> {ref}
        </span>
        <strong>{create ? `${path ? path + '/' : ''}` : path}</strong>
        {create && <input className="input name-input" autoFocus placeholder="Name your file…" value={name} onChange={(e) => setName(e.target.value)} />}
      </div>
      {error && <div className="banner">{error}</div>}
      <textarea className="input code-editor" spellCheck={false} value={text ?? ''} onChange={(e) => setText(e.target.value)} />
      <section className="card form-section form">
        <label>
          Commit message
          <input className="input" placeholder={fallback} value={message} onChange={(e) => setMessage(e.target.value)} />
        </label>
        <div className="form-foot">
          <span className="muted small">
            <GitCommitIcon size={12} /> Commits directly to {ref}
          </span>
          <span className="spacer" />
          <button className="btn" onClick={() => navigate(-1)}>
            Cancel
          </button>
          <button className="btn primary" disabled={busy || text === null || (create && !name.trim())} onClick={commit}>
            {busy ? 'Committing…' : 'Commit changes'}
          </button>
        </div>
      </section>
    </div>
  );
}

/* ── New pull request ────────────────────────────────────── */

export function NewPull() {
  const { repo } = useRepo();
  const navigate = useNavigate();
  const [sp, setSp] = useSearchParams();
  const api = `/repos/${repo.full_name}`;
  const branches = useGh<any[]>(`${api}/branches?per_page=100`);
  const names = (branches.data ?? []).map((b) => b.name);
  const base = sp.get('base') ?? repo.default_branch;
  const head = sp.get('head') ?? names.find((n) => n !== base) ?? '';
  const cmp = useGh<any>(!!head && head !== base && `${api}/compare/${encodeURIComponent(base)}...${encodeURIComponent(head)}`);
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [draft, setDraft] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const pick = (key: 'base' | 'head', value: string) => {
    const next = new URLSearchParams(sp);
    next.set(key, value);
    setSp(next, { replace: true });
  };
  const commits: any[] = cmp.data?.commits ?? [];
  const fallbackTitle = commits.length === 1 ? commits[0].commit.message.split('\n')[0] : head.replace(/[-_/]+/g, ' ');
  const submit = async () => {
    setBusy(true);
    setError('');
    try {
      const created = await gh<any>(`${api}/pulls`, { method: 'POST', body: { title: title.trim() || fallbackTitle, body, head, base, draft } });
      navigate(`/${repo.full_name}/pull/${created.number}`, { replace: true });
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  };

  return (
    <div className="stack">
      <h2 className="title">Open a pull request</h2>
      <div className="toolbar">
        <label className="meta-item">
          base
          <select className="input select" value={base} onChange={(e) => pick('base', e.target.value)}>
            {names.map((n) => <option key={n}>{n}</option>)}
          </select>
        </label>
        <span className="muted">←</span>
        <label className="meta-item">
          compare
          <select className="input select" value={head} onChange={(e) => pick('head', e.target.value)}>
            {names.map((n) => <option key={n}>{n}</option>)}
          </select>
        </label>
        {cmp.data && (
          <span className="muted">
            {cmp.data.ahead_by} commit{cmp.data.ahead_by === 1 ? '' : 's'} ahead, {cmp.data.behind_by} behind
          </span>
        )}
      </div>
      {error && <div className="banner">{error}</div>}
      {branches.isLoading || cmp.isLoading ? (
        <Loading />
      ) : cmp.error ? (
        <ErrorBox error={cmp.error} retry={cmp.refetch} />
      ) : !cmp.data || commits.length === 0 ? (
        <Empty title="Nothing to compare">Choose two branches where the compare branch has commits the base doesn't.</Empty>
      ) : (
        <>
          <section className="card form-section form">
            <input className="input" placeholder={fallbackTitle} value={title} onChange={(e) => setTitle(e.target.value)} />
            <MarkdownEditor value={body} onChange={setBody} context={repo.full_name} placeholder="Describe what this changes and why." rows={8} />
            <div className="form-foot">
              <label className="check-row">
                <input type="checkbox" checked={draft} onChange={(e) => setDraft(e.target.checked)} /> Create as draft
              </label>
              <span className="spacer" />
              <button className="btn primary" disabled={busy} onClick={submit}>
                {busy ? 'Creating…' : draft ? 'Create draft pull request' : 'Create pull request'}
              </button>
            </div>
          </section>
          <section className="card">
            <div className="card-head">
              {commits.length} commit{commits.length === 1 ? '' : 's'}
            </div>
            {commits.map((c) => (
              <div key={c.sha} className="row compact">
                <span className="state-icon">
                  <GitCommitIcon />
                </span>
                <Link className="row-main" to={`/${repo.full_name}/commit/${c.sha}`}>
                  {c.commit.message.split('\n')[0]}
                </Link>
                <code className="row-side">{c.sha.slice(0, 7)}</code>
              </div>
            ))}
          </section>
          {cmp.data.files?.map((f: any) => <DiffFile key={f.filename} file={f} />)}
        </>
      )}
    </div>
  );
}
