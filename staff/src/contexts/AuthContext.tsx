import { createContext, useContext, useState, useEffect, useCallback, ReactNode } from 'react';
import type { StaffAuthState } from '../types/staff';

interface AuthContextType extends StaffAuthState {
  login: () => void;
  // `force` is only for the person deliberately choosing Sign out. API errors
  // must be checked against the session endpoint before ending the workspace.
  logout: (force?: boolean) => void;
}

const AuthContext = createContext<AuthContextType | null>(null);

const TOKEN_KEY = 'staff_token';
const EXPIRY_KEY = 'staff_token_expiry';

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<StaffAuthState>({
    isAuthenticated: false,
    isLoading: true,
  });

  const clearSession = useCallback((revokeCookie = false) => {
    if (revokeCookie) {
      void fetch('/api/staff-session', { method: 'DELETE', credentials: 'same-origin' });
    }
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(EXPIRY_KEY);
    setState({ isAuthenticated: false, isLoading: false });
  }, []);

  // A failed Staff data request is not, by itself, proof that the Staff cookie
  // expired. For example, Outreach can fail while fetching its partner data.
  // Re-check the dedicated session endpoint before clearing the whole workspace,
  // so one surface's error cannot turn into a surprise PIN prompt everywhere.
  const checkSession = useCallback(() => {
    return fetch('/api/staff-session', { credentials: 'same-origin' })
      .then(response => response.ok)
      .catch(() => false);
  }, []);

  const logout = useCallback((force = false) => {
    if (force) {
      clearSession(true);
      return;
    }

    // A 401 from a Staff data endpoint can be a service-level failure. Only
    // leave the app when the dedicated session check confirms the cookie is no
    // longer valid.
    void checkSession().then(isAuthenticated => {
      if (!isAuthenticated) clearSession();
    });
  }, [checkSession, clearSession]);

  useEffect(() => {
    const handleSessionError = () => logout();
    window.addEventListener('amari:staff-session-expired', handleSessionError);
    return () => window.removeEventListener('amari:staff-session-expired', handleSessionError);
  }, [logout]);

  useEffect(() => {
    void checkSession().then(isAuthenticated => setState({ isAuthenticated, isLoading: false }));
  }, [checkSession]);

  function login() {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(EXPIRY_KEY);
    setState({ isAuthenticated: true, isLoading: false });
  }

  return (
    <AuthContext.Provider value={{ ...state, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
