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
} from '@primer/octicons-react';
import DOMPurify from 'dompurify';
import { type ReactNode, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import type { GhError } from '../lib/api';
import { compact, fullDate, timeAgo } from '../lib/util';

export function Loading({ label }: { label?: string }) {
  return (
    <div className="loading">
      <span className="spinner" />
      {label}
    </div>
  );
}

export function ErrorBox({ error }: { error: GhError | Error }) {
  const status = (error as GhError).status;
  return (
    <div className="empty">
      <h3>{status === 404 ? 'Not found' : status === 403 ? 'Not allowed' : 'Something went wrong'}</h3>
      <p>{error.message}</p>
    </div>
  );
}

export function Empty({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="empty">
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

export function Time({ iso }: { iso: string }) {
  return <time title={fullDate(iso)}>{timeAgo(iso)}</time>;
}

export function Markdown({ html }: { html: string }) {
  const clean = useMemo(() => DOMPurify.sanitize(html, { FORBID_TAGS: ['style'] }), [html]);
  return <div className="markdown" dangerouslySetInnerHTML={{ __html: clean }} />;
}

export function Label({ label }: { label: { name: string } }) {
  return <span className="label">{label.name}</span>;
}

export function LangDot({ name }: { name: string }) {
  return (
    <span className="meta-item">
      <span className="lang-dot" />
      {name}
    </span>
  );
}

export function LoadMore({ q }: { q: { hasNextPage: boolean; isFetchingNextPage: boolean; fetchNextPage: () => unknown } }) {
  if (!q.hasNextPage) return null;
  return (
    <div className="load-more">
      <button className="btn" disabled={q.isFetchingNextPage} onClick={() => q.fetchNextPage()}>
        {q.isFetchingNextPage ? 'Loading…' : 'Load more'}
      </button>
    </div>
  );
}

/** Button + popover that closes on outside click or Escape. */
export function Dropdown({
  trigger,
  children,
  align = 'left',
  className = 'btn',
}: {
  trigger: ReactNode;
  children: (close: () => void) => ReactNode;
  align?: 'left' | 'right';
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
      <button className={className} onClick={() => setOpen((v) => !v)} aria-expanded={open}>
        {trigger}
      </button>
      {open && <div className={`popover ${align}`}>{children(() => setOpen(false))}</div>}
    </div>
  );
}

export type ItemState = 'open' | 'closed' | 'merged' | 'draft' | 'skipped';

/** Works for search results, issue objects and pull request objects alike. */
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
    <div className="row repo-row">
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
