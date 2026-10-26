// Offline cache: the times work without internet. The radio is never cached.
// Bump CACHE after every change so phones drop the old copy.
const CACHE = "adhan-web-v19";
const SHELL = ["./", "index.html", "adhan.min.js", "push.js", "manifest.webmanifest", "logo-180.png", "logo-192.png", "logo-512.png", "logo.svg"];

self.addEventListener("install", e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", e => {
  e.waitUntil(caches.keys()
    .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener("fetch", e => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET") return;

  // Own files: always the latest from the network; the cached copy only when offline or very slow.
  // The radio node lookup is always live, never cached.
  if (url.origin === location.origin && url.pathname.endsWith("/radio")) return;
  // The push subscription API is always live too.
  if (url.origin === location.origin && url.pathname.includes("/api/")) return;

  if (url.origin === location.origin) {
    e.respondWith(caches.open(CACHE).then(async c => {
      const fresh = fetch(e.request, { cache: "no-cache" }).then(r => { if (r.ok) c.put(e.request, r.clone()); return r; });
      fresh.catch(() => {});
      const slow = new Promise(res => setTimeout(res, 4000));
      try {
        const r = await Promise.race([fresh, slow]);
        if (r) return r;
      } catch (err) {}
      return (await c.match(e.request, { ignoreSearch: true })) || fresh;
    }));
    return;
  }

  // Google Fonts: cache once, then serve from the cache.
  if (url.hostname === "fonts.googleapis.com" || url.hostname === "fonts.gstatic.com") {
    e.respondWith(caches.open(CACHE).then(async c => {
      const hit = await c.match(e.request);
      if (hit) return hit;
      const r = await fetch(e.request);
      if (r.ok || r.type === "opaque") c.put(e.request, r.clone());
      return r;
    }));
  }
  // Everything else (the radio stream) goes straight to the network.
});

// ---- Web Push from the server (worker/): adhan and iqama notices with the app closed ----
self.addEventListener("push", e => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch (err) {}
  // Always show something: iPhone and Chrome stop delivering to sites whose pushes show nothing.
  e.waitUntil(self.registration.showNotification(d.title || "أوقات الأذان والإقامة", {
    body: d.body || "",
    icon: "logo-180.png",
    badge: "logo-180.png",
    tag: d.tag || "adhan",
    lang: "ar",
    dir: "rtl",
    data: { url: "./" },
  }));
});

self.addEventListener("notificationclick", e => {
  e.notification.close();
  const target = new URL((e.notification.data && e.notification.data.url) || "./", self.registration.scope).href;
  e.waitUntil(self.clients.matchAll({ type: "window", includeUncontrolled: true }).then(list => {
    const open = list.find(c => c.url.startsWith(self.registration.scope));
    return open ? open.focus() : self.clients.openWindow(target);
  }));
});

// The browser renewed the subscription (Firefox does; Safari and Chrome rarely): tell the server, which keeps the settings.
self.addEventListener("pushsubscriptionchange", e => {
  const old = e.oldSubscription;
  e.waitUntil((async () => {
    const sub = e.newSubscription || await self.registration.pushManager.subscribe(old ? old.options : { userVisibleOnly: true });
    await fetch("api/subscribe", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ subscription: sub.toJSON(), oldEndpoint: old && old.endpoint }),
    });
  })().catch(() => {}));
});
