import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import LoginPage from './pages/LoginPage';
import TodayPage from './pages/TodayPage';
import ClientsPage from './pages/ClientsPage';
import ClientDetailPage from './pages/ClientDetailPage';
import BalancesPage from './pages/BalancesPage';
import PlaybookPage from './pages/PlaybookPage';
import FollowUpPage from './pages/FollowUpPage';
import FunnelPage from './pages/FunnelPage';
import CheckInPage from './pages/CheckInPage';
import CosPage from './pages/CosPage';
import SharpenPage from './pages/SharpenPage';
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
      {/* Messages retired into Follow-Up (unanswered replies rank on top there) */}
      <Route path="/messages" element={<Navigate to="/follow-up" replace />} />
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
        path="/sharpen"
        element={
          <ProtectedRoute>
            <LayoutWithNav>
              <SharpenPage />
            </LayoutWithNav>
          </ProtectedRoute>
        }
      />
      {/* Outreach retired into Follow-Up; old URLs redirect there */}
      <Route path="/outreach" element={<Navigate to="/follow-up" replace />} />
      <Route path="/partners" element={<Navigate to="/follow-up" replace />} />
      <Route
        path="/follow-up"
        element={
          <ProtectedRoute>
            <LayoutWithNav>
              <FollowUpPage />
            </LayoutWithNav>
          </ProtectedRoute>
        }
      />
      <Route
        path="/funnel"
        element={
          <ProtectedRoute>
            <LayoutWithNav>
              <FunnelPage />
            </LayoutWithNav>
          </ProtectedRoute>
        }
      />
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
