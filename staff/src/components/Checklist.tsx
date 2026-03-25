import { useState, useEffect } from 'react';
import { CheckCircle2, Circle } from 'lucide-react';
import { generateChecklist } from '../data/generateChecklist';
import type { ContactDetail, ChecklistState } from '../types/staff';

interface Props {
  appointmentId: string;
  client: ContactDetail;
}

function getStorageKey(appointmentId: string): string {
  return `staff_checklist_${appointmentId}`;
}

function loadChecklistState(appointmentId: string): ChecklistState {
  try {
    const raw = localStorage.getItem(getStorageKey(appointmentId));
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function saveChecklistState(appointmentId: string, state: ChecklistState) {
  localStorage.setItem(getStorageKey(appointmentId), JSON.stringify(state));
}

export default function Checklist({ appointmentId, client }: Props) {
  const template = generateChecklist(client);

  const [checked, setChecked] = useState<ChecklistState>(() => loadChecklistState(appointmentId));

  useEffect(() => {
    saveChecklistState(appointmentId, checked);
  }, [appointmentId, checked]);

  if (!template) return null;

  function toggleItem(itemId: string) {
    setChecked(prev => ({ ...prev, [itemId]: !prev[itemId] }));
  }

  const completedCount = template.items.filter(item => checked[item.id]).length;
  const totalCount = template.items.length;

  return (
    <div className="staff-card">
      <div className="flex items-center justify-between mb-1">
        <h3 className="text-sm font-medium text-amari-charcoal">{template.name}</h3>
        <span className="text-xs text-amari-text-muted">{completedCount}/{totalCount}</span>
      </div>
      {template.description && (
        <p className="text-xs text-amari-text-muted mb-3">{template.description}</p>
      )}

      {/* Progress bar */}
      <div className="h-1.5 bg-amari-light-sand rounded-full overflow-hidden mb-4">
        <div
          className="h-full bg-amari-accent-warm rounded-full transition-all duration-300"
          style={{ width: `${totalCount > 0 ? (completedCount / totalCount) * 100 : 0}%` }}
        />
      </div>

      <div className="space-y-1">
        {template.items.map((item) => {
          const isChecked = !!checked[item.id];
          return (
            <button
              key={item.id}
              onClick={() => toggleItem(item.id)}
              className="w-full flex items-start gap-3 p-2 rounded-lg hover:bg-amari-light-sand active:bg-amari-border transition-colors text-left min-h-[44px]"
            >
              {isChecked ? (
                <CheckCircle2 className="w-5 h-5 text-amari-accent-warm flex-shrink-0 mt-0.5" />
              ) : (
                <Circle className="w-5 h-5 text-amari-border flex-shrink-0 mt-0.5" />
              )}
              <div className="flex-1 min-w-0">
                <p className={`text-sm ${isChecked ? 'text-amari-text-muted line-through' : 'text-amari-charcoal'}`}>
                  {item.text}
                </p>
                {item.hint && !isChecked && (
                  <p className="text-xs text-amari-text-muted mt-0.5 italic">{item.hint}</p>
                )}
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
