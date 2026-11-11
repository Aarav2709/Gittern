import { AlertIcon, MilestoneIcon, PencilIcon, RepoForkedIcon, RocketIcon, ShieldCheckIcon, TableIcon, TagIcon, TrashIcon } from '@primer/octicons-react';
import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Avatar, Bars, Empty, ErrorBox, Field, ListState, Loading, LoadMore, RepoRow, Segmented, SubTabs, Time, UserLink, useSubTab } from '../components/ui';
import { gh, type GhError, invalidate, useGh, useGhPages, useGqlPages, webUrl } from '../lib/api';
import { confirmDialog, useAction } from '../lib/feedback';
import type { Issue, Label, Milestone, Repo, User } from '../lib/types';
import { compact, plural } from '../lib/util';
import { issueSearch } from './Home';
import { IssueRow } from './Issues';
import { useRepo } from './Repo';

export function Labels() {
  const { repo } = useRepo();
  const api = `/repos/${repo.full_name}/labels`;
  const q = useGhPages<Label>(`${api}?per_page=100`);
  const [editing, setEditing] = useState<{ was?: string; name: string; description: string } | null>(null);
  const { busy, run } = useAction();
  const can = !!(repo.permissions?.triage || repo.permissions?.push);
  const save = () =>
    run(async () => {
      const body = { new_name: editing!.name.trim(), name: editing!.name.trim(), description: editing!.description };
      await gh(editing!.was ? `${api}/${encodeURIComponent(editing!.was)}` : api, { method: editing!.was ? 'PATCH' : 'POST', body });
      setEditing(null);
      await invalidate(api);
    }, 'Label saved');
  return (
    <div className="stack">
      <div className="toolbar">
        <h2 className="title">Labels</h2>
        <span className="spacer" />
        {can && !editing && (
          <button className="btn primary" onClick={() => setEditing({ name: '', description: '' })}>
            New label
          </button>
        )}
      </div>
      {editing && (
        <form
          className="card form-section form"
          onSubmit={(e) => {
            e.preventDefault();
            void save();
          }}
        >
          <div className="split">
            <Field label="Name">
              <input className="input" autoFocus value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })} />
            </Field>
            <Field label="Description">
              <input className="input" value={editing.description} onChange={(e) => setEditing({ ...editing, description: e.target.value })} />
            </Field>
          </div>
          <div className="form-foot">
            <span className="spacer" />
            <button type="button" className="btn" onClick={() => setEditing(null)}>
              Cancel
            </button>
            <button className="btn primary" disabled={busy || !editing.name.trim()}>
              {editing.was ? 'Save label' : 'Create label'}
            </button>
          </div>
        </form>
      )}
      <div className="card">
        <ListState q={q} count={q.items.length} empty="No labels" />
        {q.items.map((l) => (
          <div key={l.name} className="row compact">
            <span className="state-icon">
              <TagIcon />
            </span>
            <div className="row-main">
              <div className="row-title">
                <Link className="label" to={`/${repo.full_name}/issues?q=${encodeURIComponent(`label:"${l.name}"`)}`}>
                  {l.name}
                </Link>
                <span className="muted">{l.description}</span>
              </div>
            </div>
            {can && (
              <>
                <button className="icon-btn" title="Edit" aria-label={`Edit ${l.name}`} onClick={() => setEditing({ was: l.name, name: l.name, description: l.description ?? '' })}>
                  <PencilIcon />
                </button>
                <button
                  className="icon-btn"
                  title="Delete"
                  aria-label={`Delete ${l.name}`}
                  disabled={busy}
                  onClick={async () => {
                    if (await confirmDialog({ title: `Delete the label “${l.name}”?`, body: 'It is removed from every issue and pull request.', confirmLabel: 'Delete', danger: true }))
                      void run(async () => (await gh(`${api}/${encodeURIComponent(l.name)}`, { method: 'DELETE' }), await invalidate(api)), 'Label deleted');
                  }}
                >
                  <TrashIcon />
                </button>
              </>
            )}
          </div>
        ))}
      </div>
      <LoadMore q={q} />
    </div>
  );
}

function Progress({ m }: { m: Milestone }) {
  const total = m.open_issues + m.closed_issues;
  const pct = total ? Math.round((m.closed_issues / total) * 100) : 0;
  return (
    <div className="progress-wrap">
      <div className="progress" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
        <span style={{ width: `${pct}%` }} />
      </div>
      <span className="muted small">
        {pct}% complete · {m.open_issues} open · {m.closed_issues} closed
      </span>
    </div>
  );
}

export function Milestones() {
  const { repo } = useRepo();
  const api = `/repos/${repo.full_name}/milestones`;
  const [state, setState] = useState<'open' | 'closed'>('open');
  const q = useGhPages<Milestone>(`${api}?state=${state}&per_page=50&sort=due_on`);
  const [form, setForm] = useState<{ number?: number; title: string; description: string; due: string } | null>(null);
  const { busy, run } = useAction();
  const can = !!repo.permissions?.push;
  const act = (fn: () => Promise<unknown>, done: string) => run(async () => (await fn(), await invalidate(api)), done);
  return (
    <div className="stack">
      <div className="toolbar">
        <Segmented
          value={state}
          onChange={setState}
          options={[
            { value: 'open', label: 'Open' },
            { value: 'closed', label: 'Closed' },
          ]}
        />
        <span className="spacer" />
        {can && !form && (
          <button className="btn primary" onClick={() => setForm({ title: '', description: '', due: '' })}>
            New milestone
          </button>
        )}
      </div>
      {form && (
        <form
          className="card form-section form"
          onSubmit={(e) => {
            e.preventDefault();
            void act(
              () =>
                gh(form.number ? `${api}/${form.number}` : api, {
                  method: form.number ? 'PATCH' : 'POST',
                  body: { title: form.title.trim(), description: form.description, due_on: form.due ? new Date(form.due).toISOString() : null },
                }),
              'Milestone saved',
            ).then(() => setForm(null));
          }}
        >
          <div className="split">
            <Field label="Title">
              <input className="input" autoFocus value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
            </Field>
            <Field label="Due date (optional)">
              <input className="input" type="date" value={form.due} onChange={(e) => setForm({ ...form, due: e.target.value })} />
            </Field>
          </div>
          <Field label="Description">
            <textarea className="input" rows={3} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
          </Field>
          <div className="form-foot">
            <span className="spacer" />
            <button type="button" className="btn" onClick={() => setForm(null)}>
              Cancel
            </button>
            <button className="btn primary" disabled={busy || !form.title.trim()}>
              {form.number ? 'Save milestone' : 'Create milestone'}
            </button>
          </div>
        </form>
      )}
      <div className="card">
        <ListState q={q} count={q.items.length} empty={`No ${state} milestones`} />
        {q.items.map((m) => (
          <div key={m.number} className="row">
            <span className="state-icon">
              <MilestoneIcon />
            </span>
            <div className="row-main">
              <Link className="row-link" to={`/${repo.full_name}/milestone/${m.number}`}>
                {m.title}
              </Link>
              {m.description && <p className="row-desc">{m.description}</p>}
              <Progress m={m} />
              {m.due_on && (
                <div className="meta">
                  Due <Time iso={m.due_on} />
                </div>
              )}
            </div>
            {can && (
              <div className="row-side">
                <button className="link-btn" onClick={() => setForm({ number: m.number, title: m.title, description: m.description ?? '', due: m.due_on?.slice(0, 10) ?? '' })}>
                  Edit
                </button>
                <button className="link-btn" disabled={busy} onClick={() => act(() => gh(`${api}/${m.number}`, { method: 'PATCH', body: { state: m.state === 'open' ? 'closed' : 'open' } }), m.state === 'open' ? 'Milestone closed' : 'Milestone reopened')}>
                  {m.state === 'open' ? 'Close' : 'Reopen'}
                </button>
                <button
                  className="link-btn"
                  disabled={busy}
                  onClick={async () => {
                    if (await confirmDialog({ title: `Delete “${m.title}”?`, body: 'Issues keep existing but lose this milestone.', confirmLabel: 'Delete', danger: true }))
                      void act(() => gh(`${api}/${m.number}`, { method: 'DELETE' }), 'Milestone deleted');
                  }}
                >
                  Delete
                </button>
              </div>
            )}
          </div>
        ))}
      </div>
      <LoadMore q={q} />
    </div>
  );
}

export function MilestoneDetail() {
  const { repo } = useRepo();
  const { number } = useParams();
  const m = useGh<Milestone>(`/repos/${repo.full_name}/milestones/${number}`);
  const [state, setState] = useState<'open' | 'closed'>('open');
  const list = useGhPages<Issue>(m.data && issueSearch(`repo:${repo.full_name} milestone:"${m.data.title}" state:${state}`, '&sort=updated'), { pick: (d) => d.items });
  if (m.isLoading) return <Loading />;
  if (m.error) return <ErrorBox error={m.error} />;
  return (
    <div className="stack">
      <div>
        <h2 className="title">{m.data!.title}</h2>
        {m.data!.description && <p className="muted">{m.data!.description}</p>}
      </div>
      <Progress m={m.data!} />
      <div className="toolbar">
        <Segmented
          value={state}
          onChange={setState}
          options={[
            { value: 'open', label: `Open ${m.data!.open_issues}` },
            { value: 'closed', label: `Closed ${m.data!.closed_issues}` },
          ]}
        />
      </div>
      <div className="card">
        <ListState q={list} count={list.items.length} empty="Nothing in this milestone" />
        {list.items.map((it) => (
          <IssueRow key={it.id} item={it} />
        ))}
      </div>
      <LoadMore q={list} />
    </div>
  );
}

// stargazers, watchers or forks
export function People({ kind }: { kind: 'stargazers' | 'subscribers' | 'forks' }) {
  const { repo } = useRepo();
  const q = useGhPages<any>(`/repos/${repo.full_name}/${kind}?per_page=50${kind === 'forks' ? '&sort=stargazers' : ''}`);
  const title = { stargazers: 'Stargazers', subscribers: 'Watchers', forks: 'Forks' }[kind];
  return (
    <div className="stack">
      <h2 className="title">{title}</h2>
      {kind === 'forks' ? (
        <div className="card">
          <ListState q={q} count={q.items.length} empty="No forks yet" />
          {q.items.map((r: Repo) => (
            <RepoRow key={r.id} repo={r} showOwner />
          ))}
        </div>
      ) : (
        <>
          <ListState q={q} count={q.items.length} empty={`No ${title.toLowerCase()} yet`} />
          <div className="people-grid">
            {q.items.map((u: User) => (
              <div key={u.id} className="card person">
                <Avatar user={u} size={36} />
                <UserLink user={u} />
              </div>
            ))}
          </div>
        </>
      )}
      <LoadMore q={q} />
    </div>
  );
}

// stats are computed lazily; poll until ready
function useStats<T>(path: string) {
  return useGh<T | null>(path, { refetchInterval: (q) => (q.state.data === null || (q.state.data && Object.keys(q.state.data).length === 0) ? 3000 : false) });
}

function Pulse({ repo }: { repo: Repo }) {
  const since = new Date(Date.now() - 7 * 86400_000).toISOString().slice(0, 10);
  const useCount = (q: string) => useGh<{ total_count: number }>(issueSearch(`repo:${repo.full_name} ${q}`).replace('per_page=30', 'per_page=1'));
  const merged = useCount(`is:pr merged:>=${since}`);
  const openedPrs = useCount(`is:pr created:>=${since}`);
  const closedIssues = useCount(`is:issue closed:>=${since}`);
  const openedIssues = useCount(`is:issue created:>=${since}`);
  const stats = [
    ['Pull requests merged', merged],
    ['Pull requests opened', openedPrs],
    ['Issues closed', closedIssues],
    ['Issues opened', openedIssues],
  ] as const;
  return (
    <section>
      <h3 className="section-title">The last 7 days</h3>
      <div className="stat-grid">
        {stats.map(([label, q]) => (
          <div key={label} className="card stat">
            <strong>{q.data ? q.data.total_count.toLocaleString() : '–'}</strong>
            <span className="muted">{label}</span>
          </div>
        ))}
      </div>
    </section>
  );
}

function Activity({ repo }: { repo: Repo }) {
  const api = `/repos/${repo.full_name}/stats`;
  const weeks = useStats<{ week: number; total: number }[]>(`${api}/commit_activity`);
  const contributors = useStats<{ author: User | null; total: number; weeks: { a: number; d: number; c: number }[] }[]>(`${api}/contributors`);
  const top = Array.isArray(contributors.data) ? [...contributors.data].sort((a, b) => b.total - a.total).slice(0, 30) : [];
  const data = Array.isArray(weeks.data) ? weeks.data : [];
  return (
    <>
      <section>
        <h3 className="section-title">Commits per week, last year</h3>
        <div className="card pad">
          {data.length ? <Bars values={data.map((w) => w.total)} labels={data.map((w) => new Date(w.week * 1000).toLocaleDateString())} height={110} /> : <Loading label="GitHub is computing this…" />}
        </div>
      </section>
      <section>
        <h3 className="section-title">Contributors</h3>
        <div className="card">
          {!top.length && (contributors.isLoading || contributors.data !== undefined) && <Loading label="GitHub is computing this…" />}
          {top.map((c, i) => (
            <div key={c.author?.id ?? i} className="row compact">
              <span className="muted rank">#{i + 1}</span>
              <Avatar user={c.author} size={24} />
              <div className="row-main">
                <UserLink user={c.author} />
                <div className="meta">
                  {plural(c.total, 'commit')} · <span className="add-text">+{compact(c.weeks.reduce((n, w) => n + w.a, 0))}</span> <span className="del-text">−{compact(c.weeks.reduce((n, w) => n + w.d, 0))}</span>
                </div>
              </div>
              <div className="spark">
                <Bars values={c.weeks.slice(-26).map((w) => w.c)} height={24} />
              </div>
            </div>
          ))}
        </div>
      </section>
    </>
  );
}

function Traffic({ repo }: { repo: Repo }) {
  const api = `/repos/${repo.full_name}/traffic`;
  const views = useGh<{ count: number; uniques: number; views: { timestamp: string; count: number }[] }>(`${api}/views`);
  const clones = useGh<{ count: number; uniques: number; clones: { timestamp: string; count: number }[] }>(`${api}/clones`);
  const referrers = useGh<{ referrer: string; count: number; uniques: number }[]>(`${api}/popular/referrers`);
  const paths = useGh<{ path: string; title: string; count: number }[]>(`${api}/popular/paths`);
  if (views.error) return <Empty title="Traffic needs push access">Only people who can push see views and clones.</Empty>;
  const day = (t: string) => new Date(t).toLocaleDateString();
  return (
    <>
      <div className="split">
        <div className="card pad">
          <strong>{views.data ? `${views.data.count.toLocaleString()} views · ${views.data.uniques.toLocaleString()} unique` : 'Views'}</strong>
          <Bars values={views.data?.views.map((v) => v.count) ?? []} labels={views.data?.views.map((v) => day(v.timestamp))} />
        </div>
        <div className="card pad">
          <strong>{clones.data ? `${clones.data.count.toLocaleString()} clones · ${clones.data.uniques.toLocaleString()} unique` : 'Clones'}</strong>
          <Bars values={clones.data?.clones.map((v) => v.count) ?? []} labels={clones.data?.clones.map((v) => day(v.timestamp))} />
        </div>
      </div>
      <div className="split">
        <div className="card">
          <div className="card-head">Referring sites</div>
          {referrers.data?.map((r) => (
            <div key={r.referrer} className="row compact">
              <span className="row-main">{r.referrer}</span>
              <span className="row-side">{r.count.toLocaleString()} views</span>
            </div>
          ))}
          {referrers.data?.length === 0 && <p className="muted pad">Nothing in the last two weeks.</p>}
        </div>
        <div className="card">
          <div className="card-head">Popular content</div>
          {paths.data?.map((p) => (
            <div key={p.path} className="row compact">
              <a className="row-main" href={webUrl(p.path)}>
                {p.title}
              </a>
              <span className="row-side">{p.count.toLocaleString()}</span>
            </div>
          ))}
          {paths.data?.length === 0 && <p className="muted pad">Nothing in the last two weeks.</p>}
        </div>
      </div>
    </>
  );
}

function Dependencies({ repo }: { repo: Repo }) {
  const q = useGh<{ sbom: { packages: { name: string; versionInfo?: string; licenseConcluded?: string }[] } }>(`/repos/${repo.full_name}/dependency-graph/sbom`);
  const [filter, setFilter] = useState('');
  const all = (q.data?.sbom.packages ?? []).filter((p) => !p.name.endsWith(repo.full_name));
  const shown = all.filter((p) => p.name.toLowerCase().includes(filter.toLowerCase()));
  return (
    <>
      <div className="toolbar">
        <input className="input name-input" placeholder="Filter dependencies…" value={filter} onChange={(e) => setFilter(e.target.value)} aria-label="Filter dependencies" />
        <span className="muted">{q.data && plural(all.length, 'dependency', 'dependencies')}</span>
      </div>
      <div className="card">
        <ListState q={q} count={shown.length} empty="No dependencies found" />
        {shown.slice(0, 500).map((p, i) => (
          <div key={p.name + i} className="row compact">
            <span className="row-main mono small">{p.name}</span>
            <span className="row-side">
              {p.versionInfo} {p.licenseConcluded && p.licenseConcluded !== 'NOASSERTION' && <span className="badge">{p.licenseConcluded}</span>}
            </span>
          </div>
        ))}
      </div>
    </>
  );
}

function Community({ repo }: { repo: Repo }) {
  const q = useGh<{ health_percentage: number; files: Record<string, { html_url: string } | null> }>(`/repos/${repo.full_name}/community/profile`);
  const names: Record<string, string> = { readme: 'README', license: 'License', code_of_conduct: 'Code of conduct', contributing: 'Contributing guide', issue_template: 'Issue templates', pull_request_template: 'Pull request template' };
  return (
    <div className="card">
      <div className="card-head">
        <strong>Community standards</strong>
        <span className="spacer" />
        {q.data && <span>{q.data.health_percentage}% complete</span>}
      </div>
      <ListState q={q} count={1} empty="" />
      {q.data &&
        Object.entries(names).map(([key, label]) => (
          <div key={key} className="row compact">
            <span className="state-icon">{q.data!.files[key] ? <ShieldCheckIcon className="s-open" /> : <AlertIcon className="s-draft" />}</span>
            <span className="row-main">{label}</span>
            <span className="row-side">{q.data!.files[key] ? 'Present' : 'Missing'}</span>
          </div>
        ))}
    </div>
  );
}

export function Insights() {
  const { repo } = useRepo();
  const tab = useSubTab('pulse');
  return (
    <div className="stack">
      <SubTabs
        tabs={[
          { id: 'pulse', label: 'Pulse' },
          { id: 'activity', label: 'Contributors' },
          { id: 'traffic', label: 'Traffic' },
          { id: 'dependencies', label: 'Dependencies' },
          { id: 'community', label: 'Community' },
        ]}
      />
      {tab === 'pulse' && (
        <>
          <Pulse repo={repo} />
          <div className="toolbar">
            <Link className="btn" to={`/${repo.full_name}/forks`}>
              <RepoForkedIcon /> {compact(repo.forks_count)} forks
            </Link>
            <Link className="btn" to={`/${repo.full_name}/stargazers`}>
              {compact(repo.stargazers_count)} stargazers
            </Link>
            <Link className="btn" to={`/${repo.full_name}/watchers`}>
              Watchers
            </Link>
            <Link className="btn" to={`/${repo.full_name}/deployments`}>
              <RocketIcon /> Deployments
            </Link>
          </div>
        </>
      )}
      {tab === 'activity' && <Activity repo={repo} />}
      {tab === 'traffic' && <Traffic repo={repo} />}
      {tab === 'dependencies' && <Dependencies repo={repo} />}
      {tab === 'community' && <Community repo={repo} />}
    </div>
  );
}

const off = (e: GhError | null) => !!e && [403, 404].includes(e.status);

function Alerts({ path, empty, row }: { path: string; empty: string; row: (a: any) => { title: string; meta: string; severity?: string; url: string } }) {
  const q = useGhPages<any>(path);
  if (off(q.error)) return <Empty title="Not available">This is turned off for the repository, or your token can't read it.</Empty>;
  return (
    <>
      <div className="card">
        <ListState q={q} count={q.items.length} empty={empty} />
        {q.items.map((a) => {
          const r = row(a);
          return (
            <div key={a.number} className="row">
              <span className="state-icon">
                <AlertIcon />
              </span>
              <div className="row-main">
                <a className="row-link" href={r.url} data-external>
                  {r.title}
                </a>
                <div className="meta">
                  #{a.number} · {r.meta} · opened <Time iso={a.created_at} />
                </div>
              </div>
              {r.severity && <span className="badge">{r.severity}</span>}
            </div>
          );
        })}
      </div>
      <LoadMore q={q} />
    </>
  );
}

export function Security() {
  const { repo } = useRepo();
  const tab = useSubTab('dependabot');
  const api = `/repos/${repo.full_name}`;
  const policy = useGh<any>(`${api}/contents/SECURITY.md`);
  return (
    <div className="stack">
      <SubTabs
        tabs={[
          { id: 'dependabot', label: 'Dependabot' },
          { id: 'code-scanning', label: 'Code scanning' },
          { id: 'secret-scanning', label: 'Secret scanning' },
          { id: 'advisories', label: 'Advisories' },
        ]}
      />
      {tab === 'dependabot' && (
        <Alerts
          path={`${api}/dependabot/alerts?state=open&per_page=50`}
          empty="No open Dependabot alerts"
          row={(a) => ({ title: a.security_advisory?.summary ?? 'Vulnerable dependency', meta: `${a.dependency?.package?.name} (${a.dependency?.package?.ecosystem})`, severity: a.security_advisory?.severity, url: a.html_url })}
        />
      )}
      {tab === 'code-scanning' && (
        <Alerts
          path={`${api}/code-scanning/alerts?state=open&per_page=50`}
          empty="No open code scanning alerts"
          row={(a) => ({ title: a.rule?.description ?? a.rule?.id, meta: `${a.most_recent_instance?.location?.path ?? ''} · ${a.tool?.name ?? ''}`, severity: a.rule?.security_severity_level ?? a.rule?.severity, url: a.html_url })}
        />
      )}
      {tab === 'secret-scanning' && (
        <Alerts path={`${api}/secret-scanning/alerts?state=open&per_page=50`} empty="No open secret scanning alerts" row={(a) => ({ title: a.secret_type_display_name ?? a.secret_type, meta: a.state, url: a.html_url })} />
      )}
      {tab === 'advisories' && (
        <>
          <Alerts
            path={`${api}/security-advisories?per_page=50`}
            empty="No published advisories"
            row={(a) => ({ title: a.summary, meta: a.ghsa_id, severity: a.severity, url: a.html_url })}
          />
          <p className="muted small">
            Security policy: {policy.isSuccess ? <Link to={`/${repo.full_name}/blob/${repo.default_branch}/SECURITY.md`}>SECURITY.md</Link> : 'none in this repository'}.
          </p>
        </>
      )}
    </div>
  );
}

const PROJECTS_QUERY = `
query($owner: String!, $name: String!, $after: String) {
  repository(owner: $owner, name: $name) {
    projectsV2(first: 30, after: $after, orderBy: { field: UPDATED_AT, direction: DESC }) {
      pageInfo { hasNextPage endCursor }
      nodes { number title shortDescription closed updatedAt url items { totalCount } }
    }
  }
}`;

// projects need a scope the default github cli token doesn't have
function ScopeHint({ error }: { error: Error }) {
  if (!error.message.includes('read:project')) return <ErrorBox error={error} />;
  return (
    <Empty title="Projects need one more permission">
      Your token lacks the read:project scope. With the GitHub CLI, run <code>gh auth refresh -s read:project</code> and restart Gittern.
    </Empty>
  );
}

export function Projects() {
  const { repo } = useRepo();
  const q = useGqlPages<any>('projects', PROJECTS_QUERY, { owner: repo.owner.login, name: repo.name }, (d) => d.repository?.projectsV2);
  if (q.error) return <ScopeHint error={q.error} />;
  return (
    <div className="stack">
      <div className="card">
        <ListState q={q} count={q.items.length} empty="No projects linked to this repository" />
        {q.items.map((p) => (
          <div key={p.number} className="row">
            <span className="state-icon">
              <TableIcon />
            </span>
            <div className="row-main">
              <div className="row-title">
                <Link to={`/${repo.full_name}/projects/${p.number}`}>{p.title}</Link>
                {p.closed && <span className="badge">Closed</span>}
              </div>
              {p.shortDescription && <p className="row-desc">{p.shortDescription}</p>}
              <div className="meta">
                #{p.number} · {plural(p.items.totalCount, 'item')} · updated <Time iso={p.updatedAt} />
              </div>
            </div>
          </div>
        ))}
      </div>
      <LoadMore q={q} />
    </div>
  );
}

const PROJECT_QUERY = `
query($owner: String!, $name: String!, $number: Int!, $after: String) {
  repository(owner: $owner, name: $name) {
    projectV2(number: $number) {
      title shortDescription url
      items(first: 50, after: $after) {
        totalCount
        pageInfo { hasNextPage endCursor }
        nodes {
          id
          status: fieldValueByName(name: "Status") { ... on ProjectV2ItemFieldSingleSelectValue { name } }
          content {
            __typename
            ... on Issue { number title state repository { nameWithOwner } assignees(first: 3) { nodes { login avatarUrl } } }
            ... on PullRequest { number title state repository { nameWithOwner } assignees(first: 3) { nodes { login avatarUrl } } }
            ... on DraftIssue { title }
          }
        }
      }
    }
  }
}`;

// a project as a board grouped by its status field
export function ProjectDetail() {
  const { repo } = useRepo();
  const { number } = useParams();
  const q = useGqlPages<any>('project', PROJECT_QUERY, { owner: repo.owner.login, name: repo.name, number: Number(number) }, (d) => d.repository?.projectV2?.items);
  const project = q.first?.repository?.projectV2;
  if (q.isLoading) return <Loading />;
  if (q.error) return <ScopeHint error={q.error} />;
  if (!project) return <Empty title="Project not found" />;
  const columns = new Map<string, any[]>();
  for (const it of q.items) {
    const key = it.status?.name ?? 'No status';
    columns.set(key, [...(columns.get(key) ?? []), it]);
  }
  return (
    <div className="stack">
      <div className="toolbar">
        <div>
          <h2 className="title">{project.title}</h2>
          {project.shortDescription && <p className="muted">{project.shortDescription}</p>}
        </div>
        <span className="spacer" />
        <a className="btn" href={project.url} data-external>
          Edit on GitHub
        </a>
      </div>
      <div className="board">
        {[...columns].map(([name, items]) => (
          <section key={name} className="board-col">
            <h3>
              {name} <span className="count">{items.length}</span>
            </h3>
            {items.map((it) => {
              const c = it.content;
              const to = c?.number ? `/${c.repository.nameWithOwner}/${c.__typename === 'PullRequest' ? 'pull' : 'issues'}/${c.number}` : null;
              return (
                <div key={it.id} className="card board-card">
                  {to ? <Link to={to}>{c.title}</Link> : <span>{c?.title ?? 'Private item'}</span>}
                  <div className="meta">
                    {c?.number ? `#${c.number} · ${c.state.toLowerCase()}` : 'Draft'}
                    <span className="spacer" />
                    {c?.assignees?.nodes.map((a: any) => <Avatar key={a.login} user={{ login: a.login, avatar_url: a.avatarUrl }} size={16} />)}
                  </div>
                </div>
              );
            })}
          </section>
        ))}
      </div>
      <LoadMore q={q} />
    </div>
  );
}

export function Deployments() {
  const { repo } = useRepo();
  const q = useGhPages<{ id: number; environment: string; ref: string; sha: string; created_at: string; creator: User | null; description: string | null }>(`/repos/${repo.full_name}/deployments?per_page=30`);
  const envs = useGh<{ environments: { id: number; name: string; html_url: string }[] }>(`/repos/${repo.full_name}/environments`);
  return (
    <div className="stack">
      {!!envs.data?.environments.length && (
        <div className="toolbar">
          <span className="muted">Environments</span>
          {envs.data.environments.map((e) => (
            <span key={e.id} className="badge">
              {e.name}
            </span>
          ))}
        </div>
      )}
      <div className="card">
        <ListState q={q} count={q.items.length} empty="No deployments" />
        {q.items.map((d) => (
          <div key={d.id} className="row compact">
            <span className="state-icon">
              <RocketIcon />
            </span>
            <div className="row-main">
              <div className="row-title">
                {d.environment} <code className="ref">{d.ref}</code>
              </div>
              <div className="meta">
                {d.creator?.login} deployed <Time iso={d.created_at} /> {d.description}
              </div>
            </div>
            <Link className="row-side mono" to={`/${repo.full_name}/commit/${d.sha}`}>
              {d.sha.slice(0, 7)}
            </Link>
          </div>
        ))}
      </div>
      <LoadMore q={q} />
    </div>
  );
}
