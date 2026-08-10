type LegacyRegistration = {
  scriptUrl: string | null;
  unregister: () => Promise<boolean>;
};

type ReleaseRuntime = {
  registrations: LegacyRegistration[];
  cacheNames: string[];
  deleteCache: (name: string) => Promise<boolean>;
};

const STAFF_CACHE_PREFIXES = ['amari-staff', 'staff-'];

export function buildIdentityFromScripts(scriptUrls: string[]) {
  for (const source of scriptUrls) {
    const match = source.match(/\/staff\/assets\/index-([A-Za-z0-9_-]+)\.js(?:\?|$)/);
    if (match) return match[1];
  }
  return 'unknown';
}

export function currentStaffBuildIdentity() {
  return buildIdentityFromScripts(Array.from(document.scripts, (script) => script.src).filter(Boolean));
}

export async function retireLegacyStaffRuntime({ registrations, cacheNames, deleteCache }: ReleaseRuntime) {
  const staffRegistrations = registrations.filter((registration) => {
    if (!registration.scriptUrl) return false;
    try {
      return new URL(registration.scriptUrl).pathname === '/staff-sw.js';
    } catch {
      return false;
    }
  });
  const staffCaches = cacheNames.filter((name) => STAFF_CACHE_PREFIXES.some((prefix) => name.startsWith(prefix)));
  await Promise.all([
    ...staffRegistrations.map((registration) => registration.unregister()),
    ...staffCaches.map((name) => deleteCache(name)),
  ]);
}

export async function retireLegacyStaffBrowserState() {
  if (!('serviceWorker' in navigator)) return;
  try {
    const registrations = await navigator.serviceWorker.getRegistrations();
    const cacheNames = 'caches' in window ? await window.caches.keys() : [];
    await retireLegacyStaffRuntime({
      registrations: registrations.map((registration) => ({
        scriptUrl: registration.active?.scriptURL || registration.waiting?.scriptURL || registration.installing?.scriptURL || null,
        unregister: () => registration.unregister(),
      })),
      cacheNames,
      deleteCache: (name) => window.caches.delete(name),
    });
  } catch {
    // Release cleanup is best-effort. The non-cached HTML shell remains the
    // authoritative path and the app stays usable if a browser blocks access.
  }
}
