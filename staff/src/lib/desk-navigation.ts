const STAFF_DESK_DESTINATIONS = new Map([
  ['/staff/pos', '/pos'],
  ['/staff/automations', '/automations'],
]);

/** Convert a full Staff URL from the cross-origin desk into a basename-relative route. */
export function deskNavigationRoute(rawDestination: string, staffOrigin: string): string | null {
  const destination = new URL(rawDestination, staffOrigin);
  if (destination.origin !== staffOrigin) return null;
  if (/^\/staff\/automations\/[^/]+$/.test(destination.pathname)) {
    return destination.pathname.slice('/staff'.length) + destination.search;
  }
  const route = STAFF_DESK_DESTINATIONS.get(destination.pathname);
  return route ? route + destination.search : null;
}
