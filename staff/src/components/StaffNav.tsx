import { NavLink } from 'react-router-dom';
import { Calendar, ListChecks, Users, Wallet, TrendingUp, Sparkles, BookOpen } from 'lucide-react';

// Flat bottom nav — every staff surface lives in the footer. Messages + Outreach
// were retired into Follow-Up (2026-06-13), which freed the room to drop the
// "More" sheet and put everything one tap away.
const NAV = [
  { to: '/', label: 'Schedule', Icon: Calendar, end: true },
  { to: '/follow-up', label: 'Follow-Up', Icon: ListChecks },
  { to: '/clients', label: 'Clients', Icon: Users },
  { to: '/balances', label: 'Balances', Icon: Wallet },
  { to: '/funnel', label: 'Funnel', Icon: TrendingUp },
  { to: '/cos', label: 'Ask', Icon: Sparkles },
  { to: '/playbook', label: 'Playbooks', Icon: BookOpen },
];

const linkClass = ({ isActive }: { isActive: boolean }) =>
  `flex-1 flex flex-col items-center gap-1 py-2.5 min-h-[44px] transition-colors ${
    isActive ? 'text-amari-charcoal' : 'text-amari-text-muted'
  }`;

export default function StaffNav() {
  return (
    <nav className="fixed bottom-0 left-0 right-0 bg-white border-t border-amari-border safe-area-bottom z-50">
      <div className="flex">
        {NAV.map(({ to, label, Icon, end }) => (
          <NavLink key={to} to={to} end={end} className={linkClass}>
            <Icon className="w-5 h-5" />
            <span className="text-[10px] font-medium">{label}</span>
          </NavLink>
        ))}
      </div>
    </nav>
  );
}
