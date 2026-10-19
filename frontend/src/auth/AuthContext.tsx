import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { api, setCredentials } from '../api/api';
import type { Me } from '../types/models';
import { AuthContext, type AuthState } from './AuthContextStore';

export function AuthProvider({ children }: { children: ReactNode }) {
  const [me, setMe] = useState<Me | null>(() => { try { return JSON.parse(sessionStorage.getItem('loan-me') || 'null') as Me | null; } catch { return null; } });
  useEffect(() => { const expired = () => { setMe(null); sessionStorage.removeItem('loan-me'); }; window.addEventListener('loan-session-expired', expired); return () => window.removeEventListener('loan-session-expired', expired); }, []);
  const isAuthenticated = me !== null;
  useEffect(() => {
    if (!isAuthenticated) return;
    let active = true;
    api<Me>('/me').then(profile => { if (active) { sessionStorage.setItem('loan-me', JSON.stringify(profile)); setMe(profile); } }).catch(() => { /* api() dispatches loan-session-expired for an invalid cached session. */ });
    return () => { active = false; };
  }, [isAuthenticated]);
  const value = useMemo<AuthState>(() => ({
    me,
    login: (profile, credentials) => { setCredentials(credentials); sessionStorage.setItem('loan-auth', credentials); sessionStorage.setItem('loan-me', JSON.stringify(profile)); setMe(profile); },
    logout: () => { sessionStorage.removeItem('loan-auth'); sessionStorage.removeItem('loan-me'); setCredentials(''); setMe(null); },
  }), [me]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
