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
