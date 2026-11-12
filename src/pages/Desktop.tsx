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
  ArchiveIcon,
  CodeIcon,
  TerminalIcon,
  XIcon,
} from '@primer/octicons-react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { type ReactNode, useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { DiffFile } from '../components/Diff';
import { CopyMenuItem, Dropdown, Empty, Loading, Modal, RepoGlyph, Segmented } from '../components/ui';
import { ghHost, isTauri, useGh } from '../lib/api';
import { confirmDialog, promptDialog, toast, useAction, useDraft } from '../lib/feedback';
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
  operation: 'merge' | 'rebase' | 'cherry-pick' | 'revert' | null;
  merge_message: string | null;
}
interface Stash {
  index: number;
  message: string;
  date: string;
}
interface Editor {
  id: string;
  name: string;
  custom: boolean;
}
interface LogEntry {
  sha: string;
  subject: string;
  body: string;
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
  const [amend, setAmend] = useState(false);
  const { busy, run } = useAction();
  const files = status.files;
  const merging = !!status.operation;
  // a merge comes with its own message
  useEffect(() => {
    if (status.operation === 'merge' && status.merge_message && !summary) setSummary(status.merge_message.split('\n')[0]);
  }, [status.operation, status.merge_message]);
  const toggleAmend = async (on: boolean) => {
    setAmend(on);
    if (!on || summary.trim()) return;
    const msg = await invoke<string>('git_last_message', { repo: repo.path }).catch(() => '');
    const [first, ...rest] = msg.split('\n');
    setSummary(first);
    setDescription(rest.join('\n').trim());
  };
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
      await invoke('git_commit', { repo: repo.path, summary, description, paths: included.map((f) => f.path), amend });
      clearSummary();
      clearDescription();
      setSkipped(new Set());
      setAmend(false);
      await refresh();
    }, amend ? 'Commit amended' : 'Committed');
  const stash = async () => {
    const message = await promptDialog({ title: 'Stash all changes', label: 'Message (optional)', initial: 'WIP', confirmLabel: 'Stash' });
    if (message === null) return;
    void run(async () => (await invoke('git_stash', { repo: repo.path, op: 'push', message }), await refresh()), 'Changes stashed');
  };
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
          {files.length > 0 && !merging && (
            <button className="btn sm" title="Stash all changes" disabled={busy} onClick={stash}>
              Stash
            </button>
          )}
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
          <label className="check-row small">
            <input type="checkbox" checked={amend} disabled={merging} onChange={(e) => void toggleAmend(e.target.checked)} /> Amend last commit
          </label>
          <button className="btn primary block" disabled={busy || !summary.trim() || (included.length === 0 && !amend && !merging)}>
            {busy ? 'Committing…' : amend ? 'Amend last commit' : merging ? `Commit merge to ${status.branch}` : `Commit ${included.length ? plural(included.length, 'file') + ' ' : ''}to ${status.branch}`}
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

function History({ repo, refresh, page }: { repo: LocalRepo; refresh: () => Promise<unknown>; page: string | null }) {
  const log = useLocal<LogEntry[]>('git_log', { repo: repo.path, skip: 0 });
  const { busy, run } = useAction();
  const act = async (c: LogEntry, op: 'revert' | 'branch' | 'tag' | 'reset' | 'cherry-pick') => {
    let name: string | null = null;
    if (op === 'branch' || op === 'tag') {
      name = await promptDialog({ title: op === 'branch' ? 'Create a branch from this commit' : 'Tag this commit', label: op === 'branch' ? 'Branch name' : 'Tag name', confirmLabel: 'Create' });
      if (!name) return;
    } else if (
      !(await confirmDialog(
        op === 'revert'
          ? { title: `Revert “${c.subject}”?`, body: 'Adds a new commit that undoes it.', confirmLabel: 'Revert' }
          : { title: `Reset to ${c.sha.slice(0, 7)}?`, body: 'Later commits are taken back; their changes stay as uncommitted work.', confirmLabel: 'Reset', danger: true },
      ))
    )
      return;
    const done = { revert: 'Reverted', branch: `On ${name}`, tag: `Tagged ${name}`, reset: 'Reset', 'cherry-pick': 'Cherry-picked' }[op];
    void run(async () => (await invoke('git_commit_action', { repo: repo.path, sha: c.sha, op, name }), await refresh()), done);
  };
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
              <div className="toolbar">
                <h2>{current.subject}</h2>
                <span className="spacer" />
                <Dropdown align="right" className="icon-btn" title="Commit actions" trigger={<KebabHorizontalIcon />} disabled={busy}>
                  {(close) => (
                    <div className="menu" onClick={close}>
                      <button onClick={() => act(current, 'revert')}>Revert this commit</button>
                      <button onClick={() => act(current, 'branch')}>Create branch from here…</button>
                      <button onClick={() => act(current, 'tag')}>Create tag…</button>
                      <button onClick={() => act(current, 'reset')}>Reset to this commit…</button>
                      <hr />
                      <CopyMenuItem text={current.sha} label="Copy SHA" />
                      {page && <Link to={`${page}/commit/${current.sha}`}>View on GitHub</Link>}
                    </div>
                  )}
                </Dropdown>
              </div>
              {current.body && <pre className="commit-body">{current.body}</pre>}
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

function Stashes({ repo, refresh }: { repo: LocalRepo; refresh: () => Promise<unknown> }) {
  const list = useLocal<Stash[]>('git_stash_list', { repo: repo.path });
  const { busy, run } = useAction();
  const op = async (st: Stash, which: 'pop' | 'apply' | 'drop') => {
    if (which === 'drop' && !(await confirmDialog({ title: 'Delete this stash?', body: st.message, confirmLabel: 'Delete', danger: true }))) return;
    void run(async () => (await invoke('git_stash', { repo: repo.path, op: which, index: st.index }), await refresh()), { pop: 'Stash restored', apply: 'Stash applied', drop: 'Stash deleted' }[which]);
  };
  return (
    <div className="local-stashes">
      {list.isLoading && <Loading />}
      {list.data?.length === 0 && (
        <Empty title="No stashes" icon={<ArchiveIcon size={22} />}>
          Stash changes from the Changes tab to set them aside without committing.
        </Empty>
      )}
      {!!list.data?.length && (
        <div className="card">
          {list.data.map((st) => (
            <div key={st.index} className="row compact">
              <div className="row-main">
                <div className="row-title">{st.message}</div>
                <div className="meta">{st.date && shortAgo(st.date)}</div>
              </div>
              <button className="btn sm" disabled={busy} onClick={() => op(st, 'pop')}>
                Restore
              </button>
              <button className="btn sm" disabled={busy} onClick={() => op(st, 'apply')}>
                Apply
              </button>
              <button className="icon-btn" title="Delete stash" aria-label="Delete stash" disabled={busy} onClick={() => op(st, 'drop')}>
                <TrashIcon />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// opens the repository in the preferred editor, with a menu of the others
function OpenWith({ repo }: { repo: LocalRepo }) {
  const editors = useLocal<Editor[]>('list_editors', {});
  const [preferred, setPreferred] = usePref('editor', '');
  const { busy, run } = useAction();
  const list = editors.data ?? [];
  const main = list.find((e) => e.id === preferred) ?? list[0];
  const open = (e: Editor) => run(() => invoke('open_in_editor', { repo: repo.path, editor: e.id }));
  const addEditor = () =>
    run(async () => {
      const added = await invoke<Editor | null>('add_editor');
      if (!added) return;
      setPreferred(added.id);
      await editors.refetch();
    });
  return (
    <div className="split-btn">
      <button className="btn" disabled={busy || !main} onClick={() => main && open(main)} title={main ? `Open in ${main.name}` : 'No editor found'}>
        <CodeIcon /> {main ? `Open in ${main.name}` : 'Open in editor'}
      </button>
      <Dropdown align="right" className="btn" title="Open with" trigger={<TriangleDownIcon />}>
        {(close) => (
          <div className="menu wide" onClick={close}>
            {list.length === 0 && <span className="menu-note">No editors found on this computer.</span>}
            {list.map((e) => (
              <div key={e.id} className="menu-line">
                <button onClick={() => (setPreferred(e.id), void open(e))}>
                  <span className="check">{e.id === main?.id && <CheckIcon size={14} />}</span>
                  {e.name}
                </button>
                {e.custom && (
                  <button
                    className="icon-btn sm"
                    title="Forget this editor"
                    aria-label={`Forget ${e.name}`}
                    onClick={() => run(async () => (await invoke('remove_editor', { id: e.id }), await editors.refetch()))}
                  >
                    <XIcon size={12} />
                  </button>
                )}
              </div>
            ))}
            <button onClick={addEditor}>
              <span className="check" />
              Choose another app…
            </button>
            <hr />
            <button onClick={() => run(() => invoke('open_terminal', { repo: repo.path }))}>
              <TerminalIcon /> Open in terminal
            </button>
            <button onClick={() => run(() => invoke('reveal_repo', { repo: repo.path }))}>
              <FileDirectoryIcon /> Show in file manager
            </button>
          </div>
        )}
      </Dropdown>
    </div>
  );
}

const OP_NAME = { merge: 'A merge', rebase: 'A rebase', 'cherry-pick': 'A cherry-pick', revert: 'A revert' };

// the local git workspace: changes, history, branches and sync for a folder on this computer
export function Desktop() {
  const qc = useQueryClient();
  const [sp, setSp] = useSearchParams();
  const repos = useLocal<LocalRepo[]>('local_repos', {});
  const [currentPath, setCurrentPath] = usePref('local-repo', '');
  const [view, setView] = useState<'changes' | 'history' | 'stashes'>('changes');
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
  type Op = 'fetch' | 'pull' | 'pull-merge' | 'pull-rebase' | 'push' | 'force-push' | 'push-tags';
  const syncOnce = (op: Op) => invoke('git_sync', { repo: repo!.path, op });
  const sync = async (op: Op, done: string) => {
    if (op === 'force-push' && !(await confirmDialog({ title: 'Force push?', body: 'This overwrites the remote branch. It stops if someone else pushed since your last fetch.', confirmLabel: 'Force push', danger: true }))) return;
    try {
      await syncOnce(op);
      toast(done);
    } catch (e) {
      const msg = String(e);
      // diverged: ask how to bring the remote work in
      if (op === 'pull' && /fast-forward|diverg/i.test(msg)) {
        const how = await promptDialog({
          title: 'Your branch and origin have diverged',
          label: 'How should the remote commits come in?',
          options: [
            { value: 'pull-merge', label: 'Merge them' },
            { value: 'pull-rebase', label: 'Rebase my commits on top' },
          ],
          confirmLabel: 'Pull',
        });
        if (how) await run(() => syncOnce(how as Op), 'Pulled');
      } else if (op === 'push' && /rejected|fetch first|non-fast-forward/i.test(msg)) {
        toast('Origin has commits you don\'t have. Pull first.', 'error');
      } else toast(msg, 'error');
    }
    await refresh();
  };
  const branchAction = async (what: 'merge' | 'delete' | 'rename') => {
    const cur = branches.data?.current ?? '';
    const others = (branches.data?.all ?? []).filter((b) => b !== cur).map((b) => ({ value: b, label: b }));
    if (what === 'rename') {
      const to = await promptDialog({ title: `Rename ${cur}`, label: 'New name', initial: cur, confirmLabel: 'Rename' });
      if (to && to !== cur) void run(async () => (await invoke('git_rename_branch', { repo: repo!.path, from: cur, to }), await refresh()), `Renamed to ${to}`);
      return;
    }
    if (!others.length) return toast('There are no other local branches');
    const b = await promptDialog({
      title: what === 'merge' ? `Merge into ${cur}` : 'Delete a local branch',
      label: 'Branch',
      options: others,
      confirmLabel: what === 'merge' ? 'Merge' : 'Delete',
      danger: what === 'delete',
    });
    if (!b) return;
    if (what === 'merge') {
      await run(async () => {
        const out = await invoke<string>('git_merge', { repo: repo!.path, branch: b });
        toast(out === 'merged' ? `Merged ${b} into ${cur}` : 'There are conflicts to resolve', out === 'merged' ? 'info' : 'error');
        await refresh();
      });
      return;
    }
    try {
      await invoke('git_delete_branch', { repo: repo!.path, branch: b, force: false });
      toast(`Deleted ${b}`);
    } catch {
      if (await confirmDialog({ title: `${b} has unmerged commits`, body: 'Delete it anyway? Those commits become unreachable.', confirmLabel: 'Delete anyway', danger: true }))
        await run(() => invoke('git_delete_branch', { repo: repo!.path, branch: b, force: true }), `Deleted ${b}`);
    }
    await refresh();
  };
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
                {!branchName && (
                  <>
                    <button disabled={busy} onClick={() => branchAction('merge')}>
                      <span className="check" />
                      Merge a branch into this one…
                    </button>
                    <button disabled={busy} onClick={() => branchAction('rename')}>
                      <span className="check" />
                      Rename this branch…
                    </button>
                    <button disabled={busy} onClick={() => branchAction('delete')}>
                      <span className="check" />
                      Delete a branch…
                    </button>
                    <hr />
                  </>
                )}
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
        <OpenWith repo={repo} />
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
              <button onClick={() => sync('pull-rebase', 'Pulled')}>Pull with rebase</button>
              <button onClick={() => sync('push', 'Pushed')}>Push</button>
              <button onClick={() => sync('force-push', 'Force pushed')}>Force push</button>
              <button onClick={() => sync('push-tags', 'Tags pushed')}>Push tags</button>
              <hr />
              <button onClick={() => run(() => invoke('open_terminal', { repo: repo.path }))}>Open in terminal</button>
              <button onClick={() => run(() => invoke('reveal_repo', { repo: repo.path }))}>Show in file manager</button>
              <CopyMenuItem text={repo.path} label="Copy path" />
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
        <>
          {s.operation && (
            <div className="local-banner">
              <AlertIcon />
              <span>
                {OP_NAME[s.operation]} is in progress.{' '}
                {s.files.some((f) => f.status === 'conflict') ? 'Fix the conflicted files in your editor, then ' : 'All conflicts are fixed. '}
                {s.operation === 'merge' ? 'commit to finish.' : 'continue to finish.'}
              </span>
              <span className="spacer" />
              {s.operation !== 'merge' && (
                <button className="btn sm primary" disabled={busy} onClick={() => run(async () => (await invoke('git_continue', { repo: repo.path }), await refresh()), 'Done')}>
                  Continue
                </button>
              )}
              <button
                className="btn sm"
                disabled={busy}
                onClick={async () => {
                  if (await confirmDialog({ title: `Abort the ${s.operation}?`, body: 'The branch goes back to how it was before.', confirmLabel: 'Abort', danger: true }))
                    void run(async () => (await invoke('git_abort', { repo: repo.path }), await refresh()), 'Aborted');
                }}
              >
                Abort
              </button>
            </div>
          )}
          <div className="local-body">
            <div className="local-tabs">
              <Segmented
                value={view}
                onChange={setView}
                options={[
                  { value: 'changes', label: `Changes${s.files.length ? ` ${s.files.length}` : ''}` },
                  { value: 'history', label: 'History' },
                  { value: 'stashes', label: 'Stashes' },
                ]}
              />
            </div>
            {view === 'changes' ? (
              <Changes key={repo.path} repo={repo} status={s} refresh={refresh} />
            ) : view === 'history' ? (
              <History key={repo.path + s.branch} repo={repo} refresh={refresh} page={page} />
            ) : (
              <Stashes key={repo.path} repo={repo} refresh={refresh} />
            )}
          </div>
        </>
      )}
      {dialog}
    </div>
  );
}
