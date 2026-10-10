/*
 * A service worker whose only job is to remove itself.
 *
 * This app registers no service worker. But localhost:3000 is shared with every
 * other project on a developer's machine, and the browser scopes a worker to the
 * ORIGIN — so a worker another project left registered there goes on
 * intercepting requests for this app, serving that project's cached chunks.
 * Turbopack then fails with "module factory is not available", pointing at a
 * .next directory that belongs to a different repository entirely.
 *
 * A stale worker cannot be removed by deleting the file: the browser only drops
 * a registration when the script's own update check returns 404 or a redirect,
 * and anything else — an HTML error page, a redirect to /sign-in — reads as a
 * fetch error that leaves the registration alive. So the reliable eviction is
 * to serve a VALID worker that unregisters itself and clears the caches the
 * other one filled, then reloads whatever pages it was controlling.
 *
 * It costs one static file and repairs any browser that ever picked up a stray
 * worker on this port, including a colleague's.
 */

self.addEventListener("install", () => {
  // Don't wait for the old worker to release its clients.
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      for (const key of await caches.keys()) {
        await caches.delete(key);
      }
      await self.registration.unregister();
      // The open tabs are still running the previous worker's chunks, so a
      // reload is the repair — without it the page stays broken until someone
      // refreshes by hand.
      for (const client of await self.clients.matchAll({ type: "window" })) {
        client.navigate(client.url);
      }
    })(),
  );
});
