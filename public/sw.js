const CACHE_NAME = 'unity-sme-v4';
const PRECACHE_ASSETS = [
  '/',
  '/index.html',
  '/backend.html',
  '/admin.html',
  '/platform.html',
  '/manifest.webmanifest',
  '/icons/apple-touch-icon.png',
  '/icons/icon-192x192.png',
  '/icons/icon-512x512.png',
  '/icons/icon-maskable-512x512.png',
  'https://cdn.jsdelivr.net/npm/chart.js',
  'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => {
        // Individually cache each asset and ignore/log failures using Promise.allSettled
        const cachePromises = PRECACHE_ASSETS.map((asset) => {
          return cache.add(asset)
            .then(() => {
              console.log(`Successfully cached asset: ${asset}`);
            })
            .catch((err) => {
              console.error(`Failed to cache asset: ${asset}, error:`, err);
            });
        });
        return Promise.all(cachePromises);
      })
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((cache) => {
          if (cache !== CACHE_NAME) {
            console.log('Service Worker: Deleting old cache', cache);
            return caches.delete(cache);
          }
        })
      );
    }).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // Check if it is a navigation request or one of the app shell HTML pages
  const isNavigation = event.request.mode === 'navigate' ||
                       ['/', '/index.html', '/backend.html', '/admin.html', '/platform.html'].includes(url.pathname);

  if (isNavigation) {
    // Network-first strategy for HTML/navigation requests
    event.respondWith(
      fetch(event.request)
        .then((response) => {
          if (response.status === 200 && event.request.method === 'GET') {
            const responseClone = response.clone();
            caches.open(CACHE_NAME).then((cache) => {
              cache.put(event.request, responseClone);
            });
          }
          return response;
        })
        .catch(() => {
          // Fall back to cache only when offline
          return caches.match(event.request);
        })
    );
  } else if (url.pathname.includes('/api/')) {
    if (event.request.method === 'GET') {
      // Dynamic endpoints: always go to network, only fall back to cache when genuinely offline, and never cache non-200 or error bodies.
      event.respondWith(
        fetch(event.request)
          .then((response) => {
            if (response.status === 200) {
              const responseClone = response.clone();
              caches.open(CACHE_NAME).then((cache) => {
                cache.put(event.request, responseClone);
              });
            }
            return response;
          })
          .catch(() => {
            return caches.match(event.request);
          })
      );
    } else {
      // Non-GET API requests go directly to network
      event.respondWith(fetch(event.request));
    }
  } else {
    // Cache-first strategy for other static assets (CSS, JS, images, fonts)
    event.respondWith(
      caches.match(event.request).then((cachedResponse) => {
        if (cachedResponse) {
          return cachedResponse;
        }
        return fetch(event.request).then((networkResponse) => {
          if (networkResponse.status === 200 && event.request.method === 'GET') {
            const responseClone = networkResponse.clone();
            caches.open(CACHE_NAME).then((cache) => {
              cache.put(event.request, responseClone);
            });
          }
          return networkResponse;
        });
      })
    );
  }
});
