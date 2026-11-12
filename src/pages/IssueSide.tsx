import { CheckIcon, GearIcon, GitBranchIcon, SyncIcon, XIcon } from '@primer/octicons-react';
import { useQuery } from '@tanstack/react-query';
import { type ReactNode, useState } from 'react';
import { Link } from 'react-router-dom';
import { Avatar, Dropdown, Label, Loading, StateIcon, UserLink } from '../components/ui';
import { gh, ghAll, gql, invalidate, invalidateGql, useGh, useGql } from '../lib/api';
import { confirmDialog, promptDialog, toast, useAction } from '../lib/feedback';
import type { Issue, PullRequest, Repo, User } from '../lib/types';
import { itemRoute } from './Home';

export interface Option {
  key: string;
  label: string;
  avatar?: User;
  color?: string;
  note?: string;
}

// a rest path to page through, or any loader
export type Source = string | { key: string; load: () => Promise<any[]> };

export function PickerList({
  path,
  toOption,
  selected,
  onToggle,
  close,
  single,
  onCreate,
  isSelected,
}: {
  path: Source;
  toOption: (x: any) => Option;
  selected: Set<string>;
  onToggle: (key: string, on: boolean) => Promise<unknown> | void;
  close: () => void;
  single?: boolean;
  // offered when the filter matches nothing exactly
  onCreate?: (text: string) => Promise<unknown>;
  // overrides `selected` when membership is computed
  isSelected?: (key: string) => boolean;
}) {
  const has = (k: string) => (isSelected ? isSelected(k) : selected.has(k));
  const q = useQuery<{ items: any[]; truncated: boolean }, Error>({
    queryKey: typeof path === 'string' ? ['gha', path, 10] : ['picker', path.key],
    queryFn: typeof path === 'string' ? () => ghAll(path, 10) : async () => ({ items: await path.load(), truncated: false }),
  });
  const items = q.data?.items ?? [];
  const [filter, setFilter] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const all = items.map(toOption);
  const options = all.filter((o) => o.label.toLowerCase().includes(filter.toLowerCase()));
  const exact = all.some((o) => o.label.toLowerCase() === filter.trim().toLowerCase());
  const pick = async (key: string, on: boolean) => {
    setBusy(key);
    try {
      await onToggle(key, on);
    } finally {
      setBusy(null);
    }
    if (single) close();
  };
  return (
    <div className="menu wide">
      <input className="input" autoFocus placeholder="Filter…" value={filter} onChange={(e) => setFilter(e.target.value)} />
      <div className="menu-scroll">
        {q.isLoading && <Loading />}
        {q.error && <p className="muted pad">{q.error.message}</p>}
        {!q.isLoading && !q.error && options.length === 0 && !onCreate && <p className="muted pad">Nothing to choose from.</p>}
        {options.map((o) => (
          <button key={o.key} disabled={busy !== null} onClick={() => pick(o.key, !has(o.key))}>
            <span className="check">{busy === o.key ? <span className="spinner" /> : has(o.key) ? <CheckIcon size={14} /> : null}</span>
            {o.avatar && <Avatar user={o.avatar} size={18} />}
            {o.color && <span className="swatch" style={{ background: `#${o.color}` }} />}
            <span className="menu-label">{o.label}</span>
            {o.note && <span className="muted small">{o.note}</span>}
          </button>
        ))}
        {onCreate && filter.trim() && !exact && (
          <button
            disabled={busy !== null}
            onClick={async () => {
              setBusy('__new');
              try {
                await onCreate(filter.trim());
                setFilter('');
                await q.refetch();
              } finally {
                setBusy(null);
              }
            }}
          >
            <span className="check">{busy === '__new' && <span className="spinner" />}</span>
            Create “{filter.trim()}”
          </button>
        )}
        {q.data?.truncated && <p className="menu-note">Showing the first {items.length}. Filter on GitHub for more.</p>}
      </div>
    </div>
  );
}

export function SideSection({ title, children, picker }: { title: string; children: ReactNode; picker?: Omit<Parameters<typeof PickerList>[0], 'close'> }) {
  return (
    <div className="side-section">
      <div className="side-section-head">
        {picker ? (
          <Dropdown align="right" className="side-edit" title={`Edit ${title.toLowerCase()}`} trigger={<><h4>{title}</h4><GearIcon size={14} /></>}>
            {(close) => <PickerList {...picker} close={close} />}
          </Dropdown>
        ) : (
          <h4>{title}</h4>
        )}
      </div>
      {children}
    </div>
  );
}

const REVIEW_STATE: Record<string, string> = { APPROVED: 'Approved', CHANGES_REQUESTED: 'Requested changes', COMMENTED: 'Commented', DISMISSED: 'Dismissed' };

// requested people and teams, plus everyone who already reviewed
export function Reviewers({ repo, pr, canEdit, run }: { repo: Repo; pr?: PullRequest; canEdit: boolean; run: (fn: () => Promise<unknown>, done?: string) => Promise<unknown> }) {
  const base = `/repos/${repo.full_name}`;
  const prApi = `${base}/pulls/${pr?.number}`;
  const reviews = useGh<any[]>(pr && `${prApi}/reviews?per_page=100`);
  const latest = new Map<string, any>();
  for (const r of reviews.data ?? []) if (r.user && r.state !== 'PENDING' && r.user.login !== pr?.user?.login) latest.set(r.user.login, r);
  const requested = new Set((pr?.requested_reviewers ?? []).map((u) => u.login));
  const isOrg = repo.owner.type === 'Organization';
  const selected = new Set([...(pr?.requested_reviewers ?? []).map((u) => `u:${u.login}`), ...(pr?.requested_teams ?? []).map((t) => `t:${t.slug}`)]);
  const request = (key: string, on: boolean) => {
    const [kind, name] = [key.slice(0, 1), key.slice(2)];
    const body = kind === 't' ? { team_reviewers: [name] } : { reviewers: [name] };
    return run(() => gh(`${prApi}/requested_reviewers`, { method: on ? 'POST' : 'DELETE', body }));
  };
  const source: Source = {
    key: `reviewers:${repo.full_name}`,
    load: async () => {
      const users = (await ghAll<User>(`${base}/collaborators?per_page=100`, 5).catch(() => ghAll<User>(`${base}/assignees?per_page=100`, 5))).items.map((u) => ({ u }));
      const teams = isOrg ? (await ghAll<any>(`${base}/teams?per_page=100`, 2).catch(() => ({ items: [] }))).items.map((t) => ({ t })) : [];
      return [...teams, ...users.filter((x) => x.u.login !== pr?.user?.login)];
    },
  };
  const others = [...latest.values()].filter((r) => !requested.has(r.user.login));
  return (
    <SideSection
      title="Reviewers"
      picker={
        canEdit
          ? {
              path: source,
              toOption: (x: any) => (x.t ? { key: `t:${x.t.slug}`, label: `${repo.owner.login}/${x.t.slug}`, note: 'team' } : { key: `u:${x.u.login}`, label: x.u.login, avatar: x.u }),
              selected,
              onToggle: request,
            }
          : undefined
      }
    >
      {!pr?.requested_reviewers?.length && !pr?.requested_teams?.length && !others.length && <span className="muted">No reviews requested</span>}
      {pr?.requested_reviewers?.map((u) => (
        <div key={u.id} className="side-row">
          <UserLink user={u} avatar={18} />
          <span className="spacer" />
          <span className="muted small">Pending</span>
        </div>
      ))}
      {pr?.requested_teams?.map((t) => (
        <div key={t.id} className="side-row">
          <span>{t.name}</span>
          <span className="spacer" />
          <span className="muted small">Pending</span>
        </div>
      ))}
      {others.map((r) => (
        <div key={r.user.login} className="side-row">
          <UserLink user={r.user} avatar={18} />
          <span className="spacer" />
          <span className={`muted small ${r.state === 'APPROVED' ? 'add-text' : r.state === 'CHANGES_REQUESTED' ? 'del-text' : ''}`}>{REVIEW_STATE[r.state] ?? r.state}</span>
          {canEdit && pr?.state === 'open' && (
            <button className="icon-btn sm" title="Re-request review" aria-label={`Re-request review from ${r.user.login}`} onClick={() => request(`u:${r.user.login}`, true)}>
              <SyncIcon size={14} />
            </button>
          )}
        </div>
      ))}
    </SideSection>
  );
}

const PROJECTS_QUERY = `
query($id: ID!) {
  node(id: $id) {
    ... on Issue { projectItems(first: 20) { nodes { ...item } } }
    ... on PullRequest { projectItems(first: 20) { nodes { ...item } } }
  }
}
fragment item on ProjectV2Item {
  id
  project {
    id title number url
    field(name: "Status") { ... on ProjectV2SingleSelectField { id options { id name } } }
  }
  status: fieldValueByName(name: "Status") { ... on ProjectV2ItemFieldSingleSelectValue { name optionId } }
}`;

const OWNER_PROJECTS = `
query($owner: String!, $name: String!) {
  repository(owner: $owner, name: $name) { projectsV2(first: 50) { nodes { id title closed } } }
  repositoryOwner(login: $owner) { ... on ProjectV2Owner { projectsV2(first: 50) { nodes { id title closed } } } }
}`;

// projects v2 this item belongs to, with its status
export function Projects({ repo, nodeId, canEdit }: { repo: Repo; nodeId?: string; canEdit: boolean }) {
  const q = useGql<any>('item-projects', PROJECTS_QUERY, { id: nodeId }, !!nodeId);
  const { run } = useAction();
  const items: any[] = q.data?.node?.projectItems?.nodes ?? [];
  const refresh = () => invalidateGql('item-projects');
  const mutate = (m: string, vars: Record<string, unknown>, done?: string) => run(async () => (await gql(m, vars), await refresh()), done);
  // projects need the project scope; without it there is nothing to show
  if (q.error) return null;
  return (
    <SideSection
      title="Projects"
      picker={
        canEdit && nodeId
          ? {
              path: {
                key: `projects:${repo.full_name}`,
                load: async () => {
                  const d = await gql<any>(OWNER_PROJECTS, { owner: repo.owner.login, name: repo.name });
                  const all = [...(d.repository?.projectsV2?.nodes ?? []), ...(d.repositoryOwner?.projectsV2?.nodes ?? [])].filter((p: any) => p && !p.closed);
                  return [...new Map(all.map((p: any) => [p.id, p])).values()];
                },
              },
              toOption: (p: any) => ({ key: p.id, label: p.title }),
              selected: new Set(items.map((i) => i.project.id)),
              onToggle: (projectId, on) => {
                const item = items.find((i) => i.project.id === projectId);
                return on
                  ? mutate('mutation($p: ID!, $c: ID!) { addProjectV2ItemById(input: { projectId: $p, contentId: $c }) { item { id } } }', { p: projectId, c: nodeId })
                  : mutate('mutation($p: ID!, $i: ID!) { deleteProjectV2Item(input: { projectId: $p, itemId: $i }) { deletedItemId } }', { p: projectId, i: item?.id });
              },
            }
          : undefined
      }
    >
      {q.isLoading && nodeId ? <span className="muted">Loading…</span> : !items.length && <span className="muted">None yet</span>}
      {items.map((i) => {
        const field = i.project.field;
        return (
          <div key={i.id} className="side-project">
            <a href={i.project.url} data-external>
              {i.project.title}
            </a>
            {field?.options && canEdit ? (
              <select
                className="input sm"
                value={i.status?.optionId ?? ''}
                aria-label={`Status in ${i.project.title}`}
                onChange={(e) =>
                  mutate(
                    e.target.value
                      ? 'mutation($p: ID!, $i: ID!, $f: ID!, $o: String!) { updateProjectV2ItemFieldValue(input: { projectId: $p, itemId: $i, fieldId: $f, value: { singleSelectOptionId: $o } }) { clientMutationId } }'
                      : 'mutation($p: ID!, $i: ID!, $f: ID!) { clearProjectV2ItemFieldValue(input: { projectId: $p, itemId: $i, fieldId: $f }) { clientMutationId } }',
                    { p: i.project.id, i: i.id, f: field.id, ...(e.target.value ? { o: e.target.value } : {}) },
                  )
                }
              >
                <option value="">No status</option>
                {field.options.map((o: any) => (
                  <option key={o.id} value={o.id}>
                    {o.name}
                  </option>
                ))}
              </select>
            ) : (
              i.status?.name && <span className="muted small">{i.status.name}</span>
            )}
          </div>
        );
      })}
    </SideSection>
  );
}

const DEV_QUERY = `
query($id: ID!) {
  node(id: $id) {
    ... on Issue {
      linkedBranches(first: 10) { nodes { id ref { name repository { nameWithOwner } } } }
      closedByPullRequestsReferences(first: 10, includeClosedPrs: true) { nodes { number title state isDraft merged repository { nameWithOwner } } }
    }
  }
}`;

// branches and pull requests tied to an issue
export function Development({ repo, issue, canEdit }: { repo: Repo; issue: Issue; canEdit: boolean }) {
  const q = useGql<any>('issue-dev', DEV_QUERY, { id: issue.node_id }, !!issue.node_id);
  const { busy, run } = useAction();
  const branches: any[] = q.data?.node?.linkedBranches?.nodes ?? [];
  const pulls: any[] = q.data?.node?.closedByPullRequestsReferences?.nodes ?? [];
  const slug = `${issue.number}-${issue.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40)}`;
  const create = async () => {
    const name = await promptDialog({ title: 'Create a branch for this issue', label: 'Branch name', initial: slug, confirmLabel: 'Create branch', body: `Branches from ${repo.default_branch}.` });
    if (!name) return;
    await run(async () => {
      const head = await gh<{ sha: string }>(`/repos/${repo.full_name}/commits/${encodeURIComponent(repo.default_branch)}`);
      await gql('mutation($i: ID!, $o: GitObjectID!, $n: String!, $r: ID!) { createLinkedBranch(input: { issueId: $i, oid: $o, name: $n, repositoryId: $r }) { linkedBranch { id } } }', {
        i: issue.node_id,
        o: head.sha,
        n: name,
        r: repo.node_id,
      });
      await Promise.all([invalidateGql('issue-dev'), invalidate(`/repos/${repo.full_name}/branches`)]);
    }, `Created ${name}`);
  };
  const unlink = async (b: any) => {
    if (!(await confirmDialog({ title: `Unlink ${b.ref?.name}?`, body: 'The branch itself is kept.', confirmLabel: 'Unlink' }))) return;
    await run(async () => (await gql('mutation($id: ID!) { deleteLinkedBranch(input: { linkedBranchId: $id }) { clientMutationId } }', { id: b.id }), await invalidateGql('issue-dev')));
  };
  if (q.error) return null;
  return (
    <div className="side-section">
      <div className="side-section-head">
        <h4>Development</h4>
      </div>
      {!branches.length && !pulls.length && <span className="muted">No branches or pull requests</span>}
      {pulls.map((p) => (
        <Link key={`${p.repository.nameWithOwner}#${p.number}`} className="side-row" to={`/${p.repository.nameWithOwner}/pull/${p.number}`}>
          <StateIcon item={{ pull_request: {}, state: p.state.toLowerCase(), merged: p.merged, draft: p.isDraft }} size={14} />
          <span className="ellipsis">{p.title}</span>
        </Link>
      ))}
      {branches.map((b) => (
        <div key={b.id} className="side-row">
          <GitBranchIcon size={14} />
          <Link className="ellipsis" to={`/${b.ref?.repository.nameWithOwner}/tree/${b.ref?.name}`}>
            {b.ref?.name}
          </Link>
          <span className="spacer" />
          {canEdit && (
            <button className="icon-btn sm" title="Unlink branch" aria-label={`Unlink ${b.ref?.name}`} disabled={busy} onClick={() => unlink(b)}>
              <XIcon size={14} />
            </button>
          )}
        </div>
      ))}
      {canEdit && issue.state === 'open' && (
        <button className="link-btn" disabled={busy} onClick={create}>
          Create a branch
        </button>
      )}
    </div>
  );
}

// "owner/repo#12", "#12", "12" or an issue url
export function parseIssueRef(text: string, repo: string): { repo: string; number: number } | null {
  const t = text.trim();
  const url = /github\.com\/([^/]+\/[^/]+)\/(?:issues|pull)\/(\d+)/.exec(t);
  if (url) return { repo: url[1], number: Number(url[2]) };
  const m = /^(?:([\w.-]+\/[\w.-]+))?#?(\d+)$/.exec(t);
  return m ? { repo: m[1] ?? repo, number: Number(m[2]) } : null;
}

async function resolveIssue(text: string, repo: string): Promise<Issue> {
  const ref = parseIssueRef(text, repo);
  if (!ref) throw new Error('Enter an issue number, owner/repo#number or a link');
  return gh<Issue>(`/repos/${ref.repo}/issues/${ref.number}`);
}

function IssueLine({ item, onRemove, busy }: { item: Issue; onRemove?: () => void; busy?: boolean }) {
  const full = item.repository_url?.split('/repos/')[1];
  return (
    <div className="side-row">
      <StateIcon item={item} size={14} />
      <Link className="ellipsis" to={itemRoute(item)} title={item.title}>
        {item.title}
      </Link>
      <span className="muted small">
        {full && !item.html_url?.includes(`/${full}/`) ? full : ''}#{item.number}
      </span>
      {onRemove && (
        <button className="icon-btn sm" title="Remove" aria-label={`Remove #${item.number}`} disabled={busy} onClick={onRemove}>
          <XIcon size={14} />
        </button>
      )}
    </div>
  );
}

// parent, sub-issues and blocking relationships
export function Relationships({ repo, issue, canEdit }: { repo: Repo; issue: Issue; canEdit: boolean }) {
  const api = `/repos/${repo.full_name}/issues/${issue.number}`;
  const parent = useGh<Issue>(`${api}/parent`);
  const subs = useGh<Issue[]>(`${api}/sub_issues?per_page=100`);
  const blockedBy = useGh<Issue[]>(`${api}/dependencies/blocked_by?per_page=100`);
  const blocking = useGh<Issue[]>(`${api}/dependencies/blocking?per_page=100`);
  const { busy, run } = useAction();
  const refresh = () => invalidate(api);
  const add = async (kind: 'sub' | 'parent' | 'blocked') => {
    const text = await promptDialog({
      title: kind === 'sub' ? 'Add a sub-issue' : kind === 'parent' ? 'Set a parent issue' : 'Mark as blocked by',
      label: 'Issue',
      body: 'A number, owner/repo#number or a link.',
      confirmLabel: 'Add',
    });
    if (!text) return;
    await run(async () => {
      const other = await resolveIssue(text, repo.full_name);
      if (kind === 'sub') await gh(`${api}/sub_issues`, { method: 'POST', body: { sub_issue_id: other.id } });
      else if (kind === 'blocked') await gh(`${api}/dependencies/blocked_by`, { method: 'POST', body: { issue_id: other.id } });
      else {
        const full = other.repository_url.split('/repos/')[1];
        await gh(`/repos/${full}/issues/${other.number}/sub_issues`, { method: 'POST', body: { sub_issue_id: issue.id, replace_parent: true } });
      }
      await refresh();
    });
  };
  const removeSub = (sub: Issue, from = api) => run(async () => (await gh(`${from}/sub_issue`, { method: 'DELETE', body: { sub_issue_id: sub.id } }), await refresh()));
  const subList = subs.data ?? [];
  const done = subList.filter((s) => s.state === 'closed').length;
  // the api 404s where relationships aren't enabled
  if (subs.error && blockedBy.error) return null;
  return (
    <div className="side-section">
      <div className="side-section-head">
        <h4>Relationships</h4>
        {canEdit && (
          <Dropdown align="right" className="icon-btn sm" title="Add relationship" trigger={<GearIcon size={14} />}>
            {(close) => (
              <div className="menu" onClick={close}>
                <button onClick={() => add('sub')}>Add sub-issue</button>
                <button onClick={() => add('parent')}>{parent.data ? 'Change parent issue' : 'Set parent issue'}</button>
                {!blockedBy.error && <button onClick={() => add('blocked')}>Mark as blocked by…</button>}
              </div>
            )}
          </Dropdown>
        )}
      </div>
      {!parent.data && !subList.length && !blockedBy.data?.length && !blocking.data?.length && <span className="muted">None yet</span>}
      {parent.data && (
        <>
          <span className="muted small">Parent</span>
          <IssueLine
            item={parent.data}
            busy={busy}
            onRemove={canEdit ? () => removeSub(issue, `/repos/${parent.data!.repository_url.split('/repos/')[1]}/issues/${parent.data!.number}`) : undefined}
          />
        </>
      )}
      {subList.length > 0 && (
        <>
          <span className="muted small">
            Sub-issues {done}/{subList.length}
          </span>
          {subList.map((s) => (
            <IssueLine key={s.id} item={s} busy={busy} onRemove={canEdit ? () => removeSub(s) : undefined} />
          ))}
        </>
      )}
      {!!blockedBy.data?.length && (
        <>
          <span className="muted small">Blocked by</span>
          {blockedBy.data.map((b) => (
            <IssueLine
              key={b.id}
              item={b}
              busy={busy}
              onRemove={canEdit ? () => run(async () => (await gh(`${api}/dependencies/blocked_by/${b.id}`, { method: 'DELETE' }), await refresh())) : undefined}
            />
          ))}
        </>
      )}
      {!!blocking.data?.length && (
        <>
          <span className="muted small">Blocking</span>
          {blocking.data.map((b) => (
            <IssueLine key={b.id} item={b} />
          ))}
        </>
      )}
    </div>
  );
}

// org issue types
export function IssueType({ repo, issue, canEdit, run }: { repo: Repo; issue: Issue & { type?: { name: string; color?: string } | null }; canEdit: boolean; run: (fn: () => Promise<unknown>) => Promise<unknown> }) {
  if (repo.owner.type !== 'Organization') return null;
  return (
    <SideSection
      title="Type"
      picker={
        canEdit
          ? {
              path: `/orgs/${repo.owner.login}/issue-types`,
              toOption: (t: any) => ({ key: t.name, label: t.name, note: t.description ?? undefined }),
              selected: new Set(issue.type ? [issue.type.name] : []),
              onToggle: (name, on) => run(() => gh(`/repos/${repo.full_name}/issues/${issue.number}`, { method: 'PATCH', body: { type: on ? name : null } })),
              single: true,
            }
          : undefined
      }
    >
      {issue.type ? <Label label={{ name: issue.type.name }} /> : <span className="muted">No type</span>}
    </SideSection>
  );
}

// moves an issue to another repository
export async function transferIssue(issueNodeId: string, current: string): Promise<{ url: string } | null> {
  const target = await promptDialog({ title: 'Transfer issue', label: 'Destination repository', body: 'Owner/name. You need write access there.', initial: current, confirmLabel: 'Transfer' });
  if (!target || target === current) return null;
  const [owner, name] = target.split('/');
  if (!owner || !name) {
    toast('Use the owner/name form', 'error');
    return null;
  }
  const r = await gql<any>('query($o: String!, $n: String!) { repository(owner: $o, name: $n) { id } }', { o: owner, n: name });
  const out = await gql<any>('mutation($i: ID!, $r: ID!) { transferIssue(input: { issueId: $i, repositoryId: $r }) { issue { url } } }', { i: issueNodeId, r: r.repository.id });
  return out.transferIssue.issue;
}

