import type { AmariTimeSlotItem } from "./types";

export type AmariTimeSlotsProps = {
  dateLabel?: string | null;
  slots: AmariTimeSlotItem[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  emptyMessage?: string;
  loading?: boolean;
  className?: string;
};

export function AmariTimeSlots({
  dateLabel,
  slots,
  selectedId,
  onSelect,
  emptyMessage = "No times available for this date.",
  loading = false,
  className = "",
}: AmariTimeSlotsProps) {
  return (
    <div className={`am-slots ${className}`.trim()}>
      {dateLabel && (
        <p className="am-slots-label">
          Times for <strong>{dateLabel}</strong>
        </p>
      )}
      {loading ? (
        <p className="am-slots-loading" role="status">
          Loading available times…
        </p>
      ) : slots.length === 0 ? (
        <p className="am-slots-empty">{emptyMessage}</p>
      ) : (
        <div className="am-slots-grid">
          {slots.map((slot) => (
            <button
              key={slot.id}
              type="button"
              data-testid={`time-slot-${slot.id}`}
              className={`am-slot${selectedId === slot.id ? " is-selected" : ""}`}
              onClick={() => onSelect(slot.id)}
            >
              {slot.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
