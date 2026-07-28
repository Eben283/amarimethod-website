import { House } from 'lucide-react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';

const NO_WIDGET_ROUTES = new Set(['/', '/login', '/field-studies', '/pos']);

export default function StaffHomeWidget() {
  const { isAuthenticated } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();

  const hasSessionHeaderHome = location.pathname.startsWith('/client/');
  if (!isAuthenticated || hasSessionHeaderHome || NO_WIDGET_ROUTES.has(location.pathname)) return null;

  const isChat = location.pathname === '/cos' || location.pathname === '/write';

  function returnHome() {
    if (location.pathname.startsWith('/check-in/') && !window.confirm('Return to Home? Any unfinished check-in work will be lost.')) return;
    navigate('/');
  }

  return (
    <button
      type="button"
      className={`staff-home-widget${isChat ? ' staff-home-widget--chat' : ''}`}
      onClick={returnHome}
      aria-label="Return to Amari Home"
    >
      <House aria-hidden="true" />
      <span>Home</span>
    </button>
  );
}
