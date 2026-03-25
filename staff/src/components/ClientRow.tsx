import { ChevronRight } from 'lucide-react';
import type { ContactListItem } from '../types/staff';

interface Props {
  contact: ContactListItem;
  onTap: () => void;
}

export default function ClientRow({ contact, onTap }: Props) {
  const lastVisit = contact.lastAppointment
    ? new Date(contact.lastAppointment).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
    : null;

  return (
    <button
      onClick={onTap}
      className="staff-card-tap w-full text-left flex items-center gap-3"
    >
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-amari-charcoal truncate">{contact.name}</p>
        <div className="flex items-center gap-2 mt-0.5">
          {lastVisit && (
            <span className="text-xs text-amari-text-muted">Last: {lastVisit}</span>
          )}
          {contact.seriesType !== 'none' && contact.sessionsRemaining > 0 && (
            <span className="text-xs text-amari-text-muted">
              {contact.sessionsRemaining} sessions left
            </span>
          )}
        </div>
      </div>
      <ChevronRight className="w-4 h-4 text-amari-text-muted flex-shrink-0" />
    </button>
  );
}
