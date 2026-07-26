import { ArrowUpRight, BookOpen, CalendarDays, ClipboardPlus, Kanban, ListChecks, PenLine, Sparkles, TrendingUp, Users, Wallet, Workflow } from 'lucide-react';
import { useNavigate } from 'react-router-dom';

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
  { label: 'Funnel', detail: 'Lead flow', Icon: TrendingUp, to: '/funnel', tone: 'ochre' },
  { label: 'Pipeline', detail: 'Care flow', Icon: Kanban, to: '/pipeline', tone: 'lake' },
  { label: 'Automations', detail: 'Message watch', Icon: Workflow, href: 'https://reminder-engine.eben-fa2.workers.dev/dashboard', tone: 'ink' },
  { label: 'Write', detail: 'Drafts', Icon: PenLine, to: '/write', tone: 'coral' },
  { label: 'Playbooks', detail: 'Reference', Icon: BookOpen, to: '/playbook', tone: 'moss' },
];

export default function HomePage() {
  const navigate = useNavigate();

  function open(tool: HomeTool) {
    if (tool.to) navigate(tool.to);
    if (tool.href) window.location.assign(tool.href);
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

    </main>
  );
}
