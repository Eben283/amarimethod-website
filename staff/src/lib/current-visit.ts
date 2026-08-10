type Visit = {
  id: string;
  startTime: string;
  status: string;
};

const RECENT_VISIT_WINDOW_MS = 12 * 60 * 60 * 1000;
const EARLY_ATTENDANCE_WINDOW_MS = 2 * 60 * 60 * 1000;

function startMs(visit: Visit) {
  return new Date(visit.startTime).getTime();
}

function active(visit: Visit) {
  return visit.status.toLowerCase() !== 'cancelled';
}

export function selectCurrentVisit<T extends Visit>(
  visits: T[],
  requestedId: string | null,
  now = Date.now(),
): T | null {
  if (requestedId) return visits.find((visit) => visit.id === requestedId) || null;

  const upcoming = visits
    .filter((visit) => active(visit) && startMs(visit) >= now)
    .sort((a, b) => startMs(a) - startMs(b))[0];
  if (upcoming) return upcoming;

  return visits
    .filter((visit) => active(visit) && startMs(visit) < now && startMs(visit) >= now - RECENT_VISIT_WINDOW_MS)
    .sort((a, b) => startMs(b) - startMs(a))[0] || null;
}

export function canMarkCurrentVisit(visit: Visit | null, explicitlySelected: boolean, now = Date.now()) {
  if (!visit) return false;
  const status = visit.status.toLowerCase();
  if (['cancelled', 'showed', 'completed'].includes(status)) return false;
  const start = startMs(visit);
  if (!Number.isFinite(start) || start > now + EARLY_ATTENDANCE_WINDOW_MS) return false;
  return explicitlySelected || start >= now - RECENT_VISIT_WINDOW_MS;
}
