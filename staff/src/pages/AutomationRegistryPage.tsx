import { FormEvent, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  AlertTriangle,
  Archive,
  ArrowUpRight,
  BookOpenCheck,
  CheckCircle2,
  ChevronRight,
  CircleDot,
  Clock3,
  Database,
  Loader2,
  MessageSquareText,
  Search,
  Workflow,
} from 'lucide-react';
import {
  getAutomationFamilies,
  getAutomationFamily,
  getContactAutomationEvidence,
  searchOwnedContacts,
  type OwnedContactSearchItem,
} from '../lib/api';
import type {
  AutomationFamiliesResponse,
  AutomationFamily,
  AutomationFamilyResponse,
  ContactAutomationEvidence,
} from '../types/staff';
import './AutomationRegistryPage.css';

const LIFECYCLES: Array<{ key: AutomationFamily['lifecycle'] | 'all'; label: string }> = [
  { key: 'all', label: 'All' },
  { key: 'platform', label: 'Platform' },
  { key: 'acquisition', label: 'Acquisition' },
  { key: 'sessions', label: 'Sessions' },
  { key: 'commerce', label: 'Commerce' },
  { key: 'partners', label: 'Partners' },
  { key: 'studies', label: 'Studies' },
];

const IMPLEMENTATION_LABELS: Record<string, string> = {
  'shared-substrate': 'Shared event substrate',
  'reminder-confirmation': 'Reminder / confirmation engine',
  'nurture-sequence': 'Nurture sequence engine',
  'purchase-cluster': 'Purchase cluster',
  'pipeline-helper': 'Pipeline helper',
  'standalone-owned-port': 'Small owned port',
  'study-resident': 'Study-resident path',
  'evidence-only': 'Evidence only',
};

type AutomationPerson = {
  id: string;
  ownedId: string;
  name: string;
  email: string;
  phone: string;
};

function exactTime(value: unknown) {
  if (value == null || value === '') return 'Not recorded';
  const parsed = typeof value === 'number' ? value : Date.parse(String(value));
  if (!Number.isFinite(parsed)) return String(value);
  return new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Los_Angeles',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    second: '2-digit',
    timeZoneName: 'short',
  }).format(new Date(parsed));
}

function humanize(value: string | null | undefined) {
  return value ? value.replace(/[-_]/g, ' ').replace(/\b\w/g, (letter) => letter.toUpperCase()) : 'Not recorded';
}

function structured(value: unknown) {
  return JSON.stringify(value, null, 2);
}

export default function AutomationRegistryPage() {
  const [params, setParams] = useSearchParams();
  const [registry, setRegistry] = useState<AutomationFamiliesResponse | null>(null);
  const [registryError, setRegistryError] = useState('');
  const [familyDetail, setFamilyDetail] = useState<AutomationFamilyResponse | null>(null);
  const [familyLoading, setFamilyLoading] = useState(false);
  const [lifecycle, setLifecycle] = useState<AutomationFamily['lifecycle'] | 'all'>('all');
  const [query, setQuery] = useState('');
  const [personQuery, setPersonQuery] = useState('');
  const [personResults, setPersonResults] = useState<OwnedContactSearchItem[]>([]);
  const [personSearching, setPersonSearching] = useState(false);
  const [selectedPerson, setSelectedPerson] = useState<AutomationPerson | null>(null);
  const [personEvidence, setPersonEvidence] = useState<ContactAutomationEvidence | null>(null);
  const [personError, setPersonError] = useState('');
  const [personLoading, setPersonLoading] = useState(false);

  const selectedFamilyKey = params.get('family') || '';
  const selectedContactId = params.get('contact') || '';

  useEffect(() => {
    let cancelled = false;
    getAutomationFamilies()
      .then((response) => {
        if (cancelled) return;
        setRegistry(response);
        if (!selectedFamilyKey) {
          const first = response.families.find((family) => family.kind === 'operational');
          if (first) {
            const next = new URLSearchParams(params);
            next.set('family', first.key);
            setParams(next, { replace: true });
          }
        }
      })
      .catch((error) => { if (!cancelled) setRegistryError(error instanceof Error ? error.message : 'Could not load the automation registry.'); });
    return () => { cancelled = true; };
    // Initial registry load only; URL selection is handled separately.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!selectedFamilyKey) return;
    let cancelled = false;
    setFamilyLoading(true);
    getAutomationFamily(selectedFamilyKey)
      .then((response) => { if (!cancelled) setFamilyDetail(response); })
      .catch((error) => { if (!cancelled) setRegistryError(error instanceof Error ? error.message : 'Could not open that automation family.'); })
      .finally(() => { if (!cancelled) setFamilyLoading(false); });
    return () => { cancelled = true; };
  }, [selectedFamilyKey]);

  useEffect(() => {
    if (!selectedContactId || selectedPerson?.id === selectedContactId) return;
    let cancelled = false;
    setPersonLoading(true);
    setPersonError('');
    Promise.all([searchOwnedContacts(selectedContactId), getContactAutomationEvidence(selectedContactId)])
      .then(([people, evidence]) => {
        if (cancelled) return;
        const person = people.find((candidate) => candidate.providerContactId === selectedContactId);
        if (!person) throw new Error('That automation contact is not in the owned CRM mirror.');
        setSelectedPerson({
          id: selectedContactId,
          ownedId: person.id,
          name: person.name || person.email || person.phone || 'Unnamed person',
          email: person.email,
          phone: person.phone,
        });
        setPersonEvidence(evidence);
      })
      .catch((error) => { if (!cancelled) setPersonError(error instanceof Error ? error.message : 'Could not load that person.'); })
      .finally(() => { if (!cancelled) setPersonLoading(false); });
    return () => { cancelled = true; };
  }, [selectedContactId, selectedPerson?.id]);

  const operationalFamilies = useMemo(() => (registry?.families || []).filter((family) => {
    if (family.kind !== 'operational') return false;
    if (lifecycle !== 'all' && family.lifecycle !== lifecycle) return false;
    const needle = query.trim().toLowerCase();
    return !needle || `${family.name} ${family.purpose} ${family.lifecycle}`.toLowerCase().includes(needle);
  }), [registry, lifecycle, query]);
  const archiveGroup = registry?.families.find((family) => family.kind === 'evidence_only') || null;

  function selectFamily(key: string) {
    const next = new URLSearchParams(params);
    next.set('family', key);
    setParams(next);
  }

  async function submitPersonSearch(event: FormEvent) {
    event.preventDefault();
    if (personQuery.trim().length < 2) return;
    setPersonSearching(true);
    setPersonError('');
    try {
      setPersonResults(await searchOwnedContacts(personQuery.trim()));
    } catch (error) {
      setPersonError(error instanceof Error ? error.message : 'Could not search people.');
    } finally {
      setPersonSearching(false);
    }
  }

  async function selectPerson(person: OwnedContactSearchItem) {
    if (!person.providerContactId) {
      setPersonError('That owned person has no automation execution crosswalk yet.');
      return;
    }
    setSelectedPerson({ ...person, id: person.providerContactId, ownedId: person.id });
    setPersonResults([]);
    setPersonLoading(true);
    setPersonError('');
    const next = new URLSearchParams(params);
    next.set('contact', person.providerContactId);
    setParams(next);
    try {
      setPersonEvidence(await getContactAutomationEvidence(person.providerContactId));
    } catch (error) {
      setPersonError(error instanceof Error ? error.message : 'Could not load automation evidence.');
    } finally {
      setPersonLoading(false);
    }
  }

  return (
    <main className="automation-registry-page">
      <header className="automation-registry-hero">
        <div>
          <span className="automation-registry-kicker"><Workflow size={14} /> Internal automation registry</span>
          <h1>One operational map, not 82 canvases.</h1>
          <p>Browse lifecycle families, inspect the definitions Amari actually owns, and keep the complete former-CRM record inventory visible as evidence—not as imported history.</p>
        </div>
        {registry?.summary && (
          <div className="automation-registry-stats" aria-label="Automation inventory summary">
            <span><strong>{registry.summary.operationalFamilies}</strong><small>operating families</small></span>
            <span><strong>{registry.summary.ownedDefinitions}</strong><small>owned definitions</small></span>
            <span><strong>{registry.summary.sourceRecords}</strong><small>source records preserved</small></span>
            <span><strong>{registry.summary.publishedSourceRecords} / {registry.summary.draftSourceRecords}</strong><small>published / draft evidence</small></span>
          </div>
        )}
      </header>

      {registryError && <p className="automation-registry-error"><AlertTriangle size={16} />{registryError}</p>}
      {!registry && !registryError && <div className="automation-registry-loading"><Loader2 className="spin" /> Loading the registry…</div>}

      {registry && (
        <div className="automation-registry-workspace">
          <aside className="automation-family-browser" aria-label="Automation families">
            <div className="automation-family-tools">
              <label><Search size={15} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Find a family" /></label>
              <div className="automation-lifecycle-filters">
                {LIFECYCLES.map((item) => <button type="button" key={item.key} className={lifecycle === item.key ? 'is-active' : ''} onClick={() => setLifecycle(item.key)}>{item.label}</button>)}
              </div>
            </div>
            <div className="automation-family-list">
              {operationalFamilies.map((family) => (
                <button type="button" key={family.key} className={`automation-family-card${selectedFamilyKey === family.key ? ' is-selected' : ''}`} onClick={() => selectFamily(family.key)}>
                  <span className="automation-family-card-top"><em>{family.lifecycle}</em><i>{family.counts.ownedDefinitions ? `${family.counts.ownedDefinitions} owned` : 'source only'}</i></span>
                  <strong>{family.name}</strong>
                  <small>{family.counts.sourceRecords} source record{family.counts.sourceRecords === 1 ? '' : 's'} · {family.implementationUnits.map((unit) => IMPLEMENTATION_LABELS[unit] || unit).join(' + ')}</small>
                  <ChevronRight size={16} aria-hidden="true" />
                </button>
              ))}
              {!operationalFamilies.length && <p className="automation-registry-empty">No operating family matches this view.</p>}
            </div>
            {archiveGroup && (
              <button type="button" className={`automation-archive-card${selectedFamilyKey === archiveGroup.key ? ' is-selected' : ''}`} onClick={() => selectFamily(archiveGroup.key)}>
                <Archive size={18} />
                <span><strong>Archive / test evidence</strong><small>{archiveGroup.counts.sourceRecords} preserved records · not an operating family</small></span>
                <ChevronRight size={16} />
              </button>
            )}
          </aside>

          <section className="automation-family-detail" aria-live="polite">
            {familyLoading && <div className="automation-registry-loading"><Loader2 className="spin" /> Opening family…</div>}
            {!familyLoading && familyDetail && <FamilyDetail detail={familyDetail} />}
          </section>
        </div>
      )}

      {registry && (
        <section className="automation-person-inspector" aria-labelledby="person-automation-title">
          <div className="automation-person-head">
            <div>
              <span className="automation-registry-kicker"><Database size={14} /> Person evidence</span>
              <h2 id="person-automation-title">What is this person enrolled in—and what actually ran?</h2>
              <p>This joins only owned D1 enrollments and append-only run events. Message content stays in Communication; this view carries the exact message reference and timestamp needed to investigate it.</p>
            </div>
            <form onSubmit={submitPersonSearch}>
              <Search size={16} />
              <input value={personQuery} onChange={(event) => setPersonQuery(event.target.value)} placeholder="Name, email, or phone" />
              <button disabled={personSearching || personQuery.trim().length < 2}>{personSearching ? 'Searching…' : 'Find person'}</button>
              {!!personResults.length && (
                <div className="automation-person-results">
                  {personResults.slice(0, 8).map((person) => (
                    <button type="button" key={person.id} onClick={() => void selectPerson(person)}><strong>{person.name || 'Unnamed person'}</strong><small>{person.email || person.phone || person.id}</small></button>
                  ))}
                </div>
              )}
            </form>
          </div>
          {personError && <p className="automation-registry-error"><AlertTriangle size={16} />{personError}</p>}
          {personLoading && <div className="automation-registry-loading"><Loader2 className="spin" /> Loading person evidence…</div>}
          {!personLoading && selectedPerson && personEvidence && <PersonEvidence person={selectedPerson} evidence={personEvidence} />}
          {!personLoading && !selectedPerson && <p className="automation-registry-empty">Search for a person to inspect their owned enrollment and run evidence.</p>}
        </section>
      )}
    </main>
  );
}

function FamilyDetail({ detail }: { detail: AutomationFamilyResponse }) {
  const family = detail.family;
  return (
    <>
      <div className="automation-family-title">
        <div>
          <span className={`automation-family-kind ${family.kind}`}>{family.kind === 'operational' ? family.lifecycle : 'archive / test evidence'}</span>
          <h2>{family.name}</h2>
          <p>{family.purpose}</p>
        </div>
        <span className={`automation-store-state ${detail.configured ? 'is-connected' : ''}`}><CircleDot size={13} />{detail.configured ? 'Execution store connected' : 'Execution store not connected'}</span>
      </div>

      {(detail.coverage?.enrollmentsTruncated || detail.coverage?.eventsTruncated) && (
        <div className="automation-evidence-banner"><AlertTriangle size={17} /><span><strong>Bounded evidence view.</strong> Older {detail.coverage.enrollmentsTruncated ? 'enrollments' : ''}{detail.coverage.enrollmentsTruncated && detail.coverage.eventsTruncated ? ' and ' : ''}{detail.coverage.eventsTruncated ? 'run events' : ''} exist beyond this page and are not included in the counts below.</span></div>
      )}

      {family.kind === 'evidence_only' && <div className="automation-evidence-banner"><Archive size={17} /><span><strong>Not an operating family.</strong> These test records are retained only so the 82-record inventory remains exact.</span></div>}

      <div className="automation-implementation-strip">
        {family.implementationUnits.map((unit) => <span key={unit}>{IMPLEMENTATION_LABELS[unit] || humanize(unit)}</span>)}
      </div>

      <section className="automation-detail-section">
        <div className="automation-section-heading"><BookOpenCheck size={17} /><div><h3>Owned definitions</h3><p>Exact trigger, step timing, type, branch structure, and template key from code.</p></div><b>{family.ownedDefinitions.length}</b></div>
        {family.ownedDefinitions.length ? family.ownedDefinitions.map((definition) => (
          <article className="automation-definition-card" key={definition.id}>
            <header><span>{humanize(definition.engine)}</span><strong>{definition.name}</strong><em>v{definition.definitionVersion} · {definition.mode}</em></header>
            <div className="automation-definition-grid">
              <div><h4>Trigger</h4><pre>{structured(definition.trigger)}</pre></div>
              <div><h4>Exits / cancellation</h4><pre>{structured(definition.exits)}</pre></div>
            </div>
            <div className="automation-step-list">
              {definition.steps.map((step) => (
                <div key={step.stepIndex}>
                  <span>{step.stepIndex + 1}</span>
                  <p><strong>{humanize(String(step.type || step.kind || 'step'))}</strong><small>{step.at || step.after || 'Timing not recorded'} · template <code>{step.template || 'none'}</code></small></p>
                </div>
              ))}
            </div>
          </article>
        )) : <p className="automation-registry-empty">No owned definition exists for this family yet. The source inventory below is evidence, not runnable code.</p>}
      </section>

      <section className="automation-detail-section">
        <div className="automation-section-heading"><Database size={17} /><div><h3>Owned execution evidence</h3><p>Only enrollments and events recorded by owned engines.</p></div><b>{detail.enrollments.length + detail.events.length}</b></div>
        {!detail.configured ? <p className="automation-registry-empty">The execution store is not connected in this environment. No inference about runs can be made.</p> : (
          <div className="automation-execution-summary">
            <span><strong>{detail.enrollments.length}</strong><small>enrollments</small></span>
            <span><strong>{detail.enrollments.filter((item) => item.status === 'active').length}</strong><small>active</small></span>
            <span><strong>{detail.events.length}</strong><small>run events</small></span>
            <span><strong>{detail.events.filter((item) => ['failed', 'bounced', 'error'].includes((item.outcome || '').toLowerCase())).length}</strong><small>failures</small></span>
          </div>
        )}
      </section>

      <section className="automation-detail-section">
        <div className="automation-section-heading"><Workflow size={17} /><div><h3>Source record evidence</h3><p>Exact names and dated publication status; canvas history is not imported.</p></div><b>{family.sourceRecords.length}</b></div>
        <div className="automation-source-list">
          {family.sourceRecords.map((record) => <div key={record.name}><span className={record.status}>{record.status}</span><strong>{record.name}</strong></div>)}
        </div>
      </section>

      <section className="automation-detail-section">
        <div className="automation-section-heading"><AlertTriangle size={17} /><div><h3>Evidence limits</h3><p>These labels prevent false certainty during cutover.</p></div></div>
        <ul className="automation-gap-list">{detail.evidence.gaps.map((gap) => <li key={gap.code}><strong>{humanize(gap.code)}</strong><span>{gap.label}</span></li>)}</ul>
      </section>
    </>
  );
}

function PersonEvidence({ person, evidence }: { person: AutomationPerson; evidence: ContactAutomationEvidence }) {
  const enrollments = evidence.enrollments || [];
  const events = evidence.events || [];
  return (
    <div className="automation-person-evidence">
      <header>
        <div><strong>{person.name || 'Unnamed person'}</strong><span>{person.email || person.phone || person.id}</span></div>
        <a href={`/staff/client-desk?contact=${encodeURIComponent(person.ownedId)}`}><MessageSquareText size={15} /> Open in Communication <ArrowUpRight size={14} /></a>
      </header>
      {evidence.configured === false && <div className="automation-evidence-banner"><AlertTriangle size={17} /><span>The owned execution store is not connected. Absence here is not proof that no automation ran.</span></div>}
      {evidence.coverage?.eventsTruncated && <div className="automation-evidence-banner"><AlertTriangle size={17} /><span><strong>Bounded evidence view.</strong> This shows the newest {evidence.coverage.eventLimit} run events; older events are not included below.</span></div>}
      <div className="automation-person-columns">
        <section>
          <h3><Workflow size={16} /> Enrollments <b>{enrollments.length}</b></h3>
          {enrollments.length ? enrollments.map((enrollment) => (
            <article key={enrollment.enrollmentId}>
              <div><strong>{enrollment.family?.name || enrollment.key || humanize(enrollment.engine)}</strong><span className={enrollment.status === 'active' ? 'active' : ''}>{enrollment.status}</span></div>
              <dl>
                <div><dt>Entered</dt><dd>{exactTime(enrollment.enteredAt)}</dd></div>
                <div><dt>Enrollment</dt><dd><code>{enrollment.enrollmentId}</code></dd></div>
                <div><dt>Appointment</dt><dd>{enrollment.appointmentId || 'Not attached'}</dd></div>
                <div><dt>Next</dt><dd>{enrollment.nextStep ? `${humanize(enrollment.nextStep.type)} · ${enrollment.nextStep.template || 'template not recorded'}` : 'No pending step recorded'}</dd></div>
                <div><dt>Due</dt><dd>{enrollment.nextStep ? exactTime(enrollment.nextStep.dueAt) : 'Not scheduled'}</dd></div>
              </dl>
            </article>
          )) : <p className="automation-registry-empty">No owned enrollment is recorded. Treat this as a mirror gap unless other evidence confirms none exists.</p>}
        </section>
        <section>
          <h3><Clock3 size={16} /> Run events <b>{events.length}</b></h3>
          {events.length ? events.map((event, index) => {
            const failed = ['failed', 'bounced', 'error'].includes((event.outcome || '').toLowerCase());
            return (
              <article className={failed ? 'is-failure' : ''} key={`${event.ts}-${event.messageRef || index}`}>
                <div><strong>{event.family?.name || event.flowKey || humanize(event.engine)}</strong>{failed ? <AlertTriangle size={14} /> : <CheckCircle2 size={14} />}</div>
                <time>{exactTime(event.ts)}</time>
                <p>{humanize(event.action)} · {humanize(event.channel)} · <b>{humanize(event.outcome)}</b></p>
                <small>{event.stepIndex != null ? `Step ${event.stepIndex + 1}` : 'Step not recorded'}{event.appointmentId ? ` · appointment ${event.appointmentId}` : ''}</small>
                {event.messageRef ? <a href={`/staff/client-desk?contact=${encodeURIComponent(person.id)}`}><MessageSquareText size={13} /> Message reference <code>{event.messageRef}</code> <ArrowUpRight size={12} /></a> : <span className="automation-message-gap">No message reference recorded</span>}
              </article>
            );
          }) : <p className="automation-registry-empty">No owned run event is recorded. This does not import former CRM execution history.</p>}
        </section>
      </div>
    </div>
  );
}
