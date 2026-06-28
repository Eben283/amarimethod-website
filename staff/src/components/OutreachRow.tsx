import { ChevronRight, AlertTriangle, Clock, Snowflake, CalendarClock, RefreshCcw, CheckCircle2, Wrench, UserPlus, HandHeart } from 'lucide-react';
import type { OutreachCard, OutreachStatus } from '../types/staff';

interface Props {
  card: OutreachCard;
  onTap: () => void;
}

// Visual treatment per status. Border accent + icon. Mirrors the existing
// `border-l-amari-accent-warm` pattern used by needs-reply rows.
const STATUS_STYLE: Record<OutreachStatus, { accent: string; Icon: typeof AlertTriangle }> = {
  'referral-never-booked':        { accent: 'border-l-purple-500', Icon: UserPlus },
  'cancellation-not-followed-up': { accent: 'border-l-red-500', Icon: AlertTriangle },
  'pre-session-text-owed':        { accent: 'border-l-amari-accent-warm', Icon: CalendarClock },
  'next-booking-owed':            { accent: 'border-l-amari-pine-teal', Icon: CalendarClock },
  'recently-completed':           { accent: 'border-l-amari-pine-teal', Icon: RefreshCcw },
  'data-drift':                   { accent: 'border-l-amber-500', Icon: Wrench },
  'too-soon':                     { accent: 'border-l-amari-text-muted', Icon: Clock },
  'recently-contacted-silent':    { accent: 'border-l-amari-pine-teal', Icon: Clock },
  'truly-cold':                   { accent: 'border-l-amari-pine-teal', Icon: Snowflake },
  'partner-no-referrals':         { accent: 'border-l-amber-500', Icon: HandHeart },
  'engaged':                      { accent: 'border-l-emerald-500', Icon: CheckCircle2 },
};

export default function OutreachRow({ card, onTap }: Props) {
  const style = STATUS_STYLE[card.recommendation.status] || STATUS_STYLE['truly-cold'];
  const { Icon } = style;

  return (
    <button
      onClick={onTap}
      className={`staff-card-tap w-full flex items-start gap-3 text-left ${style.accent} border-l-2`}
    >
      <Icon className="w-4 h-4 shrink-0 text-amari-text-muted mt-0.5" />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <p className="text-sm font-medium text-amari-charcoal truncate">{card.name}</p>
          {card.bucket === 'partner-active' && (
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-amari-light-sand text-amari-charcoal">Partner</span>
          )}
          {card.isReferral && card.referralSource && (
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-purple-100 text-purple-900">via {card.referralSource}</span>
          )}
          {(card.bucket === 'partner-active' || card.bucket === 'partner-pending') && (
            <span
              className={`text-[10px] px-1.5 py-0.5 rounded ${
                card.clientReferralCount === 0
                  ? 'bg-amber-100 text-amber-900'
                  : 'bg-emerald-100 text-emerald-900'
              }`}
            >
              {card.clientReferralCount === 0 ? '0 refs' : `${card.clientReferralCount} ref${card.clientReferralCount === 1 ? '' : 's'}`}
            </span>
          )}
        </div>
        <p className="text-xs text-amari-text-muted line-clamp-2 mt-0.5">
          {card.recommendation.headline}
        </p>
        {card.lastOutbound && (
          <p className="text-[11px] text-amari-text-muted mt-0.5 line-clamp-1 italic">
            "{(card.lastOutbound.body ?? '').slice(0, 100)}{(card.lastOutbound.body ?? '').length > 100 ? '…' : ''}"
          </p>
        )}
      </div>
      <ChevronRight className="w-4 h-4 text-amari-text-muted shrink-0 mt-1" />
    </button>
  );
}
