import { openUrl } from '@tauri-apps/plugin-opener';
import { ghHost, isTauri } from './api';

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

// compact age for dense lists
export function shortAgo(iso: string): string {
  const m = Math.max(0, (Date.now() - new Date(iso).getTime()) / 60000);
  if (m < 1) return 'now';
  if (m < 60) return `${Math.floor(m)}m`;
  if (m < 1440) return `${Math.floor(m / 60)}h`;
  if (m < 10080) return `${Math.floor(m / 1440)}d`;
  if (m < 43830) return `${Math.floor(m / 10080)}w`;
  if (m < 525960) return `${Math.floor(m / 43830)}mo`;
  return `${Math.floor(m / 525960)}y`;
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

const REPO_SECTIONS = new Set([
  'tree', 'blob', 'blame', 'issues', 'pulls', 'pull', 'commits', 'commit', 'actions', 'releases', 'branches', 'tags', 'compare', 'settings',
  'discussions', 'labels', 'milestones', 'milestone', 'forks', 'stargazers', 'watchers', 'projects', 'security', 'pulse', 'graphs',
  'network', 'deployments', 'search',
]);
const TOP_LEVEL = new Set(['notifications', 'pulls', 'issues', 'search', 'new', 'explore', 'settings', 'trending']);
// github.com first path segments that are site pages, not users/orgs
const RESERVED = new Set([
  'marketplace', 'sponsors', 'features', 'orgs', 'apps', 'topics', 'collections',
  'login', 'logout', 'about', 'pricing', 'enterprise', 'security', 'site', 'contact',
  'codespaces', 'organizations', 'users', 'events', 'account', 'join', 'signup', 'customer-stories',
  'readme', 'team', 'solutions', 'resources', 'discussions', 'stars', 'watching', 'dashboard', 'copilot',
  'github-copilot', 'mobile', 'premium-support', 'sessions', 'password_reset', 'user-attachments', 'assets',
]);

// `#L10` or `#L10-L20` at the end of a file link
const lineHash = (hash: string) => (/^#L\d+(-L\d+)?$/.test(hash) ? hash : '');

// github url to in-app route; null opens the browser
export function routeFromUrl(href: string, host = ghHost()): string | null {
  let u: URL;
  try {
    u = new URL(href);
  } catch {
    return null;
  }
  const apiPath =
    u.hostname === 'api.github.com' ? u.pathname : u.host === host && u.pathname.startsWith('/api/v3/') ? u.pathname.slice('/api/v3'.length) : null;
  if (apiPath !== null) {
    const m = /^\/repos\/([^/]+)\/([^/]+)(?:\/(issues|pulls|commits|discussions|releases)\/([^/]+))?$/.exec(apiPath);
    if (!m) return null;
    if (!m[3]) return `/${m[1]}/${m[2]}`;
    if (m[3] === 'releases') return `/${m[1]}/${m[2]}/releases`;
    const section = { issues: 'issues', pulls: 'pull', commits: 'commit', discussions: 'discussions' }[m[3]];
    return `/${m[1]}/${m[2]}/${section}/${m[4]}`;
  }
  if (host === 'github.com' && u.hostname === 'gist.github.com') {
    const seg = u.pathname.split('/').filter(Boolean);
    if (seg.length === 0) return '/gists';
    const id = seg.at(-1)!;
    return /^[0-9a-f]{20,}$/i.test(id) ? `/gist/${id}` : null;
  }
  if (u.host !== host && u.host !== `www.${host}`) return null;
  const seg = u.pathname.split('/').filter(Boolean);
  if (seg.length === 0) return '/';
  if (seg[0] === 'trending') return '/explore';
  if (seg[0] === 'settings') return seg.length <= 2 ? '/settings' : null;
  if (seg[0] === 'topics' && seg.length === 2) return `/search?q=${encodeURIComponent('topic:' + seg[1])}`;
  if (seg[0] === 'orgs' && seg.length >= 2) {
    if (seg.length === 2) return `/${seg[1]}`;
    if (seg[2] === 'people') return `/${seg[1]}?tab=people`;
    if (seg[2] === 'teams' && seg.length === 3) return `/${seg[1]}?tab=teams`;
    if (seg[2] === 'repositories') return `/${seg[1]}?tab=repositories`;
    return null;
  }
  if (TOP_LEVEL.has(seg[0])) return seg.length === 1 ? u.pathname + u.search : null;
  if (RESERVED.has(seg[0])) return null;
  if (seg.length === 1) return `/${seg[0]}${u.search}`;
  if (seg.length === 2) return `/${seg[0]}/${seg[1]}`;
  const [owner, repo, section, ...rest] = seg;
  if (!REPO_SECTIONS.has(section)) return null;
  const base = `/${owner}/${repo}/${section}`;
  const num = /^\d+$/.test(rest[0] ?? '');
  switch (section) {
    case 'actions':
      if (rest[0] === 'runs' && /^\d+$/.test(rest[1] ?? '')) return `${base}/runs/${rest[1]}`;
      if (rest[0] === 'workflows' && rest[1]) return `${base}?workflow=${encodeURIComponent(rest[1])}`;
      return rest.length ? null : base;
    case 'releases':
      if (rest[0] === 'tag' && rest[1]) return `${base}/tag/${rest.slice(1).join('/')}`;
      if (rest[0] === 'new') return `${base}/new`;
      return rest.length ? null : base;
    case 'branches':
    case 'tags':
    case 'labels':
    case 'forks':
    case 'stargazers':
    case 'watchers':
    case 'deployments':
      return rest.length ? null : base;
    case 'network':
      return rest[0] === 'members' ? `/${owner}/${repo}/forks` : rest[0] === 'dependencies' ? `/${owner}/${repo}/insights?tab=dependencies` : null;
    case 'pulse':
    case 'graphs':
      return `/${owner}/${repo}/insights`;
    case 'settings':
      return rest.length <= 1 ? base + (rest[0] ? `?tab=${rest[0]}` : '') : null;
    case 'security':
      return rest.length <= 1 ? base + (rest[0] ? `?tab=${rest[0]}` : '') : null;
    case 'search':
      return base + u.search;
    case 'compare':
      return rest.length ? `${base}/${rest.join('/')}` : base;
    case 'milestones':
      return rest.length ? null : base;
    case 'milestone':
      return num ? `${base}/${rest[0]}` : null;
    case 'projects':
      return rest.length === 0 ? base : num && rest.length === 1 ? `${base}/${rest[0]}` : null;
    case 'discussions':
      if (rest[0] === 'new') return `${base}/new`;
      return rest.length === 0 ? base + u.search : num ? `${base}/${rest[0]}` : null;
    case 'issues':
      if (rest[0] === 'new') return `${base}/new`;
      return rest.length === 0 ? base + u.search : num ? `${base}/${rest[0]}` : null;
    case 'pull': {
      if (!num) return null;
      const tab = ['files', 'commits', 'checks'].includes(rest[1]) ? `/${rest[1]}` : '';
      return `${base}/${rest[0]}${tab}`;
    }
    case 'pulls':
      return rest.length ? null : base + u.search;
    case 'blob':
    case 'blame':
      return rest.length ? `${base}/${rest.join('/')}${lineHash(u.hash)}` : null;
    default:
      return rest.length ? `${base}/${rest.join('/')}` : section === 'commits' ? base : null;
  }
}

// parses `#L10` / `#L10-L20` into an inclusive range
export function parseLineHash(hash: string): [number, number] | null {
  const m = /^#?L(\d+)(?:-L(\d+))?$/.exec(hash);
  if (!m) return null;
  const a = +m[1];
  const b = m[2] ? +m[2] : a;
  return [Math.min(a, b), Math.max(a, b)];
}

// subsequence-friendly ranking for quick pickers
export function fuzzyScore(candidate: string, query: string): number {
  const lower = candidate.toLowerCase();
  const q = query.toLowerCase();
  if (!q) return 0;
  const base = lower.slice(lower.lastIndexOf('/') + 1);
  if (base.startsWith(q)) return 0;
  if (base.includes(q)) return 1;
  if (lower.includes(q)) return 2;
  let i = 0;
  for (const ch of lower) if (ch === q[i]) i++;
  return i === q.length ? 3 : -1;
}

export const plural = (n: number, word: string, many = word + 's') => `${n.toLocaleString()} ${n === 1 ? word : many}`;

export function duration(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m ${s % 60}s`;
  return `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`;
}
