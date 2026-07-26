import { NavLink } from 'react-router-dom';
import { Calendar, House, ListChecks, Users } from 'lucide-react';

// The launcher is the operating-system home. The footer keeps only the four
// places that are useful mid-task, including a reliable route back home.
const NAV = [
  { to: '/', label: 'Home', Icon: House, end: true },
  { to: '/today', label: 'Today', Icon: Calendar },
  { to: '/follow-up', label: 'Follow-Up', Icon: ListChecks },
  { to: '/clients', label: 'Clients', Icon: Users },
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
