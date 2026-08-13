'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { api } from '@/lib/client/api';
import type { Permission } from '@/lib/roleAccess';

export type PortalUser = {
  id: number;
  nickname: string | null;
  discordUsername: string | null;
  avatarImageId: number | null;
  avatarUrl: string | null;
  isOwner: boolean;
  isAdmin: boolean;
  weeklyEvents: number;
  roleId: number | null;
  roleName: string | null;
  rolePriority: number | null;
  roles: string[];
  permissions?: Permission[];
  isBlocked: boolean;
  blockedAt: string | null;
};

type Config = {
  appTitle: string;
  appSubtitle: string;
  weeklyEventsTarget: number;
  discordEnabled: boolean;
};

type AuthState = {
  user: PortalUser | null;
  config: Config | null;
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  setUser: (user: PortalUser | null) => void;
};

const AuthContext = createContext<AuthState | null>(null);

const defaultConfig: Config = {
  appTitle: 'Events Denver',
  appSubtitle: 'Ивент-отдел сервера',
  weeklyEventsTarget: 5,
  discordEnabled: true,
};

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<PortalUser | null>(null);
  const [config, setConfig] = useState<Config | null>(defaultConfig);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setError(null);
    try {
      const [configResult, meResult] = await Promise.allSettled([
        api.get('/api/config'),
        api.get('/api/auth/me'),
      ]);
      if (configResult.status === 'fulfilled') setConfig(configResult.value);
      if (meResult.status === 'fulfilled') {
        setUser(meResult.value.user ?? null);
      } else {
        setUser(null);
        setError((meResult.reason as Error)?.message || 'Не удалось проверить сессию.');
      }
    } catch (err) {
      setUser(null);
      setError((err as Error).message || 'Ошибка загрузки.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const value = useMemo(
    () => ({ user, config, loading, error, refresh, setUser }),
    [user, config, loading, error, refresh]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const value = useContext(AuthContext);
  if (!value) throw new Error('useAuth должен использоваться внутри AuthProvider.');
  return value;
}
