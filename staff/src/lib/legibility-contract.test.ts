import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';

const sourceRoot = join(dirname(fileURLToPath(import.meta.url)), '..');

function css(path: string) {
  return readFileSync(join(sourceRoot, path), 'utf8');
}

function token(source: string, name: string) {
  const value = source.match(new RegExp(`--${name}:\\s*(#[0-9a-fA-F]{6})\\s*;`))?.[1];
  if (!value) throw new Error(`Missing Staff legibility token --${name}`);
  return value;
}

function relativeLuminance(hex: string) {
  const channels = hex.slice(1).match(/.{2}/g)!.map((part) => {
    const value = Number.parseInt(part, 16) / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
}

function contrast(foreground: string, background: string) {
  const first = relativeLuminance(foreground);
  const second = relativeLuminance(background);
  return (Math.max(first, second) + 0.05) / (Math.min(first, second) + 0.05);
}

describe('Staff legibility contract', () => {
  const globalCss = css('index.css');

  it('keeps every working text role at WCAG AA contrast', () => {
    const paper = token(globalCss, 'staff-paper');
    const sheet = token(globalCss, 'staff-sheet');
    const ink = token(globalCss, 'staff-ink');
    const body = token(globalCss, 'staff-body');
    const muted = token(globalCss, 'staff-muted');
    const active = token(globalCss, 'staff-active');

    expect(contrast(ink, paper)).toBeGreaterThanOrEqual(7);
    expect(contrast(body, paper)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(muted, paper)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(body, sheet)).toBeGreaterThanOrEqual(4.5);
    expect(contrast('#FFFFFF', active)).toBeGreaterThanOrEqual(4.5);
  });

  it('uses the shared visual roles in the shell and member workspace', () => {
    const shell = css('styles/staff-shell.css');
    const member = css('styles/session-a.css');

    for (const required of ['var(--staff-paper)', 'var(--staff-ink)', 'var(--staff-line)', 'var(--staff-active)']) {
      expect(shell).toContain(required);
      expect(member).toContain(required);
    }
  });

  it('does not render core navigation or member-record text below 12px', () => {
    for (const path of ['styles/staff-shell.css', 'styles/session-a.css']) {
      const undersized = [...css(path).matchAll(/font-size:\s*(\d+(?:\.\d+)?)px/g)]
        .map((match) => Number(match[1]))
        .filter((size) => size < 12);
      expect(undersized, `${path} contains undersized text`).toEqual([]);
    }
  });

  it('keeps automation maps and run evidence at the 16px readable-text floor', () => {
    const workflow = css('pages/AutomationWorkflowCanvas.css');
    const registry = css('pages/AutomationRegistryPage.css');

    expect(globalCss).toContain('--staff-readable-min: 1rem;');
    expect(registry).toContain('strong,b,em,i,time,dt,dd,label,input,textarea,select,button,a,code,pre,output,li,th,td,legend,figcaption,footer');
    expect(registry).toContain('font-size:var(--staff-readable-min)!important');
    expect(registry).toContain('.automation-person-columns');
    expect(workflow).toContain('font-size:var(--staff-readable-min)!important');
    expect(workflow).toContain('.automation-master-map.is-selected-view .automation-playbook-preview-grid');
    expect(workflow).toContain('position:sticky');
  });

  it('renders one stable workflow map without squeezing three actions into narrow cards', () => {
    const app = css('App.tsx');
    const registryPage = css('pages/AutomationRegistryPage.tsx');
    const workflow = css('pages/AutomationWorkflowCanvas.css');

    expect(app).toContain("import './pages/AutomationWorkflowCanvas.css';");
    expect(registryPage).not.toContain("import './AutomationWorkflowCanvas.css';");
    expect(registryPage).not.toContain('const first = response.families.find');
    expect(registryPage).toContain('detailReady={familyDetail?.family.key === selectedFamilyKey && !familyLoading}');
    expect(registryPage).toContain('Opening one verified workflow view…');
    expect(workflow).toContain('.automation-master-map.is-selected-view .automation-playbook-parallel.is-3{grid-template-columns:1fr');
  });

  it('counts automation families from live registry data and exposes the Morning SMS node map', () => {
    const registryPage = css('pages/AutomationRegistryPage.tsx');

    expect(registryPage).toContain("'morning-staff-sms': 'Morning SMS to Eben and Garrett'");
    expect(registryPage).toContain("const isMorningSms = family.key === 'morning-staff-sms'");
    expect(registryPage).toContain("families.filter((family) => family.kind === 'operational').length");
    expect(registryPage).not.toContain('Master map · 24 automations');
    expect(registryPage).not.toContain('The 24 named automations');
  });

  it('renders a selected source-backed node map only once', () => {
    const registryPage = css('pages/AutomationRegistryPage.tsx');

    expect(registryPage).not.toContain("family.cutoverTree && !isInPersonCutover && !isFollowUpSourceMap");
  });

  it('places the Follow-Up durability contract inside the executable route', () => {
    const registryPage = css('pages/AutomationRegistryPage.tsx');
    expect(registryPage).toContain('reliability?.route.accepted');
    expect(registryPage).toContain('Durable transition · ${stage.transition}');
    expect(registryPage).toContain('Durability exception path');
    expect(registryPage).toContain('stops before reminder enrollment');
  });

  it('keeps review-worthy automation evidence reachable without restoring the full event wall', () => {
    const record = css('pages/ClientDetailPage.tsx');
    expect(record).toContain('failedAutomationEvents.slice(0, 3)');
    expect(record).toContain('Open the automation for its definition and complete run evidence.');
    expect(record).toContain('automationDrilldownPath(familyKey, ownedPersonId)');
    expect(record).not.toContain('Recent events and outcomes');
  });

  it('keeps staff development in one Training workspace instead of the Calendar', () => {
    const app = css('App.tsx');
    const shell = css('components/StaffShell.tsx');
    const calendar = css('pages/TodayPage.tsx');
    const training = css('pages/TrainingPage.tsx');

    expect(app).toContain('path="training"');
    expect(app).toContain('to="/training?section=sharpen"');
    expect(app).toContain('to="/training?section=playbooks"');
    expect(shell).toContain("label: 'Training'");
    expect(calendar).not.toContain('SharpenDeck');
    expect(training).toContain('<SharpenDeck />');
    expect(training).toContain('<PlaybookPage embedded activeTab={playbook} onTabChange={choosePlaybook} />');
    expect(training).toContain('Playbooks & scripts');
    expect(training).toContain('Reference');
    expect(training).toContain('/staff/resources/garrett-amari-practice-sales-worksheet.pdf');
    expect(training).toContain('50-minute Assessment conversation and decision worksheet');
    expect(training).toContain('/api/staff-media-file?id=4ff6f253-239b-455c-a986-2199dc6b1580');
    expect(training).toContain('ACQ Closer Handbook — original');
    expect(training).toContain('/staff/resources/amari-sales-scripts-and-hormozi-closer-handbook-sections.pdf');
    expect(training).toContain('Sales scripts');
    expect(training).not.toContain('stale 40-minute Assessment reference');
  });

  it('returns an expired Staff session to the exact OAuth callback result after PIN login', () => {
    const app = css('App.tsx');
    expect(app).toContain('state={{ returnTo: `${location.pathname}${location.search}` }}');
    expect(app).toContain("requested.startsWith('/') && !requested.startsWith('//') && !requested.startsWith('/login')");
    expect(app).toContain('<Navigate to={returnTo} replace />');
  });

  it('keeps wrong-email investigation out of the daily Home workboard', () => {
    const home = css('pages/HomePage.tsx');
    expect(home).not.toContain('Someone received the wrong automated email?');
    expect(home).not.toContain('Find the person and email');
    expect(home).not.toContain('home-incident-path');
  });

  it('contains the member workspace inside a phone viewport', () => {
    const member = css('styles/session-a.css');
    expect(member).toContain('max-width:100%; overflow-x:clip');
    expect(member).not.toContain('margin-right:-16px');
    expect(member).toContain('.sa-head,.sa-body{min-width:0; max-width:100%;}');
  });

  it('lets desktop Staff workspaces reclaim the navigation rail', () => {
    const shell = css('components/StaffShell.tsx');
    const shellCss = css('styles/staff-shell.css');
    expect(shell).toContain("localStorage.getItem('amari-staff-rail-collapsed')");
    expect(shell).toContain('Collapse Staff navigation');
    expect(shellCss).toContain('.staff-shell.is-rail-collapsed .staff-shell__main { margin-left: 68px; }');
  });

  it('gives every protected desktop frame the compact working treatment', () => {
    const operations = css('pages/OperationsPage.tsx');
    const global = css('index.css');
    expect(operations).toContain("ops-hub${tab !== 'overview' ? ' ops-hub--framed' : ''}");
    expect(global).toContain('.ops-hub--framed { display:grid; min-height:100dvh; grid-template-rows:50px 52px minmax(0,1fr); }');
    expect(global).toContain('.ops-hub--framed .ops-hub__frame iframe { height:100%; min-height:0; }');
  });

  it('keeps the operations ledger native, bounded, and metadata-only', () => {
    const operations = css('pages/OperationsPage.tsx');
    const api = css('lib/api.ts');
    for (const label of ['Activity', 'Changes', 'Incidents']) expect(operations).toContain(`label: '${label}'`);
    expect(operations).toContain('getOpsLedger');
    expect(operations).toContain('Activity by task');
    expect(operations).toContain('From');
    expect(operations).toContain('To');
    expect(operations).toContain('Requested by');
    expect(operations).toContain('Customer names, contact IDs, message content');
    expect(api).toContain("return fetchApi('/ops/ledger')");
  });

  it('opens an attention reply on the selected person', () => {
    const home = css('pages/HomePage.tsx');
    expect(home).toContain("`/client-desk?contact=${encodeURIComponent(reply.contactId)}`");
  });

  it('keeps specialist study execution out of the administrative Member Record', () => {
    const record = css('pages/ClientDetailPage.tsx');
    expect(record).not.toContain('StudyCapturePanel');
    expect(record).not.toContain('Specialist study record');
  });

  it('does not expose legacy founding-member payment links from a member record', () => {
    const record = css('pages/ClientDetailPage.tsx');
    for (const retired of ['8-session-series', '4-session-series', 'upgrade-initial-to-4', 'upgrade-initial-to-8', 'upgrade-4-to-8']) {
      expect(record).not.toContain(retired);
    }
    expect(record).toContain('Founding-member purchases are handled directly by Eben or Garrett.');
  });

  it('gives Calendar icon controls names', () => {
    const calendar = css('pages/TodayPage.tsx');
    expect(calendar).toContain('aria-label="Refresh calendar"');
    expect(calendar).toContain('aria-label="Previous period"');
    expect(calendar).toContain('aria-label="Next period"');
  });

  it('renders only the selected family executable definition and labels diagrams honestly', () => {
    const registryPage = css('pages/AutomationRegistryPage.tsx');
    expect(registryPage).toContain('MorningWorkflowCanvas');
    expect(registryPage).toContain("family.mapAuthority === 'executable_definition'");
    expect(registryPage).toContain('Executable map');
    expect(registryPage).toContain('Verified operating diagram');
    expect(registryPage).not.toContain('runtimes.some((runtime) => runtime.definition)\n        ? <InitialWorkflowCanvas');
  });

  it('shows the complete dynamic Morning SMS contract instead of only the agenda token', () => {
    const registryPage = css('pages/AutomationRegistryPage.tsx');
    const inspection = css('lib/morningWorkflowInspection.ts');

    expect(registryPage).toContain('How this node actually works');
    expect(registryPage).toContain('inspection.exactCopy');
    expect(registryPage).toContain('inspection.variants.map');
    expect(inspection).toContain('Exact dynamic SMS sent to Eben and Garrett');
    expect(inspection).toContain('definition.agendaCopy');
  });

  it('renders reminder maps from every canonical runtime node without stale hand-drawn paths', () => {
    const registryPage = css('pages/AutomationRegistryPage.tsx');

    expect(registryPage).toContain('family.runtimeFlowKeys.includes(runtime.flow?.key || runtime.definition.id)');
    expect(registryPage).toContain('workflow.nodes.forEach((node) =>');
    expect(registryPage).toContain('workflow.exits.map((exit, index) =>');
    expect(registryPage).toContain('node.when');
    expect(registryPage).not.toContain('function FollowUpGhlWorkflowCanvas');
    expect(registryPage).not.toContain('Staged, not sending.');
    expect(registryPage).not.toContain('GHL owns this whole live reminder path');
    expect(registryPage).not.toContain('GHL queue snapshot · Aug. 11');
    expect(registryPage).not.toContain("id: 'wait-day-before'");
    expect(registryPage).not.toContain("id: 'wait-one-hour'");
  });
});
