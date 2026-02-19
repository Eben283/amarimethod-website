import { LogOut, User } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';

export default function PortalNav() {
  const { email, logout } = useAuth();

  return (
    <nav className="border-b border-amari-border bg-white/80 backdrop-blur-sm sticky top-0 z-50">
      <div className="max-w-5xl mx-auto px-4 sm:px-6 flex items-center justify-between h-16">
        {/* Logo */}
        <a href="/" className="flex items-center gap-3">
          <img
            src="/images/AmariLogo.avif"
            alt="Amari Method"
            className="h-8"
            style={{ height: '32px', width: 'auto' }}
          />
        </a>

        {/* Right side */}
        <div className="flex items-center gap-4">
          <div className="hidden sm:flex items-center gap-2 text-sm text-amari-text-muted">
            <User className="w-4 h-4" />
            <span>{email}</span>
          </div>
          <button
            onClick={logout}
            className="flex items-center gap-1.5 text-sm text-amari-text-muted hover:text-amari-charcoal transition-colors"
            title="Sign out"
          >
            <LogOut className="w-4 h-4" />
            <span className="hidden sm:inline">Sign out</span>
          </button>
        </div>
      </div>
    </nav>
  );
}
