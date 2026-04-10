import { useState, useEffect } from 'react';
import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
import { ArrowLeft, Loader2, RefreshCw, Phone, Mail, CheckCircle2, Circle, Send, XCircle } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { getContactDetail, markAttended, sendToolkit, markNotAFit, saveProgress, togglePrepaid, ApiError } from '../lib/api';
import type { ContactDetail, ContactAppointment } from '../types/staff';
import SessionStats from '../components/SessionStats';
import PaymentStatus from '../components/PaymentStatus';
import NotesList from '../components/NotesList';
import AddNoteModal from '../components/AddNoteModal';
import MessageHistory from '../components/MessageHistory';
import Checklist from '../components/Checklist';
import QuizResultsCard from '../components/QuizResults';
import SessionBrief from '../components/SessionBrief';
import ModuleTracker from '../components/ModuleTracker';
import BodyGraph from '../components/BodyGraph';
import { defaultData, type ClientModuleData } from '../data/moduleStorage';

export default function ClientDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [searchParams] = useSearchParams();
  const appointmentId = searchParams.get('appointment');
  const focus = searchParams.get('focus');
  const navigate = useNavigate();
  const { logout } = useAuth();

  const [client, setClient] = useState<ContactDetail | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');
  const [showAddNote, setShowAddNote] = useState(false);
  const [markingAttended, setMarkingAttended] = useState<string | null>(null);
  const [attendedError, setAttendedError] = useState('');
  const [sendingToolkit, setSendingToolkit] = useState(false);
  const [toolkitStatus, setToolkitStatus] = useState<'idle' | 'sent' | 'error'>('idle');
  const [togglingPrepaid, setTogglingPrepaid] = useState(false);
  const [markingNotFit, setMarkingNotFit] = useState(false);
  const [notFitStatus, setNotFitStatus] = useState<'idle' | 'done' | 'error'>('idle');
  const [progress, setProgress] = useState<ClientModuleData>(defaultData());
  const saveTimerRef = useState<ReturnType<typeof setTimeout> | null>(null);

  function handleProgressUpdate(next: ClientModuleData) {
    setProgress(next);
    // Debounce save to GHL — wait 800ms after last change
    if (saveTimerRef[0]) clearTimeout(saveTimerRef[0]);
    saveTimerRef[0] = setTimeout(() => {
      if (client) {
        saveProgress(client.id, next).catch((err) => {
          console.error('Failed to save progress:', err);
        });
      }
    }, 800);
  }

  async function handleMarkAttended(appt: ContactAppointment) {
    if (!client || markingAttended) return;
    setMarkingAttended(appt.id);
    setAttendedError('');
    try {
      const result = await markAttended(appt.id, client.id, appt.title, appt.calendarName);
      // Update local state immutably — mark as showed regardless of whether
      // it was already attended (idempotent: SMS trigger may have fired first)
      setClient({
        ...client,
        sessionsCompleted: result.sessionsCompleted,
        sessionsRemaining: result.sessionsRemaining,
        appointments: client.appointments.map((a) =>
          a.id === appt.id ? { ...a, status: 'showed' } : a
        ),
      });
      if (result.alreadyAttended) {
        setAttendedError('Already marked as attended (SMS or workflow handled it)');
        setTimeout(() => setAttendedError(''), 3000);
      }
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        logout();
        return;
      }
      setAttendedError(err instanceof Error ? err.message : 'Failed to mark attended');
    } finally {
      setMarkingAttended(null);
    }
  }

  async function handleTogglePrepaid() {
    if (!client || togglingPrepaid) return;
    setTogglingPrepaid(true);
    try {
      const newValue = !client.sessionPrepaid;
      await togglePrepaid(client.id, newValue);
      setClient({ ...client, sessionPrepaid: newValue });
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        logout();
        return;
      }
    } finally {
      setTogglingPrepaid(false);
    }
  }

  async function handleSendToolkit() {
    if (!client || sendingToolkit) return;
    setSendingToolkit(true);
    setToolkitStatus('idle');
    try {
      await sendToolkit(client.id);
      setToolkitStatus('sent');
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        logout();
        return;
      }
      setToolkitStatus('error');
    } finally {
      setSendingToolkit(false);
    }
  }

  async function handleNotAFit() {
    if (!client || markingNotFit) return;
    setMarkingNotFit(true);
    setNotFitStatus('idle');
    try {
      await markNotAFit(client.id);
      setNotFitStatus('done');
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        logout();
        return;
      }
      setNotFitStatus('error');
    } finally {
      setMarkingNotFit(false);
    }
  }

  async function loadClient() {
    if (!id) return;
    setIsLoading(true);
    setError('');
    try {
      const data = await getContactDetail(id);
      setClient(data);
      setProgress(data.clientProgress ? { ...defaultData(), ...data.clientProgress } : defaultData());
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

  // Scroll to the messages section when arriving from the Messages tab
  useEffect(() => {
    if (!client || focus !== 'messages') return;
    const el = document.getElementById('messages-section');
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }, [client, focus]);

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

      {/* Partner actions — for affiliate partners and contacts with partner session booked */}
      {(client.tags.includes('affiliate-partner') || client.tags.includes('partner-session-booked')) && (
        <div className="mb-4 space-y-2">
          <button
            onClick={handleSendToolkit}
            disabled={sendingToolkit || toolkitStatus === 'sent' || notFitStatus === 'done'}
            className={`w-full flex items-center justify-center gap-2 px-4 py-3 rounded-lg text-sm font-medium transition-all min-h-[44px] ${
              toolkitStatus === 'sent'
                ? 'bg-green-50 text-green-700 border border-green-200'
                : 'bg-amari-accent-warm text-white hover:bg-[#e0926f] active:bg-[#d4825f] disabled:opacity-50'
            }`}
          >
            {sendingToolkit ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : toolkitStatus === 'sent' ? (
              <CheckCircle2 className="w-4 h-4" />
            ) : (
              <Send className="w-4 h-4" />
            )}
            {toolkitStatus === 'sent' ? 'Toolkit Sent' : toolkitStatus === 'error' ? 'Failed — Tap to Retry' : 'Send Partner Toolkit'}
          </button>
          {!client.tags.includes('affiliate-partner') && toolkitStatus !== 'sent' && (
            <button
              onClick={handleNotAFit}
              disabled={markingNotFit || notFitStatus === 'done'}
              className={`w-full flex items-center justify-center gap-2 px-4 py-3 rounded-lg text-sm font-medium transition-all min-h-[44px] ${
                notFitStatus === 'done'
                  ? 'bg-gray-50 text-gray-500 border border-gray-200'
                  : 'bg-gray-100 text-gray-700 hover:bg-gray-200 active:bg-gray-300 disabled:opacity-50'
              }`}
            >
              {markingNotFit ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : notFitStatus === 'done' ? (
                <CheckCircle2 className="w-4 h-4" />
              ) : (
                <XCircle className="w-4 h-4" />
              )}
              {notFitStatus === 'done' ? 'Marked — Future Potential' : notFitStatus === 'error' ? 'Failed — Tap to Retry' : 'Not a Fit'}
            </button>
          )}
        </div>
      )}

      {/* Session Brief — the 30-second read before the client walks in */}
      <div className="mb-4">
        <SessionBrief client={client} />
      </div>

      {/* Module Tracker — which exercises has Garrett taught this client */}
      <div className="mb-4">
        <ModuleTracker data={progress} onUpdate={handleProgressUpdate} />
      </div>

      {/* Body Map — active/passive region marking */}
      <div className="mb-4">
        <BodyGraph data={progress} onUpdate={handleProgressUpdate} />
      </div>

      {/* Payment Status */}
      <div className="mt-4">
        <PaymentStatus
          sessionPrepaid={client.sessionPrepaid}
          sessionsRemaining={client.sessionsRemaining}
          seriesType={client.seriesType}
          onToggle={handleTogglePrepaid}
          isToggling={togglingPrepaid}
        />
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
        {attendedError && (
          <div className="bg-red-50 text-red-600 text-xs px-3 py-2 rounded-lg mb-2">{attendedError}</div>
        )}
        {client.appointments.length === 0 ? (
          <p className="text-sm text-amari-text-muted">No appointments</p>
        ) : (
          <div className="space-y-2">
            {client.appointments.map((appt) => {
              const date = new Date(appt.startTime);
              const isPast = date < new Date();
              const canMarkAttended = isPast && appt.status !== 'showed' && appt.status !== 'completed' && appt.status !== 'cancelled';
              const isMarking = markingAttended === appt.id;
              const isAttended = appt.status === 'showed' || appt.status === 'completed';
              return (
                <div key={appt.id} className={`staff-card ${isPast && !canMarkAttended && !isAttended ? 'opacity-60' : ''}`}>
                  <div className="flex items-center justify-between">
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium">{appt.title}</p>
                      <p className="text-xs text-amari-text-muted">
                        {date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} at{' '}
                        {date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}
                        {appt.calendarName && ` · ${appt.calendarName}`}
                      </p>
                    </div>
                    <div className="flex items-center gap-2 flex-shrink-0">
                      {canMarkAttended ? (
                        <button
                          onClick={() => handleMarkAttended(appt)}
                          disabled={isMarking}
                          className="flex items-center gap-2 group"
                          aria-label="Mark as attended"
                        >
                          <span className="text-xs text-gray-400 group-hover:text-gray-600 transition-colors">
                            {isMarking ? 'Marking…' : 'Attended'}
                          </span>
                          <div className={`relative w-11 h-6 rounded-full transition-colors ${
                            isMarking ? 'bg-gray-300' : 'bg-gray-300 group-hover:bg-gray-400'
                          }`}>
                            <div className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform flex items-center justify-center ${
                              isMarking ? 'translate-x-0' : 'translate-x-0'
                            }`}>
                              {isMarking ? (
                                <Loader2 className="w-3 h-3 text-gray-400 animate-spin" />
                              ) : (
                                <Circle className="w-3 h-3 text-gray-400" />
                              )}
                            </div>
                          </div>
                        </button>
                      ) : isAttended ? (
                        <div className="flex items-center gap-2">
                          <span className="text-xs text-emerald-600 font-medium">Attended</span>
                          <div className="relative w-11 h-6 rounded-full bg-emerald-500">
                            <div className="absolute top-0.5 right-0.5 w-5 h-5 rounded-full bg-white shadow flex items-center justify-center">
                              <CheckCircle2 className="w-3 h-3 text-emerald-500" />
                            </div>
                          </div>
                        </div>
                      ) : appt.status === 'cancelled' ? (
                        <span className="text-xs px-2 py-1 rounded-full bg-red-50 text-red-600">cancelled</span>
                      ) : (
                        <span className="text-xs px-2 py-1 rounded-full bg-gray-50 text-gray-600">{appt.status}</span>
                      )}
                    </div>
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
      <div id="messages-section" className="mt-4 scroll-mt-4">
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
