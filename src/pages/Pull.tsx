import { CheckCircleFillIcon, CheckIcon, DotFillIcon, GitCommitIcon, GitMergeIcon, SkipIcon, XCircleFillIcon } from '@primer/octicons-react';
import { useQuery } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { buildThreads, DiffFile, type PendingComment, type ReviewApi, type Thread } from '../components/Diff';
import { Avatar, Dropdown, ListState, LoadMore, Segmented, Time } from '../components/ui';
import { ACCEPT, gh, gql, invalidate, invalidateGql, useGh, useGhPages, useGql } from '../lib/api';
import { confirmDialog, toast, useAction } from '../lib/feedback';
import { usePref } from '../lib/store';
import type { CommitEntry, DiffFileEntry, PullRequest, Repo, ReviewComment } from '../lib/types';
import { duration, plural } from '../lib/util';

export interface PullExtras {
  id: string;
  viewerSubscription?: string;
  viewerCanUpdateBranch?: boolean;
  viewerCanEnableAutoMerge?: boolean;
  viewerCanDisableAutoMerge?: boolean;
  reviewDecision?: string | null;
  reviewThreads?: { nodes: { id: string; isResolved: boolean; comments: { nodes: { databaseId: number }[] } }[] };
  closingIssuesReferences?: { nodes: { number: number; title: string; state: string; repository: { nameWithOwner: string } }[] };
}

// line comments as threads, with resolved state
export function useReviewThreads(repo: Repo, number: string | number, extras?: PullExtras, enabled = true) {
  const path = `/repos/${repo.full_name}/pulls/${number}/comments`;
  const q = useQuery<ReviewComment[]>({
    queryKey: ['gha', `${path}?per_page=100`, 'full'],
    queryFn: async () => (await ghAllFull<ReviewComment>(`${path}?per_page=100`)).items,
    enabled,
  });
  const threads = useMemo<Thread[]>(() => {
    const state = new Map<number, { id: string; resolved: boolean }>();
    for (const t of extras?.reviewThreads?.nodes ?? []) {
      const root = t.comments.nodes[0]?.databaseId;
      if (root) state.set(root, { id: t.id, resolved: t.isResolved });
    }
    return buildThreads(q.data ?? []).map((t) => ({ ...t, threadId: state.get(t.root.id)?.id, resolved: state.get(t.root.id)?.resolved }));
  }, [q.data, extras]);
  return { threads, path, isLoading: q.isLoading };
}

// ghall with rendered html bodies
async function ghAllFull<T>(path: string) {
  const items: T[] = [];
  let page = 1;
  for (; page <= 10; page++) {
    const batch = await gh<T[]>(`${path}&page=${page}`, { accept: ACCEPT.full });
    items.push(...batch);
    if (batch.length < 100) break;
  }
  return { items };
}

export function useReviewApi({
  repo,
  pr,
  threads,
  viewer,
  pending,
  setPending,
  refresh,
}: {
  repo: Repo;
  pr: PullRequest | undefined;
  threads: Thread[];
  viewer: string;
  pending: PendingComment[];
  setPending: (p: PendingComment[]) => void;
  refresh: () => Promise<unknown>;
}): ReviewApi {
  const base = `/repos/${repo.full_name}/pulls`;
  const after = async (p: Promise<unknown>) => {
    await p;
    await refresh();
  };
  return {
    threads,
    pending,
    canComment: !!pr,
    context: repo.full_name,
    viewer,
    comment: (path, line, side, body) => after(gh(`${base}/${pr!.number}/comments`, { method: 'POST', body: { body, commit_id: pr!.head.sha, path, line, side } })),
    queue: (c) => setPending([...pending, c]),
    unqueue: (c) => setPending(pending.filter((p) => p !== c)),
    reply: (rootId, body) => after(gh(`${base}/${pr!.number}/comments/${rootId}/replies`, { method: 'POST', body: { body } })),
    edit: (id, body) => after(gh(`${base}/comments/${id}`, { method: 'PATCH', body: { body } })),
    remove: async (id) => {
      if (await confirmDialog({ title: 'Delete this comment?', confirmLabel: 'Delete', danger: true })) await after(gh(`${base}/comments/${id}`, { method: 'DELETE' }));
    },
    resolve: (thread, resolved) =>
      after(
        gql(`mutation($id: ID!) { ${resolved ? 'resolveReviewThread' : 'unresolveReviewThread'}(input: { threadId: $id }) { clientMutationId } }`, {
          id: thread.threadId,
        }),
      ),
  };
}

function ReviewMenu({ own, pending, onSubmit }: { own: boolean; pending: number; onSubmit: (event: string, body: string) => Promise<void> }) {
  const [body, setBody] = useState('');
  return (
    <Dropdown align="right" className="btn primary" trigger={pending ? `Finish review (${pending})` : 'Review changes'}>
      {(close) => {
        const send = (event: string) => () => {
          close();
          void onSubmit(event, body).then(() => setBody(''));
        };
        const needsBody = !body.trim() && pending === 0;
        return (
          <div className="menu wide pad">
            <strong>Finish your review</strong>
            {pending > 0 && <span className="muted small">{plural(pending, 'pending comment')} will be published.</span>}
            <textarea className="input" rows={4} placeholder="Leave a summary" value={body} onChange={(e) => setBody(e.target.value)} />
            <div className="form-foot">
              <button className="btn" disabled={needsBody} onClick={send('COMMENT')}>
                Comment
              </button>
              <span className="spacer" />
              {!own && (
                <>
                  <button className="btn" disabled={needsBody} onClick={send('REQUEST_CHANGES')}>
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

// the files changed tab
export function PullFiles({ repo, pr, review, own, open }: { repo: Repo; pr: PullRequest; review: ReviewApi & { clearPending: () => void }; own: boolean; open: boolean }) {
  const prApi = `/repos/${repo.full_name}/pulls/${pr.number}`;
  const diff = useGhPages<DiffFileEntry>(`${prApi}/files?per_page=50`);
  const [layout, setLayout] = usePref('diff-layout', 'unified');
  const [viewedRaw, setViewedRaw] = usePref(`viewed:${repo.full_name}#${pr.number}`, '');
  const viewed = useMemo(() => new Set(viewedRaw ? viewedRaw.split('\n') : []), [viewedRaw]);
  const [filter, setFilter] = useState('');
  const { run } = useAction();
  const shown = diff.items.filter((f) => f.filename.toLowerCase().includes(filter.toLowerCase()));

  const submit = (event: string, body: string) =>
    run(async () => {
      await gh(`${prApi}/reviews`, {
        method: 'POST',
        body: { event, body, commit_id: pr.head.sha, comments: review.pending.map(({ path, line, side, body }) => ({ path, line, side, body })) },
      });
      review.clearPending();
      await Promise.all([invalidate(prApi), invalidate(`/repos/${repo.full_name}/issues/${pr.number}`)]);
    }, 'Review submitted').then(() => undefined);

  return (
    <div className="stack">
      <div className="toolbar sticky-bar">
        <input className="input name-input" placeholder="Filter files…" value={filter} onChange={(e) => setFilter(e.target.value)} />
        <Dropdown className="btn" trigger={`${plural(pr.changed_files, 'file')}`}>
          {(close) => (
            <div className="menu wide">
              <div className="menu-scroll" onClick={close}>
                {shown.map((f) => (
                  <button key={f.sha + f.filename} onClick={() => document.getElementById(`diff-${f.sha}`)?.scrollIntoView({ block: 'start' })}>
                    <span className="check">{viewed.has(f.filename + f.sha) && <CheckIcon size={14} />}</span>
                    <span className="side-label mono small">{f.filename}</span>
                  </button>
                ))}
              </div>
            </div>
          )}
        </Dropdown>
        <span className="muted small">
          {viewed.size} of {pr.changed_files} viewed
        </span>
        <span className="spacer" />
        <Segmented
          value={layout}
          onChange={setLayout}
          options={[
            { value: 'unified', label: 'Unified' },
            { value: 'split', label: 'Split' },
          ]}
        />
        {open && <ReviewMenu own={own} pending={review.pending.length} onSubmit={submit} />}
      </div>
      <ListState q={diff} count={diff.items.length} empty="No changes" />
      {shown.map((f) => {
        const key = f.filename + f.sha;
        return (
          <DiffFile
            key={key}
            file={f}
            review={review}
            split={layout === 'split'}
            viewed={viewed.has(key)}
            blobBase={`/${pr.head.repo?.full_name ?? repo.full_name}/blob/${pr.head.sha}`}
            onViewed={(v) => {
              const next = new Set(viewed);
              if (v) next.add(key);
              else next.delete(key);
              setViewedRaw([...next].join('\n'));
            }}
          />
        );
      })}
      <LoadMore q={diff} />
    </div>
  );
}

export function PullCommits({ repo, pr }: { repo: Repo; pr: PullRequest }) {
  const q = useGhPages<CommitEntry>(`/repos/${repo.full_name}/pulls/${pr.number}/commits?per_page=100`);
  return (
    <div className="stack">
      <ListState q={q} count={q.items.length} empty="No commits" />
      {q.items.length > 0 && (
        <div className="card">
          {q.items.map((c) => (
            <div key={c.sha} className="row compact">
              <span className="state-icon">
                <GitCommitIcon />
              </span>
              <div className="row-main">
                <Link to={`/${repo.full_name}/commit/${c.sha}`} className="row-link">
                  {c.commit.message.split('\n')[0]}
                </Link>
                <div className="meta">
                  <Avatar user={c.author} size={16} />
                  <strong>{c.author?.login ?? c.commit.author.name}</strong> committed <Time iso={c.commit.author.date} />
                </div>
              </div>
              <code className="muted">{c.sha.slice(0, 7)}</code>
            </div>
          ))}
        </div>
      )}
      <LoadMore q={q} />
    </div>
  );
}

interface CheckRun {
  id: number;
  name: string;
  status: string;
  conclusion: string | null;
  html_url: string | null;
  details_url: string | null;
  started_at: string | null;
  completed_at: string | null;
  app?: { name: string };
  output?: { title: string | null; summary: string | null };
}

const FAILED = ['failure', 'timed_out', 'cancelled', 'action_required', 'startup_failure'];

export function CheckIcons({ c, size = 16 }: { c: Pick<CheckRun, 'status' | 'conclusion'>; size?: number }) {
  if (c.status !== 'completed') return <DotFillIcon size={size} className="pulse" />;
  if (c.conclusion === 'success') return <CheckCircleFillIcon size={size} className="s-open" />;
  if (c.conclusion === 'skipped' || c.conclusion === 'neutral') return <SkipIcon size={size} className="s-draft" />;
  return <XCircleFillIcon size={size} className="s-closed" />;
}

function useChecks(repo: Repo, sha: string) {
  return useGh<{ check_runs: CheckRun[]; total_count: number }>(`/repos/${repo.full_name}/commits/${sha}/check-runs?per_page=100`, {
    refetchInterval: (q) => (q.state.data?.check_runs?.some((c: CheckRun) => c.status !== 'completed') ? 10_000 : false),
  });
}

// actions jobs share their id with the check run
const isActions = (c: CheckRun) => (c as any).app?.slug === 'github-actions';
const runRoute = (repo: Repo, c: CheckRun) => {
  const m = /\/actions\/runs\/(\d+)/.exec(c.details_url ?? c.html_url ?? '');
  return m ? `/${repo.full_name}/actions/runs/${m[1]}` : null;
};

export function PullChecks({ repo, pr }: { repo: Repo; pr: PullRequest }) {
  const checks = useChecks(repo, pr.head.sha);
  const runs = checks.data?.check_runs ?? [];
  const { busy, run } = useAction();
  const canRerun = !!repo.permissions?.push;
  const failed = runs.filter((c) => ['failure', 'cancelled', 'timed_out', 'action_required'].includes(c.conclusion ?? ''));
  const rerun = (c: CheckRun) => gh(isActions(c) ? `/repos/${repo.full_name}/actions/jobs/${c.id}/rerun` : `/repos/${repo.full_name}/check-runs/${c.id}/rerequest`, { method: 'POST' });
  const after = () => invalidate(`/repos/${repo.full_name}/commits/${pr.head.sha}/check-runs`);
  return (
    <div className="stack">
      {canRerun && failed.length > 0 && (
        <div className="toolbar">
          <span className="muted">{failed.length} failing</span>
          <span className="spacer" />
          <button className="btn" disabled={busy} onClick={() => run(async () => (await Promise.all(failed.map(rerun)), await after()), 'Re-running failed checks')}>
            Re-run failed checks
          </button>
        </div>
      )}
      <ListState q={checks} count={runs.length} empty="No checks ran on this commit" />
      {runs.length > 0 && (
        <div className="card">
          {runs.map((c) => {
            const internal = runRoute(repo, c);
            return (
              <div key={c.id} className="row compact">
                <span className="state-icon">
                  <CheckIcons c={c} />
                </span>
                <div className="row-main">
                  {internal ? (
                    <Link className="row-link" to={internal}>
                      {c.name}
                    </Link>
                  ) : (
                    <a className="row-link" href={c.html_url ?? c.details_url ?? undefined}>
                      {c.name}
                    </a>
                  )}
                  <div className="meta">
                    {c.app?.name}
                    {c.output?.title && <span>{c.output.title}</span>}
                  </div>
                </div>
                <span className="row-side">
                  {c.started_at && c.completed_at ? duration(+new Date(c.completed_at) - +new Date(c.started_at)) : c.status.replace(/_/g, ' ')}
                </span>
                {canRerun && c.status === 'completed' && (
                  <button className="btn sm" disabled={busy} onClick={() => run(async () => (await rerun(c), await after()), `Re-running ${c.name}`)}>
                    Re-run
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

export function MergeBox({ repo, pr, extras, refresh }: { repo: Repo; pr: PullRequest; extras?: PullExtras; refresh: () => Promise<unknown> }) {
  const checks = useChecks(repo, pr.head.sha);
  const methods = [
    repo.allow_squash_merge !== false && { value: 'squash', label: 'Squash' },
    repo.allow_merge_commit !== false && { value: 'merge', label: 'Merge commit' },
    repo.allow_rebase_merge !== false && { value: 'rebase', label: 'Rebase' },
  ].filter(Boolean) as { value: string; label: string }[];
  const [method, setMethod] = usePref(`merge-method:${repo.full_name}`, methods[0]?.value ?? 'merge');
  const [confirm, setConfirm] = useState(false);
  const [title, setTitle] = useState('');
  const [message, setMessage] = useState('');
  const { busy, run } = useAction();
  const act = (fn: () => Promise<unknown>, done?: string) => run(async () => (await fn(), await refresh()), done);

  const runs = checks.data?.check_runs ?? [];
  const failed = runs.filter((c) => FAILED.includes(c.conclusion ?? '')).length;
  const pending = runs.filter((c) => c.status !== 'completed').length;
  const behind = pr.mergeable_state === 'behind';
  const blocked = pr.mergeable_state === 'blocked';
  const status =
    pr.mergeable == null
      ? 'Checking whether this can be merged…'
      : !pr.mergeable
        ? 'This branch has conflicts that must be resolved first.'
        : blocked
          ? 'Merging is blocked by a required review or check.'
          : behind
            ? 'This branch is out of date with the base branch.'
            : 'No conflicts with the base branch.';
  const decision = extras?.reviewDecision;
  const autoOn = !!pr.auto_merge;
  const mergeMethod = methods.some((m) => m.value === method) ? method : (methods[0]?.value ?? 'merge');
  const defaultTitle = mergeMethod === 'squash' ? `${pr.title} (#${pr.number})` : `Merge pull request #${pr.number} from ${pr.head.label}`;

  const merge = () =>
    act(async () => {
      await gh(`/repos/${repo.full_name}/pulls/${pr.number}/merge`, {
        method: 'PUT',
        body: { merge_method: mergeMethod, ...(mergeMethod !== 'rebase' ? { commit_title: title || defaultTitle, commit_message: message } : {}) },
      });
      setConfirm(false);
    }, 'Pull request merged');
  const setAuto = (on: boolean) =>
    act(
      () =>
        on
          ? gql('mutation($id: ID!, $m: PullRequestMergeMethod!) { enablePullRequestAutoMerge(input: { pullRequestId: $id, mergeMethod: $m }) { clientMutationId } }', {
              id: pr.node_id,
              m: mergeMethod.toUpperCase(),
            })
          : gql('mutation($id: ID!) { disablePullRequestAutoMerge(input: { pullRequestId: $id }) { clientMutationId } }', { id: pr.node_id }),
      on ? 'Auto-merge enabled' : 'Auto-merge disabled',
    );

  return (
    <div className="card merge-box">
      {decision && (
        <div className="merge-row">
          {decision === 'APPROVED' ? <CheckCircleFillIcon /> : decision === 'CHANGES_REQUESTED' ? <XCircleFillIcon /> : <DotFillIcon />}
          <strong>{decision === 'APPROVED' ? 'Changes approved' : decision === 'CHANGES_REQUESTED' ? 'Changes requested' : 'Review required'}</strong>
        </div>
      )}
      {runs.length > 0 && (
        <div className="merge-row">
          {failed ? <XCircleFillIcon /> : pending ? <DotFillIcon className="pulse" /> : <CheckCircleFillIcon />}
          <div>
            <strong>{failed ? `${failed} of ${runs.length} checks failed` : pending ? `${pending} of ${runs.length} checks still running` : `All ${runs.length} checks passed`}</strong>
            <div className="check-list">
              {runs.slice(0, 12).map((c) => (
                <a key={c.id} href={c.html_url ?? c.details_url ?? undefined} className="meta-item">
                  <CheckIcons c={c} size={12} />
                  {c.name}
                </a>
              ))}
              {runs.length > 12 && <Link to={`/${repo.full_name}/pull/${pr.number}/checks`}>and {runs.length - 12} more</Link>}
            </div>
          </div>
        </div>
      )}
      <div className="merge-row">
        {pr.mergeable ? <CheckCircleFillIcon /> : <XCircleFillIcon />}
        <strong>{status}</strong>
        <span className="spacer" />
        {(behind || extras?.viewerCanUpdateBranch) && pr.mergeable !== false && behind && (
          <button className="btn sm" disabled={busy} onClick={() => act(() => gh(`/repos/${repo.full_name}/pulls/${pr.number}/update-branch`, { method: 'PUT' }), 'Updating branch…')}>
            Update branch
          </button>
        )}
      </div>
      {confirm && mergeMethod !== 'rebase' && (
        <div className="merge-row form">
          <input className="input" value={title} placeholder={defaultTitle} onChange={(e) => setTitle(e.target.value)} aria-label="Commit title" />
          <textarea className="input" rows={3} value={message} placeholder="Add an optional extended description" onChange={(e) => setMessage(e.target.value)} aria-label="Commit message" />
        </div>
      )}
      <div className="merge-row">
        {pr.draft ? (
          <>
            <span className="muted">This pull request is still a draft.</span>
            <span className="spacer" />
            <button
              className="btn primary"
              disabled={busy}
              onClick={() => act(() => gql('mutation($id: ID!) { markPullRequestReadyForReview(input: { pullRequestId: $id }) { clientMutationId } }', { id: pr.node_id }))}
            >
              Ready for review
            </button>
          </>
        ) : (
          <>
            <Segmented value={mergeMethod} onChange={(m) => (setMethod(m), setConfirm(false))} options={methods} />
            <span className="spacer" />
            {autoOn ? (
              <button className="btn" disabled={busy} onClick={() => setAuto(false)}>
                Disable auto-merge
              </button>
            ) : (
              repo.allow_auto_merge && (blocked || pending > 0) && (
                <button className="btn" disabled={busy} onClick={() => setAuto(true)}>
                  Enable auto-merge
                </button>
              )
            )}
            {confirm && (
              <button className="btn" onClick={() => setConfirm(false)}>
                Cancel
              </button>
            )}
            <button className="btn primary" disabled={!pr.mergeable || busy} onClick={() => (confirm ? merge() : setConfirm(true))}>
              <GitMergeIcon /> {confirm ? `Confirm ${methods.find((m) => m.value === mergeMethod)?.label.toLowerCase()}` : 'Merge pull request'}
            </button>
          </>
        )}
      </div>
    </div>
  );
}

// offer to delete the branch once closed
export function BranchCleanup({ repo, pr, refresh }: { repo: Repo; pr: PullRequest; refresh: () => Promise<unknown> }) {
  const sameRepo = pr.head.repo?.full_name === repo.full_name;
  const ref = useGh(sameRepo && pr.head.ref !== repo.default_branch && `/repos/${repo.full_name}/git/ref/heads/${encodeURIComponent(pr.head.ref)}`);
  const { busy, run } = useAction();
  // gone: offer to bring it back at the pull request's head
  if (ref.error?.status === 404 && sameRepo && pr.head.ref !== repo.default_branch)
    return (
      <div className="card merge-box">
        <div className="merge-row">
          <span>
            The <code className="ref">{pr.head.ref}</code> branch was deleted.
          </span>
          <span className="spacer" />
          <button
            className="btn"
            disabled={busy}
            onClick={() =>
              run(async () => {
                await gh(`/repos/${repo.full_name}/git/refs`, { method: 'POST', body: { ref: `refs/heads/${pr.head.ref}`, sha: pr.head.sha } });
                await Promise.all([invalidate(`/repos/${repo.full_name}/git`), invalidate(`/repos/${repo.full_name}/branches`), refresh()]);
              }, `Restored ${pr.head.ref}`)
            }
          >
            Restore branch
          </button>
        </div>
      </div>
    );
  if (!ref.isSuccess) return null;
  return (
    <div className="card merge-box">
      <div className="merge-row">
        <span>
          The <code className="ref">{pr.head.ref}</code> branch can be deleted.
        </span>
        <span className="spacer" />
        <button
          className="btn"
          disabled={busy}
          onClick={() =>
            run(async () => {
              await gh(`/repos/${repo.full_name}/git/refs/heads/${encodeURIComponent(pr.head.ref)}`, { method: 'DELETE' });
              await Promise.all([invalidate(`/repos/${repo.full_name}/git`), invalidate(`/repos/${repo.full_name}/branches`), refresh()]);
              toast(`Deleted ${pr.head.ref}`);
            })
          }
        >
          Delete branch
        </button>
      </div>
    </div>
  );
}

const QUEUE_QUERY = `
query($o: String!, $n: String!, $b: String!, $num: Int!) {
  repository(owner: $o, name: $n) {
    mergeQueue(branch: $b) { id entries { totalCount } }
    pullRequest(number: $num) { id isInMergeQueue mergeQueueEntry { id position state } }
  }
}`;

// adds or removes the pull request from the base branch's merge queue
export function MergeQueue({ repo, pr, refresh }: { repo: Repo; pr: PullRequest; refresh: () => Promise<unknown> }) {
  const q = useGql<any>('merge-queue', QUEUE_QUERY, { o: repo.owner.login, n: repo.name, b: pr.base.ref, num: pr.number });
  const { busy, run } = useAction();
  const queue = q.data?.repository?.mergeQueue;
  const p = q.data?.repository?.pullRequest;
  if (!queue || !p) return null;
  const done = () => Promise.all([invalidateGql('merge-queue'), refresh()]);
  return (
    <div className="card merge-box">
      <div className="merge-row">
        <span>
          {p.isInMergeQueue
            ? `In the merge queue at position ${p.mergeQueueEntry?.position ?? '?'} (${(p.mergeQueueEntry?.state ?? '').toLowerCase().replace('_', ' ')}).`
            : `${pr.base.ref} uses a merge queue with ${queue.entries.totalCount} waiting.`}
        </span>
        <span className="spacer" />
        {p.isInMergeQueue ? (
          <button className="btn" disabled={busy} onClick={() => run(async () => (await gql('mutation($id: ID!) { dequeuePullRequest(input: { id: $id }) { clientMutationId } }', { id: p.id }), await done()), 'Removed from the queue')}>
            Remove from queue
          </button>
        ) : (
          <button className="btn primary" disabled={busy || pr.draft} onClick={() => run(async () => (await gql('mutation($id: ID!) { enqueuePullRequest(input: { pullRequestId: $id }) { clientMutationId } }', { id: p.id }), await done()), 'Added to the merge queue')}>
            Merge when ready
          </button>
        )}
      </div>
    </div>
  );
}
