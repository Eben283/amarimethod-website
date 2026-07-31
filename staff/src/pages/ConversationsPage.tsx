import { CalendarDays, ChevronLeft, CircleDollarSign, DoorOpen, Loader2, MessageSquare, Send } from 'lucide-react';
import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { getDayData, getInboxThread, getInboxThreads, sendFollowupEmail, sendFollowupText } from '../lib/api';
import type { InboxThread, InboxThreadSummary, TodayAppointment } from '../types/staff';

type ComposeChannel = 'sms' | 'email';

function pacificDate() {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Los_Angeles', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts();
  const value = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value || '';
  return `${value('year')}-${value('month')}-${value('day')}`;
}

function formatWhen(ms: number | null) {
  if (!ms) return '';
  const date = new Date(ms);
  const now = Date.now();
  const diff = now - ms;
  if (diff < 60_000) return 'Just now';
  if (diff < 3_600_000) return `${Math.max(1, Math.round(diff / 60_000))}m`;
  if (diff < 86_400_000) return `${Math.max(1, Math.round(diff / 3_600_000))}h`;
  return date.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: 'America/Los_Angeles' });
}

function appointmentLabel(appointment: TodayAppointment | undefined) {
  if (!appointment) return null;
  return new Intl.DateTimeFormat('en-US', { weekday: 'short', hour: 'numeric', minute: '2-digit', timeZone: 'America/Los_Angeles' }).format(new Date(appointment.startTime));
}

function bodyToHtml(s: string): string {
  const esc = (t: string) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  return s.trim().split(/\n{2,}/).map((p) => `<p>${esc(p).replace(/\n/g, '<br>')}</p>`).join('');
}

export default function ConversationsPage() {
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const selectedId = params.get('contact') || '';

  const [threads, setThreads] = useState<InboxThreadSummary[]>([]);
  const [thread, setThread] = useState<InboxThread | null>(null);
  const [todayByContact, setTodayByContact] = useState<Record<string, TodayAppointment>>({});
  const [listLoading, setListLoading] = useState(true);
  const [threadLoading, setThreadLoading] = useState(false);
  const [listError, setListError] = useState<string | null>(null);
  const [threadError, setThreadError] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [emailSubject, setEmailSubject] = useState('Following up');
  const [channel, setChannel] = useState<ComposeChannel>('sms');
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);

  const loadList = useCallback(async () => {
    setListLoading(true);
    setListError(null);
    try {
      const [inbox, appointments] = await Promise.all([
        getInboxThreads('all'),
        getDayData(pacificDate()).catch(() => [] as TodayAppointment[]),
      ]);
      setThreads(inbox.threads || []);
      const map: Record<string, TodayAppointment> = {};
      for (const appointment of appointments) {
        if (!appointment.contactId) continue;
        if (appointment.appointmentStatus?.toLowerCase() === 'cancelled') continue;
        if (!map[appointment.contactId]) map[appointment.contactId] = appointment;
      }
      setTodayByContact(map);
    } catch (err) {
      setListError(err instanceof Error ? err.message : 'Could not load conversations');
    } finally {
      setListLoading(false);
    }
  }, []);

  const loadThread = useCallback(async (contactId: string) => {
    setThreadLoading(true);
    setThreadError(null);
    try {
      const response = await getInboxThread(contactId);
      setThread(response.thread);
      setThreads((current) => current.map((item) => (
        item.contactId === contactId ? { ...item, unread: false, needsReply: response.thread.needsReply } : item
      )));
    } catch (err) {
      setThread(null);
      setThreadError(err instanceof Error ? err.message : 'Could not open thread');
    } finally {
      setThreadLoading(false);
    }
  }, []);

  useEffect(() => { void loadList(); }, [loadList]);
  useEffect(() => {
    if (!selectedId) {
      setThread(null);
      setDraft('');
      setEmailSubject('Following up');
      setChannel('sms');
      setSendError(null);
      return;
    }
    void loadThread(selectedId);
  }, [selectedId, loadThread]);

  const selectedAppointment = selectedId ? todayByContact[selectedId] : undefined;
  const statusBits = useMemo(() => {
    const bits: string[] = [];
    if (thread?.needsReply) bits.push('Needs reply');
    if (selectedAppointment) bits.push(`Appt ${appointmentLabel(selectedAppointment)}`);
    return bits;
  }, [thread, selectedAppointment]);

  const canSend = Boolean(draft.trim()) && !sending && (channel === 'sms' || Boolean(emailSubject.trim()));

  function openThread(contactId: string) {
    setParams({ contact: contactId });
  }

  function backToList() {
    setParams({});
  }

  async function onSend(event: FormEvent) {
    event.preventDefault();
    if (!selectedId || !canSend) return;
    setSending(true);
    setSendError(null);
    const message = draft.trim();
    try {
      if (channel === 'email') {
        await sendFollowupEmail(selectedId, emailSubject.trim() || 'Following up', bodyToHtml(message));
      } else {
        await sendFollowupText(selectedId, message);
      }
      setDraft('');
      await Promise.all([loadThread(selectedId), loadList()]);
    } catch (err) {
      setSendError(err instanceof Error ? err.message : 'Send failed');
    } finally {
      setSending(false);
    }
  }

  if (selectedId) {
    return (
      <main className="inbox-page inbox-page--workspace">
        <header className="inbox-workspace__head">
          <button type="button" className="inbox-back" onClick={backToList}><ChevronLeft aria-hidden="true" /> Conversations</button>
          <div>
            <h1>{thread?.contactName || 'Conversation'}</h1>
            {selectedAppointment ? <p>{selectedAppointment.title || 'Follow-up'} · {appointmentLabel(selectedAppointment)}</p> : <p>Thread</p>}
            {statusBits.length ? <div className="inbox-status">{statusBits.map((bit) => <span key={bit}>{bit}</span>)}</div> : null}
          </div>
        </header>

        <section className="inbox-thread" aria-label="Message thread">
          {threadLoading ? <div className="inbox-empty"><Loader2 className="animate-spin" aria-hidden="true" /> Loading thread…</div> : null}
          {threadError ? <div className="inbox-empty inbox-empty--error" role="alert">{threadError}</div> : null}
          {!threadLoading && thread ? thread.messages.map((message) => (
            <article key={message.id} className={`inbox-bubble inbox-bubble--${message.direction}`}>
              <header>
                <span>{message.direction === 'inbound' ? 'Them' : 'You'}</span>
                <span>{message.type}</span>
                <time>{formatWhen(new Date(message.dateAdded).getTime())}</time>
              </header>
              <p>{message.body || '(no text)'}</p>
            </article>
          )) : null}
          {!threadLoading && thread && thread.messages.length === 0 ? <div className="inbox-empty">No cached messages yet for this person.</div> : null}
        </section>

        <form className="inbox-compose" onSubmit={onSend}>
          <div className="inbox-compose__channel" role="group" aria-label="Send as">
            <button
              type="button"
              className={channel === 'sms' ? 'is-selected' : undefined}
              aria-pressed={channel === 'sms'}
              onClick={() => setChannel('sms')}
            >
              SMS
            </button>
            <button
              type="button"
              className={channel === 'email' ? 'is-selected' : undefined}
              aria-pressed={channel === 'email'}
              onClick={() => setChannel('email')}
            >
              Email
            </button>
          </div>
          {channel === 'email' ? (
            <label className="inbox-compose__subject">
              <span className="sr-only">Subject</span>
              <input
                type="text"
                value={emailSubject}
                onChange={(event) => setEmailSubject(event.target.value)}
                placeholder="Subject"
                maxLength={200}
              />
            </label>
          ) : null}
          <label className="inbox-compose__body">
            <span className="sr-only">Reply</span>
            <textarea
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              placeholder={channel === 'email' ? 'Email…' : 'SMS…'}
              rows={2}
              maxLength={channel === 'email' ? 8000 : 720}
            />
          </label>
          <button type="submit" disabled={!canSend}>
            {sending ? <Loader2 className="animate-spin" aria-hidden="true" /> : <Send aria-hidden="true" />}
            Send {channel === 'email' ? 'email' : 'SMS'}
          </button>
          {sendError ? <p className="inbox-compose__error" role="alert">{sendError}</p> : null}
        </form>

        <section className="inbox-actions" aria-label="Secondary actions">
          <p>Also</p>
          <div>
            <button type="button" onClick={() => navigate(`/client/${selectedId}`)}>
              <CalendarDays aria-hidden="true" />
              <strong>Book</strong>
              <small>Schedule</small>
            </button>
            <button type="button" onClick={() => navigate('/pos')}>
              <CircleDollarSign aria-hidden="true" />
              <strong>POS</strong>
              <small>Take payment</small>
            </button>
            <button
              type="button"
              onClick={() => navigate(selectedAppointment ? `/client/${selectedId}?appointment=${selectedAppointment.id}` : `/client/${selectedId}`)}
            >
              <DoorOpen aria-hidden="true" />
              <strong>Open session</strong>
              <small>{selectedAppointment ? 'In session' : 'Client view'}</small>
            </button>
          </div>
        </section>
      </main>
    );
  }

  return (
    <main className="inbox-page">
      <header className="inbox-list__head">
        <Link to="/" className="inbox-back"><ChevronLeft aria-hidden="true" /> Staff home</Link>
        <div>
          <p>Inbox</p>
          <h1>Conversations</h1>
          <span>Every cached thread, newest first.</span>
        </div>
      </header>

      <section className="inbox-list" aria-label="Conversation list">
        {listLoading ? <div className="inbox-empty"><Loader2 className="animate-spin" aria-hidden="true" /> Loading conversations…</div> : null}
        {listError ? <div className="inbox-empty inbox-empty--error" role="alert">{listError}</div> : null}
        {!listLoading && !listError && threads.length === 0 ? (
          <div className="inbox-empty"><MessageSquare aria-hidden="true" /> No threads in cache yet.</div>
        ) : null}
        {!listLoading && threads.map((item) => (
          <button key={item.contactId} type="button" className="inbox-row" onClick={() => openThread(item.contactId)}>
            <span className="inbox-row__avatar" aria-hidden="true">{(item.contactName || '?').slice(0, 1)}</span>
            <span className="inbox-row__copy">
              <strong>{item.contactName}</strong>
              <small>{item.lastMessagePreview || item.lastMessageType}</small>
            </span>
            <span className="inbox-row__meta">
              {item.unread || item.needsReply ? <i aria-hidden="true" /> : null}
              <time>{formatWhen(item.lastMessageDate)}</time>
            </span>
          </button>
        ))}
      </section>
    </main>
  );
}
