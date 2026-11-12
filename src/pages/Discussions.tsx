import { ArrowUpIcon, CheckCircleFillIcon, CommentDiscussionIcon, CommentIcon, KebabHorizontalIcon } from '@primer/octicons-react';
import { useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { MarkdownEditor } from '../components/Editor';
import { Avatar, Dropdown, Empty, ErrorBox, Field, ListState, Loading, LoadMore, Markdown, Time } from '../components/ui';
import { gql, invalidateGql, useGql, useGqlPages } from '../lib/api';
import { confirmDialog, promptDialog, useAction, useDraft } from '../lib/feedback';
import { plural } from '../lib/util';
import { useRepo } from './Repo';

interface Actor {
  login: string;
  avatarUrl: string;
}
const user = (a: Actor | null) => (a ? { login: a.login, avatar_url: a.avatarUrl } : null);

function Who({ a }: { a: Actor | null }) {
  return a ? (
    <Link to={`/${a.login}`} className="user-link">
      {a.login}
    </Link>
  ) : (
    <span className="muted">ghost</span>
  );
}

const LIST_QUERY = `
query($owner: String!, $name: String!, $after: String, $category: ID) {
  repository(owner: $owner, name: $name) {
    discussionCategories(first: 30) { nodes { id name emoji isAnswerable } }
    discussions(first: 25, after: $after, categoryId: $category, orderBy: { field: UPDATED_AT, direction: DESC }) {
      totalCount
      pageInfo { hasNextPage endCursor }
      nodes {
        number title createdAt closed isAnswered upvoteCount
        author { login avatarUrl }
        category { name }
        comments { totalCount }
      }
    }
  }
}`;

interface Category {
  id: string;
  name: string;
  isAnswerable: boolean;
}

export function Discussions() {
  const { repo } = useRepo();
  const [sp, setSp] = useSearchParams();
  const category = sp.get('category');
  const q = useGqlPages<any>('discussions', LIST_QUERY, { owner: repo.owner.login, name: repo.name, category }, (d) => d.repository?.discussions);
  const categories: Category[] = q.first?.repository?.discussionCategories?.nodes ?? [];
  if (!repo.has_discussions) return <Empty title="Discussions are turned off">An admin can enable them in the repository settings.</Empty>;
  return (
    <div className="run-layout">
      <nav className="card jobs" aria-label="Categories">
        <button className={`side-link ${!category ? 'active' : ''}`} onClick={() => setSp({})}>
          <span className="side-label">All discussions</span>
        </button>
        {categories.map((c) => (
          <button key={c.id} className={`side-link ${c.id === category ? 'active' : ''}`} onClick={() => setSp({ category: c.id })}>
            <span className="side-label">{c.name}</span>
          </button>
        ))}
      </nav>
      <div className="stack">
        <div className="toolbar">
          <span className="muted">{q.total != null && plural(q.total, 'discussion')}</span>
          <span className="spacer" />
          <Link className="btn primary" to={`/${repo.full_name}/discussions/new`}>
            New discussion
          </Link>
        </div>
        <div className="card">
          <ListState q={q} count={q.items.length} empty="No discussions yet" />
          {q.items.map((d) => (
            <div key={d.number} className="row">
              <span className="state-icon">{d.isAnswered ? <CheckCircleFillIcon className="s-open" /> : <CommentDiscussionIcon />}</span>
              <div className="row-main">
                <div className="row-title">
                  <Link to={`/${repo.full_name}/discussions/${d.number}`}>{d.title}</Link>
                  <span className="badge">{d.category.name}</span>
                  {d.closed && <span className="badge">Closed</span>}
                </div>
                <div className="meta">
                  #{d.number} started <Time iso={d.createdAt} /> by {d.author?.login ?? 'ghost'}
                </div>
              </div>
              <div className="row-side">
                <span className="meta-item">
                  <ArrowUpIcon size={14} /> {d.upvoteCount}
                </span>
                <span className="meta-item">
                  <CommentIcon size={14} /> {d.comments.totalCount}
                </span>
              </div>
            </div>
          ))}
        </div>
        <LoadMore q={q} />
      </div>
    </div>
  );
}

const DETAIL_QUERY = `
query($owner: String!, $name: String!, $number: Int!, $after: String) {
  repository(owner: $owner, name: $name) {
    discussion(number: $number) {
      id title body bodyHTML createdAt closed locked upvoteCount viewerHasUpvoted viewerCanUpvote viewerCanClose viewerCanReopen viewerCanUpdate viewerCanDelete url
      author { login avatarUrl }
      category { id name isAnswerable }
      repository { viewerPermission discussionCategories(first: 25) { nodes { id name } } }
      comments(first: 40, after: $after) {
        totalCount
        pageInfo { hasNextPage endCursor }
        nodes {
          id body bodyHTML createdAt isAnswer upvoteCount viewerHasUpvoted viewerCanMarkAsAnswer viewerCanUnmarkAsAnswer viewerCanDelete viewerCanUpdate
          author { login avatarUrl }
          replies(first: 50) { nodes { id body bodyHTML createdAt viewerCanDelete viewerCanUpdate author { login avatarUrl } } }
        }
      }
    }
  }
}`;

function Upvote({ id, count, on, disabled, act }: { id: string; count: number; on: boolean; disabled?: boolean; act: (fn: () => Promise<unknown>) => void }) {
  return (
    <button
      className={`btn sm ${on ? 'on' : ''}`}
      disabled={disabled}
      title={on ? 'Remove upvote' : 'Upvote'}
      onClick={() => act(() => gql(`mutation($id: ID!) { ${on ? 'removeUpvote' : 'addUpvote'}(input: { subjectId: $id }) { clientMutationId } }`, { id }))}
    >
      <ArrowUpIcon size={12} /> {count}
    </button>
  );
}

export function DiscussionDetail() {
  const { repo } = useRepo();
  const { number } = useParams();
  const q = useGqlPages<any>('discussion', DETAIL_QUERY, { owner: repo.owner.login, name: repo.name, number: Number(number) }, (d) => d.repository?.discussion?.comments);
  const [comment, setComment, clearComment] = useDraft(`discussion:${repo.full_name}#${number}`);
  const [replyTo, setReplyTo] = useState<string | null>(null);
  const [reply, setReply] = useState('');
  // the post being edited, by node id
  const [editing, setEditing] = useState<{ id: string; body: string; title?: string } | null>(null);
  const navigate = useNavigate();
  const { busy, run } = useAction();
  const act = (fn: () => Promise<unknown>, done?: string) => void run(async () => (await fn(), await invalidateGql('discussion')), done);

  if (q.isLoading) return <Loading />;
  if (q.error) return <ErrorBox error={q.error} retry={q.refetch} />;
  const d = q.first?.repository?.discussion;
  if (!d) return <Empty title="Discussion not found" />;
  const post = (body: string, replyToId?: string) =>
    gql('mutation($id: ID!, $body: String!, $reply: ID) { addDiscussionComment(input: { discussionId: $id, body: $body, replyToId: $reply }) { clientMutationId } }', { id: d.id, body, reply: replyToId ?? null });
  const saveEdit = () =>
    editing &&
    act(async () => {
      if (editing.id === d.id) await gql('mutation($id: ID!, $t: String!, $b: String!) { updateDiscussion(input: { discussionId: $id, title: $t, body: $b }) { clientMutationId } }', { id: d.id, t: editing.title ?? d.title, b: editing.body });
      else await gql('mutation($id: ID!, $b: String!) { updateDiscussionComment(input: { commentId: $id, body: $b }) { clientMutationId } }', { id: editing.id, b: editing.body });
      setEditing(null);
    });
  const editor = (id: string) =>
    editing?.id === id && (
      <div className="stack">
        {editing.title !== undefined && <input className="input" value={editing.title} onChange={(e) => setEditing({ ...editing, title: e.target.value })} aria-label="Title" />}
        <MarkdownEditor value={editing.body} onChange={(body) => setEditing({ ...editing, body })} context={repo.full_name} onSubmit={saveEdit} autoFocus />
        <div className="form-foot">
          <span className="spacer" />
          <button className="btn sm" onClick={() => setEditing(null)}>
            Cancel
          </button>
          <button className="btn sm primary" disabled={busy || !editing.body.trim()} onClick={saveEdit}>
            Save
          </button>
        </div>
      </div>
    );
  const canModerate = ['ADMIN', 'MAINTAIN', 'WRITE', 'TRIAGE'].includes(d.repository?.viewerPermission);
  const close = async () => {
    const reason = await promptDialog({
      title: 'Close discussion',
      label: 'Reason',
      options: [
        { value: 'RESOLVED', label: 'Resolved' },
        { value: 'OUTDATED', label: 'Outdated' },
        { value: 'DUPLICATE', label: 'Duplicate' },
      ],
      confirmLabel: 'Close discussion',
    });
    if (reason) act(() => gql('mutation($id: ID!, $r: DiscussionCloseReason) { closeDiscussion(input: { discussionId: $id, reason: $r }) { clientMutationId } }', { id: d.id, r: reason }), 'Discussion closed');
  };
  const recategorize = async () => {
    const cat = await promptDialog({ title: 'Change category', label: 'Category', options: (d.repository?.discussionCategories?.nodes ?? []).map((c: any) => ({ value: c.id, label: c.name })), confirmLabel: 'Move' });
    if (cat && cat !== d.category.id) act(() => gql('mutation($id: ID!, $c: ID!) { updateDiscussion(input: { discussionId: $id, categoryId: $c }) { clientMutationId } }', { id: d.id, c: cat }), 'Category changed');
  };
  const removeDiscussion = async () => {
    if (!(await confirmDialog({ title: 'Delete this discussion?', body: 'This cannot be undone.', confirmLabel: 'Delete discussion', danger: true }))) return;
    await run(() => gql('mutation($id: ID!) { deleteDiscussion(input: { id: $id }) { clientMutationId } }', { id: d.id }), 'Discussion deleted');
    navigate(`/${repo.full_name}/discussions`, { replace: true });
  };
  const remove = async (id: string) => {
    if (await confirmDialog({ title: 'Delete this comment?', confirmLabel: 'Delete', danger: true }))
      act(() => gql('mutation($id: ID!) { deleteDiscussionComment(input: { id: $id }) { clientMutationId } }', { id }));
  };

  return (
    <div className="issue-page">
      <header className="issue-head">
        <h1>
          {d.title} <span className="muted">#{number}</span>
        </h1>
        <div className="issue-sub">
          <span className={`state-pill ${d.closed ? 's-closed' : 's-open'}`}>{d.closed ? 'Closed' : 'Open'}</span>
          <span className="badge">{d.category.name}</span>
          <span className="muted">
            <Who a={d.author} /> started this <Time iso={d.createdAt} /> · {plural(d.comments.totalCount, 'comment')}
          </span>
          <span className="spacer" />
          {(d.closed ? d.viewerCanReopen : d.viewerCanClose) && (
            <button
              className="btn sm"
              disabled={busy}
              onClick={() => (d.closed ? act(() => gql('mutation($id: ID!) { reopenDiscussion(input: { discussionId: $id }) { clientMutationId } }', { id: d.id })) : void close())}
            >
              {d.closed ? 'Reopen' : 'Close'}
            </button>
          )}
          {(d.viewerCanUpdate || d.viewerCanDelete || canModerate) && (
            <Dropdown align="right" className="icon-btn sm" title="More" trigger={<KebabHorizontalIcon size={14} />}>
              {(closeMenu) => (
                <div className="menu" onClick={closeMenu}>
                  {d.viewerCanUpdate && <button onClick={() => setEditing({ id: d.id, body: d.body, title: d.title })}>Edit</button>}
                  {d.viewerCanUpdate && <button onClick={recategorize}>Change category</button>}
                  {canModerate && (
                    <button onClick={() => act(() => gql(`mutation($id: ID!) { ${d.locked ? 'unlockLockable' : 'lockLockable'}(input: { lockableId: $id }) { clientMutationId } }`, { id: d.id }), d.locked ? 'Unlocked' : 'Locked')}>
                      {d.locked ? 'Unlock conversation' : 'Lock conversation'}
                    </button>
                  )}
                  {d.viewerCanDelete && <button onClick={removeDiscussion}>Delete discussion</button>}
                </div>
              )}
            </Dropdown>
          )}
          <a className="btn sm" href={d.url} data-external>
            Open on GitHub
          </a>
        </div>
      </header>
      <div className="timeline narrow-col">
        <div className="comment">
          <Avatar user={user(d.author)} size={32} />
          <div className="card comment-box">
            <div className="pad">
              {editor(d.id) || <Markdown html={d.bodyHTML} />}
              <div className="reactions">
                <Upvote id={d.id} count={d.upvoteCount} on={d.viewerHasUpvoted} disabled={busy || !d.viewerCanUpvote} act={act} />
              </div>
            </div>
          </div>
        </div>
        {q.items.map((c) => (
          <div key={c.id} className="comment">
            <Avatar user={user(c.author)} size={32} />
            <div className={`card comment-box ${c.isAnswer ? 'answer' : ''}`}>
              <div className="card-head">
                <Who a={c.author} />
                <span>
                  commented <Time iso={c.createdAt} />
                </span>
                <span className="spacer" />
                {c.isAnswer && (
                  <span className="badge ok">
                    <CheckCircleFillIcon size={12} /> Answer
                  </span>
                )}
                {(c.isAnswer ? c.viewerCanUnmarkAsAnswer : c.viewerCanMarkAsAnswer) && (
                  <button
                    className="link-btn small"
                    disabled={busy}
                    onClick={() => act(() => gql(`mutation($id: ID!) { ${c.isAnswer ? 'unmarkDiscussionCommentAsAnswer' : 'markDiscussionCommentAsAnswer'}(input: { id: $id }) { clientMutationId } }`, { id: c.id }))}
                  >
                    {c.isAnswer ? 'Unmark answer' : 'Mark as answer'}
                  </button>
                )}
                {c.viewerCanUpdate && (
                  <button className="link-btn small" onClick={() => setEditing({ id: c.id, body: c.body })}>
                    Edit
                  </button>
                )}
                {c.viewerCanDelete && (
                  <button className="link-btn small" onClick={() => remove(c.id)}>
                    Delete
                  </button>
                )}
              </div>
              <div className="pad">
                {editor(c.id) || <Markdown html={c.bodyHTML} />}
                <div className="reactions">
                  <Upvote id={c.id} count={c.upvoteCount} on={c.viewerHasUpvoted} disabled={busy} act={act} />
                  {!d.locked && (
                    <button className="btn sm" onClick={() => (setReplyTo(c.id), setReply(''))}>
                      Reply
                    </button>
                  )}
                </div>
              </div>
              {c.replies.nodes.map((r: any) => (
                <div key={r.id} className="thread-comment reply">
                  <Avatar user={user(r.author)} size={22} />
                  <div className="thread-body">
                    <div className="thread-meta">
                      <Who a={r.author} />
                      <span className="muted small">
                        <Time iso={r.createdAt} />
                      </span>
                      <span className="spacer" />
                      {r.viewerCanUpdate && (
                        <button className="link-btn small" onClick={() => setEditing({ id: r.id, body: r.body })}>
                          Edit
                        </button>
                      )}
                      {r.viewerCanDelete && (
                        <button className="link-btn small" onClick={() => remove(r.id)}>
                          Delete
                        </button>
                      )}
                    </div>
                    {editor(r.id) || <Markdown html={r.bodyHTML} />}
                  </div>
                </div>
              ))}
              {replyTo === c.id && (
                <div className="thread-reply">
                  <MarkdownEditor value={reply} onChange={setReply} context={repo.full_name} rows={3} autoFocus placeholder="Write a reply" />
                  <div className="form-foot">
                    <span className="spacer" />
                    <button className="btn sm" onClick={() => setReplyTo(null)}>
                      Cancel
                    </button>
                    <button className="btn sm primary" disabled={busy || !reply.trim()} onClick={() => act(async () => (await post(reply, c.id), setReplyTo(null)))}>
                      Reply
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        ))}
        <LoadMore q={q} />
        {d.locked ? (
          <p className="muted pad">This discussion is locked.</p>
        ) : (
          <div className="composer">
            <MarkdownEditor value={comment} onChange={setComment} context={repo.full_name} placeholder="Join the discussion" />
            <div className="form-foot">
              <span className="muted small">{comment ? 'Draft saved' : ''}</span>
              <span className="spacer" />
              <button className="btn primary" disabled={busy || !comment.trim()} onClick={() => act(async () => (await post(comment), clearComment()))}>
                Comment
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export function NewDiscussion() {
  const { repo } = useRepo();
  const navigate = useNavigate();
  const cats = useGql<any>('discussion-categories', 'query($owner: String!, $name: String!) { repository(owner: $owner, name: $name) { id discussionCategories(first: 30) { nodes { id name description } } } }', {
    owner: repo.owner.login,
    name: repo.name,
  });
  const [category, setCategory] = useState('');
  const [title, setTitle, clearTitle] = useDraft(`new-discussion-title:${repo.full_name}`);
  const [body, setBody, clearBody] = useDraft(`new-discussion-body:${repo.full_name}`);
  const { busy, run } = useAction();
  const list: { id: string; name: string; description: string }[] = cats.data?.repository?.discussionCategories?.nodes ?? [];
  const picked = category || list[0]?.id;
  const submit = () =>
    run(async () => {
      const out = await gql<any>(
        'mutation($repo: ID!, $cat: ID!, $title: String!, $body: String!) { createDiscussion(input: { repositoryId: $repo, categoryId: $cat, title: $title, body: $body }) { discussion { number } } }',
        { repo: cats.data.repository.id, cat: picked, title, body },
      );
      clearTitle();
      clearBody();
      await invalidateGql('discussions');
      navigate(`/${repo.full_name}/discussions/${out.createDiscussion.discussion.number}`, { replace: true });
    });
  if (cats.isLoading) return <Loading />;
  return (
    <div className="stack narrow-form">
      <h2 className="title">New discussion</h2>
      <Field label="Category" hint={list.find((c) => c.id === picked)?.description}>
        <select className="input" value={picked} onChange={(e) => setCategory(e.target.value)}>
          {list.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      </Field>
      <input className="input" autoFocus placeholder="Title" value={title} onChange={(e) => setTitle(e.target.value)} aria-label="Title" />
      <MarkdownEditor value={body} onChange={setBody} context={repo.full_name} rows={12} placeholder="Start the conversation" onSubmit={submit} />
      <div className="form-foot">
        <span className="spacer" />
        <button className="btn" onClick={() => navigate(-1)}>
          Cancel
        </button>
        <button className="btn primary" disabled={busy || !title.trim() || !body.trim() || !picked} onClick={submit}>
          Start discussion
        </button>
      </div>
    </div>
  );
}
