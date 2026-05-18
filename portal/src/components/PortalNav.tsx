import { Link } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';

interface PortalNavProps {
  firstName?: string;
  hasLivingPractice?: boolean;
}

export default function PortalNav({ firstName, hasLivingPractice }: PortalNavProps) {
  const { email, logout } = useAuth();
  const displayName = firstName || email?.split('@')[0] || '';

  return (
    <header className="cp-topbar">
      <Link to="/" className="cp-seal">
        <img src="/images/AmariLogo.avif" alt="" className="cp-seal-logo" />
        <span>Amari Method</span>
      </Link>
      <nav className="cp-topnav">
        <Link to="/" className="cp-topnav-link cp-current">Dashboard</Link>
        {hasLivingPractice && (
          <Link to="/practice" className="cp-topnav-link">Living Practice</Link>
        )}
      </nav>
      <div className="cp-account">
        {displayName && <span className="cp-account-name">{displayName}</span>}
        <button type="button" className="cp-account-out" onClick={logout}>Sign out</button>
      </div>
    </header>
  );
}
