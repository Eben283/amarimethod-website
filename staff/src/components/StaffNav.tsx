import { NavLink } from 'react-router-dom';
import { Calendar, Users, MessageSquare, Wallet, BookOpen, Handshake, Sparkles, TrendingUp } from 'lucide-react';

const linkClass = ({ isActive }: { isActive: boolean }) =>
  `flex-1 flex flex-col items-center gap-1 py-3 min-h-[44px] transition-colors ${
    isActive ? 'text-amari-charcoal' : 'text-amari-text-muted'
  }`;

export default function StaffNav() {
  return (
    <nav className="fixed bottom-0 left-0 right-0 bg-white border-t border-amari-border safe-area-bottom z-50">
      <div className="flex">
        <NavLink to="/" end className={linkClass}>
          <Calendar className="w-5 h-5" />
          <span className="text-xs font-medium">Schedule</span>
        </NavLink>
        <NavLink to="/cos" className={linkClass}>
          <Sparkles className="w-5 h-5" />
          <span className="text-xs font-medium">Ask</span>
        </NavLink>
        <NavLink to="/messages" className={linkClass}>
          <MessageSquare className="w-5 h-5" />
          <span className="text-xs font-medium">Messages</span>
        </NavLink>
        <NavLink to="/outreach" className={linkClass}>
          <Handshake className="w-5 h-5" />
          <span className="text-xs font-medium">Outreach</span>
        </NavLink>
        <NavLink to="/funnel" className={linkClass}>
          <TrendingUp className="w-5 h-5" />
          <span className="text-xs font-medium">Funnel</span>
        </NavLink>
        <NavLink to="/balances" className={linkClass}>
          <Wallet className="w-5 h-5" />
          <span className="text-xs font-medium">Balances</span>
        </NavLink>
        <NavLink to="/clients" className={linkClass}>
          <Users className="w-5 h-5" />
          <span className="text-xs font-medium">Clients</span>
        </NavLink>
        <NavLink to="/playbook" className={linkClass}>
          <BookOpen className="w-5 h-5" />
          <span className="text-xs font-medium">Playbooks</span>
        </NavLink>
      </div>
    </nav>
  );
}
