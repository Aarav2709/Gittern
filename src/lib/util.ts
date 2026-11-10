import { openUrl } from '@tauri-apps/plugin-opener';
import { isTauri } from './api';

export function timeAgo(iso: string): string {
  const s = (Date.now() - new Date(iso).getTime()) / 1000;
  const units: [number, string][] = [
    [31557600, 'year'],
    [2629800, 'month'],
    [604800, 'week'],
    [86400, 'day'],
    [3600, 'hour'],
    [60, 'minute'],
  ];
  for (const [secs, name] of units) {
    if (s >= secs) {
      const n = Math.floor(s / secs);
      return `${n} ${name}${n > 1 ? 's' : ''} ago`;
    }
  }
  return 'just now';
}

export const fullDate = (iso: string) =>
  new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });

const compactFmt = Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 });
export const compact = (n: number) => compactFmt.format(n ?? 0);

export const encPath = (p: string) => p.split('/').map(encodeURIComponent).join('/');

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

export function openExternal(url: string) {
  if (isTauri) void openUrl(url);
  else window.open(url, '_blank', 'noopener');
}

export async function copyText(text: string) {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    /* clipboard unavailable */
  }
}

const REPO_SECTIONS = new Set(['tree', 'blob', 'issues', 'pulls', 'pull', 'commits', 'commit', 'actions', 'releases']);
const TOP_LEVEL = new Set(['notifications', 'pulls', 'issues', 'search']);
/** github.com first path segments that are site pages, not users/orgs. */
const RESERVED = new Set([
  'settings', 'marketplace', 'sponsors', 'features', 'orgs', 'apps', 'topics', 'collections', 'trending',
  'explore', 'login', 'logout', 'about', 'pricing', 'enterprise', 'security', 'site', 'contact', 'new',
  'codespaces', 'organizations', 'users', 'events', 'account', 'join', 'signup', 'customer-stories',
  'readme', 'team', 'solutions', 'resources', 'discussions', 'stars', 'watching', 'dashboard', 'copilot',
  'github-copilot', 'mobile', 'premium-support', 'sessions', 'password_reset', 'user-attachments', 'assets',
]);

/**
 * Maps a github.com / api.github.com URL to an in-app route, or null when the
 * page isn't something Gittern renders (those open in the system browser).
 */
export function routeFromUrl(href: string): string | null {
  let u: URL;
  try {
    u = new URL(href);
  } catch {
    return null;
  }
  if (u.hostname === 'api.github.com') {
    const m = /^\/repos\/([^/]+)\/([^/]+)(?:\/(issues|pulls|commits)\/([^/]+))?$/.exec(u.pathname);
    if (!m) return null;
    if (!m[3]) return `/${m[1]}/${m[2]}`;
    const section = { issues: 'issues', pulls: 'pull', commits: 'commit' }[m[3]];
    return `/${m[1]}/${m[2]}/${section}/${m[4]}`;
  }
  if (u.hostname !== 'github.com' && u.hostname !== 'www.github.com') return null;
  const seg = u.pathname.split('/').filter(Boolean);
  if (seg.length === 0) return '/';
  if (TOP_LEVEL.has(seg[0])) return seg.length === 1 ? u.pathname + u.search : null;
  if (RESERVED.has(seg[0])) return null;
  if (seg.length === 1) return `/${seg[0]}${u.search}`;
  if (seg.length === 2) return `/${seg[0]}/${seg[1]}`;
  const [owner, repo, section, ...rest] = seg;
  if (!REPO_SECTIONS.has(section)) return null;
  const base = `/${owner}/${repo}/${section}`;
  switch (section) {
    case 'actions':
    case 'releases':
      return rest.length ? null : base;
    case 'issues':
      return rest.length === 0 ? base + u.search : /^\d+$/.test(rest[0]) ? `${base}/${rest[0]}` : null;
    case 'pull':
      if (!/^\d+$/.test(rest[0] ?? '')) return null;
      return `${base}/${rest[0]}${rest[1] === 'files' ? '/files' : ''}`;
    case 'pulls':
      return rest.length ? null : base + u.search;
    default:
      return rest.length ? `${base}/${rest.join('/')}` : section === 'commits' ? base : null;
  }
}
