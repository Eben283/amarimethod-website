import { createContext, useContext, useState, useEffect, useCallback, ReactNode } from 'react';
import type { AuthState } from '../types/portal';

const SESSION_REFRESH_INTERVAL = 5 * 60 * 1000; // 5 minutes

interface AuthContextType extends AuthState {
  login: (sessionToken: string, contactId: string, email: string) => void;
  logout: () => void;
  sessionEvicted: boolean;
}

const AuthContext = createContext<AuthContextType | null>(null);

function getOrCreateDeviceId(): string {
  const existing = localStorage.getItem('portal_device_id');
  if (existing) return existing;

  const id = crypto.randomUUID();
  localStorage.setItem('portal_device_id', id);
  return id;
}

function getDeviceName(): string {
  const ua = navigator.userAgent;
  if (/iPhone/i.test(ua)) return 'iPhone';
  if (/iPad/i.test(ua)) return 'iPad';
  if (/Android/i.test(ua)) return 'Android';
  if (/Mac/i.test(ua)) {
    if (/Chrome/i.test(ua)) return 'Chrome on Mac';
    if (/Safari/i.test(ua)) return 'Safari on Mac';
    return 'Mac';
  }
  if (/Windows/i.test(ua)) {
    if (/Chrome/i.test(ua)) return 'Chrome on Windows';
    if (/Firefox/i.test(ua)) return 'Firefox on Windows';
    return 'Windows';
  }
  if (/Linux/i.test(ua)) return 'Linux';
  return 'Browser';
}

async function refreshDeviceSession(): Promise<boolean> {
  const token = localStorage.getItem('portal_token');
  if (!token) return true; // No token = no session to check

  const deviceId = getOrCreateDeviceId();
  const deviceName = getDeviceName();

  try {
    const response = await fetch('/api/portal-session', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ deviceId, deviceName }),
    });

    if (!response.ok) return true; // Non-200 = treat as valid (graceful degradation)

    const data = await response.json();
    return data.valid !== false;
  } catch {
    // Network error — don't evict on connectivity issues
    return true;
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>({
    isAuthenticated: false,
    isLoading: true,
    contactId: null,
    email: null,
  });
  const [sessionEvicted, setSessionEvicted] = useState(false);

  const logout = useCallback(() => {
    clearStorage();
    setState({
      isAuthenticated: false,
      isLoading: false,
      contactId: null,
      email: null,
    });
  }, []);

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

  // Device session check — on mount and periodically
  useEffect(() => {
    if (!state.isAuthenticated) return;

    let cancelled = false;

    async function checkSession() {
      const valid = await refreshDeviceSession();
      if (!cancelled && !valid) {
        setSessionEvicted(true);
        logout();
      }
    }

    // Check on mount
    checkSession();

    // Refresh every 5 minutes
    const interval = setInterval(checkSession, SESSION_REFRESH_INTERVAL);

    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [state.isAuthenticated, logout]);

  function login(sessionToken: string, contactId: string, email: string) {
    // Store with 30-day expiry
    const expiry = Date.now() + 30 * 24 * 60 * 60 * 1000;
    localStorage.setItem('portal_token', sessionToken);
    localStorage.setItem('portal_contact_id', contactId);
    localStorage.setItem('portal_email', email);
    localStorage.setItem('portal_token_expiry', expiry.toString());

    // Ensure device ID exists
    getOrCreateDeviceId();

    setSessionEvicted(false);
    setState({
      isAuthenticated: true,
      isLoading: false,
      contactId,
      email,
    });
  }

  function clearStorage() {
    localStorage.removeItem('portal_token');
    localStorage.removeItem('portal_contact_id');
    localStorage.removeItem('portal_email');
    localStorage.removeItem('portal_token_expiry');
    // Keep portal_device_id — it's per-device, not per-session
  }

  return (
    <AuthContext.Provider value={{ ...state, login, logout, sessionEvicted }}>
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
