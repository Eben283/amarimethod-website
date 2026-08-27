import { NavLink } from 'react-router-dom';
import { Bell } from 'lucide-react';
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
      <div className="cp-topbar-inner">
        <a
          href="https://www.amarimethod.com/"
          className="cp-seal"
          aria-label="Amari Method — Home"
        >
          <img src="/images/identity/amari-method-wordmark.svg" alt="Amari Method" className="cp-seal-logo" />
        </a>
        <nav className="cp-topnav" aria-label="Portal">
          <NavLink
            to="/"
            end
            className={({ isActive }) => `cp-topnav-link${isActive ? ' cp-current' : ''}`}
          >
            {practiceMode ? 'Your Practice' : 'Dashboard'}
          </NavLink>
          {hasLivingPractice && (
            <NavLink
              to="/practice"
              className={({ isActive }) => `cp-topnav-link${isActive ? ' cp-current' : ''}`}
            >
              Living Practice
            </NavLink>
          )}
        </nav>
        <div className="cp-account">
          {displayName && <span className="cp-account-name">{displayName}</span>}
          {onOpenSettings && (
            <button type="button" className="cp-account-settings" onClick={onOpenSettings} aria-label="Reminder preferences" title="Reminder preferences">
              <Bell size={17} strokeWidth={1.8} aria-hidden="true" />
              <span>Reminders</span>
            </button>
          )}
          <button type="button" className="cp-account-out" onClick={logout}>Sign out</button>
        </div>
      </div>
    </header>
  );
}
