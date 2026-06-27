import { useState, useEffect, useRef, type CSSProperties } from 'react';
import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
import {
  ArrowLeft, Loader2, RefreshCw, ExternalLink, CheckCircle2, Send,
  ClipboardCheck, Check, ChevronRight, DollarSign, User, Plus,
} from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { getContactDetail, markAttended, sendToolkit, saveProgress, sendPayLink, getOwedStatus, ApiError, type PayLinkProduct, type PaymentCapture, type OwedStatus } from '../lib/api';
import type { ContactDetail, ContactAppointment, PaymentStatus } from '../types/staff';
import AddNoteModal from '../components/AddNoteModal';
import Checklist from '../components/Checklist';
import BodyMapCanvas from '../components/BodyMapCanvas';
import { buildSessionBrief, visitLabel } from '../components/SessionBrief';
import LedgerWarning from '../components/LedgerWarning';
import {
  MODULES, toggleModule, setYogaBlockSize, defaultData, type ClientModuleData,
} from '../data/moduleStorage';
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

// Returns true for system-generated notes that should never surface in the client sheet.
// Only Garrett's manually-written notes belong here.
function isSystemNote(body: string): boolean {
  const t = body.trim();
  return (
    /^migrat/i.test(t) ||
    /^\[?reconciliation/i.test(t) ||
    /^outcome:/i.test(t) ||
    /^touch:/i.test(t) ||
    /^skip:/i.test(t) ||
    /^enrichment/i.test(t) ||
    /^audit/i.test(t) ||
    /^correction/i.test(t) ||
    /^ip:/i.test(t) ||
    /^user.?agent:/i.test(t) ||
    /captured at:/i.test(t) ||
    /^next: customer redirected/i.test(t)
  );
}

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

export default function ClientDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [searchParams] = useSearchParams();
  const appointmentId = searchParams.get('appointment');
  const debugMode = searchParams.get('debug') === '1';
  const navigate = useNavigate();
  const { logout } = useAuth();

  const [client, setClient] = useState<ContactDetail | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');
  const [showAddNote, setShowAddNote] = useState(false);
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
  const [progress, setProgress] = useState<ClientModuleData>(defaultData());

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
      setClient({
        ...client,
        sessionsCompleted: result.sessionsCompleted,
        sessionsRemaining: result.sessionsRemaining,
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

  function renderPayRow(product: PayLinkProduct, label: string, price: string) {
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
        <span className="nm">{isSent ? `${label} sent` : isError ? `${label} — retry` : `Send ${label}`}</span>
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
      setError(err instanceof Error ? err.message : 'Failed to load client');
    } finally {
      setIsLoading(false);
    }
  }

  useEffect(() => {
    loadClient();
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
  const roleWord = isPartner ? 'Referral partner' : client.seriesType !== 'none' ? `${client.seriesType.replace('-session', '')}-session client` : 'Client';

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

  return (
    <div className="sa">
      {/* ── sticky identity header ── */}
      <header className="sa-head">
        <div className="sa-head-top">
          <button className="sa-back" onClick={() => navigate(-1)}>
            <ArrowLeft size={18} /><span>All clients</span>
          </button>
          <button className="sa-sync" onClick={loadClient} disabled={isLoading}>
            <RefreshCw size={14} className={isLoading ? 'sa-spin' : ''} />
            <span>{isLoading ? 'Refreshing' : 'Refresh'}</span>
          </button>
        </div>
        <div className="sa-id">
          <div>
            <div className="sa-id-name">{fullName}</div>
            <div className="sa-id-sub">
              <span className="sa-chip"><User size={13} />{roleWord} · {visitLabel(client).toLowerCase()}</span>
            </div>
          </div>
          <div className="sa-contact">
            {/* All client communication happens in GHL — one button straight to the contact there. */}
            <a href={`https://app.gohighlevel.com/v2/location/7pIO7FHVAyBT1jKGhfQM/contacts/detail/${client.id}`} target="_blank" rel="noopener noreferrer"><ExternalLink size={15} /><span>Open in GHL</span></a>
          </div>
        </div>
      </header>

      <main className="sa-body">
        {/* ============ IN SESSION ============ */}
        <div className="sa-group"><span className="gm" /><span className="gt">In session</span><span className="gs">What you do with the client today</span><span className="gl" /></div>

        {/* policy agreement — one-time signature, only shown until signed */}
        {!alreadySigned && (
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

        {/* checklist (only when navigated from Today) */}
        {appointmentId && (
          <div className="sa-card"><Checklist appointmentId={appointmentId} client={client} /></div>
        )}

        {/* partner toolkit — pinned near the top; mirrors the pay-link pattern:
            tap to reveal a confirm, then tap to actually send (it fires a real
            message to the client, so no single-press accidental sends). */}
        <div>
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
        </div>

        {/* ============ ADMIN & CHECKOUT ============ */}
        <div className="sa-group admin"><span className="gm" /><span className="gt">Admin & checkout</span><span className="gs">Payment, products, records</span><span className="gl" /></div>

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
              <span className="tx"><b>Send pay link</b><span>8-pack, 4-pack, initial & more</span></span>
              <span className="cv"><ChevronRight size={18} /></span>
            </button>
            <div className={`sa-collapse${payOpen ? ' open' : ''}`}>
              <div className="sa-collapse-in">
                {renderPayRow('8-session-series', '8-Pack', '$1,295')}
                {renderPayRow('4-session-series', '4-Pack', '$720')}
                {renderPayRow('initial-in-person', 'Initial — In Person', '$225')}
                {showMorePayLinks && (
                  <>
                    {renderPayRow('initial-virtual', 'Initial — Virtual', '$225')}
                    {renderPayRow('follow-up', 'Follow-up', '$190')}
                    {renderPayRow('living-practice', 'Living Practice', '$347')}
                    {renderPayRow('upgrade-initial-to-4', 'Upgrade Initial → 4', '$495')}
                    {renderPayRow('upgrade-initial-to-8', 'Upgrade Initial → 8', '$1,070')}
                    {renderPayRow('upgrade-4-to-8', 'Upgrade 4 → 8', '$575')}
                  </>
                )}
                <button className="sa-more" onClick={() => setShowMorePayLinks((v) => !v)}>{showMorePayLinks ? '– Fewer products' : '+ More products'}</button>
              </div>
            </div>
          </div>
        )}

        {/* session brief */}
        <section className="sa-brief">
          <span className="lbl">Session brief</span>
          <p>{buildSessionBrief(client)}</p>
        </section>

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

        {/* quiz results */}
        {quiz && (
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
        )}

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
                      <div className="sa-note-meta"><span className="sa-note-date">{fmtDate(n.dateAdded)}</span></div>
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

        {/* ============ IN SESSION (cont.) ============ */}
        <div className="sa-group"><span className="gm" /><span className="gt">In session</span><span className="gs">Modules, body map &amp; appointments</span><span className="gl" /></div>

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

        {/* debug */}
        {debugMode && (client as unknown as { _debug?: unknown })._debug != null && (
          <div className="sa-debug">
            <h3>Debug</h3>
            <pre>{JSON.stringify((client as unknown as { _debug?: unknown })._debug, null, 2)}</pre>
          </div>
        )}

        <footer className="sa-foot">amarimethod · staff session</footer>
      </main>

      {showAddNote && (
        <AddNoteModal
          contactId={client.id}
          onClose={() => setShowAddNote(false)}
          onSaved={() => { setShowAddNote(false); loadClient(); }}
        />
      )}
    </div>
  );
}
