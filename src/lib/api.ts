import { invoke } from '@tauri-apps/api/core';
import { QueryClient, useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { useMemo, useSyncExternalStore } from 'react';

export const isTauri = '__TAURI_INTERNALS__' in window;
// browser-only dev fallback (`VITE_GITHUB_TOKEN=… npm run dev`)
const DEV_TOKEN = import.meta.env.VITE_GITHUB_TOKEN as string | undefined;
export const hasDevToken = !!DEV_TOKEN;

// the github host this session talks to
let host = 'github.com';
export const ghHost = () => host;
export const setGhHost = (h: string) => {
  host = h || 'github.com';
};
// web address of a page on the signed-in host
export const webUrl = (path = '') => `https://${host}${path}`;

export interface Rate {
  limit: number | null;
  remaining: number | null;
  // unix seconds at which the window resets
  reset: number | null;
  resource: string | null;
  retry_after: number | null;
}

export class GhError extends Error {
  constructor(
    public status: number,
    message: string,
    public rateLimited = false,
  ) {
    super(message);
  }
}

export const ACCEPT = {
  json: 'application/vnd.github+json',
  html: 'application/vnd.github.html+json',
  full: 'application/vnd.github.full+json',
  raw: 'application/vnd.github.raw+json',
  diff: 'application/vnd.github.diff',
};

interface RawResponse {
  status: number;
  body: string;
  link: string | null;
  rate?: Rate;
  poll?: number | null;
}

export interface GhOptions {
  method?: string;
  body?: unknown;
  accept?: string;
  // return the response body as text instead of parsing json
  text?: boolean;
}

let lastRate: Rate | null = null;
const rateListeners = new Set<() => void>();
function noteRate(rate?: Rate) {
  // only the main rest budget is worth showing
  if (!rate || rate.remaining == null || (rate.resource && rate.resource !== 'core')) return;
  lastRate = rate;
  rateListeners.forEach((l) => l());
}
export function useRate(): Rate | null {
  return useSyncExternalStore(
    (l) => {
      rateListeners.add(l);
      return () => rateListeners.delete(l);
    },
    () => lastRate,
  );
}

const clock = (unix: number) => new Date(unix * 1000).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });

// turns an error response into a message a person can act on
export function describeFailure(r: Pick<RawResponse, 'status' | 'body' | 'rate'>): GhError {
  let message = `GitHub returned ${r.status}`;
  let detail = '';
  try {
    const json = JSON.parse(r.body);
    message = json.message ?? message;
    const first = json.errors?.[0];
    detail = typeof first === 'string' ? first : (first?.message ?? '');
  } catch {
    /* non-JSON error body */
  }
  const rate = r.rate;
  if ((r.status === 403 || r.status === 429) && rate) {
    if (rate.remaining === 0 && rate.reset) {
      return new GhError(r.status, `GitHub's rate limit is used up. It resets at ${clock(rate.reset)}.`, true);
    }
    if (rate.retry_after != null) {
      return new GhError(r.status, `GitHub asked to slow down. Try again in ${rate.retry_after} seconds.`, true);
    }
  }
  return new GhError(r.status, detail && detail !== message ? `${message}: ${detail}` : message);
}

async function send(path: string, o: GhOptions): Promise<RawResponse> {
  const method = o.method ?? 'GET';
  if (isTauri) {
    try {
      return await invoke<RawResponse>('github_request', {
        method,
        path,
        body: o.body ?? null,
        accept: o.accept ?? null,
      });
    } catch (e) {
      throw new GhError(0, String(e));
    }
  }
  const headers: Record<string, string> = { Accept: o.accept ?? ACCEPT.json };
  if (DEV_TOKEN) headers.Authorization = `Bearer ${DEV_TOKEN}`;
  if (o.body !== undefined) headers['Content-Type'] = 'application/json';
  const res = await fetch('https://api.github.com' + path, {
    method,
    headers,
    body: o.body !== undefined ? JSON.stringify(o.body) : undefined,
  });
  const num = (name: string) => (res.headers.has(name) ? Number(res.headers.get(name)) : null);
  return {
    status: res.status,
    body: await res.text(),
    link: res.headers.get('link'),
    rate: {
      limit: num('x-ratelimit-limit'),
      remaining: num('x-ratelimit-remaining'),
      reset: num('x-ratelimit-reset'),
      resource: res.headers.get('x-ratelimit-resource'),
      retry_after: num('retry-after'),
    },
  };
}

export async function ghRaw(path: string, o: GhOptions = {}): Promise<RawResponse> {
  const r = await send(path, o);
  noteRate(r.rate);
  if (r.status >= 400) throw describeFailure(r);
  return r;
}

export async function gh<T = any>(path: string, o: GhOptions = {}): Promise<T> {
  const r = await ghRaw(path, o);
  if (o.text) return r.body as T;
  return (r.body ? JSON.parse(r.body) : null) as T;
}

export async function gql<T = any>(query: string, variables: Record<string, unknown> = {}): Promise<T> {
  const r = await gh<{ data?: T; errors?: { message: string }[] }>('/graphql', {
    method: 'POST',
    body: { query, variables },
  });
  if (r.errors?.length && !r.data) throw new GhError(400, r.errors[0].message);
  if (!r.data) throw new GhError(400, 'GraphQL error');
  return r.data;
}

export function nextLink(link: string | null): string | undefined {
  const m = link && /<([^>]+)>;\s*rel="next"/.exec(link);
  if (!m) return undefined;
  try {
    const u = new URL(m[1]);
    // enterprise serves rest under /api/v3
    return u.pathname.replace(/^\/api\/v3/, '') + u.search;
  } catch {
    return undefined;
  }
}

// every page of a list, up to `maxPages`
export async function ghAll<T = any>(path: string, maxPages = 10, pick?: (d: any) => T[]): Promise<{ items: T[]; truncated: boolean }> {
  const items: T[] = [];
  let next: string | undefined = path;
  for (let page = 0; next && page < maxPages; page++) {
    const r: RawResponse = await ghRaw(next);
    const data = JSON.parse(r.body);
    items.push(...(pick ? pick(data) : data));
    next = nextLink(r.link);
  }
  return { items, truncated: !!next };
}

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 60_000,
      // retry transport failures (status 0) and server errors
      retry: (count, err) => {
        const status = (err as GhError).status;
        return (status === 0 || status >= 500) && count < 2;
      },
    },
  },
});

type MaybePath = string | null | false | undefined;

type Interval = number | false | ((query: { state: { data?: any } }) => number | false);

export function useGh<T = any>(path: MaybePath, o?: Pick<GhOptions, 'accept' | 'text'> & { refetchInterval?: Interval; staleTime?: number }) {
  return useQuery<T, GhError>({
    queryKey: ['gh', path, o?.accept ?? ''],
    queryFn: () => gh<T>(path as string, o),
    enabled: !!path,
    refetchInterval: o?.refetchInterval as any,
    staleTime: o?.staleTime,
  });
}

// a whole list, following pagination
export function useGhAll<T = any>(path: MaybePath, maxPages = 10) {
  const q = useQuery<{ items: T[]; truncated: boolean }, GhError>({
    queryKey: ['gha', path, maxPages],
    queryFn: () => ghAll<T>(path as string, maxPages),
    enabled: !!path,
  });
  return { ...q, items: q.data?.items ?? [], truncated: !!q.data?.truncated };
}

export function useGql<T = any>(key: string, query: string, variables: Record<string, unknown>, enabled = true) {
  return useQuery<T, GhError>({
    queryKey: ['gql', key, variables],
    queryFn: () => gql<T>(query, variables),
    enabled,
  });
}

// paginated list following github's `link
export function useGhPages<T = any>(path: MaybePath, o?: { accept?: string; pick?: (d: any) => T[] }) {
  const q = useInfiniteQuery<{ items: T[]; total?: number; next?: string }, GhError>({
    queryKey: ['ghp', path, o?.accept ?? ''],
    enabled: !!path,
    initialPageParam: path || '',
    queryFn: async ({ pageParam }) => {
      const r = await ghRaw(pageParam as string, { accept: o?.accept });
      const data = JSON.parse(r.body);
      return { items: o?.pick ? o.pick(data) : data, total: data?.total_count, next: nextLink(r.link) };
    },
    getNextPageParam: (last) => last.next,
  });
  const items = useMemo(() => q.data?.pages.flatMap((p) => p.items) ?? [], [q.data]);
  return { ...q, items, total: q.data?.pages[0]?.total };
}

// cursor-paginated graphql connection
export function useGqlPages<T = any>(
  key: string,
  query: string,
  variables: Record<string, unknown>,
  pick: (d: any) => { nodes: T[]; pageInfo: { hasNextPage: boolean; endCursor: string | null }; totalCount?: number } | null | undefined,
  enabled = true,
) {
  const q = useInfiniteQuery<{ items: T[]; next?: string; total?: number; raw: any }, GhError>({
    queryKey: ['gqlp', key, variables],
    enabled,
    initialPageParam: null as string | null,
    queryFn: async ({ pageParam }) => {
      const raw = await gql<any>(query, { ...variables, after: pageParam });
      const conn = pick(raw);
      return {
        items: (conn?.nodes ?? []).filter(Boolean),
        next: conn?.pageInfo.hasNextPage ? (conn.pageInfo.endCursor ?? undefined) : undefined,
        total: conn?.totalCount,
        raw,
      };
    },
    getNextPageParam: (last) => last.next,
  });
  const items = useMemo(() => q.data?.pages.flatMap((p) => p.items) ?? [], [q.data]);
  return { ...q, items, total: q.data?.pages[0]?.total, first: q.data?.pages[0]?.raw };
}

// refetch everything under a rest path prefix
export function invalidate(prefix: string) {
  return queryClient.invalidateQueries({
    predicate: (q) => typeof q.queryKey[1] === 'string' && (q.queryKey[1] as string).startsWith(prefix),
  });
}

// refetch graphql queries registered under `key`
export function invalidateGql(key: string) {
  return queryClient.invalidateQueries({ predicate: (q) => (q.queryKey[0] === 'gql' || q.queryKey[0] === 'gqlp') && q.queryKey[1] === key });
}
