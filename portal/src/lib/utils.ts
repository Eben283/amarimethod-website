import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatDate(dateString: string): string {
  const date = new Date(dateString);
  return date.toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

const PACIFIC_TZ = 'America/Los_Angeles';

function viewerZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || PACIFIC_TZ;
  } catch {
    return PACIFIC_TZ;
  }
}

/**
 * Times render in the VIEWER's timezone (the correct instant — server
 * timestamps carry real offsets since 2026-07-02). The studio runs on
 * Pacific: for a viewer whose device is set to any other zone, append an
 * explicit label ("6:00 PM EDT") so a converted time can't be misread as an
 * unlabeled studio time. Pacific viewers see the same clean "3:00 PM" as
 * always.
 */
export function formatTime(dateString: string): string {
  const date = new Date(dateString);
  const time = date.toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
  });
  if (viewerZone() === PACIFIC_TZ) return time;
  const zone = new Intl.DateTimeFormat('en-US', { timeZoneName: 'short' })
    .formatToParts(date)
    .find((p) => p.type === 'timeZoneName')?.value;
  return zone ? `${time} ${zone}` : time;
}

export function formatDateTime(dateString: string): string {
  return `${formatDate(dateString)} at ${formatTime(dateString)}`;
}

/** Returns short month name, e.g. "Feb" */
export function getMonth(dateString: string): string {
  return new Date(dateString).toLocaleDateString('en-US', { month: 'short' });
}

/** Returns day of month, e.g. "18" */
export function getDay(dateString: string): string {
  return new Date(dateString).getDate().toString();
}

/** Returns weekday, e.g. "Tue" */
export function getWeekday(dateString: string): string {
  return new Date(dateString).toLocaleDateString('en-US', { weekday: 'short' });
}

/** Returns relative label like "Today", "Tomorrow", or weekday name */
export function getRelativeDay(dateString: string): string {
  const date = new Date(dateString);
  const today = new Date();
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);

  if (date.toDateString() === today.toDateString()) return 'Today';
  if (date.toDateString() === tomorrow.toDateString()) return 'Tomorrow';
  return date.toLocaleDateString('en-US', { weekday: 'long' });
}

export function getGreeting(): string {
  const hour = new Date().getHours();
  if (hour < 12) return 'Good morning';
  if (hour < 17) return 'Good afternoon';
  return 'Good evening';
}
