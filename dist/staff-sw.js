// Self-destructing service worker — unregisters itself and clears all caches
// This replaces the old caching SW that was causing stale content issues

self.addEventListener('install', () => self.skipWaiting());

self.addEventListener('activate', async () => {
  // Clear all caches
  const keys = await caches.keys();
  await Promise.all(keys.map((k) => caches.delete(k)));
  // Unregister this service worker
  self.registration.unregister();
  // Take over all clients and reload them
  const clients = await self.clients.matchAll({ type: 'window' });
  clients.forEach((client) => client.navigate(client.url));
});
