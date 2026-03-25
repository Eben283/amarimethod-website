import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { RefreshCw, Loader2 } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { getTodayData, ApiError } from '../lib/api';
import type { TodayAppointment } from '../types/staff';
import AppointmentCard from '../components/AppointmentCard';

export default function TodayPage() {
  const { logout } = useAuth();
  const navigate = useNavigate();
  const [appointments, setAppointments] = useState<TodayAppointment[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');

  async function loadData() {
    setIsLoading(true);
    setError('');
    try {
      const data = await getTodayData();
      setAppointments(data);
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        logout();
        return;
      }
      setError(err instanceof Error ? err.message : 'Failed to load data');
    } finally {
      setIsLoading(false);
    }
  }

  useEffect(() => {
    loadData();
  }, []);

  const now = new Date();
  const dateStr = now.toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
  });

  return (
    <div className="px-4 pt-6 pb-4">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-serif text-amari-charcoal">Today</h1>
          <p className="text-sm text-amari-text-muted">{dateStr}</p>
        </div>
        <button
          onClick={loadData}
          disabled={isLoading}
          className="p-2 rounded-lg hover:bg-amari-light-sand active:bg-amari-border transition-colors min-w-[44px] min-h-[44px] flex items-center justify-center"
        >
          <RefreshCw className={`w-5 h-5 text-amari-text-muted ${isLoading ? 'animate-spin' : ''}`} />
        </button>
      </div>

      {/* Content */}
      {isLoading && appointments.length === 0 ? (
        <div className="flex items-center justify-center py-16">
          <Loader2 className="w-8 h-8 text-amari-charcoal animate-spin" />
        </div>
      ) : error ? (
        <div className="staff-card text-center py-8">
          <p className="text-red-500 text-sm mb-3">{error}</p>
          <button onClick={loadData} className="staff-btn-secondary text-sm">
            Try Again
          </button>
        </div>
      ) : appointments.length === 0 ? (
        <div className="staff-card text-center py-12">
          <p className="text-amari-text-muted">No appointments today</p>
        </div>
      ) : (
        <div className="space-y-3">
          {appointments.map((appt) => (
            <AppointmentCard
              key={appt.id}
              appointment={appt}
              onTap={() => navigate(`/client/${appt.contactId}?appointment=${appt.id}`)}
            />
          ))}
        </div>
      )}
    </div>
  );
}
