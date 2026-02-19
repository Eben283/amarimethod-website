import { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import type { AuthState } from '../types/portal';

interface AuthContextType extends AuthState {
  login: (sessionToken: string, contactId: string, email: string) => void;
  logout: () => void;
}

const AuthContext = createContext<AuthContextType | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>({
    isAuthenticated: false,
    isLoading: true,
    contactId: null,
    email: null,
  });

  // Check for existing session on mount
  useEffect(() => {
    const token = localStorage.getItem('portal_token');
    const contactId = localStorage.getItem('portal_contact_id');
    const email = localStorage.getItem('portal_email');
    const expiry = localStorage.getItem('portal_token_expiry');

    if (token && contactId && email && expiry) {
      // Check if token is expired
      if (Date.now() < parseInt(expiry, 10)) {
        setState({
          isAuthenticated: true,
          isLoading: false,
          contactId,
          email,
        });
      } else {
        // Token expired, clear storage
        clearStorage();
        setState(prev => ({ ...prev, isLoading: false }));
      }
    } else {
      setState(prev => ({ ...prev, isLoading: false }));
    }
  }, []);

  function login(sessionToken: string, contactId: string, email: string) {
    // Store with 30-day expiry
    const expiry = Date.now() + 30 * 24 * 60 * 60 * 1000;
    localStorage.setItem('portal_token', sessionToken);
    localStorage.setItem('portal_contact_id', contactId);
    localStorage.setItem('portal_email', email);
    localStorage.setItem('portal_token_expiry', expiry.toString());

    setState({
      isAuthenticated: true,
      isLoading: false,
      contactId,
      email,
    });
  }

  function logout() {
    clearStorage();
    setState({
      isAuthenticated: false,
      isLoading: false,
      contactId: null,
      email: null,
    });
  }

  function clearStorage() {
    localStorage.removeItem('portal_token');
    localStorage.removeItem('portal_contact_id');
    localStorage.removeItem('portal_email');
    localStorage.removeItem('portal_token_expiry');
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
