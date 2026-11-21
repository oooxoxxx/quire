const CACHE = "quire-shell-v2";

function scopePathname() {
  try {
    return new URL(self.registration.scope).pathname.replace(/\/$/, "") || "";
  } catch {
    return "";
  }
}

self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  const root = scopePathname();
  const path = url.pathname;
  if (root && path !== root && !path.startsWith(`${root}/`)) return;
  if (path.includes("/api/") || path.includes("/auth/")) return;
  event.respondWith(
    fetch(request)
      .then((response) => {
        const asset = path.includes("/assets/") || path.includes("/_build/");
        if (response.ok && (request.mode === "navigate" || asset)) {
          const copy = response.clone();
          caches.open(CACHE).then((cache) => cache.put(request, copy)).catch(() => {});
        }
        return response;
      })
      .catch(async () => {
        const cached = await caches.match(request);
        if (cached) return cached;
        if (request.mode === "navigate") {
          const home = new URL("./", self.registration.scope);
          const shell = (await caches.match(home)) || (await caches.match(new URL("index.html", home)));
          if (shell) return shell;
        }
        return new Response("Offline", { status: 503, headers: { "Content-Type": "text/plain" } });
      }),
  );
});