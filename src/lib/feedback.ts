import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';

export interface Toast {
  id: number;
  message: string;
  kind: 'info' | 'error';
}

export interface ConfirmRequest {
  title: string;
  body?: string;
  confirmLabel?: string;
  danger?: boolean;
  // must be typed to unlock the confirm button
  typeToConfirm?: string;
  resolve: (ok: boolean) => void;
}

let toasts: Toast[] = [];
let pending: ConfirmRequest | null = null;
let seq = 0;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());
const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};

export function dismissToast(id: number) {
  toasts = toasts.filter((t) => t.id !== id);
  emit();
}

export function toast(message: string, kind: Toast['kind'] = 'info') {
  const id = ++seq;
  toasts = [...toasts.slice(-3), { id, message, kind }];
  emit();
  setTimeout(() => dismissToast(id), kind === 'error' ? 7000 : 3500);
}

export const toastError = (e: unknown) => toast(e instanceof Error ? e.message : String(e), 'error');

// in-app replacement for `window.confirm`
export function confirmDialog(req: Omit<ConfirmRequest, 'resolve'>): Promise<boolean> {
  return new Promise((resolve) => {
    pending?.resolve(false);
    pending = { ...req, resolve };
    emit();
  });
}

export function settleConfirm(ok: boolean) {
  pending?.resolve(ok);
  pending = null;
  emit();
}

export const useToasts = () => useSyncExternalStore(subscribe, () => toasts);
export const useConfirmRequest = () => useSyncExternalStore(subscribe, () => pending);

// runs writes with a busy flag
export function useAction() {
  const [busy, setBusy] = useState(false);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  const run = useCallback(async <T>(fn: () => Promise<T>, done?: string): Promise<T | undefined> => {
    setBusy(true);
    try {
      const out = await fn();
      if (done) toast(done);
      return out;
    } catch (e) {
      toastError(e);
      return undefined;
    } finally {
      if (alive.current) setBusy(false);
    }
  }, []);
  return { busy, run };
}

const DRAFT_PREFIX = 'gittern.draft.';
const DRAFT_LIMIT = 60;

function readDraft(key: string): string {
  try {
    const raw = localStorage.getItem(DRAFT_PREFIX + key);
    return raw ? (JSON.parse(raw).text ?? '') : '';
  } catch {
    return '';
  }
}

function writeDraft(key: string, text: string) {
  try {
    if (!text) return localStorage.removeItem(DRAFT_PREFIX + key);
    localStorage.setItem(DRAFT_PREFIX + key, JSON.stringify({ text, at: Date.now() }));
    // keep only the newest drafts
    const keys = Object.keys(localStorage).filter((k) => k.startsWith(DRAFT_PREFIX));
    if (keys.length > DRAFT_LIMIT) {
      const aged = keys.map((k) => [k, JSON.parse(localStorage.getItem(k) ?? '{}').at ?? 0] as const).sort((a, b) => a[1] - b[1]);
      for (const [k] of aged.slice(0, keys.length - DRAFT_LIMIT)) localStorage.removeItem(k);
    }
  } catch {
    /* storage unavailable: the draft lives for this page only */
  }
}

// `useState` that persists under `key`
export function useDraft(key: string): [string, (v: string) => void, () => void] {
  const [text, setText] = useState(() => readDraft(key));
  const latest = useRef(text);
  useEffect(() => {
    const saved = readDraft(key);
    latest.current = saved;
    setText(saved);
  }, [key]);
  const set = useCallback(
    (v: string) => {
      latest.current = v;
      setText(v);
      writeDraft(key, v);
    },
    [key],
  );
  const clear = useCallback(() => set(''), [set]);
  return [text, set, clear];
}
