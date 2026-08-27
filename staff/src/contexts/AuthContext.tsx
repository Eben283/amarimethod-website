import { createContext, useContext, useState, useEffect, useCallback, ReactNode } from 'react';
import type { StaffAuthState } from '../types/staff';

interface AuthContextType extends StaffAuthState {
  login: () => void;
  logout: () => void;
}

const AuthContext = createContext<AuthContextType | null>(null);

const TOKEN_KEY = 'staff_token';
const EXPIRY_KEY = 'staff_token_expiry';

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<StaffAuthState>({
    isAuthenticated: false,
    isLoading: true,
  });

  const logout = useCallback(() => {
    void fetch('/api/staff-session', { method: 'DELETE', credentials: 'same-origin' });
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(EXPIRY_KEY);
    setState({ isAuthenticated: false, isLoading: false });
  }, []);

  useEffect(() => {
    window.addEventListener('amari:staff-session-expired', logout);
    return () => window.removeEventListener('amari:staff-session-expired', logout);
  }, [logout]);

  useEffect(() => {
    void fetch('/api/staff-session', { credentials: 'same-origin' })
      .then(response => response.ok)
      .then(isAuthenticated => setState({ isAuthenticated, isLoading: false }))
      .catch(() => setState({ isAuthenticated: false, isLoading: false }));
  }, []);

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
