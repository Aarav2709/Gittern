import {
  ArrowLeftIcon,
  ArrowRightIcon,
  BellIcon,
  GitPullRequestIcon,
  HomeIcon,
  IssueOpenedIcon,
  LinkExternalIcon,
  PersonIcon,
  RepoIcon,
  SearchIcon,
  SyncIcon,
} from '@primer/octicons-react';
import { useIsFetching } from '@tanstack/react-query';
import { type ReactNode, useEffect, useMemo, useRef, useState } from 'react';
import { Link, Outlet, useLocation, useNavigate, useNavigationType } from 'react-router-dom';
import { queryClient, useGh } from '../lib/api';
import { useAuth } from '../lib/auth';
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
function storedTheme(): Theme {
  try {
    return (localStorage.getItem('theme') as Theme) || 'system';
  } catch {
    return 'system';
  }
}
applyTheme(storedTheme());

const PAGE_TITLES: Record<string, string> = {
  notifications: 'Notifications',
  pulls: 'Pull requests',
  issues: 'Issues',
  search: 'Search',
};

function Crumbs() {
  const seg = useLocation().pathname.split('/').filter(Boolean);
  if (seg.length === 0) return <span className="crumb current">Dashboard</span>;
  if (seg.length === 1 && PAGE_TITLES[seg[0]]) return <span className="crumb current">{PAGE_TITLES[seg[0]]}</span>;
  return (
    <>
      <Link className={`crumb ${seg.length === 1 ? 'current' : ''}`} to={`/${seg[0]}`}>
        {seg[0]}
      </Link>
      {seg[1] && (
        <>
          <span className="crumb-sep">/</span>
          <Link className="crumb current" to={`/${seg[0]}/${seg[1]}`}>
            {seg[1]}
          </Link>
        </>
      )}
    </>
  );
}

export function Shell() {
  const { viewer, source, signOut } = useAuth();
  const navigate = useNavigate();
  const loc = useLocation();
  const navType = useNavigationType();
  const [palette, setPalette] = useState(false);
  const [theme, setTheme] = useState<Theme>(storedTheme);
  const fetching = useIsFetching() > 0;
  const unread = useGh<any[]>('/notifications?per_page=1', { refetchInterval: 60_000 });

  // New navigations start at the top; back/forward keep the browser's restored position.
  useEffect(() => {
    if (navType !== 'POP') window.scrollTo(0, 0);
    setPalette(false);
  }, [loc.pathname, loc.search, navType]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.ctrlKey || e.metaKey;
      const typing = /^(INPUT|TEXTAREA|SELECT)$/.test((e.target as HTMLElement).tagName);
      if ((mod && e.key.toLowerCase() === 'k') || (e.key === '/' && !typing)) {
        e.preventDefault();
        setPalette(true);
      } else if (e.altKey && e.key === 'ArrowLeft') {
        e.preventDefault();
        navigate(-1);
      } else if (e.altKey && e.key === 'ArrowRight') {
        e.preventDefault();
        navigate(1);
      } else if ((mod && e.key.toLowerCase() === 'r') || e.key === 'F5') {
        e.preventDefault();
        void queryClient.invalidateQueries();
      }
    };
    // Markdown and API-provided links: route github.com URLs in-app, the rest to the system browser.
    const onClick = (e: MouseEvent) => {
      if (e.defaultPrevented || e.button !== 0) return;
      const a = (e.target as Element).closest?.('a');
      const href = a?.getAttribute('href');
      if (!href || href.startsWith('#/')) return;
      e.preventDefault();
      if (href.startsWith('#')) {
        const id = decodeURIComponent(href.slice(1));
        (document.getElementById('user-content-' + id) ?? document.getElementById(id))?.scrollIntoView({
          behavior: 'smooth',
        });
        return;
      }
      const route = a!.hasAttribute('data-external') ? null : routeFromUrl(href);
      if (route) navigate(route);
      else if (/^(https?|mailto):/.test(href)) openExternal(href);
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('click', onClick);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('click', onClick);
    };
  }, [navigate]);

  const cycleTheme = () => {
    const next: Theme = theme === 'system' ? 'dark' : theme === 'dark' ? 'light' : 'system';
    setTheme(next);
    applyTheme(next);
    try {
      localStorage.setItem('theme', next);
    } catch {
      /* storage unavailable */
    }
  };

  const canGoBack = (window.history.state?.idx ?? 0) > 0;

  return (
    <>
      <header className="topbar">
        <div className="nav-btns">
          <button className="icon-btn" disabled={!canGoBack} onClick={() => navigate(-1)} title="Back (Alt+←)">
            <ArrowLeftIcon />
          </button>
          <button className="icon-btn" onClick={() => navigate(1)} title="Forward (Alt+→)">
            <ArrowRightIcon />
          </button>
          <button
            className={`icon-btn ${fetching ? 'spinning' : ''}`}
            onClick={() => queryClient.invalidateQueries()}
            title="Refresh (Ctrl+R)"
          >
            <SyncIcon />
          </button>
        </div>
        <Link to="/" className="brand" title="Dashboard">
          <Logo />
        </Link>
        <div className="crumbs">
          <Crumbs />
        </div>
        <button className="search-trigger" onClick={() => setPalette(true)}>
          <SearchIcon size={14} />
          <span>Search or jump to…</span>
          <kbd>Ctrl K</kbd>
        </button>
        <div className="topbar-right">
          <Link className="icon-btn" to="/issues" title="Your issues">
            <IssueOpenedIcon />
          </Link>
          <Link className="icon-btn" to="/pulls" title="Your pull requests">
            <GitPullRequestIcon />
          </Link>
          <Link className="icon-btn" to="/notifications" title="Notifications">
            <BellIcon />
            {!!unread.data?.length && <span className="unread-dot" />}
          </Link>
          <Dropdown className="avatar-btn" align="right" trigger={<Avatar user={viewer} size={26} />}>
            {(close) => (
              <div className="menu" onClick={close}>
                <div className="menu-head">
                  <strong>{viewer.login}</strong>
                  {viewer.name && <span>{viewer.name}</span>}
                </div>
                <Link to={`/${viewer.login}`}>Your profile</Link>
                <Link to={`/${viewer.login}?tab=repositories`}>Your repositories</Link>
                <Link to={`/${viewer.login}?tab=stars`}>Your stars</Link>
                <hr />
                <button onClick={cycleTheme}>Theme: {theme}</button>
                <hr />
                {source === 'keyring' ? (
                  <button onClick={() => void signOut()}>Sign out</button>
                ) : (
                  <span className="menu-note">
                    Signed in via {source === 'gh-cli' ? 'GitHub CLI' : 'environment token'}
                  </span>
                )}
              </div>
            )}
          </Dropdown>
        </div>
      </header>
      <main>
        <Outlet />
      </main>
      {palette && <Palette onClose={() => setPalette(false)} />}
    </>
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
    debounced.length >= 2 && !debounced.includes('://') &&
      `/search/repositories?q=${encodeURIComponent(debounced)}&per_page=6`,
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
        { key: 'home', icon: <HomeIcon />, label: 'Dashboard', run: go('/') },
        { key: 'notif', icon: <BellIcon />, label: 'Notifications', run: go('/notifications') },
        { key: 'pulls', icon: <GitPullRequestIcon />, label: 'Your pull requests', run: go('/pulls') },
        { key: 'issues', icon: <IssueOpenedIcon />, label: 'Your issues', run: go('/issues') },
        { key: 'me', icon: <PersonIcon />, label: 'Your profile', run: go(`/${viewer.login}`) },
        ...(mine.data ?? []).slice(0, 6).map((r) => repoAction(r, 'Recent')),
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
    if (/^[\w.-]+\/[\w.-]+$/.test(q))
      out.push({ key: 'jump', icon: <RepoIcon />, label: q, hint: 'Jump to repository', run: go(`/${q}`) });
    else if (/^[\w-]+$/.test(q))
      out.push({ key: 'user', icon: <PersonIcon />, label: q, hint: 'Jump to user or org', run: go(`/${q}`) });
    const lower = q.toLowerCase();
    const seen = new Set<string>();
    for (const r of (mine.data ?? []).filter((r) => r.full_name.toLowerCase().includes(lower)).slice(0, 5)) {
      seen.add(r.full_name);
      out.push(repoAction(r, 'Yours'));
    }
    for (const r of found.data?.items ?? []) if (!seen.has(r.full_name)) out.push(repoAction(r, 'Repository'));
    out.push({
      key: 'search',
      icon: <SearchIcon />,
      label: `Search GitHub for “${q}”`,
      run: go(`/search?q=${encodeURIComponent(q)}`),
    });
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
            <button
              key={a.key}
              className={i === active ? 'active' : ''}
              onMouseEnter={() => setActive(i)}
              onClick={() => run(a)}
            >
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
