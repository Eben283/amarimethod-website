import { createContext, ReactNode, useCallback, useContext, useEffect, useState } from 'react';
import type { AuthState } from '../types/cos';

interface ParkingAuthContextType extends AuthState {
  login: (token: string) => void;
  logout: () => void;
}

const ParkingAuthContext = createContext<ParkingAuthContextType | null>(null);
const TOKEN_KEY = 'parking_token';
const EXPIRY_KEY = 'parking_token_expiry';

export function clearParkingSession() {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(EXPIRY_KEY);
  window.dispatchEvent(new Event('parking:unauthorized'));
}

export function getParkingToken() {
  const token = localStorage.getItem(TOKEN_KEY);
  const expiry = localStorage.getItem(EXPIRY_KEY);
  if (!token || !expiry || Date.now() >= Number(expiry)) {
    clearParkingSession();
    return null;
  }
  return token;
}

export function ParkingAuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>({ isAuthenticated: false, isLoading: true });
  const logout = useCallback(() => {
    clearParkingSession();
    setState({ isAuthenticated: false, isLoading: false });
  }, []);

  useEffect(() => {
    const token = getParkingToken();
    setState({ isAuthenticated: !!token, isLoading: false });
    const onUnauthorized = () => setState({ isAuthenticated: false, isLoading: false });
    window.addEventListener('parking:unauthorized', onUnauthorized);
    return () => window.removeEventListener('parking:unauthorized', onUnauthorized);
  }, []);

  const login = useCallback((token: string) => {
    localStorage.setItem(TOKEN_KEY, token);
    localStorage.setItem(EXPIRY_KEY, String(Date.now() + 30 * 24 * 60 * 60 * 1000));
    setState({ isAuthenticated: true, isLoading: false });
  }, []);

  return <ParkingAuthContext.Provider value={{ ...state, login, logout }}>{children}</ParkingAuthContext.Provider>;
}

export function useParkingAuth() {
  const context = useContext(ParkingAuthContext);
  if (!context) throw new Error('useParkingAuth must be used within ParkingAuthProvider');
  return context;
}
