import { useEffect, useMemo, useState } from 'react';
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
import './AutomationRegistryPage.css';
import './AutomationCutoverTree.css';
import './AutomationCutoverTreeFix.css';
import './AutomationHealthPilot.css';
import './AutomationMasterMap.css';
import './AutomationWorkflowCanvas.css';

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
  'initial-session-reminders': 'Initial / Assessment in-person reminder',
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

  function selectMapFamily(key: string) {
    const next = new URLSearchParams(params);
    next.set('family', key);
    setParams(next, { replace: true });
  }

  function revealAutomationEvidence() {
    document.getElementById('automation-evidence')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  const mapRuntime = familyDetail?.family.key === 'initial-session-reminders'
    ? familyDetail.runtime?.flows?.find((runtime) => runtime.flow?.key === 'initial-in-person')
    : null;
  const mapWorkflow = mapRuntime?.definition || null;
  const mapDelivery = mapRuntime?.flow?.delivery || 'unpublished';
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
              <p>The 24 named automations are one operating system. Each detailed node will show who operates it now—GHL, Amari, Stripe, Google, or a person—so the remaining cutover work is visible rather than implied.</p>
            </>
          )}
        </div>
      </header>

      {registry && !isFocusedInspector && <AutomationMasterMap
        families={registry.families}
        selectedKey={selectedFamilyKey}
        onSelect={selectMapFamily}
        onRevealEvidence={revealAutomationEvidence}
        workflow={mapWorkflow}
        delivery={mapDelivery}
        activeEnrollments={mapActiveEnrollments}
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
  onRevealEvidence,
  workflow,
  delivery,
  activeEnrollments,
}: {
  families: AutomationFamily[];
  selectedKey: string;
  onSelect: (key: string) => void;
  onRevealEvidence: () => void;
  workflow: CanonicalWorkflow | null;
  delivery: 'active' | 'disabled' | 'unpublished';
  activeEnrollments: ContactAutomationEnrollment[];
}) {
  const selectedFamily = families.find((family) => family.key === selectedKey)
    || families.find((family) => family.cutoverTree)
    || null;
  return <section className="automation-master-map" aria-label="Amari master automation map">
    <header>
      <div>
        <span>Master map · 24 automations</span>
        <h2>What exists, before we claim who owns it.</h2>
        <p>Every card below is one named master automation. A “Node map drawn” card links to source-backed action ownership. A gray card is known work that has not been drawn yet; it is not an ownership claim.</p>
      </div>
      <div className="automation-master-key" aria-label="Master map status legend"><span className="is-drawn">Node map drawn</span><span className="is-pending">Not drawn yet</span></div>
    </header>
    <div className="automation-master-lanes">
      {MASTER_MAP_LANES.map((lane) => {
        const laneFamilies = families.filter((family) => family.kind === 'operational' && family.lifecycle === lane.key);
        return <section key={lane.key} className="automation-master-lane">
          <header><strong>{lane.label}</strong><small>{lane.description}</small></header>
          <div>
            {laneFamilies.map((family) => <button type="button" key={family.key} className={`${family.cutoverTree ? 'is-drawn' : 'is-pending'}${selectedFamily?.key === family.key ? ' is-selected' : ''}`} aria-pressed={selectedFamily?.key === family.key} onClick={() => onSelect(family.key)}>
              <strong>{family.name}</strong>
              <small>{family.cutoverTree ? 'Node map drawn' : 'Needs node map'}</small>
              <ChevronRight size={14} aria-hidden="true" />
            </button>)}
          </div>
        </section>;
      })}
    </div>
    {selectedFamily?.cutoverTree
      ? <AutomationHealthPilot family={selectedFamily} onRevealEvidence={onRevealEvidence} workflow={workflow} delivery={delivery} activeEnrollments={activeEnrollments} />
      : selectedFamily && <AutomationMapPending family={selectedFamily} />}
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
  workflow,
  delivery,
  activeEnrollments,
}: {
  family: AutomationFamily;
  onRevealEvidence: () => void;
  workflow: CanonicalWorkflow | null;
  delivery: 'active' | 'disabled' | 'unpublished';
  activeEnrollments: ContactAutomationEnrollment[];
}) {
  return (
    <section className="automation-health-pilot" aria-label={`${family.name} ownership map`}>
      <header>
        <div>
          <span><Activity size={14} /> Selected automation · node map drawn</span>
          <h2>{NODE_MAP_TITLES[family.key] || family.name}</h2>
          <p>Read from top to bottom: each color identifies the system that operates that action today.</p>
        </div>
        <button type="button" onClick={onRevealEvidence}>Open live run evidence <ChevronRight size={15} /></button>
      </header>
      <OwnershipLegend />
      {workflow ? <WorkflowPlaybookPreview workflow={workflow} delivery={delivery} activeEnrollments={activeEnrollments} tree={family.cutoverTree!} /> : <CutoverTree tree={family.cutoverTree!} compact />}
      <footer><b>Plain answer:</b> GHL still owns the calendar and the appointment. Amari owns the live in-person reminder run and cancels that run when GHL reports a cancellation. The published GHL cleanup is a fallback, not a second sender.</footer>
    </section>
  );
}

type PreviewNode = {
  id: string;
  owner: 'ghl' | 'amari' | 'rollback';
  kind: 'trigger' | 'action' | 'exit' | 'wait';
  label: string;
  timing: string;
  detail: string;
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

function WorkflowPlaybookPreview({ workflow, delivery, activeEnrollments, tree }: {
  workflow: CanonicalWorkflow;
  delivery: 'active' | 'disabled' | 'unpublished';
  activeEnrollments: ContactAutomationEnrollment[];
  tree: AutomationCutoverTree;
}) {
  const [selectedId, setSelectedId] = useState('trigger');
  useEffect(() => setSelectedId('trigger'), [workflow.id, workflow.version]);
  const nodeByTemplate = (template: string) => workflow.nodes.find((node) => node.action.template === template || node.id === template);
  const bookedInternal = nodeByTemplate('booked-internal');
  const confirmation = nodeByTemplate('confirmation');
  const dayBefore = nodeByTemplate('day-before');
  const oneHourSms = nodeByTemplate('one-hour-sms');
  const startingSoon = nodeByTemplate('starting-soon');
  const oneHourInternal = nodeByTemplate('one-hour-internal');
  const activeFor = (templates: Array<string | undefined>) => activeEnrollments.filter((entry) => entry.nextStep?.template != null && templates.includes(entry.nextStep.template));
  const toAction = (node: CanonicalWorkflow['nodes'][number] | undefined): PreviewNode | null => node ? ({ id: node.id, owner: 'amari', kind: 'action', label: node.label, timing: node.at === 'enroll' ? 'Immediately after booking' : node.at === 'start-1440m' ? '24 hours before appointment' : node.at === 'start-60m' ? '1 hour before appointment' : node.at, detail: `${humanize(node.action.type)} · ${node.message.audience} ${node.message.channel}`, message: node.message }) : null;
  const immediateNodes = [toAction(bookedInternal), toAction(confirmation)].filter(Boolean) as PreviewNode[];
  const finalNodes = [toAction(oneHourSms), toAction(startingSoon), toAction(oneHourInternal)].filter(Boolean) as PreviewNode[];
  const dayWaiters = activeFor([dayBefore?.action.template, dayBefore?.id]);
  const oneHourWaiters = activeFor([oneHourSms?.action.template, oneHourSms?.id, startingSoon?.action.template, startingSoon?.id, oneHourInternal?.action.template, oneHourInternal?.id]);
  const waitDayBefore: PreviewNode | null = dayBefore ? { id: 'wait-day-before', owner: 'amari', kind: 'wait', label: 'Wait until 24 hours before', timing: 'Scheduler wait', detail: 'The worker holds this person here until the day-before reminder is due.', waiting: dayWaiters } : null;
  const waitOneHour: PreviewNode | null = finalNodes.length ? { id: 'wait-one-hour', owner: 'amari', kind: 'wait', label: 'Wait until 1 hour before', timing: 'Scheduler wait', detail: 'The worker holds this person here until the one-hour messages are due.', waiting: oneHourWaiters } : null;
  const trigger: PreviewNode = { id: 'trigger', owner: 'ghl', kind: 'trigger', label: 'Confirmed appointment', timing: 'GHL event trigger', detail: 'GHL reports a confirmed appointment from a covered in-person calendar.' };
  const cancellation = workflow.exits.find((exit) => /cancel/i.test(`${exit.event} ${exit.effect} ${exit.label}`));
  const rollback = tree.nodes.find((node) => node.state === 'legacy_ghl');
  const cancellationNodes: PreviewNode[] = cancellation ? [
    { id: 'cancel-event', owner: 'ghl', kind: 'trigger', label: 'Appointment is cancelled', timing: 'GHL event trigger', detail: 'GHL reports that this same appointment was cancelled.' },
    { id: 'cancellation', owner: 'amari', kind: 'exit', label: cancellation.label || 'Cancel every pending reminder', timing: 'Immediate exit', detail: cancellation.effect },
  ] : [];
  const rollbackNode: PreviewNode | null = rollback ? { id: 'rollback', owner: 'rollback', kind: 'exit', label: rollback.label, timing: 'Fallback only', detail: rollback.detail } : null;
  const allNodes = [trigger, ...immediateNodes, waitDayBefore, toAction(dayBefore), waitOneHour, ...finalNodes, ...cancellationNodes, rollbackNode].filter(Boolean) as PreviewNode[];
  const selected = allNodes.find((node) => node.id === selectedId) || trigger;
  const NodeButton = ({ node }: { node: PreviewNode }) => <button type="button" className={`automation-playbook-node is-${node.owner}${selected.id === node.id ? ' is-selected' : ''}${node.kind === 'wait' ? ' is-wait' : ''}`} onClick={() => setSelectedId(node.id)} aria-pressed={selected.id === node.id}>
    <span>{node.owner === 'ghl' ? 'GHL' : node.owner === 'amari' ? 'AMARI' : 'GHL FALLBACK'}</span><strong>{node.label}</strong><small>{node.timing}</small>{node.kind === 'wait' && <WaitingPeople enrollments={node.waiting || []} />}
  </button>;
  return <section className="automation-playbook-preview" aria-label="Future operational workflow editor preview">
    <header>
      <div><span>Read-only future control-room preview</span><h3>One canvas. The actual workflow underneath.</h3><p>These nodes use the current published in-person definition. Click a node to inspect what the future editor will control.</p></div>
      <b className={delivery === 'active' ? 'is-live' : ''}>{delivery === 'active' ? 'Live definition' : 'Definition not sending'}</b>
    </header>
    <div className="automation-playbook-preview-grid">
      <div className="automation-playbook-flow" aria-label="In-person reminder workflow">
        <div className="automation-playbook-step"><NodeButton node={trigger} /></div>
        {immediateNodes.length > 0 && <><i className="automation-playbook-arrow" aria-hidden="true">↓</i><div className={`automation-playbook-parallel is-${immediateNodes.length}`}>{immediateNodes.map((node) => <NodeButton key={node.id} node={node} />)}</div></>}
        {waitDayBefore && <><i className="automation-playbook-arrow" aria-hidden="true">↓</i><div className="automation-playbook-step"><NodeButton node={waitDayBefore} /></div></>}
        {dayBefore && <><i className="automation-playbook-arrow" aria-hidden="true">↓</i><div className="automation-playbook-step"><NodeButton node={toAction(dayBefore)!} /></div></>}
        {waitOneHour && <><i className="automation-playbook-arrow" aria-hidden="true">↓</i><div className="automation-playbook-step"><NodeButton node={waitOneHour} /></div></>}
        {finalNodes.length > 0 && <><i className="automation-playbook-arrow" aria-hidden="true">↓</i><div className={`automation-playbook-parallel is-${finalNodes.length}`}>{finalNodes.map((node) => <NodeButton key={node.id} node={node} />)}</div></>}
        {cancellationNodes.length > 0 && <section className="automation-playbook-side-path"><header><span>Separate cancellation path</span><p>This is not after the reminders. It can interrupt them at any point.</p></header><div>{cancellationNodes.map((node, index) => <span key={node.id}>{index > 0 && <i aria-hidden="true">→</i>}<NodeButton node={node} /></span>)}</div></section>}
        {rollbackNode && <section className="automation-playbook-fallback"><span>Rollback protection</span><NodeButton node={rollbackNode} /></section>}
      </div>
      <aside className="automation-playbook-inspector" aria-live="polite">
        <header><span>{selected.kind === 'trigger' ? 'Trigger' : selected.kind === 'wait' ? 'Wait' : selected.kind === 'exit' ? 'Exit / fallback' : 'Action'}</span><h4>{selected.label}</h4><p>{selected.detail}</p></header>
        <dl><div><dt>Operated by</dt><dd>{selected.owner === 'ghl' ? 'GHL' : selected.owner === 'amari' ? 'Amari' : 'GHL rollback / cleanup'}</dd></div><div><dt>When</dt><dd>{selected.timing}</dd></div></dl>
        {selected.kind === 'wait' && <section className="automation-playbook-waiting-list"><span><Users size={14} /> People waiting here now</span>{selected.waiting?.length ? <ul>{selected.waiting.map((entry) => <li key={entry.enrollmentId}><i>{initials(entry.contactName)}</i><div><strong>{entry.contactName || 'Name unavailable'}</strong><small>Due {exactTime(entry.nextStep?.dueAt)}</small></div></li>)}</ul> : <p>No active enrollment is currently waiting at this point.</p>}</section>}
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
  const activeInitialRuntime = canonicalRuntimes.find((runtime) => runtime.flow?.key === 'initial-in-person');
  const virtualInitialRuntime = canonicalRuntimes.find((runtime) => runtime.flow?.key === 'initial-virtual');
  const displayedDefinitions = isInPersonCutover
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
  const nameForEvent = (event: typeof detail.events[number]) => detail.enrollments.find((entry) => entry.contactId && entry.contactId === event.contactId)?.contactName || 'Person not recorded';
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

      {isInPersonCutover && <p className="automation-cutover-scope-note"><strong>Scope: this is a shared in-person lifecycle, not a full Amari cutover.</strong> GHL operates the calendar and appointment status; Amari operates the live in-person reminder run. Initial Virtual remains GHL-operated while its separate behavior release, shadow proof, queue reconciliation, and activation gates remain incomplete.</p>}

      {isInPersonCutover && <div className="automation-evidence-banner"><CircleDot size={17} /><span><strong>{detail.runtime?.verified ? `Runtime verified: in-person ${activeInitialRuntime?.flow?.delivery || 'unknown'}; virtual ${virtualInitialRuntime?.flow?.delivery || 'unknown'}.` : 'Runtime status unavailable.'}</strong> {detail.runtime?.verified ? `The executing reminder Worker read both scoped definitions; ${detail.enrollments.filter((item) => item.status === 'active').length} active enrollment${detail.enrollments.filter((item) => item.status === 'active').length === 1 ? '' : 's'} appear below.` : 'This page will not claim a delivery state until the Worker can answer for both scopes.'}</span></div>}

      {isInPersonCutover && detail.runtime?.verified && <div className="automation-evidence-banner"><MessageSquareText size={17} /><span><strong>Delivery evidence is channel-specific.</strong> {activeInitialRuntime?.flow?.receiptCoverage?.sms === 'terminal_status_reconciled' ? (activeInitialRuntime.receiptHealth?.status === 'healthy' ? `SMS receipt reconciliation was healthy at ${exactTime(activeInitialRuntime.receiptHealth.checkedAt)} (${activeInitialRuntime.receiptHealth.recorded} new terminal outcome${activeInitialRuntime.receiptHealth.recorded === 1 ? '' : 's'}, ${activeInitialRuntime.receiptHealth.pending} still pending).` : activeInitialRuntime.receiptHealth?.status === 'degraded' ? `SMS receipt reconciliation was degraded at ${exactTime(activeInitialRuntime.receiptHealth.checkedAt)} with ${activeInitialRuntime.receiptHealth.errors} error${activeInitialRuntime.receiptHealth.errors === 1 ? '' : 's'}. Delivery evidence may be incomplete.` : 'SMS receipt reconciliation is configured, but no completed sweep can currently be proven.') : 'SMS receipt coverage is unavailable from the executing Worker.'} Email shows Gmail acceptance only; Gmail does not provide an affirmative recipient-delivery receipt.</span></div>}

      {family.cutoverTree && !isInPersonCutover && <CutoverTree tree={family.cutoverTree} />}

      {isInPersonCutover && focused && activeInitialRuntime?.definition && <section className="automation-detail-section" id="workflow-definition">
        <div className="automation-section-heading"><BookOpenCheck size={17} /><div><h3>How this reminder run works</h3><p>The canvas is the one readable view of the current published in-person definition.</p></div><b>1</b></div>
        <WorkflowPlaybookPreview workflow={activeInitialRuntime.definition} delivery={activeInitialRuntime.flow?.delivery || 'disabled'} activeEnrollments={activeEnrollments} tree={family.cutoverTree!} />
      </section>}

      {!isInPersonCutover && <section className="automation-detail-section" id="workflow-definition">
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

function CanonicalWorkflowView({ workflow, delivery }: { workflow: import('../types/staff').CanonicalWorkflow; delivery: 'active' | 'disabled' | 'unpublished' }) {
  const [draft, setDraft] = useState<import('../types/staff').CanonicalWorkflow | null>(null);
  const [dragged, setDragged] = useState<number | null>(null);
  const [status, setStatus] = useState('');
  const [saving, setSaving] = useState(false);
  const updateNode = (index: number, patch: Record<string, unknown>) => setDraft((current) => current ? ({ ...current, nodes: current.nodes.map((node, i) => i === index ? { ...node, ...patch } : node) }) : current);
  const updateMessage = (index: number, patch: Record<string, string>) => setDraft((current) => current ? ({ ...current, nodes: current.nodes.map((node, i) => i === index ? { ...node, message: { ...node.message, ...patch } } : node) }) : current);
  const drop = (event: DragEvent, target: number) => {
    event.preventDefault();
    if (dragged == null || dragged === target) return;
    setDraft((current) => {
      if (!current) return current;
      const nodes = [...current.nodes];
      const [node] = nodes.splice(dragged, 1);
      nodes.splice(target, 0, node);
      return { ...current, nodes };
    });
    setDragged(null);
  };
  const beginEdit = () => {
    setStatus('Draft changes do not affect running enrollments or send messages.');
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
    <header><span>{delivery === 'active' ? 'Published · live' : delivery === 'disabled' ? 'Published · disabled' : 'Not published'}</span><strong>{workflow.name}</strong><em>v{workflow.version}</em></header>
    <div className="canonical-workflow-controls">
      <p><strong>Published v{workflow.version} is the sender.</strong> The cards, copy, timing, and order below come from that exact document.</p>
      {!draft ? <button type="button" onClick={beginEdit}>Edit as draft v{workflow.version + 1}</button> : <><button type="button" disabled={saving} onClick={save}>Save draft</button><button className="is-publish" type="button" disabled={saving} onClick={publish}>Publish v{draft.version}</button><button type="button" disabled={saving} onClick={() => { setDraft(null); setStatus(''); }}>Discard draft</button></>}
      {status && <output>{status}</output>}
    </div>
    <div className="automation-definition-grid"><div><h4>Trigger</h4><pre>{structured(workflow.trigger)}</pre></div><div><h4>Exits</h4><pre>{structured(workflow.exits)}</pre></div></div>
    {!draft && <div className="automation-step-list canonical-workflow-tree">{workflow.nodes.map((node, index) => <div key={node.id}><span>{index + 1}</span><p><strong>{node.label}</strong><small>{node.at} · {humanize(node.action.type)} · <code>{node.id}</code></small></p></div>)}</div>}
    {draft && <div className="canonical-workflow-editor" aria-label={`Draft workflow version ${draft.version}`}>
      {draft.nodes.map((node, index) => <article key={node.id} draggable onDragStart={() => setDragged(index)} onDragOver={(event) => event.preventDefault()} onDrop={(event) => drop(event, index)}>
        <header><b>⋮⋮</b><span>{index + 1}</span><strong>{humanize(node.action.type)}</strong><code>{node.id}</code></header>
        <label>Step name<input value={node.label} onChange={(event) => updateNode(index, { label: event.target.value })} /></label>
        <label>Timing<input value={node.at} onChange={(event) => updateNode(index, { at: event.target.value })} /><small>Use <code>enroll</code> or <code>start-60m</code>.</small></label>
        {node.message.from !== undefined && <label>From<input value={node.message.from} onChange={(event) => updateMessage(index, { from: event.target.value })} /></label>}
        {node.message.subject !== undefined && <label>Subject<input value={node.message.subject} onChange={(event) => updateMessage(index, { subject: event.target.value })} /></label>}
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
