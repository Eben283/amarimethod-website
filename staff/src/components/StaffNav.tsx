import { useState } from 'react';
import { NavLink, useNavigate, useLocation } from 'react-router-dom';
import {
  Calendar, Users, MessageSquare, Wallet, MoreHorizontal,
  Handshake, Sparkles, TrendingUp, BookOpen, ListChecks,
} from 'lucide-react';

// Bottom nav caps at 5 primary items (more than that and the labels cramp on a
// phone). The day-of practice tools stay in the bar; the periodic ops/growth
// tools live one tap deeper in the "More" sheet.
const itemClass =
  'flex-1 flex flex-col items-center gap-1 py-3 min-h-[44px] transition-colors';

const linkClass = ({ isActive }: { isActive: boolean }) =>
  `${itemClass} ${isActive ? 'text-amari-charcoal' : 'text-amari-text-muted'}`;

const MORE_ITEMS = [
  { to: '/cos', label: 'Ask', Icon: Sparkles },
  { to: '/follow-up', label: 'Follow-Up', Icon: ListChecks },
  { to: '/outreach', label: 'Outreach', Icon: Handshake },
  { to: '/funnel', label: 'Funnel', Icon: TrendingUp },
  { to: '/playbook', label: 'Playbooks', Icon: BookOpen },
];

export default function StaffNav() {
  const [moreOpen, setMoreOpen] = useState(false);
  const location = useLocation();
  const navigate = useNavigate();

  // Light up "More" whenever the current route lives inside the sheet.
  const moreActive = MORE_ITEMS.some((i) => location.pathname.startsWith(i.to));

  const go = (to: string) => {
    setMoreOpen(false);
    navigate(to);
  };

  return (
    <>
      {moreOpen && (
        <div className="fixed inset-0 z-40 bg-black/30" onClick={() => setMoreOpen(false)}>
          <div
            className="absolute bottom-[60px] left-0 right-0 rounded-t-2xl border-t border-amari-border bg-white p-2 safe-area-bottom"
            onClick={(e) => e.stopPropagation()}
          >
            {MORE_ITEMS.map(({ to, label, Icon }) => {
              const active = location.pathname.startsWith(to);
              return (
                <button
                  key={to}
                  onClick={() => go(to)}
                  className={`flex w-full items-center gap-3 rounded-xl px-4 py-3 text-left min-h-[44px] ${
                    active ? 'bg-amari-light-sand text-amari-charcoal' : 'text-amari-charcoal'
                  }`}
                >
                  <Icon className="h-5 w-5 text-amari-text-muted" />
                  <span className="text-sm font-medium">{label}</span>
                </button>
              );
            })}
          </div>
        </div>
      )}

      <nav className="fixed bottom-0 left-0 right-0 bg-white border-t border-amari-border safe-area-bottom z-50">
        <div className="flex">
          <NavLink to="/" end className={linkClass}>
            <Calendar className="w-5 h-5" />
            <span className="text-xs font-medium">Schedule</span>
          </NavLink>
          <NavLink to="/messages" className={linkClass}>
            <MessageSquare className="w-5 h-5" />
            <span className="text-xs font-medium">Messages</span>
          </NavLink>
          <NavLink to="/clients" className={linkClass}>
            <Users className="w-5 h-5" />
            <span className="text-xs font-medium">Clients</span>
          </NavLink>
          <NavLink to="/balances" className={linkClass}>
            <Wallet className="w-5 h-5" />
            <span className="text-xs font-medium">Balances</span>
          </NavLink>
          <button
            type="button"
            onClick={() => setMoreOpen((o) => !o)}
            className={`${itemClass} ${moreActive || moreOpen ? 'text-amari-charcoal' : 'text-amari-text-muted'}`}
          >
            <MoreHorizontal className="w-5 h-5" />
            <span className="text-xs font-medium">More</span>
          </button>
        </div>
      </nav>
    </>
  );
}
