import { useState, useEffect, useRef, type CSSProperties } from 'react';
import { Link, useParams, useNavigate, useSearchParams } from 'react-router-dom';
import {
  ArrowLeft, ArrowUpRight, Loader2, RefreshCw, MessageSquareText, CheckCircle2, Send,
  ClipboardCheck, Check, ChevronRight, DollarSign, House, User, Plus, Pencil,
  CalendarDays, CircleDollarSign, Dumbbell, BookOpenText, Focus,
  NotebookPen, Workflow,
} from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { getContactAutomationEvidence, getContactDetail, markAttended, sendToolkit, saveProgress, sendPayLink, sendFollowupText, getOwedStatus, ApiError, type PayLinkProduct, type PaymentCapture, type OwedStatus } from '../lib/api';
import { automationDrilldownPath } from '../lib/automation-navigation';
import { memberWorkspacePath, type MemberWorkspaceSurface } from '../lib/member-workspace';
import { buildGoogleReviewRequest } from '../lib/review-request';
import type { ContactAutomationEvidence, ContactDetail, ContactAppointment, ContactNote, PaymentStatus } from '../types/staff';
import AddNoteModal from '../components/AddNoteModal';
import BodyMapCanvas from '../components/BodyMapCanvas';
import { buildSessionBrief, visitLabel } from '../components/SessionBrief';
import LedgerWarning from '../components/LedgerWarning';
import StudyCapturePanel from '../components/StudyCapturePanel';
import {
  MODULES, toggleModule, setYogaBlockSize, defaultData, type ClientModuleData,
} from '../data/moduleStorage';
import { studyFromTags } from '../data/studies';
import { isEditableStaffNote, isSystemNote } from '../../../shared/staff-note-policy.js';
import '../styles/session-a.css';

// Clear, obviously-tappable button style for the payment chooser (was styled like plain text).
const PAY_BTN: CSSProperties = { padding: '9px 14px', borderRadius: 9, border: '1px solid #cbd5e1', background: '#fff', fontSize: 13, fontWeight: 600, color: '#334155', cursor: 'pointer' };

// ── small display helpers ─────────────────────────────────────────────────
function fmtDate(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function fmtTime(iso: string): string {
  return new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
}

function fmtDateTime(value: string | number): string {
  const d = new Date(value);
  if (isNaN(d.getTime())) return 'Time unavailable';
  return d.toLocaleString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric',
    hour: 'numeric', minute: '2-digit', timeZoneName: 'short',
  });
}

function humanizeEvidence(value: string): string {
  return value.replace(/[_-]+/g, ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());
}

// "2026-05-22" → "May 22, 2026" (noon avoids any timezone off-by-one).
function fmtPurchaseDate(d: string | null): string {
  if (!d) return '—';
  const dt = new Date(`${d}T12:00:00`);
  return isNaN(dt.getTime()) ? d : dt.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

// Per-session payment pill styling. `unknown` renders no pill (honest blank —
// the session just hasn't had its payment recorded yet).
const PAYMENT_PILL: Record<PaymentStatus, { label: string; bg: string; fg: string } | null> = {
  paid: { label: 'Paid', bg: '#dcfce7', fg: '#15803d' },
  comped: { label: 'Comped', bg: '#ede9fe', fg: '#6d28d9' },
  'on-package': { label: 'On package', bg: '#e0f2fe', fg: '#0369a1' },
  'pay-next-visit': { label: 'Pay next visit', bg: '#fef9c3', fg: '#a16207' },
  owed: { label: 'Owed', bg: '#fee2e2', fg: '#b91c1c' },
  unknown: null,
};

// A note body can carry an embedded signature as a base64 <img> (the policy-attestation
// flow does this). Pull the image out so it renders as an actual small image, and strip
// the raw <img>/base64 markup from the text so we don't dump a wall of base64.
function splitNoteBody(body: string): { text: string; signature: string | null } {
  const img = body.match(/<img[^>]*\bsrc=["'](data:image\/[^"']+)["'][^>]*>/i);
  const signature = img ? img[1] : null;
  let text = body;
  if (img) text = text.replace(img[0], '').replace(/Signature:\s*$/im, '').trimEnd();
  // safety net: collapse any stray base64 image blob to a placeholder
  text = text.replace(/data:image\/[A-Za-z0-9.+-]+;base64,[A-Za-z0-9+/=\s]+/g, '[signature image]').trim();
  return { text, signature };
}

export default function ClientDetailPage({ surface = 'record' }: { surface?: MemberWorkspaceSurface }) {
  const { id } = useParams<{ id: string }>();
  const [searchParams] = useSearchParams();
  const appointmentId = searchParams.get('appointment');
  const debugMode = searchParams.get('debug') === '1';
  const navigate = useNavigate();
  const { logout } = useAuth();
  const isSession = surface === 'session';

  const [client, setClient] = useState<ContactDetail | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');
  const [showAddNote, setShowAddNote] = useState(false);
  const [editingNote, setEditingNote] = useState<ContactNote | null>(null);
  const [markingAttended, setMarkingAttended] = useState<string | null>(null);
  const [attendedError, setAttendedError] = useState('');
  // Per-session payment capture: which appointment's "how was this paid?"
  // chooser is open, and the comp-note draft for it.
  const [payingApptId, setPayingApptId] = useState<string | null>(null);
  const [compNoteDraft, setCompNoteDraft] = useState('');
  // Owed status (Stripe-grounded) — lazy-loaded after the page renders.
  const [owed, setOwed] = useState<OwedStatus | null>(null);
  const [sendingToolkit, setSendingToolkit] = useState(false);
  const [toolkitStatus, setToolkitStatus] = useState<'idle' | 'sent' | 'error'>('idle');
  const [payLinkStatus, setPayLinkStatus] = useState<Record<string, 'idle' | 'sending' | 'sent' | 'error'>>({});
  const [payOpen, setPayOpen] = useState(false);
  const [toolkitOpen, setToolkitOpen] = useState(false);
  const [showMorePayLinks, setShowMorePayLinks] = useState(false);
  const [reviewOpen, setReviewOpen] = useState(false);
  const [reviewMessage, setReviewMessage] = useState('');
  const [reviewStatus, setReviewStatus] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle');
  const [reviewError, setReviewError] = useState('');
  const [progress, setProgress] = useState<ClientModuleData>(defaultData());
  const [automationEvidence, setAutomationEvidence] = useState<ContactAutomationEvidence | null>(null);
  const [automationEvidenceLoading, setAutomationEvidenceLoading] = useState(false);
  const [automationEvidenceError, setAutomationEvidenceError] = useState('');

  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    };
  }, []);

  function handleProgressUpdate(next: ClientModuleData) {
    setProgress(next);
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => {
      if (client) {
        saveProgress(client.id, next).catch((err) => {
          console.error('Failed to save progress:', err);
        });
      }
    }, 800);
  }

  async function handleMarkAttended(appt: ContactAppointment, payment?: PaymentCapture) {
    if (!client || markingAttended) return;
    setMarkingAttended(appt.id);
    setAttendedError('');
    try {
      const result = await markAttended(appt.id, client.id, appt.title, appt.calendarName, payment);
      // Optimistically update the appointment row only. The endpoint's
      // sessionsCompleted/sessionsRemaining come from the RAW GHL fields,
      // while this page displays ledger-derived numbers — splicing them in
      // made the counts visibly jump basis until the next refetch. loadClient
      // below re-derives everything from the same source the page renders.
      setClient({
        ...client,
        appointments: client.appointments.map((a) => {
          if (a.id !== appt.id) return a;
          // Optimistic per-session status: explicit choice wins; otherwise the
          // backend only auto-records "on-package" (when an active pack covered it).
          let paymentStatus = a.paymentStatus;
          if (payment?.paymentStatus) paymentStatus = payment.paymentStatus as PaymentStatus;
          else if (result.paymentRecorded) paymentStatus = 'on-package';
          return { ...a, status: 'showed', paymentStatus, paymentNote: payment?.compNote ?? a.paymentNote };
        }),
      });
      // Re-derive counts from the server (ledger basis). The spinner only
      // shows when no client is loaded, so this refresh is visually silent.
      loadClient();
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
      setPayingApptId(null);
      setCompNoteDraft('');
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

  async function handleSendPayLink(product: PayLinkProduct) {
    if (!client) return;
    if (payLinkStatus[product] === 'sending') return;
    setPayLinkStatus((s) => ({ ...s, [product]: 'sending' }));
    try {
      await sendPayLink(client.id, product);
      setPayLinkStatus((s) => ({ ...s, [product]: 'sent' }));
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        logout();
        return;
      }
      setPayLinkStatus((s) => ({ ...s, [product]: 'error' }));
    }
  }

  function toggleReviewComposer() {
    if (!client || reviewStatus === 'sent') return;
    if (!reviewOpen && !reviewMessage) setReviewMessage(buildGoogleReviewRequest(client.firstName));
    setReviewOpen(!reviewOpen);
    setReviewStatus('idle');
    setReviewError('');
  }

  async function handleSendReviewRequest() {
    if (!client || reviewStatus === 'sending') return;
    const message = reviewMessage.trim();
    if (!message) {
      setReviewStatus('error');
      setReviewError('Add a message before sending.');
      return;
    }
    setReviewStatus('sending');
    setReviewError('');
    try {
      const result = await sendFollowupText(client.id, message);
      setReviewStatus('sent');
      if (result.deduped) setReviewError('This exact message was already sent a moment ago.');
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        logout();
        return;
      }
      setReviewStatus('error');
      setReviewError(err instanceof Error ? err.message : 'Could not send the review request.');
    }
  }

  function renderPayRow(product: PayLinkProduct, label: string, price: string, legacy = false) {
    const status = payLinkStatus[product] || 'idle';
    const isSending = status === 'sending';
    const isSent = status === 'sent';
    const isError = status === 'error';
    return (
      <button
        key={product}
        onClick={() => handleSendPayLink(product)}
        disabled={isSending || isSent}
        className={`sa-pay-row${isSent ? ' is-sent' : ''}${isError ? ' is-error' : ''}`}
      >
        <span className="ic">
          {isSending ? <Loader2 size={15} className="sa-spin" /> : isSent ? <Check size={15} /> : <Send size={15} />}
        </span>
        <span className="nm">
          {isSent ? `${label} sent` : isError ? `${label} — retry` : `Send ${label}`}
          {legacy && <span className="sa-legacy-badge">Legacy</span>}
        </span>
        <span className="pr">{price}</span>
      </button>
    );
  }

  async function loadClient() {
    if (!id) return;
    setIsLoading(true);
    setError('');
    try {
      const data = await getContactDetail(id, debugMode);
      setClient(data);
      setProgress(data.clientProgress ? { ...defaultData(), ...data.clientProgress } : defaultData());
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        logout();
        return;
      }
      setError(err instanceof Error ? err.message : 'Failed to load practice member');
    } finally {
      setIsLoading(false);
    }
  }

  useEffect(() => {
    loadClient();
  }, [id]);

  // A route change can reuse this component. Never carry an unsent review
  // message or sent state from one practice member into another's session.
  useEffect(() => {
    setReviewOpen(false);
    setReviewMessage('');
    setReviewStatus('idle');
    setReviewError('');
  }, [id]);

  // Lazy-load Stripe-grounded owed status (separate, non-blocking — a Stripe
  // hiccup must never stop the page from rendering).
  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    setOwed(null);
    getOwedStatus(id)
      .then((r) => { if (!cancelled) setOwed(r); })
      .catch(() => { if (!cancelled) setOwed(null); });
    return () => { cancelled = true; };
  }, [id]);

  // Read-only automation evidence is intentionally independent from the GHL
  // contact request. If the D1 evidence spine is unavailable, the rest of the
  // person workspace still renders and says exactly what is missing.
  useEffect(() => {
    if (!id || isSession) {
      setAutomationEvidence(null);
      setAutomationEvidenceError('');
      setAutomationEvidenceLoading(false);
      return;
    }
    let cancelled = false;
    setAutomationEvidence(null);
    setAutomationEvidenceError('');
    setAutomationEvidenceLoading(true);
    getContactAutomationEvidence(id)
      .then((data) => { if (!cancelled) setAutomationEvidence(data); })
      .catch((err) => {
        if (cancelled) return;
        if (err instanceof ApiError && err.status === 401) {
          logout();
          return;
        }
        setAutomationEvidenceError(err instanceof Error ? err.message : 'Automation evidence unavailable');
      })
      .finally(() => { if (!cancelled) setAutomationEvidenceLoading(false); });
    return () => { cancelled = true; };
  }, [id, isSession, logout]);

  // Refetch when the tab regains focus.
  useEffect(() => {
    function onVisible() {
      if (document.visibilityState === 'visible') loadClient();
    }
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('focus', onVisible);
    return () => {
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('focus', onVisible);
    };
  }, [id]);

  if (isLoading && !client) {
    return (
      <div className="sa">
        <div className="sa-screen"><Loader2 className="sa-spin" size={30} /></div>
      </div>
    );
  }

  if (error && !client) {
    return (
      <div className="sa">
        <div className="sa-screen" style={{ flexDirection: 'column', gap: 16, padding: 24, textAlign: 'center' }}>
          <p className="sa-errbar">{error}</p>
          <button className="sa-note-add" onClick={loadClient}>Try again</button>
        </div>
      </div>
    );
  }

  if (!client) return null;

  const fullName = [client.firstName, client.lastName].filter(Boolean).join(' ') || 'Unknown';
  const isPartner = client.tags.includes('affiliate-partner');
  const isFoundersCircle = client.isFoundersCircle || client.tags.some((t) => t.toLowerCase() === 'founders-circle');
  const study = studyFromTags(client.tags);
  const roleWord = isPartner
    ? 'Referral partner'
    : isFoundersCircle
      ? "Founder's Circle practice member"
      : client.seriesType !== 'none'
        ? `${client.seriesType.replace('-session', '')}-session practice member`
        : 'Practice Member';

  // session progress numbers (same math as SessionStats)
  const totalSessions = client.seriesType === '8-session' ? 8 : client.seriesType === '4-session' ? 4 : 0;
  const currentSeriesCompleted = totalSessions > 0 ? Math.max(0, totalSessions - client.sessionsRemaining) : 0;
  const progressPct = totalSessions > 0 ? Math.min(100, (currentSeriesCompleted / totalSessions) * 100) : 0;
  const packageLabel = client.seriesType === 'none' ? '—' : client.seriesType.replace('-session', '');
  const isReturning = client.sessionsCompleted > currentSeriesCompleted;

  const taughtCount = MODULES.filter((m) => progress.modules[m.id]).length;
  const modPct = Math.round((taughtCount / MODULES.length) * 100);

  // payment banner visibility (same rule as before)
  const hasActiveSeries = client.seriesType !== 'none' && client.sessionsRemaining > 0;
  const now = Date.now();
  const hasUpcomingAppt = client.appointments.some(
    (a) => new Date(a.startTime).getTime() >= now && a.status !== 'cancelled',
  );
  const showPaymentBanner = !(hasActiveSeries || !hasUpcomingAppt);
  const nextAppointment = client.appointments
    .filter((appointment) => new Date(appointment.startTime).getTime() >= now && appointment.status !== 'cancelled')
    .sort((a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime())[0];
  const automationEvents = (automationEvidence?.events || []).slice(0, 8);
  const automationEnrollments = automationEvidence?.enrollments || [];
  const activeEnrollments = automationEnrollments.filter((enrollment) => enrollment.status === 'active');
  const nextScheduledSteps = activeEnrollments
    .filter((enrollment) => enrollment.nextStep?.dueAt)
    .sort((a, b) => (a.nextStep?.dueAt || 0) - (b.nextStep?.dueAt || 0));
  const nextScheduledStep = nextScheduledSteps[0]?.nextStep || null;
  const failedAutomationEvents = automationEvents.filter((event) => ['failed', 'bounced', 'error'].includes((event.outcome || '').toLowerCase()));
  // This action is deliberately available only from a particular appointment,
  // not a general client lookup. Garrett makes the positive-session judgment
  // and still has to review/edit and explicitly send the text.
  const sessionAppointment = appointmentId
    ? client.appointments.find((appointment) => appointment.id === appointmentId)
    : undefined;
  const currentVisit = sessionAppointment || nextAppointment || client.appointments
    .filter((appointment) => appointment.status !== 'cancelled')
    .sort((a, b) => new Date(b.startTime).getTime() - new Date(a.startTime).getTime())[0];
  const canRequestReview = Boolean(sessionAppointment && client.phone);

  // A client has agreed to the practice-member agreement via EITHER flow:
  //   - in-app staff check-in  → tag policies-signed-practice-member-v2026-04-17
  //   - website booking flow    → tag agreed-pma-v2026-04-17 (create-checkout.js)
  // Both are the same v2026-04-17 agreement; check either so booking-flow clients
  // (the majority) aren't wrongly told to sign again.
  // Prefer the server's agreementSigned (covers tags AND a signature-on-file
  // for older/migrated/form signers); fall back to the tag check if absent.
  const SIGNED_TAGS = ['policies-signed-practice-member-v2026-04-17', 'agreed-pma-v2026-04-17'];
  const alreadySigned = client.agreementSigned ?? SIGNED_TAGS.some((t) => client.tags.includes(t));
  const quiz = client.quizResults;
  const visibleNotes = client.notes.filter((note) => !isSystemNote(note.body));
  const currentVisitDate = currentVisit ? new Date(currentVisit.startTime) : null;
  const currentVisitAttended = currentVisit ? currentVisit.status === 'showed' || currentVisit.status === 'completed' : false;
  const currentVisitCanMark = Boolean(currentVisit && currentVisitDate
    && currentVisitDate.getTime() <= Date.now() + 2 * 60 * 60 * 1000
    && !currentVisitAttended && currentVisit.status !== 'cancelled');
  const currentVisitIsGift = Boolean(currentVisit
    && (/partner initial/i.test(currentVisit.calendarName || '') || /partner initial/i.test(currentVisit.title || '')));
  const currentVisitChoosingPayment = Boolean(currentVisit && payingApptId === currentVisit.id);

  return (
    <div className="sa">
      {/* ── sticky identity header ── */}
      <header className="sa-head">
        <div className="sa-head-top">
          <div className="sa-head-nav">
            <button className="sa-home" onClick={() => navigate('/')}>
              <House size={16} /><span>Home</span>
            </button>
            <button className="sa-back" onClick={() => navigate('/clients')}>
              <ArrowLeft size={18} /><span>All practice members</span>
            </button>
          </div>
          <button className="sa-sync" onClick={loadClient} disabled={isLoading}>
            <RefreshCw size={14} className={isLoading ? 'sa-spin' : ''} />
            <span>{isLoading ? 'Refreshing' : 'Refresh'}</span>
          </button>
        </div>
        <div className="sa-id">
          <div>
            <div className="sa-id-name">{fullName}</div>
            <div className="sa-id-sub">
              <span className="sa-chip"><User size={13} />{roleWord}</span>
              <span className="sa-surface-kicker">{isSession ? 'In session' : 'Member record'}</span>
            </div>
          </div>
        </div>
        <nav className="sa-surface-switch" aria-label={`${fullName} workspace`}>
          <Link
            className={!isSession ? 'is-active' : undefined}
            to={memberWorkspacePath(client.id, 'record', appointmentId)}
            aria-current={!isSession ? 'page' : undefined}
          >
            <BookOpenText size={17} />
            <span><b>Member record</b><small>History, workflows, money and admin</small></span>
          </Link>
          <Link
            className={isSession ? 'is-active' : undefined}
            to={memberWorkspacePath(client.id, 'session', appointmentId)}
            aria-current={isSession ? 'page' : undefined}
          >
            <Focus size={17} />
            <span><b>In session</b><small>Today’s visit, practice work and notes</small></span>
          </Link>
        </nav>
        <div className={`sa-context${isSession ? ' is-session' : ''}`} aria-label={isSession ? 'Current session context' : 'Practice member context'}>
          {isSession ? (
            <>
              <span><b>Visit</b>{currentVisit ? `${fmtDate(currentVisit.startTime)} · ${fmtTime(currentVisit.startTime)}` : 'No visit selected'}</span>
              <span><b>Visit type</b>{currentVisit ? currentVisit.title : visitLabel(client)}</span>
              <span><b>Sessions left</b>{client.sessionsRemaining}</span>
            </>
          ) : (
            <>
              <span><b>Email</b>{client.email || 'Not on file'}</span>
              <span><b>Mobile</b>{client.phone || 'Not on file'}</span>
              <span><b>Next appointment</b>{nextAppointment ? fmtDateTime(nextAppointment.startTime) : 'None scheduled'}</span>
              <span><b>Sessions left</b>{client.sessionsRemaining}</span>
              <span><b>Balance</b>{owed?.status === 'owed' ? `${owed.shortBy || 0} session${owed.shortBy === 1 ? '' : 's'} owed` : owed?.status === 'square' ? 'Paid up' : 'Verify if needed'}</span>
            </>
          )}
        </div>
        <nav className="sa-workspace-nav" aria-label={isSession ? `${fullName} in-session sections` : `${fullName} member record sections`}>
          {isSession ? (
            <>
              <a href="#session-brief"><User size={15} />Brief</a>
              <a href="#current-visit"><CalendarDays size={15} />Current visit</a>
              <a href="#practice-work"><Dumbbell size={15} />Practice work</a>
              <a href="#session-note"><NotebookPen size={15} />Session note</a>
            </>
          ) : (
            <>
              <a href="#record-overview"><User size={15} />Record</a>
              <a href="#workflows"><Workflow size={15} />Workflows</a>
              <a href="#money"><CircleDollarSign size={15} />Money</a>
              <a href="#sessions"><Dumbbell size={15} />Sessions</a>
              <a href="#appointments"><CalendarDays size={15} />Appointments</a>
              <a href="#notes"><NotebookPen size={15} />Notes</a>
            </>
          )}
        </nav>
      </header>

      <main className="sa-body">
        <div id={isSession ? 'session-brief' : 'record-overview'} className="sa-anchor" aria-hidden="true" />
        <div className="sa-group"><span className="gm" /><span className="gt">{isSession ? 'Session brief' : 'Member record'}</span><span className="gs">{isSession ? 'What matters in the room today' : 'Long-term relationship and administrative record'}</span><span className="gl" /></div>

        {isSession ? (
          <section className="sa-brief sa-session-opening">
            <span className="lbl">Arrive with context</span>
            <p>{buildSessionBrief(client)}</p>
          </section>
        ) : (
          <section className="sa-record-overview" aria-label="Member record overview">
            <div><span className="lbl">Relationship</span><strong>{roleWord}</strong><small>Added {fmtDate(client.dateAdded)}</small></div>
            <div><span className="lbl">Agreement</span><strong>{alreadySigned ? 'Signed' : 'Needs signature'}</strong><small>{alreadySigned ? 'Practice agreement is on file' : 'Open the signing handoff below'}</small></div>
            <div><span className="lbl">Communication</span><strong>{client.messages.length} mirrored</strong><button type="button" onClick={() => navigate(`/client-desk?contact=${encodeURIComponent(client.id)}`)}>Open complete chronology <ArrowUpRight size={13} /></button></div>
            <div><span className="lbl">Tags</span><strong>{client.tags.length}</strong><small>{client.tags.slice(0, 3).join(' · ') || 'No tags mirrored'}</small></div>
          </section>
        )}

        {/* policy agreement — one-time signature, only shown until signed */}
        {!isSession && !alreadySigned && (
          <button
            className="sa-qbtn is-accent"
            onClick={() => navigate(`/check-in/${client.id}`)}
          >
            <span className="ic"><ClipboardCheck size={20} /></span>
            <span className="tx">
              <b>Sign the practice agreement</b>
              <span>No signed copy on file yet — tap to sign</span>
            </span>
          </button>
        )}

        {/* partner toolkit — pinned near the top; mirrors the pay-link pattern:
            tap to reveal a confirm, then tap to actually send (it fires a real
            message to the client, so no single-press accidental sends). */}
        {!isSession && isPartner && <div>
          <button
            className={`sa-paytrigger${toolkitOpen ? ' open' : ''}`}
            onClick={() => toolkitStatus === 'sent' ? undefined : setToolkitOpen((v) => !v)}
          >
            <span className="ic">{toolkitStatus === 'sent' ? <CheckCircle2 size={17} /> : <Send size={17} />}</span>
            <span className="tx">
              <b>{toolkitStatus === 'sent' ? 'Toolkit sent' : 'Send partner toolkit'}</b>
              <span>Referral assets &amp; pay links</span>
            </span>
            {toolkitStatus !== 'sent' && <span className="cv"><ChevronRight size={18} /></span>}
          </button>
          <div className={`sa-collapse${toolkitOpen && toolkitStatus !== 'sent' ? ' open' : ''}`}>
            <div className="sa-collapse-in">
              <button
                className={`sa-pay-row${toolkitStatus === 'error' ? ' is-error' : ''}`}
                onClick={handleSendToolkit}
                disabled={sendingToolkit}
              >
                <span className="ic">{sendingToolkit ? <Loader2 size={15} className="sa-spin" /> : <Send size={15} />}</span>
                <span className="nm">{sendingToolkit ? 'Sending…' : toolkitStatus === 'error' ? 'Failed — tap to retry' : 'Confirm — send toolkit now'}</span>
              </button>
            </div>
          </div>
        </div>}

        {!isSession && <>
        {/* ============ READ-ONLY WORKFLOW INSIGHT ============ */}
        <div id="workflows" className="sa-anchor" aria-hidden="true" />
        <div className="sa-group"><span className="gm" /><span className="gt">Workflows</span><span className="gs">What is active, next, and recently happened</span><span className="gl" /></div>

        <section className="sa-workflow-insight" aria-labelledby="workflow-insight-title">
          <div className="sa-workflow-head">
            <span className="ic"><Workflow size={19} /></span>
            <div>
              <h2 id="workflow-insight-title">Read-only automation insight</h2>
              <p>This is the owned reminder and nurture record for this person. Use Communication for exact message content; compare its timestamp and message reference with the events here before deciding what caused a send.</p>
            </div>
          </div>

          <div className="sa-workflow-summary" aria-label="Automation summary">
            <span><b>{activeEnrollments.length}</b><small>Active enrollment{activeEnrollments.length === 1 ? '' : 's'}</small></span>
            <span><b>{nextScheduledStep ? fmtDateTime(nextScheduledStep.dueAt) : 'None recorded'}</b><small>Next scheduled step</small></span>
            <span className={failedAutomationEvents.length ? 'is-alert' : undefined}><b>{failedAutomationEvents.length}</b><small>Recent failed or bounced</small></span>
          </div>

          {automationEvidenceLoading ? (
            <p className="sa-evidence-empty"><Loader2 size={14} className="sa-spin" /> Loading read-only workflow evidence…</p>
          ) : automationEvidenceError ? (
            <p className="sa-evidence-empty">Workflow evidence could not be loaded: {automationEvidenceError}</p>
          ) : automationEvidence?.configured === false ? (
            <p className="sa-evidence-empty">Mirror gap: the owned-automation evidence database is not connected to this Staff environment. No conclusion about enrollment or sends can be made from this panel.</p>
          ) : (
            <div className="sa-workflow-grid">
              <div className="sa-evidence-block">
                <div className="sa-evidence-title"><Workflow size={15} /><b>Enrollments</b><span>{automationEnrollments.length}</span></div>
                {automationEnrollments.length ? automationEnrollments.map((enrollment) => {
                  const familyKey = enrollment.family?.key;
                  const ownedPersonId = automationEvidence?.contactId;
                  const row = (
                    <>
                      <p><b>{enrollment.family?.name || (enrollment.engine === 'reminder' ? 'Reminder engine' : enrollment.engine === 'nurture' ? 'Nurture engine' : humanizeEvidence(enrollment.engine))}</b><em className={enrollment.status === 'active' ? 'is-active' : undefined}>{enrollment.status}</em></p>
                      <dl>
                        <div><dt>Key</dt><dd>{enrollment.key || 'Not mirrored'}</dd></div>
                        <div><dt>Enrollment</dt><dd>{enrollment.enrollmentId || 'Not mirrored'}</dd></div>
                        <div><dt>Entered</dt><dd>{enrollment.enteredAt ? fmtDateTime(enrollment.enteredAt) : 'Not mirrored'}</dd></div>
                        <div><dt>Starts</dt><dd>{enrollment.startAt ? fmtDateTime(enrollment.startAt) : 'Not recorded for this engine'}</dd></div>
                        <div><dt>Appointment</dt><dd>{enrollment.appointmentId || 'Not attached'}</dd></div>
                        <div><dt>Next type</dt><dd>{enrollment.nextStep?.type ? humanizeEvidence(enrollment.nextStep.type) : 'Not mirrored'}</dd></div>
                        <div><dt>Next template</dt><dd>{enrollment.nextStep?.template || 'Not mirrored'}</dd></div>
                        <div><dt>Due</dt><dd>{enrollment.nextStep?.dueAt ? fmtDateTime(enrollment.nextStep.dueAt) : 'No pending step mirrored'}</dd></div>
                      </dl>
                      {familyKey && <span className="sa-workflow-open">Inspect workflow <ArrowUpRight size={12} /></span>}
                    </>
                  );
                  return familyKey && ownedPersonId ? (
                    <Link key={enrollment.enrollmentId} className="sa-enrollment-row is-inspectable" to={automationDrilldownPath(familyKey, ownedPersonId)}>{row}</Link>
                  ) : (
                    <article key={enrollment.enrollmentId} className="sa-enrollment-row">{row}</article>
                  );
                }) : <p className="sa-evidence-empty">No owned enrollment is mirrored. This can mean there is no enrollment or that its source has not reached the mirror yet.</p>}
              </div>

              <div className="sa-evidence-block">
                <div className="sa-evidence-title"><Workflow size={15} /><b>Recent events and outcomes</b><span>{automationEvents.length}</span></div>
                {automationEvents.length ? automationEvents.map((event, index) => {
                  const isFailure = ['failed', 'bounced', 'error'].includes((event.outcome || '').toLowerCase());
                  const familyKey = event.family?.key;
                  const ownedPersonId = automationEvidence?.contactId;
                  const row = (
                    <>
                      <time dateTime={new Date(event.ts).toISOString()}>{fmtDateTime(event.ts)}</time>
                      <p><b>{event.family?.name || (event.engine === 'reminder' ? 'Reminder engine' : event.engine === 'nurture' ? 'Nurture engine' : 'Automation engine')}</b>{event.action ? ` · ${humanizeEvidence(event.action)}` : ''}{event.channel ? ` · ${humanizeEvidence(event.channel)}` : ''}</p>
                      <span>{event.outcome ? humanizeEvidence(event.outcome) : 'Outcome not recorded'}{event.flowKey ? ` · key ${event.flowKey}` : ''}{event.stepIndex != null ? ` · step ${event.stepIndex}` : ''}{event.appointmentId ? ` · appointment ${event.appointmentId}` : ''}{event.messageRef ? ` · message ${event.messageRef}` : ''}</span>
                      {familyKey && <span className="sa-workflow-open">Inspect workflow <ArrowUpRight size={12} /></span>}
                    </>
                  );
                  const key = `${event.ts}-${event.messageRef || index}`;
                  return familyKey && ownedPersonId ? (
                    <Link key={key} className={`sa-automation-row is-inspectable${isFailure ? ' is-failure' : ''}`} to={automationDrilldownPath(familyKey, ownedPersonId)}>{row}</Link>
                  ) : (
                    <article key={key} className={`sa-automation-row${isFailure ? ' is-failure' : ''}`}>{row}</article>
                  );
                }) : <p className="sa-evidence-empty">No owned event is mirrored for this person. Treat this as an evidence gap, not proof that nothing ran.</p>}
              </div>
            </div>
          )}

          <div className="sa-evidence-actions">
            <button type="button" onClick={() => navigate(`/client-desk?contact=${encodeURIComponent(client.id)}`)}><MessageSquareText size={15} />Open this person in Communication</button>
          </div>
        </section>
        </>}

        {!isSession && <>
        {/* ============ ADMIN & CHECKOUT ============ */}
        <div id="money" className="sa-anchor" aria-hidden="true" />
        <div className="sa-group admin"><span className="gm" /><span className="gt">Money</span><span className="gs">Payment, products, and purchase record</span><span className="gl" /></div>

        {/* pay status banner */}
        {showPaymentBanner && (
          <div className={`sa-paystat${client.sessionPrepaid ? ' is-paid' : ''}`}>
            <span className="l">
              <span className="ic">{client.sessionPrepaid ? <Check size={18} strokeWidth={2.2} /> : <DollarSign size={18} />}</span>
              {client.sessionPrepaid ? 'Active package' : 'No active package'}
            </span>
          </div>
        )}

        {/* collapsible pay link */}
        {client.phone && (
          <div>
            <button className={`sa-paytrigger${payOpen ? ' open' : ''}`} onClick={() => setPayOpen((v) => !v)}>
              <span className="ic"><Send size={17} /></span>
              <span className="tx"><b>Send pay link</b><span>Current Practice options, plus legacy links when needed</span></span>
              <span className="cv"><ChevronRight size={18} /></span>
            </button>
            <div className={`sa-collapse${payOpen ? ' open' : ''}`}>
              <div className="sa-collapse-in">
                {renderPayRow('6-week-practice', '6-Week Practice', '$3,000')}
                {renderPayRow('12-week-practice', '12-Week Practice', '$5,400')}
                <p className="sa-legacy-note">Legacy options are kept for existing founding-member support.</p>
                {renderPayRow('8-session-series', '8-Pack', '$1,295', true)}
                {renderPayRow('4-session-series', '4-Pack', '$720', true)}
                {renderPayRow('initial-in-person', 'Initial — In Person', '$225', true)}
                {showMorePayLinks && (
                  <>
                    {renderPayRow('initial-virtual', 'Initial — Virtual', '$225', true)}
                    {renderPayRow('follow-up', 'Follow-up', '$190', true)}
                    {renderPayRow('living-practice', 'Living Practice', '$347', true)}
                    {renderPayRow('upgrade-initial-to-4', 'Upgrade Initial → 4', '$495', true)}
                    {renderPayRow('upgrade-initial-to-8', 'Upgrade Initial → 8', '$1,070', true)}
                    {renderPayRow('upgrade-4-to-8', 'Upgrade 4 → 8', '$575', true)}
                  </>
                )}
                <button className="sa-more" onClick={() => setShowMorePayLinks((v) => !v)}>{showMorePayLinks ? '– Fewer products' : '+ More products'}</button>
              </div>
            </div>
          </div>
        )}

        {/* purchase history — from Stripe (lazy-loaded with owed status) */}
        {owed?.purchases && owed.purchases.length > 0 && (
          <section className="sa-card">
            <div className="sa-card-h">
              <span className="t">Purchase history</span>
              <span className="sa-mod-count">${Math.round(owed.totalPaid ?? 0)} total</span>
            </div>
            <div className="sa-kv">
              {owed.purchases.map((p, i) => (
                <div className="row" key={i}>
                  <span className="k">{fmtPurchaseDate(p.date)} · {p.label}</span>
                  <span className="v">${p.amount}</span>
                </div>
              ))}
            </div>
          </section>
        )}
        </>}

        {!isSession && <>
        <div id="sessions" className="sa-anchor" aria-hidden="true" />
        <div className="sa-group"><span className="gm" /><span className="gt">Sessions</span><span className="gs">Package history and remaining sessions</span><span className="gl" /></div>

        {/* session progress */}
        <section className="sa-card">
          <div className="sa-card-h">
            <span className="t">Session progress</span>
            <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <LedgerWarning
                size="full"
                confidence={client.ledgerConfidence}
                ambiguities={client.ledgerAmbiguities}
                manualLock={client.ledgerManualLock}
                displaySource={client.ledgerDisplaySource}
                derivedRemaining={client.ledgerDerivedRemaining}
                displayedRemaining={client.sessionsRemaining}
                purchased={client.ledgerPurchased ?? undefined}
                attended={client.ledgerAttended}
              />
              {isPartner && <span className="sa-chip">Partner</span>}
              {isFoundersCircle && <span className="sa-chip">Founder's Circle</span>}
            </span>
          </div>
          <div className="sa-prog">
            <div className="cell"><span className="v">{currentSeriesCompleted}</span><span className="lbl k">Done this series</span></div>
            <div className="cell"><span className="v">{client.sessionsRemaining}</span><span className="lbl k">Sessions left</span></div>
            <div className="cell"><span className="v">{packageLabel}</span><span className="lbl k">Package size</span></div>
          </div>
          {totalSessions > 0 && <div className="sa-prog-bar"><i style={{ width: progressPct + '%' }} /></div>}
          {isReturning && <p className="sa-prog-foot">{client.sessionsCompleted} lifetime sessions</p>}
        </section>
        </>}

        {isSession && <>
        <div id="current-visit" className="sa-anchor" aria-hidden="true" />
        <div className="sa-group"><span className="gm" /><span className="gt">Current visit</span><span className="gs">The one appointment being worked now</span><span className="gl" /></div>
        <section className="sa-current-visit">
          {currentVisit ? (
            <>
              <div className="sa-current-visit-time"><span>{fmtDate(currentVisit.startTime)}</span><strong>{fmtTime(currentVisit.startTime)}</strong></div>
              <div className="sa-current-visit-main"><span className="lbl">Visit</span><h2>{currentVisit.title}</h2><p>{currentVisit.calendarName || 'Calendar not mirrored'} · {humanizeEvidence(currentVisit.status || 'status not mirrored')}</p></div>
              <div className="sa-current-visit-state">
                <span className="lbl">Visit status</span>
                {currentVisitAttended ? (
                  <strong className="is-complete">Attended</strong>
                ) : currentVisitCanMark ? (
                  <button
                    className="sa-mark-current"
                    disabled={markingAttended === currentVisit.id}
                    onClick={() => {
                      if (client.sessionsRemaining > 0 && client.seriesType !== 'none') handleMarkAttended(currentVisit);
                      else if (currentVisitIsGift) handleMarkAttended(currentVisit, { paymentStatus: 'comped', compNote: 'Partner gift' });
                      else { setPayingApptId(currentVisit.id); setCompNoteDraft(''); }
                    }}
                  >{markingAttended === currentVisit.id ? 'Marking…' : 'Mark attended'}</button>
                ) : <strong>{humanizeEvidence(currentVisit.status || 'Scheduled')}</strong>}
                <small>{client.sessionsRemaining} session{client.sessionsRemaining === 1 ? '' : 's'} left</small>
              </div>
            </>
          ) : (
            <p className="sa-empty">No appointment is selected. Open this workspace from Calendar to anchor it to a visit.</p>
          )}
        </section>
        {currentVisit && currentVisitChoosingPayment && (
          <section className="sa-payment-choice" aria-label="Attendance payment choice">
            <strong>How was this visit paid?</strong>
            <div>
              <button disabled={markingAttended === currentVisit.id} style={PAY_BTN} onClick={() => handleMarkAttended(currentVisit, { paymentStatus: 'paid', paymentMethod: 'stripe' })}>Paid (card)</button>
              <button disabled={markingAttended === currentVisit.id} style={PAY_BTN} onClick={() => handleMarkAttended(currentVisit, { paymentStatus: 'paid', paymentMethod: 'cash' })}>Paid (cash)</button>
              <button disabled={markingAttended === currentVisit.id} style={PAY_BTN} onClick={() => handleMarkAttended(currentVisit, { paymentStatus: 'pay-next-visit' })}>Owes — pay next visit</button>
              <button disabled={markingAttended === currentVisit.id} style={PAY_BTN} onClick={() => handleMarkAttended(currentVisit, { paymentStatus: 'comped', compNote: compNoteDraft.trim() || 'Comp' })}>Comp / free</button>
            </div>
            <label>Comp reason (optional)<input value={compNoteDraft} onChange={(event) => setCompNoteDraft(event.target.value)} /></label>
            <button type="button" className="sa-payment-cancel" onClick={() => { setPayingApptId(null); setCompNoteDraft(''); }}>Cancel</button>
          </section>
        )}

        <div id="intake-context" className="sa-anchor" aria-hidden="true" />
        <div className="sa-group"><span className="gm" /><span className="gt">Starting context</span><span className="gs">Intake evidence, not the whole record</span><span className="gl" /></div>

        {/* quiz results */}
        {quiz ? (
          <section className="sa-card">
            <div className="sa-card-h"><span className="t">Quiz results</span></div>
            <div className="sa-kv">
              {quiz.primaryPainLocation && <div className="row"><span className="k">Primary issue</span><span className="v">{quiz.primaryPainLocation}</span></div>}
              {quiz.painDuration && <div className="row"><span className="k">Duration</span><span className="v">{quiz.painDuration}</span></div>}
              {quiz.painIntensity && <div className="row"><span className="k">Intensity</span><span className="v">{quiz.painIntensity}</span></div>}
              {quiz.painTrigger && <div className="row"><span className="k">Trigger</span><span className="v">{quiz.painTrigger}</span></div>}
              {quiz.additionalPainAreas && <div className="row"><span className="k">Also affects</span><span className="v">{quiz.additionalPainAreas}</span></div>}
              {quiz.treatmentsTried && <div className="row"><span className="k">Tried</span><span className="v">{quiz.treatmentsTried}{quiz.treatmentResults ? ` — ${quiz.treatmentResults}` : ''}</span></div>}
              {quiz.dailyImpact && <div className="row"><span className="k">Daily impact</span><span className="v">{quiz.dailyImpact}</span></div>}
            </div>
          </section>
        ) : <section className="sa-brief"><span className="lbl">Intake</span><p>No structured quiz answers are mirrored. Start with the person brief and let them describe what is present today.</p></section>}

        {/* Field Studies is deliberately a niche, tagged-person section—not a
            primary CRM destination or a generic person-workspace capability. */}
        <div id="practice-work" className="sa-anchor" aria-hidden="true" />
        <div className="sa-group sa-subgroup"><span className="gm" /><span className="gt">Practice work</span><span className="gs">Modules and body map</span><span className="gl" /></div>

        {/* modules taught + body map — side by side on wider screens, stacked on narrow */}
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'flex-start' }}>
        <section className="sa-card" style={{ flex: '1 1 320px', minWidth: 0 }}>
          <div className="sa-card-h"><span className="t">Modules taught</span><span className="sa-mod-count">{taughtCount}/{MODULES.length}</span></div>
          <div className="sa-mod-bar"><i style={{ width: modPct + '%' }} /></div>
          <div className="sa-mod-grid one">
            {MODULES.map((m) => {
              const on = !!progress.modules[m.id];
              const isBridge = m.id === 'active-bridge' || m.id === 'passive-bridge';
              const toggle = (
                <button className={`sa-mod${on ? ' is-on' : ''}`} onClick={() => handleProgressUpdate(toggleModule(progress, m.id))}>
                  <span className="box"><Check size={14} strokeWidth={2.6} /></span>
                  <span className="nm">{m.name}</span>
                </button>
              );
              if (isBridge) {
                return (
                  <div key={m.id} className="sa-modrow">
                    {toggle}
                    {on && (
                      <span className="blk">
                        <span className="lbl">Block</span>
                        <span className="sa-seg">
                          {(['3', '4'] as const).map((b) => (
                            <button key={b} className={progress.yogaBlockSize === b ? 'is-on' : ''} onClick={() => handleProgressUpdate(setYogaBlockSize(progress, b))}>{b}″</button>
                          ))}
                        </span>
                      </span>
                    )}
                  </div>
                );
              }
              return <span key={m.id}>{toggle}</span>;
            })}
          </div>
        </section>

        {/* body map — realistic figure */}
        <div style={{ flex: '1 1 320px', minWidth: 0 }}>
          <BodyMapCanvas data={progress} onUpdate={handleProgressUpdate} />
        </div>
        </div>
        </>}

        {!isSession && <>
        {study && (
          <section className="sa-specialist">
            <div className="sa-specialist-label">Specialist study record</div>
            <StudyCapturePanel contactId={client.id} study={study} />
          </section>
        )}

        <div id="appointments" className="sa-anchor" aria-hidden="true" />
        <div className="sa-group"><span className="gm" /><span className="gt">Appointments</span><span className="gs">Past and future visits in one record</span><span className="gl" /></div>

        {/* appointments */}
        <section className="sa-card">
          <div className="sa-card-h">
            <span className="t">Appointments</span>
            {owed && owed.status === 'owed' && (
              <span title={`Attended ${owed.attendedBillable}, paid for ${owed.sessionsPurchased}${owed.confidence === 'medium' ? ' — verify' : ''}`}
                style={{ fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 999, background: '#fee2e2', color: '#b91c1c' }}>
                Owed {owed.shortBy} session{owed.shortBy === 1 ? '' : 's'}{owed.confidence === 'medium' ? '?' : ''}
              </span>
            )}
            {owed && owed.status === 'square' && (
              <span style={{ fontSize: 11, fontWeight: 600, padding: '2px 8px', borderRadius: 999, background: '#dcfce7', color: '#15803d' }}>Paid up</span>
            )}
            {owed && owed.status === 'paid-legacy' && (
              <span title="Paid at a legacy price (amount not in current map)" style={{ fontSize: 11, fontWeight: 600, padding: '2px 8px', borderRadius: 999, background: '#f1f5f9', color: '#475569' }}>Paid (legacy)</span>
            )}
            <span className="sa-mod-count">{client.appointments.length} total</span>
          </div>
          {attendedError && <div className="sa-errbar" style={{ marginBottom: 10 }}>{attendedError}</div>}
          {client.appointments.length === 0 ? (
            <p className="sa-empty">No appointments</p>
          ) : (
            <div className="sa-appt">
              {client.appointments.map((appt) => {
                const date = new Date(appt.startTime);
                const isPast = date < new Date();
                const isAttended = appt.status === 'showed' || appt.status === 'completed';
                // Markable from 2h before the slot onward — so attendance can be
                // marked when the client actually shows up (incl. early arrivals),
                // not only strictly after the appointment time has passed.
                const canMark = date.getTime() <= Date.now() + 2 * 60 * 60 * 1000 && !isAttended && appt.status !== 'cancelled';
                const isMarking = markingAttended === appt.id;
                const pill = appt.paymentStatus ? PAYMENT_PILL[appt.paymentStatus] : null;
                const packageCovers = client.sessionsRemaining > 0 && client.seriesType !== 'none';
                // Gifted partner sessions are always comp — one-tap mark, no "how was this paid?".
                const isGift = /partner initial/i.test(appt.calendarName || '') || /partner initial/i.test(appt.title || '');
                const choosing = payingApptId === appt.id;
                return (
                  <div key={appt.id}>
                    <div className={`sa-appt-row${isPast && !canMark && !isAttended ? ' is-dim' : ''}`}>
                      <div className="info">
                        <div className="nm">{appt.title}</div>
                        <div className="mt">{fmtDate(appt.startTime)} · {fmtTime(appt.startTime)}{appt.calendarName && ` · ${appt.calendarName}`}</div>
                        {pill && (
                          <span
                            title={appt.paymentNote || undefined}
                            style={{ display: 'inline-block', marginTop: 4, fontSize: 11, fontWeight: 600, padding: '2px 8px', borderRadius: 999, background: pill.bg, color: pill.fg }}
                          >
                            {pill.label}{appt.paymentStatus === 'comped' && appt.paymentNote ? ` · ${appt.paymentNote}` : ''}
                          </span>
                        )}
                      </div>
                      {isAttended ? (
                        <button className="sa-att is-on" disabled><span>Attended</span><span className="sw" /></button>
                      ) : canMark ? (
                        <button
                          className="sa-att"
                          onClick={() => {
                            // One clean tap when there's no payment decision: package-covered
                            // (backend auto-records on-package) and gifted partner sessions (always comp).
                            // Only pay-as-you-go opens the "how was this paid?" step.
                            if (packageCovers) handleMarkAttended(appt);
                            else if (isGift) handleMarkAttended(appt, { paymentStatus: 'comped', compNote: 'Partner gift' });
                            else { setPayingApptId(appt.id); setCompNoteDraft(''); }
                          }}
                          disabled={isMarking}
                        >
                          <span>{isMarking ? 'Marking…' : 'Mark'}</span><span className="sw" />
                        </button>
                      ) : appt.status === 'cancelled' ? (
                        <span className="sa-status-pill is-cancel">Cancelled</span>
                      ) : (
                        <span className="sa-conf">{appt.status === 'confirmed' || !isPast ? 'Confirmed' : appt.status}</span>
                      )}
                    </div>
                    {choosing && (
                      <div style={{ margin: '6px 0 12px', padding: 12, background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 10 }}>
                        <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 10, color: '#334155' }}>Marking attended — how was it paid?</div>
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 10 }}>
                          <button disabled={isMarking} style={PAY_BTN} onClick={() => handleMarkAttended(appt, { paymentStatus: 'paid', paymentMethod: 'stripe' })}>Paid (card)</button>
                          <button disabled={isMarking} style={PAY_BTN} onClick={() => handleMarkAttended(appt, { paymentStatus: 'paid', paymentMethod: 'cash' })}>Paid (cash)</button>
                          <button disabled={isMarking} style={PAY_BTN} onClick={() => handleMarkAttended(appt, { paymentStatus: 'pay-next-visit' })}>Owes — pay next visit</button>
                          <button disabled={isMarking} style={PAY_BTN} onClick={() => handleMarkAttended(appt, { paymentStatus: 'comped', compNote: compNoteDraft.trim() || 'Comp' })}>Comp / free</button>
                        </div>
                        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                          <input
                            value={compNoteDraft}
                            onChange={(e) => setCompNoteDraft(e.target.value)}
                            placeholder="Comp reason (optional)"
                            style={{ flex: 1, fontSize: 13, padding: '7px 9px', border: '1px solid #cbd5e1', borderRadius: 8 }}
                          />
                          <button disabled={isMarking} style={{ ...PAY_BTN, border: 'none', background: 'transparent', color: '#94a3b8', fontWeight: 500 }} onClick={() => { setPayingApptId(null); setCompNoteDraft(''); }}>Cancel</button>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </section>
        </>}

        {isSession && <>
          <div id="session-note" className="sa-anchor" aria-hidden="true" />
          <div className="sa-group"><span className="gm" /><span className="gt">Session note</span><span className="gs">Capture what changed before leaving the room</span><span className="gl" /></div>
          <section className="sa-session-note">
            <div className="sa-session-note-prompt">
              <span className="lbl">Close the loop</span>
              <h2>What did you find, change, and want to carry forward?</h2>
              <p>A note saved here becomes part of the Member Record. The complete note history stays out of the live-session workspace.</p>
              <button className="sa-note-add" onClick={() => setShowAddNote(true)}><Plus size={14} />Add this session’s note</button>
            </div>
            <div className="sa-session-note-recent">
              <span className="lbl">Most recent context</span>
              {visibleNotes.slice(0, 2).length ? visibleNotes.slice(0, 2).map((note) => {
                const parsed = splitNoteBody(note.body);
                return <article key={note.id}><time>{fmtDate(note.dateAdded)}</time><p>{parsed.text || 'Signed record'}</p></article>;
              }) : <p className="sa-empty">No prior human notes are mirrored.</p>}
              <Link to={memberWorkspacePath(client.id, 'record') + '#notes'}>Open complete note history <ArrowUpRight size={13} /></Link>
            </div>
          </section>
          {canRequestReview && (
            <section className="sa-after-session">
              <span className="lbl">After the session</span>
              <div>
                <button
                  className={`sa-paytrigger${reviewOpen ? ' open' : ''}${reviewStatus === 'sent' ? ' is-sent' : ''}`}
                  onClick={toggleReviewComposer}
                  disabled={reviewStatus === 'sending' || reviewStatus === 'sent'}
                >
                  <span className="ic">
                    {reviewStatus === 'sending' ? <Loader2 size={17} className="sa-spin" /> : reviewStatus === 'sent' ? <CheckCircle2 size={17} /> : <Send size={17} />}
                  </span>
                  <span className="tx">
                    <b>{reviewStatus === 'sent' ? 'Google review request sent' : 'Ask for a Google review'}</b>
                    <span>{reviewStatus === 'sent' ? 'Logged in the client’s communication history' : 'Review, edit, then explicitly send a text'}</span>
                  </span>
                  {reviewStatus !== 'sent' && <span className="cv"><ChevronRight size={18} /></span>}
                </button>
                <div className={`sa-collapse${reviewOpen && reviewStatus !== 'sent' ? ' open' : ''}`}>
                  <div className="sa-collapse-in sa-review-compose">
                    <label htmlFor="google-review-message">SMS to {client.firstName || fullName}</label>
                    <textarea id="google-review-message" value={reviewMessage} onChange={(event) => setReviewMessage(event.target.value)} maxLength={720} rows={5} aria-describedby="google-review-message-help" />
                    <div id="google-review-message-help" className="sa-review-compose-meta"><span>Editable before sending</span><span>{reviewMessage.length}/720</span></div>
                    {reviewError && <div className={reviewStatus === 'sent' ? 'sa-review-note' : 'sa-errbar'}>{reviewError}</div>}
                    <button className={`sa-pay-row${reviewStatus === 'error' ? ' is-error' : ''}`} onClick={handleSendReviewRequest} disabled={reviewStatus === 'sending' || !reviewMessage.trim()}>
                      <span className="ic">{reviewStatus === 'sending' ? <Loader2 size={15} className="sa-spin" /> : <Send size={15} />}</span>
                      <span className="nm">{reviewStatus === 'sending' ? 'Sending…' : reviewStatus === 'error' ? 'Try sending again' : 'Send Google review request'}</span>
                    </button>
                  </div>
                </div>
              </div>
            </section>
          )}
        </>}

        {!isSession && <>
        <div id="notes" className="sa-anchor" aria-hidden="true" />
        <div className="sa-group"><span className="gm" /><span className="gt">Notes</span><span className="gs">Human context and signed records</span><span className="gl" /></div>

        {/* notes */}
        <section className="sa-card">
          <div className="sa-card-h"><span className="t">Notes</span><button className="sa-note-add" onClick={() => setShowAddNote(true)}><Plus size={14} />Add note</button></div>
          {(() => {
            const visible = client.notes.filter((n) => !isSystemNote(n.body));
            return visible.length === 0 ? (
              <p className="sa-empty">No notes yet</p>
            ) : (
              <div className="sa-notes">
                {visible.map((n) => {
                  const nb = splitNoteBody(n.body);
                  return (
                    <div key={n.id} className="sa-note">
                      <div className="sa-note-meta"><span className="sa-note-date">{fmtDate(n.dateAdded)}</span>{isEditableStaffNote(n.body) && <button type="button" className="sa-note-edit" onClick={() => setEditingNote(n)} aria-label="Edit note"><Pencil size={13} /> Edit</button>}</div>
                      {nb.text && <p style={{ whiteSpace: 'pre-wrap' }}>{nb.text}</p>}
                      {nb.signature && (
                        <img src={nb.signature} alt="Signature" style={{ maxWidth: 220, maxHeight: 80, marginTop: 6, border: '1px solid #e2e8f0', borderRadius: 6, background: '#fff', padding: 4 }} />
                      )}
                    </div>
                  );
                })}
              </div>
            );
          })()}
        </section>
        </>}

        {/* debug */}
        {debugMode && (client as unknown as { _debug?: unknown })._debug != null && (
          <div className="sa-debug">
            <h3>Debug</h3>
            <pre>{JSON.stringify((client as unknown as { _debug?: unknown })._debug, null, 2)}</pre>
          </div>
        )}

        <footer className="sa-foot">amarimethod · {isSession ? 'in session' : 'member record'}</footer>
      </main>

      {showAddNote && (
        <AddNoteModal
          contactId={client.id}
          onClose={() => setShowAddNote(false)}
          onSaved={() => { setShowAddNote(false); loadClient(); }}
        />
      )}
      {editingNote && (
        <AddNoteModal
          contactId={client.id}
          note={editingNote}
          onClose={() => setEditingNote(null)}
          onSaved={() => { setEditingNote(null); loadClient(); }}
        />
      )}
    </div>
  );
}
