import { invoke } from '@tauri-apps/api/core';
import { QueryClient, useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';

export const isTauri = '__TAURI_INTERNALS__' in window;
/** Browser-only dev fallback (`VITE_GITHUB_TOKEN=… npm run dev`). Unused in the app. */
const DEV_TOKEN = import.meta.env.VITE_GITHUB_TOKEN as string | undefined;
export const hasDevToken = !!DEV_TOKEN;

export class GhError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

export const ACCEPT = {
  json: 'application/vnd.github+json',
  html: 'application/vnd.github.html+json',
  full: 'application/vnd.github.full+json',
  raw: 'application/vnd.github.raw+json',
};

interface RawResponse {
  status: number;
  body: string;
  link: string | null;
}

export interface GhOptions {
  method?: string;
  body?: unknown;
  accept?: string;
  /** Return the response body as text instead of parsing JSON. */
  text?: boolean;
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
  return { status: res.status, body: await res.text(), link: res.headers.get('link') };
}

export async function ghRaw(path: string, o: GhOptions = {}): Promise<RawResponse> {
  const r = await send(path, o);
  if (r.status >= 400) {
    let message = `GitHub returned ${r.status}`;
    try {
      message = JSON.parse(r.body).message ?? message;
    } catch {
      /* non-JSON error body */
    }
    throw new GhError(r.status, message);
  }
  return r;
}

export async function gh<T = any>(path: string, o: GhOptions = {}): Promise<T> {
  const r = await ghRaw(path, o);
  if (o.text) return r.body as T;
  return (r.body ? JSON.parse(r.body) : null) as T;
}

export async function gql<T = any>(query: string, variables: Record<string, unknown>): Promise<T> {
  const r = await gh<{ data?: T; errors?: { message: string }[] }>('/graphql', {
    method: 'POST',
    body: { query, variables },
  });
  if (!r.data) throw new GhError(400, r.errors?.[0]?.message ?? 'GraphQL error');
  return r.data;
}

function nextLink(link: string | null): string | undefined {
  const m = link && /<([^>]+)>;\s*rel="next"/.exec(link);
  return m ? m[1].replace('https://api.github.com', '') : undefined;
}

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 60_000,
      // Retry transport failures (status 0) and server errors; 4xx answers are final.
      retry: (count, err) => {
        const status = (err as GhError).status;
        return (status === 0 || status >= 500) && count < 2;
      },
    },
  },
});

type MaybePath = string | null | false | undefined;

type Interval = number | false | ((query: { state: { data?: any } }) => number | false);

export function useGh<T = any>(path: MaybePath, o?: Pick<GhOptions, 'accept' | 'text'> & { refetchInterval?: Interval }) {
  return useQuery<T, GhError>({
    queryKey: ['gh', path, o?.accept ?? ''],
    queryFn: () => gh<T>(path as string, o),
    enabled: !!path,
    refetchInterval: o?.refetchInterval as any,
  });
}

export function useGql<T = any>(key: string, query: string, variables: Record<string, unknown>, enabled = true) {
  return useQuery<T, GhError>({
    queryKey: ['gql', key, variables],
    queryFn: () => gql<T>(query, variables),
    enabled,
  });
}

/** Paginated list following GitHub's `Link: rel="next"` header. */
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

/** Refetch everything matching a REST path prefix (both single and paged queries). */
export function invalidate(prefix: string) {
  return queryClient.invalidateQueries({
    predicate: (q) => typeof q.queryKey[1] === 'string' && (q.queryKey[1] as string).startsWith(prefix),
  });
}
