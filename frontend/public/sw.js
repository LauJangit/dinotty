// Minimal service worker for PWA installability
const CACHE_NAME = 'dinotty-v1'

self.addEventListener('install', (event) => {
  self.skipWaiting()
})

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim())
})

self.addEventListener('fetch', (event) => {
  // Network-only strategy: always fetch from network, no caching
  // This keeps the SW minimal while satisfying Chrome's PWA install requirement
  event.respondWith(fetch(event.request))
})
