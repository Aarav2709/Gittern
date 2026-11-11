import { useSyncExternalStore } from 'react';

/** Small locally-persisted repo lists that drive the sidebar. */
export interface RepoRef {
  full_name: string;
  avatar_url: string;
}

type Key = 'favorites' | 'recents';
const listeners = new Set<() => void>();
const cache: Partial<Record<Key, RepoRef[]>> = {};

function read(key: Key): RepoRef[] {
  if (!cache[key]) {
    try {
      cache[key] = JSON.parse(localStorage.getItem(`gittern.${key}`) ?? '[]');
    } catch {
      cache[key] = [];
    }
  }
  return cache[key]!;
}

function write(key: Key, value: RepoRef[]) {
  cache[key] = value;
  try {
    localStorage.setItem(`gittern.${key}`, JSON.stringify(value));
  } catch {
    /* storage unavailable: keep it for this session only */
  }
  listeners.forEach((l) => l());
}

const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};

export function useRepoList(key: Key): RepoRef[] {
  return useSyncExternalStore(subscribe, () => read(key));
}

export function visitRepo(repo: RepoRef) {
  const cur = read('recents');
  if (cur[0]?.full_name === repo.full_name) return;
  write('recents', [repo, ...cur.filter((r) => r.full_name !== repo.full_name)].slice(0, 6));
}

export function toggleFavorite(repo: RepoRef) {
  const cur = read('favorites');
  write(
    'favorites',
    cur.some((r) => r.full_name === repo.full_name)
      ? cur.filter((r) => r.full_name !== repo.full_name)
      : [...cur, repo],
  );
}

/* ── Workspace tabs ─────────────────────────────────────── */

export interface Tab {
  id: string;
  path: string;
}
interface TabState {
  tabs: Tab[];
  active: string;
}

let tabState: TabState | null = null;
const newId = () => Math.random().toString(36).slice(2, 10);

function readTabs(): TabState {
  if (!tabState) {
    try {
      const saved = JSON.parse(localStorage.getItem('gittern.tabs') ?? 'null') as TabState | null;
      if (saved?.tabs?.length && saved.tabs.some((t) => t.id === saved.active)) tabState = saved;
    } catch {
      /* fall through to a fresh workspace */
    }
    if (!tabState) {
      const id = newId();
      tabState = { tabs: [{ id, path: '/' }], active: id };
    }
  }
  return tabState;
}

function writeTabs(next: TabState) {
  tabState = next;
  try {
    localStorage.setItem('gittern.tabs', JSON.stringify(next));
  } catch {
    /* session only */
  }
  listeners.forEach((l) => l());
}

export function useTabs(): TabState {
  return useSyncExternalStore(subscribe, readTabs);
}

export const activeTabPath = () => {
  const s = readTabs();
  return s.tabs.find((t) => t.id === s.active)?.path ?? '/';
};

/** The active tab follows wherever the router goes. */
export function syncActivePath(path: string) {
  const s = readTabs();
  if (s.tabs.find((t) => t.id === s.active)?.path === path) return;
  writeTabs({ ...s, tabs: s.tabs.map((t) => (t.id === s.active ? { ...t, path } : t)) });
}

export function openTab(path: string, activate: boolean) {
  const s = readTabs();
  const tab = { id: newId(), path };
  const at = s.tabs.findIndex((t) => t.id === s.active) + 1;
  const tabs = [...s.tabs.slice(0, at), tab, ...s.tabs.slice(at)];
  writeTabs({ tabs, active: activate ? tab.id : s.active });
}

export function activateTab(id: string) {
  writeTabs({ ...readTabs(), active: id });
}

/** Returns the path to navigate to when the closed tab was the active one. */
export function closeTab(id: string): string | null {
  const s = readTabs();
  const i = s.tabs.findIndex((t) => t.id === id);
  if (i < 0) return null;
  const tabs = s.tabs.filter((t) => t.id !== id);
  if (!tabs.length) {
    const fresh = { id: newId(), path: '/' };
    writeTabs({ tabs: [fresh], active: fresh.id });
    return '/';
  }
  if (id !== s.active) {
    writeTabs({ tabs, active: s.active });
    return null;
  }
  const next = tabs[Math.min(i, tabs.length - 1)];
  writeTabs({ tabs, active: next.id });
  return next.path;
}
