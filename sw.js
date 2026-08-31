// Service worker mínimo: cachea los archivos de la app para que funcione offline
// y sea instalable ("Agregar a pantalla de inicio"). No cachea nada de red externa
// porque la app no usa red — todo el guardado es local vía IndexedDB (ver js/db.js).
const CACHE_NAME = "trainmetrics-v5";
const ASSETS = [
  "./",
  "./index.html",
  "./manifest.json",
  "./css/styles.css",
  "./js/metrics.js",
  "./js/db.js",
  "./js/app.js",
  "./icons/icon-192.svg",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSETS)).catch(() => {})
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;
  // Network-first: siempre intenta traer la versión más nueva de la app.
  // Si no hay conexión (o falla), usa lo último cacheado — así el celular
  // nunca queda pegado en una versión vieja del código después de una
  // actualización, pero igual funciona sin internet.
  event.respondWith(
    fetch(event.request)
      .then((res) => {
        const copy = res.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
        return res;
      })
      .catch(() => caches.match(event.request))
  );
});
