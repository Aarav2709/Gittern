import { CheckCircleFillIcon, DotFillIcon, GitBranchIcon, KebabHorizontalIcon, PackageIcon, PlayIcon, SkipIcon, StopIcon, SyncIcon, XCircleFillIcon } from '@primer/octicons-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { Dropdown, ErrorBox, Field, ListState, Loading, LoadMore, Time } from '../components/ui';
import { gh, invalidate, useGh, useGhPages } from '../lib/api';
import { confirmDialog, promptDialog, useAction } from '../lib/feedback';
import { duration, formatBytes } from '../lib/util';
import { useRepo } from './Repo';

interface Run {
  id: number;
  name: string;
  display_title: string;
  run_number: number;
  run_attempt?: number;
  event: string;
  status: string;
  conclusion: string | null;
  head_branch: string | null;
  head_sha: string;
  created_at: string;
  updated_at: string;
  run_started_at?: string;
  actor: { login: string } | null;
  html_url: string;
  path?: string;
}
interface Step {
  number: number;
  name: string;
  status: string;
  conclusion: string | null;
  started_at: string | null;
  completed_at: string | null;
}
interface Job extends Omit<Step, 'number'> {
  id: number;
  steps?: Step[];
}
interface Workflow {
  id: number;
  name: string;
  path: string;
  state: string;
}

export function RunIcon({ run }: { run: { status: string; conclusion: string | null } }) {
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

function Dispatch({ workflow, close }: { workflow: Workflow; close: () => void }) {
  const { repo } = useRepo();
  const [ref, setRef] = useState(repo.default_branch);
  const { busy, run } = useAction();
  return (
    <form
      className="menu wide pad"
      onSubmit={(e) => {
        e.preventDefault();
        void run(async () => {
          await gh(`/repos/${repo.full_name}/actions/workflows/${workflow.id}/dispatches`, { method: 'POST', body: { ref } });
          close();
          setTimeout(() => void invalidate(`/repos/${repo.full_name}/actions/runs`), 2500);
        }, 'Workflow queued');
      }}
    >
      <strong>Run {workflow.name}</strong>
      <Field label="Branch or tag" hint="The workflow needs a workflow_dispatch trigger.">
        <input className="input" value={ref} onChange={(e) => setRef(e.target.value)} />
      </Field>
      <button className="btn primary" disabled={busy || !ref.trim()}>
        Run workflow
      </button>
    </form>
  );
}

export function Actions() {
  const { repo } = useRepo();
  const [sp, setSp] = useSearchParams();
  const api = `/repos/${repo.full_name}/actions`;
  const workflows = useGh<{ workflows: Workflow[] }>(`${api}/workflows?per_page=100`);
  const list = workflows.data?.workflows ?? [];
  const picked = sp.get('workflow');
  const workflow = list.find((w) => String(w.id) === picked || w.path.endsWith('/' + picked));
  const status = sp.get('status') ?? '';
  const q = useGhPages<Run>(`${workflow ? `${api}/workflows/${workflow.id}` : api}/runs?per_page=30${status ? `&status=${status}` : ''}`, { pick: (d) => d.workflow_runs });
  const set = (key: string, value: string) => {
    const next = new URLSearchParams(sp);
    if (value) next.set(key, value);
    else next.delete(key);
    setSp(next);
  };
  const { busy, run } = useAction();

  return (
    <div className="run-layout">
      <nav className="card jobs" aria-label="Workflows">
        <button className={`side-link ${!workflow ? 'active' : ''}`} onClick={() => set('workflow', '')}>
          <span className="side-label">All workflows</span>
        </button>
        {list.map((w) => (
          <button key={w.id} className={`side-link ${w.id === workflow?.id ? 'active' : ''}`} onClick={() => set('workflow', String(w.id))} title={w.path}>
            <PlayIcon />
            <span className="side-label">{w.name}</span>
          </button>
        ))}
        <hr />
        <Link className="side-link" to={`/${repo.full_name}/actions/artifacts`}>
          <PackageIcon />
          <span className="side-label">Artifacts and caches</span>
        </Link>
      </nav>
      <div className="stack">
        <div className="toolbar">
          <h2 className="title">{workflow?.name ?? 'All workflow runs'}</h2>
          {workflow && workflow.state !== 'active' && <span className="badge">Disabled</span>}
          <span className="spacer" />
          <select className="input select" value={status} onChange={(e) => set('status', e.target.value)} aria-label="Status">
            <option value="">Any status</option>
            {['in_progress', 'queued', 'success', 'failure', 'cancelled'].map((s) => (
              <option key={s} value={s}>
                {s.replace('_', ' ')}
              </option>
            ))}
          </select>
          {workflow && repo.permissions?.push && (
            <>
              <button
                className="btn"
                disabled={busy}
                onClick={() =>
                  run(async () => {
                    await gh(`${api}/workflows/${workflow.id}/${workflow.state === 'active' ? 'disable' : 'enable'}`, { method: 'PUT' });
                    await invalidate(`${api}/workflows`);
                  })
                }
              >
                {workflow.state === 'active' ? 'Disable' : 'Enable'}
              </button>
              <Dropdown align="right" className="btn primary" trigger="Run workflow">
                {(close) => <Dispatch workflow={workflow} close={close} />}
              </Dropdown>
            </>
          )}
        </div>
        <ListState q={q} count={q.items.length} empty="No workflow runs" />
        {q.items.length > 0 && (
          <div className="card">
            {q.items.map((r) => (
              <div key={r.id} className="row">
                <span className="state-icon">
                  <RunIcon run={r} />
                </span>
                <div className="row-main">
                  <div className="row-title">
                    <Link to={`/${repo.full_name}/actions/runs/${r.id}`}>{r.display_title}</Link>
                  </div>
                  <div className="meta">
                    <strong>{r.name}</strong> #{r.run_number} · {r.event} by {r.actor?.login} · <Time iso={r.created_at} />
                    {r.status === 'completed' && r.run_started_at && <span>{duration(+new Date(r.updated_at) - +new Date(r.run_started_at))}</span>}
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
    </div>
  );
}

const liveInterval = (q: { state: { data?: any } }) => {
  const d = q.state.data;
  const running = d?.jobs ? d.jobs.some((j: Job) => j.status !== 'completed') : d && d.status !== 'completed';
  return running ? 5000 : false;
};

const LOG_TAIL = 5000;

// one workflow run
export function RunDetail() {
  const { repo } = useRepo();
  const { runId } = useParams();
  const base = `/repos/${repo.full_name}/actions`;
  const run = useGh<Run>(`${base}/runs/${runId}`, { refetchInterval: liveInterval });
  const jobs = useGh<{ jobs: Job[] }>(`${base}/runs/${runId}/jobs?per_page=100`, { refetchInterval: liveInterval });
  const artifacts = useGh<{ artifacts: Artifact[] }>(`${base}/runs/${runId}/artifacts?per_page=100`);
  const [picked, setPicked] = useState<number | null>(null);
  const [find, setFind] = useState('');
  const [whole, setWhole] = useState(false);
  const { busy, run: act } = useAction();
  const list = jobs.data?.jobs ?? [];
  const job = list.find((j) => j.id === picked) ?? list.find((j) => j.conclusion === 'failure') ?? list[0];
  const logs = useGh<string>(job?.status === 'completed' && `${base}/jobs/${job.id}/logs`, { text: true });
  const logRef = useRef<HTMLPreElement>(null);
  const navigate = useNavigate();
  const waiting = useGh<{ environment: { id: number; name: string }; current_user_can_approve: boolean; wait_timer: number }[]>(
    run.data?.status === 'waiting' && `${base}/runs/${runId}/pending_deployments`,
  );

  const lines = useMemo(() => (logs.data ?? '').split('\n').map((l) => l.replace(/^﻿?\d{4}-\d\d-\d\dT[\d:.]+Z /, '')), [logs.data]);
  const matched = useMemo(() => (find ? lines.filter((l) => l.toLowerCase().includes(find.toLowerCase())) : lines), [lines, find]);
  const shown = whole || find ? matched : matched.slice(-LOG_TAIL);
  // a failed job is usually read from the bottom
  useEffect(() => {
    if (logRef.current && !find) logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [logs.data, job?.id]);

  if (run.isLoading) return <Loading />;
  if (run.error) return <ErrorBox error={run.error} retry={run.refetch} />;
  const r = run.data!;
  const post = (path: string, done: string) => act(async () => (await gh(`${base}/runs/${runId}/${path}`, { method: 'POST' }), await invalidate(`${base}/runs/${runId}`)), done);
  const review = async (state: 'approved' | 'rejected') => {
    const envs = (waiting.data ?? []).filter((w) => w.current_user_can_approve);
    const comment = await promptDialog({ title: state === 'approved' ? 'Approve and deploy' : 'Reject deployment', label: 'Comment', initial: state === 'approved' ? 'Approved' : 'Rejected', confirmLabel: state === 'approved' ? 'Approve' : 'Reject', danger: state === 'rejected' });
    if (!comment) return;
    await act(async () => {
      await gh(`${base}/runs/${runId}/pending_deployments`, { method: 'POST', body: { environment_ids: envs.map((w) => w.environment.id), state, comment } });
      await invalidate(`${base}/runs/${runId}`);
    }, state === 'approved' ? 'Deployment approved' : 'Deployment rejected');
  };
  const destroy = async (what: 'run' | 'logs') => {
    if (!(await confirmDialog({ title: what === 'run' ? 'Delete this workflow run?' : 'Delete the logs of this run?', body: 'This cannot be undone.', confirmLabel: 'Delete', danger: true }))) return;
    await act(() => gh(`${base}/runs/${runId}${what === 'logs' ? '/logs' : ''}`, { method: 'DELETE' }), what === 'run' ? 'Run deleted' : 'Logs deleted');
    if (what === 'run') {
      await invalidate(`${base}/runs`);
      navigate(`/${repo.full_name}/actions`, { replace: true });
    } else await invalidate(`${base}/jobs`);
  };

  return (
    <div className="stack">
      <div className="toolbar">
        <span className="state-icon">
          <RunIcon run={r} />
        </span>
        <div className="run-title">
          <h2 className="title">{r.display_title}</h2>
          <span className="muted">
            {r.name} #{r.run_number}
            {(r.run_attempt ?? 1) > 1 && ` (attempt ${r.run_attempt})`} · {r.event} · {r.head_branch} ·{' '}
            <Link to={`/${repo.full_name}/commit/${r.head_sha}`} className="mono">
              {r.head_sha.slice(0, 7)}
            </Link>{' '}
            · <Time iso={r.created_at} />
          </span>
        </div>
        <span className="spacer" />
        {repo.permissions?.push &&
          (r.status !== 'completed' ? (
            <>
              {waiting.data?.some((w) => w.current_user_can_approve) && (
                <>
                  <button className="btn primary" disabled={busy} onClick={() => review('approved')}>
                    Approve {waiting.data.map((w) => w.environment.name).join(', ')}
                  </button>
                  <button className="btn" disabled={busy} onClick={() => review('rejected')}>
                    Reject
                  </button>
                </>
              )}
              <button className="btn" disabled={busy} onClick={() => post('cancel', 'Cancelling…')}>
                <StopIcon /> Cancel
              </button>
            </>
          ) : (
            <>
              {r.conclusion === 'failure' && (
                <button className="btn" disabled={busy} onClick={() => post('rerun-failed-jobs', 'Re-running failed jobs…')}>
                  <SyncIcon /> Re-run failed
                </button>
              )}
              <button className="btn" disabled={busy} onClick={() => post('rerun', 'Re-running all jobs…')}>
                <SyncIcon /> Re-run all
              </button>
            </>
          ))}
        <Dropdown align="right" className="icon-btn" title="More" trigger={<KebabHorizontalIcon />}>
          {(close) => (
            <div className="menu" onClick={close}>
              {r.path && <Link to={`/${repo.full_name}/blob/${r.head_sha}/${r.path.split('@')[0]}`}>View workflow file</Link>}
              <a href={r.html_url} data-external>
                Open on GitHub
              </a>
              {repo.permissions?.push && r.status !== 'completed' && <button onClick={() => post('force-cancel', 'Force cancelling…')}>Force cancel</button>}
              {repo.permissions?.push && r.status === 'completed' && (
                <>
                  <hr />
                  <button onClick={() => destroy('logs')}>Delete logs</button>
                  <button onClick={() => destroy('run')}>Delete run</button>
                </>
              )}
            </div>
          )}
        </Dropdown>
      </div>
      <div className="run-layout">
        <div className="stack">
          <div className="card jobs">
            {jobs.isLoading && <Loading />}
            {list.map((j) => (
              <button key={j.id} className={`side-link ${j.id === job?.id ? 'active' : ''}`} onClick={() => setPicked(j.id)}>
                <RunIcon run={j} />
                <span className="side-label">{j.name}</span>
              </button>
            ))}
          </div>
          {!!artifacts.data?.artifacts.length && (
            <div className="card jobs">
              <div className="side-heading">Artifacts</div>
              {artifacts.data.artifacts.map((a) => (
                <a key={a.id} className="side-link" href={`${r.html_url}/artifacts/${a.id}`} data-external title="Download in browser">
                  <PackageIcon />
                  <span className="side-label">{a.name}</span>
                  <span className="side-count">{formatBytes(a.size_in_bytes)}</span>
                </a>
              ))}
            </div>
          )}
        </div>
        <div className="stack">
          {job && (
            <div className="card">
              <div className="card-head">
                <strong>{job.name}</strong>
                <span className="spacer" />
                {job.started_at && job.completed_at && <span>{duration(+new Date(job.completed_at) - +new Date(job.started_at))}</span>}
                {repo.permissions?.push && r.status === 'completed' && (
                  <button className="btn sm" disabled={busy} onClick={() => act(async () => (await gh(`${base}/jobs/${job.id}/rerun`, { method: 'POST' }), await invalidate(`${base}/runs/${runId}`)), 'Re-running job…')}>
                    <SyncIcon size={12} /> Re-run job
                  </button>
                )}
              </div>
              {job.steps?.map((st) => (
                <div key={st.number} className="row compact">
                  <span className="state-icon">
                    <RunIcon run={st} />
                  </span>
                  <span className="row-main">{st.name}</span>
                  <span className="row-side">{st.started_at && st.completed_at ? duration(+new Date(st.completed_at) - +new Date(st.started_at)) : ''}</span>
                </div>
              ))}
            </div>
          )}
          {job && (
            <div className="card">
              <div className="card-head">
                <strong>Log</strong>
                {!find && lines.length > shown.length && (
                  <button className="link-btn small" onClick={() => setWhole(true)}>
                    last {shown.length.toLocaleString()} of {lines.length.toLocaleString()} lines, show all
                  </button>
                )}
                {find && <span className="small">{matched.length.toLocaleString()} matching lines</span>}
                <span className="spacer" />
                <input className="input name-input" placeholder="Find in log…" value={find} onChange={(e) => setFind(e.target.value)} aria-label="Find in log" />
              </div>
              {job.status !== 'completed' ? (
                <p className="muted pad">The log appears when this job finishes. Steps above update live.</p>
              ) : logs.isLoading ? (
                <Loading />
              ) : logs.error ? (
                <ErrorBox error={logs.error} retry={logs.refetch} />
              ) : (
                <pre className="log" ref={logRef}>
                  {shown.join('\n')}
                </pre>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

interface Artifact {
  id: number;
  name: string;
  size_in_bytes: number;
  expired: boolean;
  created_at: string;
  workflow_run?: { id: number };
}
interface Cache {
  id: number;
  key: string;
  ref: string;
  size_in_bytes: number;
  last_accessed_at: string;
}

export function ActionsStorage() {
  const { repo } = useRepo();
  const api = `/repos/${repo.full_name}/actions`;
  const artifacts = useGhPages<Artifact>(`${api}/artifacts?per_page=50`, { pick: (d) => d.artifacts });
  const caches = useGhPages<Cache>(`${api}/caches?per_page=50`, { pick: (d) => d.actions_caches });
  const { busy, run } = useAction();
  const remove = async (path: string, what: string) => {
    if (await confirmDialog({ title: `Delete ${what}?`, confirmLabel: 'Delete', danger: true })) void run(async () => (await gh(path, { method: 'DELETE' }), await invalidate(api)), 'Deleted');
  };
  return (
    <div className="stack">
      <h2 className="section-title">Artifacts</h2>
      <div className="card">
        <ListState q={artifacts} count={artifacts.items.length} empty="No artifacts" />
        {artifacts.items.map((a) => (
          <div key={a.id} className="row compact">
            <span className="state-icon">
              <PackageIcon />
            </span>
            <div className="row-main">
              <div className="row-title">
                {a.workflow_run ? <Link to={`/${repo.full_name}/actions/runs/${a.workflow_run.id}`}>{a.name}</Link> : a.name}
                {a.expired && <span className="badge">Expired</span>}
              </div>
              <div className="meta">
                {formatBytes(a.size_in_bytes)} · <Time iso={a.created_at} />
              </div>
            </div>
            {repo.permissions?.push && (
              <button className="btn sm" disabled={busy} onClick={() => remove(`${api}/artifacts/${a.id}`, a.name)}>
                Delete
              </button>
            )}
          </div>
        ))}
      </div>
      <LoadMore q={artifacts} />
      <h2 className="section-title">Caches</h2>
      <div className="card">
        <ListState q={caches} count={caches.items.length} empty="No caches" />
        {caches.items.map((c) => (
          <div key={c.id} className="row compact">
            <div className="row-main">
              <div className="row-title mono small">{c.key}</div>
              <div className="meta">
                {c.ref.replace('refs/heads/', '')} · {formatBytes(c.size_in_bytes)} · used <Time iso={c.last_accessed_at} />
              </div>
            </div>
            {repo.permissions?.push && (
              <button className="btn sm" disabled={busy} onClick={() => remove(`${api}/caches/${c.id}`, 'this cache')}>
                Delete
              </button>
            )}
          </div>
        ))}
      </div>
      <LoadMore q={caches} />
    </div>
  );
}
