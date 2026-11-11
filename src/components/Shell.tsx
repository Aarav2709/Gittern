import {
  ArrowLeftIcon,
  ArrowRightIcon,
  BellIcon,
  CodeReviewIcon,
  FileIcon,
  GitCommitIcon,
  GitPullRequestIcon,
  HomeIcon,
  InboxIcon,
  IssueOpenedIcon,
  LinkExternalIcon,
  MentionIcon,
  PersonIcon,
  PlayIcon,
  PlusIcon,
  RepoIcon,
  SearchIcon,
  SidebarCollapseIcon,
  SyncIcon,
  XIcon,
} from '@primer/octicons-react';
import { useIsFetching } from '@tanstack/react-query';
import { Component, type ReactNode, useEffect, useMemo, useRef, useState } from 'react';
import { Link, Outlet, useLocation, useNavigate, useNavigationType } from 'react-router-dom';
import { queryClient, useGh } from '../lib/api';
import { useAuth } from '../lib/auth';
import { activateTab, closeTab, openTab, type RepoRef, syncActivePath, useRepoList, useTabs } from '../lib/store';
import { openExternal, routeFromUrl } from '../lib/util';
import { Avatar, Dropdown } from './ui';

/** Theme-aware mark: solid tile in the text colour, glyph knocked out in the background colour. */
export function Logo({ size = 22 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 512 512" role="img" aria-label="Gittern">
      <rect width="512" height="512" rx="116" fill="var(--fg)" />
      <g fill="none" stroke="var(--bg)" strokeWidth="34" strokeLinecap="round">
        <path d="M176 136v240" />
        <path d="M336 208c0 72-160 40-160 120" />
      </g>
      <circle cx="176" cy="136" r="40" fill="var(--bg)" />
      <circle cx="176" cy="376" r="40" fill="var(--bg)" />
      <circle cx="336" cy="196" r="40" fill="var(--bg)" />
    </svg>
  );
}

type Theme = 'system' | 'light' | 'dark';
function applyTheme(t: Theme) {
  if (t === 'system') delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = t;
}
function stored(key: string, fallback: string): string {
  try {
    return localStorage.getItem(key) || fallback;
  } catch {
    return fallback;
  }
}
function store(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* storage unavailable */
  }
}
applyTheme(stored('theme', 'system') as Theme);

const TOP_PAGES: Record<string, string> = { notifications: 'Inbox', pulls: 'Pull requests', issues: 'Issues', search: 'Search', new: 'New repository' };

/** Short label + icon for a tab, derived from its route alone so it never needs a fetch. */
function describeTab(path: string): { title: string; icon: ReactNode } {
  const [pathname, search = ''] = path.split('?');
  const seg = pathname.split('/').filter(Boolean);
  if (seg.length === 0) return { title: 'Home', icon: <HomeIcon size={14} /> };
  if (seg.length === 1 && TOP_PAGES[seg[0]]) {
    const q = new URLSearchParams(search).get('q');
    const icon = {
      notifications: <InboxIcon size={14} />,
      pulls: <GitPullRequestIcon size={14} />,
      issues: <IssueOpenedIcon size={14} />,
      search: <SearchIcon size={14} />,
      new: <PlusIcon size={14} />,
    }[seg[0]];
    return { title: seg[0] === 'search' && q ? q : TOP_PAGES[seg[0]], icon };
  }
  if (seg.length === 1) return { title: seg[0], icon: <PersonIcon size={14} /> };
  const [, repo, section, ...rest] = seg;
  switch (section) {
    case 'issues':
      return { title: rest[0] ? `${repo} #${rest[0]}` : `${repo} issues`, icon: <IssueOpenedIcon size={14} /> };
    case 'pull':
    case 'pulls':
      return { title: rest[0] ? `${repo} #${rest[0]}` : `${repo} pulls`, icon: <GitPullRequestIcon size={14} /> };
    case 'blob':
      return { title: rest.at(-1) ?? repo, icon: <FileIcon size={14} /> };
    case 'commit':
      return { title: `${repo} ${(rest[0] ?? '').slice(0, 7)}`, icon: <GitCommitIcon size={14} /> };
    case 'commits':
      return { title: `${repo} commits`, icon: <GitCommitIcon size={14} /> };
    case 'actions':
      return { title: `${repo} actions`, icon: <PlayIcon size={14} /> };
    default:
      return { title: `${seg[0]}/${repo}`, icon: <RepoIcon size={14} /> };
  }
}

/** A crash in one page shows a message there instead of blanking the whole app. */
class PageBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  componentDidCatch(error: Error) {
    console.error('[gittern] page crashed:', error);
  }
  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="empty">
        <h3>This page hit a problem</h3>
        <p>{this.state.error.message}</p>
        <button className="btn" onClick={() => this.setState({ error: null })}>
          Try again
        </button>
      </div>
    );
  }
}

function useMedia(query: string): boolean {
  const [match, setMatch] = useState(() => window.matchMedia(query).matches);
  useEffect(() => {
    const mq = window.matchMedia(query);
    const on = () => setMatch(mq.matches);
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, [query]);
  return match;
}

export function Shell() {
  const navigate = useNavigate();
  const loc = useLocation();
  const navType = useNavigationType();
  const { tabs, active } = useTabs();
  const [palette, setPalette] = useState(false);
  const [sidebar, setSidebar] = useState(() => stored('sidebar', 'open') === 'open');
  const [theme, setTheme] = useState<Theme>(() => stored('theme', 'system') as Theme);
  const fetching = useIsFetching() > 0;
  const here = loc.pathname + loc.search;
  // In a narrow window the sidebar is an overlay that is closed until asked for.
  const narrow = useMedia('(max-width: 860px)');
  const [overlay, setOverlay] = useState(false);
  const showSidebar = narrow ? overlay : sidebar;

  // The content pane is the scroller: new pages start at the top, back/forward restore.
  const mainRef = useRef<HTMLElement>(null);
  const scrolls = useRef(new Map<string, number>());
  useEffect(() => {
    syncActivePath(here);
    setPalette(false);
    setOverlay(false);
    const el = mainRef.current;
    if (!el) return;
    el.scrollTop = navType === 'POP' ? (scrolls.current.get(loc.key) ?? 0) : 0;
    const key = loc.key;
    return () => {
      scrolls.current.set(key, el.scrollTop);
    };
  }, [loc.key]);

  const newTab = (path = '/') => {
    openTab(path, true);
    navigate(path);
  };
  const close = (id: string) => {
    const next = closeTab(id);
    if (next !== null) navigate(next);
  };
  const toggleSidebar = () => {
    if (narrow) return setOverlay((v) => !v);
    setSidebar((v) => {
      store('sidebar', v ? 'closed' : 'open');
      return !v;
    });
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.ctrlKey || e.metaKey;
      const key = e.key.toLowerCase();
      const typing = /^(INPUT|TEXTAREA|SELECT)$/.test((e.target as HTMLElement).tagName);
      if ((mod && key === 'k') || (e.key === '/' && !typing)) setPalette(true);
      else if (e.altKey && e.key === 'ArrowLeft') navigate(-1);
      else if (e.altKey && e.key === 'ArrowRight') navigate(1);
      else if ((mod && key === 'r') || e.key === 'F5') void queryClient.invalidateQueries();
      else if (mod && key === 't') newTab();
      else if (mod && key === 'w') close(active);
      else if (mod && key === 'b') toggleSidebar();
      else return;
      e.preventDefault();
    };
    // One handler for every link: modifier/middle click opens a background tab, github.com
    // URLs inside rendered Markdown are routed in-app, everything else goes to the browser.
    const onClick = (e: MouseEvent) => {
      const a = (e.target as Element).closest?.('a');
      const href = a?.getAttribute('href');
      if (!a || !href) return;
      const newTabClick = e.button === 1 || (e.button === 0 && (e.ctrlKey || e.metaKey));
      const internal = href.startsWith('#/') ? href.slice(1) : a.hasAttribute('data-external') ? null : routeFromUrl(href);
      if (newTabClick) {
        e.preventDefault();
        if (internal) openTab(internal, false);
        else if (/^https?:/.test(href)) openExternal(href);
        return;
      }
      if (e.defaultPrevented || e.button !== 0 || href.startsWith('#/')) return;
      e.preventDefault();
      if (href.startsWith('#')) {
        const id = decodeURIComponent(href.slice(1));
        (document.getElementById('user-content-' + id) ?? document.getElementById(id))?.scrollIntoView({ behavior: 'smooth' });
      } else if (internal) navigate(internal);
      else if (/^(https?|mailto):/.test(href)) openExternal(href);
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('click', onClick);
    document.addEventListener('auxclick', onClick);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('click', onClick);
      document.removeEventListener('auxclick', onClick);
    };
  }, [navigate, active, narrow]);

  const cycleTheme = () => {
    const next: Theme = theme === 'system' ? 'dark' : theme === 'dark' ? 'light' : 'system';
    setTheme(next);
    applyTheme(next);
    store('theme', next);
  };

  return (
    <div className={`app ${showSidebar && !narrow ? '' : 'no-sidebar'}`}>
      {narrow && overlay && <div className="backdrop" onClick={() => setOverlay(false)} />}
      {showSidebar && <Sidebar here={here} theme={theme} cycleTheme={cycleTheme} openPalette={() => setPalette(true)} />}
      <div className="workspace">
        <header className="tabbar">
          <button className="icon-btn" onClick={toggleSidebar} title="Toggle sidebar (Ctrl+B)">
            <SidebarCollapseIcon />
          </button>
          <button className="icon-btn" disabled={(window.history.state?.idx ?? 0) <= 0} onClick={() => navigate(-1)} title="Back (Alt+←)">
            <ArrowLeftIcon />
          </button>
          <button className="icon-btn" onClick={() => navigate(1)} title="Forward (Alt+→)">
            <ArrowRightIcon />
          </button>
          <div className="tabs-strip">
            {tabs.map((t) => {
              const d = describeTab(t.path);
              return (
                <div
                  key={t.id}
                  className={`wtab ${t.id === active ? 'active' : ''}`}
                  title={t.path}
                  onClick={() => {
                    if (t.id === active) return;
                    activateTab(t.id);
                    navigate(t.path);
                  }}
                  onAuxClick={(e) => e.button === 1 && close(t.id)}
                >
                  {d.icon}
                  <span>{d.title}</span>
                  <button
                    className="wtab-close"
                    title="Close tab (Ctrl+W)"
                    onClick={(e) => {
                      e.stopPropagation();
                      close(t.id);
                    }}
                  >
                    <XIcon size={12} />
                  </button>
                </div>
              );
            })}
            <button className="icon-btn" onClick={() => newTab()} title="New tab (Ctrl+T)">
              <PlusIcon />
            </button>
          </div>
          <button className={`icon-btn ${fetching ? 'spinning' : ''}`} onClick={() => queryClient.invalidateQueries()} title="Refresh (Ctrl+R)">
            <SyncIcon />
          </button>
        </header>
        <main ref={mainRef}>
          <PageBoundary key={here}>
            <Outlet />
          </PageBoundary>
        </main>
      </div>
      {palette && <Palette onClose={() => setPalette(false)} />}
    </div>
  );
}

function SideLink({ to, icon, label, here, trailing }: { to: string; icon: ReactNode; label: string; here: string; trailing?: ReactNode }) {
  return (
    <Link to={to} className={`side-link ${here === to ? 'active' : ''}`} title={label}>
      {icon}
      <span className="side-label">{label}</span>
      {trailing}
    </Link>
  );
}

function RepoLinks({ title, repos, here }: { title: string; repos: RepoRef[]; here: string }) {
  if (!repos.length) return null;
  return (
    <div className="side-group">
      <div className="side-heading">{title}</div>
      {repos.map((r) => (
        <Link
          key={r.full_name}
          to={`/${r.full_name}`}
          title={r.full_name}
          className={`side-link ${here === `/${r.full_name}` || here.startsWith(`/${r.full_name}/`) ? 'active' : ''}`}
        >
          <img className="avatar square" src={`${r.avatar_url}${r.avatar_url.includes('?') ? '&' : '?'}s=40`} width={16} height={16} alt="" />
          <span className="side-label">{r.full_name}</span>
        </Link>
      ))}
    </div>
  );
}

/** Global navigation. Deliberately identical on every page: only the highlight moves. */
function Sidebar({ here, theme, cycleTheme, openPalette }: { here: string; theme: Theme; cycleTheme: () => void; openPalette: () => void }) {
  const { viewer, source, signOut } = useAuth();
  const unread = useGh<any[]>('/notifications?per_page=50', { refetchInterval: 60_000 });
  const favorites = useRepoList('favorites');
  const repos = useGh<any[]>('/user/repos?sort=pushed&per_page=30&affiliation=owner,collaborator,organization_member');
  const [filter, setFilter] = useState('');
  const [more, setMore] = useState(false);
  const shownRepos = (repos.data ?? []).filter((r) => r.full_name.toLowerCase().includes(filter.toLowerCase()));
  const count = unread.data?.length ?? 0;

  return (
    <aside className="sidebar">
      <div className="side-brand">
        <Logo size={20} />
        <span>Gittern</span>
      </div>
      <div className="side-group">
        <button className="side-link" onClick={openPalette}>
          <SearchIcon />
          <span className="side-label">Search</span>
          <kbd>Ctrl K</kbd>
        </button>
        <SideLink to="/" icon={<HomeIcon />} label="Home" here={here} />
        <SideLink
          to="/notifications"
          icon={<InboxIcon />}
          label="Inbox"
          here={here}
          trailing={count > 0 ? <span className="side-count">{count >= 50 ? '50+' : count}</span> : null}
        />
        <SideLink to="/new" icon={<PlusIcon />} label="New repository" here={here} />
      </div>
      <div className="side-group">
        <div className="side-heading">Pull requests</div>
        <SideLink to="/pulls" icon={<GitPullRequestIcon />} label="Created by me" here={here} />
        <SideLink to="/pulls?filter=review-requested" icon={<CodeReviewIcon />} label="Needs my review" here={here} />
        <SideLink to="/pulls?filter=mentions" icon={<MentionIcon />} label="Mentioned" here={here} />
      </div>
      <div className="side-group">
        <div className="side-heading">Issues</div>
        <SideLink to="/issues" icon={<IssueOpenedIcon />} label="Created by me" here={here} />
        <SideLink to="/issues?filter=assignee" icon={<PersonIcon />} label="Assigned to me" here={here} />
        <SideLink to="/issues?filter=mentions" icon={<MentionIcon />} label="Mentioned" here={here} />
      </div>
      <RepoLinks title="Pinned" repos={favorites} here={here} />
      <div className="side-group">
        <div className="side-heading">Repositories</div>
        <input className="input side-filter" placeholder="Find a repository…" value={filter} onChange={(e) => setFilter(e.target.value)} />
        {shownRepos.slice(0, more || filter ? 30 : 7).map((r) => (
          <Link
            key={r.id}
            to={`/${r.full_name}`}
            title={r.full_name}
            className={`side-link ${here === `/${r.full_name}` || here.startsWith(`/${r.full_name}/`) ? 'active' : ''}`}
          >
            <img className="avatar square" src={`${r.owner.avatar_url}&s=40`} width={16} height={16} alt="" />
            <span className="side-label">{r.full_name}</span>
          </Link>
        ))}
        {!filter && shownRepos.length > 7 && (
          <button className="side-link" onClick={() => setMore((v) => !v)}>
            <span className="side-label">{more ? 'Show less' : 'Show more'}</span>
          </button>
        )}
      </div>
      <span className="spacer" />
      <Dropdown
        className="side-link account"
        align="up"
        trigger={
          <>
            <Avatar user={viewer} size={20} />
            <span className="side-label">{viewer.login}</span>
          </>
        }
      >
        {(close) => (
          <div className="menu" onClick={close}>
            <Link to={`/${viewer.login}`}>Your profile</Link>
            <Link to={`/${viewer.login}?tab=repositories`}>Your repositories</Link>
            <Link to={`/${viewer.login}?tab=stars`}>Your stars</Link>
            <hr />
            <button onClick={cycleTheme}>Theme: {theme}</button>
            <hr />
            {source === 'keyring' ? (
              <button onClick={() => void signOut()}>Sign out</button>
            ) : (
              <span className="menu-note">Signed in via {source === 'gh-cli' ? 'GitHub CLI' : 'environment token'}</span>
            )}
          </div>
        )}
      </Dropdown>
    </aside>
  );
}

interface Action {
  key: string;
  icon: ReactNode;
  label: ReactNode;
  hint?: string;
  run: () => void;
}

function Palette({ onClose }: { onClose: () => void }) {
  const { viewer } = useAuth();
  const navigate = useNavigate();
  const [text, setText] = useState('');
  const [debounced, setDebounced] = useState('');
  const [active, setActive] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);
  const q = text.trim();

  useEffect(() => {
    const t = setTimeout(() => setDebounced(q), 250);
    return () => clearTimeout(t);
  }, [q]);

  const mine = useGh<any[]>('/user/repos?sort=pushed&per_page=30&affiliation=owner,collaborator,organization_member');
  const found = useGh<any>(
    debounced.length >= 2 && !debounced.includes('://') && `/search/repositories?q=${encodeURIComponent(debounced)}&per_page=6`,
  );

  const actions = useMemo<Action[]>(() => {
    const go = (to: string) => () => navigate(to);
    const repoAction = (r: any, hint: string): Action => ({
      key: 'r' + r.full_name,
      icon: <RepoIcon />,
      label: r.full_name,
      hint,
      run: go(`/${r.full_name}`),
    });
    if (!q) {
      return [
        { key: 'home', icon: <HomeIcon />, label: 'Home', run: go('/') },
        { key: 'inbox', icon: <BellIcon />, label: 'Inbox', run: go('/notifications') },
        { key: 'me', icon: <PersonIcon />, label: 'Your profile', run: go(`/${viewer.login}`) },
        ...(mine.data ?? []).slice(0, 8).map((r) => repoAction(r, 'Recent')),
      ];
    }
    const out: Action[] = [];
    if (q.includes('://')) {
      const route = routeFromUrl(q);
      out.push(
        route
          ? { key: 'url', icon: <ArrowRightIcon />, label: `Open ${route}`, hint: 'In Gittern', run: go(route) }
          : { key: 'ext', icon: <LinkExternalIcon />, label: `Open ${q}`, hint: 'In browser', run: () => openExternal(q) },
      );
      return out;
    }
    if (/^[\w.-]+\/[\w.-]+$/.test(q)) out.push({ key: 'jump', icon: <RepoIcon />, label: q, hint: 'Jump to repository', run: go(`/${q}`) });
    else if (/^[\w-]+$/.test(q)) out.push({ key: 'user', icon: <PersonIcon />, label: q, hint: 'Jump to user or org', run: go(`/${q}`) });
    const lower = q.toLowerCase();
    const seen = new Set<string>();
    for (const r of (mine.data ?? []).filter((r) => r.full_name.toLowerCase().includes(lower)).slice(0, 5)) {
      seen.add(r.full_name);
      out.push(repoAction(r, 'Yours'));
    }
    for (const r of found.data?.items ?? []) if (!seen.has(r.full_name)) out.push(repoAction(r, 'Repository'));
    out.push({ key: 'search', icon: <SearchIcon />, label: `Search GitHub for “${q}”`, run: go(`/search?q=${encodeURIComponent(q)}`) });
    return out;
  }, [q, mine.data, found.data, viewer.login, navigate]);

  useEffect(() => setActive(0), [q]);
  useEffect(() => {
    listRef.current?.children[active]?.scrollIntoView({ block: 'nearest' });
  }, [active]);

  const run = (a?: Action) => {
    if (!a) return;
    onClose();
    a.run();
  };

  return (
    <div className="overlay" onMouseDown={onClose}>
      <div className="palette" onMouseDown={(e) => e.stopPropagation()}>
        <div className="palette-input">
          <SearchIcon />
          <input
            autoFocus
            value={text}
            placeholder="Search, type owner/repo, or paste a GitHub URL"
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') onClose();
              else if (e.key === 'ArrowDown') {
                e.preventDefault();
                setActive((i) => Math.min(i + 1, actions.length - 1));
              } else if (e.key === 'ArrowUp') {
                e.preventDefault();
                setActive((i) => Math.max(i - 1, 0));
              } else if (e.key === 'Enter') run(actions[active]);
            }}
          />
        </div>
        <div className="palette-list" ref={listRef}>
          {actions.map((a, i) => (
            <button key={a.key} className={i === active ? 'active' : ''} onMouseEnter={() => setActive(i)} onClick={() => run(a)}>
              {a.icon}
              <span className="palette-label">{a.label}</span>
              {a.hint && <span className="palette-hint">{a.hint}</span>}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
