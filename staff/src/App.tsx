import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import LoginPage from './pages/LoginPage';
import TodayPage from './pages/TodayPage';
import HomePage from './pages/HomePage';
import ClientsPage from './pages/ClientsPage';
import ClientDetailPage from './pages/ClientDetailPage';
import BalancesPage from './pages/BalancesPage';
import PlaybookPage from './pages/PlaybookPage';
import FollowUpPage from './pages/FollowUpPage';
import FunnelPage from './pages/FunnelPage';
import PipelinePage from './pages/PipelinePage';
import CheckInPage from './pages/CheckInPage';
import CosPage from './pages/CosPage';
import WritePage from './pages/WritePage';
import FieldStudiesPage from './pages/FieldStudiesPage';
import CommunityPage from './pages/CommunityPage';
import RevenuePage from './pages/RevenuePage';
import PosPage from './pages/PosPage';
import OperationsPage from './pages/OperationsPage';
import StaffHomeWidget from './components/StaffHomeWidget';
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

function Layout({ children, fullBleed = false }: { children: React.ReactNode; fullBleed?: boolean }) {
  return <div className={fullBleed ? '' : 'min-h-screen'}>{children}</div>;
}

function AppRoutes() {
  return <>
    <Routes>
      <Route
        path="/"
        element={
          <ProtectedRoute>
            <Layout>
              <HomePage />
            </Layout>
          </ProtectedRoute>
        }
      />
      <Route
        path="/today"
        element={
          <ProtectedRoute>
            <Layout>
              <TodayPage />
            </Layout>
          </ProtectedRoute>
        }
      />
      {/* Desk / triage removed — wrong product; ops visibility lives at /ops */}
      <Route path="/triage" element={<Navigate to="/" replace />} />
      <Route
        path="/clients"
        element={
          <ProtectedRoute>
            <Layout>
              <ClientsPage />
            </Layout>
          </ProtectedRoute>
        }
      />
      {/* The former Client Desk was a second, directory-style view. The staff
          communication surface is Follow-Up: one ordered queue for prospects
          and clients, replies, reasons, and next moves. Keep direct links
          working while sending everyone to that canonical surface. */}
      <Route path="/client-desk" element={<Navigate to="/follow-up" replace />} />
      {/* Messages retired into Follow-Up (unanswered replies rank on top there) */}
      <Route path="/messages" element={<Navigate to="/follow-up" replace />} />
      <Route
        path="/balances"
        element={
          <ProtectedRoute>
            <Layout>
              <BalancesPage />
            </Layout>
          </ProtectedRoute>
        }
      />
      <Route
        path="/revenue"
        element={
          <ProtectedRoute>
            <Layout>
              <RevenuePage />
            </Layout>
          </ProtectedRoute>
        }
      />
      <Route
        path="/playbook"
        element={
          <ProtectedRoute>
            <Layout>
              <PlaybookPage />
            </Layout>
          </ProtectedRoute>
        }
      />
      {/* Sharpen moved onto the Today tab as a card deck; old URL → home */}
      <Route path="/sharpen" element={<Navigate to="/" replace />} />
      {/* Outreach retired into Follow-Up; old URLs redirect there */}
      <Route path="/outreach" element={<Navigate to="/follow-up" replace />} />
      <Route path="/partners" element={<Navigate to="/follow-up" replace />} />
      <Route
        path="/follow-up"
        element={
          <ProtectedRoute>
            <Layout>
              <FollowUpPage />
            </Layout>
          </ProtectedRoute>
        }
      />
      <Route
        path="/funnel"
        element={
          <ProtectedRoute>
            <Layout>
              <FunnelPage />
            </Layout>
          </ProtectedRoute>
        }
      />
      <Route
        path="/pipeline"
        element={
          <ProtectedRoute>
            <Layout>
              <PipelinePage />
            </Layout>
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
            <Layout fullBleed>
              <CosPage />
            </Layout>
          </ProtectedRoute>
        }
      />
      <Route
        path="/write"
        element={
          <ProtectedRoute>
            <Layout fullBleed>
              <WritePage />
            </Layout>
          </ProtectedRoute>
        }
      />
      <Route
        path="/field-studies"
        element={
          <ProtectedRoute>
            <Layout fullBleed>
              <FieldStudiesPage />
            </Layout>
          </ProtectedRoute>
        }
      />
      <Route
        path="/operations"
        element={
          <ProtectedRoute>
            <Layout fullBleed>
              <OperationsPage />
            </Layout>
          </ProtectedRoute>
        }
      />
      <Route
        path="/community"
        element={
          <ProtectedRoute>
            <Layout>
              <CommunityPage />
            </Layout>
          </ProtectedRoute>
        }
      />
      <Route
        path="/pos"
        element={
          <ProtectedRoute>
            <Layout fullBleed>
              <PosPage />
            </Layout>
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
    <StaffHomeWidget />
  </>;
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
