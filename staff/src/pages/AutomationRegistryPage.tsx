import { useEffect, useMemo, useState } from 'react';
import { describeMorningWorkflowNode } from '../lib/morningWorkflowInspection';
import type { DragEvent } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import {
  AlertTriangle,
  Activity,
  Archive,
  ArrowUpRight,
  BookOpenCheck,
  CheckCircle2,
  ChevronRight,
  CircleDot,
  Clock3,
  Database,
  GitBranch,
  Loader2,
  MessageSquareText,
  Users,
  Workflow,
} from 'lucide-react';
import {
  getAutomationFamilies,
  getAutomationFamily,
  getContactAutomationEvidence,
  publishAutomationWorkflow,
  saveAutomationWorkflowDraft,
  searchOwnedContacts,
} from '../lib/api';
import type {
  AutomationFamiliesResponse,
  AutomationFamily,
  AutomationFamilyResponse,
  AutomationCutoverTree,
  CanonicalWorkflow,
  ContactAutomationEvidence,
  ContactAutomationEnrollment,
} from '../types/staff';
const MASTER_MAP_LANES: Array<{ key: AutomationFamily['lifecycle']; label: string; description: string }> = [
  { key: 'platform', label: 'Shared signals', description: 'Events that feed other automations' },
  { key: 'acquisition', label: 'Find and qualify', description: 'Lead and discovery paths' },
  { key: 'sessions', label: 'Book and deliver', description: 'Appointments, reminders, and attendance' },
  { key: 'commerce', label: 'Pay and access', description: 'Entitlements and access' },
  { key: 'partners', label: 'Partner operations', description: 'Partner sessions and rewards' },
  { key: 'studies', label: 'Studies', description: 'Specialist study operations' },
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

const NODE_MAP_TITLES: Record<string, string> = {
  'initial-session-reminders': 'Initial-session reminders',
  'follow-up-session-reminders': 'Follow-up session reminder',
  'morning-staff-sms': 'Morning SMS to Eben and Garrett',
};

type RuntimeFlow = NonNullable<NonNullable<AutomationFamilyResponse['runtime']>['flows']>[number];

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

function eventOutcome(event: { action?: string | null; outcome?: string | null; channel?: string | null; displayOutcome?: string | null }) {
  if (event.displayOutcome) return event.displayOutcome;
  if (event.action === 'send' && event.outcome === 'sent') {
    return event.channel === 'email' ? 'Accepted by Gmail' : 'Accepted by SMS provider';
  }
  if (event.action === 'delivery_status') {
    if (event.outcome === 'delivered') return 'Delivered';
    if (event.outcome === 'failed') return 'Delivery failed';
    if (event.outcome === 'bounced') return 'Bounced';
  }
  return humanize(event.outcome);
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

  function selectMapFamily(key: string) {
    const next = new URLSearchParams(params);
    next.set('family', key);
    setParams(next, { replace: true });
  }

  function returnToAutomationMap() {
    navigate('/automations', { replace: true });
  }

  function revealAutomationEvidence() {
    document.getElementById('automation-evidence')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  // A family with a Worker definition must render that definition, not fall
  // back to a separate static source map.
  const mapRuntimes = familyDetail?.runtime?.flows || [];
  const mapActiveEnrollments = familyDetail?.enrollments.filter((enrollment) => enrollment.status === 'active') || [];

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
              <h1>Amari automation map.</h1>
              <p>The current named automations are one operating system. Each detailed node shows who operates it now—GHL, Amari, Stripe, Google, or a person—so the remaining cutover work is visible rather than implied.</p>
            </>
          )}
        </div>
      </header>

      {registry && !isFocusedInspector && <AutomationMasterMap
        families={registry.families}
        selectedKey={selectedFamilyKey}
        onSelect={selectMapFamily}
        onBack={returnToAutomationMap}
        onRevealEvidence={revealAutomationEvidence}
        runtimes={mapRuntimes}
        activeEnrollments={mapActiveEnrollments}
        detailReady={familyDetail?.family.key === selectedFamilyKey && !familyLoading}
      />}

      {registryError && <p className="automation-registry-error"><AlertTriangle size={16} />{registryError}</p>}
      {!registry && !registryError && <div className="automation-registry-loading"><Loader2 className="spin" /> Loading the registry…</div>}

      {registry && (
        <div className={`automation-registry-workspace${isFocusedInspector ? ' is-focused' : ''}`}>
          <section className="automation-family-detail" id="automation-evidence" aria-live="polite">
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

function AutomationMasterMap({
  families,
  selectedKey,
  onSelect,
  onBack,
  onRevealEvidence,
  runtimes,
  activeEnrollments,
  detailReady,
}: {
  families: AutomationFamily[];
  selectedKey: string;
  onSelect: (key: string) => void;
  onBack: () => void;
  onRevealEvidence: () => void;
  runtimes: RuntimeFlow[];
  activeEnrollments: ContactAutomationEnrollment[];
  detailReady: boolean;
}) {
  const selectedFamily = families.find((family) => family.key === selectedKey) || null;
  const hasMap = (family: AutomationFamily) => family.mapAuthority !== 'not_mapped';
  if (selectedKey && selectedFamily) {
    return <section className="automation-master-map is-selected-view" aria-label={`${selectedFamily.name} automation map`}>
      <button className="automation-map-back" type="button" onClick={onBack}>← All automations</button>
      {!detailReady
        ? <div className="automation-registry-loading" role="status"><Loader2 className="spin" /> Opening one verified workflow view…</div>
        : hasMap(selectedFamily)
        ? <AutomationHealthPilot family={selectedFamily} onRevealEvidence={onRevealEvidence} runtimes={runtimes} activeEnrollments={activeEnrollments} />
        : <AutomationMapPending family={selectedFamily} />}
    </section>;
  }
  return <section className="automation-master-map" aria-label="Amari master automation map">
    <header>
      <div>
        <span>Master map · {families.filter((family) => family.kind === 'operational').length} automations</span>
        <h2>What exists, before we claim who owns it.</h2>
        <p>Every card below is one named master automation. An executable map is the document the Worker runs. A verified operating diagram records an external path but never claims to execute it.</p>
      </div>
      <div className="automation-master-key" aria-label="Master map status legend"><span className="is-drawn">Executable map</span><span>Verified operating diagram</span><span className="is-pending">Not mapped yet</span></div>
    </header>
    <div className="automation-master-lanes">
      {MASTER_MAP_LANES.map((lane) => {
        const laneFamilies = families.filter((family) => family.kind === 'operational' && family.lifecycle === lane.key);
        return <section key={lane.key} className="automation-master-lane">
          <header><strong>{lane.label}</strong><small>{lane.description}</small></header>
          <div>
            {laneFamilies.map((family) => <button type="button" key={family.key} className={`${hasMap(family) ? 'is-drawn' : 'is-pending'}${selectedFamily?.key === family.key ? ' is-selected' : ''}`} aria-pressed={selectedFamily?.key === family.key} onClick={() => onSelect(family.key)}>
              <strong>{family.name}</strong>
              <small>{family.mapAuthority === 'executable_definition' ? 'Executable map' : family.mapAuthority === 'verified_operating_diagram' ? 'Verified operating diagram' : 'Needs executable map'}</small>
              <ChevronRight size={14} aria-hidden="true" />
            </button>)}
          </div>
        </section>;
      })}
    </div>
  </section>;
}

function AutomationMapPending({ family }: { family: AutomationFamily }) {
  return <section className="automation-map-pending" aria-label={`${family.name} node map status`}>
    <div><span>Selected automation · node map not drawn</span><h3>{family.name}</h3><p>We know this automation exists, but we have not yet verified and drawn its individual actions. It stays neutral until each action can be assigned to its real operator.</p></div>
    <small>{family.counts.sourceRecords} source record{family.counts.sourceRecords === 1 ? '' : 's'} preserved</small>
  </section>;
}

function AutomationHealthPilot({
  family,
  onRevealEvidence,
  runtimes,
  activeEnrollments,
}: {
  family: AutomationFamily;
  onRevealEvidence: () => void;
  runtimes: RuntimeFlow[];
  activeEnrollments: ContactAutomationEnrollment[];
}) {
  const isFollowUp = family.key === 'follow-up-session-reminders';
  const isPaidBooking = family.key === 'commerce-ledger-event-ingest';
  const isMorningSms = family.key === 'morning-staff-sms';
  const matchingRuntimes = runtimes.filter((runtime) => runtime.definition && family.runtimeFlowKeys.includes(runtime.flow?.key || runtime.definition.id));
  const morningDefinition = family.ownedDefinitions.find((definition) => definition.engine === 'morning-sms');
  return (
    <section className="automation-health-pilot" aria-label={`${family.name} ownership map`}>
      <header>
        <div>
          <span><Activity size={14} /> Selected automation · {family.mapAuthority === 'executable_definition' ? 'executable map' : 'verified operating diagram'}</span>
          <h2>{NODE_MAP_TITLES[family.key] || family.name}</h2>
          <p>Read from top to bottom: each color identifies the system that operates that action today.</p>
        </div>
        <button type="button" onClick={onRevealEvidence}>Open live run evidence <ChevronRight size={15} /></button>
      </header>
      <OwnershipLegend />
      {isMorningSms && morningDefinition
        ? <MorningWorkflowCanvas definition={morningDefinition} />
        : isPaidBooking && matchingRuntimes.length
        ? <PaidBookingWorkflowCanvas runtime={matchingRuntimes.find((runtime) => runtime.flow?.key === 'assessment-paid-booking')!} />
        : matchingRuntimes.length
        ? <InitialWorkflowCanvas runtimes={matchingRuntimes} activeEnrollments={activeEnrollments} />
        : family.mapAuthority === 'executable_definition'
          ? <section className="automation-map-pending"><div><span>Executable map unavailable</span><h3>{family.name}</h3><p>The selected family’s published runtime definition could not be read. Staff will not substitute another family’s map or a hand-drawn approximation.</p></div></section>
        : family.cutoverTree ? <CutoverTree tree={family.cutoverTree} compact /> : null}
      <footer><b>Plain answer:</b> {isPaidBooking
        ? 'GHL still takes the $29 payment. The selected slot, booking lease, appointment command, checkpoint, and one-minute recovery guard are Amari-owned and read the same published definition shown above.'
        : isMorningSms
        ? 'This is the live Morning SMS Worker. Amari owns the schedule, agenda, last-package-session decision, duplicate protection, and run evidence; GHL supplies appointment data and carries the two staff SMS messages.'
        : isFollowUp
        ? `Amari executes this Follow-Up definition in ${matchingRuntimes[0]?.flow?.delivery || 'unknown'} mode. Every action, condition, and exit shown comes from that exact selected definition; GHL appears only as the external appointment-event and delivery provider.`
        : `GHL owns the appointment event and delivery adapters. Amari executes the selected ${matchingRuntimes.map((runtime) => runtime.flow?.name).filter(Boolean).join(' and ')} definition${matchingRuntimes.length === 1 ? '' : 's'} exactly as shown.`}</footer>
    </section>
  );
}

function MorningWorkflowCanvas({ definition }: { definition: AutomationFamily['ownedDefinitions'][number] }) {
  const [selectedId, setSelectedId] = useState(definition.steps[0]?.id || '');
  const selected = definition.steps.find((step) => step.id === selectedId) || definition.steps[0];
  const route = definition.steps.filter((step) => step.handler !== 'send_due_sms' && step.handler !== 'record_run_result');
  const sends = definition.steps.filter((step) => step.handler === 'send_due_sms');
  const record = definition.steps.find((step) => step.handler === 'record_run_result');
  const inspection = describeMorningWorkflowNode(definition, selected || {});
  const Node = ({ step }: { step: typeof definition.steps[number] }) => <button type="button" className={`automation-playbook-node ${step.owner === 'cloudflare' ? 'is-ghl' : 'is-amari'}${selected?.id === step.id ? ' is-selected' : ''}`} onClick={() => setSelectedId(step.id || '')}><span>{step.owner === 'cloudflare' ? 'CLOUDFLARE' : 'AMARI'}</span><strong>{step.label}</strong><small>{step.provider === 'ghl' ? 'Uses GHL data or delivery adapter' : humanize(step.type)}</small></button>;
  return <section className="automation-playbook-preview" aria-label="Morning SMS executable map">
    <header><div><span>Canonical executable workflow</span><h3>One document. The exact Worker route.</h3><p>The Worker validates and executes these handler IDs. Staff renders this same definition; there is no separate Morning SMS drawing.</p></div><b className="is-live">Live definition · v{definition.definitionVersion}</b></header>
    <div className="automation-playbook-preview-grid">
      <div className="automation-playbook-flow">{route.map((step, index) => <div className="automation-playbook-step" key={step.id || index}>{index > 0 && <i className="automation-playbook-arrow" aria-hidden="true">↓</i>}<Node step={step} /></div>)}<i className="automation-playbook-arrow" aria-hidden="true">↓</i><p className="automation-workflow-scope-notice"><strong>Due branch only.</strong> A scheduled check runs the agenda branch, the meeting branch, or neither. There is no sleeping 90-minute job.</p><div className={`automation-playbook-parallel is-${sends.length}`}>{sends.map((step) => <Node key={step.id} step={step} />)}</div>{record && <><i className="automation-playbook-arrow" aria-hidden="true">↓</i><div className="automation-playbook-step"><Node step={record} /></div></>}</div>
      <aside className="automation-playbook-inspector" aria-live="polite"><header><span>Executable node</span><h4>{selected?.label}</h4><p><code>{selected?.id}</code> invokes <code>{selected?.handler}</code>. {selected?.provider === 'ghl' ? 'GHL is an external provider for this node; Amari controls the route and decision.' : 'Amari owns this operation.'}</p></header><dl><div><dt>Definition</dt><dd>{definition.id} · v{definition.definitionVersion}</dd></div><div><dt>Runtime handler</dt><dd>{selected?.handler}</dd></div>{selected?.messageKind && <div><dt>Message kind</dt><dd>{selected.messageKind}</dd></div>}</dl>{inspection.logic.length > 0 && <section className="automation-playbook-message"><span>How this node actually works</span><ol>{inspection.logic.map((line) => <li key={line}>{line}</li>)}</ol></section>}{inspection.exactCopy && <section className="automation-playbook-message"><span>{inspection.heading}</span><textarea readOnly rows={5} value={inspection.exactCopy} /></section>}{inspection.variants.map((variant) => <section className="automation-playbook-message" key={variant.label}><span>{variant.label}</span><textarea readOnly rows={3} value={variant.copy} /></section>)}<footer><strong>Execution authority.</strong> Run evidence records this definition version and the node IDs actually visited.</footer></aside>
    </div>
  </section>;
}

function PaidBookingWorkflowCanvas({ runtime }: { runtime: RuntimeFlow }) {
  const workflow = runtime.definition!;
  const [selectedId, setSelectedId] = useState(workflow.nodes[0]?.id || '');
  const [draft, setDraft] = useState<CanonicalWorkflow | null>(null);
  const [status, setStatus] = useState('');
  const [saving, setSaving] = useState(false);
  useEffect(() => { setSelectedId(workflow.nodes[0]?.id || ''); setDraft(null); setStatus(''); }, [workflow.id, workflow.version]);
  const shown = draft || workflow;
  const selected = shown.nodes.find((node) => node.id === selectedId) || shown.nodes[0];
  const beginEdit = () => {
    setDraft({ ...workflow, version: workflow.version + 1, booking: { ...workflow.booking! }, recovery: { ...workflow.recovery! }, nodes: workflow.nodes.map((node) => ({ ...node })) });
    setStatus('Draft changes do not alter a payment or an appointment. Publish is the single atomic switch the Pages handler and minute guard read.');
  };
  const updateBooking = (key: string, value: string | number) => setDraft((current) => current ? { ...current, booking: { ...current.booking!, [key]: value } } : current);
  const updateRecovery = (key: string, value: number) => setDraft((current) => current ? { ...current, recovery: { ...current.recovery!, [key]: value } } : current);
  const save = async (publish = false) => {
    if (!draft) return;
    setSaving(true); setStatus(publish ? 'Validating and publishing the booking map…' : 'Saving the booking-map draft…');
    try {
      await saveAutomationWorkflowDraft(draft);
      if (publish) await publishAutomationWorkflow(draft.id, draft.version, workflow.version);
      setStatus(publish ? `Published v${draft.version}. The booking endpoint and minute guard now read this definition.` : `Draft v${draft.version} saved. The live booking path is unchanged.`);
      if (publish) window.location.reload();
    } catch (error) { setStatus(error instanceof Error ? error.message : 'Booking map could not be saved.'); }
    finally { setSaving(false); }
  };
  return <section className="automation-playbook-preview automation-paid-booking-canvas" aria-label="Assessment paid booking executable map">
    <header><div><span>Canonical executable workflow</span><h3>One canvas. The actual paid-booking path.</h3><p>Each Amari node is the document used by the public checkout, order handler, and one-minute recovery guard. GHL’s payment trigger is shown as an external node because GHL still processes the card.</p></div><b className="is-live">Live definition · v{workflow.version}</b></header>
    <div className="automation-playbook-preview-grid">
      <div className="automation-playbook-flow">{shown.nodes.map((node, index) => <div key={node.id} className="automation-playbook-step">{index > 0 && <i className="automation-playbook-arrow" aria-hidden="true">↓</i>}<button type="button" className={`automation-playbook-node is-${node.operator === 'GHL' ? 'ghl' : node.operator === 'Staff' ? 'rollback' : 'amari'}${selected?.id === node.id ? ' is-selected' : ''}`} onClick={() => setSelectedId(node.id)}><span>{node.operator === 'GHL' ? 'GHL' : node.operator === 'Staff' ? 'STAFF EXIT' : 'AMARI'}</span><strong>{node.label}</strong><small>{node.timing}</small></button></div>)}</div>
      <aside className="automation-playbook-inspector" aria-live="polite"><header><span>{selected?.kind === 'trigger' ? 'External trigger' : selected?.kind === 'recovery' ? 'Recovery guard' : selected?.kind === 'exit' ? 'Exit' : 'Action'}</span><h4>{selected?.label}</h4><p>{selected?.operator === 'GHL' ? 'GHL is the external payment authority. The owned endpoint verifies the order after this trigger.' : 'This is an Amari-owned executable part of the paid-booking definition.'}</p></header><dl><div><dt>Operated by</dt><dd>{selected?.operator}</dd></div><div><dt>When</dt><dd>{selected?.timing}</dd></div></dl>{!draft ? <footer><strong>This is live wiring.</strong> Edit creates a draft; publish changes the document read by the runtime without touching a customer already booked.</footer> : <section className="automation-playbook-message"><span>Executable settings</span><label>Default calendar<input value={draft.booking!.defaultCalendarId} onChange={(event) => updateBooking('defaultCalendarId', event.target.value)} /></label><label>Allowed calendars (one ID per line)<textarea rows={3} value={draft.booking!.allowedCalendarIds.join('\n')} onChange={(event) => setDraft((current) => current ? { ...current, booking: { ...current.booking!, allowedCalendarIds: event.target.value.split(/\n+/).map((value) => value.trim()).filter(Boolean) } } : current)} /></label><label>Appointment title<input value={draft.booking!.sessionTitle} onChange={(event) => updateBooking('sessionTitle', event.target.value)} /></label><label>Duration minutes<input type="number" value={draft.booking!.durationMinutes} onChange={(event) => updateBooking('durationMinutes', Number(event.target.value))} /></label><label>Recovery minimum age (seconds)<input type="number" value={draft.recovery!.minimumAgeSeconds} onChange={(event) => updateRecovery('minimumAgeSeconds', Number(event.target.value))} /></label><label>Recovery maximum age (minutes)<input type="number" value={draft.recovery!.maximumAgeMinutes} onChange={(event) => updateRecovery('maximumAgeMinutes', Number(event.target.value))} /></label></section>}<div className="canonical-workflow-controls">{!draft ? <button type="button" onClick={beginEdit}>Edit live map as draft v{workflow.version + 1}</button> : <><button type="button" disabled={saving} onClick={() => save(false)}>Save draft</button><button type="button" className="is-publish" disabled={saving} onClick={() => save(true)}>Publish v{draft.version}</button><button type="button" disabled={saving} onClick={() => { setDraft(null); setStatus(''); }}>Discard</button></>}{status && <output>{status}</output>}</div></aside>
    </div>
  </section>;
}

function InitialWorkflowCanvas({ runtimes, activeEnrollments }: { runtimes: RuntimeFlow[]; activeEnrollments: ContactAutomationEnrollment[] }) {
  const available = runtimes.filter((runtime) => runtime.definition && runtime.flow);
  const [selectedFlowKey, setSelectedFlowKey] = useState('initial-in-person');
  useEffect(() => {
    if (!available.some((runtime) => runtime.flow?.key === selectedFlowKey)) setSelectedFlowKey(available[0]?.flow?.key || '');
  }, [selectedFlowKey, available]);
  const selected = available.find((runtime) => runtime.flow?.key === selectedFlowKey) || available[0];
  if (!selected?.definition || !selected.flow) return null;
  const scopedEnrollments = activeEnrollments.filter((entry) => entry.key === selected.flow?.key);
  return <section className="automation-workflow-scope" aria-label="Executable workflow selector">
    <header><span>{available.length > 1 ? 'Format' : 'Workflow'}</span><div>{available.map((runtime) => <button type="button" key={runtime.flow!.key} className={runtime.flow!.key === selected.flow!.key ? 'is-selected' : ''} onClick={() => setSelectedFlowKey(runtime.flow!.key)}><strong>{runtime.flow!.key === 'initial-virtual' ? 'Virtual' : runtime.flow!.name}</strong><small>{runtime.flow!.delivery === 'active' ? 'Live sender' : runtime.flow!.delivery === 'shadow' ? 'Shadow · no sending' : 'Staged · disabled'}</small></button>)}</div></header>
    <p className="automation-workflow-scope-notice"><strong>{selected.flow.delivery === 'active' ? 'Live sender.' : selected.flow.delivery === 'shadow' ? 'Shadow evidence only.' : 'Not sending.'}</strong> The map below is generated from the exact definition returned by the executing Worker.</p>
    <WorkflowPlaybookPreview workflow={selected.definition} delivery={selected.flow.delivery} activeEnrollments={scopedEnrollments} />
  </section>;
}

type PreviewNode = {
  id: string;
  owner: 'ghl' | 'amari' | 'rollback';
  kind: 'trigger' | 'action' | 'exit' | 'wait';
  label: string;
  timing: string;
  detail: string;
  condition?: string;
  message?: CanonicalWorkflow['nodes'][number]['message'];
  waiting?: ContactAutomationEnrollment[];
};

function initials(name: string | null | undefined) {
  return (name || 'Unknown person').split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]?.toUpperCase()).join('') || '?';
}

function WaitingPeople({ enrollments }: { enrollments: ContactAutomationEnrollment[] }) {
  if (!enrollments.length) return null;
  return <span className="automation-playbook-waiters" title={enrollments.map((entry) => entry.contactName || 'Name unavailable').join(', ')}>
    <Users size={13} aria-hidden="true" />
    <span className="automation-playbook-avatar-stack" aria-hidden="true">{enrollments.slice(0, 3).map((entry) => <i key={entry.enrollmentId}>{initials(entry.contactName)}</i>)}</span>
    <b>{enrollments.length} waiting</b>
  </span>;
}

type SourceWorkflowNode = {
  id: string;
  kind: 'trigger' | 'action' | 'wait' | 'exit';
  label: string;
  timing: string;
  detail: string;
};

function RetiredFollowUpSourceSnapshot() {
  const [selectedId, setSelectedId] = useState('follow-up-trigger');
  const trigger: SourceWorkflowNode = {
    id: 'follow-up-trigger', kind: 'trigger', label: 'Confirmed follow-up appointment', timing: 'GHL event trigger',
    detail: 'GHL starts this published workflow for a normal, confirmed appointment on one of its seven covered calendars.',
  };
  const internal: SourceWorkflowNode = {
    id: 'follow-up-internal', kind: 'action', label: 'Notify assigned user', timing: 'Immediately after confirmation',
    detail: 'GHL sends the internal booking email before the client confirmation. Exact message fields remain in the authenticated GHL source record.',
  };
  const confirmation: SourceWorkflowNode = {
    id: 'follow-up-confirmation', kind: 'action', label: 'Send booking confirmation', timing: 'Immediately after confirmation',
    detail: 'GHL sends the client the appointment-specific details and links. Exact message fields remain in the authenticated GHL source record.',
  };
  const preference: SourceWorkflowNode = {
    id: 'follow-up-preference', kind: 'action', label: 'Check Reminder Preference', timing: 'After confirmation',
    detail: 'GHL reads contact.reminder_preference: “none” ends reminder delivery; “some” takes the short-notice path; every other value takes the full reminder path.',
  };
  const none: SourceWorkflowNode = { id: 'follow-up-none', kind: 'exit', label: 'No reminders', timing: 'Preference = none', detail: 'GHL ends the reminder portion of this workflow. The initial internal email and booking confirmation have already been sent.' };
  const shortWait: SourceWorkflowNode = { id: 'follow-up-short-wait', kind: 'wait', label: 'Wait until 1 hour before', timing: 'GHL scheduler wait', detail: 'GHL holds a short-notice-path contact until one hour before the booked appointment.' };
  const shortSms: SourceWorkflowNode = {
    id: 'follow-up-short-sms', kind: 'action', label: 'Send one-hour client SMS', timing: '1 hour before appointment',
    detail: 'GHL sends the client reminder on the short-notice path. Exact message fields remain in the authenticated GHL source record.',
  };
  const fullWait: SourceWorkflowNode = { id: 'follow-up-full-wait', kind: 'wait', label: 'Wait until 1 day before', timing: 'GHL scheduler wait', detail: 'GHL holds a full-path contact until the day-before email is due.' };
  const dayBefore: SourceWorkflowNode = {
    id: 'follow-up-day-before', kind: 'action', label: 'Send day-before email', timing: '1 day before appointment',
    detail: 'GHL sends the full-path client reminder. Exact message fields remain in the authenticated GHL source record.',
  };
  const fullOneHour: SourceWorkflowNode = { id: 'follow-up-full-one-hour', kind: 'wait', label: 'Wait until 1 hour before', timing: 'GHL scheduler wait', detail: 'GHL holds the full-path contact until the final email, SMS, and internal SMS are due.' };
  const finalEmail: SourceWorkflowNode = {
    id: 'follow-up-final-email', kind: 'action', label: 'Send one-hour client email', timing: '1 hour before appointment',
    detail: 'GHL sends the final full-path email reminder. Exact message fields remain in the authenticated GHL source record.',
  };
  const finalSms: SourceWorkflowNode = { ...shortSms, id: 'follow-up-final-sms', label: 'Send one-hour client SMS', detail: 'GHL sends the same client SMS on the full reminder path.' };
  const finalInternal: SourceWorkflowNode = {
    id: 'follow-up-final-internal', kind: 'action', label: 'Notify assigned user by SMS', timing: '1 hour before appointment',
    detail: 'GHL sends the assigned user the one-hour internal notification on both reminder paths. Exact message fields remain in the authenticated GHL source record.',
  };
  const cancelled: SourceWorkflowNode = { id: 'follow-up-cancelled', kind: 'trigger', label: 'Appointment is cancelled', timing: 'GHL event trigger', detail: 'GHL receives the cancellation for the same calendar appointment.' };
  const cleanup: SourceWorkflowNode = { id: 'follow-up-cleanup', kind: 'exit', label: 'Remove from reminder workflow', timing: 'Immediate GHL cleanup', detail: 'Calendar-specific published GHL cleanup workflows remove the person from this sender, stopping every pending message. Coverage is split across Follow-up and Entrainment cancellation workflows.' };
  const nodes = [trigger, internal, confirmation, preference, none, shortWait, shortSms, fullWait, dayBefore, fullOneHour, finalEmail, finalSms, finalInternal, cancelled, cleanup];
  const selected = nodes.find((node) => node.id === selectedId) || trigger;
  const NodeButton = ({ node }: { node: SourceWorkflowNode }) => <button type="button" className={`automation-playbook-node is-ghl${selected.id === node.id ? ' is-selected' : ''}${node.kind === 'wait' ? ' is-wait' : ''}`} onClick={() => setSelectedId(node.id)} aria-pressed={selected.id === node.id}>
    <span>HISTORICAL GHL</span><strong>{node.label}</strong><small>{node.timing}</small>
  </button>;
  return <section className="automation-playbook-preview automation-source-workflow-preview" aria-label="Follow-up GHL workflow source snapshot">
    <header><div><span>Read-only GHL source snapshot · audited Aug. 11</span><h3>One canvas. The live sender today.</h3><p>Click any node for the documented trigger, message, wait, or cleanup. The people icon is the last read GHL queue, not an Amari Worker queue.</p></div><b className="is-live">GHL-owned · live sender</b></header>
    <div className="automation-playbook-preview-grid">
      <div className="automation-playbook-flow" aria-label="Follow-up GHL reminder workflow">
        <div className="automation-playbook-step"><NodeButton node={trigger} /></div><i className="automation-playbook-arrow" aria-hidden="true">↓</i>
        <div className="automation-playbook-parallel is-2"><NodeButton node={internal} /><NodeButton node={confirmation} /></div><i className="automation-playbook-arrow" aria-hidden="true">↓</i>
        <div className="automation-playbook-step"><NodeButton node={preference} /></div>
        <div className="automation-source-branches">
          <section><header><strong>None</strong><small>No reminder messages</small></header><NodeButton node={none} /></section>
          <section><header><strong>Some</strong><small>Short-notice path</small></header><NodeButton node={shortWait} /><i aria-hidden="true">↓</i><NodeButton node={shortSms} /><i aria-hidden="true">↓</i><NodeButton node={finalInternal} /></section>
          <section><header><strong>Full</strong><small>Day-before + one-hour path</small></header><NodeButton node={fullWait} /><i aria-hidden="true">↓</i><NodeButton node={dayBefore} /><i aria-hidden="true">↓</i><NodeButton node={fullOneHour} /><i aria-hidden="true">↓</i><NodeButton node={finalEmail} /><i aria-hidden="true">↓</i><NodeButton node={finalSms} /><i aria-hidden="true">↓</i><NodeButton node={finalInternal} /></section>
        </div>
        <section className="automation-playbook-side-path"><header><span>Separate cancellation path</span><p>It can interrupt either reminder branch at any point.</p></header><div><span><NodeButton node={cancelled} /><i aria-hidden="true">→</i><NodeButton node={cleanup} /></span></div></section>
      </div>
      <aside className="automation-playbook-inspector" aria-live="polite">
        <header><span>{selected.kind === 'trigger' ? 'GHL trigger' : selected.kind === 'wait' ? 'GHL wait' : selected.kind === 'exit' ? 'GHL exit / cleanup' : 'GHL action'}</span><h4>{selected.label}</h4><p>{selected.detail}</p></header>
        <dl><div><dt>Operated by</dt><dd>GHL</dd></div><div><dt>When</dt><dd>{selected.timing}</dd></div></dl>
        <footer><strong>Superseded historical snapshot.</strong> This component is retained only for source archaeology and is never selected as an operating map.</footer>
      </aside>
    </div>
  </section>;
}

function WorkflowPlaybookPreview({ workflow, delivery, activeEnrollments }: {
  workflow: CanonicalWorkflow;
  delivery: 'active' | 'shadow' | 'disabled' | 'unpublished';
  activeEnrollments: ContactAutomationEnrollment[];
}) {
  const [selectedId, setSelectedId] = useState('trigger');
  useEffect(() => setSelectedId('trigger'), [workflow.id, workflow.version]);
  const timing = (value: string | undefined) => value === 'enroll' ? 'Immediately after enrollment' : value === 'reschedule' ? 'On reschedule' : value === 'start-1440m' ? '24 hours before appointment' : value === 'start-60m' ? '1 hour before appointment' : value || 'Timing recorded in definition';
  const trigger: PreviewNode = { id: 'trigger', owner: 'ghl', kind: 'trigger', label: humanize(String(workflow.trigger.type || workflow.trigger.event || 'appointment event')), timing: 'External event source', detail: structured(workflow.trigger) };
  const groups: Array<{ timingKey: string; nodes: PreviewNode[] }> = [];
  workflow.nodes.forEach((node) => {
    const timingKey = node.at || node.timing || 'definition order';
    let group = groups.find((entry) => entry.timingKey === timingKey);
    if (!group) { group = { timingKey, nodes: [] }; groups.push(group); }
    const templates = [node.action?.template, node.id].filter(Boolean);
    const waiting = activeEnrollments.filter((entry) => entry.nextStep?.template != null && templates.includes(entry.nextStep.template));
    const channel = node.message ? `${node.message.audience} ${node.message.channel}` : 'No message payload';
    group.nodes.push({
      id: node.id,
      owner: 'amari',
      kind: node.action?.type === 'exit_flow' ? 'exit' : 'action',
      label: node.label,
      timing: timing(node.at || node.timing),
      detail: `${humanize(node.action?.type || node.kind || 'operation')} · ${channel}`,
      condition: node.when ? structured(node.when) : undefined,
      message: node.message,
      waiting,
    });
  });
  const exitNodes: PreviewNode[] = workflow.exits.map((exit, index) => ({
    id: `exit-${index}-${exit.event}`,
    owner: 'amari',
    kind: 'exit',
    label: exit.label || humanize(exit.event),
    timing: `On ${humanize(exit.event)}`,
    detail: exit.effect,
  }));
  const allNodes = [trigger, ...groups.flatMap((group) => group.nodes), ...exitNodes];
  const selected = allNodes.find((node) => node.id === selectedId) || trigger;
  const NodeButton = ({ node }: { node: PreviewNode }) => <button type="button" className={`automation-playbook-node is-${node.owner}${selected.id === node.id ? ' is-selected' : ''}${node.kind === 'wait' ? ' is-wait' : ''}`} onClick={() => setSelectedId(node.id)} aria-pressed={selected.id === node.id}>
    <span>{node.owner === 'ghl' ? 'EXTERNAL EVENT' : 'AMARI'}</span><strong>{node.label}</strong><small>{node.timing}</small>{node.condition && <em>When {node.condition}</em>}<WaitingPeople enrollments={node.waiting || []} />
  </button>;
  return <section className="automation-playbook-preview" aria-label="Future operational workflow editor preview">
    <header>
      <div><span>Canonical executable workflow</span><h3>One canvas. The actual workflow underneath.</h3><p>These nodes come from the current published Worker definition. Click a node to inspect its exact action and message.</p></div>
      <b className={delivery === 'active' ? 'is-live' : ''}>{delivery === 'active' ? 'Live definition' : delivery === 'shadow' ? 'Shadow definition · no sending' : 'Definition not sending'}</b>
    </header>
    <div className="automation-playbook-preview-grid">
      <div className="automation-playbook-flow" aria-label={`${workflow.name} workflow`}>
        <div className="automation-playbook-step"><NodeButton node={trigger} /></div>
        {groups.map((group) => <div key={group.timingKey} className="automation-playbook-step"><i className="automation-playbook-arrow" aria-hidden="true">↓</i><div className={`automation-playbook-parallel is-${group.nodes.length}`}>{group.nodes.map((node) => <NodeButton key={node.id} node={node} />)}</div></div>)}
        {exitNodes.length > 0 && <section className="automation-playbook-side-path"><header><span>Executable exits</span><p>Each exit below is read directly from this definition and can interrupt pending actions when its event occurs.</p></header><div>{exitNodes.map((node) => <span key={node.id}><NodeButton node={node} /></span>)}</div></section>}
      </div>
      <aside className="automation-playbook-inspector" aria-live="polite">
        <header><span>{selected.kind === 'trigger' ? 'Trigger' : selected.kind === 'wait' ? 'Wait' : selected.kind === 'exit' ? 'Exit / fallback' : 'Action'}</span><h4>{selected.label}</h4><p>{selected.detail}</p></header>
        <dl><div><dt>Operated by</dt><dd>{selected.owner === 'ghl' ? 'GHL' : selected.owner === 'amari' ? 'Amari' : 'GHL rollback / cleanup'}</dd></div><div><dt>When</dt><dd>{selected.timing}</dd></div></dl>
        {selected.waiting?.length ? <section className="automation-playbook-waiting-list"><span><Users size={14} /> People whose next action is this node</span><ul>{selected.waiting.map((entry) => <li key={entry.enrollmentId}><i>{initials(entry.contactName)}</i><div><strong>{entry.contactName || 'Name unavailable'}</strong><small>Due {exactTime(entry.nextStep?.dueAt)}</small></div></li>)}</ul></section> : null}
        {selected.message && <section className="automation-playbook-message"><span>Future editable fields</span>{selected.message.from && <label>From<input readOnly value={selected.message.from} /></label>}{selected.message.subject && <label>Subject<input readOnly value={selected.message.subject} /></label>}<label>Exact message<textarea readOnly rows={8} value={selected.message.body} /></label></section>}
        <footer><strong>Preview only.</strong> There is no save or publish action here. When editing is enabled, publishing this node will show the {activeEnrollments.length} active enrollment{activeEnrollments.length === 1 ? '' : 's'} and pending actions affected before anything changes.</footer>
      </aside>
    </div>
  </section>;
}

function OwnershipLegend() {
  return <div className="automation-ownership-legend" aria-label="Ownership map legend">
    <span className="is-ghl">GHL operates</span>
    <span className="is-amari">Amari operates</span>
    <span className="is-rollback">GHL rollback / cleanup</span>
    <span className="is-gap">Unresolved gap</span>
  </div>;
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
  const isInPersonCutover = family.key === 'initial-session-reminders';
  const canonicalRuntimes = detail.runtime?.flows || [];
  const hasCanonicalRuntime = canonicalRuntimes.some((runtime) => runtime.definition && runtime.flow);
  const activeInitialRuntime = canonicalRuntimes.find((runtime) => runtime.flow?.key === 'initial-in-person');
  const virtualInitialRuntime = canonicalRuntimes.find((runtime) => runtime.flow?.key === 'initial-virtual');
  const displayedDefinitions = hasCanonicalRuntime || isInPersonCutover
    ? []
    : family.ownedDefinitions;
  const displayedSourceRecords = family.sourceRecords;
  const displayedEvidenceGaps = isInPersonCutover
    ? detail.evidence.gaps.filter((gap) => ![
      'external_canvas_history_not_imported',
      'source_record_metadata_only',
      'owned_delivery_templates_not_loaded',
    ].includes(gap.code))
    : detail.evidence.gaps;
  const activeEnrollments = detail.enrollments.filter((item) => item.status === 'active');
  const workflowNodes = activeInitialRuntime?.definition?.nodes || [];
  const nodeFor = (stepIndex: number | null | undefined, template?: string | null) => workflowNodes.find((node, index) => index === stepIndex || node.action.template === template) || null;
  const nameForEvent = (event: typeof detail.events[number]) => {
    const enrollment = detail.enrollments.find((entry) => entry.contactId === event.contactId || entry.providerContactId === event.contactId);
    if (enrollment?.contactName) return enrollment.contactName;
    return event.contactId ? 'Person not yet linked' : 'Unlinked delivery';
  };
  const describeEvent = (event: typeof detail.events[number]) => {
    const node = nodeFor(event.stepIndex, event.action);
    const step = node?.label || (event.stepIndex == null ? 'Workflow event' : `Workflow step ${event.stepIndex + 1}`);
    if (event.action === 'delivery_status') return `${nameForEvent(event)} — ${step} delivery ${eventOutcome(event).toLowerCase()}`;
    if (event.action === 'send') return `${nameForEvent(event)} — ${step} sent`;
    if (event.action === 'backfilled') return `${nameForEvent(event)} — reminder run enrolled`;
    return `${nameForEvent(event)} — ${humanize(event.action)}`;
  };
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
          {displayedEvidenceGaps.length > 0 && <a href="#workflow-evidence-limits">Evidence limits</a>}
        </nav>
      )}

      {(detail.coverage?.enrollmentsTruncated || detail.coverage?.eventsTruncated) && (
        <div className="automation-evidence-banner"><AlertTriangle size={17} /><span><strong>Bounded evidence view.</strong> Older {detail.coverage.enrollmentsTruncated ? 'enrollments' : ''}{detail.coverage.enrollmentsTruncated && detail.coverage.eventsTruncated ? ' and ' : ''}{detail.coverage.eventsTruncated ? 'run events' : ''} exist beyond this page and are not included in the counts below.</span></div>
      )}

      {family.kind === 'evidence_only' && <div className="automation-evidence-banner"><Archive size={17} /><span><strong>Not an operating family.</strong> These test records are retained only so the 82-record inventory remains exact.</span></div>}

      <div className="automation-implementation-strip">
        {family.implementationUnits.map((unit) => <span key={unit}>{IMPLEMENTATION_LABELS[unit] || humanize(unit)}</span>)}
      </div>

      {isInPersonCutover && <p className="automation-cutover-scope-note"><strong>Scope: GHL supplies appointment events and delivery adapters; Amari operates both Initial definitions.</strong> The selector and node map use the exact definitions and delivery states returned by the executing Worker.</p>}

      {isInPersonCutover && <div className="automation-evidence-banner"><CircleDot size={17} /><span><strong>{detail.runtime?.verified ? `Runtime verified: in-person ${activeInitialRuntime?.flow?.delivery || 'unknown'}; virtual ${virtualInitialRuntime?.flow?.delivery || 'unknown'}.` : 'Runtime status unavailable.'}</strong> {detail.runtime?.verified ? `The executing reminder Worker read both scoped definitions; ${detail.enrollments.filter((item) => item.status === 'active').length} active enrollment${detail.enrollments.filter((item) => item.status === 'active').length === 1 ? '' : 's'} appear below.` : 'This page will not claim a delivery state until the Worker can answer for both scopes.'}</span></div>}

      {isInPersonCutover && detail.runtime?.verified && <div className="automation-evidence-banner"><MessageSquareText size={17} /><span><strong>Delivery evidence is channel-specific.</strong> {activeInitialRuntime?.flow?.receiptCoverage?.sms === 'terminal_status_reconciled' ? (activeInitialRuntime.receiptHealth?.status === 'healthy' ? `SMS receipt reconciliation was healthy at ${exactTime(activeInitialRuntime.receiptHealth.checkedAt)} (${activeInitialRuntime.receiptHealth.recorded} new terminal outcome${activeInitialRuntime.receiptHealth.recorded === 1 ? '' : 's'}, ${activeInitialRuntime.receiptHealth.pending} still pending).` : activeInitialRuntime.receiptHealth?.status === 'degraded' ? `SMS receipt reconciliation was degraded at ${exactTime(activeInitialRuntime.receiptHealth.checkedAt)} with ${activeInitialRuntime.receiptHealth.errors} error${activeInitialRuntime.receiptHealth.errors === 1 ? '' : 's'}. Delivery evidence may be incomplete.` : 'SMS receipt reconciliation is configured, but no completed sweep can currently be proven.') : 'SMS receipt coverage is unavailable from the executing Worker.'} Email shows Gmail acceptance only; Gmail does not provide an affirmative recipient-delivery receipt.</span></div>}

      {isInPersonCutover && focused && activeInitialRuntime?.definition && <section className="automation-detail-section" id="workflow-definition">
        <div className="automation-section-heading"><BookOpenCheck size={17} /><div><h3>How this reminder run works</h3><p>The canvas is the one readable view of the current published in-person definition.</p></div><b>1</b></div>
        <InitialWorkflowCanvas runtimes={canonicalRuntimes} activeEnrollments={activeEnrollments} />
      </section>}

      {!isInPersonCutover && !hasCanonicalRuntime && family.key !== 'commerce-ledger-event-ingest' && <section className="automation-detail-section" id="workflow-definition">
        <div className="automation-section-heading"><BookOpenCheck size={17} /><div><h3>{isInPersonCutover ? 'Canonical executable workflows' : 'Owned definition'}</h3><p>{isInPersonCutover ? 'The executing Worker and this view read these same scoped, versioned documents.' : 'Exact trigger, step timing, type, branch structure, and template key from code.'}</p></div><b>{isInPersonCutover ? canonicalRuntimes.filter((runtime) => runtime.definition).length : displayedDefinitions.length}</b></div>
        {displayedDefinitions.length ? displayedDefinitions.map((definition) => (
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
      </section>}

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
            <span><strong>{activeEnrollments.length}</strong><small>active</small></span>
            <span><strong>{detail.events.length}</strong><small>run events</small></span>
            <span><strong>{detail.events.filter((item) => ['failed', 'bounced', 'error'].includes((item.outcome || '').toLowerCase())).length}</strong><small>failures</small></span>
          </div>
        )}
        {isInPersonCutover && detail.configured && <div className="automation-person-columns">
          <section><h3><Workflow size={16} /> Enrolled people <b>{detail.enrollments.length}</b></h3>
            {detail.enrollments.length ? detail.enrollments.map((enrollment) => <article key={enrollment.enrollmentId}><div><strong>{enrollment.contactName || 'Name unavailable'}</strong><span className={enrollment.status === 'active' ? 'active' : ''}>{enrollment.status}</span></div><dl><div><dt>Version</dt><dd>{enrollment.definitionVersion ? `v${enrollment.definitionVersion}` : 'Pre-version history'}</dd></div><div><dt>Waiting for</dt><dd>{enrollment.nextStep ? nodeFor(enrollment.nextStep.stepIndex, enrollment.nextStep.template)?.label || 'Next scheduled message' : 'No pending message'}</dd></div><div><dt>Next action</dt><dd>{enrollment.nextStep ? exactTime(enrollment.nextStep.dueAt) : 'Nothing scheduled'}</dd></div><div><dt>Appointment</dt><dd>{enrollment.appointmentId ? 'Linked to this reminder run' : 'Not recorded'}</dd></div></dl></article>) : <p className="automation-registry-empty">No enrollment is recorded by the executing Worker.</p>}
          </section>
          <section><h3><Clock3 size={16} /> Run history <b>{detail.events.length}</b></h3>
            {detail.events.length ? detail.events.slice(0, 50).map((event, index) => <article className={['failed', 'error', 'bounced'].includes(String(event.outcome).toLowerCase()) ? 'is-failure' : ''} key={`${event.ts}-${event.messageRef || index}`}><div><strong>{describeEvent(event)}</strong><span>{eventOutcome(event)}</span></div><time>{exactTime(event.ts)}</time><p>{nodeFor(event.stepIndex, event.action)?.message.audience === 'internal' ? 'Internal notification' : 'Client reminder'}{event.channel ? ` · ${humanize(event.channel)}` : ''}{event.definitionVersion ? ` · version ${event.definitionVersion}` : ''}</p>{event.messageRef && <small>{event.action === 'delivery_status' ? 'Provider receipt' : 'Provider reference'}: <code>{event.messageRef}</code></small>}</article>) : <p className="automation-registry-empty">No execution event is recorded by the executing Worker.</p>}
          </section></div>}
      </section>

      <section className="automation-detail-section" id="source-record-evidence">
        <div className="automation-section-heading"><Workflow size={17} /><div><h3>{isInPersonCutover ? 'Former GHL record evidence' : 'Source record evidence'}</h3><p>{isInPersonCutover ? 'Historical inventory only. These labels do not control—or report—the live Amari workflow.' : 'Exact names and dated publication status; canvas history is not imported.'}</p></div><b>{displayedSourceRecords.length}</b></div>
        <div className="automation-source-list">
          {displayedSourceRecords.map((record) => <div key={record.name}><span className={record.status}>{record.status}</span><strong>{record.name}</strong></div>)}
        </div>
      </section>

      {displayedEvidenceGaps.length > 0 && <section className="automation-detail-section" id="workflow-evidence-limits">
        <div className="automation-section-heading"><AlertTriangle size={17} /><div><h3>Evidence limits</h3><p>These labels prevent false certainty during cutover.</p></div></div>
        <ul className="automation-gap-list">{displayedEvidenceGaps.map((gap) => <li key={gap.code}><strong>{humanize(gap.code)}</strong><span>{gap.label}</span></li>)}</ul>
      </section>}
    </>
  );
}

function CanonicalWorkflowView({ workflow, delivery }: { workflow: import('../types/staff').CanonicalWorkflow; delivery: 'active' | 'shadow' | 'disabled' | 'unpublished' }) {
  const [draft, setDraft] = useState<import('../types/staff').CanonicalWorkflow | null>(null);
  const [status, setStatus] = useState('');
  const [saving, setSaving] = useState(false);
  const updateMessage = (index: number, patch: Record<string, string>) => setDraft((current) => current ? ({ ...current, nodes: current.nodes.map((node, i) => i === index ? { ...node, message: { ...node.message, ...patch } } : node) }) : current);
  const beginEdit = () => {
    setStatus('Draft changes do not send or change GHL. Copy edits apply only after an explicit publish.');
    setDraft({ ...workflow, version: workflow.version + 1, nodes: workflow.nodes.map((node) => ({ ...node, action: { ...node.action }, message: { ...node.message } })) });
  };
  const save = async () => {
    if (!draft) return;
    setSaving(true); setStatus('Validating and saving draft…');
    try { await saveAutomationWorkflowDraft(draft); setStatus(`Draft v${draft.version} saved. Nothing was published or sent.`); }
    catch (error) { setStatus(error instanceof Error ? error.message : 'Draft could not be saved.'); }
    finally { setSaving(false); }
  };
  const publish = async () => {
    if (!draft) return;
    setSaving(true); setStatus('Validating published-version lock…');
    try {
      await saveAutomationWorkflowDraft(draft);
      await publishAutomationWorkflow(draft.id, draft.version, workflow.version);
      setStatus(`Published v${draft.version}. Reloading runtime truth…`);
      window.location.reload();
    } catch (error) { setStatus(error instanceof Error ? error.message : 'Workflow could not be published.'); setSaving(false); }
  };
  return <article className="automation-definition-card automation-canonical-workflow">
    <header><span>{delivery === 'active' ? 'Published · live' : delivery === 'shadow' ? 'Published · shadow' : delivery === 'disabled' ? 'Published · disabled' : 'Not published'}</span><strong>{workflow.name}</strong><em>v{workflow.version}</em></header>
    <div className="canonical-workflow-controls">
      <p><strong>Published v{workflow.version} is the Worker document.</strong> Copy, sender, subject, and preheader edits are executable. Timing, branches, and order stay locked until Staff can preview and replan every pending person safely.</p>
      {!draft ? <button type="button" onClick={beginEdit}>Edit as draft v{workflow.version + 1}</button> : <><button type="button" disabled={saving} onClick={save}>Save draft</button><button className="is-publish" type="button" disabled={saving} onClick={publish}>Publish v{draft.version}</button><button type="button" disabled={saving} onClick={() => { setDraft(null); setStatus(''); }}>Discard draft</button></>}
      {status && <output>{status}</output>}
    </div>
    <div className="automation-definition-grid"><div><h4>Trigger</h4><pre>{structured(workflow.trigger)}</pre></div><div><h4>Exits</h4><pre>{structured(workflow.exits)}</pre></div></div>
    {!draft && <div className="automation-step-list canonical-workflow-tree">{workflow.nodes.map((node, index) => <div key={node.id}><span>{index + 1}</span><p><strong>{node.label}</strong><small>{node.at} · {humanize(node.action.type)} · <code>{node.id}</code></small></p></div>)}</div>}
    {draft && <div className="canonical-workflow-editor" aria-label={`Draft workflow version ${draft.version}`}>
      {draft.nodes.map((node, index) => <article key={node.id}>
        <header><span>{index + 1}</span><strong>{humanize(node.action.type)}</strong><code>{node.id}</code></header>
        <label>Step name<input readOnly value={node.label} /></label>
        <label>Timing<input readOnly value={node.at} /><small>Locked until the pending-step replan preview is implemented.</small></label>
        {node.message.from !== undefined && <label>From<input value={node.message.from} onChange={(event) => updateMessage(index, { from: event.target.value })} /></label>}
        {node.message.subject !== undefined && <label>Subject<input value={node.message.subject} onChange={(event) => updateMessage(index, { subject: event.target.value })} /></label>}
        {node.message.preheader !== undefined && <label>Preheader<input value={node.message.preheader} onChange={(event) => updateMessage(index, { preheader: event.target.value })} /></label>}
        <label>Exact message<textarea rows={7} value={node.message.body} onChange={(event) => updateMessage(index, { body: event.target.value })} /></label>
      </article>)}
    </div>}
    <section className="automation-message-preview"><header><div><h4>Exact executable message templates</h4><p>These templates are rendered by the same node definitions shown above.</p></div><span>{workflow.nodes.length}</span></header>
      {workflow.nodes.map((node, index) => <article key={node.id}><h5>Step {index + 1} · {humanize(node.message.audience)} {node.message.channel}</h5>{node.message.from && <p><b>From</b>{node.message.from}</p>}{node.message.subject && <p><b>Subject</b>{node.message.subject}</p>}<pre>{node.message.body}</pre></article>)}
    </section>
  </article>;
}

function CutoverTree({ tree, compact = false }: { tree: AutomationCutoverTree; compact?: boolean }) {
  const nodesByParent = new Map<string | null, typeof tree.nodes>();
  for (const node of tree.nodes) {
    const nodes = nodesByParent.get(node.parentId) || [];
    nodes.push(node);
    nodesByParent.set(node.parentId, nodes);
  }
  const stateLabel: Record<typeof tree.nodes[number]['state'], string> = {
    verified_ghl: 'GHL operates', legacy_ghl: 'GHL rollback', owned_shadow: 'Amari shadow', owned_live: 'Amari operates', proven_owned: 'Amari proven', gap: 'Gap',
  };
  const renderChildren = (parentId: string | null) => (nodesByParent.get(parentId) || []).map((node) => (
    <li className={`automation-tree-node is-${node.state}`} key={node.id}>
      <article>
        <header><span>{stateLabel[node.state]}</span><strong>{node.label}</strong></header>
        <p>{node.detail}</p>
        <small><GitBranch size={12} />{node.evidence}</small>
      </article>
      {(nodesByParent.get(node.id) || []).length > 0 && <ul>{renderChildren(node.id)}</ul>}
    </li>
  ));
  return (
    <section className={`automation-cutover-tree${compact ? ' is-ownership-map' : ''}`} aria-label={`${tree.title} evidence tree`}>
      <header>
        <div><span>{compact ? 'Current operating path' : 'Live workflow tree'}</span><h3>{tree.title}</h3><p>{tree.summary}</p></div>
        <i>Only backed connections appear</i>
      </header>
      <ul className="automation-tree-root">{renderChildren(null)}</ul>
    </section>
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
        <a href={`/staff/client/${encodeURIComponent(person.providerContactId || person.id)}/record#workflows`}><ArrowUpRight size={14} /> Back to person record</a>
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
                <p>{humanize(event.action)} · {humanize(event.channel)} · <b>{eventOutcome(event)}</b></p>
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
