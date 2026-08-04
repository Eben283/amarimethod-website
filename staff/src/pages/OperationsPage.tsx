import { Activity, ChevronLeft, Database, Loader2, Workflow } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { getAutomationWatchAccessUrl, getCrmMirrorAccessUrl } from '../lib/api';

type OpsTab = 'systems' | 'crm' | 'automation';

const TABS: { id: OpsTab; label: string; detail: string; Icon: typeof Activity }[] = [
  { id: 'systems', label: 'Systems', detail: 'Paths · heartbeats · fix', Icon: Activity },
  { id: 'crm', label: 'CRM Mirror', detail: 'GHL + Stripe import', Icon: Database },
  { id: 'automation', label: 'Automation Watch', detail: 'Would-send vs GHL', Icon: Workflow },
];

const SYSTEMS_SRC = 'https://www.amarimethod.com/ops?embed=1';

function tabFromSearch(value: string | null): OpsTab {
  if (value === 'crm' || value === 'crm-mirror') return 'crm';
  if (value === 'automation' || value === 'automation-watch') return 'automation';
  return 'systems';
}

export default function OperationsPage() {
  const [params, setParams] = useSearchParams();
  const tab = tabFromSearch(params.get('tab'));
  const [crmSrc, setCrmSrc] = useState<string | null>(null);
  const [crmLoading, setCrmLoading] = useState(false);
  const [crmError, setCrmError] = useState<string | null>(null);
  const [automationSrc, setAutomationSrc] = useState<string | null>(null);
  const [automationLoading, setAutomationLoading] = useState(false);
  const [automationError, setAutomationError] = useState<string | null>(null);

  useEffect(() => {
    if (tab !== 'crm') return;
    if (crmSrc || crmLoading) return;
    let cancelled = false;
    setCrmLoading(true);
    setCrmError(null);
    void getCrmMirrorAccessUrl()
      .then(({ url }) => {
        if (cancelled) return;
        const joined = url.includes('?') ? `${url}&embed=1` : `${url}?embed=1`;
        setCrmSrc(joined);
      })
      .catch((err) => {
        if (cancelled) return;
        setCrmError(err instanceof Error ? err.message : 'Could not open CRM Mirror');
      })
      .finally(() => {
        if (!cancelled) setCrmLoading(false);
      });
    return () => { cancelled = true; };
  }, [tab, crmSrc, crmLoading]);

  useEffect(() => {
    if (tab !== 'automation') return;
    if (automationSrc || automationLoading) return;
    let cancelled = false;
    setAutomationLoading(true);
    setAutomationError(null);
    void getAutomationWatchAccessUrl()
      .then(({ url }) => {
        if (cancelled) return;
        const joined = url.includes('?') ? `${url}&embed=1` : `${url}?embed=1`;
        setAutomationSrc(joined);
      })
      .catch((err) => {
        if (cancelled) return;
        setAutomationError(err instanceof Error ? err.message : 'Could not open Automation Watch');
      })
      .finally(() => {
        if (!cancelled) setAutomationLoading(false);
      });
    return () => { cancelled = true; };
  }, [tab, automationSrc, automationLoading]);

  function selectTab(next: OpsTab) {
    setParams(next === 'systems' ? {} : { tab: next }, { replace: true });
  }

  const frameSrc = tab === 'systems' ? SYSTEMS_SRC : tab === 'automation' ? automationSrc : crmSrc;

  return (
    <main className="ops-hub">
      <header className="ops-hub__head">
        <Link to="/" className="ops-hub__back"><ChevronLeft aria-hidden="true" /> Staff home</Link>
        <div>
          <p>Operator surfaces</p>
          <h1>Operations</h1>
          <span>Systems, CRM mirror, and automation watch in one place.</span>
        </div>
      </header>

      <nav className="ops-hub__tabs" aria-label="Operator surfaces">
        {TABS.map(({ id, label, detail, Icon }) => (
          <button
            key={id}
            type="button"
            className={tab === id ? 'is-active' : undefined}
            aria-current={tab === id ? 'page' : undefined}
            onClick={() => selectTab(id)}
          >
            <Icon aria-hidden="true" />
            <span><strong>{label}</strong><small>{detail}</small></span>
          </button>
        ))}
      </nav>

      <section className="ops-hub__frame" aria-label={TABS.find((item) => item.id === tab)?.label}>
        {tab === 'crm' && crmLoading ? (
          <div className="ops-hub__status"><Loader2 className="animate-spin" aria-hidden="true" /> Opening protected CRM session…</div>
        ) : null}
        {tab === 'crm' && crmError ? (
          <div className="ops-hub__status ops-hub__status--error" role="alert">{crmError}</div>
        ) : null}
        {tab === 'automation' && automationLoading ? (
          <div className="ops-hub__status"><Loader2 className="animate-spin" aria-hidden="true" /> Opening protected Automation Watch…</div>
        ) : null}
        {tab === 'automation' && automationError ? (
          <div className="ops-hub__status ops-hub__status--error" role="alert">{automationError}</div>
        ) : null}
        {frameSrc ? (
          <iframe title={TABS.find((item) => item.id === tab)?.label} src={frameSrc} />
        ) : (tab === 'crm' && !crmLoading && !crmError) || (tab === 'automation' && !automationLoading && !automationError) ? (
          <div className="ops-hub__status">Loading…</div>
        ) : null}
      </section>
    </main>
  );
}
