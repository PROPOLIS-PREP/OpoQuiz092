// Service worker de Patrullan2: hace la app instalable y la deja abrir sin conexión.
// Estrategia: la página y los iconos se sirven de la red y se guardan; sin red, se usa lo guardado.
// Si cambias algo que deba renovarse a la fuerza, sube VERSION.
const VERSION = "v14.16-online11";
const CACHE = "patrullan2-" + VERSION;
const BASE = ["./", "./index.html", "./manifest.webmanifest", "./icons/icon-192.png", "./icons/icon-512.png",
  "./lib/supabase.min.js", "./online/config.js", "./online/cuenta.js", "./online/amigos.js", "./online/partidas.js", "./online/partida.js", "./online/confirmado.html"];

self.addEventListener("install", e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(BASE)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", e => {
  e.waitUntil(caches.keys()
    .then(ks => Promise.all(ks.filter(k => (k.startsWith("patrulla092-") || k.startsWith("patrullan2-")) && k !== CACHE).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener("fetch", e => {
  const r = e.request;
  if (r.method !== "GET") return;
  const url = new URL(r.url);
  if (url.origin !== location.origin) return; // fuentes, Supabase, etc.: directo a la red
  // la página se revalida siempre con el servidor (no la sirve la caché HTTP del navegador aunque no haya caducado)
  const red = r.mode === "navigate" ? fetch(r.url, { cache: "no-cache", credentials: "same-origin" }) : fetch(r);
  e.respondWith(
    red.then(res => {
      if (res.ok) { const copia = res.clone(); caches.open(CACHE).then(c => c.put(r, copia)); }
      return res;
    }).catch(() => caches.match(r, { ignoreSearch: true }).then(c => c || (r.mode === "navigate" ? caches.match("./index.html") : Response.error())))
  );
});
