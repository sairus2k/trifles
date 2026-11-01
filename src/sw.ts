// A classic worker script, not a module: sw-plugin.ts prepends these two constants at build time
// and emits the result as sw.js. Typechecked by tsconfig.sw.json (WebWorker lib).
declare const PRECACHE: string[];
declare const VERSION: string;

const sw = self as unknown as ServiceWorkerGlobalScope;
const CACHE = `shell-${VERSION}`;
const scope = new URL(sw.registration.scope);
const shell = new URL("index.html", scope).href;
const precached = new Set(PRECACHE.map((path) => new URL(path, sw.location.href).href));

sw.addEventListener("install", (event) => {
  // `reload` skips the HTTP cache, so a new version never precaches a stale copy of a file.
  const requests = [...precached].map((url) => new Request(url, { cache: "reload" }));
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.addAll(requests))
      .then(() => sw.skipWaiting()),
  );
});

sw.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((key) => key.startsWith("shell-") && key !== CACHE)
            .map((key) => caches.delete(key)),
        ),
      )
      .then(() => sw.clients.claim()),
  );
});

sw.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (request.mode === "navigate") {
    // Served from the root of Sure's own domain, the scope would also cover Sure's API.
    if (url.pathname.startsWith(`${scope.pathname}api/`)) return;
    event.respondWith(fromCache(shell, request));
  } else if (precached.has(url.href)) {
    event.respondWith(fromCache(url.href, request));
  }
  // Anything else (Sure, other origins) goes to the network untouched.
});

async function fromCache(key: string, request: Request) {
  const cached = await caches.match(key, { cacheName: CACHE });
  return cached ?? fetch(request);
}
