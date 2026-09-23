const CACHE_NAME = "pinesjournal-shell-20260922-notifications";
const APP_SHELL = [
  "/",
  "/index.html",
  "/styles.css",
  "/js/api.js",
  "/js/app.js",
  "/manifest.webmanifest",
  "/favicon.ico",
  "/icons/app_icon.ico",
  "/icons/apple-touch-icon.png",
  "/assets/lista.svg",
  "/assets/calendario.svg",
  "/assets/bloco.svg",
  "/assets/configuracoes.svg",
  "/assets/header_mark.png",
  "/icons/icon-192.png",
  "/icons/icon-512.png",
  "/icons/icon-maskable-192.png",
  "/icons/icon-maskable-512.png"
];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL)));
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))))
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (url.pathname.startsWith("/api/")) return;
  if (event.request.method !== "GET") return;

  event.respondWith(
    caches.match(event.request).then((cached) => {
      if (cached) return cached;
      return fetch(event.request).then((response) => {
        if (response.ok && response.type === "basic") {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
        }
        return response;
      });
    })
  );
});

self.addEventListener("push", (event) => {
  let payload = {};
  try {
    payload = event.data ? event.data.json() : {};
  } catch {
    payload = { title: "Pine's Journal", body: event.data?.text() || "Você tem tarefas pendentes." };
  }

  const title = payload.title || "Pine's Journal";
  const pendingCount = Number(payload.pending_count || 0);
  const options = {
    body: payload.body || "Você tem tarefas pendentes.",
    icon: payload.icon || "/icons/icon-192.png",
    badge: payload.badge || "/icons/icon-192.png",
    tag: payload.tag || "pinesjournal-tasks",
    renotify: false,
    data: {
      url: payload.url || "/",
      pending_count: pendingCount,
    },
  };

  event.waitUntil((async () => {
    const work = [self.registration.showNotification(title, options)];
    if ("setAppBadge" in self.navigator) {
      try {
        work.push(pendingCount > 0 ? self.navigator.setAppBadge(pendingCount) : self.navigator.clearAppBadge());
      } catch {
        // O badge depende do suporte do sistema operacional/PWA instalada.
      }
    }
    await Promise.all(work);
  })());
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const targetUrl = new URL(event.notification.data?.url || "/", self.location.origin).href;

  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    for (const client of windows) {
      if (new URL(client.url).origin !== self.location.origin) continue;
      if ("navigate" in client && client.url !== targetUrl) await client.navigate(targetUrl);
      return client.focus();
    }
    if (self.clients.openWindow) return self.clients.openWindow(targetUrl);
    return undefined;
  })());
});
