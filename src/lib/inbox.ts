import { useEffect } from 'react';
import { ghHost, isTauri, useGhAll, useGh } from './api';
import { getPref } from './store';
import type { NotificationThread } from './types';

const SEEN_KEY = 'gittern.seen-notifications';

function readSeen(): Set<string> | null {
  try {
    const raw = localStorage.getItem(SEEN_KEY);
    return raw ? new Set(JSON.parse(raw)) : null;
  } catch {
    return null;
  }
}

async function notify(title: string, body: string) {
  if (!isTauri) return;
  try {
    const n = await import('@tauri-apps/plugin-notification');
    let ok = await n.isPermissionGranted();
    if (!ok) ok = (await n.requestPermission()) === 'granted';
    if (ok) n.sendNotification({ title, body });
  } catch {
    // no notification service on this system
  }
}

// which threads are new since the last look
export function newThreads<T extends { id: string; updated_at: string }>(items: T[], seen: Set<string> | null) {
  const key = (n: T) => `${n.id}@${n.updated_at}`;
  return { fresh: seen ? items.filter((n) => !seen.has(key(n))) : [], keys: items.map(key) };
}

// poll unread notifications; notify on new ones
export function useInbox() {
  const q = useGhAll<NotificationThread>('/notifications?per_page=50', 4);
  // unchanged answers are 304s and cost nothing
  useEffect(() => {
    const t = setInterval(() => void q.refetch(), 60_000);
    return () => clearInterval(t);
  }, [q.refetch]);

  useEffect(() => {
    if (!q.data) return;
    const { fresh, keys } = newThreads(q.items, readSeen());
    try {
      localStorage.setItem(SEEN_KEY, JSON.stringify(keys));
    } catch {
      // session only
    }
    if (!fresh.length || getPref('desktop-notifications', 'on') !== 'on' || document.hasFocus()) return;
    if (fresh.length === 1) void notify(fresh[0].repository.full_name, fresh[0].subject.title);
    else void notify('Gittern', `${fresh.length} new notifications`);
  }, [q.data]);

  return { count: q.items.length, more: q.truncated };
}

// newer release of gittern itself, if there is one
export function useUpdate(): { version: string; url: string } | null {
  const latest = useGh<{ tag_name: string; html_url: string }>(ghHost() === 'github.com' && getPref('update-check', 'on') === 'on' && '/repos/Aarav2709/Gittern/releases/latest', {
    staleTime: 6 * 3600_000,
  });
  if (!latest.data) return null;
  return isNewer(latest.data.tag_name, __APP_VERSION__) ? { version: latest.data.tag_name.replace(/^v/, ''), url: latest.data.html_url } : null;
}

export function isNewer(candidate: string, current: string): boolean {
  const parts = (v: string) => v.replace(/^v/, '').split(/[.-]/).map((p) => parseInt(p, 10) || 0);
  const a = parts(candidate);
  const b = parts(current);
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    if ((a[i] ?? 0) !== (b[i] ?? 0)) return (a[i] ?? 0) > (b[i] ?? 0);
  }
  return false;
}
