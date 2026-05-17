import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import LoginPage from './pages/LoginPage';
import TodayPage from './pages/TodayPage';
import ClientsPage from './pages/ClientsPage';
import ClientDetailPage from './pages/ClientDetailPage';
import MessagesPage from './pages/MessagesPage';
import BalancesPage from './pages/BalancesPage';
import PlaybookPage from './pages/PlaybookPage';
import CheckInPage from './pages/CheckInPage';
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

function LayoutWithNav({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen pb-20">
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
        path="/client/:id"
        element={
          <ProtectedRoute>
            <ClientDetailPage />
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
