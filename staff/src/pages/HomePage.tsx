import { ArrowUpRight, BookOpen, CalendarDays, ClipboardPlus, Kanban, ListChecks, PenLine, Sparkles, TrendingUp, Users, Wallet, Workflow } from 'lucide-react';
import { useNavigate } from 'react-router-dom';

type HomeTool = {
  label: string;
  detail: string;
  Icon: typeof CalendarDays;
  to?: string;
  href?: string;
  tone: 'charcoal' | 'teal' | 'apricot';
};

const TOOLS: HomeTool[] = [
  { label: 'Today', detail: 'Schedule and session work', Icon: CalendarDays, to: '/today', tone: 'charcoal' },
  { label: 'Follow-Up', detail: 'Personal client outreach', Icon: ListChecks, to: '/follow-up', tone: 'teal' },
  { label: 'Clients', detail: 'People and session history', Icon: Users, to: '/clients', tone: 'charcoal' },
  { label: 'Studies', detail: 'Field-study sessions', Icon: ClipboardPlus, to: '/field-studies', tone: 'apricot' },
  { label: 'Automations', detail: 'Shadow watch and timing', Icon: Workflow, href: 'https://reminder-engine.eben-fa2.workers.dev/dashboard', tone: 'teal' },
  { label: 'Ask Amari', detail: 'Chief of Staff', Icon: Sparkles, to: '/cos', tone: 'apricot' },
  { label: 'Money', detail: 'Balances and payments', Icon: Wallet, to: '/balances', tone: 'charcoal' },
  { label: 'Funnel', detail: 'Lead flow overview', Icon: TrendingUp, to: '/funnel', tone: 'teal' },
  { label: 'Pipeline', detail: 'People moving through care', Icon: Kanban, to: '/pipeline', tone: 'charcoal' },
  { label: 'Write', detail: 'Voice-guided drafts', Icon: PenLine, to: '/write', tone: 'apricot' },
  { label: 'Playbooks', detail: 'Practice reference', Icon: BookOpen, to: '/playbook', tone: 'teal' },
];

export default function HomePage() {
  const navigate = useNavigate();

  function open(tool: HomeTool) {
    if (tool.to) navigate(tool.to);
    if (tool.href) window.location.assign(tool.href);
  }

  return (
    <main className="staff-home px-5 pt-7 pb-6">
      <header className="mb-8">
        <p className="staff-mlabel mb-2">Amari Method</p>
        <h1 className="text-[2.1rem] leading-none text-amari-charcoal">Home</h1>
        <p className="mt-3 max-w-[31ch] text-sm leading-6 text-amari-text-secondary">
          Open the part of the practice you need to run right now.
        </p>
      </header>

      <section aria-label="Amari tools" className="grid grid-cols-2 gap-3">
        {TOOLS.map((tool) => {
          const { Icon } = tool;
          return (
            <button
              key={tool.label}
              type="button"
              onClick={() => open(tool)}
              className={`staff-home-tool staff-home-tool--${tool.tone}`}
            >
              <span className="staff-home-tool__icon"><Icon aria-hidden="true" /></span>
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
