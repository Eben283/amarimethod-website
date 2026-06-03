import { useState, useEffect, useRef } from 'react';
import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
import {
  ArrowLeft, Loader2, RefreshCw, Phone, Mail, CheckCircle2, Send, XCircle,
  ExternalLink, ClipboardCheck, Check, ChevronRight, DollarSign, User, Plus,
} from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { getContactDetail, markAttended, sendToolkit, markNotAFit, saveProgress, togglePrepaid, sendPayLink, ApiError, type PayLinkProduct } from '../lib/api';
import type { ContactDetail, ContactAppointment } from '../types/staff';
import AddNoteModal from '../components/AddNoteModal';
import Checklist from '../components/Checklist';
import BodyMapCanvas from '../components/BodyMapCanvas';
import { buildSessionBrief, visitLabel } from '../components/SessionBrief';
import LedgerWarning from '../components/LedgerWarning';
import {
  MODULES, toggleModule, setYogaBlockSize, defaultData, type ClientModuleData,
} from '../data/moduleStorage';
import '../styles/session-a.css';

// ── small display helpers ─────────────────────────────────────────────────
function fmtDate(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function fmtTime(iso: string): string {
  return new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
}

// Derive a short "kind" chip from a note body's leading label.
function noteKind(body: string): string {
  const t = body.trim();
  if (/^migrat/i.test(t)) return 'Migration';
  if (/^\[?reconciliation/i.test(t)) return 'Reconciliation';
  if (/^outcome:/i.test(t)) return 'Outcome';
  if (/^touch:/i.test(t)) return 'Touch';
  if (/^skip:/i.test(t)) return 'Skip';
  if (/^enrichment/i.test(t)) return 'Enrichment';
  if (/^audit/i.test(t)) return 'Audit';
  if (/^correction/i.test(t)) return 'Correction';
  return 'Note';
}

function msgChannel(type: string): string {
  const t = (type || '').toUpperCase().replace('TYPE_', '');
  if (t.includes('SMS')) return 'SMS';
  if (t.includes('EMAIL')) return 'Email';
  if (t.includes('CALL')) return 'Call';
  return t || 'Msg';
}

export default function ClientDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [searchParams] = useSearchParams();
  const appointmentId = searchParams.get('appointment');
  const focus = searchParams.get('focus');
  const debugMode = searchParams.get('debug') === '1';
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

  async function handleMarkAttended(appt: ContactAppointment) {
    if (!client || markingAttended) return;
    setMarkingAttended(appt.id);
    setAttendedError('');
    try {
      const result = await markAttended(appt.id, client.id, appt.title, appt.calendarName);
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

  // Scroll to the messages section when arriving from the Messages tab
  useEffect(() => {
    if (!client || focus !== 'messages') return;
    const el = document.getElementById('messages-section');
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, [client, focus]);

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
  const showPartnerActions = isPartner || client.tags.includes('partner-session-booked');
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

  const signedTag = 'policies-signed-practice-member-v2026-04-17';
  const alreadySigned = client.tags.includes(signedTag);
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
            {client.phone && <a href={`tel:${client.phone}`}><Phone size={15} /><span>{client.phone}</span></a>}
            {client.email && <a href={`mailto:${client.email}`}><Mail size={15} /><span>Email</span></a>}
          </div>
        </div>
      </header>

      <main className="sa-body">
        {/* ============ IN SESSION ============ */}
        <div className="sa-group"><span className="gm" /><span className="gt">In session</span><span className="gs">What you do with the client today</span><span className="gl" /></div>

        {/* check in */}
        <button
          className={`sa-qbtn is-accent${alreadySigned ? ' is-sent' : ''}`}
          onClick={() => navigate(`/check-in/${client.id}`)}
        >
          <span className="ic">{alreadySigned ? <CheckCircle2 size={20} /> : <ClipboardCheck size={20} />}</span>
          <span className="tx">
            <b>{alreadySigned ? 'Policies signed' : 'Check in'}</b>
            <span>{alreadySigned ? 'Tap to review or re-sign' : 'Sign policies & start the session'}</span>
          </span>
        </button>

        {/* checklist (only when navigated from Today) */}
        {appointmentId && (
          <div className="sa-card"><Checklist appointmentId={appointmentId} client={client} /></div>
        )}

        {/* modules taught */}
        <section className="sa-card">
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
        <BodyMapCanvas data={progress} onUpdate={handleProgressUpdate} />

        {/* appointments */}
        <section className="sa-card">
          <div className="sa-card-h"><span className="t">Appointments</span><span className="sa-mod-count">{client.appointments.length} total</span></div>
          {attendedError && <div className="sa-errbar" style={{ marginBottom: 10 }}>{attendedError}</div>}
          {client.appointments.length === 0 ? (
            <p className="sa-empty">No appointments</p>
          ) : (
            <div className="sa-appt">
              {client.appointments.map((appt) => {
                const date = new Date(appt.startTime);
                const isPast = date < new Date();
                const isAttended = appt.status === 'showed' || appt.status === 'completed';
                const canMark = isPast && !isAttended && appt.status !== 'cancelled';
                const isMarking = markingAttended === appt.id;
                return (
                  <div key={appt.id} className={`sa-appt-row${isPast && !canMark && !isAttended ? ' is-dim' : ''}`}>
                    <div className="info">
                      <div className="nm">{appt.title}</div>
                      <div className="mt">{fmtDate(appt.startTime)} · {fmtTime(appt.startTime)}{appt.calendarName && ` · ${appt.calendarName}`}</div>
                    </div>
                    {isAttended ? (
                      <button className="sa-att is-on" disabled><span>Attended</span><span className="sw" /></button>
                    ) : canMark ? (
                      <button className="sa-att" onClick={() => handleMarkAttended(appt)} disabled={isMarking}>
                        <span>{isMarking ? 'Marking…' : 'Mark'}</span><span className="sw" />
                      </button>
                    ) : appt.status === 'cancelled' ? (
                      <span className="sa-status-pill is-cancel">Cancelled</span>
                    ) : (
                      <span className="sa-conf">{appt.status === 'confirmed' || !isPast ? 'Confirmed' : appt.status}</span>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </section>

        {/* ============ ADMIN & CHECKOUT ============ */}
        <div className="sa-group admin"><span className="gm" /><span className="gt">Admin & checkout</span><span className="gs">Payment, products, records</span><span className="gl" /></div>

        {/* pay status banner */}
        {showPaymentBanner && (
          <div className={`sa-paystat${client.sessionPrepaid ? ' is-paid' : ''}`}>
            <span className="l">
              <span className="ic">{client.sessionPrepaid ? <Check size={18} strokeWidth={2.2} /> : <DollarSign size={18} />}</span>
              {client.sessionPrepaid ? 'Prepaid' : 'Pay at visit'}
            </span>
            <button onClick={handleTogglePrepaid} disabled={togglingPrepaid}>
              {togglingPrepaid ? '…' : client.sessionPrepaid ? 'Undo' : 'Mark prepaid'}
            </button>
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

        {/* partner toolkit + not-a-fit — toolkit mirrors the pay-link pattern:
            tap to reveal a confirm, then tap to actually send (it fires a real
            message to the client, so no single-press accidental sends). */}
        {showPartnerActions && (
          <>
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
            {!isPartner && toolkitStatus !== 'sent' && (
              <button className="sa-qbtn is-ghost" onClick={handleNotAFit} disabled={markingNotFit || notFitStatus === 'done'}>
                <span className="ic">{markingNotFit ? <Loader2 size={16} className="sa-spin" /> : notFitStatus === 'done' ? <CheckCircle2 size={16} /> : <XCircle size={16} />}</span>
                <span className="tx"><b>{notFitStatus === 'done' ? 'Marked — future potential' : 'Not a fit'}</b></span>
              </button>
            )}
          </>
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
            <div className="cell"><span className="v">{currentSeriesCompleted}</span><span className="lbl k">This series</span></div>
            <div className="cell"><span className="v">{client.sessionsRemaining}</span><span className="lbl k">Remaining</span></div>
            <div className="cell"><span className="v">{packageLabel}</span><span className="lbl k">Package</span></div>
          </div>
          {totalSessions > 0 && <div className="sa-prog-bar"><i style={{ width: progressPct + '%' }} /></div>}
          {isReturning && <p className="sa-prog-foot">{client.sessionsCompleted} lifetime sessions</p>}
        </section>

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
          {client.notes.length === 0 ? (
            <p className="sa-empty">No notes yet</p>
          ) : (
            <div className="sa-notes">
              {client.notes.map((n) => (
                <div key={n.id} className="sa-note">
                  <div className="sa-note-meta"><span className="sa-note-kind">{noteKind(n.body)}</span><span className="sa-note-date">{fmtDate(n.dateAdded)}</span></div>
                  <p>{n.body}</p>
                </div>
              ))}
            </div>
          )}
        </section>

        {/* messages */}
        <section className="sa-card" id="messages-section" style={{ scrollMarginTop: 16 }}>
          <div className="sa-card-h">
            <span className="t">Recent messages</span>
            <a className="sa-ghl" href={`https://app.gohighlevel.com/v2/location/7pIO7FHVAyBT1jKGhfQM/contacts/detail/${client.id}`} target="_blank" rel="noopener noreferrer">Reply in GHL <ExternalLink size={13} /></a>
          </div>
          {client.messages.length === 0 ? (
            <p className="sa-empty">No messages</p>
          ) : (
            <div className="sa-msgs">
              {client.messages.map((m) => (
                <div key={m.id} className={`sa-msg${m.body && m.body.trim().length <= 3 ? ' is-emoji' : ''}`}>
                  <div className="sa-msg-top">
                    <span className="sa-msg-dir">{m.direction === 'outbound' ? 'Sent' : 'Received'}</span>
                    <span className="sa-msg-ch">{msgChannel(m.type)}</span>
                    <span className="sa-msg-date">{fmtDate(m.dateAdded)}</span>
                  </div>
                  <p>{m.body}</p>
                </div>
              ))}
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
