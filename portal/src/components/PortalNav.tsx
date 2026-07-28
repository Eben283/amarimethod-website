import { Link } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';

interface PortalNavProps {
  firstName?: string;
  hasLivingPractice?: boolean;
  onOpenSettings?: () => void;
  practiceMode?: boolean;
}

export default function PortalNav({ firstName, hasLivingPractice, onOpenSettings, practiceMode = false }: PortalNavProps) {
  const { email, logout } = useAuth();
  const displayName = firstName || email?.split('@')[0] || '';

  return (
    <header className="cp-topbar">
      <a
        href="https://www.amarimethod.com/"
        className="cp-seal"
        aria-label="Amari Method — Home"
      >
        <img src="/images/AmariLogo.avif" alt="Amari Method" className="cp-seal-logo" />
      </a>
      <nav className="cp-topnav">
        <Link to="/" className="cp-topnav-link cp-current">{practiceMode ? 'Your Practice' : 'Dashboard'}</Link>
        {hasLivingPractice && (
          <Link to="/practice" className="cp-topnav-link">Living Practice</Link>
        )}
      </nav>
      <div className="cp-account">
        {displayName && <span className="cp-account-name">{displayName}</span>}
        {onOpenSettings && (
          <button
            type="button"
            onClick={onOpenSettings}
            aria-label="Settings"
            title="Settings"
            style={{
              background: 'none',
              border: 'none',
              cursor: 'pointer',
              fontSize: '22px',
              lineHeight: 1,
              padding: '4px 6px',
              color: 'inherit',
              opacity: 0.6,
            }}
          >
            ⚙
          </button>
        )}
        <button type="button" className="cp-account-out" onClick={logout}>Sign out</button>
      </div>
    </header>
  );
}
