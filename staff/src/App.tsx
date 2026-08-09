import { lazy, Suspense } from 'react';
import { BrowserRouter, Routes, Route, Navigate, Outlet } from 'react-router-dom';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import LoginPage from './pages/LoginPage';
import SessionBridgePage from './pages/SessionBridgePage';
import HomePage from './pages/HomePage';
import StaffShell from './components/StaffShell';
import { Loader2 } from 'lucide-react';

const TodayPage = lazy(() => import('./pages/TodayPage'));
const ClientsPage = lazy(() => import('./pages/ClientsPage'));
const ClientDetailPage = lazy(() => import('./pages/ClientDetailPage'));
const BalancesPage = lazy(() => import('./pages/BalancesPage'));
const PlaybookPage = lazy(() => import('./pages/PlaybookPage'));
const FollowUpPage = lazy(() => import('./pages/FollowUpPage'));
const FunnelPage = lazy(() => import('./pages/FunnelPage'));
const PipelinePage = lazy(() => import('./pages/PipelinePage'));
const CheckInPage = lazy(() => import('./pages/CheckInPage'));
const CosPage = lazy(() => import('./pages/CosPage'));
const FieldStudiesPage = lazy(() => import('./pages/FieldStudiesPage'));
const CommunityPage = lazy(() => import('./pages/CommunityPage'));
const RevenuePage = lazy(() => import('./pages/RevenuePage'));
const PosPage = lazy(() => import('./pages/PosPage'));
const ProductsPage = lazy(() => import('./pages/ProductsPage'));
const MediaPage = lazy(() => import('./pages/MediaPage'));
const OperationsPage = lazy(() => import('./pages/OperationsPage'));
const ClientDeskPage = lazy(() => import('./pages/ClientDeskPage'));
const CommunicationPreferencesPage = lazy(() => import('./pages/CommunicationPreferencesPage'));
const AutomationRegistryPage = lazy(() => import('./pages/AutomationRegistryPage'));

function SurfaceLoader() {
  return (
    <div className="min-h-[45vh] flex items-center justify-center" role="status" aria-label="Opening workspace">
      <Loader2 className="w-7 h-7 text-amari-charcoal animate-spin" aria-hidden="true" />
    </div>
  );
}

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
  return <div className={fullBleed ? '' : 'min-h-screen'}><Suspense fallback={<SurfaceLoader />}>{children}</Suspense></div>;
}

function ProtectedStaffLayout() {
  return (
    <ProtectedRoute>
      <StaffShell>
        <Outlet />
      </StaffShell>
    </ProtectedRoute>
  );
}

function AppRoutes() {
  return <>
    <Routes>
      <Route element={<ProtectedStaffLayout />}>
        <Route index element={<Layout><HomePage /></Layout>} />
        <Route path="calendar" element={<Layout><TodayPage /></Layout>} />
        <Route path="today" element={<Navigate to="/calendar" replace />} />
        <Route path="clients" element={<Layout><ClientsPage /></Layout>} />
        <Route path="client-desk" element={<Layout><ClientDeskPage /></Layout>} />
        <Route path="balances" element={<Layout><BalancesPage /></Layout>} />
        <Route path="revenue" element={<Layout><RevenuePage /></Layout>} />
        <Route path="playbook" element={<Layout><PlaybookPage /></Layout>} />
        <Route path="follow-up" element={<Layout><FollowUpPage /></Layout>} />
        <Route path="funnel" element={<Layout><FunnelPage /></Layout>} />
        <Route path="pipeline" element={<Layout><PipelinePage /></Layout>} />
        <Route path="client/:id" element={<Layout fullBleed><ClientDetailPage /></Layout>} />
        <Route path="cos" element={<Layout fullBleed><CosPage /></Layout>} />
        <Route path="field-studies" element={<Layout fullBleed><FieldStudiesPage /></Layout>} />
        <Route path="operations" element={<Layout fullBleed><OperationsPage /></Layout>} />
        <Route path="automations" element={<Layout fullBleed><AutomationRegistryPage /></Layout>} />
        <Route path="community" element={<Layout><CommunityPage /></Layout>} />
        <Route path="pos" element={<Layout fullBleed><PosPage /></Layout>} />
        <Route path="products/*" element={<Layout><ProductsPage /></Layout>} />
        <Route path="media" element={<Layout><MediaPage /></Layout>} />
        <Route path="settings/communication" element={<Layout><CommunicationPreferencesPage /></Layout>} />
        {/* Retired route names keep their existing destinations. */}
        <Route path="triage" element={<Navigate to="/" replace />} />
        <Route path="messages" element={<Navigate to="/client-desk" replace />} />
        <Route path="sharpen" element={<Navigate to="/" replace />} />
        <Route path="outreach" element={<Navigate to="/follow-up" replace />} />
        <Route path="partners" element={<Navigate to="/follow-up" replace />} />
      </Route>
      <Route
        path="/check-in/:id"
        element={
          <ProtectedRoute>
            <Suspense fallback={<SurfaceLoader />}><CheckInPage /></Suspense>
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
      <Route path="/access" element={<SessionBridgePage />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
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
