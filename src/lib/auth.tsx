import { invoke } from '@tauri-apps/api/core';
import { createContext, type ReactNode, useCallback, useContext, useEffect, useState } from 'react';
import { hasDevToken, isTauri, queryClient, setGhHost, useGh } from './api';
import type { User } from './types';

export type AuthSource = 'keyring' | 'env' | 'gh-cli' | null;

interface Status {
  source: AuthSource;
  host: string;
  device_flow: boolean;
}

export interface DeviceCode {
  device_code: string;
  user_code: string;
  verification_uri: string;
  interval: number;
  expires_in: number;
}

// what the sign-in screen can do
export interface SignInApi {
  host: string;
  deviceFlow: boolean;
  // stores a personal access token
  withToken: (token: string, host?: string) => Promise<string | null>;
  // go back to the cli or environment token
  withAmbient: () => Promise<void>;
  deviceStart: () => Promise<DeviceCode>;
  // resolves true once the person has approved the code in their browser
  devicePoll: (deviceCode: string) => Promise<boolean>;
}

interface Auth {
  viewer: User;
  source: AuthSource;
  host: string;
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
  fallback: (api: SignInApi, error?: string) => ReactNode;
  loading: ReactNode;
}) {
  // undefined = still asking the backend
  const [status, setStatus] = useState<Status | undefined>(undefined);

  const refresh = useCallback(async () => {
    if (!isTauri) return setStatus({ source: hasDevToken ? 'env' : null, host: 'github.com', device_flow: false });
    try {
      const s = await invoke<Status>('auth_status');
      setGhHost(s.host);
      setStatus(s);
    } catch {
      setStatus({ source: null, host: 'github.com', device_flow: false });
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const source = status?.source;
  const viewer = useGh<User>(source ? '/user' : null);

  const signedIn = useCallback(async () => {
    queryClient.clear();
    await refresh();
  }, [refresh]);

  const api: SignInApi = {
    host: status?.host ?? 'github.com',
    deviceFlow: !!status?.device_flow,
    withToken: async (token, host) => {
      const warning = await invoke<string | null>('set_token', { token, host: host || null });
      await signedIn();
      return warning;
    },
    withAmbient: async () => {
      await invoke('use_ambient_token');
      await signedIn();
    },
    deviceStart: () => invoke<DeviceCode>('device_start'),
    devicePoll: async (deviceCode) => {
      const done = await invoke<string | null>('device_poll', { deviceCode });
      if (done === null) return false;
      await signedIn();
      return true;
    },
  };

  const signOut = useCallback(async () => {
    if (isTauri) await invoke('sign_out');
    queryClient.clear();
    setStatus((s) => (s ? { ...s, source: null } : s));
  }, []);

  if (status === undefined || (source && viewer.isLoading)) return <>{loading}</>;
  if (!source) return <>{fallback(api)}</>;
  if (viewer.error || !viewer.data) {
    const msg =
      viewer.error?.status === 401
        ? 'Your saved GitHub credentials were rejected. Sign in again.'
        : (viewer.error?.message ?? 'Could not reach GitHub.');
    return <>{fallback(api, msg)}</>;
  }
  return <Ctx.Provider value={{ viewer: viewer.data, source, host: status.host, signOut }}>{children}</Ctx.Provider>;
}
