import { CommentIcon, GitBranchIcon, SearchIcon } from '@primer/octicons-react';
import { type ReactNode, useEffect, useState } from 'react';
import { Link, Navigate, useLocation, useParams, useSearchParams } from 'react-router-dom';
import { DiffFile } from '../components/Diff';
import {
  Avatar,
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
import { ACCEPT, gh, invalidate, useGh, useGhPages } from '../lib/api';
import { useAuth } from '../lib/auth';
import { issueSearch, itemRoute } from './Home';
import { useRepo } from './Repo';

export function IssueRow({ item, showRepo }: { item: any; showRepo?: boolean }) {
  const full = item.repository_url.split('/repos/')[1];
  return (
    <div className="row issue-row">
      <StateIcon item={item} />
      <div className="row-main">
        <div className="row-title">
          {showRepo && (
            <Link to={`/${full}`} className="muted">
              {full}
            </Link>
          )}
          <Link to={itemRoute(item)} className="issue-title">
            {item.title}
          </Link>
          {item.labels?.map((l: any) => <Label key={l.id ?? l.name} label={l} />)}
        </div>
        <div className="meta">
          #{item.number} opened <Time iso={item.created_at} /> by {item.user?.login ?? 'ghost'}
          {item.draft && ' · Draft'}
          {item.milestone && ` · ${item.milestone.title}`}
        </div>
      </div>
      <div className="row-side">
        {item.assignees?.slice(0, 3).map((a: any) => <Avatar key={a.id} user={a} size={20} />)}
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

function ResultList({
  query,
  showRepo,
  emptyTitle,
  toolbar,
}: {
  query: string;
  showRepo?: boolean;
  emptyTitle: string;
  toolbar?: ReactNode;
}) {
  const [sp, setSp] = useSearchParams();
  const state = sp.get('state') === 'closed' ? 'closed' : 'open';
  const other = state === 'open' ? 'closed' : 'open';
  const text = sp.get('q') ?? '';
  const list = useGhPages<any>(issueSearch(`${query} state:${state} ${text}`.trim(), '&sort=updated'), {
    pick: (d) => d.items,
  });
  const otherCount = useGh<any>(issueSearch(`${query} state:${other} ${text}`.trim()).replace('per_page=30', 'per_page=1'));
  const counts = { [state]: list.total, [other]: otherCount.data?.total_count } as Record<string, number | undefined>;
  const setState = (s: string) => {
    const next = new URLSearchParams(sp);
    if (s === 'open') next.delete('state');
    else next.set('state', s);
    setSp(next);
  };

  return (
    <div className="stack">
      <div className="toolbar">
        <QueryBox placeholder="Filter by text or qualifiers, e.g. label:bug author:octocat" />
        {toolbar}
      </div>
      <div className="card list">
        <div className="card-head">
          <Segmented
            value={state}
            onChange={setState}
            options={[
              { value: 'open', label: `Open${counts.open != null ? ` ${counts.open.toLocaleString()}` : ''}` },
              { value: 'closed', label: `Closed${counts.closed != null ? ` ${counts.closed.toLocaleString()}` : ''}` },
            ]}
          />
        </div>
        {list.isLoading && <Loading />}
        {list.error && <ErrorBox error={list.error} />}
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
      toolbar={
        <a className="btn primary" data-external href={`${repo.html_url}/${kind === 'pr' ? 'compare' : 'issues/new'}`}>
          New {kind === 'pr' ? 'pull request' : 'issue'}
        </a>
      }
    />
  );
}

export function GlobalIssues({ kind }: { kind: 'issue' | 'pr' }) {
  const [sp, setSp] = useSearchParams();
  const filters = [
    { value: 'author', label: 'Created' },
    { value: 'assignee', label: 'Assigned' },
    { value: 'mentions', label: 'Mentioned' },
    ...(kind === 'pr' ? [{ value: 'review-requested', label: 'Review requests' }] : []),
  ];
  const filter = filters.find((f) => f.value === sp.get('filter'))?.value ?? 'author';
  return (
    <div className="page narrow stack">
      <div className="toolbar">
        <h2 className="section-title">{kind === 'pr' ? 'Pull requests' : 'Issues'}</h2>
        <span className="spacer" />
        <Segmented
          value={filter}
          options={filters}
          onChange={(v) => {
            const next = new URLSearchParams(sp);
            next.set('filter', v);
            setSp(next);
          }}
        />
      </div>
      <ResultList key={kind + filter} query={`is:${kind} ${filter}:@me archived:false`} showRepo emptyTitle="Nothing here" />
    </div>
  );
}

const REACTIONS: [string, string][] = [
  ['+1', '👍'], ['-1', '👎'], ['laugh', '😄'], ['hooray', '🎉'], ['confused', '😕'], ['heart', '❤️'], ['rocket', '🚀'], ['eyes', '👀'],
];

function Comment({ c, isAuthor }: { c: any; isAuthor?: boolean }) {
  const reactions = REACTIONS.filter(([k]) => c.reactions?.[k] > 0);
  return (
    <div className="comment">
      <Avatar user={c.user} size={36} />
      <div className="card comment-box">
        <div className="card-head">
          <UserLink user={c.user} />
          <span className="muted">
            commented <Time iso={c.created_at} />
          </span>
          <span className="spacer" />
          {isAuthor && <span className="badge">Author</span>}
          {c.author_association && !['NONE', 'CONTRIBUTOR', 'FIRST_TIME_CONTRIBUTOR', 'FIRST_TIMER'].includes(c.author_association) && (
            <span className="badge">{c.author_association.toLowerCase()}</span>
          )}
        </div>
        <div className="pad">
          {c.body_html ? <Markdown html={c.body_html} /> : <em className="muted">No description provided.</em>}
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

function Composer({ api }: { api: string }) {
  const { viewer } = useAuth();
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const submit = async () => {
    setBusy(true);
    setError('');
    try {
      await gh(`${api}/comments`, { method: 'POST', body: { body } });
      setBody('');
      await invalidate(api);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="comment">
      <Avatar user={viewer} size={36} />
      <div className="composer">
        <textarea
          className="input"
          rows={5}
          placeholder="Leave a comment (Markdown supported, Ctrl+Enter to send)"
          value={body}
          onChange={(e) => setBody(e.target.value)}
          onKeyDown={(e) => (e.ctrlKey || e.metaKey) && e.key === 'Enter' && body.trim() && !busy && void submit()}
        />
        <div className="composer-foot">
          {error && <span className="del-text small">{error}</span>}
          <span className="spacer" />
          <button className="btn primary" disabled={!body.trim() || busy} onClick={submit}>
            {busy ? 'Posting…' : 'Comment'}
          </button>
        </div>
      </div>
    </div>
  );
}

function SideSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="side-section">
      <h4>{title}</h4>
      {children}
    </div>
  );
}

export function IssueDetail({ files }: { files?: boolean }) {
  const { repo } = useRepo();
  const { number } = useParams();
  const onPullRoute = useLocation().pathname.includes('/pull/');
  const base = `/repos/${repo.full_name}`;
  const api = `${base}/issues/${number}`;
  const issue = useGh<any>(api, { accept: ACCEPT.full });
  const isPr = !!issue.data?.pull_request;
  const pr = useGh<any>(isPr && `${base}/pulls/${number}`);
  const comments = useGhPages<any>(`${api}/comments?per_page=50`, { accept: ACCEPT.full });
  const diff = useGhPages<any>(isPr && files && `${base}/pulls/${number}/files?per_page=50`);

  if (issue.isLoading) return <Loading />;
  if (issue.error) return <ErrorBox error={issue.error} />;
  const it = issue.data;
  const route = `/${repo.full_name}/${isPr ? 'pull' : 'issues'}/${number}`;
  if (isPr !== onPullRoute) return <Navigate replace to={route} />;
  // The pulls endpoint knows merged/draft; fall back to the issue until it loads.
  const stateSource = pr.data ?? it;

  return (
    <div className="issue-page">
      <header className="issue-head">
        <h1>
          {it.title} <span className="muted">#{it.number}</span>
        </h1>
        <div className="issue-sub">
          <StatePill item={stateSource} />
          <span className="muted">
            <UserLink user={it.user} />{' '}
            {isPr && pr.data ? (
              <>
                wants to merge {pr.data.commits} commit{pr.data.commits === 1 ? '' : 's'} into{' '}
                <code className="ref">
                  <GitBranchIcon size={12} /> {pr.data.base.ref}
                </code>{' '}
                from{' '}
                <code className="ref">
                  <GitBranchIcon size={12} /> {pr.data.head.label}
                </code>
              </>
            ) : (
              <>
                opened this <Time iso={it.created_at} /> · {it.comments} comment{it.comments === 1 ? '' : 's'}
              </>
            )}
          </span>
        </div>
      </header>

      {isPr && (
        <nav className="tabs sub">
          <Link to={route} className={`tab ${files ? '' : 'active'}`}>
            Conversation <span className="count">{it.comments}</span>
          </Link>
          <Link to={`${route}/files`} className={`tab ${files ? 'active' : ''}`}>
            Files changed {pr.data && <span className="count">{pr.data.changed_files}</span>}
          </Link>
          <span className="spacer" />
          {pr.data && (
            <span className="diffstat">
              <span className="add-text">+{pr.data.additions.toLocaleString()}</span>{' '}
              <span className="del-text">−{pr.data.deletions.toLocaleString()}</span>
            </span>
          )}
        </nav>
      )}

      {files ? (
        <div className="stack">
          {diff.isLoading && <Loading />}
          {diff.error && <ErrorBox error={diff.error} />}
          {diff.items.map((f) => (
            <DiffFile key={f.filename} file={f} />
          ))}
          <LoadMore q={diff} />
        </div>
      ) : (
        <div className="issue-layout">
          <div className="timeline">
            <Comment c={it} isAuthor />
            {comments.isLoading && <Loading />}
            {comments.items.map((c) => (
              <Comment key={c.id} c={c} isAuthor={c.user?.login === it.user?.login} />
            ))}
            <LoadMore q={comments} />
            {it.locked ? <p className="muted pad">This conversation is locked.</p> : <Composer api={api} />}
          </div>
          <aside className="issue-side">
            <SideSection title="Assignees">
              {it.assignees?.length ? (
                it.assignees.map((a: any) => (
                  <div key={a.id}>
                    <UserLink user={a} avatar={20} />
                  </div>
                ))
              ) : (
                <span className="muted">No one assigned</span>
              )}
            </SideSection>
            {isPr && pr.data?.requested_reviewers?.length > 0 && (
              <SideSection title="Reviewers">
                {pr.data.requested_reviewers.map((a: any) => (
                  <div key={a.id}>
                    <UserLink user={a} avatar={20} />
                  </div>
                ))}
              </SideSection>
            )}
            <SideSection title="Labels">
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
            <SideSection title="Milestone">
              {it.milestone ? it.milestone.title : <span className="muted">No milestone</span>}
            </SideSection>
            <a className="btn block" href={it.html_url} data-external>
              Open on github.com
            </a>
          </aside>
        </div>
      )}
    </div>
  );
}
