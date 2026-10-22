import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { User } from '../types/api';
import { login as apiLogin, me as apiMe, onUnauthorized } from '../services/api';
import { clearSession, getStoredUser, getToken, saveSession } from '../services/auth';

interface AuthContextValue {
  user: User | null;
  booting: boolean;
  signingIn: boolean;
  error: string | null;
  signIn: (email: string, password: string) => Promise<boolean>;
  signOut: () => void;
  isAdmin: boolean;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(() => getStoredUser());
  const [booting, setBooting] = useState<boolean>(() => Boolean(getToken()));
  const [signingIn, setSigningIn] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    onUnauthorized(() => {
      clearSession();
      setUser(null);
    });
  }, []);

  useEffect(() => {
    if (!getToken()) {
      setBooting(false);
      return;
    }
    let alive = true;
    apiMe()
      .then((fresh) => {
        if (alive) setUser(fresh);
      })
      .catch(() => {
        if (alive) clearSession();
      })
      .finally(() => {
        if (alive) setBooting(false);
      });
    return () => {
      alive = false;
    };
  }, []);

  const signIn = useCallback(async (email: string, password: string) => {
    setSigningIn(true);
    setError(null);
    try {
      const response = await apiLogin(email, password);
      saveSession(response.access_token, response.user);
      setUser(response.user);
      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Sign-in failed');
      return false;
    } finally {
      setSigningIn(false);
    }
  }, []);

  const signOut = useCallback(() => {
    clearSession();
    setUser(null);
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({ user, booting, signingIn, error, signIn, signOut, isAdmin: user?.role === 'admin' }),
    [user, booting, signingIn, error, signIn, signOut],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}
