import { invoke } from '@tauri-apps/api/core';
import { createContext, type ReactNode, useCallback, useContext, useEffect, useState } from 'react';
import { hasDevToken, isTauri, queryClient, useGh } from './api';

export type AuthSource = 'keyring' | 'env' | 'gh-cli' | null;

interface Auth {
  viewer: any;
  source: AuthSource;
  signIn: (token: string) => Promise<string | null>;
  signOut: () => Promise<void>;
}

const Ctx = createContext<Auth | null>(null);

export function useAuth(): Auth {
  const a = useContext(Ctx);
  if (!a) throw new Error('useAuth outside AuthProvider');
  return a;
}

export function AuthProvider({
  children,
  fallback,
  loading,
}: {
  children: ReactNode;
  fallback: (signIn: Auth['signIn'], error?: string) => ReactNode;
  loading: ReactNode;
}) {
  // undefined = still asking the backend
  const [source, setSource] = useState<AuthSource | undefined>(undefined);

  const refresh = useCallback(async () => {
    if (!isTauri) return setSource(hasDevToken ? 'env' : null);
    const s = await invoke<{ source: AuthSource }>('auth_status');
    setSource(s.source);
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const viewer = useGh<any>(source ? '/user' : null);

  const signIn = useCallback(
    async (token: string) => {
      const warning = await invoke<string | null>('set_token', { token });
      queryClient.clear();
      await refresh();
      return warning;
    },
    [refresh],
  );

  const signOut = useCallback(async () => {
    if (isTauri) await invoke('sign_out');
    queryClient.clear();
    setSource(null);
  }, []);

  if (source === undefined || (source && viewer.isLoading)) return <>{loading}</>;
  if (!source) return <>{fallback(signIn)}</>;
  if (viewer.error || !viewer.data) {
    const msg =
      viewer.error?.status === 401
        ? 'Your saved GitHub credentials were rejected. Sign in again.'
        : (viewer.error?.message ?? 'Could not reach GitHub.');
    return <>{fallback(signIn, msg)}</>;
  }
  return <Ctx.Provider value={{ viewer: viewer.data, source, signIn, signOut }}>{children}</Ctx.Provider>;
}
