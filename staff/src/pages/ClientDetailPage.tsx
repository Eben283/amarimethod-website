import { useState, useEffect } from 'react';
import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
import { ArrowLeft, Loader2, RefreshCw, Phone, Mail } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { getContactDetail, ApiError } from '../lib/api';
import type { ContactDetail } from '../types/staff';
import SessionStats from '../components/SessionStats';
import NotesList from '../components/NotesList';
import AddNoteModal from '../components/AddNoteModal';
import MessageHistory from '../components/MessageHistory';
import Checklist from '../components/Checklist';
import QuizResultsCard from '../components/QuizResults';
import SessionBrief from '../components/SessionBrief';

export default function ClientDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [searchParams] = useSearchParams();
  const appointmentId = searchParams.get('appointment');
  const navigate = useNavigate();
  const { logout } = useAuth();

  const [client, setClient] = useState<ContactDetail | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');
  const [showAddNote, setShowAddNote] = useState(false);

  async function loadClient() {
    if (!id) return;
    setIsLoading(true);
    setError('');
    try {
      const data = await getContactDetail(id);
      setClient(data);
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        logout();
        return;
      }
      setError(err instanceof Error ? err.message : 'Failed to load client');
    } finally {
      setIsLoading(false);
    }
  }

  useEffect(() => {
    loadClient();
  }, [id]);

  if (isLoading && !client) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="w-8 h-8 text-amari-charcoal animate-spin" />
      </div>
    );
  }

  if (error && !client) {
    return (
      <div className="min-h-screen px-4 pt-6">
        <button onClick={() => navigate(-1)} className="flex items-center gap-1 text-amari-text-muted mb-4 min-h-[44px]">
          <ArrowLeft className="w-5 h-5" /> Back
        </button>
        <div className="staff-card text-center py-8">
          <p className="text-red-500 text-sm mb-3">{error}</p>
          <button onClick={loadClient} className="staff-btn-secondary text-sm">Try Again</button>
        </div>
      </div>
    );
  }

  if (!client) return null;

  const fullName = [client.firstName, client.lastName].filter(Boolean).join(' ') || 'Unknown';

  return (
    <div className="min-h-screen px-4 pt-6 pb-8">
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <button onClick={() => navigate(-1)} className="flex items-center gap-1 text-amari-text-muted min-h-[44px]">
          <ArrowLeft className="w-5 h-5" /> Back
        </button>
        <button
          onClick={loadClient}
          disabled={isLoading}
          className="p-2 rounded-lg hover:bg-amari-light-sand min-w-[44px] min-h-[44px] flex items-center justify-center"
        >
          <RefreshCw className={`w-5 h-5 text-amari-text-muted ${isLoading ? 'animate-spin' : ''}`} />
        </button>
      </div>

      {/* Client name + contact */}
      <div className="mb-4">
        <h1 className="text-2xl font-serif text-amari-charcoal">{fullName}</h1>
        <div className="flex items-center gap-4 mt-2">
          {client.phone && (
            <a href={`tel:${client.phone}`} className="flex items-center gap-1 text-sm text-amari-accent-warm min-h-[44px]">
              <Phone className="w-4 h-4" /> {client.phone}
            </a>
          )}
          {client.email && (
            <a href={`mailto:${client.email}`} className="flex items-center gap-1 text-sm text-amari-accent-warm min-h-[44px]">
              <Mail className="w-4 h-4" /> Email
            </a>
          )}
        </div>
      </div>

      {/* Session Brief — the 30-second read before the client walks in */}
      <div className="mb-4">
        <SessionBrief client={client} />
      </div>

      {/* Session Stats */}
      <SessionStats
        seriesType={client.seriesType}
        sessionsCompleted={client.sessionsCompleted}
        sessionsRemaining={client.sessionsRemaining}
        tags={client.tags}
      />

      {/* Quiz Results */}
      {client.quizResults && (
        <div className="mt-4">
          <QuizResultsCard results={client.quizResults} />
        </div>
      )}

      {/* Checklist (only when navigated from Today) */}
      {appointmentId && (
        <div className="mt-4">
          <Checklist
            appointmentId={appointmentId}
            client={client}
          />
        </div>
      )}

      {/* Appointments */}
      <div className="mt-4">
        <h2 className="text-lg font-serif text-amari-charcoal mb-2">Appointments</h2>
        {client.appointments.length === 0 ? (
          <p className="text-sm text-amari-text-muted">No appointments</p>
        ) : (
          <div className="space-y-2">
            {client.appointments.map((appt) => {
              const date = new Date(appt.startTime);
              const isPast = date < new Date();
              return (
                <div key={appt.id} className={`staff-card ${isPast ? 'opacity-60' : ''}`}>
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm font-medium">{appt.title}</p>
                      <p className="text-xs text-amari-text-muted">
                        {date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} at{' '}
                        {date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}
                      </p>
                    </div>
                    <span className={`text-xs px-2 py-1 rounded-full ${
                      appt.status === 'confirmed' ? 'bg-green-50 text-green-700' :
                      appt.status === 'completed' || appt.status === 'showed' ? 'bg-amari-light-sand text-amari-text-secondary' :
                      appt.status === 'cancelled' ? 'bg-red-50 text-red-600' :
                      'bg-gray-50 text-gray-600'
                    }`}>
                      {appt.status}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Notes */}
      <div className="mt-4">
        <div className="flex items-center justify-between mb-2">
          <h2 className="text-lg font-serif text-amari-charcoal">Notes</h2>
          <button
            onClick={() => setShowAddNote(true)}
            className="staff-btn-secondary text-xs px-3 py-1.5 min-h-[36px]"
          >
            + Add Note
          </button>
        </div>
        <NotesList notes={client.notes} />
      </div>

      {/* Messages */}
      <div className="mt-4">
        <h2 className="text-lg font-serif text-amari-charcoal mb-2">Recent Messages</h2>
        <MessageHistory messages={client.messages} />
      </div>

      {/* Add Note Modal */}
      {showAddNote && (
        <AddNoteModal
          contactId={client.id}
          onClose={() => setShowAddNote(false)}
          onSaved={() => {
            setShowAddNote(false);
            loadClient();
          }}
        />
      )}
    </div>
  );
}
