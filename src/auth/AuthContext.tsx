import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import type { PropsWithChildren } from 'react';
import { api, setAuthFailureHandler } from '../api/client';
import { clearTokens, getAccessToken, saveTokens } from './tokenStorage';
import { isBiometricLoginEnabled, setBiometricLoginEnabled } from './biometricAuth';
import type { AuthResponse } from '../types';

interface AuthContextValue {
  user: AuthResponse | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  signup: (email: string, username: string, password: string) => Promise<void>;
  loginWithData: (auth: AuthResponse) => Promise<void>;
  loginWithToken: (accessToken: string) => Promise<void>;
  logout: (options?: { clearBiometric?: boolean }) => Promise<void>;
  refreshMe: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: PropsWithChildren) {
  const [user, setUser] = useState<AuthResponse | null>(null);
  const [loading, setLoading] = useState(true);

  const logout = async (options?: { clearBiometric?: boolean }) => {
    const biometricEnabled = await isBiometricLoginEnabled();
    if (options?.clearBiometric || !biometricEnabled) {
      await setBiometricLoginEnabled(false);
      await clearTokens();
    }
    setUser(null);
  };

  const refreshMe = async () => {
    const { data } = await api.get<AuthResponse>('/auth/me');
    const accessToken = await getAccessToken();
    setUser({ ...data, accessToken: accessToken ?? data.accessToken, refreshToken: data.refreshToken ?? '' });
  };

  useEffect(() => {
    setAuthFailureHandler(() => {
      setUser(null);
    });
    return () => setAuthFailureHandler(null);
  }, []);

  useEffect(() => {
    const bootstrap = async () => {
      try {
        const token = await getAccessToken();
        if (!token) return;
        if (await isBiometricLoginEnabled()) return;
        await refreshMe();
      } catch {
        await clearTokens();
      } finally {
        setLoading(false);
      }
    };
    void bootstrap();
  }, []);

  const loginWithData = async (auth: AuthResponse) => {
    await saveTokens(auth.accessToken, auth.refreshToken ?? '');
    setUser({ ...auth, refreshToken: auth.refreshToken ?? '' });
  };

  const loginWithToken = async (accessToken: string) => {
    await saveTokens(accessToken, '');
    const { data } = await api.get<AuthResponse>('/auth/me', {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    setUser({ ...data, accessToken, refreshToken: data.refreshToken ?? '' });
  };

  const login = async (email: string, password: string) => {
    const { data } = await api.post<AuthResponse>('/auth/login', { email, password });
    await loginWithData(data);
  };

  const signup = async (email: string, username: string, password: string) => {
    const { data } = await api.post<AuthResponse>('/auth/signup', { email, username, password });
    await loginWithData(data);
  };

  const value = useMemo(() => ({ user, loading, login, signup, loginWithData, loginWithToken, logout, refreshMe }), [user, loading]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error('useAuth must be used within AuthProvider');
  }
  return ctx;
}
