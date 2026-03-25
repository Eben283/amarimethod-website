import { NavLink } from 'react-router-dom';
import { Calendar, Users } from 'lucide-react';

export default function StaffNav() {
  return (
    <nav className="fixed bottom-0 left-0 right-0 bg-white border-t border-amari-border safe-area-bottom z-50">
      <div className="flex">
        <NavLink
          to="/"
          end
          className={({ isActive }) =>
            `flex-1 flex flex-col items-center gap-1 py-3 min-h-[44px] transition-colors ${
              isActive ? 'text-amari-charcoal' : 'text-amari-text-muted'
            }`
          }
        >
          <Calendar className="w-5 h-5" />
          <span className="text-xs font-medium">Today</span>
        </NavLink>
        <NavLink
          to="/clients"
          className={({ isActive }) =>
            `flex-1 flex flex-col items-center gap-1 py-3 min-h-[44px] transition-colors ${
              isActive ? 'text-amari-charcoal' : 'text-amari-text-muted'
            }`
          }
        >
          <Users className="w-5 h-5" />
          <span className="text-xs font-medium">Clients</span>
        </NavLink>
      </div>
    </nav>
  );
}
