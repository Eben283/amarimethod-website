import { createContext, useContext, useState, useEffect, useCallback, ReactNode } from 'react';
import type { AuthState } from '../types/cos';

interface AuthContextType extends AuthState {
  login: (token: string) => void;
  logout: () => void;
}

const AuthContext = createContext<AuthContextType | null>(null);

const TOKEN_KEY = 'cos_token';
const EXPIRY_KEY = 'cos_token_expiry';

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>({
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

    // JWT rotation / expired API responses clear storage and fire this.
    const onUnauthorized = () => {
      setState({ isAuthenticated: false, isLoading: false });
    };
    window.addEventListener('cos:unauthorized', onUnauthorized);
    return () => window.removeEventListener('cos:unauthorized', onUnauthorized);
  }, []);

  function login(token: string) {
    const expiry = Date.now() + 30 * 24 * 60 * 60 * 1000;
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
