import { createContext, useContext, useState, useEffect, useCallback, ReactNode } from 'react';
import type { StaffAuthState } from '../types/staff';

interface AuthContextType extends StaffAuthState {
  login: (token: string) => void;
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
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(EXPIRY_KEY);
    setState({ isAuthenticated: false, isLoading: false });
  }, []);

  useEffect(() => {
    const token = localStorage.getItem(TOKEN_KEY);
    const expiry = localStorage.getItem(EXPIRY_KEY);

    if (token && expiry && Date.now() < parseInt(expiry, 10)) {
      setState({ isAuthenticated: true, isLoading: false });
    } else {
      if (token) {
        localStorage.removeItem(TOKEN_KEY);
        localStorage.removeItem(EXPIRY_KEY);
      }
      setState({ isAuthenticated: false, isLoading: false });
    }
  }, []);

  function login(token: string) {
    const expiry = Date.now() + 30 * 24 * 60 * 60 * 1000; // 30 days
    localStorage.setItem(TOKEN_KEY, token);
    localStorage.setItem(EXPIRY_KEY, expiry.toString());
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
