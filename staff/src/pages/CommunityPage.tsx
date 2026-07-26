import { Building2, CalendarClock, CalendarDays, ChevronLeft, ChevronRight, ClipboardPenLine, ExternalLink, Image as ImageIcon, Mail, MapPin, MapPinned, Phone, RefreshCw, Users, X } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { getCommunityRelationshipImage, getCommunityRelationships, recordCommunityTouch } from '../lib/api';
import type { CommunityRelationship, CommunityRelationshipStage } from '../types/staff';

const STAGE: Record<CommunityRelationshipStage, { label: string; tone: string }> = {
  host: { label: 'Flyer host', tone: 'host' },
  engaged_host: { label: 'Building trust', tone: 'engaged' },
  partner: { label: 'Partner', tone: 'partner' },
  workshop_opportunity: { label: 'Workshop signal', tone: 'workshop' },
};

type Touch = {
  relationship: CommunityRelationship;
  notes: string;
  relationship_stage: CommunityRelationshipStage;
  workshop_signal: boolean;
  next_visit_on: string;
  event_on: string;
  event_title: string;
  event_details: string;
};

function localDate() {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Los_Angeles', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts();
  const value = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value || '';
  return `${value('year')}-${value('month')}-${value('day')}`;
}

function compactDate(value: string | null) {
  if (!value) return null;
  return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' }).format(new Date(`${value}T12:00:00Z`));
}

function relativeDate(value: string | null) {
  if (!value) return 'No next touch set';
  const today = localDate();
  if (value < today) return `Overdue · ${compactDate(value)}`;
  if (value === today) return 'Touch today';
  return `Touch ${compactDate(value)}`;
}

function isEventRelationship(partner: CommunityRelationship) {
  return Boolean(partner.event_on || partner.workshop_signal || partner.relationship_stage === 'workshop_opportunity');
}

function eventSummary(partner: CommunityRelationship) {
  if (partner.event_title) return partner.event_title;
  if (partner.relationship_stage === 'workshop_opportunity') return 'Workshop opportunity';
  return 'Partnership conversation';
}

function RelationshipCard({ partner, kind, onOpen }: { partner: CommunityRelationship; kind: 'next' | 'active' | 'event'; onOpen: (partner: CommunityRelationship) => void }) {
  const stage = STAGE[partner.relationship_stage] || STAGE.host;
  const hasEvent = kind === 'event';
  return <button type="button" className={`community-card community-card--${kind}`} onClick={() => onOpen(partner)} aria-label={`Open ${partner.business_name} relationship record`}>
    <div className="community-card__head">
      <span className={`community-stage community-stage--${stage.tone}`}>{stage.label}</span>
      <span className="community-card__visits">{partner.visit_count} visit{partner.visit_count === 1 ? '' : 's'}</span>
    </div>
    <h2>{partner.business_name}</h2>
    {partner.location && <p className="community-card__location"><MapPin aria-hidden="true" /> {partner.location}</p>}
    {hasEvent && <p className="community-card__event"><CalendarDays aria-hidden="true" /> {partner.event_on ? `${compactDate(partner.event_on)} · ` : ''}{eventSummary(partner)}</p>}
    {partner.latest_note && <p className="community-card__note">{partner.latest_note}</p>}
    <footer>
      {hasEvent ? <span className={partner.event_on && partner.event_on < localDate() ? 'community-card__due community-card__due--now' : 'community-card__due'}><CalendarDays aria-hidden="true" /> {partner.event_on ? `Event ${compactDate(partner.event_on)}` : 'Event details to shape'}</span> : <span className={partner.next_visit_on && partner.next_visit_on <= localDate() ? 'community-card__due community-card__due--now' : 'community-card__due'}><CalendarClock aria-hidden="true" /> {relativeDate(partner.next_visit_on)}</span>}
      {partner.contact?.name && <span className="community-card__contact"><Users aria-hidden="true" /> {partner.contact.name}{partner.contact.role ? ` · ${partner.contact.role}` : ''}</span>}
      {partner.image_count > 0 && <span className="community-card__image"><ImageIcon aria-hidden="true" /> {partner.image_count} card photo{partner.image_count === 1 ? '' : 's'} <ChevronRight aria-hidden="true" /></span>}
    </footer>
  </button>;
}

function TouchForm({ partner, saving, onSave }: { partner: CommunityRelationship; saving: boolean; onSave: (touch: Touch) => Promise<void> }) {
  const [notes, setNotes] = useState('');
  const [stage, setStage] = useState<CommunityRelationshipStage>(partner.relationship_stage);
  const [nextVisitOn, setNextVisitOn] = useState(partner.next_visit_on || '');
  const [workshopSignal, setWorkshopSignal] = useState(partner.workshop_signal);
  const [eventOn, setEventOn] = useState(partner.event_on || '');
  const [eventTitle, setEventTitle] = useState(partner.event_title || '');
  const [eventDetails, setEventDetails] = useState(partner.event_details || '');
  const [error, setError] = useState('');

  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!notes.trim()) { setError('Add a short note so the next touch has context.'); return; }
    setError('');
    try { await onSave({ relationship: partner, notes, relationship_stage: stage, workshop_signal: workshopSignal, next_visit_on: nextVisitOn, event_on: eventOn, event_title: eventTitle, event_details: eventDetails }); }
    catch (err) { setError(err instanceof Error ? err.message : 'Could not save this touch.'); }
  };

  return <form className="community-touch" onSubmit={(event) => void submit(event)}>
    <header><ClipboardPenLine aria-hidden="true" /><span>Log a touch</span><p>A quick record for the next conversation.</p></header>
    <label>What happened<textarea value={notes} onChange={(event) => setNotes(event.target.value)} rows={3} placeholder="Talked with… We agreed to…" autoFocus /></label>
    <div className="community-touch__fields">
      <label>Status<select value={stage} onChange={(event) => setStage(event.target.value as CommunityRelationshipStage)}>{Object.entries(STAGE).map(([value, option]) => <option key={value} value={value}>{option.label}</option>)}</select></label>
      <label>Next touch<input type="date" value={nextVisitOn} onChange={(event) => setNextVisitOn(event.target.value)} /></label>
    </div>
    <label className="community-touch__check"><input type="checkbox" checked={workshopSignal} onChange={(event) => setWorkshopSignal(event.target.checked)} /> This opened a workshop or staff-care conversation</label>
    <details className="community-touch__event">
      <summary>Add event or workshop details</summary>
      <div className="community-touch__fields"><label>Date<input type="date" value={eventOn} onChange={(event) => setEventOn(event.target.value)} /></label><label>Event / workshop name<input value={eventTitle} onChange={(event) => setEventTitle(event.target.value)} placeholder="September tennis-center tabling" /></label></div>
      <label>What needs to be ready<textarea value={eventDetails} onChange={(event) => setEventDetails(event.target.value)} rows={2} placeholder="Audience, offer, banner, table wares…" /></label>
    </details>
    {error && <p className="community-touch__error">{error}</p>}
    <button type="submit" disabled={saving}>{saving ? 'Saving…' : 'Save touch'}</button>
  </form>;
}

function RelationshipDetail({ partner, image, imageCount, imageIndex, imageLoading, imageError, saving, onClose, onPrevious, onNext, onSave }: {
  partner: CommunityRelationship;
  image: string | null;
  imageCount: number;
  imageIndex: number;
  imageLoading: boolean;
  imageError: string;
  saving: boolean;
  onClose: () => void;
  onPrevious: () => void;
  onNext: () => void;
  onSave: (touch: Touch) => Promise<void>;
}) {
  const stage = STAGE[partner.relationship_stage] || STAGE.host;
  return <div className="community-detail__veil" role="presentation" onMouseDown={onClose}>
    <section className="community-detail" role="dialog" aria-modal="true" aria-label={`${partner.business_name} relationship record`} onMouseDown={(event) => event.stopPropagation()}>
      <header><span className={`community-stage community-stage--${stage.tone}`}>{stage.label}</span><button type="button" onClick={onClose} aria-label="Close relationship record"><X aria-hidden="true" /></button></header>
      <div className="community-detail__body">
        <div className="community-detail__photo">{imageLoading ? <span><RefreshCw className="animate-spin" aria-hidden="true" /> Loading card photo…</span> : image ? <img src={image} alt={`Business card for ${partner.business_name}`} /> : <span><ImageIcon aria-hidden="true" /> {imageError || 'No business-card photo captured yet.'}</span>}</div>
        {imageCount > 1 && <nav className="community-detail__gallery" aria-label="Business card photos"><button type="button" onClick={onPrevious} disabled={imageIndex === 0}><ChevronLeft aria-hidden="true" /></button><span>{imageIndex + 1} / {imageCount}</span><button type="button" onClick={onNext} disabled={imageIndex === imageCount - 1}><ChevronRight aria-hidden="true" /></button></nav>}
        <div className="community-detail__copy"><p>Relationship record</p><h2>{partner.business_name}</h2>{partner.location && <span className="community-detail__location"><MapPin aria-hidden="true" /> {partner.location}</span>}{partner.latest_note && <p className="community-detail__note">{partner.latest_note}</p>}{isEventRelationship(partner) && <span className="community-detail__event"><CalendarDays aria-hidden="true" /> {partner.event_on ? `${compactDate(partner.event_on)} · ` : ''}{eventSummary(partner)}</span>}{partner.event_details && <p className="community-detail__event-details">{partner.event_details}</p>}<span className={partner.next_visit_on && partner.next_visit_on <= localDate() ? 'community-detail__due community-detail__due--now' : 'community-detail__due'}><CalendarClock aria-hidden="true" /> {relativeDate(partner.next_visit_on)}</span></div>
        {partner.contact && (partner.contact.name || partner.contact.email || partner.contact.phone) && <section className="community-detail__contact"><p>Person at the business</p>{partner.contact.name && <strong>{partner.contact.name}</strong>}{partner.contact.role && <span>{partner.contact.role}</span>}<div>{partner.contact.email && <a href={`mailto:${partner.contact.email}`}><Mail aria-hidden="true" /> Email</a>}{partner.contact.phone && <a href={`tel:${partner.contact.phone.replace(/[^+\d]/g, '')}`}><Phone aria-hidden="true" /> Call</a>}</div></section>}
        <TouchForm partner={partner} saving={saving} onSave={onSave} />
      </div>
    </section>
  </div>;
}

export default function CommunityPage() {
  const [partners, setPartners] = useState<CommunityRelationship[]>([]);
  const [loading, setLoading] = useState(true);
  const [savingTouch, setSavingTouch] = useState(false);
  const [error, setError] = useState('');
  const [selectedPartner, setSelectedPartner] = useState<CommunityRelationship | null>(null);
  const [image, setImage] = useState<string | null>(null);
  const [imageCount, setImageCount] = useState(0);
  const [imageIndex, setImageIndex] = useState(0);
  const [imageLoading, setImageLoading] = useState(false);
  const [imageError, setImageError] = useState('');

  const load = useCallback(async () => { setLoading(true); setError(''); try { setPartners(await getCommunityRelationships()); } catch (err) { setError(err instanceof Error ? err.message : 'Could not load field relationships.'); } finally { setLoading(false); } }, []);
  const loadImage = useCallback(async (partner: CommunityRelationship, index = 0) => { setImageLoading(true); setImageError(''); setImage(null); try { const result = await getCommunityRelationshipImage(partner.id, index); setImage(result.image_data_url); setImageCount(result.image_count); setImageIndex(index); } catch (err) { setImageError(err instanceof Error ? err.message : 'Could not load the card photo.'); } finally { setImageLoading(false); } }, []);
  const openPartner = useCallback((partner: CommunityRelationship) => { setSelectedPartner(partner); setImageCount(partner.image_count || 0); setImageIndex(0); setImageError(''); setImage(null); if (partner.image_count) void loadImage(partner); }, [loadImage]);
  const closePartner = useCallback(() => setSelectedPartner(null), []);
  const saveTouch = useCallback(async (touch: Touch) => { setSavingTouch(true); try { await recordCommunityTouch(touch); await load(); closePartner(); } finally { setSavingTouch(false); } }, [closePartner, load]);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => { if (!selectedPartner) return; const closeOnEscape = (event: KeyboardEvent) => { if (event.key === 'Escape') closePartner(); }; window.addEventListener('keydown', closeOnEscape); return () => window.removeEventListener('keydown', closeOnEscape); }, [selectedPartner, closePartner]);

  const { nextMoves, active, events } = useMemo(() => {
    const eventRelationships = partners.filter(isEventRelationship).sort((a, b) => String(a.event_on || '9999-12-31').localeCompare(String(b.event_on || '9999-12-31')) || String(b.latest_visit_at || '').localeCompare(String(a.latest_visit_at || '')));
    const next = partners.filter((partner) => !eventRelationships.includes(partner) && partner.next_visit_on).sort((a, b) => String(a.next_visit_on).localeCompare(String(b.next_visit_on)));
    return { nextMoves: next, active: partners.filter((partner) => !eventRelationships.includes(partner) && !next.includes(partner)), events: eventRelationships };
  }, [partners]);

  return <main className="community-page">
    <header className="community-page__head"><div><p>Field relationships</p><h1>Around town</h1><span>Your desk for the relationships that have actually begun.</span></div><div className="community-page__actions"><a href="https://www.google.com/maps/d/u/0/edit?mid=1SGDCg2GLSCvsK9sjFBZSTQtYJv3iYKg&ll=37.75680594284302%2C-122.44620750000001&z=13" target="_blank" rel="noreferrer"><MapPinned aria-hidden="true" /> Potential partner map <ExternalLink aria-hidden="true" /></a><button type="button" onClick={() => void load()} disabled={loading}><RefreshCw aria-hidden="true" className={loading ? 'animate-spin' : ''} /> Refresh</button></div></header>
    {error ? <section className="community-empty community-empty--error"><p>{error}</p><button type="button" onClick={() => void load()}>Try again</button></section> : loading ? <section className="community-empty"><RefreshCw className="animate-spin" aria-hidden="true" /><p>Loading field relationships…</p></section> : partners.length === 0 ? <section className="community-empty"><Building2 aria-hidden="true" /><h2>No field relationships yet</h2><p>After the first visit, log the business through Chief of Staff and it will appear here.</p></section> : <div className="community-lanes"><section className="community-lane community-lane--next"><header><div><p>Do next</p><span>Follow-ups with a date</span></div><strong>{nextMoves.length}</strong></header>{nextMoves.length ? nextMoves.map((partner) => <RelationshipCard key={partner.id} partner={partner} kind="next" onOpen={openPartner} />) : <p className="community-lane__empty">Nothing scheduled yet. Set the next touch on an active relationship.</p>}</section><section className="community-lane"><header><div><p>Active relationships</p><span>Keep the thread alive</span></div><strong>{active.length}</strong></header>{active.length ? active.map((partner) => <RelationshipCard key={partner.id} partner={partner} kind="active" onOpen={openPartner} />) : <p className="community-lane__empty">No relationships are waiting for a next step.</p>}</section><section className="community-lane community-lane--events"><header><div><p>Events & workshops</p><span>Prepare the opportunity</span></div><strong>{events.length}</strong></header>{events.length ? events.map((partner) => <RelationshipCard key={partner.id} partner={partner} kind="event" onOpen={openPartner} />) : <p className="community-lane__empty">Events and workshop conversations will collect here.</p>}</section></div>}
    {selectedPartner && <RelationshipDetail partner={selectedPartner} image={image} imageCount={imageCount} imageIndex={imageIndex} imageLoading={imageLoading} imageError={imageError} saving={savingTouch} onClose={closePartner} onPrevious={() => void loadImage(selectedPartner, imageIndex - 1)} onNext={() => void loadImage(selectedPartner, imageIndex + 1)} onSave={saveTouch} />}
  </main>;
}
