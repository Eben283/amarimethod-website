import { useEffect, useRef, useState } from 'react';
import { Loader2, MessageSquareText, PhoneCall, Search, Send, ShieldCheck } from 'lucide-react';
import { Link, useLocation, useSearchParams } from 'react-router-dom';
import { ApiError, getContactDetail, searchContacts, sendFollowupText } from '../lib/api';
import type { ContactListItem } from '../types/staff';
import { useAuth } from '../contexts/AuthContext';
import './CommunicationsPage.css';

const MAX_SMS_LENGTH = 720;

function contactLabel(contact: ContactListItem) { return contact.phone || contact.email || 'No phone number on record'; }

export default function CommunicationsPage() {
  const { logout } = useAuth();
  const location = useLocation();
  const [searchParams] = useSearchParams();
  const [query, setQuery] = useState('');
  const [contacts, setContacts] = useState<ContactListItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState<ContactListItem | null>(null);
  const [message, setMessage] = useState('');
  const [confirming, setConfirming] = useState(false);
  const [sending, setSending] = useState(false);
  const [notice, setNotice] = useState('');
  const requestRef = useRef(0);
  const requestedContactRef = useRef<string | null>(null);
  const requestedContact = searchParams.get('contact') || '';
  const draftedMessage = typeof location.state?.draft === 'string' ? location.state.draft.trim().slice(0, MAX_SMS_LENGTH) : '';

  useEffect(() => {
    if (!/^[A-Za-z0-9_-]{1,80}$/.test(requestedContact) || requestedContactRef.current === requestedContact) return;
    requestedContactRef.current = requestedContact;
    setLoading(true);
    void getContactDetail(requestedContact).then((contact) => {
      setSelected({ id: contact.id, name: [contact.firstName, contact.lastName].filter(Boolean).join(' ') || contact.email || 'Unnamed contact', email: contact.email || '', phone: contact.phone || '', lastAppointment: null, sessionsRemaining: contact.sessionsRemaining, seriesType: contact.seriesType });
      if (draftedMessage) setMessage(draftedMessage);
    }).catch((error: unknown) => {
      if (error instanceof ApiError && error.status === 401) logout();
      setNotice(error instanceof Error ? error.message : 'Could not load this contact.');
    }).finally(() => setLoading(false));
  }, [draftedMessage, logout, requestedContact]);

  useEffect(() => {
    const value = query.trim(); const requestId = ++requestRef.current;
    if (value.length < 2) { setContacts([]); setLoading(false); return; }
    setLoading(true);
    const timer = window.setTimeout(() => { void searchContacts(value).then((results) => { if (requestId === requestRef.current) setContacts(results.slice(0, 8)); }).catch((error: unknown) => { if (requestId !== requestRef.current) return; if (error instanceof ApiError && error.status === 401) logout(); setContacts([]); }).finally(() => { if (requestId === requestRef.current) setLoading(false); }); }, 280);
    return () => window.clearTimeout(timer);
  }, [logout, query]);

  function choose(contact: ContactListItem) { setSelected(contact); setQuery(''); setContacts([]); setNotice(''); setConfirming(false); }
  async function send() {
    if (!selected || !message.trim()) return;
    setSending(true); setNotice('');
    try { const result = await sendFollowupText(selected.id, message.trim()); setNotice(result.deduped ? 'This exact text was already sent recently.' : `Sent to ${result.sentTo || selected.name}.`); setMessage(''); setConfirming(false); }
    catch (error) { if (error instanceof ApiError && error.status === 401) logout(); setNotice(error instanceof Error ? error.message : 'Text could not be sent.'); }
    finally { setSending(false); }
  }
  const canSend = Boolean(selected?.phone && message.trim() && message.trim().length <= MAX_SMS_LENGTH);

  return <main className="communications-page">
    <header className="staff-pagehead communications-page__head"><div><p className="staff-mlabel">Amari communications</p><h1>Call and text</h1></div><span className="communications-page__status"><ShieldCheck aria-hidden="true" /> Signed-in Staff only</span></header>
    <section className="communications-card" aria-labelledby="text-title"><div className="communications-card__title"><MessageSquareText aria-hidden="true" /><div><h2 id="text-title">Text from the Amari number</h2><p>Uses the existing GHL sender and writes to the existing GHL conversation.</p></div></div>
      {!selected ? <div className="communications-search"><label htmlFor="communications-search">Find a contact</label><div className="communications-search__field"><Search aria-hidden="true" /><input id="communications-search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Name, email, or phone" autoComplete="off" />{loading ? <Loader2 className="is-spinning" aria-label="Searching" /> : null}</div>{contacts.length ? <div className="communications-search__results" role="listbox" aria-label="Contact results">{contacts.map((contact) => <button key={contact.id} type="button" role="option" onClick={() => choose(contact)}><strong>{contact.name || 'Unnamed contact'}</strong><span>{contactLabel(contact)}</span></button>)}</div> : null}</div> : <div className="communications-compose"><div className="communications-recipient"><div><span>To</span><strong>{selected.name || 'Unnamed contact'}</strong><small>{contactLabel(selected)}</small></div><div className="communications-recipient__actions"><Link to={`/client-desk?contact=${encodeURIComponent(selected.id)}`}>Open full history</Link><button type="button" onClick={() => { setSelected(null); setMessage(''); setConfirming(false); setNotice(''); }}>Change</button></div></div>{!selected.phone ? <p className="communications-warning">This contact has no phone number, so texting is unavailable.</p> : <><label htmlFor="communications-message">Message</label><textarea id="communications-message" value={message} onChange={(event) => { setMessage(event.target.value); setConfirming(false); }} maxLength={MAX_SMS_LENGTH} placeholder="Write a personal message…" /><div className="communications-compose__foot"><span>{message.length}/{MAX_SMS_LENGTH}</span><button type="button" disabled={!canSend || sending} onClick={() => setConfirming(true)}><Send aria-hidden="true" /> Review text</button></div></>}</div>}
      {notice ? <p className="communications-notice" role="status">{notice}</p> : null}
    </section>
    <section className="communications-card communications-card--call" aria-labelledby="call-title"><div className="communications-card__title"><PhoneCall aria-hidden="true" /><div><h2 id="call-title">Call bridge</h2><p>Coming with the phone-provider cutover.</p></div></div><p className="communications-call-copy">Calls stay in GHL for now so the active Amari number, call logs, and recordings retain one owner. When the number moves, this page will call the authorized Verizon handset first and then connect the contact without exposing the personal number.</p><button type="button" disabled>Call bridge unavailable until cutover</button></section>
    {confirming && selected ? <div className="communications-modal-backdrop" role="presentation"><section className="communications-modal" role="dialog" aria-modal="true" aria-labelledby="review-text-title"><h2 id="review-text-title">Send this text?</h2><p><strong>To:</strong> {selected.name} · {selected.phone}</p><blockquote>{message.trim()}</blockquote><p className="communications-modal__note">This sends immediately through the current GHL number and will appear in the contact’s conversation history.</p><div><button type="button" onClick={() => setConfirming(false)} disabled={sending}>Go back</button><button type="button" className="is-primary" onClick={() => void send()} disabled={sending}>{sending ? <><Loader2 className="is-spinning" /> Sending…</> : <><Send /> Send text</>}</button></div></section></div> : null}
  </main>;
}
