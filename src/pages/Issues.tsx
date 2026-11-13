import {
  BellIcon,
  BellSlashIcon,
  CheckIcon,
  CommentIcon,
  CrossReferenceIcon,
  EyeIcon,
  GitBranchIcon,
  GitCommitIcon,
  GitMergeIcon,
  IssueClosedIcon,
  IssueReopenedIcon,
  KebabHorizontalIcon,
  LockIcon,
  MilestoneIcon,
  PencilIcon,
  PersonIcon,
  PinIcon,
  SearchIcon,
  SmileyIcon,
  TagIcon,
  TriangleDownIcon,
} from '@primer/octicons-react';
import { useQuery } from '@tanstack/react-query';
import { type ReactNode, useEffect, useMemo, useState } from 'react';
import { parse as parseYaml } from 'yaml';
import { Link, Navigate, useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { type PendingComment, ThreadView } from '../components/Diff';
import { MarkdownEditor, quoteReply } from '../components/Editor';
import { Avatar, Dropdown, Label, ListState, Loading, LoadMore, Markdown, ErrorBox, Segmented, StateIcon, StatePill, Time, UserLink } from '../components/ui';
import { ACCEPT, gh, ghRaw, gql, invalidate, invalidateGql, useGh, useGhPages, useGql } from '../lib/api';
import { useAuth } from '../lib/auth';
import { confirmDialog, promptDialog, toast, useAction, useDraft } from '../lib/feedback';
import { usePref } from '../lib/store';
import type { Issue, Label as LabelT, Milestone, PullRequest, Repo, User } from '../lib/types';
import { copyText, plural, routeFromUrl } from '../lib/util';
import { issueSearch, itemRoute } from './Home';
import { Development, IssueType, PickerList, Projects, Relationships, Reviewers, SideSection, transferIssue } from './IssueSide';
import { BranchCleanup, MergeBox, MergeQueue, PullChecks, PullCommits, type PullExtras, PullFiles, useReviewApi, useReviewThreads } from './Pull';
import { useRepo } from './Repo';

export function IssueRow({ item, showRepo, checked, onCheck }: { item: Issue; showRepo?: boolean; checked?: boolean; onCheck?: (on: boolean) => void }) {
  const full = item.repository_url.split('/repos/')[1];
  return (
    <div className={`row ${checked ? 'selected' : ''}`}>
      {onCheck && <input type="checkbox" className="row-check" checked={!!checked} onChange={(e) => onCheck(e.target.checked)} aria-label={`Select #${item.number}`} />}
      <StateIcon item={item} />
      <div className="row-main">
        <div className="row-title">
          <Link to={itemRoute(item)}>{item.title}</Link>
          {item.labels?.map((l) => <Label key={l.id ?? l.name} label={l} />)}
        </div>
        <div className="meta">
          {showRepo && <Link to={`/${full}`}>{full}</Link>}
          <span>
            #{item.number} opened <Time iso={item.created_at} /> by {item.user?.login ?? 'ghost'}
          </span>
          {item.draft && <span>Draft</span>}
          {item.milestone && <span>{item.milestone.title}</span>}
        </div>
      </div>
      <div className="row-side">
        {item.assignees?.slice(0, 3).map((a) => <Avatar key={a.id} user={a} size={18} />)}
        {item.comments > 0 && (
          <span className="meta-item">
            <CommentIcon size={14} /> {item.comments}
          </span>
        )}
      </div>
    </div>
  );
}

// search box whose committed value lives in ?q=
export function QueryBox({ placeholder }: { placeholder: string }) {
  const [sp, setSp] = useSearchParams();
  const [text, setText] = useState(sp.get('q') ?? '');
  useEffect(() => setText(sp.get('q') ?? ''), [sp]);
  return (
    <form
      className="query-box"
      onSubmit={(e) => {
        e.preventDefault();
        const next = new URLSearchParams(sp);
        if (text.trim()) next.set('q', text.trim());
        else next.delete('q');
        setSp(next);
      }}
    >
      <SearchIcon size={14} />
      <input value={text} placeholder={placeholder} onChange={(e) => setText(e.target.value)} aria-label="Filter" />
    </form>
  );
}

const SORTS: Record<string, string> = {
  updated: 'Recently updated',
  created: 'Newest',
  'created-asc': 'Oldest',
  comments: 'Most commented',
  reactions: 'Most reactions',
};

// qualifier tokens like label:"good first issue" in a search string
const qualifier = (key: string, value: string) => `${key}:${/\s/.test(value) ? `"${value}"` : value}`;
function hasQualifier(text: string, key: string, value: string) {
  return text.split(/\s+(?=(?:[^"]*"[^"]*")*[^"]*$)/).includes(qualifier(key, value));
}
function toggleQualifier(text: string, key: string, value: string, on: boolean, single = false) {
  const tokens = text.split(/\s+(?=(?:[^"]*"[^"]*")*[^"]*$)/).filter(Boolean);
  const token = qualifier(key, value);
  const rest = tokens.filter((t) => t !== token && !(single && t.startsWith(`${key}:`)));
  return (on ? [...rest, token] : rest).join(' ');
}

function FilterMenu({ label, text, setText, path, qkey, toOption, single }: { label: string; text: string; setText: (t: string) => void; path: string; qkey: string; toOption: (x: any) => { key: string; label: string; avatar?: User; color?: string }; single?: boolean }) {
  const active = text.includes(`${qkey}:`);
  return (
    <Dropdown align="right" className={`btn ${active ? 'on' : ''}`} trigger={<>{label} <TriangleDownIcon size={12} /></>}>
      {(close) => (
        <PickerList
          path={path}
          toOption={toOption}
          selected={new Set()}
          isSelected={(k) => hasQualifier(text, qkey, k)}
          onToggle={(k, on) => setText(toggleQualifier(text, qkey, k, on, single))}
          close={close}
          single={single}
        />
      )}
    </Dropdown>
  );
}

// changes several issues at once
function BulkBar({ repo, items, clear }: { repo: Repo; items: Issue[]; clear: () => void }) {
  const { busy, run } = useAction();
  const base = `/repos/${repo.full_name}`;
  const each = (fn: (it: Issue) => Promise<unknown>, done: string) =>
    run(async () => {
      for (const it of items) await fn(it);
      await invalidate('/search/issues');
      clear();
    }, done);
  const anyOpen = items.some((i) => i.state === 'open');
  return (
    <div className="bulk-bar">
      <span>{plural(items.length, 'selected item')}</span>
      <span className="spacer" />
      <button className="btn sm" disabled={busy} onClick={() => each((it) => gh(`${base}/issues/${it.number}`, { method: 'PATCH', body: { state: anyOpen ? 'closed' : 'open' } }), anyOpen ? 'Closed' : 'Reopened')}>
        {anyOpen ? 'Close' : 'Reopen'}
      </button>
      <Dropdown align="right" className="btn sm" trigger="Label" disabled={busy}>
        {(close) => (
          <PickerList
            path={`${base}/labels?per_page=100`}
            toOption={(l: LabelT) => ({ key: l.name, label: l.name, color: l.color })}
            selected={new Set((items[0]?.labels ?? []).filter((l) => items.every((i) => i.labels.some((x) => x.name === l.name))).map((l) => l.name))}
            onToggle={(name, on) => each((it) => (on ? gh(`${base}/issues/${it.number}/labels`, { method: 'POST', body: { labels: [name] } }) : gh(`${base}/issues/${it.number}/labels/${encodeURIComponent(name)}`, { method: 'DELETE' }).catch(() => null)), on ? `Labelled ${name}` : `Removed ${name}`)}
            close={close}
            single
          />
        )}
      </Dropdown>
      <Dropdown align="right" className="btn sm" trigger="Assign" disabled={busy}>
        {(close) => (
          <PickerList
            path={`${base}/assignees?per_page=100`}
            toOption={(u: User) => ({ key: u.login, label: u.login, avatar: u })}
            selected={new Set(items[0]?.assignees.filter((a) => items.every((i) => i.assignees.some((x) => x.login === a.login))).map((a) => a.login) ?? [])}
            onToggle={(login, on) => each((it) => gh(`${base}/issues/${it.number}/assignees`, { method: on ? 'POST' : 'DELETE', body: { assignees: [login] } }), on ? `Assigned ${login}` : `Unassigned ${login}`)}
            close={close}
            single
          />
        )}
      </Dropdown>
      <Dropdown align="right" className="btn sm" trigger="Milestone" disabled={busy}>
        {(close) => (
          <PickerList
            path={`${base}/milestones?state=open&per_page=100`}
            toOption={(m: Milestone) => ({ key: String(m.number), label: m.title })}
            selected={new Set()}
            onToggle={(num, on) => each((it) => gh(`${base}/issues/${it.number}`, { method: 'PATCH', body: { milestone: on ? Number(num) : null } }), 'Milestone set')}
            close={close}
            single
          />
        )}
      </Dropdown>
      <button className="btn sm" onClick={clear}>
        Clear
      </button>
    </div>
  );
}

function ResultList({ query, showRepo, emptyTitle, action, repo }: { query: string; showRepo?: boolean; emptyTitle: string; action?: ReactNode; repo?: Repo }) {
  const [sp, setSp] = useSearchParams();
  const state = sp.get('state') === 'closed' ? 'closed' : 'open';
  const other = state === 'open' ? 'closed' : 'open';
  const text = sp.get('q') ?? '';
  const sort = SORTS[sp.get('sort') ?? ''] ? sp.get('sort')! : 'updated';
  const [field, order] = sort.split('-');
  const list = useGhPages<Issue>(issueSearch(`${query} state:${state} ${text}`.trim(), `&sort=${field}&order=${order ?? 'desc'}`), { pick: (d) => d.items });
  const otherCount = useGh<{ total_count: number }>(issueSearch(`${query} state:${other} ${text}`.trim()).replace('per_page=30', 'per_page=1'));
  const counts = { [state]: list.total, [other]: otherCount.data?.total_count } as Record<string, number | undefined>;
  const label = (s: string, name: string) => (counts[s] != null ? `${name} ${counts[s]!.toLocaleString()}` : name);
  const setParam = (key: string, value: string | null) => {
    const next = new URLSearchParams(sp);
    if (value) next.set(key, value);
    else next.delete(key);
    setSp(next);
  };
  const [picked, setPicked] = useState<Set<number>>(new Set());
  useEffect(() => setPicked(new Set()), [query, state, text]);
  const canBulk = !!repo && !!(repo.permissions?.triage || repo.permissions?.push);
  const selectedItems = list.items.filter((i) => picked.has(i.number));
  const setText = (t: string) => setParam('q', t.trim() || null);

  return (
    <div className="stack">
      <div className="toolbar">
        <Segmented
          value={state}
          onChange={(s) => setParam('state', s === 'open' ? null : s)}
          options={[
            { value: 'open', label: label('open', 'Open') },
            { value: 'closed', label: label('closed', 'Closed') },
          ]}
        />
        <QueryBox placeholder="Filter, e.g. label:bug author:octocat" />
        {repo && (
          <>
            <FilterMenu label="Author" text={text} setText={setText} path={`/repos/${repo.full_name}/contributors?per_page=100`} qkey="author" toOption={(u: User) => ({ key: u.login, label: u.login, avatar: u })} single />
            <FilterMenu label="Label" text={text} setText={setText} path={`/repos/${repo.full_name}/labels?per_page=100`} qkey="label" toOption={(l: LabelT) => ({ key: l.name, label: l.name, color: l.color })} />
            <FilterMenu label="Assignee" text={text} setText={setText} path={`/repos/${repo.full_name}/assignees?per_page=100`} qkey="assignee" toOption={(u: User) => ({ key: u.login, label: u.login, avatar: u })} single />
            <FilterMenu label="Milestone" text={text} setText={setText} path={`/repos/${repo.full_name}/milestones?state=all&per_page=100`} qkey="milestone" toOption={(m: Milestone) => ({ key: m.title, label: m.title })} single />
          </>
        )}
        <Dropdown align="right" trigger={`Sort: ${SORTS[sort]}`}>
          {(close) => (
            <div className="menu" onClick={close}>
              {Object.entries(SORTS).map(([k, name]) => (
                <button key={k} onClick={() => setParam('sort', k === 'updated' ? null : k)}>
                  <span className="check">{k === sort && <CheckIcon size={14} />}</span>
                  {name}
                </button>
              ))}
            </div>
          )}
        </Dropdown>
        {action}
      </div>
      {selectedItems.length > 0 && repo && <BulkBar repo={repo} items={selectedItems} clear={() => setPicked(new Set())} />}
      <div className="card">
        {canBulk && list.items.length > 0 && (
          <label className="row compact check-row bulk-all">
            <input
              type="checkbox"
              checked={picked.size > 0 && list.items.every((i) => picked.has(i.number))}
              onChange={(e) => setPicked(e.target.checked ? new Set(list.items.map((i) => i.number)) : new Set())}
            />
            <span className="muted small">Select all loaded</span>
          </label>
        )}
        <ListState q={list} count={list.items.length} empty={emptyTitle} />
        {list.items.map((it) => (
          <IssueRow
            key={it.id}
            item={it}
            showRepo={showRepo}
            checked={picked.has(it.number)}
            onCheck={
              canBulk
                ? (on) => {
                    const next = new Set(picked);
                    if (on) next.add(it.number);
                    else next.delete(it.number);
                    setPicked(next);
                  }
                : undefined
            }
          />
        ))}
      </div>
      <LoadMore q={list} />
    </div>
  );
}

export function IssueList({ kind }: { kind: 'issue' | 'pr' }) {
  const { repo } = useRepo();
  return (
    <ResultList
      key={kind}
      repo={repo}
      query={`repo:${repo.full_name} is:${kind}`}
      emptyTitle={kind === 'pr' ? 'No pull requests match' : 'No issues match'}
      action={
        <>
          <Link className="btn" to={`/${repo.full_name}/labels`} title="Manage labels" aria-label="Manage labels">
            <TagIcon />
          </Link>
          <Link className="btn" to={`/${repo.full_name}/milestones`} title="Manage milestones" aria-label="Manage milestones">
            <MilestoneIcon />
          </Link>
          <Link className="btn primary" to={kind === 'issue' ? `/${repo.full_name}/issues/new` : `/${repo.full_name}/compare`}>
            {kind === 'issue' ? 'New issue' : 'New pull request'}
          </Link>
        </>
      }
    />
  );
}

export function GlobalIssues({ kind }: { kind: 'issue' | 'pr' }) {
  const [sp] = useSearchParams();
  const filters: Record<string, string> = {
    author: 'Created by me',
    assignee: 'Assigned to me',
    mentions: 'Mentioning me',
    ...(kind === 'pr' ? { 'review-requested': 'Needs my review', 'reviewed-by': 'Reviewed by me' } : {}),
  };
  const filter = filters[sp.get('filter') ?? ''] ? sp.get('filter')! : 'author';
  return (
    <div className="page narrow">
      <header className="page-head">
        <h1>{kind === 'pr' ? 'Pull requests' : 'Issues'}</h1>
        <p className="muted">{filters[filter]}, across every repository.</p>
      </header>
      <ResultList key={kind + filter} query={`is:${kind} ${filter}:@me archived:false`} showRepo emptyTitle="Nothing here" />
    </div>
  );
}

const REACTIONS: [string, string][] = [
  ['+1', '👍'], ['-1', '👎'], ['laugh', '😄'], ['hooray', '🎉'], ['confused', '😕'], ['heart', '❤️'], ['rocket', '🚀'], ['eyes', '👀'],
];

// adds the reaction, or removes it when the viewer already had it
export async function toggleReaction(path: string, content: string) {
  const r = await ghRaw(path, { method: 'POST', body: { content } });
  if (r.status === 200) await gh(`${path}/${JSON.parse(r.body).id}`, { method: 'DELETE' });
}

export function Comment({
  c,
  badge,
  context,
  onSave,
  onDelete,
  onReact,
  onQuote,
  link,
  verb = 'commented',
  hidden,
  onHide,
}: {
  c: { user: User | null; body?: string | null; body_html?: string; created_at?: string; submitted_at?: string; reactions?: Record<string, any>; author_association?: string };
  badge?: string;
  context: string;
  onSave?: (body: string) => Promise<unknown>;
  onDelete?: () => Promise<unknown>;
  onReact?: (content: string) => Promise<unknown>;
  onQuote?: (body: string) => void;
  link?: string;
  verb?: string;
  // why the comment was minimized, if it was
  hidden?: string;
  onHide?: (classifier: string | null) => Promise<unknown>;
}) {
  const [editing, setEditing] = useState(false);
  const [reveal, setReveal] = useState(false);
  const [draft, setDraft] = useState('');
  const { busy, run } = useAction();
  const reactions = REACTIONS.filter(([k]) => c.reactions?.[k] > 0);
  const save = () => run(() => onSave!(draft)).then(() => setEditing(false));
  const role = c.author_association && !['NONE', 'CONTRIBUTOR', 'FIRST_TIME_CONTRIBUTOR', 'FIRST_TIMER'].includes(c.author_association) ? c.author_association : null;
  return (
    <div className="comment">
      <Avatar user={c.user} size={32} />
      <div className="card comment-box">
        <div className="card-head">
          <UserLink user={c.user} />
          <span>
            {verb} <Time iso={(c.created_at ?? c.submitted_at)!} />
          </span>
          <span className="spacer" />
          {badge && <span className="badge">{badge}</span>}
          {role && <span className="badge">{role[0] + role.slice(1).toLowerCase()}</span>}
          {onReact && (
            <Dropdown align="right" className="icon-btn sm" title="Add reaction" trigger={<SmileyIcon size={14} />}>
              {(close) => (
                <div className="menu emoji-menu" onClick={close}>
                  {REACTIONS.map(([k, emoji]) => (
                    <button key={k} title={k} onClick={() => void run(() => onReact(k))}>
                      {emoji}
                    </button>
                  ))}
                </div>
              )}
            </Dropdown>
          )}
          <Dropdown align="right" className="icon-btn sm" title="More" trigger={<KebabHorizontalIcon size={14} />}>
            {(close) => (
              <div className="menu" onClick={close}>
                {link && (
                  <button
                    onClick={() => {
                      void copyText(link);
                      toast('Link copied');
                    }}
                  >
                    Copy link
                  </button>
                )}
                {onQuote && c.body && <button onClick={() => onQuote(c.body!)}>Quote reply</button>}
                {onSave && (
                  <button
                    onClick={() => {
                      setDraft(c.body ?? '');
                      setEditing(true);
                    }}
                  >
                    Edit
                  </button>
                )}
                {onHide &&
                  (hidden ? (
                    <button onClick={() => void run(() => onHide(null))}>Unhide</button>
                  ) : (
                    <button
                      onClick={async () => {
                        const reason = await promptDialog({ title: 'Hide this comment', label: 'Reason', options: HIDE_REASONS, confirmLabel: 'Hide' });
                        if (reason) void run(() => onHide(reason));
                      }}
                    >
                      Hide
                    </button>
                  ))}
                {onDelete && (
                  <button
                    onClick={async () => {
                      if (await confirmDialog({ title: 'Delete this comment?', confirmLabel: 'Delete', danger: true })) void run(onDelete);
                    }}
                  >
                    Delete
                  </button>
                )}
              </div>
            )}
          </Dropdown>
        </div>
        {hidden && !reveal ? (
          <div className="pad muted small">
            This comment was hidden as {hidden.toLowerCase().replace('_', '-')}.{' '}
            <button className="link-btn" onClick={() => setReveal(true)}>
              Show it
            </button>
          </div>
        ) : (
        <div className="pad">
          {editing ? (
            <>
              <MarkdownEditor value={draft} onChange={setDraft} context={context} onSubmit={save} autoFocus />
              <div className="form-foot">
                <span className="spacer" />
                <button className="btn" onClick={() => setEditing(false)}>
                  Cancel
                </button>
                <button className="btn primary" disabled={busy} onClick={save}>
                  {busy ? 'Saving…' : 'Save'}
                </button>
              </div>
            </>
          ) : c.body_html ? (
            <Markdown html={c.body_html} />
          ) : c.body ? (
            <p className="plain-body">{c.body}</p>
          ) : (
            <span className="muted">No description provided.</span>
          )}
          {reactions.length > 0 && (
            <div className="reactions">
              {reactions.map(([k, emoji]) => (
                <button key={k} className="reaction" disabled={!onReact || busy} title={`Toggle ${k}`} onClick={() => onReact && run(() => onReact(k))}>
                  {emoji} {c.reactions![k]}
                </button>
              ))}
            </div>
          )}
        </div>
        )}
      </div>
    </div>
  );
}

const HIDE_REASONS = [
  { value: 'OFF_TOPIC', label: 'Off-topic' },
  { value: 'OUTDATED', label: 'Outdated' },
  { value: 'RESOLVED', label: 'Resolved' },
  { value: 'DUPLICATE', label: 'Duplicate' },
  { value: 'SPAM', label: 'Spam' },
  { value: 'ABUSE', label: 'Abuse' },
];

const LOCK_REASONS = [
  { value: 'none', label: 'No reason' },
  { value: 'off-topic', label: 'Off-topic' },
  { value: 'too heated', label: 'Too heated' },
  { value: 'resolved', label: 'Resolved' },
  { value: 'spam', label: 'Spam' },
];

const hideComment = (subjectId: string, classifier: string | null) =>
  classifier
    ? gql('mutation($id: ID!, $c: ReportedContentClassifiers!) { minimizeComment(input: { subjectId: $id, classifier: $c }) { clientMutationId } }', { id: subjectId, c: classifier })
    : gql('mutation($id: ID!) { unminimizeComment(input: { subjectId: $id }) { clientMutationId } }', { id: subjectId });

// one-line description for non-comment timeline events
function describeEvent(ev: any, isPr: boolean): { icon: ReactNode; text: ReactNode } | null {
  const who = (u: any) => <strong>{u?.login ?? 'someone'}</strong>;
  switch (ev.event) {
    case 'labeled':
    case 'unlabeled':
      return { icon: <TagIcon />, text: <>{ev.event === 'labeled' ? 'added' : 'removed'} the <Label label={ev.label} /> label</> };
    case 'assigned':
    case 'unassigned': {
      const self = ev.assignee?.login === ev.actor?.login;
      const verb = ev.event === 'assigned' ? 'assigned' : 'unassigned';
      return { icon: <PersonIcon />, text: self ? (ev.event === 'assigned' ? 'self-assigned this' : 'removed their assignment') : <>{verb} {who(ev.assignee)}</> };
    }
    case 'closed':
      return {
        icon: <IssueClosedIcon />,
        text: isPr ? 'closed this' : ev.state_reason === 'not_planned' ? 'closed this as not planned' : 'closed this as completed',
      };
    case 'reopened':
      return { icon: <IssueReopenedIcon />, text: 'reopened this' };
    case 'merged':
      return { icon: <GitMergeIcon />, text: <>merged this{ev.commit_id && <> in <code>{ev.commit_id.slice(0, 7)}</code></>}</> };
    case 'renamed':
      return { icon: <PencilIcon />, text: <>changed the title from <s>{ev.rename?.from}</s> to <strong>{ev.rename?.to}</strong></> };
    case 'review_requested':
      return { icon: <EyeIcon />, text: <>requested a review from {ev.requested_reviewer ? who(ev.requested_reviewer) : <strong>{ev.requested_team?.name ?? 'a team'}</strong>}</> };
    case 'review_request_removed':
      return { icon: <EyeIcon />, text: <>removed the review request for {who(ev.requested_reviewer)}</> };
    case 'review_dismissed':
      return { icon: <EyeIcon />, text: 'dismissed a review' };
    case 'milestoned':
    case 'demilestoned':
      return { icon: <MilestoneIcon />, text: <>{ev.event === 'milestoned' ? 'added this to' : 'removed this from'} the <strong>{ev.milestone?.title}</strong> milestone</> };
    case 'locked':
    case 'unlocked':
      return { icon: <LockIcon />, text: `${ev.event} this conversation` };
    case 'pinned':
    case 'unpinned':
      return { icon: <PinIcon />, text: `${ev.event} this issue` };
    case 'transferred':
      return { icon: <CrossReferenceIcon />, text: 'transferred this issue' };
    case 'head_ref_force_pushed':
      return { icon: <GitBranchIcon />, text: 'force-pushed the branch' };
    case 'head_ref_deleted':
      return { icon: <GitBranchIcon />, text: 'deleted the branch' };
    case 'head_ref_restored':
      return { icon: <GitBranchIcon />, text: 'restored the branch' };
    case 'base_ref_changed':
      return { icon: <GitBranchIcon />, text: 'changed the base branch' };
    case 'convert_to_draft':
      return { icon: <PencilIcon />, text: 'marked this as a draft' };
    case 'ready_for_review':
      return { icon: <EyeIcon />, text: 'marked this as ready for review' };
    case 'auto_merge_enabled':
    case 'auto_merge_disabled':
      return { icon: <GitMergeIcon />, text: `${ev.event === 'auto_merge_enabled' ? 'enabled' : 'disabled'} auto-merge` };
    case 'cross-referenced': {
      const src = ev.source?.issue;
      if (!src) return null;
      return { icon: <CrossReferenceIcon />, text: <>mentioned this in <Link to={itemRoute(src)}>{src.title} #{src.number}</Link></> };
    }
    case 'referenced':
      return ev.commit_id ? { icon: <GitCommitIcon />, text: <>referenced this in commit <code>{ev.commit_id.slice(0, 7)}</code></> } : null;
    default:
      return null;
  }
}

const REVIEW_VERB: Record<string, string> = {
  approved: 'approved these changes',
  changes_requested: 'requested changes',
  commented: 'reviewed',
  dismissed: 'had a review dismissed',
};

const EXTRAS_QUERY = `
query($owner: String!, $name: String!, $number: Int!) {
  repository(owner: $owner, name: $name) {
    issueOrPullRequest(number: $number) {
      ... on Issue { id viewerSubscription isPinned viewerCanDelete comments(last: 100) { nodes { databaseId isMinimized minimizedReason } } }
      ... on PullRequest {
        id viewerSubscription viewerCanUpdateBranch reviewDecision
        comments(last: 100) { nodes { databaseId isMinimized minimizedReason } }
        reviewThreads(first: 100) { nodes { id isResolved comments(first: 1) { nodes { databaseId } } } }
        closingIssuesReferences(first: 10) { nodes { number title state repository { nameWithOwner } } }
      }
    }
  }
}`;

type View = 'files' | 'commits' | 'checks';

export function IssueDetail({ view }: { view?: View }) {
  const { repo } = useRepo();
  const { viewer } = useAuth();
  const { number } = useParams();
  const navigate = useNavigate();
  const onPullRoute = useLocation().pathname.includes('/pull/');
  const base = `/repos/${repo.full_name}`;
  const api = `${base}/issues/${number}`;
  const prApi = `${base}/pulls/${number}`;
  const issue = useGh<Issue>(api, { accept: ACCEPT.full });
  const isPr = !!issue.data?.pull_request;
  const pr = useGh<PullRequest>(isPr && prApi, {
    // mergeability is computed lazily
    refetchInterval: (q) => (q.state.data && q.state.data.state === 'open' && q.state.data.mergeable == null ? 3000 : false),
  });
  const timeline = useGhPages<any>(`${api}/timeline?per_page=100`, { accept: ACCEPT.full });
  const extrasQ = useGql<any>('issue-extras', EXTRAS_QUERY, { owner: repo.owner.login, name: repo.name, number: Number(number) }, issue.isSuccess);
  const extras: (PullExtras & { isPinned?: boolean; viewerCanDelete?: boolean; comments?: { nodes: { databaseId: number; isMinimized: boolean; minimizedReason: string | null }[] } }) | undefined =
    extrasQ.data?.repository?.issueOrPullRequest;
  const minimized = new Map((extras?.comments?.nodes ?? []).filter((c) => c.isMinimized).map((c) => [c.databaseId, c.minimizedReason ?? 'hidden']));
  const review = useReviewThreads(repo, number!, extras, isPr);

  const draftKey = `${repo.full_name}#${number}`;
  const [comment, setComment, clearComment] = useDraft(`comment:${draftKey}`);
  const [pendingRaw, setPendingRaw] = usePref(`review:${draftKey}`, '[]');
  const pending = useMemo<PendingComment[]>(() => {
    try {
      return JSON.parse(pendingRaw);
    } catch {
      return [];
    }
  }, [pendingRaw]);
  const [title, setTitle] = useState<string | null>(null);
  const { busy, run: act } = useAction();

  const refresh = () => Promise.all([invalidate(api), isPr ? invalidate(prApi) : null, invalidateGql('issue-extras')]);
  // runs a write, then refreshes everything about this issue
  const run = (fn: () => Promise<unknown>, done?: string) => act(async () => (await fn(), await refresh()), done);
  const reviewApi = useReviewApi({ repo, pr: pr.data, threads: review.threads, viewer: viewer.login, pending, setPending: (p) => setPendingRaw(JSON.stringify(p)), refresh });

  if (issue.isLoading) return <Loading />;
  if (issue.error) return <ErrorBox error={issue.error} retry={issue.refetch} />;
  const it = issue.data!;
  const route = `/${repo.full_name}/${isPr ? 'pull' : 'issues'}/${number}`;
  if (isPr !== onPullRoute) return <Navigate replace to={route} />;

  const perms = repo.permissions ?? {};
  const canTriage = !!(perms.triage || perms.push);
  const isAuthor = it.user?.login === viewer.login;
  const canClose = canTriage || isAuthor;
  const stateSource = pr.data ?? it;
  const open = it.state === 'open';
  const subscribed = extras?.viewerSubscription === 'SUBSCRIBED';

  const patch = (body: object) => run(() => gh(isPr && 'state' in body ? prApi : api, { method: 'PATCH', body }));
  const selected = (list: any[] | undefined, key: string) => new Set<string>((list ?? []).map((x) => String(x[key])));
  const userOption = (u: User) => ({ key: u.login, label: u.login, avatar: u });
  const quote = (body: string) => {
    setComment(comment + quoteReply(body));
    document.querySelector<HTMLTextAreaElement>('.composer textarea')?.focus();
  };

  const submitComment = (thenClose?: 'completed' | 'not_planned' | 'duplicate' | 'reopen') =>
    run(async () => {
      if (comment.trim()) await gh(`${api}/comments`, { method: 'POST', body: { body: comment } });
      clearComment();
      if (thenClose === 'reopen') await gh(isPr ? prApi : api, { method: 'PATCH', body: { state: 'open' } });
      else if (thenClose) await gh(isPr ? prApi : api, { method: 'PATCH', body: isPr ? { state: 'closed' } : { state: 'closed', state_reason: thenClose } });
    });
  const closeDuplicate = async () => {
    const of = await promptDialog({ title: 'Close as duplicate', label: 'Duplicate of', body: 'An issue number, owner/repo#number or a link.', confirmLabel: 'Close issue' });
    if (!of) return;
    const ref = /^\d+$/.test(of) ? `#${of}` : of;
    await run(async () => {
      await gh(`${api}/comments`, { method: 'POST', body: { body: `${comment.trim() ? comment.trim() + '\n\n' : ''}Duplicate of ${ref}` } });
      clearComment();
      await gh(api, { method: 'PATCH', body: { state: 'closed', state_reason: 'duplicate' } });
    }, 'Closed as duplicate');
  };
  const lock = async () => {
    if (it.locked) return run(() => gh(`${api}/lock`, { method: 'DELETE' }), 'Unlocked');
    const reason = await promptDialog({ title: 'Lock conversation', label: 'Reason', options: LOCK_REASONS, confirmLabel: 'Lock', body: 'Only collaborators can comment while it is locked.' });
    if (!reason) return;
    return run(() => gh(`${api}/lock`, { method: 'PUT', body: reason !== 'none' ? { lock_reason: reason } : {} }), 'Locked');
  };
  const changeBase = async () => {
    const branches = await gh<{ name: string }[]>(`${base}/branches?per_page=100`).catch(() => []);
    const to = await promptDialog({
      title: 'Change the base branch',
      label: 'Base',
      options: branches.filter((b) => b.name !== pr.data!.head.ref).map((b) => ({ value: b.name, label: b.name })),
      confirmLabel: 'Change base',
    });
    if (to && to !== pr.data!.base.ref) await run(() => gh(prApi, { method: 'PATCH', body: { base: to } }), `Base is now ${to}`);
  };
  const revert = async () => {
    if (!(await confirmDialog({ title: 'Revert this pull request?', body: 'Opens a new pull request that undoes these changes.', confirmLabel: 'Create revert' }))) return;
    const out = await act(() => gql<any>('mutation($id: ID!) { revertPullRequest(input: { pullRequestId: $id }) { revertPullRequest { number } } }', { id: pr.data!.node_id }));
    const n = out?.revertPullRequest?.revertPullRequest?.number;
    if (n) navigate(`/${repo.full_name}/pull/${n}`);
  };
  const transfer = async () => {
    const out = await act(() => transferIssue(it.node_id, repo.full_name)).catch(() => null);
    if (!out) return;
    toast('Issue transferred');
    const route = routeFromUrl(out.url);
    if (route) navigate(route, { replace: true });
  };
  const mutate = (name: string, input: string, vars: Record<string, unknown>, done?: string) =>
    run(() => gql(`mutation($id: ID!) { ${name}(input: { ${input} }) { clientMutationId } }`, vars), done);

  const tabs: { id: View | 'conversation'; label: string }[] = [
    { id: 'conversation', label: `Conversation${it.comments ? ` ${it.comments}` : ''}` },
    { id: 'commits', label: `Commits${pr.data ? ` ${pr.data.commits}` : ''}` },
    { id: 'checks', label: 'Checks' },
    { id: 'files', label: `Files changed${pr.data ? ` ${pr.data.changed_files}` : ''}` },
  ];

  return (
    <div className="issue-page">
      <header className="issue-head">
        {title === null ? (
          <h1>
            {it.title} <span className="muted">#{it.number}</span>
            {canClose && (
              <button className="icon-btn" title="Edit title" aria-label="Edit title" onClick={() => setTitle(it.title)}>
                <PencilIcon />
              </button>
            )}
          </h1>
        ) : (
          <form
            className="title-edit"
            onSubmit={(e) => {
              e.preventDefault();
              void patch({ title }).then(() => setTitle(null));
            }}
          >
            <input className="input" autoFocus value={title} onChange={(e) => setTitle(e.target.value)} aria-label="Title" />
            <button className="btn primary" disabled={!title.trim() || busy}>
              Save
            </button>
            <button type="button" className="btn" onClick={() => setTitle(null)}>
              Cancel
            </button>
          </form>
        )}
        <div className="issue-sub">
          <StatePill item={stateSource} />
          <span className="muted">
            <UserLink user={it.user} />{' '}
            {isPr && pr.data ? (
              <>
                wants to merge {plural(pr.data.commits, 'commit')} into <code className="ref">{pr.data.base.ref}</code> from <code className="ref">{pr.data.head.label}</code>
              </>
            ) : (
              <>
                opened this <Time iso={it.created_at} /> · {plural(it.comments, 'comment')}
              </>
            )}
          </span>
        </div>
      </header>

      {isPr && (
        <div className="toolbar">
          <div className="segmented">
            {tabs.map((t) => (
              <Link key={t.id} to={t.id === 'conversation' ? route : `${route}/${t.id}`} className={(view ?? 'conversation') === t.id ? 'on' : ''}>
                {t.label}
              </Link>
            ))}
          </div>
          {pr.data && (
            <span className="diffstat">
              <span className="add-text">+{pr.data.additions.toLocaleString()}</span> <span className="del-text">−{pr.data.deletions.toLocaleString()}</span>
            </span>
          )}
        </div>
      )}

      {view && !pr.data ? (
        <Loading />
      ) : view === 'files' ? (
        <PullFiles repo={repo} pr={pr.data!} review={{ ...reviewApi, clearPending: () => setPendingRaw('[]') }} own={isAuthor} open={open} />
      ) : view === 'commits' ? (
        <PullCommits repo={repo} pr={pr.data!} />
      ) : view === 'checks' ? (
        <PullChecks repo={repo} pr={pr.data!} />
      ) : (
        <div className="issue-layout">
          <div className="timeline">
            <Comment
              c={it}
              badge="Author"
              context={repo.full_name}
              verb="opened this"
              link={it.html_url}
              onQuote={quote}
              onSave={canTriage || isAuthor ? (body) => patch({ body }) : undefined}
              onReact={(content) => run(() => toggleReaction(`${api}/reactions`, content))}
            />
            <ListState q={timeline} count={1} empty="" />
            {timeline.items.map((ev, i) => {
              const key = ev.id ?? ev.node_id ?? ev.sha ?? i;
              if (ev.event === 'commented') {
                const mine = ev.user?.login === viewer.login;
                const commentApi = `${base}/issues/comments/${ev.id}`;
                return (
                  <Comment
                    key={key}
                    c={ev}
                    context={repo.full_name}
                    link={ev.html_url}
                    onQuote={quote}
                    badge={ev.user?.login === it.user?.login ? 'Author' : undefined}
                    onSave={mine || perms.push ? (body) => run(() => gh(commentApi, { method: 'PATCH', body: { body } })) : undefined}
                    onDelete={mine || perms.push ? () => run(() => gh(commentApi, { method: 'DELETE' })) : undefined}
                    onReact={(content) => run(() => toggleReaction(`${commentApi}/reactions`, content))}
                    hidden={minimized.get(ev.id)}
                    onHide={canTriage && ev.node_id ? (c) => run(() => hideComment(ev.node_id, c)) : undefined}
                  />
                );
              }
              if (ev.event === 'reviewed') {
                const threads = review.threads.filter((t) => t.root.pull_request_review_id === ev.id);
                const hasBody = ev.body_html || ev.body;
                if (!hasBody && !threads.length && ev.state === 'commented') return null;
                return (
                  <div key={key} className="review-block">
                    {perms.push && open && (ev.state === 'approved' || ev.state === 'changes_requested') && (
                      <button
                        className="link-btn small review-dismiss"
                        disabled={busy}
                        onClick={async () => {
                          const message = await promptDialog({ title: `Dismiss ${ev.user?.login}'s review`, label: 'Reason', confirmLabel: 'Dismiss review', danger: true });
                          if (message) void run(() => gh(`${prApi}/reviews/${ev.id}/dismissals`, { method: 'PUT', body: { message } }), 'Review dismissed');
                        }}
                      >
                        Dismiss review
                      </button>
                    )}
                    {hasBody ? (
                      <Comment c={ev} context={repo.full_name} verb={REVIEW_VERB[ev.state] ?? 'reviewed'} onQuote={quote} link={ev.html_url} />
                    ) : (
                      <div className="event">
                        <EyeIcon />
                        <span>
                          <strong>{ev.user?.login}</strong> {REVIEW_VERB[ev.state] ?? 'reviewed'} · <Time iso={ev.submitted_at} />
                        </span>
                      </div>
                    )}
                    {threads.map((t) => (
                      <div key={t.root.id} className="review-thread">
                        <ThreadView
                          thread={t}
                          api={reviewApi}
                          header={
                            <span className="mono small">
                              {t.root.path}
                              {t.root.line ? `:${t.root.line}` : ' (outdated)'}
                            </span>
                          }
                        />
                      </div>
                    ))}
                  </div>
                );
              }
              if (ev.event === 'committed') {
                return (
                  <div key={key} className="event">
                    <GitCommitIcon />
                    <Link to={`/${repo.full_name}/commit/${ev.sha}`} className="event-commit">
                      {ev.message.split('\n')[0]}
                    </Link>
                    <code className="muted">{ev.sha.slice(0, 7)}</code>
                  </div>
                );
              }
              const d = describeEvent(ev, isPr);
              if (!d) return null;
              return (
                <div key={key} className="event">
                  {d.icon}
                  <span>
                    <strong>{ev.actor?.login ?? 'someone'}</strong> {d.text} · <Time iso={ev.created_at} />
                  </span>
                </div>
              );
            })}
            <LoadMore q={timeline} />

            {isPr && pr.data && open && perms.push && <MergeQueue repo={repo} pr={pr.data} refresh={refresh} />}
            {isPr && pr.data && open && perms.push && <MergeBox repo={repo} pr={pr.data} extras={extras} refresh={refresh} />}
            {isPr && pr.data && !open && perms.push && <BranchCleanup repo={repo} pr={pr.data} refresh={refresh} />}

            {it.locked && !perms.push ? (
              <p className="muted pad">This conversation is locked.</p>
            ) : (
              <div className="comment">
                <Avatar user={viewer} size={32} />
                <div className="composer">
                  <MarkdownEditor value={comment} onChange={setComment} context={repo.full_name} onSubmit={() => comment.trim() && !busy && void submitComment()} />
                  <div className="form-foot">
                    <span className="muted small">Ctrl+Enter to send{comment ? ' · draft saved' : ''}</span>
                    <span className="spacer" />
                    {canClose && open && !isPr && (
                      <Dropdown align="up" className="btn" trigger="Close as…" disabled={busy}>
                        {(close) => (
                          <div className="menu" onClick={close}>
                            <button onClick={() => submitComment('completed')}>Completed</button>
                            <button onClick={() => submitComment('not_planned')}>Not planned</button>
                            <button onClick={closeDuplicate}>Duplicate of…</button>
                          </div>
                        )}
                      </Dropdown>
                    )}
                    {canClose && open && (
                      <button className="btn" disabled={busy} onClick={() => submitComment('completed')}>
                        <IssueClosedIcon /> {comment.trim() ? 'Close with comment' : isPr ? 'Close pull request' : 'Close issue'}
                      </button>
                    )}
                    {canClose && !open && !pr.data?.merged && (
                      <button className="btn" disabled={busy} onClick={() => submitComment('reopen')}>
                        <IssueReopenedIcon /> Reopen
                      </button>
                    )}
                    <button className="btn primary" disabled={!comment.trim() || busy} onClick={() => submitComment()}>
                      {busy ? 'Working…' : 'Comment'}
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>

          <aside className="issue-side">
            <SideSection
              title="Assignees"
              picker={
                canTriage
                  ? {
                      path: `${base}/assignees?per_page=100`,
                      toOption: userOption,
                      selected: selected(it.assignees, 'login'),
                      onToggle: (login, on) => run(() => gh(`${api}/assignees`, { method: on ? 'POST' : 'DELETE', body: { assignees: [login] } })),
                    }
                  : undefined
              }
            >
              {it.assignees?.length ? (
                it.assignees.map((a) => (
                  <div key={a.id}>
                    <UserLink user={a} avatar={18} />
                  </div>
                ))
              ) : canTriage ? (
                <button className="link-btn" disabled={busy} onClick={() => run(() => gh(`${api}/assignees`, { method: 'POST', body: { assignees: [viewer.login] } }))}>
                  No one. Assign yourself
                </button>
              ) : (
                <span className="muted">No one assigned</span>
              )}
            </SideSection>

            {isPr && <Reviewers repo={repo} pr={pr.data} canEdit={canTriage && open} run={run} />}

            <SideSection
              title="Labels"
              picker={
                canTriage
                  ? {
                      path: `${base}/labels?per_page=100`,
                      toOption: (l: LabelT) => ({ key: l.name, label: l.name, color: l.color, note: l.description ?? undefined }),
                      selected: selected(it.labels, 'name'),
                      onCreate: perms.push
                        ? (name) =>
                            run(async () => {
                              const color = Math.floor(Math.random() * 0xffffff).toString(16).padStart(6, '0');
                              await gh(`${base}/labels`, { method: 'POST', body: { name, color } });
                              await gh(`${api}/labels`, { method: 'POST', body: { labels: [name] } });
                              await invalidate(`${base}/labels`);
                            })
                        : undefined,
                      onToggle: (name, on) =>
                        run(() => (on ? gh(`${api}/labels`, { method: 'POST', body: { labels: [name] } }) : gh(`${api}/labels/${encodeURIComponent(name)}`, { method: 'DELETE' }))),
                    }
                  : undefined
              }
            >
              {it.labels?.length ? (
                <div className="label-wrap">
                  {it.labels.map((l) => (
                    <Label key={l.id ?? l.name} label={l} />
                  ))}
                </div>
              ) : (
                <span className="muted">None yet</span>
              )}
            </SideSection>

            <SideSection
              title="Milestone"
              picker={
                canTriage
                  ? {
                      path: `${base}/milestones?state=open&per_page=100`,
                      toOption: (m: Milestone) => ({ key: String(m.number), label: m.title }),
                      selected: new Set(it.milestone ? [String(it.milestone.number)] : []),
                      onToggle: (num, on) => run(() => gh(api, { method: 'PATCH', body: { milestone: on ? Number(num) : null } })),
                      single: true,
                    }
                  : undefined
              }
            >
              {it.milestone ? <Link to={`/${repo.full_name}/milestone/${it.milestone.number}`}>{it.milestone.title}</Link> : <span className="muted">No milestone</span>}
            </SideSection>

            {!isPr && <IssueType repo={repo} issue={it} canEdit={canTriage} run={run} />}

            <Projects repo={repo} nodeId={it.node_id} canEdit={canTriage} />

            {!isPr && <Development repo={repo} issue={it} canEdit={!!perms.push} />}

            {!isPr && <Relationships repo={repo} issue={it} canEdit={canTriage} />}

            {!!extras?.closingIssuesReferences?.nodes.length && (
              <SideSection title="Closes">
                {extras.closingIssuesReferences.nodes.map((n) => (
                  <Link key={n.number} to={`/${n.repository.nameWithOwner}/issues/${n.number}`}>
                    {n.title} <span className="muted">#{n.number}</span>
                  </Link>
                ))}
              </SideSection>
            )}

            <SideSection title="Notifications">
              <button
                className="btn block"
                disabled={busy || !extras}
                onClick={() =>
                  run(() => gql('mutation($id: ID!, $s: SubscriptionState!) { updateSubscription(input: { subscribableId: $id, state: $s }) { clientMutationId } }', { id: extras!.id, s: subscribed ? 'UNSUBSCRIBED' : 'SUBSCRIBED' }))
                }
              >
                {subscribed ? <BellSlashIcon /> : <BellIcon />} {subscribed ? 'Unsubscribe' : 'Subscribe'}
              </button>
            </SideSection>

            <div className="side-actions">
              {isPr && pr.data && open && !pr.data.draft && (isAuthor || perms.push) && (
                <button className="link-btn" disabled={busy} onClick={() => mutate('convertPullRequestToDraft', 'pullRequestId: $id', { id: pr.data!.node_id }, 'Converted to draft')}>
                  Convert to draft
                </button>
              )}
              {isPr && pr.data && open && (isAuthor || perms.push) && (
                <button className="link-btn" disabled={busy} onClick={changeBase}>
                  Change base branch
                </button>
              )}
              {isPr && pr.data?.merged && perms.push && (
                <button className="link-btn" disabled={busy} onClick={revert}>
                  Revert
                </button>
              )}
              {perms.push && (
                <button className="link-btn" disabled={busy} onClick={lock}>
                  {it.locked ? 'Unlock conversation' : 'Lock conversation'}
                </button>
              )}
              {!isPr && perms.push && (
                <button className="link-btn" disabled={busy} onClick={transfer}>
                  Transfer issue
                </button>
              )}
              {!isPr && perms.push && extras && (
                <button className="link-btn" disabled={busy} onClick={() => mutate(extras.isPinned ? 'unpinIssue' : 'pinIssue', 'issueId: $id', { id: extras.id }, extras.isPinned ? 'Unpinned' : 'Pinned')}>
                  {extras.isPinned ? 'Unpin issue' : 'Pin issue'}
                </button>
              )}
              {!isPr && extras?.viewerCanDelete && (
                <button
                  className="link-btn"
                  disabled={busy}
                  onClick={async () => {
                    if (!(await confirmDialog({ title: `Delete issue #${it.number}?`, body: 'This cannot be undone.', confirmLabel: 'Delete issue', danger: true }))) return;
                    await act(() => gql('mutation($id: ID!) { deleteIssue(input: { issueId: $id }) { clientMutationId } }', { id: extras.id }), 'Issue deleted');
                    navigate(`/${repo.full_name}/issues`, { replace: true });
                  }}
                >
                  Delete issue
                </button>
              )}
              <a className="link-btn" href={it.html_url} data-external>
                Open on GitHub
              </a>
            </div>
          </aside>
        </div>
      )}
    </div>
  );
}

interface Template {
  name: string;
  about?: string;
  title?: string;
  labels: string[];
  body: string;
}

// reads the front matter of a markdown issue template
export function parseTemplate(text: string, fallbackName: string): Template {
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(text);
  if (!m) return { name: fallbackName, labels: [], body: text };
  const meta: Record<string, string> = {};
  for (const line of m[1].split(/\r?\n/)) {
    const kv = /^(\w+):\s*(.*)$/.exec(line);
    if (kv) meta[kv[1]] = kv[2].trim().replace(/^['"]|['"]$/g, '');
  }
  const labels = (meta.labels ?? '').replace(/^\[|\]$/g, '').split(',').map((l) => l.trim().replace(/^['"]|['"]$/g, '')).filter(Boolean);
  return { name: meta.name || fallbackName, about: meta.about, title: meta.title, labels, body: m[2].trimStart() };
}

function useTemplates(repo: Repo) {
  const dir = useGh<any[]>(`/repos/${repo.full_name}/contents/.github/ISSUE_TEMPLATE`, { staleTime: 10 * 60_000 });
  const all = Array.isArray(dir.data) ? dir.data : [];
  const files = all.filter((f) => /\.(md|ya?ml)$/i.test(f.name) && !/^config\.ya?ml$/i.test(f.name));
  const configFile = all.find((f) => /^config\.ya?ml$/i.test(f.name));
  const config = useGh<string>(configFile && `/repos/${repo.full_name}/contents/${configFile.path}`, { accept: ACCEPT.raw, text: true, staleTime: 10 * 60_000 });
  let links: { name: string; url: string; about?: string }[] = [];
  try {
    links = config.data ? (parseYaml(config.data)?.contact_links ?? []) : [];
  } catch {
    links = [];
  }
  return { files, links, done: !dir.isLoading };
}

export interface FormField {
  type: 'markdown' | 'textarea' | 'input' | 'dropdown' | 'checkboxes';
  id?: string;
  attributes: { label?: string; description?: string; placeholder?: string; value?: string; options?: (string | { label: string; required?: boolean })[]; multiple?: boolean; render?: string };
  validations?: { required?: boolean };
}

export interface IssueForm {
  name: string;
  title?: string;
  labels: string[];
  assignees: string[];
  body: FormField[];
}

const asList = (v: unknown): string[] => (Array.isArray(v) ? v.map(String) : typeof v === 'string' ? v.split(',').map((x) => x.trim()).filter(Boolean) : []);

// a github issue form, from its yaml
export function parseForm(text: string, fallbackName: string): IssueForm {
  const y = parseYaml(text) ?? {};
  return { name: y.name ?? fallbackName, title: y.title, labels: asList(y.labels), assignees: asList(y.assignees), body: Array.isArray(y.body) ? y.body.filter((b: any) => b?.type) : [] };
}

// answers in the same markdown github writes for a form
export function formBody(form: IssueForm, answers: Record<number, any>): string {
  return form.body
    .map((f, i) => {
      if (f.type === 'markdown') return null;
      const a = answers[i];
      let text: string;
      if (f.type === 'checkboxes') text = (f.attributes.options ?? []).map((o, j) => `- [${a?.[j] ? 'X' : ' '}] ${typeof o === 'string' ? o : o.label}`).join('\n');
      else if (f.type === 'dropdown') text = (Array.isArray(a) ? a.join(', ') : a) || '_No response_';
      else text = (a ?? '').trim() ? (f.attributes.render ? `\`\`\`${f.attributes.render}\n${a}\n\`\`\`` : a) : '_No response_';
      return `### ${f.attributes.label ?? ''}\n\n${text}`;
    })
    .filter(Boolean)
    .join('\n\n');
}

function FormFields({ form, answers, setAnswers }: { form: IssueForm; answers: Record<number, any>; setAnswers: (a: Record<number, any>) => void }) {
  const set = (i: number, v: any) => setAnswers({ ...answers, [i]: v });
  return (
    <div className="stack">
      {form.body.map((f, i) => {
        const a = f.attributes ?? {};
        const req = f.validations?.required;
        const label = (
          <>
            {a.label}
            {req && <span className="del-text"> *</span>}
          </>
        );
        if (f.type === 'markdown') return <MarkdownText key={i} text={a.value ?? ''} />;
        if (f.type === 'checkboxes')
          return (
            <fieldset key={i} className="form-group">
              <legend>{label}</legend>
              {a.description && <span className="muted small">{a.description}</span>}
              {(a.options ?? []).map((o, j) => (
                <label key={j} className="check-row">
                  <input type="checkbox" checked={!!answers[i]?.[j]} onChange={(e) => set(i, { ...(answers[i] ?? {}), [j]: e.target.checked })} /> {typeof o === 'string' ? o : o.label}
                </label>
              ))}
            </fieldset>
          );
        return (
          <label key={i} className="field">
            <span>{label}</span>
            {a.description && <span className="muted small">{a.description}</span>}
            {f.type === 'dropdown' ? (
              <select className="input" multiple={a.multiple} value={answers[i] ?? (a.multiple ? [] : '')} onChange={(e) => set(i, a.multiple ? [...e.target.selectedOptions].map((o) => o.value) : e.target.value)}>
                {!a.multiple && <option value="">Choose…</option>}
                {(a.options ?? []).map((o, j) => (
                  <option key={j}>{String(o)}</option>
                ))}
              </select>
            ) : f.type === 'textarea' ? (
              <textarea className={`input ${a.render ? 'mono' : ''}`} rows={a.render ? 6 : 5} placeholder={a.placeholder} value={answers[i] ?? a.value ?? ''} onChange={(e) => set(i, e.target.value)} />
            ) : (
              <input className="input" placeholder={a.placeholder} value={answers[i] ?? a.value ?? ''} onChange={(e) => set(i, e.target.value)} />
            )}
          </label>
        );
      })}
    </div>
  );
}

// renders a markdown snippet through github
function MarkdownText({ text }: { text: string }) {
  const q = useQuery({ queryKey: ['md', text], queryFn: () => gh<string>('/markdown', { method: 'POST', body: { text, mode: 'gfm' }, text: true }), staleTime: Infinity });
  return q.data ? <Markdown html={q.data} /> : null;
}

// required fields that are still empty
function missing(form: IssueForm, answers: Record<number, any>) {
  return form.body.filter((f, i) => {
    if (!f.validations?.required || f.type === 'markdown') return false;
    const a = answers[i] ?? f.attributes.value;
    if (f.type === 'checkboxes') return (f.attributes.options ?? []).some((o, j) => typeof o !== 'string' && o.required && !answers[i]?.[j]);
    return Array.isArray(a) ? !a.length : !String(a ?? '').trim();
  });
}

export function NewIssue() {
  const { repo } = useRepo();
  const navigate = useNavigate();
  const [sp] = useSearchParams();
  const [title, setTitle, clearTitle] = useDraft(`new-issue-title:${repo.full_name}`);
  const [body, setBody, clearBody] = useDraft(`new-issue-body:${repo.full_name}`);
  const [labels, setLabels] = useState<string[]>(() => (sp.get('labels') ?? '').split(',').filter(Boolean));
  const [assignees, setAssignees] = useState<string[]>([]);
  const [milestone, setMilestone] = useState<{ number: number; title: string } | null>(null);
  const { busy, run } = useAction();
  const templates = useTemplates(repo);
  const canTriage = !!(repo.permissions?.triage || repo.permissions?.push);
  const base = `/repos/${repo.full_name}`;

  const [form, setForm] = useState<IssueForm | null>(null);
  const [answers, setAnswers] = useState<Record<number, any>>({});
  const pick = (f: any) =>
    run(async () => {
      const raw = await gh<string>(`${base}/contents/${f.path}`, { accept: ACCEPT.raw, text: true });
      const name = f.name.replace(/\.(md|ya?ml)$/i, '');
      if (/\.ya?ml$/i.test(f.name)) {
        const fm = parseForm(raw, name);
        setForm(fm);
        setAnswers({});
        if (fm.title && !title) setTitle(fm.title);
        if (fm.labels.length) setLabels(fm.labels);
        if (fm.assignees.length) setAssignees(fm.assignees);
        return;
      }
      setForm(null);
      const t = parseTemplate(raw, name);
      setBody(t.body);
      if (t.title && !title) setTitle(t.title);
      if (t.labels.length) setLabels(t.labels);
    });
  const lacking = form ? missing(form, answers) : [];
  const submit = () => {
    if (!title.trim() || busy || lacking.length) return;
    void run(async () => {
      const text = form ? formBody(form, answers) : body;
      const created = await gh<Issue>(`${base}/issues`, {
        method: 'POST',
        // form labels apply even without triage rights, like on github
        body: { title, body: text, ...(canTriage ? { labels, assignees, milestone: milestone?.number } : form ? { labels } : {}) },
      });
      clearTitle();
      clearBody();
      navigate(`/${repo.full_name}/issues/${created.number}`, { replace: true });
    });
  };
  const toggle = (list: string[], set: (v: string[]) => void) => (key: string, on: boolean) => set(on ? [...list, key] : list.filter((k) => k !== key));

  return (
    <div className="issue-layout">
      <div className="stack">
        <h2 className="title">New issue</h2>
        {templates.files.length > 0 && (
          <div className="toolbar">
            <span className="muted small">Start from a template:</span>
            {templates.files.map((f) => (
              <button key={f.path} className="btn sm" disabled={busy} onClick={() => pick(f)}>
                {f.name.replace(/\.(md|ya?ml)$/i, '').replace(/[-_]/g, ' ')}
              </button>
            ))}
            {templates.links.map((l) => (
              <a key={l.url} className="btn sm" href={l.url} data-external title={l.about}>
                {l.name}
              </a>
            ))}
          </div>
        )}
        <input className="input" autoFocus placeholder="Title" value={title} onChange={(e) => setTitle(e.target.value)} aria-label="Title" />
        {form ? (
          <>
            <div className="toolbar">
              <strong>{form.name}</strong>
              <span className="spacer" />
              <button className="btn sm" onClick={() => setForm(null)}>
                Write freely instead
              </button>
            </div>
            <FormFields form={form} answers={answers} setAnswers={setAnswers} />
          </>
        ) : (
          <MarkdownEditor value={body} onChange={setBody} context={repo.full_name} onSubmit={submit} placeholder="Describe the issue. Markdown is supported." rows={14} />
        )}
        <div className="form-foot">
          <span className="muted small">{title || body ? 'Draft saved' : ''}</span>
          <span className="spacer" />
          <button className="btn" onClick={() => navigate(-1)}>
            Cancel
          </button>
          {lacking.length > 0 && <span className="muted small">Fill in {lacking.map((f) => f.attributes.label).join(', ')}</span>}
          <button className="btn primary" disabled={!title.trim() || busy || lacking.length > 0} onClick={submit}>
            {busy ? 'Creating…' : 'Create issue'}
          </button>
        </div>
      </div>
      {canTriage && (
        <aside className="issue-side">
          <SideSection
            title="Assignees"
            picker={{ path: `${base}/assignees?per_page=100`, toOption: (u: User) => ({ key: u.login, label: u.login, avatar: u }), selected: new Set(assignees), onToggle: toggle(assignees, setAssignees) }}
          >
            {assignees.length ? assignees.map((a) => <div key={a}>{a}</div>) : <span className="muted">No one</span>}
          </SideSection>
          <SideSection
            title="Labels"
            picker={{ path: `${base}/labels?per_page=100`, toOption: (l: LabelT) => ({ key: l.name, label: l.name }), selected: new Set(labels), onToggle: toggle(labels, setLabels) }}
          >
            {labels.length ? (
              <div className="label-wrap">
                {labels.map((l) => (
                  <Label key={l} label={{ name: l }} />
                ))}
              </div>
            ) : (
              <span className="muted">None yet</span>
            )}
          </SideSection>
          <SideSection
            title="Milestone"
            picker={{
              path: `${base}/milestones?state=open&per_page=100`,
              toOption: (m: Milestone) => ({ key: `${m.number}:${m.title}`, label: m.title }),
              selected: new Set(milestone ? [`${milestone.number}:${milestone.title}`] : []),
              onToggle: (key, on) => setMilestone(on ? { number: Number(key.split(':')[0]), title: key.slice(key.indexOf(':') + 1) } : null),
              single: true,
            }}
          >
            {milestone ? milestone.title : <span className="muted">No milestone</span>}
          </SideSection>
        </aside>
      )}
    </div>
  );
}
