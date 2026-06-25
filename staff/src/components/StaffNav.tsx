import { useState } from 'react';
import { NavLink, useNavigate, useLocation } from 'react-router-dom';
import { Calendar, ListChecks, Users, MoreHorizontal, Sparkles, Wallet, TrendingUp, Kanban, BookOpen, X } from 'lucide-react';

const PRIMARY_NAV = [
  { to: '/', label: 'Today', Icon: Calendar, end: true },
  { to: '/follow-up', label: 'Work', Icon: ListChecks },
  { to: '/clients', label: 'Clients', Icon: Users },
];

const MORE_ITEMS = [
  { to: '/cos', label: 'Ask AI', Icon: Sparkles },
  { to: '/balances', label: 'Balances', Icon: Wallet },
  { to: '/funnel', label: 'Funnel', Icon: TrendingUp },
  { to: '/pipeline', label: 'Pipeline', Icon: Kanban },
  { to: '/playbook', label: 'Playbooks', Icon: BookOpen },
];

const MORE_PATHS = new Set(MORE_ITEMS.map((i) => i.to));

const linkClass = ({ isActive }: { isActive: boolean }) =>
  `flex-1 flex flex-col items-center gap-1 py-2.5 min-h-[44px] transition-colors ${
    isActive ? 'text-amari-charcoal' : 'text-amari-text-muted'
  }`;

export default function StaffNav() {
  const [moreOpen, setMoreOpen] = useState(false);
  const navigate = useNavigate();
  const location = useLocation();
  const moreActive = MORE_PATHS.has(location.pathname);

  function goTo(path: string) {
    setMoreOpen(false);
    navigate(path);
  }

  return (
    <>
      <nav className="fixed bottom-0 left-0 right-0 bg-white border-t border-amari-border safe-area-bottom z-50">
        <div className="flex">
          {PRIMARY_NAV.map(({ to, label, Icon, end }) => (
            <NavLink key={to} to={to} end={end} className={linkClass}>
              <Icon className="w-5 h-5" />
              <span className="text-[10px] font-medium">{label}</span>
            </NavLink>
          ))}
          <button
            onClick={() => setMoreOpen((v) => !v)}
            className={`flex-1 flex flex-col items-center gap-1 py-2.5 min-h-[44px] transition-colors ${
              moreActive || moreOpen ? 'text-amari-charcoal' : 'text-amari-text-muted'
            }`}
          >
            <MoreHorizontal className="w-5 h-5" />
            <span className="text-[10px] font-medium">More</span>
          </button>
        </div>
      </nav>

      {moreOpen && (
        <div
          className="fixed inset-0 z-40 flex flex-col justify-end"
          onClick={() => setMoreOpen(false)}
        >
          <div className="absolute inset-0 bg-black/30" />
          <div
            className="relative rounded-t-2xl bg-white pb-24 pt-4 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-4 mb-3">
              <span className="text-sm font-semibold text-amari-charcoal">More</span>
              <button onClick={() => setMoreOpen(false)} className="text-amari-text-muted p-1">
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="divide-y divide-amari-border">
              {MORE_ITEMS.map(({ to, label, Icon }) => (
                <button
                  key={to}
                  onClick={() => goTo(to)}
                  className={`flex w-full items-center gap-3 px-5 py-3.5 text-left transition-colors hover:bg-amari-light-sand ${
                    location.pathname === to ? 'text-amari-charcoal font-medium' : 'text-amari-charcoal'
                  }`}
                >
                  <Icon className="w-5 h-5 text-amari-text-muted shrink-0" />
                  <span className="text-sm">{label}</span>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
