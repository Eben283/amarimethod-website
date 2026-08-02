import { ArrowUpRight, BookOpen, CalendarDays, ChevronRight, ClipboardPlus, Database, FileText, Kanban, ListChecks, Loader2, MapPinned, RefreshCw, Sparkles, TrendingUp, Users, Wallet, Workflow, ShoppingBag } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { getDayData, getStaffRevenue } from '../lib/api';
import type { StaffRevenueData } from '../lib/api';
import type { TodayAppointment } from '../types/staff';

type HomeTool = {
  label: string;
  detail: string;
  Icon: typeof CalendarDays;
  to?: string;
  href?: string;
  tone: 'ink' | 'lake' | 'coral' | 'moss' | 'ochre' | 'violet';
};

const TOOLS: HomeTool[] = [
  { label: 'Today', detail: 'Schedule', Icon: CalendarDays, to: '/today', tone: 'ochre' },
  { label: 'Follow-Up', detail: 'Outreach', Icon: ListChecks, to: '/follow-up', tone: 'coral' },
  { label: 'Clients', detail: 'People', Icon: Users, to: '/clients', tone: 'lake' },
  { label: 'Ask Amari', detail: 'Chief of Staff', Icon: Sparkles, to: '/cos', tone: 'ink' },
  { label: 'Studies', detail: 'Sessions', Icon: ClipboardPlus, to: '/field-studies', tone: 'moss' },
  { label: 'Money', detail: 'Balances', Icon: Wallet, to: '/balances', tone: 'violet' },
  { label: 'Staff POS', detail: 'Draft checkout', Icon: ShoppingBag, to: '/pos', tone: 'ink' },
  { label: 'Funnel', detail: 'Lead flow', Icon: TrendingUp, to: '/funnel', tone: 'ochre' },
  { label: 'Pipeline', detail: 'Care flow', Icon: Kanban, to: '/pipeline', tone: 'lake' },
  { label: 'Playbooks', detail: 'Reference', Icon: BookOpen, to: '/playbook', tone: 'moss' },
];

const BACK_OFFICE = [
  { label: 'Community', detail: 'Field relationships', Icon: MapPinned, to: '/community' },
  { label: 'Automation Watch', detail: 'Message review', Icon: Workflow, href: 'https://reminder-engine.eben-fa2.workers.dev/dashboard' },
  { label: 'CRM Mirror', detail: 'Reconciliation', Icon: Database, href: 'https://amari-crm-mirror.eben-fa2.workers.dev/' },
];

type SessionDoor = { appointment: TodayAppointment; state: 'now' | 'next' };
const OFFSET_OR_Z = /([+-]\d{2}:?\d{2}|Z)$/i;
const NAIVE_DATETIME = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?/;

function pacificDate() {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Los_Angeles', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts();
  const value = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value || '';
  return `${value('year')}-${value('month')}-${value('day')}`;
}

function pacificWallClockAsUtc(ms: number) {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Los_Angeles', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }).formatToParts(new Date(ms));
  const value = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value || '0';
  return Date.UTC(+value('year'), +value('month') - 1, +value('day'), +value('hour') % 24, +value('minute'), +value('second'));
}

function appointmentMs(value: string) {
  if (!value) return NaN;
  if (OFFSET_OR_Z.test(value)) return new Date(value).getTime();
  const match = NAIVE_DATETIME.exec(value);
  if (!match) return NaN;
  const naiveAsUtc = Date.UTC(+match[1], +match[2] - 1, +match[3], +match[4], +match[5], +(match[6] || 0));
  let ms = naiveAsUtc - (pacificWallClockAsUtc(naiveAsUtc) - naiveAsUtc);
  ms = naiveAsUtc - (pacificWallClockAsUtc(ms) - ms);
  return ms;
}

function appointmentTime(iso: string) {
  return new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit', timeZone: 'America/Los_Angeles' }).format(new Date(appointmentMs(iso)));
}

const currency = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
const currencyExact = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2 });

function revenueMonthLabel(month: string) {
  return new Intl.DateTimeFormat('en-US', { month: 'short' }).format(new Date(`${month}-15T12:00:00Z`));
}

function revenuePath(trend: StaffRevenueData['trend']) {
  const width = 300;
  const height = 72;
  const peak = Math.max(...trend.map((point) => point.gross), 1);
  return trend.map((point, index) => {
    const x = trend.length === 1 ? width / 2 : (index / (trend.length - 1)) * width;
    const y = height - (point.gross / peak) * (height - 7) - 3;
    return `${index ? 'L' : 'M'} ${x.toFixed(2)} ${y.toFixed(2)}`;
  }).join(' ');
}

export default function HomePage() {
  const navigate = useNavigate();
  const [sessionDoor, setSessionDoor] = useState<SessionDoor | null>(null);
  const [sessionLoading, setSessionLoading] = useState(true);
  const [sessionError, setSessionError] = useState(false);
  const [revenue, setRevenue] = useState<StaffRevenueData | null>(null);
  const [revenueLoading, setRevenueLoading] = useState(true);
  const [revenueError, setRevenueError] = useState(false);

  const loadSessionDoor = useCallback(async () => {
    try {
      setSessionError(false);
      const appointments = await getDayData(pacificDate());
      const now = Date.now();
      const scheduled = appointments
        .filter((appointment) => appointment.appointmentStatus?.toLowerCase() !== 'cancelled')
        .sort((a, b) => appointmentMs(a.startTime) - appointmentMs(b.startTime));
      const current = scheduled.find((appointment) => appointmentMs(appointment.startTime) <= now && now < appointmentMs(appointment.endTime));
      const next = scheduled.find((appointment) => appointmentMs(appointment.startTime) > now);
      setSessionDoor(current ? { appointment: current, state: 'now' } : next ? { appointment: next, state: 'next' } : null);
      return current ? appointmentMs(current.endTime) : next ? appointmentMs(next.startTime) : now + 60_000;
    } catch {
      setSessionDoor(null);
      setSessionError(true);
      return Date.now() + 60_000;
    } finally {
      setSessionLoading(false);
    }
  }, []);

  useEffect(() => {
    let timer: number | undefined;
    let disposed = false;
    const refresh = async () => {
      const boundary = await loadSessionDoor();
      if (disposed) return;
      const delay = Math.max(10_000, boundary - Date.now() + 1_000);
      timer = window.setTimeout(() => { void refresh(); }, delay);
    };
    const onVisible = () => {
      if (document.visibilityState !== 'visible') return;
      if (timer) window.clearTimeout(timer);
      setSessionLoading(true);
      void refresh();
    };
    void refresh();
    document.addEventListener('visibilitychange', onVisible);
    return () => { disposed = true; if (timer) window.clearTimeout(timer); document.removeEventListener('visibilitychange', onVisible); };
  }, [loadSessionDoor]);

  const loadRevenue = useCallback(async () => {
    try {
      setRevenueError(false);
      setRevenue(await getStaffRevenue());
    } catch {
      setRevenueError(true);
    } finally {
      setRevenueLoading(false);
    }
  }, []);

  useEffect(() => { void loadRevenue(); }, [loadRevenue]);

  function open(tool: HomeTool) {
    if (tool.to) navigate(tool.to);
    if (tool.href) window.location.assign(tool.href);
  }

  function openBackOffice(tool: typeof BACK_OFFICE[number]) {
    if ('to' in tool && tool.to) navigate(tool.to);
    if ('href' in tool && tool.href) window.location.assign(tool.href);
  }

  return (
    <main className="staff-home">
      <header className="staff-home__masthead">
        <div className="staff-home__wordmark">
          <i aria-hidden="true" />
          <span>Amari Method</span>
        </div>
        <h1>Operations</h1>
        <p>Choose a work area.</p>
      </header>

      <section className="staff-session-door" aria-label="Session access">
        {sessionLoading ? (
          <div className="staff-session-door__loading"><Loader2 aria-hidden="true" /> Finding today’s session…</div>
        ) : sessionError ? (
          <button type="button" onClick={() => { setSessionLoading(true); void loadSessionDoor(); }}>
            <span className="staff-session-door__signal staff-session-door__signal--error"><i aria-hidden="true" /> Schedule unavailable</span>
            <span className="staff-session-door__person">Couldn’t load today’s session</span>
            <span className="staff-session-door__meta">Tap to try again <ChevronRight aria-hidden="true" /></span>
          </button>
        ) : sessionDoor ? (
          <button type="button" onClick={() => navigate(`/client/${sessionDoor.appointment.contactId}?appointment=${sessionDoor.appointment.id}`)}>
            <span className={`staff-session-door__signal staff-session-door__signal--${sessionDoor.state}`}>
              <i aria-hidden="true" /> {sessionDoor.state === 'now' ? 'In session now' : 'Next session'}
            </span>
            <span className="staff-session-door__person">{sessionDoor.appointment.contactName}</span>
            <span className="staff-session-door__meta">
              {sessionDoor.state === 'now' ? 'Open the session view' : `${appointmentTime(sessionDoor.appointment.startTime)} · Open session view`}
              <ChevronRight aria-hidden="true" />
            </span>
          </button>
        ) : (
          <button type="button" onClick={() => navigate('/today')}>
            <span className="staff-session-door__signal"><i aria-hidden="true" /> No session queued</span>
            <span className="staff-session-door__person">Open today’s schedule</span>
            <span className="staff-session-door__meta">Find the next client <ChevronRight aria-hidden="true" /></span>
          </button>
        )}
      </section>

      <section className="staff-revenue" aria-label="Stripe revenue">
        {revenueLoading ? (
          <div className="staff-revenue__loading"><Loader2 aria-hidden="true" /> Loading Stripe revenue…</div>
        ) : revenueError ? (
          <button type="button" className="staff-revenue__retry" onClick={() => { setRevenueLoading(true); void loadRevenue(); }}>
            <span>Stripe revenue is unavailable</span>
            <small>Tap to try again <RefreshCw aria-hidden="true" /></small>
          </button>
        ) : revenue && (
          <>
            <div className="staff-revenue__summary">
              <div>
                <p>Stripe revenue</p>
                <strong>{currency.format(revenue.thisMonth.gross)}</strong>
                <span>{revenueMonthLabel(revenue.thisMonth.month)} gross · {revenue.thisMonth.chargeCount} successful {revenue.thisMonth.chargeCount === 1 ? 'charge' : 'charges'}</span>
              </div>
              <dl>
                <div><dt>Fees</dt><dd>{currencyExact.format(revenue.thisMonth.fees)}</dd></div>
                <div><dt>Net</dt><dd>{currencyExact.format(revenue.thisMonth.net)}</dd></div>
              </dl>
            </div>
            <div className="staff-revenue__chart">
              <svg viewBox="0 0 300 72" role="img" aria-label={`Six-month Stripe gross-sales trend ending ${revenueMonthLabel(revenue.thisMonth.month)}`} preserveAspectRatio="none">
                <path className="staff-revenue__baseline" d="M 0 69 H 300" />
                <path className="staff-revenue__line" d={revenuePath(revenue.trend)} />
                {revenue.trend.map((point, index) => {
                  const peak = Math.max(...revenue.trend.map((item) => item.gross), 1);
                  const x = revenue.trend.length === 1 ? 150 : (index / (revenue.trend.length - 1)) * 300;
                  const y = 72 - (point.gross / peak) * 65 - 3;
                  return <circle key={point.month} cx={x} cy={y} r="3" tabIndex={0}><title>{`${revenueMonthLabel(point.month)}: ${currencyExact.format(point.gross)} gross`}</title></circle>;
                })}
              </svg>
              <div className="staff-revenue__months" aria-hidden="true">
                {revenue.trend.map((point) => <span key={point.month}>{revenueMonthLabel(point.month)}</span>)}
              </div>
            </div>
          </>
        )}
      </section>

      <section aria-label="Amari tools" className="staff-home__tools">
        {TOOLS.map((tool) => {
          const { Icon } = tool;
          return (
            <button
              key={tool.label}
              type="button"
              onClick={() => open(tool)}
              className={`staff-home-tool staff-home-tool--${tool.tone}`}
            >
              <span className="staff-home-tool__face"><Icon aria-hidden="true" /></span>
              <span className="staff-home-tool__copy">
                <span className="staff-home-tool__label">{tool.label}</span>
                <span className="staff-home-tool__detail">{tool.detail}</span>
              </span>
              {tool.href && <ArrowUpRight className="staff-home-tool__outbound" aria-label="Opens outside Staff" />}
            </button>
          );
        })}
      </section>

      <section className="staff-backoffice" aria-label="Back office dashboards">
        <header>
          <p>Back office</p>
          <span>Operator dashboards</span>
        </header>
        <div className="staff-backoffice__links">
          {BACK_OFFICE.map((tool) => {
            const { label, detail, Icon } = tool;
            return <button key={label} type="button" onClick={() => openBackOffice(tool)}>
              <span className="staff-backoffice__icon"><Icon aria-hidden="true" /></span>
              <span className="staff-backoffice__copy"><strong>{label}</strong><small>{detail}</small></span>
              {tool.href ? <ArrowUpRight aria-hidden="true" /> : <ChevronRight aria-hidden="true" />}
            </button>;
          })}
        </div>
      </section>

      <section className="staff-resources" aria-label="Staff resources">
        <header>
          <p>Resources</p>
          <span>Reference materials</span>
        </header>
        <a href="/staff/resources/garrett-amari-practice-sales-worksheet.pdf" target="_blank" rel="noreferrer">
          <span className="staff-resources__icon"><FileText aria-hidden="true" /></span>
          <span className="staff-resources__copy"><strong>$5,500 Amari Practice Sales Worksheet</strong><small>PDF · opens in a new tab</small></span>
          <ArrowUpRight aria-hidden="true" />
        </a>
      </section>

    </main>
  );
}
