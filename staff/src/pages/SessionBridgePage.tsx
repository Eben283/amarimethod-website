import { useEffect, useState } from 'react';

const TOKEN_KEY = 'staff_token';
const EXPIRY_KEY = 'staff_token_expiry';
const safeReturnPath = () => { const value = new URLSearchParams(window.location.search).get('return') || '/staff/'; return value.startsWith('/staff/') ? value : '/staff/'; };

export default function SessionBridgePage() {
  const [message, setMessage] = useState('Checking your Staff session…');
  useEffect(() => {
    const token = localStorage.getItem(TOKEN_KEY);
    const expiry = localStorage.getItem(EXPIRY_KEY);
    if (!token || !expiry || Date.now() >= parseInt(expiry, 10)) { window.location.replace('/staff/login'); return; }
    void fetch('/api/staff-session', { method: 'POST', credentials: 'same-origin', headers: { Authorization: `Bearer ${token}` } }).then(response => {
      if (!response.ok) throw new Error('Session upgrade failed');
      localStorage.removeItem(TOKEN_KEY); localStorage.removeItem(EXPIRY_KEY); window.location.replace(safeReturnPath());
    }).catch(() => {
      localStorage.removeItem(TOKEN_KEY); localStorage.removeItem(EXPIRY_KEY);
      setMessage('Your Staff session has expired. Please sign in again.');
      window.setTimeout(() => window.location.replace('/staff/login'), 1200);
    });
  }, []);
  return <div className="min-h-screen flex items-center justify-center px-6 bg-amari-bone-white"><p className="text-amari-text-muted text-sm">{message}</p></div>;
}
