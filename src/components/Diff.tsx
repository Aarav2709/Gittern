import { CheckIcon, ChevronDownIcon, ChevronRightIcon, CommentIcon, FileIcon, PlusIcon } from '@primer/octicons-react';
import { Fragment, type ReactNode, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAction } from '../lib/feedback';
import { escapeHtml, highlightLines, langFor } from '../lib/highlight';
import type { DiffFileEntry, ReviewComment } from '../lib/types';
import { MarkdownEditor } from './Editor';
import { Avatar, Markdown, Time, UserLink } from './ui';

export interface Line {
  t: 'hunk' | 'add' | 'del' | 'ctx' | 'meta';
  o?: number;
  n?: number;
  text: string;
}

export function parsePatch(patch: string): Line[] {
  let o = 0;
  let n = 0;
  return patch.split('\n').map((line): Line => {
    if (line.startsWith('@@')) {
      const m = /@@ -(\d+)(?:,\d+)? \+(\d+)/.exec(line);
      if (m) {
        o = +m[1];
        n = +m[2];
      }
      return { t: 'hunk', text: line };
    }
    if (line.startsWith('+')) return { t: 'add', n: n++, text: line.slice(1) };
    if (line.startsWith('-')) return { t: 'del', o: o++, text: line.slice(1) };
    if (line.startsWith('\\')) return { t: 'meta', text: line };
    return { t: 'ctx', o: o++, n: n++, text: line.slice(1) };
  });
}

export type Side = 'LEFT' | 'RIGHT';
export interface Thread {
  root: ReviewComment;
  replies: ReviewComment[];
  threadId?: string;
  resolved?: boolean;
}
export interface PendingComment {
  path: string;
  line: number;
  side: Side;
  body: string;
}

// what a diff needs to show and take review comments
export interface ReviewApi {
  threads: Thread[];
  pending: PendingComment[];
  canComment: boolean;
  context: string;
  viewer: string;
  comment: (path: string, line: number, side: Side, body: string) => Promise<void>;
  queue: (c: PendingComment) => void;
  unqueue: (c: PendingComment) => void;
  reply: (rootId: number, body: string) => Promise<void>;
  edit: (id: number, body: string) => Promise<void>;
  remove: (id: number) => Promise<void>;
  resolve?: (thread: Thread, resolved: boolean) => Promise<void>;
}

// groups flat review comments into threads
export function buildThreads(comments: ReviewComment[]): Thread[] {
  const roots = new Map<number, Thread>();
  for (const c of comments) if (!c.in_reply_to_id) roots.set(c.id, { root: c, replies: [] });
  for (const c of comments) if (c.in_reply_to_id) roots.get(c.in_reply_to_id)?.replies.push(c);
  return [...roots.values()];
}

const anchor = (side: Side, line: number) => `${side === 'LEFT' ? 'L' : 'R'}${line}`;
const lineAnchors = (l: Line): string[] => (l.t === 'add' ? [anchor('RIGHT', l.n!)] : l.t === 'del' ? [anchor('LEFT', l.o!)] : l.t === 'ctx' ? [anchor('RIGHT', l.n!), anchor('LEFT', l.o!)] : []);

function ThreadComment({ c, api }: { c: ReviewComment; api: ReviewApi }) {
  const [editing, setEditing] = useState<string | null>(null);
  const { busy, run } = useAction();
  const mine = c.user?.login === api.viewer;
  return (
    <div className="thread-comment">
      <Avatar user={c.user} size={22} />
      <div className="thread-body">
        <div className="thread-meta">
          <UserLink user={c.user} />
          <span className="muted small">
            <Time iso={c.created_at} />
          </span>
          <span className="spacer" />
          {mine && editing === null && (
            <>
              <button className="link-btn small" onClick={() => setEditing(c.body)}>
                Edit
              </button>
              <button className="link-btn small" disabled={busy} onClick={() => run(() => api.remove(c.id))}>
                Delete
              </button>
            </>
          )}
        </div>
        {editing !== null ? (
          <>
            <MarkdownEditor value={editing} onChange={setEditing} context={api.context} rows={3} autoFocus />
            <div className="form-foot">
              <span className="spacer" />
              <button className="btn sm" onClick={() => setEditing(null)}>
                Cancel
              </button>
              <button className="btn sm primary" disabled={busy || !editing.trim()} onClick={() => run(() => api.edit(c.id, editing)).then(() => setEditing(null))}>
                Save
              </button>
            </div>
          </>
        ) : c.body_html ? (
          <Markdown html={c.body_html} />
        ) : (
          <p className="plain-body">{c.body}</p>
        )}
      </div>
    </div>
  );
}

export function ThreadView({ thread, api, header }: { thread: Thread; api: ReviewApi; header?: ReactNode }) {
  const [reply, setReply] = useState<string | null>(null);
  const [open, setOpen] = useState(!thread.resolved);
  const { busy, run } = useAction();
  return (
    <div className={`thread ${thread.resolved ? 'resolved' : ''}`}>
      {(header || thread.resolved) && (
        <button className="thread-head" onClick={() => setOpen((v) => !v)}>
          {open ? <ChevronDownIcon size={14} /> : <ChevronRightIcon size={14} />}
          {header}
          {thread.resolved && <span className="badge">Resolved</span>}
        </button>
      )}
      {open && (
        <>
          {[thread.root, ...thread.replies].map((c) => (
            <ThreadComment key={c.id} c={c} api={api} />
          ))}
          {reply !== null ? (
            <div className="thread-reply">
              <MarkdownEditor value={reply} onChange={setReply} context={api.context} rows={3} autoFocus placeholder="Reply…" />
              <div className="form-foot">
                <span className="spacer" />
                <button className="btn sm" onClick={() => setReply(null)}>
                  Cancel
                </button>
                <button className="btn sm primary" disabled={busy || !reply.trim()} onClick={() => run(() => api.reply(thread.root.id, reply)).then(() => setReply(null))}>
                  Reply
                </button>
              </div>
            </div>
          ) : (
            <div className="thread-foot">
              {api.canComment && (
                <button className="btn sm" onClick={() => setReply('')}>
                  Reply
                </button>
              )}
              {api.resolve && thread.threadId && (
                <button className="btn sm" disabled={busy} onClick={() => run(() => api.resolve!(thread, !thread.resolved))}>
                  {thread.resolved ? 'Unresolve' : 'Resolve conversation'}
                </button>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}

function Composer({ api, path, line, side, onClose }: { api: ReviewApi; path: string; line: number; side: Side; onClose: () => void }) {
  const [body, setBody] = useState('');
  const { busy, run } = useAction();
  const reviewing = api.pending.length > 0;
  return (
    <div className="thread composer-thread">
      <MarkdownEditor value={body} onChange={setBody} context={api.context} rows={3} autoFocus placeholder={`Comment on line ${line}`} />
      <div className="form-foot">
        <span className="spacer" />
        <button className="btn sm" onClick={onClose}>
          Cancel
        </button>
        {!reviewing && (
          <button className="btn sm" disabled={busy || !body.trim()} onClick={() => run(() => api.comment(path, line, side, body)).then(onClose)}>
            Add single comment
          </button>
        )}
        <button
          className="btn sm primary"
          disabled={busy || !body.trim()}
          onClick={() => {
            api.queue({ path, line, side, body });
            onClose();
          }}
        >
          {reviewing ? 'Add review comment' : 'Start a review'}
        </button>
      </div>
    </div>
  );
}

interface Row {
  left?: Line;
  right?: Line;
  full?: Line;
}

// pairs removed and added lines for the side-by-side view
export function splitRows(lines: Line[]): Row[] {
  const rows: Row[] = [];
  let dels: Line[] = [];
  let adds: Line[] = [];
  const flush = () => {
    for (let i = 0; i < Math.max(dels.length, adds.length); i++) rows.push({ left: dels[i], right: adds[i] });
    dels = [];
    adds = [];
  };
  for (const l of lines) {
    if (l.t === 'del') dels.push(l);
    else if (l.t === 'add') adds.push(l);
    else {
      flush();
      rows.push(l.t === 'ctx' ? { left: l, right: l } : { full: l });
    }
  }
  flush();
  return rows;
}

const SIGN = { add: '+', del: '-', ctx: ' ', hunk: '', meta: '' };
const BIG = 1500;
const HIGHLIGHT_PATCH_LIMIT = 120_000;

// highlight each side of the patch as a whole
function useHighlighted(lines: Line[], filename: string, enabled: boolean): Map<Line, string> {
  return useMemo(() => {
    const out = new Map<Line, string>();
    if (!enabled || !langFor(filename)) return out;
    const side = (keep: (l: Line) => boolean) => {
      const picked = lines.filter(keep);
      const html = highlightLines(picked.map((l) => l.text).join('\n'), filename);
      picked.forEach((l, i) => l.t !== 'ctx' || !out.has(l) ? out.set(l, html[i] ?? escapeHtml(l.text)) : null);
    };
    side((l) => l.t === 'ctx' || l.t === 'add');
    side((l) => l.t === 'del');
    return out;
  }, [lines, filename, enabled]);
}

export function DiffFile({
  file,
  review,
  split,
  viewed,
  onViewed,
  blobBase,
}: {
  file: DiffFileEntry;
  review?: ReviewApi;
  split?: boolean;
  viewed?: boolean;
  onViewed?: (v: boolean) => void;
  // route prefix for "view file", e.g
  blobBase?: string;
}) {
  const lines = useMemo(() => (file.patch ? parsePatch(file.patch) : []), [file.patch]);
  const [open, setOpen] = useState(!viewed);
  const [showBig, setShowBig] = useState(lines.length <= BIG);
  const [composing, setComposing] = useState<string | null>(null);
  const html = useHighlighted(lines, file.filename, showBig && open && (file.patch?.length ?? 0) < HIGHLIGHT_PATCH_LIMIT);

  const threads = useMemo(() => (review?.threads ?? []).filter((t) => t.root.path === file.filename), [review?.threads, file.filename]);
  const pending = useMemo(() => (review?.pending ?? []).filter((p) => p.path === file.filename), [review?.pending, file.filename]);
  const anchored = useMemo(() => {
    const map = new Map<string, Thread[]>();
    for (const t of threads) {
      if (t.root.line == null) continue;
      const key = anchor(t.root.side, t.root.line);
      map.set(key, [...(map.get(key) ?? []), t]);
    }
    return map;
  }, [threads]);
  const outdated = threads.filter((t) => t.root.line == null);

  const text = (l: Line) => {
    const h = html.get(l);
    return h !== undefined ? <span className="dl-text" dangerouslySetInnerHTML={{ __html: h || ' ' }} /> : <span className="dl-text">{l.text || ' '}</span>;
  };
  const addButton = (l: Line) => {
    if (!review?.canComment || (l.t !== 'add' && l.t !== 'del' && l.t !== 'ctx')) return null;
    const key = lineAnchors(l)[0];
    return (
      <button className="dl-add" title="Comment on this line" aria-label="Comment on this line" onClick={() => setComposing(key)}>
        <PlusIcon size={12} />
      </button>
    );
  };
  // threads, queued comments and the composer that belong under a line
  const below = (l?: Line) => {
    if (!review || !l) return null;
    const keys = lineAnchors(l);
    const ts = keys.flatMap((k) => anchored.get(k) ?? []);
    const ps = pending.filter((p) => keys.includes(anchor(p.side, p.line)));
    const compose = composing && keys[0] === composing;
    if (!ts.length && !ps.length && !compose) return null;
    return (
      <div className="dl-threads">
        {ts.map((t) => (
          <ThreadView key={t.root.id} thread={t} api={review} />
        ))}
        {ps.map((p, i) => (
          <div key={i} className="thread pending">
            <div className="thread-meta">
              <span className="badge">Pending</span>
              <span className="spacer" />
              <button className="link-btn small" onClick={() => review.unqueue(p)}>
                Discard
              </button>
            </div>
            <p className="plain-body">{p.body}</p>
          </div>
        ))}
        {compose && (
          <Composer api={review} path={file.filename} line={l.t === 'del' ? l.o! : l.n!} side={l.t === 'del' ? 'LEFT' : 'RIGHT'} onClose={() => setComposing(null)} />
        )}
      </div>
    );
  };

  const commentCount = threads.reduce((n, t) => n + 1 + t.replies.length, 0);
  return (
    <div className="card diff-file" id={`diff-${file.sha}`}>
      <div className="diff-head">
        <button className="icon-btn sm" aria-label={open ? 'Collapse file' : 'Expand file'} aria-expanded={open} onClick={() => setOpen((v) => !v)}>
          {open ? <ChevronDownIcon /> : <ChevronRightIcon />}
        </button>
        <span className="diff-name">
          {file.previous_filename && <span className="muted">{file.previous_filename} → </span>}
          {file.filename}
        </span>
        {file.status !== 'modified' && <span className="badge">{file.status}</span>}
        {commentCount > 0 && (
          <span className="meta-item muted small">
            <CommentIcon size={12} /> {commentCount}
          </span>
        )}
        <span className="spacer" />
        <span className="add-text">+{file.additions}</span>
        <span className="del-text">−{file.deletions}</span>
        {blobBase && file.status !== 'removed' && (
          <Link className="icon-btn sm" to={`${blobBase}/${file.filename}`} title="View file">
            <FileIcon size={14} />
          </Link>
        )}
        {onViewed && (
          <button
            className={`btn sm ${viewed ? 'on' : ''}`}
            onClick={() => {
              onViewed(!viewed);
              setOpen(!!viewed);
            }}
          >
            {viewed && <CheckIcon size={12} />} Viewed
          </button>
        )}
      </div>
      {open && outdated.length > 0 && review && (
        <div className="dl-threads">
          {outdated.map((t) => (
            <ThreadView key={t.root.id} thread={t} api={review} header={<span className="muted small">Outdated comment on line {t.root.original_line}</span>} />
          ))}
        </div>
      )}
      {open &&
        (!file.patch ? (
          <p className="muted pad small">
            {file.changes === 0 ? 'No content changes (renamed, mode change or binary).' : 'Binary file or diff too large to show.'}
          </p>
        ) : !showBig ? (
          <p className="pad">
            <button className="btn sm" onClick={() => setShowBig(true)}>
              Load large diff ({lines.length.toLocaleString()} lines)
            </button>
          </p>
        ) : split ? (
          <div className="diff-scroll">
            <div className="diff-lines split">
              {splitRows(lines).map((r, i) =>
                r.full ? (
                  <div key={i} className={`dl ${r.full.t}`}>
                    <span className="dl-text">{r.full.text}</span>
                  </div>
                ) : (
                  <Fragment key={i}>
                    <div className="dl-pair">
                      {[r.left, r.right].map((l, s) => (
                        <div key={s} className={`dl half ${l ? (l.t === 'ctx' ? 'ctx' : l.t) : 'none'}`}>
                          <span className="ln">{l ? (s === 0 ? l.o : l.n) : ''}</span>
                          {l && l.t !== 'ctx' ? addButton(l) : l && s === 1 ? addButton(l) : null}
                          <span className="sign">{l && l.t !== 'ctx' ? SIGN[l.t] : ''}</span>
                          {l ? text(l) : <span className="dl-text"> </span>}
                        </div>
                      ))}
                    </div>
                    {r.left === r.right ? below(r.left) : (
                      <>
                        {below(r.left)}
                        {below(r.right)}
                      </>
                    )}
                  </Fragment>
                ),
              )}
            </div>
          </div>
        ) : (
          <div className="diff-scroll">
            <div className="diff-lines">
              {lines.map((l, i) => (
                <Fragment key={i}>
                  <div className={`dl ${l.t}`}>
                    <span className="ln">{l.o ?? ''}</span>
                    <span className="ln">{l.n ?? ''}</span>
                    {addButton(l)}
                    <span className="sign">{SIGN[l.t]}</span>
                    {text(l)}
                  </div>
                  {below(l)}
                </Fragment>
              ))}
            </div>
          </div>
        ))}
    </div>
  );
}
