import { ArrowUpRight, Building2, CalendarClock, ChevronLeft, ChevronRight, FileText, Image as ImageIcon, Mail, MapPin, MapPinned, Phone, RefreshCw, Sparkles, Users, X } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { getCommunityRelationshipImage, getCommunityRelationships } from '../lib/api';
import type { CommunityRelationship, CommunityRelationshipStage } from '../types/staff';

const STAGE: Record<CommunityRelationshipStage, { label: string; tone: string }> = {
  host: { label: 'Flyer host', tone: 'host' },
  engaged_host: { label: 'Building trust', tone: 'engaged' },
  partner: { label: 'Partner', tone: 'partner' },
  workshop_opportunity: { label: 'Workshop signal', tone: 'workshop' },
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
  if (!value) return 'No revisit set';
  const today = localDate();
  if (value < today) return `Overdue · ${compactDate(value)}`;
  if (value === today) return 'Revisit today';
  return `Revisit ${compactDate(value)}`;
}

function RelationshipCard({ partner, onOpen }: { partner: CommunityRelationship; onOpen: (partner: CommunityRelationship) => void }) {
  const stage = STAGE[partner.relationship_stage] || STAGE.host;
  return <button type="button" className="community-card" onClick={() => onOpen(partner)} aria-label={`Open ${partner.business_name} relationship record`}>
    <div className="community-card__head">
      <span className={`community-stage community-stage--${stage.tone}`}>{stage.label}</span>
      <span className="community-card__visits">{partner.visit_count} visit{partner.visit_count === 1 ? '' : 's'}</span>
    </div>
    <h2>{partner.business_name}</h2>
    {partner.location && <p className="community-card__location"><MapPin aria-hidden="true" /> {partner.location}</p>}
    {(partner.study || partner.flyer_location) && <p className="community-card__study">{partner.study || 'Study flyer'}{partner.flyer_location ? ` · ${partner.flyer_location}` : ''}</p>}
    {partner.latest_note && <p className="community-card__note">{partner.latest_note}</p>}
    <footer>
      <span className={partner.next_visit_on && partner.next_visit_on <= localDate() ? 'community-card__due community-card__due--now' : 'community-card__due'}><CalendarClock aria-hidden="true" /> {relativeDate(partner.next_visit_on)}</span>
      {partner.contact?.name && <span className="community-card__contact"><Users aria-hidden="true" /> {partner.contact.name}{partner.contact.role ? ` · ${partner.contact.role}` : ''}</span>}
      {partner.image_count > 0 && <span className="community-card__image"><ImageIcon aria-hidden="true" /> {partner.image_count} card photo{partner.image_count === 1 ? '' : 's'} <ChevronRight aria-hidden="true" /></span>}
      {partner.workshop_signal && <span className="community-card__workshop"><Sparkles aria-hidden="true" /> Workshop conversation</span>}
    </footer>
  </button>;
}

function RelationshipDetail({ partner, image, imageCount, imageIndex, imageLoading, imageError, onClose, onPrevious, onNext }: {
  partner: CommunityRelationship;
  image: string | null;
  imageCount: number;
  imageIndex: number;
  imageLoading: boolean;
  imageError: string;
  onClose: () => void;
  onPrevious: () => void;
  onNext: () => void;
}) {
  const stage = STAGE[partner.relationship_stage] || STAGE.host;
  return <div className="community-detail__veil" role="presentation" onMouseDown={onClose}>
    <section className="community-detail" role="dialog" aria-modal="true" aria-label={`${partner.business_name} relationship record`} onMouseDown={(event) => event.stopPropagation()}>
      <header>
        <span className={`community-stage community-stage--${stage.tone}`}>{stage.label}</span>
        <button type="button" onClick={onClose} aria-label="Close relationship record"><X aria-hidden="true" /></button>
      </header>
      <div className="community-detail__body">
        <div className="community-detail__photo">
          {imageLoading ? <span><RefreshCw className="animate-spin" aria-hidden="true" /> Loading card photo…</span> : image ? <img src={image} alt={`Business card for ${partner.business_name}`} /> : <span><ImageIcon aria-hidden="true" /> {imageError || 'No business-card photo captured yet.'}</span>}
        </div>
        {imageCount > 1 && <nav className="community-detail__gallery" aria-label="Business card photos">
          <button type="button" onClick={onPrevious} disabled={imageIndex === 0}><ChevronLeft aria-hidden="true" /></button>
          <span>{imageIndex + 1} / {imageCount}</span>
          <button type="button" onClick={onNext} disabled={imageIndex === imageCount - 1}><ChevronRight aria-hidden="true" /></button>
        </nav>}
        <div className="community-detail__copy">
          <p>Relationship record</p>
          <h2>{partner.business_name}</h2>
          {partner.location && <span className="community-detail__location"><MapPin aria-hidden="true" /> {partner.location}</span>}
          {partner.latest_note && <p className="community-detail__note">{partner.latest_note}</p>}
          <span className={partner.next_visit_on && partner.next_visit_on <= localDate() ? 'community-detail__due community-detail__due--now' : 'community-detail__due'}><CalendarClock aria-hidden="true" /> {relativeDate(partner.next_visit_on)}</span>
        </div>
        {partner.contact && (partner.contact.name || partner.contact.email || partner.contact.phone) && <section className="community-detail__contact">
          <p>Person at the business</p>
          {partner.contact.name && <strong>{partner.contact.name}</strong>}
          {partner.contact.role && <span>{partner.contact.role}</span>}
          <div>
            {partner.contact.email && <a href={`mailto:${partner.contact.email}`}><Mail aria-hidden="true" /> Email</a>}
            {partner.contact.phone && <a href={`tel:${partner.contact.phone.replace(/[^+\d]/g, '')}`}><Phone aria-hidden="true" /> Call</a>}
          </div>
        </section>}
      </div>
    </section>
  </div>;
}

export default function CommunityPage() {
  const [partners, setPartners] = useState<CommunityRelationship[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [selectedPartner, setSelectedPartner] = useState<CommunityRelationship | null>(null);
  const [image, setImage] = useState<string | null>(null);
  const [imageCount, setImageCount] = useState(0);
  const [imageIndex, setImageIndex] = useState(0);
  const [imageLoading, setImageLoading] = useState(false);
  const [imageError, setImageError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try { setPartners(await getCommunityRelationships()); }
    catch (err) { setError(err instanceof Error ? err.message : 'Could not load field relationships.'); }
    finally { setLoading(false); }
  }, []);

  const loadImage = useCallback(async (partner: CommunityRelationship, index = 0) => {
    setImageLoading(true);
    setImageError('');
    setImage(null);
    try {
      const result = await getCommunityRelationshipImage(partner.id, index);
      setImage(result.image_data_url);
      setImageCount(result.image_count);
      setImageIndex(index);
    } catch (err) {
      setImageError(err instanceof Error ? err.message : 'Could not load the card photo.');
    } finally { setImageLoading(false); }
  }, []);

  const openPartner = useCallback((partner: CommunityRelationship) => {
    setSelectedPartner(partner);
    setImageCount(partner.image_count || 0);
    setImageIndex(0);
    setImageError('');
    setImage(null);
    if (partner.image_count) void loadImage(partner);
  }, [loadImage]);

  const closePartner = useCallback(() => setSelectedPartner(null), []);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    if (!selectedPartner) return;
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === 'Escape') closePartner(); };
    window.addEventListener('keydown', closeOnEscape);
    return () => window.removeEventListener('keydown', closeOnEscape);
  }, [selectedPartner, closePartner]);

  const due = useMemo(() => partners.filter((partner) => partner.next_visit_on && partner.next_visit_on <= localDate()), [partners]);
  const workshop = useMemo(() => partners.filter((partner) => !due.includes(partner) && (partner.workshop_signal || partner.relationship_stage === 'workshop_opportunity')), [partners, due]);
  const building = useMemo(() => partners.filter((partner) => !due.includes(partner) && !workshop.includes(partner)), [partners, due, workshop]);

  return <main className="community-page">
    <header className="community-page__head">
      <div>
        <p>Field relationships</p>
        <h1>Around town</h1>
        <span>Places where a real conversation has started.</span>
      </div>
      <div className="community-page__actions">
        <a href="https://www.google.com/maps/d/u/0/edit?mid=1SGDCg2GLSCvsK9sjFBZSTQtYJv3iYKg&ll=37.75680594284302%2C-122.44620750000001&z=13" target="_blank" rel="noreferrer"><MapPinned aria-hidden="true" /> Potential partner map</a>
        <a href="https://www.amarimethod.com/field-signup" target="_blank" rel="noreferrer"><ArrowUpRight aria-hidden="true" /> Field signup</a>
        <a href="/staff/resources/garrett-amari-practice-sales-worksheet.pdf" target="_blank" rel="noreferrer"><FileText aria-hidden="true" /> Garrett’s sales worksheet</a>
        <button type="button" onClick={() => void load()} disabled={loading}><RefreshCw aria-hidden="true" className={loading ? 'animate-spin' : ''} /> Refresh</button>
      </div>
    </header>

    <section className="community-page__thesis">
      <Building2 aria-hidden="true" />
      <p>Google Maps is the prospect list. This board starts after a flyer visit, a real conversation, or a relationship signal.</p>
    </section>

    {error ? <section className="community-empty community-empty--error"><p>{error}</p><button type="button" onClick={() => void load()}>Try again</button></section> : loading ? <section className="community-empty"><RefreshCw className="animate-spin" aria-hidden="true" /><p>Loading field relationships…</p></section> : partners.length === 0 ? <section className="community-empty"><Building2 aria-hidden="true" /><h2>No field relationships yet</h2><p>After the first visit, log the business through Chief of Staff and it will appear here.</p></section> : <div className="community-lanes">
      <section className="community-lane community-lane--due"><header><p>Revisit</p><span>{due.length} due</span></header>{due.length ? due.map((partner) => <RelationshipCard key={partner.id} partner={partner} onOpen={openPartner} />) : <p className="community-lane__empty">Nothing needs a return visit today.</p>}</section>
      <section className="community-lane"><header><p>Building</p><span>{building.length} relationships</span></header>{building.length ? building.map((partner) => <RelationshipCard key={partner.id} partner={partner} onOpen={openPartner} />) : <p className="community-lane__empty">No active relationship notes yet.</p>}</section>
      <section className="community-lane community-lane--workshop"><header><p>Deeper partnership</p><span>{workshop.length} signals</span></header>{workshop.length ? workshop.map((partner) => <RelationshipCard key={partner.id} partner={partner} onOpen={openPartner} />) : <p className="community-lane__empty">Workshop conversations will collect here.</p>}</section>
    </div>}
    {selectedPartner && <RelationshipDetail partner={selectedPartner} image={image} imageCount={imageCount} imageIndex={imageIndex} imageLoading={imageLoading} imageError={imageError} onClose={closePartner} onPrevious={() => void loadImage(selectedPartner, imageIndex - 1)} onNext={() => void loadImage(selectedPartner, imageIndex + 1)} />}
  </main>;
}
