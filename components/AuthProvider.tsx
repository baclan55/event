'use client';

import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { api } from '@/lib/client/api';

export type PortalUser = {
  id: number; nickname: string | null; discordUsername: string | null;
  avatarImageId: number | null; avatarUrl: string | null; isOwner: boolean; isAdmin: boolean;
  weeklyEvents: number; roleId: number | null; roleName: string | null; rolePriority: number | null;
  roles: string[]; isBlocked: boolean; blockedAt: string | null;
};
type Config = { appTitle: string; appSubtitle: string; weeklyEventsTarget: number; discordEnabled: boolean };
type AuthState = { user: PortalUser | null; config: Config | null; loading: boolean; refresh: () => Promise<void>; setUser: (user: PortalUser | null) => void };
const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<PortalUser | null>(null);
  const [config, setConfig] = useState<Config | null>(null);
  const [loading, setLoading] = useState(true);
  const refresh = async () => {
    const [configResult, meResult] = await Promise.allSettled([api.get('/api/config'), api.get('/api/auth/me')]);
    if (configResult.status === 'fulfilled') setConfig(configResult.value);
    if (meResult.status === 'fulfilled') setUser(meResult.value.user ?? null);
    setLoading(false);
  };
  useEffect(() => { void refresh(); }, []);
  const value = useMemo(() => ({ user, config, loading, refresh, setUser }), [user, config, loading]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const value = useContext(AuthContext);
  if (!value) throw new Error('useAuth должен использоваться внутри AuthProvider.');
  return value;
}
