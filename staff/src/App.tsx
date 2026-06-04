import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import LoginPage from './pages/LoginPage';
import TodayPage from './pages/TodayPage';
import ClientsPage from './pages/ClientsPage';
import ClientDetailPage from './pages/ClientDetailPage';
import MessagesPage from './pages/MessagesPage';
import BalancesPage from './pages/BalancesPage';
import PlaybookPage from './pages/PlaybookPage';
import PartnersPage from './pages/PartnersPage';
import CheckInPage from './pages/CheckInPage';
import CosPage from './pages/CosPage';
import StaffNav from './components/StaffNav';
import { Loader2 } from 'lucide-react';

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { isAuthenticated, isLoading } = useAuth();

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="w-8 h-8 text-amari-charcoal animate-spin" />
      </div>
    );
  }

  if (!isAuthenticated) {
    return <Navigate to="/login" replace />;
  }

  return <>{children}</>;
}

function PublicRoute({ children }: { children: React.ReactNode }) {
  const { isAuthenticated, isLoading } = useAuth();

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="w-8 h-8 text-amari-charcoal animate-spin" />
      </div>
    );
  }

  if (isAuthenticated) {
    return <Navigate to="/" replace />;
  }

  return <>{children}</>;
}

function LayoutWithNav({ children, fullBleed = false }: { children: React.ReactNode; fullBleed?: boolean }) {
  // Most pages scroll under a fixed nav, so they need bottom padding (pb-20).
  // Full-bleed pages (the COS chat) manage their own viewport-height layout and
  // must NOT carry that padding or they'd overflow past the nav.
  return (
    <div className={fullBleed ? '' : 'min-h-screen pb-20'}>
      {children}
      <StaffNav />
    </div>
  );
}

function AppRoutes() {
  return (
    <Routes>
      <Route
        path="/"
        element={
          <ProtectedRoute>
            <LayoutWithNav>
              <TodayPage />
            </LayoutWithNav>
          </ProtectedRoute>
        }
      />
      <Route
        path="/clients"
        element={
          <ProtectedRoute>
            <LayoutWithNav>
              <ClientsPage />
            </LayoutWithNav>
          </ProtectedRoute>
        }
      />
      <Route
        path="/messages"
        element={
          <ProtectedRoute>
            <LayoutWithNav>
              <MessagesPage />
            </LayoutWithNav>
          </ProtectedRoute>
        }
      />
      <Route
        path="/balances"
        element={
          <ProtectedRoute>
            <LayoutWithNav>
              <BalancesPage />
            </LayoutWithNav>
          </ProtectedRoute>
        }
      />
      <Route
        path="/playbook"
        element={
          <ProtectedRoute>
            <LayoutWithNav>
              <PlaybookPage />
            </LayoutWithNav>
          </ProtectedRoute>
        }
      />
      <Route
        path="/outreach"
        element={
          <ProtectedRoute>
            <LayoutWithNav>
              <PartnersPage />
            </LayoutWithNav>
          </ProtectedRoute>
        }
      />
      {/* Back-compat: old /partners URL still works */}
      <Route path="/partners" element={<Navigate to="/outreach" replace />} />
      <Route
        path="/client/:id"
        element={
          <ProtectedRoute>
            <ClientDetailPage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/cos"
        element={
          <ProtectedRoute>
            <LayoutWithNav fullBleed>
              <CosPage />
            </LayoutWithNav>
          </ProtectedRoute>
        }
      />
      <Route
        path="/check-in/:id"
        element={
          <ProtectedRoute>
            <CheckInPage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/login"
        element={
          <PublicRoute>
            <LoginPage />
          </PublicRoute>
        }
      />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter basename="/staff">
        <AppRoutes />
      </BrowserRouter>
    </AuthProvider>
  );
}
