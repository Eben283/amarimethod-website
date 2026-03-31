import { Loader2, DollarSign } from 'lucide-react';

interface Props {
  sessionPrepaid: boolean;
  sessionsRemaining: number;
  seriesType: string;
  onToggle: () => void;
  isToggling: boolean;
}

export default function PaymentStatus({
  sessionPrepaid,
  sessionsRemaining,
  seriesType,
  onToggle,
  isToggling,
}: Props) {
  const hasSeries = seriesType !== 'none' && sessionsRemaining > 0;
  const isPaid = sessionPrepaid;

  const label = hasSeries
    ? `Paid — ${sessionsRemaining} session${sessionsRemaining !== 1 ? 's' : ''} left`
    : isPaid
    ? 'Prepaid'
    : 'Payment needed';

  const bgClass = isPaid
    ? 'bg-green-50 border-green-200'
    : 'bg-amber-50 border-amber-200';

  const textClass = isPaid
    ? 'text-green-700'
    : 'text-amber-700';

  const iconClass = isPaid
    ? 'text-green-500'
    : 'text-amber-500';

  return (
    <div className={`staff-card flex items-center justify-between border ${bgClass}`}>
      <div className="flex items-center gap-2">
        <DollarSign className={`w-5 h-5 ${iconClass}`} />
        <span className={`text-sm font-medium ${textClass}`}>{label}</span>
      </div>
      {!hasSeries && (
        <button
          onClick={onToggle}
          disabled={isToggling}
          className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-colors min-h-[36px] ${
            isPaid
              ? 'bg-green-100 text-green-700 hover:bg-green-200 active:bg-green-300'
              : 'bg-amber-100 text-amber-700 hover:bg-amber-200 active:bg-amber-300'
          } disabled:opacity-50`}
        >
          {isToggling ? (
            <Loader2 className="w-3.5 h-3.5 animate-spin" />
          ) : isPaid ? (
            'Mark Unpaid'
          ) : (
            'Mark Paid'
          )}
        </button>
      )}
    </div>
  );
}
