export type AmariCalendarDay = {
  ymd: string;
  day: number;
  empty?: boolean;
};

export type AmariTimeSlotItem = {
  id: string;
  label: string;
};

export const AMARI_CAL_WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;

export const AMARI_CAL_MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
] as const;

export function toYmd(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export function monthLabel(year: number, monthIndex: number): string {
  return `${AMARI_CAL_MONTHS[monthIndex]} ${year}`;
}
