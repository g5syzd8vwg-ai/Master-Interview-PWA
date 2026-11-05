// This PWA is online-only by design. Intentionally never caches application data.
self.addEventListener('install',()=>self.skipWaiting());
self.addEventListener('activate',event=>event.waitUntil(self.clients.claim()));
self.addEventListener('fetch',event=>{event.respondWith(fetch(event.request,{cache:'no-store'}));});
