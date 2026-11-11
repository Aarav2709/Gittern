import {
  GitMergeIcon,
  GitPullRequestClosedIcon,
  GitPullRequestDraftIcon,
  GitPullRequestIcon,
  IssueClosedIcon,
  IssueOpenedIcon,
  LockIcon,
  RepoForkedIcon,
  RepoIcon,
  SkipIcon,
  StarIcon,
  CheckIcon,
  CopyIcon,
  InboxIcon,
  XIcon,
} from '@primer/octicons-react';
import DOMPurify from 'dompurify';
import { type ReactNode, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import type { GhError } from '../lib/api';
import { dismissToast, settleConfirm, useConfirmRequest, useToasts } from '../lib/feedback';
import { langColor } from '../lib/langs';
import { compact, copyText, fullDate, timeAgo } from '../lib/util';

export function Loading({ label }: { label?: string }) {
  return (
    <div className="loading">
      <span className="spinner" />
      {label}
    </div>
  );
}

export function ErrorBox({ error, retry }: { error: GhError | Error; retry?: () => unknown }) {
  const status = (error as GhError).status;
  return (
    <div className="empty">
      <h3>{status === 404 ? 'Not found' : status === 403 ? 'Not allowed' : 'Something went wrong'}</h3>
      <p>{error.message}</p>
      {retry && status !== 404 && (
        <button className="btn" onClick={() => retry()}>
          Try again
        </button>
      )}
    </div>
  );
}

export function Empty({ title, children, icon }: { title: string; children?: ReactNode; icon?: ReactNode }) {
  if (!title) return null;
  return (
    <div className="empty">
      <span className="empty-art">{icon ?? <InboxIcon size={22} />}</span>
      <h3>{title}</h3>
      {children && <p>{children}</p>}
    </div>
  );
}

export function Avatar({ user, size = 20 }: { user: { login?: string; avatar_url?: string } | null; size?: number }) {
  if (!user?.avatar_url) return <span className="avatar" style={{ width: size, height: size }} />;
  const sep = user.avatar_url.includes('?') ? '&' : '?';
  return (
    <img
      className="avatar"
      src={`${user.avatar_url}${sep}s=${size * 2}`}
      width={size}
      height={size}
      alt=""
      loading="lazy"
    />
  );
}

export function UserLink({ user, avatar }: { user: any; avatar?: number }) {
  if (!user) return <span className="muted">ghost</span>;
  return (
    <Link to={`/${user.login}`} className="user-link">
      {avatar && <Avatar user={user} size={avatar} />}
      {user.login}
    </Link>
  );
}

// one shared minute tick keeps every relative time current
const tickers = new Set<() => void>();
let minute = 0;
setInterval(() => {
  minute++;
  tickers.forEach((l) => l());
}, 60_000);
const onTick = (l: () => void) => {
  tickers.add(l);
  return () => tickers.delete(l);
};

export function Time({ iso }: { iso: string }) {
  useSyncExternalStore(onTick, () => minute);
  return <time title={fullDate(iso)}>{timeAgo(iso)}</time>;
}

// where a rendered file lives, to resolve its relative links
export interface MarkdownBase {
  repo: string;
  ref: string;
  dir?: string;
}

const ABSOLUTE = /^([a-z][a-z0-9+.-]*:|#|\/\/)/i;

function resolveRelative(url: string, base: MarkdownBase, raw: boolean): string {
  const root = raw ? `https://raw.githubusercontent.com/${base.repo}/${base.ref}/` : `https://github.com/${base.repo}/blob/${base.ref}/`;
  try {
    // a leading slash means the repository root
    return new URL(url.startsWith('/') ? url.slice(1) : url, url.startsWith('/') || !base.dir ? root : `${root}${base.dir}/`).href;
  } catch {
    return url;
  }
}

// github's html, sanitised
// set once at startup: whether this system can play video without hanging the view
let inlineMedia = false;
// null until the system has been probed
export let mediaProbe: boolean | null = null;
export const setInlineMedia = (supported: boolean, enabled: boolean) => {
  mediaProbe = supported;
  inlineMedia = supported && enabled;
};

function prepareHtml(html: string, base?: MarkdownBase): string {
  const clean = DOMPurify.sanitize(html, { FORBID_TAGS: ['style'] });
  const hasMedia = /<(video|audio)\b/i.test(clean);
  if (!hasMedia && !base) return clean;
  const doc = new DOMParser().parseFromString(clean, 'text/html');
  doc.querySelectorAll('video, audio').forEach((el) => {
    const src = el.getAttribute('src') ?? el.querySelector('source')?.getAttribute('src');
    const link = doc.createElement('a');
    link.className = 'media-link';
    link.textContent = `Play ${el.tagName.toLowerCase()} in browser`;
    if (src) {
      link.setAttribute('href', src);
      link.setAttribute('data-external', '');
    }
    // github wraps videos in a collapsible with a caret and the file name; show just the video
    const wrap = el.closest('details');
    const shell = wrap?.querySelector('summary') ? wrap : el;
    if (inlineMedia && src?.startsWith('https://')) {
      el.setAttribute('controls', '');
      el.setAttribute('preload', 'metadata');
      el.removeAttribute('autoplay');
      if (shell !== el) shell.replaceWith(el);
    } else shell.replaceWith(link);
  });
  if (base) {
    doc.querySelectorAll('a[href]').forEach((a) => {
      const href = a.getAttribute('href')!;
      if (!ABSOLUTE.test(href)) a.setAttribute('href', resolveRelative(href, base, false));
    });
    doc.querySelectorAll('img[src]').forEach((img) => {
      const src = img.getAttribute('src')!;
      if (!ABSOLUTE.test(src)) img.setAttribute('src', resolveRelative(src, base, true));
    });
  }
  return doc.body.innerHTML;
}

export function Markdown({ html, base }: { html: string; base?: MarkdownBase }) {
  const clean = useMemo(() => prepareHtml(html, base), [html, base?.repo, base?.ref, base?.dir]);
  return <div className="markdown" dangerouslySetInnerHTML={{ __html: clean }} />;
}

export function Label({ label }: { label: { name: string; color?: string } }) {
  const c = /^[0-9a-f]{6}$/i.test(label.color ?? '') ? `#${label.color}` : undefined;
  return (
    <span className={`label ${c ? 'tinted' : ''}`} style={c ? ({ '--c': c } as React.CSSProperties) : undefined}>
      {label.name}
    </span>
  );
}

export function LangDot({ name }: { name: string }) {
  return (
    <span className="meta-item">
      <span className="lang-dot" style={{ background: langColor(name) }} />
      {name}
    </span>
  );
}

export function LoadMore({ q }: { q: { hasNextPage: boolean; isFetchingNextPage: boolean; fetchNextPage: () => unknown } }) {
  const ref = useRef<HTMLDivElement>(null);
  // fetch the next page as the button scrolls into view
  useEffect(() => {
    const el = ref.current;
    if (!el || !q.hasNextPage) return;
    const io = new IntersectionObserver((entries) => entries[0].isIntersecting && !q.isFetchingNextPage && q.fetchNextPage(), { rootMargin: '400px' });
    io.observe(el);
    return () => io.disconnect();
  }, [q.hasNextPage, q.isFetchingNextPage, q.fetchNextPage]);
  if (!q.hasNextPage) return null;
  return (
    <div className="load-more" ref={ref}>
      <button className="btn" disabled={q.isFetchingNextPage} onClick={() => q.fetchNextPage()}>
        {q.isFetchingNextPage ? 'Loading…' : 'Load more'}
      </button>
    </div>
  );
}

// button + popover
export function Dropdown({
  trigger,
  children,
  align = 'left',
  className = 'btn',
  title,
  disabled,
}: {
  title?: string;
  disabled?: boolean;
  trigger: ReactNode;
  children: (close: () => void) => ReactNode;
  align?: 'left' | 'right' | 'up';
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);
  return (
    <div className="dropdown" ref={ref}>
      <button type="button" className={className} onClick={() => setOpen((v) => !v)} aria-expanded={open} aria-haspopup="true" title={title} disabled={disabled}>
        {trigger}
      </button>
      {open && <div className={`popover ${align}`}>{children(() => setOpen(false))}</div>}
    </div>
  );
}

export type ItemState = 'open' | 'closed' | 'merged' | 'draft' | 'skipped';

// works for search results, issues and pull requests alike
export function itemState(item: any): { state: ItemState; label: string; isPr: boolean } {
  const isPr = !!item.pull_request || 'merged' in item || 'head' in item;
  if (isPr) {
    if (item.merged || item.merged_at || item.pull_request?.merged_at) return { state: 'merged', label: 'Merged', isPr };
    if (item.state === 'closed') return { state: 'closed', label: 'Closed', isPr };
    if (item.draft) return { state: 'draft', label: 'Draft', isPr };
    return { state: 'open', label: 'Open', isPr };
  }
  if (item.state === 'open') return { state: 'open', label: 'Open', isPr };
  if (item.state_reason === 'not_planned' || item.state_reason === 'duplicate')
    return { state: 'skipped', label: 'Closed', isPr };
  return { state: 'merged', label: 'Closed', isPr };
}

export function StateIcon({ item, size = 16 }: { item: any; size?: number }) {
  const { state, isPr } = itemState(item);
  const Icon = isPr
    ? { open: GitPullRequestIcon, closed: GitPullRequestClosedIcon, merged: GitMergeIcon, draft: GitPullRequestDraftIcon, skipped: GitPullRequestClosedIcon }[state]
    : { open: IssueOpenedIcon, closed: IssueClosedIcon, merged: IssueClosedIcon, draft: IssueOpenedIcon, skipped: SkipIcon }[state];
  return (
    <span className={`state-icon s-${state}`}>
      <Icon size={size} />
    </span>
  );
}

export function StatePill({ item }: { item: any }) {
  const { state, label } = itemState(item);
  return (
    <span className={`state-pill s-${state}`}>
      <StateIcon item={item} /> {label}
    </span>
  );
}

export function RepoRow({ repo, showOwner }: { repo: any; showOwner?: boolean }) {
  return (
    <div className="row">
      <div className="row-main">
        <div className="row-title">
          <Link to={`/${repo.full_name}`}>{showOwner ? repo.full_name : repo.name}</Link>
          <span className="badge">{repo.private ? 'Private' : repo.archived ? 'Archived' : 'Public'}</span>
          {repo.fork && <span className="badge">Fork</span>}
        </div>
        {repo.description && <p className="row-desc">{repo.description}</p>}
        {repo.topics?.length > 0 && (
          <div className="topics">
            {repo.topics.slice(0, 6).map((t: string) => (
              <Link key={t} className="topic" to={`/search?q=${encodeURIComponent('topic:' + t)}`}>
                {t}
              </Link>
            ))}
          </div>
        )}
        <div className="meta">
          {repo.language && <LangDot name={repo.language} />}
          {repo.stargazers_count > 0 && (
            <span className="meta-item">
              <StarIcon size={14} /> {compact(repo.stargazers_count)}
            </span>
          )}
          {repo.forks_count > 0 && (
            <span className="meta-item">
              <RepoForkedIcon size={14} /> {compact(repo.forks_count)}
            </span>
          )}
          {repo.pushed_at && (
            <span className="meta-item">
              Updated <Time iso={repo.pushed_at} />
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

export function RepoGlyph({ repo, size = 16 }: { repo: { private?: boolean; fork?: boolean }; size?: number }) {
  const Icon = repo.private ? LockIcon : repo.fork ? RepoForkedIcon : RepoIcon;
  return <Icon size={size} />;
}

export function Segmented<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T;
  options: { value: T; label: ReactNode }[];
  onChange: (v: T) => void;
}) {
  return (
    <div className="segmented">
      {options.map((o) => (
        <button key={o.value} className={o.value === value ? 'on' : ''} onClick={() => onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

// loading, error and empty states for a list query
export function ListState({
  q,
  count,
  empty,
  children,
}: {
  q: { isLoading: boolean; error: GhError | Error | null; refetch?: () => unknown };
  count: number;
  empty: string;
  children?: ReactNode;
}) {
  if (q.isLoading) return <Loading />;
  if (q.error) return <ErrorBox error={q.error} retry={q.refetch} />;
  if (count === 0) return <Empty title={empty}>{children}</Empty>;
  return null;
}

// underline tabs whose selection lives in the url
export function SubTabs({ tabs, param = 'tab' }: { tabs: { id: string; label: ReactNode; count?: number }[]; param?: string }) {
  const [sp, setSp] = useSearchParams();
  const current = sp.get(param) ?? tabs[0].id;
  return (
    <nav className="tabs">
      {tabs.map((t) => (
        <button
          key={t.id}
          className={`tab ${current === t.id ? 'active' : ''}`}
          onClick={() => {
            const next = new URLSearchParams();
            if (t.id !== tabs[0].id) next.set(param, t.id);
            setSp(next);
          }}
        >
          {t.label}
          {!!t.count && <span className="count">{compact(t.count)}</span>}
        </button>
      ))}
    </nav>
  );
}

export function useSubTab(first: string, param = 'tab') {
  return useSearchParams()[0].get(param) ?? first;
}

export function CopyButton({ text, label, className = 'btn sm' }: { text: string; label?: string; className?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      className={className}
      title="Copy"
      onClick={() => {
        void copyText(text);
        setCopied(true);
        setTimeout(() => setCopied(false), 1200);
      }}
    >
      {copied ? <CheckIcon size={14} /> : <CopyIcon size={14} />}
      {label}
    </button>
  );
}

export function Modal({ title, onClose, children, wide }: { title: string; onClose: () => void; children: ReactNode; wide?: boolean }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div className="overlay" onMouseDown={onClose}>
      <div className={`dialog ${wide ? 'wide' : ''}`} role="dialog" aria-modal="true" aria-label={title} onMouseDown={(e) => e.stopPropagation()}>
        <div className="dialog-head">
          <h2>{title}</h2>
          <button className="icon-btn sm" onClick={onClose} aria-label="Close">
            <XIcon />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

export function Toasts() {
  const toasts = useToasts();
  return (
    <div className="toasts" role="status" aria-live="polite">
      {toasts.map((t) => (
        <button key={t.id} className={`toast ${t.kind}`} onClick={() => dismissToast(t.id)}>
          {t.message}
        </button>
      ))}
    </div>
  );
}

export function ConfirmHost() {
  const req = useConfirmRequest();
  const [typed, setTyped] = useState('');
  useEffect(() => setTyped(''), [req]);
  if (!req) return null;
  const locked = !!req.typeToConfirm && typed !== req.typeToConfirm;
  return (
    <Modal title={req.title} onClose={() => settleConfirm(false)}>
      <form
        className="dialog-body"
        onSubmit={(e) => {
          e.preventDefault();
          if (!locked) settleConfirm(true);
        }}
      >
        {req.body && <p className="muted">{req.body}</p>}
        {req.typeToConfirm && (
          <label className="field">
            <span>
              Type <strong>{req.typeToConfirm}</strong> to confirm
            </span>
            <input className="input" autoFocus value={typed} onChange={(e) => setTyped(e.target.value)} />
          </label>
        )}
        <div className="form-foot">
          <span className="spacer" />
          <button type="button" className="btn" onClick={() => settleConfirm(false)}>
            Cancel
          </button>
          <button className={`btn ${req.danger ? 'danger' : 'primary'}`} disabled={locked} autoFocus={!req.typeToConfirm}>
            {req.confirmLabel ?? 'Confirm'}
          </button>
        </div>
      </form>
    </Modal>
  );
}

export function Field({ label, hint, children }: { label: string; hint?: ReactNode; children: ReactNode }) {
  return (
    <label className="field">
      <span>{label}</span>
      {children}
      {hint && <span className="muted small">{hint}</span>}
    </label>
  );
}

// a simple monochrome bar chart
export function Bars({ values, labels, height = 80 }: { values: number[]; labels?: string[]; height?: number }) {
  const max = Math.max(1, ...values);
  return (
    <div className="bars" style={{ height }}>
      {values.map((v, i) => (
        <span key={i} title={labels ? `${labels[i]}: ${v.toLocaleString()}` : v.toLocaleString()} style={{ height: `${Math.max(v ? 3 : 0, (v / max) * 100)}%` }} />
      ))}
    </div>
  );
}

export function Switch({ checked, onChange, label, disabled }: { checked: boolean; onChange: (v: boolean) => void; label: string; disabled?: boolean }) {
  return (
    <button type="button" role="switch" aria-checked={checked} aria-label={label} disabled={disabled} className={`switch ${checked ? 'on' : ''}`} onClick={() => onChange(!checked)}>
      <span />
    </button>
  );
}
