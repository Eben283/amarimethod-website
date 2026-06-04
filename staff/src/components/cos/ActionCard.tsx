import type { QueuedAction } from '../../types/cos';
import { ShoppingCart, Package, ListTodo, Search, Calendar, Sparkles } from 'lucide-react';

interface Props {
  action: QueuedAction;
}

const ICONS: Record<string, typeof ShoppingCart> = {
  grocery: ShoppingCart,
  purchase: Package,
  task: ListTodo,
  research: Search,
  calendar: Calendar,
  coach: Sparkles,
};

const LABELS: Record<string, string> = {
  grocery: 'Grocery',
  purchase: 'Purchase',
  task: 'Task',
  research: 'Research',
  calendar: 'Calendar',
  coach: 'Coach',
};

export default function ActionCard({ action }: Props) {
  const Icon = ICONS[action.type] || ListTodo;
  const label = LABELS[action.type] || action.type;

  return (
    <div className="flex items-start gap-3 bg-amari-light-sand border border-amari-border rounded-xl px-3 py-2.5">
      <div className="mt-0.5 p-1.5 rounded-lg bg-white">
        <Icon className="w-4 h-4 text-amari-accent-warm" />
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-xs font-medium text-amari-accent-warm uppercase tracking-wide">{label}</span>
          <span className="text-xs text-amari-text-muted">Queued</span>
        </div>
        <p className="text-sm text-amari-charcoal mt-0.5 truncate">{action.item}</p>
        {action.store && <p className="text-xs text-amari-text-muted mt-0.5">{action.store}</p>}
      </div>
    </div>
  );
}
