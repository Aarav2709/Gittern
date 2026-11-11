import {
  ArrowLeftIcon,
  ArrowRightIcon,
  BellIcon,
  CodeReviewIcon,
  CodeSquareIcon,
  CommentDiscussionIcon,
  DeviceDesktopIcon,
  MarkGithubIcon,
  FileIcon,
  GearIcon,
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
  TelescopeIcon,
  XIcon,
} from '@primer/octicons-react';
import { useIsFetching } from '@tanstack/react-query';
import { Component, type ReactNode, useEffect, useMemo, useRef, useState } from 'react';
import { Link, Outlet, useLocation, useNavigate, useNavigationType } from 'react-router-dom';
import { queryClient, useGh, useRate } from '../lib/api';
import { useAuth } from '../lib/auth';
import { useInbox, useUpdate } from '../lib/inbox';
import {
  activateTab,
  closeOtherTabs,
  closeTab,
  getPref,
  openTab,
  recordNav,
  reopenTab,
  type RepoRef,
  savedScroll,
  saveScroll,
  scrollKey,
  setPref,
  tabAt,
  tabStep,
  usePref,
  useRepoList,
  useTabs,
} from '../lib/store';
import type { Repo } from '../lib/types';
import { fuzzyScore, openExternal, routeFromUrl } from '../lib/util';
import { Avatar, Dropdown, Modal, RepoGlyph } from './ui';

// tile in the text colour, glyph knocked out
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

export type Theme = 'system' | 'light' | 'dark';
export function applyTheme(t: Theme) {
  if (t === 'system') delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = t;
}
applyTheme(getPref('theme', 'system') as Theme);

const TOP_PAGES: Record<string, string> = {
  notifications: 'Inbox',
  pulls: 'Pull requests',
  issues: 'Issues',
  search: 'Search',
  new: 'New repository',
  explore: 'Explore',
  settings: 'Settings',
  gists: 'Gists',
  local: 'Desktop',
};

// label + icon for a tab, derived from its route alone
function describeTab(path: string): { title: string; icon: ReactNode } {
  const [pathname, search = ''] = path.split(/[?#]/);
  const seg = pathname.split('/').filter(Boolean);
  if (seg.length === 0) return { title: 'Home', icon: <HomeIcon size={14} /> };
  if (seg[0] === 'gist' || seg[0] === 'gists') return { title: seg[1] ? `gist ${seg[1].slice(0, 7)}` : 'Gists', icon: <CodeSquareIcon size={14} /> };
  if (seg.length === 1 && TOP_PAGES[seg[0]]) {
    const q = new URLSearchParams(search).get('q');
    const icon = {
      notifications: <InboxIcon size={14} />,
      pulls: <GitPullRequestIcon size={14} />,
      issues: <IssueOpenedIcon size={14} />,
      search: <SearchIcon size={14} />,
      new: <PlusIcon size={14} />,
      explore: <TelescopeIcon size={14} />,
      settings: <GearIcon size={14} />,
      local: <DeviceDesktopIcon size={14} />,
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
    case 'discussions':
      return { title: rest[0] ? `${repo} #${rest[0]}` : `${repo} discussions`, icon: <CommentDiscussionIcon size={14} /> };
    case 'blob':
    case 'blame':
      return { title: rest.at(-1) ?? repo, icon: <FileIcon size={14} /> };
    case 'commit':
      return { title: `${repo} ${(rest[0] ?? '').slice(0, 7)}`, icon: <GitCommitIcon size={14} /> };
    case 'commits':
      return { title: `${repo} commits`, icon: <GitCommitIcon size={14} /> };
    case 'actions':
      return { title: `${repo} actions`, icon: <PlayIcon size={14} /> };
    case undefined:
    case 'tree':
      return { title: `${seg[0]}/${repo}`, icon: <RepoIcon size={14} /> };
    default:
      return { title: `${repo} ${section}`, icon: <RepoIcon size={14} /> };
  }
}

// a crash in one page shows a message there instead of blanking the app
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

const SHORTCUTS: [string, string][] = [
  ['Ctrl K or /', 'Search and commands'],
  ['Ctrl T / Ctrl W', 'New tab / close tab'],
  ['Ctrl Shift T', 'Reopen closed tab'],
  ['Ctrl Tab / Ctrl 1–9', 'Switch tabs'],
  ['Alt ← / Alt →', 'Back / forward in this tab'],
  ['Ctrl B', 'Show or hide the sidebar'],
  ['Ctrl R', 'Refresh data'],
  ['J / K', 'Move down / up a list'],
  ['Enter or O', 'Open the highlighted row'],
  ['G then H', 'Home'],
  ['G then N', 'Inbox'],
  ['G then E', 'Explore'],
  ['G then C / I / P / A / D', 'In a repository: code, issues, pulls, actions, discussions'],
  ['T', 'Go to file, on a code page'],
  ['Y', 'Copy a permalink, on a file page'],
  ['?', 'This list'],
];

const ROWS = 'main .row, main .file-row, main .work-item';

export function Shell() {
  const navigate = useNavigate();
  const loc = useLocation();
  const navType = useNavigationType();
  const { tabs, active } = useTabs();
  const [palette, setPalette] = useState(false);
  const [help, setHelp] = useState(false);
  const [sidebarPref, setSidebarPref] = usePref('sidebar', 'open');
  const fetching = useIsFetching() > 0;
  const here = loc.pathname + loc.search + loc.hash;
  // narrow windows: the sidebar is an overlay
  const narrow = useMedia('(max-width: 860px)');
  const [overlay, setOverlay] = useState(false);
  const showSidebar = narrow ? overlay : sidebarPref === 'open';
  const tab = tabs.find((t) => t.id === active)!;

  // the content pane is the scroller
  const mainRef = useRef<HTMLElement>(null);
  const lastPage = useRef('');
  useEffect(() => {
    const restored = recordNav(here, navType === 'REPLACE');
    const page = loc.pathname + loc.search;
    const samePage = lastPage.current === page;
    lastPage.current = page;
    setPalette(false);
    setOverlay(false);
    const el = mainRef.current;
    if (!el) return;
    const key = scrollKey();
    const top = restored ? savedScroll(key) : 0;
    // a hash-only change keeps the scroll
    if (!samePage) el.scrollTop = top;
    const again = top && !samePage ? setTimeout(() => (el.scrollTop = top), 250) : undefined;
    return () => {
      clearTimeout(again);
      saveScroll(key, el.scrollTop);
    };
  }, [loc.key, here]);

  const go = (path: string | null) => path !== null && navigate(path);
  const newTab = (path = '/') => {
    openTab(path, true);
    navigate(path);
  };
  const toggleSidebar = () => (narrow ? setOverlay((v) => !v) : setSidebarPref(sidebarPref === 'open' ? 'closed' : 'open'));
  const repoBase = /^\/[^/]+\/[^/]+/.exec(loc.pathname)?.[0];
  const inRepo = !!repoBase && !TOP_PAGES[loc.pathname.split('/')[1]] && loc.pathname.split('/')[1] !== 'gist';

  useEffect(() => {
    let chord = 0;
    let cursor = -1;
    const rows = () => [...document.querySelectorAll<HTMLElement>(ROWS)];
    const move = (delta: number) => {
      const all = rows();
      if (!all.length) return;
      all[cursor]?.classList.remove('kb-focus');
      cursor = Math.max(0, Math.min(all.length - 1, cursor + delta));
      all[cursor].classList.add('kb-focus');
      all[cursor].scrollIntoView({ block: 'nearest' });
    };
    const onKey = (e: KeyboardEvent) => {
      const mod = e.ctrlKey || e.metaKey;
      const key = e.key.toLowerCase();
      const target = e.target as HTMLElement;
      const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName) || target.isContentEditable;
      if (mod && key === 'k') setPalette(true);
      else if (e.altKey && e.key === 'ArrowLeft') go(tabStep(-1));
      else if (e.altKey && e.key === 'ArrowRight') go(tabStep(1));
      else if ((mod && key === 'r') || e.key === 'F5') void queryClient.invalidateQueries();
      else if (mod && e.shiftKey && key === 't') go(reopenTab());
      else if (mod && key === 't') newTab();
      else if (mod && key === 'w') go(closeTab(active));
      else if (mod && key === 'b' && !typing) toggleSidebar();
      else if (e.ctrlKey && e.key === 'Tab') go(tabAt((i) => i + (e.shiftKey ? -1 : 1)));
      else if (mod && /^[1-9]$/.test(e.key)) go(tabAt((_, n) => (e.key === '9' ? n - 1 : Math.min(+e.key - 1, n - 1))));
      else if (typing || mod || e.altKey) return;
      else if (e.key === '/') setPalette(true);
      else if (e.key === '?') setHelp(true);
      else if (Date.now() - chord < 1200 && 'hnecipad'.includes(key)) {
        chord = 0;
        const repoTarget = { c: '', i: '/issues', p: '/pulls', a: '/actions', d: '/discussions' }[key];
        if (key === 'h') navigate('/');
        else if (key === 'n') navigate('/notifications');
        else if (key === 'e') navigate('/explore');
        else if (repoTarget !== undefined && inRepo) navigate(repoBase + repoTarget);
        else if (key === 'i') navigate('/issues');
        else if (key === 'p') navigate('/pulls');
        else return;
      } else if (key === 'g') chord = Date.now();
      else if (key === 'j') move(1);
      else if (key === 'k') move(-1);
      else if ((e.key === 'Enter' || key === 'o') && rows()[cursor]?.classList.contains('kb-focus')) {
        const row = rows()[cursor];
        (row.matches('a') ? row : row.querySelector<HTMLElement>('a, button'))?.click();
      } else return;
      e.preventDefault();
    };
    // one handler for every link
    // github urls route in-app, the rest open the browser
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
  }, [navigate, active, narrow, sidebarPref, repoBase, inRepo, loc.key]);

  return (
    <div className={`app ${showSidebar && !narrow ? '' : 'no-sidebar'}`}>
      {narrow && overlay && <div className="backdrop" onClick={() => setOverlay(false)} />}
      {showSidebar && <Sidebar here={loc.pathname + loc.search} openPalette={() => setPalette(true)} showHelp={() => setHelp(true)} />}
      <div className="workspace">
        <header className="tabbar">
          <button className="icon-btn" onClick={toggleSidebar} title="Toggle sidebar (Ctrl+B)" aria-label="Toggle sidebar">
            <SidebarCollapseIcon />
          </button>
          <button className="icon-btn" disabled={tab.idx <= 0} onClick={() => go(tabStep(-1))} title="Back (Alt+←)" aria-label="Back">
            <ArrowLeftIcon />
          </button>
          <button className="icon-btn" disabled={tab.idx >= tab.hist.length - 1} onClick={() => go(tabStep(1))} title="Forward (Alt+→)" aria-label="Forward">
            <ArrowRightIcon />
          </button>
          <div className="tabs-strip" role="tablist">
            {tabs.map((t) => {
              const d = describeTab(t.path);
              return (
                <div
                  key={t.id}
                  role="tab"
                  tabIndex={0}
                  aria-selected={t.id === active}
                  className={`wtab ${t.id === active ? 'active' : ''}`}
                  title={t.path}
                  onClick={() => go(activateTab(t.id))}
                  onKeyDown={(e) => e.key === 'Enter' && go(activateTab(t.id))}
                  onAuxClick={(e) => e.button === 1 && go(closeTab(t.id))}
                  onContextMenu={(e) => {
                    e.preventDefault();
                    go(closeOtherTabs(t.id));
                  }}
                >
                  {d.icon}
                  <span>{d.title}</span>
                  <button
                    className="wtab-close"
                    title="Close tab (Ctrl+W)"
                    aria-label="Close tab"
                    onClick={(e) => {
                      e.stopPropagation();
                      go(closeTab(t.id));
                    }}
                  >
                    <XIcon size={12} />
                  </button>
                </div>
              );
            })}
            <button className="icon-btn" onClick={() => newTab()} title="New tab (Ctrl+T)" aria-label="New tab">
              <PlusIcon />
            </button>
          </div>
          <button className={`icon-btn ${fetching ? 'spinning' : ''}`} onClick={() => queryClient.invalidateQueries()} title="Refresh (Ctrl+R)" aria-label="Refresh">
            <SyncIcon />
          </button>
        </header>
        <main ref={mainRef} className={loc.pathname === '/local' ? 'flush' : undefined}>
          <PageBoundary key={loc.pathname + loc.search}>
            <Outlet />
          </PageBoundary>
        </main>
      </div>
      {palette && <Palette onClose={() => setPalette(false)} repoBase={inRepo ? repoBase : undefined} showHelp={() => setHelp(true)} />}
      {help && (
        <Modal title="Keyboard shortcuts" onClose={() => setHelp(false)}>
          <dl className="shortcuts">
            {SHORTCUTS.map(([keys, what]) => (
              <div key={keys}>
                <dt>
                  <kbd>{keys}</kbd>
                </dt>
                <dd>{what}</dd>
              </div>
            ))}
          </dl>
        </Modal>
      )}
    </div>
  );
}

function SideLink({ to, icon, label, here, trailing }: { to: string; icon: ReactNode; label: string; here: string; trailing?: ReactNode }) {
  const on = here === to;
  return (
    <Link to={to} className={`side-link ${on ? 'active' : ''}`} title={label} aria-current={on ? 'page' : undefined}>
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

const MY_REPOS = '/user/repos?sort=pushed&per_page=100&affiliation=owner,collaborator,organization_member';

// global navigation
function Sidebar({ here, openPalette, showHelp }: { here: string; openPalette: () => void; showHelp: () => void }) {
  const { viewer, source, signOut } = useAuth();
  const inbox = useInbox();
  const update = useUpdate();
  const rate = useRate();
  const favorites = useRepoList('favorites');
  const repos = useGh<Repo[]>(MY_REPOS);
  const [filter, setFilter] = useState('');
  const [more, setMore] = useState(false);
  const local = here.startsWith('/local');
  const shownRepos = (repos.data ?? []).filter((r) => r.full_name.toLowerCase().includes(filter.toLowerCase()));

  return (
    <aside className="sidebar" aria-label="Navigation">
      <div className="side-brand">
        <Logo size={20} />
        <span>Gittern</span>
        <span className="spacer" />
        <div className="mode-switch" role="group" aria-label="Mode">
          <Link to="/" className={local ? '' : 'on'} title="GitHub" aria-label="GitHub mode" aria-current={local ? undefined : 'true'}>
            <MarkGithubIcon size={14} />
          </Link>
          <Link to="/local" className={local ? 'on' : ''} title="Desktop: work on local repositories" aria-label="Desktop mode" aria-current={local ? 'true' : undefined}>
            <DeviceDesktopIcon size={14} />
          </Link>
        </div>
      </div>
      <nav className="side-group">
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
          trailing={inbox.count > 0 ? <span className="side-count">{inbox.more ? `${inbox.count}+` : inbox.count}</span> : null}
        />
        <SideLink to="/explore" icon={<TelescopeIcon />} label="Explore" here={here} />
      </nav>
      <nav className="side-group">
        <div className="side-heading">Pull requests</div>
        <SideLink to="/pulls" icon={<GitPullRequestIcon />} label="Created by me" here={here} />
        <SideLink to="/pulls?filter=review-requested" icon={<CodeReviewIcon />} label="Needs my review" here={here} />
        <SideLink to="/pulls?filter=mentions" icon={<MentionIcon />} label="Mentioned" here={here} />
      </nav>
      <nav className="side-group">
        <div className="side-heading">Issues</div>
        <SideLink to="/issues" icon={<IssueOpenedIcon />} label="Created by me" here={here} />
        <SideLink to="/issues?filter=assignee" icon={<PersonIcon />} label="Assigned to me" here={here} />
        <SideLink to="/issues?filter=mentions" icon={<MentionIcon />} label="Mentioned" here={here} />
      </nav>
      <RepoLinks title="Pinned" repos={favorites} here={here} />
      <div className="side-group">
        <div className="side-heading">
          Repositories
          <Link to="/new" className="icon-btn sm" title="New repository" aria-label="New repository">
            <PlusIcon size={14} />
          </Link>
        </div>
        <input className="input side-filter" placeholder="Find a repository…" aria-label="Find a repository" value={filter} onChange={(e) => setFilter(e.target.value)} />
        {shownRepos.slice(0, more || filter ? 100 : 7).map((r) => (
          <Link
            key={r.id}
            to={`/${r.full_name}`}
            title={r.full_name}
            className={`side-link ${here === `/${r.full_name}` || here.startsWith(`/${r.full_name}/`) ? 'active' : ''}`}
          >
            <RepoGlyph repo={r} />
            <span className="side-label">{r.full_name}</span>
          </Link>
        ))}
        {!filter && shownRepos.length > 7 && (
          <button className="side-link" onClick={() => setMore((v) => !v)}>
            <span className="side-label">{more ? 'Show less' : `Show ${shownRepos.length - 7} more`}</span>
          </button>
        )}
        {filter && shownRepos.length === 0 && (
          <Link className="side-link" to={`/search?q=${encodeURIComponent(filter)}`}>
            <span className="side-label">Search GitHub for “{filter}”</span>
          </Link>
        )}
      </div>
      <span className="spacer" />
      {update && (
        <a className="side-link update" href={update.url} data-external>
          <span className="side-label">Update available: {update.version}</span>
        </a>
      )}
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
            <Link to="/gists">Your gists</Link>
            <hr />
            <Link to="/settings">Settings</Link>
            <button onClick={showHelp}>Keyboard shortcuts</button>
            <hr />
            <button onClick={() => void signOut()}>Sign out</button>
            <span className="menu-note">
              {source === 'gh-cli' ? 'Signed in via GitHub CLI' : source === 'env' ? 'Signed in via environment token' : 'Signed in with a saved token'}
              {rate?.remaining != null && rate.limit != null && ` · ${rate.remaining.toLocaleString()} of ${rate.limit.toLocaleString()} requests left`}
            </span>
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
  // text the query is matched against
  match?: string;
  hint?: string;
  run: () => void;
}

function Palette({ onClose, repoBase, showHelp }: { onClose: () => void; repoBase?: string; showHelp: () => void }) {
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

  const mine = useGh<Repo[]>(MY_REPOS);
  const found = useGh<{ items: Repo[] }>(debounced.length >= 2 && !debounced.includes('://') && `/search/repositories?q=${encodeURIComponent(debounced)}&per_page=6`);

  const actions = useMemo<Action[]>(() => {
    const go = (to: string) => () => navigate(to);
    const repoAction = (r: Repo, hint: string): Action => ({ key: 'r' + r.full_name, icon: <RepoIcon />, label: r.full_name, hint, run: go(`/${r.full_name}`) });
    const cmd = (label: string, to: string | (() => void), icon: ReactNode = <ArrowRightIcon />, hint = 'Command'): Action => ({
      key: 'c' + label,
      icon,
      label,
      match: label,
      hint,
      run: typeof to === 'string' ? go(to) : to,
    });
    const repoName = repoBase?.slice(1);
    const commands: Action[] = [
      ...(repoBase
        ? [
            cmd(`${repoName}: Code`, repoBase, <RepoIcon />, 'This repository'),
            cmd(`${repoName}: Issues`, `${repoBase}/issues`, <IssueOpenedIcon />, 'This repository'),
            cmd(`${repoName}: Pull requests`, `${repoBase}/pulls`, <GitPullRequestIcon />, 'This repository'),
            cmd(`${repoName}: Actions`, `${repoBase}/actions`, <PlayIcon />, 'This repository'),
            cmd(`${repoName}: Discussions`, `${repoBase}/discussions`, <CommentDiscussionIcon />, 'This repository'),
            cmd(`${repoName}: Commits`, `${repoBase}/commits`, <GitCommitIcon />, 'This repository'),
            cmd(`${repoName}: Branches`, `${repoBase}/branches`, undefined, 'This repository'),
            cmd(`${repoName}: Tags`, `${repoBase}/tags`, undefined, 'This repository'),
            cmd(`${repoName}: Releases`, `${repoBase}/releases`, undefined, 'This repository'),
            cmd(`${repoName}: Insights`, `${repoBase}/insights`, undefined, 'This repository'),
            cmd(`${repoName}: Security`, `${repoBase}/security`, undefined, 'This repository'),
            cmd(`${repoName}: Labels`, `${repoBase}/labels`, undefined, 'This repository'),
            cmd(`${repoName}: Milestones`, `${repoBase}/milestones`, undefined, 'This repository'),
            cmd(`${repoName}: New issue`, `${repoBase}/issues/new`, <PlusIcon />, 'This repository'),
            cmd(`${repoName}: New pull request`, `${repoBase}/compare`, <PlusIcon />, 'This repository'),
            cmd(`${repoName}: Search code`, `${repoBase}/search`, <SearchIcon />, 'This repository'),
          ]
        : []),
      cmd('Home', '/', <HomeIcon />),
      cmd('Inbox', '/notifications', <BellIcon />),
      cmd('Explore', '/explore', <TelescopeIcon />),
      cmd('Desktop mode: local repositories', '/local', <DeviceDesktopIcon />),
      cmd('Your profile', `/${viewer.login}`, <PersonIcon />),
      cmd('Your gists', '/gists', <CodeSquareIcon />),
      cmd('Your stars', `/${viewer.login}?tab=stars`),
      cmd('Pull requests needing your review', '/pulls?filter=review-requested', <CodeReviewIcon />),
      cmd('Issues assigned to you', '/issues?filter=assignee', <IssueOpenedIcon />),
      cmd('New repository', '/new', <PlusIcon />),
      cmd('New gist', '/gists/new', <PlusIcon />),
      cmd('Settings', '/settings', <GearIcon />),
      cmd('Keyboard shortcuts', showHelp),
      cmd('Theme: light', () => (setPref('theme', 'light'), applyTheme('light'))),
      cmd('Theme: dark', () => (setPref('theme', 'dark'), applyTheme('dark'))),
      cmd('Theme: follow system', () => (setPref('theme', 'system'), applyTheme('system'))),
      cmd('Refresh data', () => void queryClient.invalidateQueries(), <SyncIcon />),
    ];
    if (!q) return [...commands.slice(0, repoBase ? 6 : 0), ...commands.slice(repoBase ? 16 : 0, repoBase ? 19 : 4), ...(mine.data ?? []).slice(0, 8).map((r) => repoAction(r, 'Recent'))];
    const out: Action[] = [];
    if (q.includes('://')) {
      const route = routeFromUrl(q);
      return [
        route
          ? { key: 'url', icon: <ArrowRightIcon />, label: `Open ${route}`, hint: 'In Gittern', run: go(route) }
          : { key: 'ext', icon: <LinkExternalIcon />, label: `Open ${q}`, hint: 'In browser', run: () => openExternal(q) },
      ];
    }
    const issueRef = /^#?(\d+)$/.exec(q);
    if (issueRef && repoBase) out.push({ key: 'num', icon: <IssueOpenedIcon />, label: `${repoName}#${issueRef[1]}`, hint: 'Jump to issue or pull request', run: go(`${repoBase}/issues/${issueRef[1]}`) });
    if (/^[\w.-]+\/[\w.-]+$/.test(q)) out.push({ key: 'jump', icon: <RepoIcon />, label: q, hint: 'Jump to repository', run: go(`/${q}`) });
    const seen = new Set<string>();
    const scored = (mine.data ?? [])
      .map((r) => [fuzzyScore(r.full_name, q), r] as const)
      .filter(([s]) => s >= 0)
      .sort((a, b) => a[0] - b[0] || a[1].full_name.length - b[1].full_name.length);
    for (const [, r] of scored.slice(0, 5)) {
      seen.add(r.full_name);
      out.push(repoAction(r, 'Yours'));
    }
    out.push(
      ...commands
        .map((c) => [fuzzyScore(c.match!, q), c] as const)
        .filter(([s]) => s >= 0 && s < 3)
        .sort((a, b) => a[0] - b[0])
        .slice(0, 6)
        .map(([, c]) => c),
    );
    for (const r of found.data?.items ?? []) if (!seen.has(r.full_name)) out.push(repoAction(r, 'Repository'));
    if (/^[\w-]+$/.test(q) && !issueRef) out.push({ key: 'user', icon: <PersonIcon />, label: q, hint: 'Jump to user or org', run: go(`/${q}`) });
    if (repoBase) out.push({ key: 'code', icon: <SearchIcon />, label: `Search code in ${repoName} for “${q}”`, run: go(`${repoBase}/search?q=${encodeURIComponent(q)}`) });
    out.push({ key: 'search', icon: <SearchIcon />, label: `Search GitHub for “${q}”`, run: go(`/search?q=${encodeURIComponent(q)}`) });
    return out;
  }, [q, mine.data, found.data, viewer.login, navigate, repoBase]);

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
      <div className="palette" role="dialog" aria-label="Search and commands" onMouseDown={(e) => e.stopPropagation()}>
        <div className="palette-input">
          <SearchIcon />
          <input
            autoFocus
            value={text}
            placeholder="Search, run a command, type owner/repo, or paste a GitHub URL"
            aria-label="Search and commands"
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
        <div className="palette-list" ref={listRef} role="listbox">
          {actions.map((a, i) => (
            <button key={a.key} role="option" aria-selected={i === active} className={i === active ? 'active' : ''} onMouseEnter={() => setActive(i)} onClick={() => run(a)}>
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
