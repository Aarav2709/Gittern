import { invoke } from '@tauri-apps/api/core';
import {
  ArrowDownIcon,
  ArrowUpIcon,
  CheckIcon,
  DeviceDesktopIcon,
  DiffAddedIcon,
  DiffModifiedIcon,
  DiffRemovedIcon,
  DiffRenamedIcon,
  FileDirectoryIcon,
  GitBranchIcon,
  HistoryIcon,
  KebabHorizontalIcon,
  PlusIcon,
  RepoCloneIcon,
  RepoIcon,
  SyncIcon,
  TrashIcon,
  TriangleDownIcon,
  AlertIcon,
} from '@primer/octicons-react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { type ReactNode, useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { DiffFile } from '../components/Diff';
import { Dropdown, Empty, Loading, Modal, RepoGlyph, Segmented } from '../components/ui';
import { ghHost, isTauri, useGh } from '../lib/api';
import { confirmDialog, toast, useAction, useDraft } from '../lib/feedback';
import { usePref } from '../lib/store';
import type { DiffFileEntry, Repo } from '../lib/types';
import { plural, shortAgo } from '../lib/util';

interface LocalRepo {
  path: string;
  name: string;
}
interface FileChange {
  path: string;
  status: 'new' | 'modified' | 'deleted' | 'renamed' | 'conflict';
  untracked: boolean;
}
interface Status {
  branch: string;
  upstream: string | null;
  ahead: number;
  behind: number;
  files: FileChange[];
}
interface LogEntry {
  sha: string;
  subject: string;
  author: string;
  date: string;
}

// splits `git diff` output into one entry per file
export function splitPatch(text: string): DiffFileEntry[] {
  const out: DiffFileEntry[] = [];
  for (const chunk of text.split(/^diff --git /m).slice(1)) {
    const lines = chunk.split('\n');
    const at = lines.findIndex((l) => l.startsWith('@@'));
    const head = at < 0 ? lines : lines.slice(0, at);
    const pick = (prefix: string) => head.find((l) => l.startsWith(prefix))?.slice(prefix.length).replace(/^[ab]\//, '').replace(/\t$/, '');
    const to = pick('+++ ');
    const from = pick('--- ');
    const renamedTo = pick('rename to ');
    const fallback = /^a\/(.*) b\/(.*)$/.exec(lines[0])?.[2] ?? lines[0];
    const filename = (to && to !== '/dev/null' ? to : from && from !== '/dev/null' ? from : renamedTo) ?? fallback;
    const body = at < 0 ? [] : lines.slice(at);
    if (body.at(-1) === '') body.pop();
    const status = head.some((l) => l.startsWith('new file')) ? 'added' : head.some((l) => l.startsWith('deleted file')) ? 'removed' : renamedTo ? 'renamed' : 'modified';
    const additions = body.filter((l) => l.startsWith('+')).length;
    const deletions = body.filter((l) => l.startsWith('-')).length;
    out.push({
      sha: filename,
      filename,
      previous_filename: renamedTo ? pick('rename from ') : undefined,
      status,
      additions,
      deletions,
      changes: additions + deletions,
      patch: body.length ? body.join('\n') : undefined,
    });
  }
  return out;
}

// maps an origin url on the signed-in host to its page in the app
export function remoteRoute(url: string, host = ghHost()): string | null {
  const m = new RegExp(`^(?:https://${host.replace(/\./g, '\\.')}/|git@${host.replace(/\./g, '\\.')}:|ssh://git@${host.replace(/\./g, '\\.')}/)([^/]+)/([^/]+?)(?:\\.git)?/?$`).exec(url.trim());
  return m ? `/${m[1]}/${m[2]}` : null;
}

function useLocal<T>(cmd: string, args: Record<string, unknown> | null, o?: { refetchInterval?: number }) {
  return useQuery<T, string>({
    queryKey: ['local', cmd, args],
    queryFn: () => invoke<T>(cmd, args ?? {}),
    enabled: isTauri && args !== null,
    staleTime: 2000,
    retry: false,
    refetchInterval: o?.refetchInterval,
  });
}

const STATUS_ICON: Record<FileChange['status'], ReactNode> = {
  new: <DiffAddedIcon className="s-open" />,
  modified: <DiffModifiedIcon className="s-pending" />,
  deleted: <DiffRemovedIcon className="s-closed" />,
  renamed: <DiffRenamedIcon className="s-merged" />,
  conflict: <AlertIcon className="s-closed" />,
};

function CloneDialog({ onClose, onDone, initial }: { onClose: () => void; onDone: (r: LocalRepo) => void; initial?: string }) {
  const mine = useGh<Repo[]>('/user/repos?sort=pushed&per_page=100&affiliation=owner,collaborator,organization_member');
  const [filter, setFilter] = useState(initial ?? '');
  const { busy, run } = useAction();
  const typed = filter.trim();
  const isUrl = /^(https:\/\/|git@|ssh:\/\/)/.test(typed);
  const shorthand = /^[\w.-]+\/[\w.-]+$/.test(typed) ? `https://${ghHost()}/${typed}.git` : null;
  const clone = (url: string) =>
    run(async () => {
      const repo = await invoke<LocalRepo | null>('clone_repo', { url });
      if (repo) {
        toast(`Cloned ${repo.name}`);
        onDone(repo);
      }
    });
  const shown = (mine.data ?? []).filter((r) => r.full_name.toLowerCase().includes(typed.toLowerCase()));
  return (
    <Modal title="Clone a repository" onClose={onClose} wide>
      <div className="dialog-body">
        <input className="input" autoFocus placeholder="Filter your repositories, or type owner/repo or a URL" value={filter} onChange={(e) => setFilter(e.target.value)} aria-label="Repository" />
        {busy ? (
          <Loading label="Cloning… pick a folder if asked" />
        ) : (
          <div className="menu-scroll clone-list">
            {(isUrl || shorthand) && (
              <button onClick={() => clone(isUrl ? typed : shorthand!)}>
                <RepoCloneIcon /> Clone {isUrl ? typed : typed}
              </button>
            )}
            {mine.isLoading && <Loading />}
            {shown.map((r) => (
              <button key={r.id} onClick={() => clone(r.clone_url)}>
                <RepoGlyph repo={r} />
                <span className="side-label">{r.full_name}</span>
                {r.pushed_at && <span className="muted small">{shortAgo(r.pushed_at)}</span>}
              </button>
            ))}
          </div>
        )}
        <span className="muted small">You'll choose the destination folder next. Private repositories clone with your Gittern sign-in.</span>
      </div>
    </Modal>
  );
}

function Changes({ repo, status, refresh }: { repo: LocalRepo; status: Status; refresh: () => Promise<unknown> }) {
  const [picked, setPicked] = useState<string | null>(null);
  const [skipped, setSkipped] = useState<Set<string>>(new Set());
  const [summary, setSummary, clearSummary] = useDraft(`commit-summary:${repo.path}`);
  const [description, setDescription, clearDescription] = useDraft(`commit-body:${repo.path}`);
  const [layout] = usePref('diff-layout', 'unified');
  const { busy, run } = useAction();
  const files = status.files;
  const current = files.find((f) => f.path === picked) ?? files[0];
  const diff = useLocal<string>('git_diff', current ? { repo: repo.path, path: current.path, untracked: current.untracked } : null);
  const entries = useMemo(() => (diff.data ? splitPatch(diff.data) : []), [diff.data]);
  const included = files.filter((f) => !skipped.has(f.path));
  const toggle = (path: string) => {
    const next = new Set(skipped);
    if (!next.delete(path)) next.add(path);
    setSkipped(next);
  };
  const commit = () =>
    run(async () => {
      await invoke('git_commit', { repo: repo.path, summary, description, paths: included.map((f) => f.path) });
      clearSummary();
      clearDescription();
      setSkipped(new Set());
      await refresh();
    }, 'Committed');
  const discard = async (list: FileChange[]) => {
    const what = list.length === 1 ? list[0].path : plural(list.length, 'file');
    if (!(await confirmDialog({ title: `Discard changes to ${what}?`, body: 'This throws the changes away. It cannot be undone.', confirmLabel: 'Discard', danger: true }))) return;
    void run(async () => (await invoke('git_discard', { repo: repo.path, files: list.map((f) => ({ path: f.path, untracked: f.untracked })) }), await refresh()), 'Changes discarded');
  };

  return (
    <>
      <div className="local-list">
        <div className="local-list-head">
          <label className="check-row">
            <input type="checkbox" checked={files.length > 0 && included.length === files.length} onChange={(e) => setSkipped(e.target.checked ? new Set() : new Set(files.map((f) => f.path)))} />
            {plural(files.length, 'changed file')}
          </label>
          <span className="spacer" />
          {files.length > 0 && (
            <button className="icon-btn sm" title="Discard all changes" aria-label="Discard all changes" disabled={busy} onClick={() => discard(files)}>
              <TrashIcon size={14} />
            </button>
          )}
        </div>
        <div className="local-scroll">
          {files.map((f) => (
            <div key={f.path} className={`local-file ${f.path === current?.path ? 'active' : ''}`} onClick={() => setPicked(f.path)}>
              <input type="checkbox" checked={!skipped.has(f.path)} onClick={(e) => e.stopPropagation()} onChange={() => toggle(f.path)} aria-label={`Include ${f.path}`} />
              <span className="side-label" title={f.path}>
                <span className="muted">{f.path.slice(0, f.path.lastIndexOf('/') + 1)}</span>
                {f.path.slice(f.path.lastIndexOf('/') + 1)}
              </span>
              <button
                className="icon-btn sm local-discard"
                title="Discard changes"
                aria-label={`Discard changes to ${f.path}`}
                onClick={(e) => {
                  e.stopPropagation();
                  void discard([f]);
                }}
              >
                <TrashIcon size={12} />
              </button>
              <span title={f.status}>{STATUS_ICON[f.status]}</span>
            </div>
          ))}
        </div>
        <form
          className="commit-box"
          onSubmit={(e) => {
            e.preventDefault();
            void commit();
          }}
        >
          <input className="input" placeholder={current ? `Update ${current.path.split('/').pop()}` : 'Summary (required)'} value={summary} onChange={(e) => setSummary(e.target.value)} aria-label="Commit summary" />
          <textarea className="input" rows={3} placeholder="Description" value={description} onChange={(e) => setDescription(e.target.value)} aria-label="Commit description" />
          <button className="btn primary block" disabled={busy || !summary.trim() || included.length === 0}>
            {busy ? 'Committing…' : `Commit ${included.length ? plural(included.length, 'file') + ' ' : ''}to ${status.branch}`}
          </button>
          {status.ahead > 0 && (
            <button
              type="button"
              className="link-btn small"
              disabled={busy}
              onClick={async () => {
                if (await confirmDialog({ title: 'Undo the last commit?', body: 'Its changes come back as uncommitted work.', confirmLabel: 'Undo commit' }))
                  void run(async () => (await invoke('git_undo', { repo: repo.path }), await refresh()), 'Commit undone');
              }}
            >
              Undo last commit
            </button>
          )}
        </form>
      </div>
      <div className="local-diff">
        {!current ? (
          <Empty title="No local changes" icon={<CheckIcon size={22} />}>
            Edit files in {repo.name} and they show up here, ready to commit.
          </Empty>
        ) : diff.isLoading ? (
          <Loading />
        ) : diff.error ? (
          <Empty title="Could not read the diff">{String(diff.error)}</Empty>
        ) : entries.length ? (
          entries.map((f) => <DiffFile key={f.filename} file={f} split={layout === 'split'} />)
        ) : (
          <Empty title="Nothing to show">This file is empty or binary.</Empty>
        )}
      </div>
    </>
  );
}

function History({ repo }: { repo: LocalRepo }) {
  const log = useLocal<LogEntry[]>('git_log', { repo: repo.path, skip: 0 });
  const [picked, setPicked] = useState<string | null>(null);
  const [layout] = usePref('diff-layout', 'unified');
  const current = log.data?.find((c) => c.sha === picked) ?? log.data?.[0];
  const show = useLocal<string>('git_show', current ? { repo: repo.path, sha: current.sha } : null);
  const entries = useMemo(() => (show.data ? splitPatch(show.data) : []), [show.data]);
  return (
    <>
      <div className="local-list">
        <div className="local-scroll">
          {log.isLoading && <Loading />}
          {log.data?.map((c) => (
            <div key={c.sha} className={`local-commit ${c.sha === current?.sha ? 'active' : ''}`} onClick={() => setPicked(c.sha)}>
              <span className="work-title">{c.subject}</span>
              <span className="muted small">
                {c.author} · {shortAgo(c.date)} · <span className="mono">{c.sha.slice(0, 7)}</span>
              </span>
            </div>
          ))}
          {log.data?.length === 0 && <p className="muted pad">No commits yet.</p>}
        </div>
      </div>
      <div className="local-diff">
        {!current ? (
          <Empty title="No history yet" icon={<HistoryIcon size={22} />}>
            Your commits will appear here.
          </Empty>
        ) : show.isLoading ? (
          <Loading />
        ) : (
          <>
            <div className="card commit-card">
              <h2>{current.subject}</h2>
              <div className="meta">
                <strong>{current.author}</strong> committed {new Date(current.date).toLocaleString()} <span className="mono">{current.sha.slice(0, 7)}</span>
                <span className="spacer" />
                {plural(entries.length, 'changed file')}
              </div>
            </div>
            {entries.map((f) => (
              <DiffFile key={f.filename} file={f} split={layout === 'split'} />
            ))}
          </>
        )}
      </div>
    </>
  );
}

// the local git workspace: changes, history, branches and sync for a folder on this computer
export function Desktop() {
  const qc = useQueryClient();
  const [sp, setSp] = useSearchParams();
  const repos = useLocal<LocalRepo[]>('local_repos', {});
  const [currentPath, setCurrentPath] = usePref('local-repo', '');
  const [view, setView] = useState<'changes' | 'history'>('changes');
  const [cloning, setCloning] = useState(!!sp.get('clone'));
  const [branchName, setBranchName] = useState('');
  const { busy, run } = useAction();
  const repo = repos.data?.find((r) => r.path === currentPath) ?? repos.data?.[0];
  const args = repo ? { repo: repo.path } : null;
  const status = useLocal<Status>('git_status', args, { refetchInterval: 4000 });
  const branches = useLocal<{ current: string; all: string[] }>('git_branches', args);
  const remote = useLocal<string>('git_remote', args);
  const refresh = () => qc.invalidateQueries({ queryKey: ['local'] });
  // pick up edits made in an editor as soon as the window is back in front
  useEffect(() => {
    const on = () => void refresh();
    window.addEventListener('focus', on);
    return () => window.removeEventListener('focus', on);
  }, []);

  if (!isTauri) return <Empty title="Desktop mode needs the app" icon={<DeviceDesktopIcon size={22} />}>Local repositories aren't available in the browser preview.</Empty>;
  if (repos.isLoading) return <Loading />;

  const opened = (r: LocalRepo | null) => {
    if (!r) return;
    setCurrentPath(r.path);
    setCloning(false);
    if (sp.get('clone')) setSp({}, { replace: true });
    void refresh();
  };
  const add = (init: boolean) => run(async () => opened(await invoke<LocalRepo | null>('add_local_repo', { init })));
  const s = status.data;
  const sync = (op: 'fetch' | 'pull' | 'push', done: string) => run(async () => (await invoke('git_sync', { repo: repo!.path, op }), await refresh()), done);
  const syncButton = !s ? null : !remote.data ? null : !s.upstream ? (
    <button className="btn primary" disabled={busy} onClick={() => sync('push', 'Branch published')}>
      <ArrowUpIcon /> Publish branch
    </button>
  ) : s.behind > 0 ? (
    <button className="btn primary" disabled={busy} onClick={() => sync('pull', 'Pulled')}>
      <ArrowDownIcon /> Pull origin <span className="count">{s.behind}</span>
    </button>
  ) : s.ahead > 0 ? (
    <button className="btn primary" disabled={busy} onClick={() => sync('push', 'Pushed')}>
      <ArrowUpIcon /> Push origin <span className="count">{s.ahead}</span>
    </button>
  ) : (
    <button className={`btn ${busy ? 'spinning' : ''}`} disabled={busy} onClick={() => sync('fetch', 'Up to date')}>
      <SyncIcon /> Fetch origin
    </button>
  );
  const page = remote.data ? remoteRoute(remote.data) : null;
  const switchTo = (branch: string, create: boolean) =>
    run(async () => {
      await invoke('git_switch', { repo: repo!.path, branch, create });
      setBranchName('');
      await refresh();
    }, `On ${branch}`);

  const dialog = cloning && <CloneDialog onClose={() => setCloning(false)} onDone={opened} initial={sp.get('clone') ?? undefined} />;
  if (!repo)
    return (
      <div className="local-welcome">
        <Empty title="Work on a repository from this computer" icon={<DeviceDesktopIcon size={22} />}>
          Clone one from GitHub or add a folder you already have. Then commit, branch, pull and push without leaving Gittern.
        </Empty>
        <div className="toolbar">
          <button className="btn primary" onClick={() => setCloning(true)}>
            <RepoCloneIcon /> Clone a repository
          </button>
          <button className="btn" disabled={busy} onClick={() => add(false)}>
            <FileDirectoryIcon /> Add an existing folder
          </button>
          <button className="btn" disabled={busy} onClick={() => add(true)}>
            <PlusIcon /> Create a new repository
          </button>
        </div>
        {dialog}
      </div>
    );

  return (
    <div className="local">
      <header className="local-bar">
        <Dropdown
          className="local-pick"
          trigger={
            <>
              <RepoIcon />
              <span>
                <span className="muted small">Current repository</span>
                <strong>{repo.name}</strong>
              </span>
              <TriangleDownIcon />
            </>
          }
        >
          {(close) => (
            <div className="menu wide" onClick={close}>
              <div className="menu-scroll">
                {repos.data!.map((r) => (
                  <button key={r.path} onClick={() => opened(r)} title={r.path}>
                    <span className="check">{r.path === repo.path && <CheckIcon size={14} />}</span>
                    <span className="side-label">{r.name}</span>
                  </button>
                ))}
              </div>
              <hr />
              <button onClick={() => setCloning(true)}>
                <RepoCloneIcon /> Clone a repository…
              </button>
              <button onClick={() => add(false)}>
                <FileDirectoryIcon /> Add an existing folder…
              </button>
              <button onClick={() => add(true)}>
                <PlusIcon /> Create a new repository…
              </button>
            </div>
          )}
        </Dropdown>
        <Dropdown
          className="local-pick"
          trigger={
            <>
              <GitBranchIcon />
              <span>
                <span className="muted small">Current branch</span>
                <strong>{s?.branch ?? branches.data?.current ?? '…'}</strong>
              </span>
              <TriangleDownIcon />
            </>
          }
        >
          {(close) => (
            <div className="menu wide">
              <form
                className="clone-row"
                onSubmit={(e) => {
                  e.preventDefault();
                  close();
                  void switchTo(branchName.trim(), true);
                }}
              >
                <input className="input" autoFocus placeholder="New branch name" value={branchName} onChange={(e) => setBranchName(e.target.value)} aria-label="New branch name" />
                <button className="btn primary" disabled={!branchName.trim() || busy}>
                  Create
                </button>
              </form>
              <div className="menu-scroll" onClick={close}>
                {branches.data?.all
                  .filter((b) => b.toLowerCase().includes(branchName.toLowerCase()))
                  .map((b) => (
                    <button key={b} disabled={busy} onClick={() => b !== branches.data!.current && switchTo(b, false)}>
                      <span className="check">{b === branches.data!.current && <CheckIcon size={14} />}</span>
                      {b}
                    </button>
                  ))}
              </div>
            </div>
          )}
        </Dropdown>
        {syncButton}
        <span className="spacer" />
        {page && (
          <Link className="btn" to={page}>
            View on GitHub
          </Link>
        )}
        <Dropdown align="right" className="icon-btn" title="More" trigger={<KebabHorizontalIcon />}>
          {(close) => (
            <div className="menu" onClick={close}>
              <span className="menu-note">{repo.path}</span>
              <button onClick={() => sync('fetch', 'Fetched')}>Fetch origin</button>
              <button onClick={() => sync('pull', 'Pulled')}>Pull</button>
              <button onClick={() => sync('push', 'Pushed')}>Push</button>
              <hr />
              <button
                onClick={async () => {
                  if (!(await confirmDialog({ title: `Remove ${repo.name} from Gittern?`, body: 'The folder and its files stay on disk.', confirmLabel: 'Remove' }))) return;
                  await invoke('remove_local_repo', { repo: repo.path });
                  void refresh();
                }}
              >
                Remove from Gittern
              </button>
            </div>
          )}
        </Dropdown>
      </header>
      {status.error ? (
        <Empty title="Could not read this repository">{String(status.error)}</Empty>
      ) : !s ? (
        <Loading />
      ) : (
        <div className="local-body">
          <div className="local-tabs">
            <Segmented
              value={view}
              onChange={setView}
              options={[
                { value: 'changes', label: `Changes${s.files.length ? ` ${s.files.length}` : ''}` },
                { value: 'history', label: 'History' },
              ]}
            />
          </div>
          {view === 'changes' ? <Changes key={repo.path} repo={repo} status={s} refresh={refresh} /> : <History key={repo.path + s.branch} repo={repo} />}
        </div>
      )}
      {dialog}
    </div>
  );
}
