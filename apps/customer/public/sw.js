// CloseBuy service worker — web push only. Deliberately no fetch handler
// and no cache: this app has to show live prices, stock and order status,
// and a stale offline copy of any of that would be worse than an error.

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = {};
  }
  const orderId = data.payload && data.payload.orderId ? data.payload.orderId : "";
  event.waitUntil(
    self.registration.showNotification(data.title || "CloseBuy", {
      body: data.body || "You have a new update.",
      icon: "/icon-192.png",
      badge: "/icon-192.png",
      // Same type for the same order replaces the earlier banner instead of stacking duplicates.
      tag: (data.type || "closebuy") + ":" + orderId,
      renotify: true,
      data: { url: data.url || "/notifications" },
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const target = new URL((event.notification.data && event.notification.data.url) || "/notifications", self.location.origin).href;
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((windows) => {
      for (const w of windows) {
        if ("focus" in w) {
          w.navigate(target).catch(() => {});
          return w.focus();
        }
      }
      return self.clients.openWindow(target);
    }),
  );
});
