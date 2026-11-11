import {
  CheckCircleFillIcon,
  CheckIcon,
  CommentIcon,
  CrossReferenceIcon,
  DotFillIcon,
  EyeIcon,
  GearIcon,
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
  SearchIcon,
  SmileyIcon,
  TagIcon,
  XCircleFillIcon,
} from '@primer/octicons-react';
import { type ReactNode, useEffect, useState } from 'react';
import { Link, Navigate, useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { DiffFile } from '../components/Diff';
import {
  Avatar,
  Dropdown,
  Empty,
  ErrorBox,
  Label,
  Loading,
  LoadMore,
  Markdown,
  Segmented,
  StateIcon,
  StatePill,
  Time,
  UserLink,
} from '../components/ui';
import { ACCEPT, gh, gql, invalidate, useGh, useGhPages } from '../lib/api';
import { useAuth } from '../lib/auth';
import { issueSearch, itemRoute } from './Home';
import { useRepo } from './Repo';

/* ── Lists ───────────────────────────────────────────────── */

export function IssueRow({ item, showRepo }: { item: any; showRepo?: boolean }) {
  const full = item.repository_url.split('/repos/')[1];
  return (
    <div className="row">
      <StateIcon item={item} />
      <div className="row-main">
        <div className="row-title">
          <Link to={itemRoute(item)}>{item.title}</Link>
          {item.labels?.map((l: any) => <Label key={l.id ?? l.name} label={l} />)}
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
        {item.assignees?.slice(0, 3).map((a: any) => <Avatar key={a.id} user={a} size={18} />)}
        {item.comments > 0 && (
          <span className="meta-item">
            <CommentIcon size={14} /> {item.comments}
          </span>
        )}
      </div>
    </div>
  );
}

/** Search box whose committed value lives in the URL (`?q=`), so back/forward restore it. */
function QueryBox({ placeholder }: { placeholder: string }) {
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
      <input value={text} placeholder={placeholder} onChange={(e) => setText(e.target.value)} />
    </form>
  );
}

function ResultList({ query, showRepo, emptyTitle, action }: { query: string; showRepo?: boolean; emptyTitle: string; action?: ReactNode }) {
  const [sp, setSp] = useSearchParams();
  const state = sp.get('state') === 'closed' ? 'closed' : 'open';
  const other = state === 'open' ? 'closed' : 'open';
  const text = sp.get('q') ?? '';
  const list = useGhPages<any>(issueSearch(`${query} state:${state} ${text}`.trim(), '&sort=updated'), { pick: (d) => d.items });
  const otherCount = useGh<any>(issueSearch(`${query} state:${other} ${text}`.trim()).replace('per_page=30', 'per_page=1'));
  const counts = { [state]: list.total, [other]: otherCount.data?.total_count } as Record<string, number | undefined>;
  const label = (s: string, name: string) => (counts[s] != null ? `${name} ${counts[s]!.toLocaleString()}` : name);

  return (
    <div className="stack">
      <div className="toolbar">
        <Segmented
          value={state}
          onChange={(s) => {
            const next = new URLSearchParams(sp);
            if (s === 'open') next.delete('state');
            else next.set('state', s);
            setSp(next);
          }}
          options={[
            { value: 'open', label: label('open', 'Open') },
            { value: 'closed', label: label('closed', 'Closed') },
          ]}
        />
        <QueryBox placeholder="Filter, e.g. label:bug author:octocat" />
        {action}
      </div>
      <div className="card">
        {list.isLoading && <Loading />}
        {list.error && <ErrorBox error={list.error} retry={list.refetch} />}
        {!list.isLoading && !list.error && list.items.length === 0 && <Empty title={emptyTitle} />}
        {list.items.map((it) => (
          <IssueRow key={it.id} item={it} showRepo={showRepo} />
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
      query={`repo:${repo.full_name} is:${kind}`}
      emptyTitle={kind === 'pr' ? 'No pull requests match' : 'No issues match'}
      action={
        kind === 'issue' ? (
          <Link className="btn primary" to={`/${repo.full_name}/issues/new`}>
            New issue
          </Link>
        ) : (
          <a className="btn" data-external href={`${repo.html_url}/compare`} title="Opens github.com">
            New pull request
          </a>
        )
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
    ...(kind === 'pr' ? { 'review-requested': 'Needs my review' } : {}),
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

/* ── Markdown editor ─────────────────────────────────────── */

export function MarkdownEditor({
  value,
  onChange,
  context,
  onSubmit,
  placeholder = 'Leave a comment. Markdown is supported.',
  rows = 5,
}: {
  value: string;
  onChange: (v: string) => void;
  context: string;
  onSubmit?: () => void;
  placeholder?: string;
  rows?: number;
}) {
  const [mode, setMode] = useState<'write' | 'preview'>('write');
  const [preview, setPreview] = useState<string | null>(null);
  useEffect(() => {
    if (mode !== 'preview') return;
    let stale = false;
    setPreview(null);
    gh<string>('/markdown', { method: 'POST', body: { text: value, mode: 'gfm', context }, text: true })
      .then((html) => !stale && setPreview(html))
      .catch((e) => !stale && setPreview(`<p>${(e as Error).message}</p>`));
    return () => {
      stale = true;
    };
  }, [mode, value, context]);

  return (
    <div className="editor">
      <div className="editor-bar">
        <Segmented
          value={mode}
          onChange={setMode}
          options={[
            { value: 'write', label: 'Write' },
            { value: 'preview', label: 'Preview' },
          ]}
        />
      </div>
      {mode === 'write' ? (
        <textarea
          className="input"
          rows={rows}
          placeholder={placeholder}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={(e) => (e.ctrlKey || e.metaKey) && e.key === 'Enter' && onSubmit?.()}
        />
      ) : (
        <div className="editor-preview">
          {preview === null ? <Loading /> : value.trim() ? <Markdown html={preview} /> : <span className="muted">Nothing to preview.</span>}
        </div>
      )}
    </div>
  );
}

/* ── Sidebar pickers ─────────────────────────────────────── */

interface Option {
  key: string;
  label: string;
  avatar?: any;
}

function PickerList({
  path,
  toOption,
  selected,
  onToggle,
  close,
  single,
}: {
  path: string;
  toOption: (x: any) => Option;
  selected: Set<string>;
  onToggle: (key: string, on: boolean) => Promise<void>;
  close: () => void;
  single?: boolean;
}) {
  const q = useGh<any[]>(path);
  const [filter, setFilter] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const options = (q.data ?? []).map(toOption).filter((o) => o.label.toLowerCase().includes(filter.toLowerCase()));
  return (
    <div className="menu wide">
      <input className="input" autoFocus placeholder="Filter…" value={filter} onChange={(e) => setFilter(e.target.value)} />
      <div className="menu-scroll">
        {q.isLoading && <Loading />}
        {q.error && <p className="muted pad">{q.error.message}</p>}
        {!q.isLoading && !q.error && options.length === 0 && <p className="muted pad">Nothing to choose from.</p>}
        {options.map((o) => (
          <button
            key={o.key}
            disabled={busy !== null}
            onClick={async () => {
              setBusy(o.key);
              try {
                await onToggle(o.key, !selected.has(o.key));
              } finally {
                setBusy(null);
              }
              if (single) close();
            }}
          >
            <span className="check">{busy === o.key ? <span className="spinner" /> : selected.has(o.key) ? <CheckIcon size={14} /> : null}</span>
            {o.avatar && <Avatar user={o.avatar} size={18} />}
            {o.label}
          </button>
        ))}
      </div>
    </div>
  );
}

function SideSection({
  title,
  children,
  picker,
}: {
  title: string;
  children: ReactNode;
  picker?: Omit<Parameters<typeof PickerList>[0], 'close'>;
}) {
  return (
    <div className="side-section">
      <div className="side-section-head">
        <h4>{title}</h4>
        {picker && (
          <Dropdown align="right" className="icon-btn sm" trigger={<GearIcon size={14} />}>
            {(close) => <PickerList {...picker} close={close} />}
          </Dropdown>
        )}
      </div>
      {children}
    </div>
  );
}

/* ── Timeline ────────────────────────────────────────────── */

const REACTIONS: [string, string][] = [
  ['+1', '👍'], ['-1', '👎'], ['laugh', '😄'], ['hooray', '🎉'], ['confused', '😕'], ['heart', '❤️'], ['rocket', '🚀'], ['eyes', '👀'],
];

function Comment({
  c,
  badge,
  context,
  onSave,
  onDelete,
  onReact,
  verb = 'commented',
}: {
  c: any;
  badge?: string;
  context: string;
  onSave?: (body: string) => Promise<void>;
  onDelete?: () => Promise<void>;
  onReact?: (content: string) => Promise<void>;
  verb?: string;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const reactions = REACTIONS.filter(([k]) => c.reactions?.[k] > 0);
  const save = async () => {
    setBusy(true);
    try {
      await onSave!(draft);
      setEditing(false);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="comment">
      <Avatar user={c.user} size={32} />
      <div className="card comment-box">
        <div className="card-head">
          <UserLink user={c.user} />
          <span>
            {verb} <Time iso={c.created_at ?? c.submitted_at} />
          </span>
          <span className="spacer" />
          {badge && <span className="badge">{badge}</span>}
          {onReact && (
            <Dropdown align="right" className="icon-btn sm" trigger={<SmileyIcon size={14} />}>
              {(close) => (
                <div className="menu emoji-menu" onClick={close}>
                  {REACTIONS.map(([k, emoji]) => (
                    <button key={k} title={k} onClick={() => void onReact(k)}>
                      {emoji}
                    </button>
                  ))}
                </div>
              )}
            </Dropdown>
          )}
          {(onSave || onDelete) && (
            <Dropdown align="right" className="icon-btn sm" trigger={<KebabHorizontalIcon size={14} />}>
              {(close) => (
                <div className="menu" onClick={close}>
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
                  {onDelete && <button onClick={() => window.confirm('Delete this comment?') && void onDelete()}>Delete</button>}
                </div>
              )}
            </Dropdown>
          )}
        </div>
        <div className="pad">
          {editing ? (
            <>
              <MarkdownEditor value={draft} onChange={setDraft} context={context} onSubmit={save} />
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
                <span key={k} className="reaction">
                  {emoji} {c.reactions[k]}
                </span>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/** One-line description for non-comment timeline events; null hides the event. */
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
    case 'milestoned':
    case 'demilestoned':
      return { icon: <MilestoneIcon />, text: <>{ev.event === 'milestoned' ? 'added this to' : 'removed this from'} the <strong>{ev.milestone?.title}</strong> milestone</> };
    case 'locked':
    case 'unlocked':
      return { icon: <LockIcon />, text: `${ev.event} this conversation` };
    case 'head_ref_force_pushed':
      return { icon: <GitBranchIcon />, text: 'force-pushed the branch' };
    case 'head_ref_deleted':
      return { icon: <GitBranchIcon />, text: 'deleted the branch' };
    case 'head_ref_restored':
      return { icon: <GitBranchIcon />, text: 'restored the branch' };
    case 'convert_to_draft':
      return { icon: <PencilIcon />, text: 'marked this as a draft' };
    case 'ready_for_review':
      return { icon: <EyeIcon />, text: 'marked this as ready for review' };
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

/* ── Pull request merge box ──────────────────────────────── */

function MergeBox({ repo, pr, run }: { repo: any; pr: any; run: (fn: () => Promise<unknown>) => Promise<void> }) {
  const checks = useGh<any>(`/repos/${repo.full_name}/commits/${pr.head.sha}/check-runs?per_page=100`, {
    refetchInterval: (q) => (q.state.data?.check_runs?.some((c: any) => c.status !== 'completed') ? 10_000 : false),
  });
  const methods = [
    repo.allow_squash_merge !== false && { value: 'squash', label: 'Squash' },
    repo.allow_merge_commit !== false && { value: 'merge', label: 'Merge commit' },
    repo.allow_rebase_merge !== false && { value: 'rebase', label: 'Rebase' },
  ].filter(Boolean) as { value: string; label: string }[];
  const [method, setMethod] = useState(methods[0]?.value ?? 'merge');
  const [confirm, setConfirm] = useState(false);
  const runs: any[] = checks.data?.check_runs ?? [];
  const failed = runs.filter((c) => ['failure', 'timed_out', 'cancelled', 'action_required'].includes(c.conclusion)).length;
  const pending = runs.filter((c) => c.status !== 'completed').length;
  const status =
    pr.mergeable == null
      ? 'Checking whether this can be merged…'
      : !pr.mergeable
        ? 'This branch has conflicts that must be resolved first.'
        : pr.mergeable_state === 'blocked'
          ? 'Merging is blocked by a required review or check.'
          : pr.mergeable_state === 'behind'
            ? 'This branch is behind the base branch.'
            : 'No conflicts with the base branch.';

  return (
    <div className="card merge-box">
      {runs.length > 0 && (
        <div className="merge-row">
          {failed ? <XCircleFillIcon /> : pending ? <DotFillIcon className="pulse" /> : <CheckCircleFillIcon />}
          <div>
            <strong>{failed ? `${failed} of ${runs.length} checks failed` : pending ? `${pending} of ${runs.length} checks still running` : `All ${runs.length} checks passed`}</strong>
            <div className="check-list">
              {runs.slice(0, 12).map((c) => (
                <a key={c.id} href={c.html_url ?? c.details_url} className="meta-item">
                  {c.status !== 'completed' ? <DotFillIcon size={12} /> : c.conclusion === 'success' ? <CheckIcon size={12} /> : <XCircleFillIcon size={12} />}
                  {c.name}
                </a>
              ))}
            </div>
          </div>
        </div>
      )}
      <div className="merge-row">
        {pr.mergeable ? <CheckCircleFillIcon /> : <XCircleFillIcon />}
        <strong>{status}</strong>
      </div>
      <div className="merge-row">
        {pr.draft ? (
          <>
            <span className="muted">This pull request is still a draft.</span>
            <span className="spacer" />
            <button
              className="btn primary"
              onClick={() =>
                run(() =>
                  gql('mutation($id: ID!) { markPullRequestReadyForReview(input: { pullRequestId: $id }) { clientMutationId } }', { id: pr.node_id }),
                )
              }
            >
              Ready for review
            </button>
          </>
        ) : (
          <>
            <Segmented value={method} onChange={(m) => (setMethod(m), setConfirm(false))} options={methods} />
            <span className="spacer" />
            {confirm && (
              <button className="btn" onClick={() => setConfirm(false)}>
                Cancel
              </button>
            )}
            <button
              className="btn primary"
              disabled={!pr.mergeable}
              onClick={() =>
                confirm
                  ? run(() => gh(`/repos/${repo.full_name}/pulls/${pr.number}/merge`, { method: 'PUT', body: { merge_method: method } }))
                  : setConfirm(true)
              }
            >
              <GitMergeIcon /> {confirm ? `Confirm ${methods.find((m) => m.value === method)?.label.toLowerCase()}` : 'Merge pull request'}
            </button>
          </>
        )}
      </div>
    </div>
  );
}

function ReviewMenu({ own, onSubmit }: { own: boolean; onSubmit: (event: string, body: string) => Promise<void> }) {
  const [body, setBody] = useState('');
  return (
    <Dropdown align="right" className="btn primary" trigger="Review changes">
      {(close) => {
        const send = (event: string) => () => {
          close();
          void onSubmit(event, body).then(() => setBody(''));
        };
        return (
          <div className="menu wide pad">
            <strong>Finish your review</strong>
            <textarea className="input" rows={4} placeholder="Leave a summary" value={body} onChange={(e) => setBody(e.target.value)} />
            <div className="form-foot">
              <button className="btn" disabled={!body.trim()} onClick={send('COMMENT')}>
                Comment
              </button>
              <span className="spacer" />
              {!own && (
                <>
                  <button className="btn" disabled={!body.trim()} onClick={send('REQUEST_CHANGES')}>
                    Request changes
                  </button>
                  <button className="btn primary" onClick={send('APPROVE')}>
                    Approve
                  </button>
                </>
              )}
            </div>
            {own && <span className="muted small">You can't approve your own pull request.</span>}
          </div>
        );
      }}
    </Dropdown>
  );
}

/* ── Issue / pull request page ───────────────────────────── */

export function IssueDetail({ files }: { files?: boolean }) {
  const { repo } = useRepo();
  const { viewer } = useAuth();
  const { number } = useParams();
  const onPullRoute = useLocation().pathname.includes('/pull/');
  const base = `/repos/${repo.full_name}`;
  const api = `${base}/issues/${number}`;
  const prApi = `${base}/pulls/${number}`;
  const issue = useGh<any>(api, { accept: ACCEPT.full });
  const isPr = !!issue.data?.pull_request;
  const pr = useGh<any>(isPr && prApi, {
    // GitHub computes mergeability lazily; poll until it has an answer.
    refetchInterval: (q) => (q.state.data && q.state.data.state === 'open' && q.state.data.mergeable == null ? 3000 : false),
  });
  const timeline = useGhPages<any>(`${api}/timeline?per_page=100`, { accept: ACCEPT.full });
  const diff = useGhPages<any>(isPr && files && `${prApi}/files?per_page=50`);

  const [comment, setComment] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [title, setTitle] = useState<string | null>(null);

  if (issue.isLoading) return <Loading />;
  if (issue.error) return <ErrorBox error={issue.error} retry={issue.refetch} />;
  const it = issue.data;
  const route = `/${repo.full_name}/${isPr ? 'pull' : 'issues'}/${number}`;
  if (isPr !== onPullRoute) return <Navigate replace to={route} />;

  const perms = repo.permissions ?? {};
  const canTriage = !!(perms.triage || perms.push);
  const isAuthor = it.user?.login === viewer.login;
  const canClose = canTriage || isAuthor;
  const stateSource = pr.data ?? it;
  const open = it.state === 'open';

  /** Runs a write, surfaces its error, then refreshes everything about this issue. */
  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setError('');
    try {
      await fn();
      await Promise.all([invalidate(api), isPr ? invalidate(prApi) : null]);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const patch = (body: unknown) => run(() => gh(isPr && 'state' in (body as object) ? prApi : api, { method: 'PATCH', body }));
  const selected = (list: any[] | undefined, key: string) => new Set<string>((list ?? []).map((x) => String(x[key])));
  const userOption = (u: any) => ({ key: u.login, label: u.login, avatar: u });

  const submitComment = (thenClose?: 'completed' | 'not_planned' | 'reopen') =>
    run(async () => {
      if (comment.trim()) await gh(`${api}/comments`, { method: 'POST', body: { body: comment } });
      setComment('');
      if (thenClose === 'reopen') await gh(isPr ? prApi : api, { method: 'PATCH', body: { state: 'open' } });
      else if (thenClose) await gh(isPr ? prApi : api, { method: 'PATCH', body: isPr ? { state: 'closed' } : { state: 'closed', state_reason: thenClose } });
    });

  return (
    <div className="issue-page">
      <header className="issue-head">
        {title === null ? (
          <h1>
            {it.title} <span className="muted">#{it.number}</span>
            {canClose && (
              <button className="icon-btn" title="Edit title" onClick={() => setTitle(it.title)}>
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
            <input className="input" autoFocus value={title} onChange={(e) => setTitle(e.target.value)} />
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
                wants to merge {pr.data.commits} commit{pr.data.commits === 1 ? '' : 's'} into <code className="ref">{pr.data.base.ref}</code> from{' '}
                <code className="ref">{pr.data.head.label}</code>
              </>
            ) : (
              <>
                opened this <Time iso={it.created_at} /> · {it.comments} comment{it.comments === 1 ? '' : 's'}
              </>
            )}
          </span>
        </div>
      </header>

      {error && (
        <div className="banner" onClick={() => setError('')}>
          {error}
        </div>
      )}

      {isPr && (
        <div className="toolbar">
          <div className="segmented">
            <Link to={route} className={files ? '' : 'on'}>
              Conversation
            </Link>
            <Link to={`${route}/files`} className={files ? 'on' : ''}>
              Files changed{pr.data ? ` ${pr.data.changed_files}` : ''}
            </Link>
          </div>
          {pr.data && (
            <span className="diffstat">
              <span className="add-text">+{pr.data.additions.toLocaleString()}</span> <span className="del-text">−{pr.data.deletions.toLocaleString()}</span>
            </span>
          )}
          <span className="spacer" />
          {files && open && (
            <ReviewMenu own={isAuthor} onSubmit={(event, body) => run(() => gh(`${prApi}/reviews`, { method: 'POST', body: { event, body } }))} />
          )}
        </div>
      )}

      {files ? (
        <div className="stack">
          {diff.isLoading && <Loading />}
          {diff.error && <ErrorBox error={diff.error} retry={diff.refetch} />}
          {diff.items.map((f) => (
            <DiffFile key={f.filename} file={f} />
          ))}
          <LoadMore q={diff} />
        </div>
      ) : (
        <div className="issue-layout">
          <div className="timeline">
            <Comment
              c={it}
              badge="Author"
              context={repo.full_name}
              verb="opened this"
              onSave={canTriage || isAuthor ? (body) => patch({ body }) : undefined}
              onReact={(content) => run(() => gh(`${api}/reactions`, { method: 'POST', body: { content } }))}
            />
            {timeline.isLoading && <Loading />}
            {timeline.error && <ErrorBox error={timeline.error} retry={timeline.refetch} />}
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
                    badge={ev.user?.login === it.user?.login ? 'Author' : undefined}
                    onSave={mine || perms.push ? (body) => run(() => gh(commentApi, { method: 'PATCH', body: { body } })) : undefined}
                    onDelete={mine || perms.push ? () => run(() => gh(commentApi, { method: 'DELETE' })) : undefined}
                    onReact={(content) => run(() => gh(`${commentApi}/reactions`, { method: 'POST', body: { content } }))}
                  />
                );
              }
              if (ev.event === 'reviewed') {
                if (ev.body_html || ev.body) return <Comment key={key} c={ev} context={repo.full_name} verb={REVIEW_VERB[ev.state] ?? 'reviewed'} />;
                if (ev.state === 'commented') return null;
                return (
                  <div key={key} className="event">
                    <EyeIcon />
                    <span>
                      <strong>{ev.user?.login}</strong> {REVIEW_VERB[ev.state] ?? 'reviewed'} · <Time iso={ev.submitted_at} />
                    </span>
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

            {isPr && pr.data && open && perms.push && <MergeBox repo={repo} pr={pr.data} run={run} />}

            {it.locked && !perms.push ? (
              <p className="muted pad">This conversation is locked.</p>
            ) : (
              <div className="comment">
                <Avatar user={viewer} size={32} />
                <div className="composer">
                  <MarkdownEditor value={comment} onChange={setComment} context={repo.full_name} onSubmit={() => comment.trim() && !busy && void submitComment()} />
                  <div className="form-foot">
                    <span className="muted small">Ctrl+Enter to send</span>
                    <span className="spacer" />
                    {canClose && open && !isPr && (
                      <button className="btn" disabled={busy} onClick={() => submitComment('not_planned')}>
                        Close as not planned
                      </button>
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
                it.assignees.map((a: any) => (
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

            {isPr && (
              <SideSection
                title="Reviewers"
                picker={
                  canTriage && open
                    ? {
                        path: `${base}/assignees?per_page=100`,
                        toOption: userOption,
                        selected: selected(pr.data?.requested_reviewers, 'login'),
                        onToggle: (login, on) =>
                          run(() => gh(`${prApi}/requested_reviewers`, { method: on ? 'POST' : 'DELETE', body: { reviewers: [login] } })),
                      }
                    : undefined
                }
              >
                {pr.data?.requested_reviewers?.length ? (
                  pr.data.requested_reviewers.map((a: any) => (
                    <div key={a.id}>
                      <UserLink user={a} avatar={18} />
                    </div>
                  ))
                ) : (
                  <span className="muted">No reviews requested</span>
                )}
              </SideSection>
            )}

            <SideSection
              title="Labels"
              picker={
                canTriage
                  ? {
                      path: `${base}/labels?per_page=100`,
                      toOption: (l) => ({ key: l.name, label: l.name }),
                      selected: selected(it.labels, 'name'),
                      onToggle: (name, on) =>
                        run(() =>
                          on
                            ? gh(`${api}/labels`, { method: 'POST', body: { labels: [name] } })
                            : gh(`${api}/labels/${encodeURIComponent(name)}`, { method: 'DELETE' }),
                        ),
                    }
                  : undefined
              }
            >
              {it.labels?.length ? (
                <div className="label-wrap">
                  {it.labels.map((l: any) => (
                    <Label key={l.id} label={l} />
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
                      toOption: (m) => ({ key: String(m.number), label: m.title }),
                      selected: new Set(it.milestone ? [String(it.milestone.number)] : []),
                      onToggle: (num, on) => run(() => gh(api, { method: 'PATCH', body: { milestone: on ? Number(num) : null } })),
                      single: true,
                    }
                  : undefined
              }
            >
              {it.milestone ? it.milestone.title : <span className="muted">No milestone</span>}
            </SideSection>

            <a className="btn block" href={it.html_url} data-external>
              Open on GitHub
            </a>
          </aside>
        </div>
      )}
    </div>
  );
}

export function NewIssue() {
  const { repo } = useRepo();
  const navigate = useNavigate();
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const submit = async () => {
    if (!title.trim() || busy) return;
    setBusy(true);
    setError('');
    try {
      const created = await gh<any>(`/repos/${repo.full_name}/issues`, { method: 'POST', body: { title, body } });
      navigate(`/${repo.full_name}/issues/${created.number}`, { replace: true });
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  };
  return (
    <div className="stack narrow-form">
      <h2 className="title">New issue</h2>
      {error && <div className="banner">{error}</div>}
      <input className="input" autoFocus placeholder="Title" value={title} onChange={(e) => setTitle(e.target.value)} />
      <MarkdownEditor value={body} onChange={setBody} context={repo.full_name} onSubmit={submit} placeholder="Describe the issue. Markdown is supported." rows={12} />
      <div className="form-foot">
        <span className="muted small">Labels and assignees can be set once it's created.</span>
        <span className="spacer" />
        <button className="btn" onClick={() => navigate(-1)}>
          Cancel
        </button>
        <button className="btn primary" disabled={!title.trim() || busy} onClick={submit}>
          {busy ? 'Creating…' : 'Create issue'}
        </button>
      </div>
    </div>
  );
}
