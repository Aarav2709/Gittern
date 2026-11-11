import { useSyncExternalStore } from 'react';

// locally persisted repo lists for the sidebar
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
    // session only
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

// workspace tabs

export interface Tab {
  id: string;
  path: string;
  hist: string[];
  idx: number;
}
interface TabState {
  tabs: Tab[];
  active: string;
}

const HIST_LIMIT = 50;
let tabState: TabState | null = null;
// a navigation the store asked for itself
let expected: string | null = null;
const closed: Tab[] = [];
const scrolls = new Map<string, number>();
const newId = () => Math.random().toString(36).slice(2, 10);
const freshTab = (path: string): Tab => ({ id: newId(), path, hist: [path], idx: 0 });

function readTabs(): TabState {
  if (!tabState) {
    try {
      const saved = JSON.parse(localStorage.getItem('gittern.tabs') ?? 'null') as TabState | null;
      if (saved?.tabs?.length && saved.tabs.some((t) => t.id === saved.active)) {
        tabState = { ...saved, tabs: saved.tabs.map((t) => (t.hist?.length ? t : { ...t, hist: [t.path], idx: 0 })) };
      }
    } catch {
      // fall through to a fresh workspace
    }
    if (!tabState) {
      const tab = freshTab('/');
      tabState = { tabs: [tab], active: tab.id };
    }
  }
  return tabState;
}

function writeTabs(next: TabState) {
  tabState = next;
  try {
    localStorage.setItem('gittern.tabs', JSON.stringify(next));
  } catch {
    // session only
  }
  listeners.forEach((l) => l());
}

const activeTab = (s = readTabs()) => s.tabs.find((t) => t.id === s.active)!;
const patchActive = (s: TabState, change: (t: Tab) => Tab): TabState => ({ ...s, tabs: s.tabs.map((t) => (t.id === s.active ? change(t) : t)) });

export function useTabs(): TabState {
  return useSyncExternalStore(subscribe, readTabs);
}

export const activeTabPath = () => activeTab().path;

// called on every route change
export function recordNav(path: string, replace: boolean): boolean {
  const s = readTabs();
  const tab = activeTab(s);
  if (expected === path) {
    expected = null;
    if (tab.path !== path) writeTabs(patchActive(s, (t) => ({ ...t, path })));
    return true;
  }
  expected = null;
  if (tab.path === path) return false;
  writeTabs(
    patchActive(s, (t) => {
      const kept = t.hist.slice(0, replace ? t.idx : t.idx + 1);
      const hist = [...kept, path].slice(-HIST_LIMIT);
      return { ...t, path, hist, idx: hist.length - 1 };
    }),
  );
  return false;
}

// moves the active tab back or forward
export function tabStep(delta: -1 | 1): string | null {
  const s = readTabs();
  const tab = activeTab(s);
  const idx = tab.idx + delta;
  if (idx < 0 || idx >= tab.hist.length) return null;
  expected = tab.hist[idx];
  writeTabs(patchActive(s, (t) => ({ ...t, idx, path: t.hist[idx] })));
  return expected;
}

export const scrollKey = () => {
  const t = activeTab();
  return `${t.id}:${t.idx}`;
};
export const saveScroll = (key: string, top: number) => void scrolls.set(key, top);
export const savedScroll = (key: string) => scrolls.get(key) ?? 0;

export function openTab(path: string, activate: boolean) {
  const s = readTabs();
  const tab = freshTab(path);
  const at = s.tabs.findIndex((t) => t.id === s.active) + 1;
  const tabs = [...s.tabs.slice(0, at), tab, ...s.tabs.slice(at)];
  if (activate) expected = path;
  writeTabs({ tabs, active: activate ? tab.id : s.active });
}

// returns the path to navigate to
export function activateTab(id: string): string | null {
  const s = readTabs();
  const tab = s.tabs.find((t) => t.id === id);
  if (!tab || id === s.active) return null;
  expected = tab.path;
  writeTabs({ ...s, active: id });
  return tab.path;
}

// returns the path to show next, if any
export function closeTab(id: string): string | null {
  const s = readTabs();
  const i = s.tabs.findIndex((t) => t.id === id);
  if (i < 0) return null;
  closed.push(s.tabs[i]);
  const tabs = s.tabs.filter((t) => t.id !== id);
  if (!tabs.length) {
    const fresh = freshTab('/');
    expected = '/';
    writeTabs({ tabs: [fresh], active: fresh.id });
    return '/';
  }
  if (id !== s.active) {
    writeTabs({ tabs, active: s.active });
    return null;
  }
  const next = tabs[Math.min(i, tabs.length - 1)];
  expected = next.path;
  writeTabs({ tabs, active: next.id });
  return next.path;
}

export function closeOtherTabs(id: string) {
  const s = readTabs();
  const keep = s.tabs.find((t) => t.id === id);
  if (!keep) return null;
  closed.push(...s.tabs.filter((t) => t.id !== id));
  const switched = s.active !== id;
  if (switched) expected = keep.path;
  writeTabs({ tabs: [keep], active: id });
  return switched ? keep.path : null;
}

// brings back the most recently closed tab
export function reopenTab(): string | null {
  const tab = closed.pop();
  if (!tab) return null;
  const s = readTabs();
  expected = tab.path;
  writeTabs({ tabs: [...s.tabs, tab], active: tab.id });
  return tab.path;
}

// cycles to the next or previous tab, or jumps to the nth
export function tabAt(pick: (index: number, count: number) => number): string | null {
  const s = readTabs();
  const i = s.tabs.findIndex((t) => t.id === s.active);
  const next = s.tabs[(pick(i, s.tabs.length) + s.tabs.length) % s.tabs.length];
  return next ? activateTab(next.id) : null;
}

// small persisted preferences

const prefListeners = new Set<() => void>();
const prefCache = new Map<string, string>();

export function getPref(key: string, fallback: string): string {
  if (!prefCache.has(key)) {
    let v = fallback;
    try {
      v = localStorage.getItem(`gittern.pref.${key}`) ?? fallback;
    } catch {
      // storage unavailable
    }
    prefCache.set(key, v);
  }
  return prefCache.get(key)!;
}

export function setPref(key: string, value: string) {
  prefCache.set(key, value);
  try {
    localStorage.setItem(`gittern.pref.${key}`, value);
  } catch {
    // session only
  }
  prefListeners.forEach((l) => l());
}

export function usePref(key: string, fallback: string): [string, (v: string) => void] {
  const value = useSyncExternalStore(
    (l) => {
      prefListeners.add(l);
      return () => prefListeners.delete(l);
    },
    () => getPref(key, fallback),
  );
  return [value, (v) => setPref(key, v)];
}
