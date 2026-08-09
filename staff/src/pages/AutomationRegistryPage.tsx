import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
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
  providerContactId: string | null;
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
  const { familyKey: routeFamilyKey = '' } = useParams();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const [registry, setRegistry] = useState<AutomationFamiliesResponse | null>(null);
  const [registryError, setRegistryError] = useState('');
  const [familyDetail, setFamilyDetail] = useState<AutomationFamilyResponse | null>(null);
  const [familyLoading, setFamilyLoading] = useState(false);
  const [lifecycle, setLifecycle] = useState<AutomationFamily['lifecycle'] | 'all'>('all');
  const [query, setQuery] = useState('');
  const [selectedPerson, setSelectedPerson] = useState<AutomationPerson | null>(null);
  const [personEvidence, setPersonEvidence] = useState<ContactAutomationEvidence | null>(null);
  const [personError, setPersonError] = useState('');
  const [personLoading, setPersonLoading] = useState(false);

  const selectedFamilyKey = routeFamilyKey || params.get('family') || '';
  const selectedContactId = params.get('contact') || '';
  const isFocusedInspector = Boolean(routeFamilyKey);

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
        const person = people.find((candidate) => candidate.id === selectedContactId);
        if (!person) throw new Error('That automation contact is not in the owned CRM mirror.');
        setSelectedPerson({
          id: person.id,
          providerContactId: person.providerContactId,
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
    const next = new URLSearchParams();
    if (selectedContactId) next.set('contact', selectedContactId);
    const queryString = next.toString();
    navigate(`/automations/${encodeURIComponent(key)}${queryString ? `?${queryString}` : ''}`);
  }

  return (
    <main className={`automation-registry-page${isFocusedInspector ? ' is-focused' : ''}`}>
      <header className={`automation-registry-hero${isFocusedInspector ? ' is-focused' : ''}`}>
        <div>
          <span className="automation-registry-kicker"><Workflow size={14} /> Internal automation registry</span>
          {isFocusedInspector ? (
            <>
              <Link className="automation-back-link" to="/automations">← All workflows</Link>
              <h1>Inspect this workflow.</h1>
              <p>Everything Amari can verify about the trigger, waits, steps, exits, source records, and this person’s run evidence is together on one internal page.</p>
            </>
          ) : (
            <>
              <h1>One operational map, not 82 canvases.</h1>
              <p>Browse lifecycle families, inspect the definitions Amari actually owns, and keep the complete former-CRM record inventory visible as evidence—not as imported history.</p>
            </>
          )}
        </div>
        {registry?.summary && !isFocusedInspector && (
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
        <div className={`automation-registry-workspace${isFocusedInspector ? ' is-focused' : ''}`}>
          {!isFocusedInspector && <aside className="automation-family-browser" aria-label="Automation families">
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
          </aside>}

          <section className="automation-family-detail" aria-live="polite">
            {familyLoading && <div className="automation-registry-loading"><Loader2 className="spin" /> Opening family…</div>}
            {!familyLoading && familyDetail && (
              <FamilyDetail
                detail={familyDetail}
                person={selectedPerson}
                personEvidence={personEvidence}
                personLoading={personLoading}
                personError={personError}
                focused={isFocusedInspector}
              />
            )}
          </section>
        </div>
      )}
    </main>
  );
}

function FamilyDetail({
  detail,
  person,
  personEvidence,
  personLoading,
  personError,
  focused,
}: {
  detail: AutomationFamilyResponse;
  person: AutomationPerson | null;
  personEvidence: ContactAutomationEvidence | null;
  personLoading: boolean;
  personError: string;
  focused: boolean;
}) {
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

      {focused && (
        <nav className="automation-inspector-nav" aria-label="Workflow inspector sections">
          <a href="#workflow-definition">How it works</a>
          {person && <a href="#person-run-evidence">This person’s evidence</a>}
          <a href="#source-record-evidence">Source records</a>
          <a href="#workflow-evidence-limits">Evidence limits</a>
        </nav>
      )}

      {(detail.coverage?.enrollmentsTruncated || detail.coverage?.eventsTruncated) && (
        <div className="automation-evidence-banner"><AlertTriangle size={17} /><span><strong>Bounded evidence view.</strong> Older {detail.coverage.enrollmentsTruncated ? 'enrollments' : ''}{detail.coverage.enrollmentsTruncated && detail.coverage.eventsTruncated ? ' and ' : ''}{detail.coverage.eventsTruncated ? 'run events' : ''} exist beyond this page and are not included in the counts below.</span></div>
      )}

      {family.kind === 'evidence_only' && <div className="automation-evidence-banner"><Archive size={17} /><span><strong>Not an operating family.</strong> These test records are retained only so the 82-record inventory remains exact.</span></div>}

      <div className="automation-implementation-strip">
        {family.implementationUnits.map((unit) => <span key={unit}>{IMPLEMENTATION_LABELS[unit] || humanize(unit)}</span>)}
      </div>

      <section className="automation-detail-section" id="workflow-definition">
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
            {definition.cutoverReadiness && (
              <section className="automation-cutover-readiness">
                <header>
                  <div>
                    <h4>Cutover readiness</h4>
                    <p>{definition.cutoverReadiness.summary}</p>
                  </div>
                  <span className={`is-${definition.cutoverReadiness.status}`}>{definition.cutoverReadiness.label}</span>
                </header>
                <ol>
                  {definition.cutoverReadiness.requirements.map((requirement) => (
                    <li className={`is-${requirement.status}`} key={requirement.code}>
                      {requirement.status === 'proven' ? <CheckCircle2 size={16} /> : <AlertTriangle size={16} />}
                      <div><strong>{requirement.label}</strong><p>{requirement.detail}</p></div>
                      <em>{requirement.status === 'review' ? 'Needs review' : requirement.status}</em>
                    </li>
                  ))}
                </ol>
              </section>
            )}
            {definition.messagePreview && (
              <section className="automation-message-preview">
                <header>
                  <div><h4>Read-only message copy</h4><p>{definition.messagePreview.label}</p></div>
                  <span>{definition.messagePreview.notices.length}</span>
                </header>
                {definition.messagePreview.notices.map((notice) => (
                  <article key={`${notice.stepIndex}-${notice.channel}-${notice.audience}`}>
                    <h5>Step {notice.stepIndex + 1} · {humanize(notice.audience)} {notice.channel}</h5>
                    {notice.from && <p><b>From</b>{notice.from}</p>}
                    {notice.subject && <p><b>Subject</b>{notice.subject}</p>}
                    {notice.preheader && <p><b>Preheader</b>{notice.preheader}</p>}
                    <pre>{notice.body}</pre>
                  </article>
                ))}
              </section>
            )}
          </article>
        )) : <p className="automation-registry-empty">No owned definition exists for this family yet. The source inventory below is evidence, not runnable code.</p>}
      </section>

      <div id="person-run-evidence">
        {personLoading && <div className="automation-registry-loading"><Loader2 className="spin" /> Loading this person’s workflow evidence…</div>}
        {personError && <p className="automation-registry-error"><AlertTriangle size={16} />{personError}</p>}
        {!personLoading && person && personEvidence && <PersonEvidence person={person} evidence={personEvidence} family={family} />}
      </div>

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

      <section className="automation-detail-section" id="source-record-evidence">
        <div className="automation-section-heading"><Workflow size={17} /><div><h3>Source record evidence</h3><p>Exact names and dated publication status; canvas history is not imported.</p></div><b>{family.sourceRecords.length}</b></div>
        <div className="automation-source-list">
          {family.sourceRecords.map((record) => <div key={record.name}><span className={record.status}>{record.status}</span><strong>{record.name}</strong></div>)}
        </div>
      </section>

      <section className="automation-detail-section" id="workflow-evidence-limits">
        <div className="automation-section-heading"><AlertTriangle size={17} /><div><h3>Evidence limits</h3><p>These labels prevent false certainty during cutover.</p></div></div>
        <ul className="automation-gap-list">{detail.evidence.gaps.map((gap) => <li key={gap.code}><strong>{humanize(gap.code)}</strong><span>{gap.label}</span></li>)}</ul>
      </section>
    </>
  );
}

function PersonEvidence({ person, evidence, family }: { person: AutomationPerson; evidence: ContactAutomationEvidence; family: AutomationFamily }) {
  const ownedKeys = new Set(family.ownedDefinitions.map((definition) => `${definition.engine}:${definition.key}`));
  const enrollments = (evidence.enrollments || []).filter((enrollment) => (
    enrollment.family?.key === family.key || ownedKeys.has(`${enrollment.engine}:${enrollment.key}`)
  ));
  const events = (evidence.events || []).filter((event) => (
    event.family?.key === family.key || ownedKeys.has(`${event.engine}:${event.flowKey}`)
  ));
  return (
    <div className="automation-person-evidence">
      <header>
        <div><strong>{person.name || 'Unnamed person'} · {family.name}</strong><span>This person’s enrollment and run evidence for the workflow you opened</span></div>
        <a href={`/staff/client/${encodeURIComponent(person.providerContactId || person.id)}#workflows`}><ArrowUpRight size={14} /> Back to person record</a>
      </header>
      {evidence.configured === false && <div className="automation-evidence-banner"><AlertTriangle size={17} /><span>The owned execution store is not connected. Absence here is not proof that no automation ran.</span></div>}
      {evidence.coverage?.eventsTruncated && <div className="automation-evidence-banner"><AlertTriangle size={17} /><span><strong>Bounded evidence view.</strong> This shows the newest {evidence.coverage.eventLimit} run events; older events are not included below.</span></div>}
      <EvidenceGaps gaps={evidence.evidence?.gaps} />
      <div className="automation-person-columns">
        <section>
          <h3><Workflow size={16} /> Enrollments <b>{enrollments.length}</b></h3>
          {enrollments.length ? enrollments.map((enrollment) => (
            <article key={enrollment.enrollmentId}>
              <div><a className="automation-enrollment-definition-link" href="#workflow-definition">{enrollment.family?.name || enrollment.key || humanize(enrollment.engine)}<small>Inspect definition</small><ChevronRight size={14} /></a><span className={enrollment.status === 'active' ? 'active' : ''}>{enrollment.status}</span></div>
              <dl>
                <div><dt>Entered</dt><dd>{exactTime(enrollment.enteredAt)}</dd></div>
                <div><dt>Enrollment</dt><dd><code>{enrollment.enrollmentId}</code></dd></div>
                <div><dt>Appointment</dt><dd>{enrollment.appointmentId || 'Not attached'}</dd></div>
                <div><dt>Next</dt><dd>{enrollment.nextStep ? `${humanize(enrollment.nextStep.type)} · ${enrollment.nextStep.template || 'template not recorded'}` : 'No pending step recorded'}</dd></div>
                <div><dt>Due</dt><dd>{enrollment.nextStep ? exactTime(enrollment.nextStep.dueAt) : 'Not scheduled'}</dd></div>
              </dl>
              <EvidenceGaps gaps={enrollment.evidence?.gaps} compact />
            </article>
          )) : <p className="automation-registry-empty">No owned enrollment is recorded. Treat this as a mirror gap unless other evidence confirms none exists.</p>}
        </section>
        <section>
          <h3><Clock3 size={16} /> Run events <b>{events.length}</b></h3>
          {events.length ? events.map((event, index) => {
            const failed = ['failed', 'bounced', 'error'].includes((event.outcome || '').toLowerCase());
            const eventGaps = event.evidence?.gaps || [];
            const unverified = eventGaps.length > 0 || (event.outcome || '').toLowerCase() === 'would_send';
            return (
              <article className={failed ? 'is-failure' : unverified ? 'is-unverified' : ''} key={`${event.ts}-${event.messageRef || index}`}>
                <div><strong>{event.family?.name || event.flowKey || humanize(event.engine)}</strong>{failed ? <AlertTriangle size={14} /> : unverified ? <CircleDot size={14} /> : <CheckCircle2 size={14} />}</div>
                <time>{exactTime(event.ts)}</time>
                <p>{humanize(event.action)} · {humanize(event.channel)} · <b>{humanize(event.outcome)}</b></p>
                <small>{event.stepIndex != null ? `Step ${event.stepIndex + 1}` : 'Step not recorded'}{event.appointmentId ? ` · appointment ${event.appointmentId}` : ''}</small>
                {event.messageRef ? <a href={`/staff/client-desk?contact=${encodeURIComponent(person.id)}`}><MessageSquareText size={13} /> Message reference <code>{event.messageRef}</code> <ArrowUpRight size={12} /></a> : <span className="automation-message-gap">No message reference recorded</span>}
                <EvidenceGaps gaps={eventGaps} compact />
              </article>
            );
          }) : <p className="automation-registry-empty">No owned run event is recorded. This does not import former CRM execution history.</p>}
        </section>
      </div>
    </div>
  );
}

function EvidenceGaps({ gaps, compact = false }: { gaps?: Array<{ code: string; label: string }>; compact?: boolean }) {
  if (!gaps?.length) return null;
  return (
    <ul className={`automation-person-gaps${compact ? ' is-compact' : ''}`}>
      {gaps.map((gap) => <li key={gap.code}><AlertTriangle size={compact ? 11 : 13} /><span><strong>{humanize(gap.code)}</strong>{gap.label}</span></li>)}
    </ul>
  );
}
