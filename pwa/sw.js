const CACHE_NAME = "tamagotchi-pwa-v1";
const ASSETS = [
  "/",
  "/index.html",
  "/config.js",
  "/manifest.webmanifest",
  "/icon-192.png",
  "/icon-512.png"
];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSETS)));
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.map((key) => key !== CACHE_NAME ? caches.delete(key) : null)))
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;
  event.respondWith(
    caches.match(event.request).then((cached) => cached || fetch(event.request))
  );
});

async function showTamaNotification(data = {}) {
  const title = data.title || "동행 다마고치";
  const body = data.body || "배고파… 나를 한번 봐줄래?";
  const tag = data.tag || "tamagotchi-request";
  const url = data.url || "/";
  await self.registration.showNotification(title, {
    body,
    tag,
    renotify: true,
    icon: "/icon-192.png",
    badge: "/icon-192.png",
    vibrate: [220, 120, 220],
    data: { url }
  });
}

self.addEventListener("message", (event) => {
  if (!event.data) return;
  if (event.data.type === "SHOW_NOTIFICATION") {
    event.waitUntil(showTamaNotification(event.data.payload || {}));
  }
});

self.addEventListener("push", (event) => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch (e) { data = {}; }
  event.waitUntil(showTamaNotification(data));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const targetUrl = event.notification.data?.url || "/";
  event.waitUntil(
    clients.matchAll({ type: "window", includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if ("focus" in client) {
          client.navigate(targetUrl);
          return client.focus();
        }
      }
      if (clients.openWindow) return clients.openWindow(targetUrl);
    })
  );
});
