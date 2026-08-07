import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { Loader2 } from 'lucide-react';
import { ParkingAuthProvider, useParkingAuth } from './contexts/ParkingAuthContext';
import ParkingLoginPage from './pages/ParkingLoginPage';
import ParkingPage from './pages/ParkingPage';

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { isAuthenticated, isLoading } = useParkingAuth();
  if (isLoading) return <div className="min-h-screen flex items-center justify-center bg-cos-bg"><Loader2 className="w-6 h-6 text-cos-accent animate-spin" /></div>;
  return isAuthenticated ? <>{children}</> : <Navigate to="/login" replace />;
}

function PublicRoute({ children }: { children: React.ReactNode }) {
  const { isAuthenticated, isLoading } = useParkingAuth();
  if (isLoading) return <div className="min-h-screen flex items-center justify-center bg-cos-bg"><Loader2 className="w-6 h-6 text-cos-accent animate-spin" /></div>;
  return isAuthenticated ? <Navigate to="/" replace /> : <>{children}</>;
}

function RoutesForParking() {
  return <Routes>
    <Route path="/" element={<ProtectedRoute><ParkingPage /></ProtectedRoute>} />
    <Route path="/login" element={<PublicRoute><ParkingLoginPage /></PublicRoute>} />
    <Route path="*" element={<Navigate to="/" replace />} />
  </Routes>;
}

export default function ParkingApp() {
  return <ParkingAuthProvider><BrowserRouter basename="/parking"><RoutesForParking /></BrowserRouter></ParkingAuthProvider>;
}
