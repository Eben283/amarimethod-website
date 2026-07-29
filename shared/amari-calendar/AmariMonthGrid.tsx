import { AMARI_CAL_WEEKDAYS, monthLabel, toYmd, type AmariCalendarDay } from "./types";

export type AmariMonthGridProps = {
  year: number;
  /** 0-indexed month */
  month: number;
  selectedDate: string | null;
  availableDates: ReadonlySet<string>;
  onSelectDate: (ymd: string) => void;
  onPrevMonth: () => void;
  onNextMonth: () => void;
  prevDisabled?: boolean;
  nextDisabled?: boolean;
  loading?: boolean;
  error?: string | null;
  onRetry?: () => void;
  /** YYYY-MM-DD; days before this are disabled. Defaults to today. */
  minDate?: string;
  /** Show peach availability dots on days that have slots. Default true. */
  showAvailabilityDots?: boolean;
  /** Optional test id for the grid container. */
  gridTestId?: string;
  monthLabelTestId?: string;
  prevTestId?: string;
  nextTestId?: string;
  className?: string;
};

function buildDays(year: number, month: number): AmariCalendarDay[] {
  const firstDow = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const cells: AmariCalendarDay[] = [];
  for (let i = 0; i < firstDow; i++) {
    cells.push({ ymd: `empty-${i}`, day: 0, empty: true });
  }
  for (let d = 1; d <= daysInMonth; d++) {
    const ymd = `${year}-${String(month + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
    cells.push({ ymd, day: d });
  }
  return cells;
}

export function AmariMonthGrid({
  year,
  month,
  selectedDate,
  availableDates,
  onSelectDate,
  onPrevMonth,
  onNextMonth,
  prevDisabled = false,
  nextDisabled = false,
  loading = false,
  error = null,
  onRetry,
  minDate,
  showAvailabilityDots = true,
  gridTestId = "calendar-grid",
  monthLabelTestId = "calendar-month-label",
  prevTestId = "prev-month-btn",
  nextTestId = "next-month-btn",
  className = "",
}: AmariMonthGridProps) {
  const todayYmd = toYmd(new Date());
  const floor = minDate || todayYmd;
  const cells = buildDays(year, month);

  return (
    <div className={`am-cal ${className}`.trim()}>
      <div className="am-cal-head">
        <button
          type="button"
          data-testid={prevTestId}
          className="am-cal-nav"
          aria-label="Previous month"
          disabled={prevDisabled}
          onClick={onPrevMonth}
        >
          ‹
        </button>
        <span data-testid={monthLabelTestId} className="am-cal-label">
          {monthLabel(year, month)}
        </span>
        <button
          type="button"
          data-testid={nextTestId}
          className="am-cal-nav"
          aria-label="Next month"
          disabled={nextDisabled}
          onClick={onNextMonth}
        >
          ›
        </button>
      </div>

      <div className="am-cal-weekdays" aria-hidden="true">
        {AMARI_CAL_WEEKDAYS.map((d) => (
          <span key={d}>{d}</span>
        ))}
      </div>

      {loading ? (
        <div className="am-cal-loading" role="status">
          Loading available days…
        </div>
      ) : error ? (
        <div className="am-cal-err" role="alert">
          <p>{error}</p>
          {onRetry && (
            <button type="button" className="am-slot" onClick={onRetry}>
              Try again
            </button>
          )}
        </div>
      ) : (
        <div data-testid={gridTestId} className="am-cal-days" role="grid">
          {cells.map((cell) => {
            if (cell.empty) {
              return <div key={cell.ymd} className="am-cal-empty" aria-hidden="true" />;
            }
            const isPast = cell.ymd < floor;
            const hasSlots = availableDates.has(cell.ymd);
            const isSelected = cell.ymd === selectedDate;
            const isToday = cell.ymd === todayYmd;
            const disabled = isPast || !hasSlots;
            const cls = ["am-cal-day"];
            if (isSelected) cls.push("is-selected");
            if (isToday && !isSelected) cls.push("is-today");
            if (disabled) cls.push("is-unavailable");
            return (
              <button
                key={cell.ymd}
                type="button"
                data-testid={`calendar-day-${cell.ymd}`}
                disabled={disabled}
                className={cls.join(" ")}
                onClick={() => onSelectDate(cell.ymd)}
              >
                {cell.day}
                {showAvailabilityDots && hasSlots && !isPast && !isSelected && !isToday && (
                  <span className="am-cal-dot" aria-hidden="true" />
                )}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
