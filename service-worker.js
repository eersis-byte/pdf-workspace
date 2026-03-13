// PDF Workspace Service Worker v9.2.0 - 20 Enhancements
// ✅ Lazy loading, dark mode, keyboard shortcuts, mobile sidebar
// 🔒 CSP, SRI framework, beforeunload protection
// 📊 All previous fixes included
const VERSION = '9.2.0';
const CACHE_NAME = `pdf-workspace-v${VERSION}`;
const RUNTIME_CACHE = 'pdf-workspace-runtime';

// AUTO-DETECT BASE_URL for deployment flexibility
// Works on: domain root, GitHub Pages subpaths, Netlify previews, etc.
const BASE_URL = self.location.pathname.replace(/\/[^\/]*$/, '/');

// Local assets only - these MUST succeed for install to work
// Using relative paths for maximum deployment flexibility
const LOCAL_ASSETS = [
    './',
    './index.html',
    './app.js',
    './styles.css',
    './manifest.json',  // PWA manifest - required for offline install
    './favicon.ico',
    './favicon-32.png',
    './icon-192.png',
    './icon-512.png'
];

// CDN libraries - cached at runtime or best-effort during install
const CDN_ASSETS = [
    'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js',
    'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js',
    'https://cdn.jsdelivr.net/npm/pdf-lib@1.17.1/dist/pdf-lib.min.js',
    'https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js',
    'https://cdnjs.cloudflare.com/ajax/libs/FileSaver.js/2.0.5/FileSaver.min.js',
    'https://cdn.jsdelivr.net/npm/tesseract.js@4/dist/tesseract.min.js',
    'https://cdn.jsdelivr.net/npm/mammoth@1.6.0/mammoth.browser.min.js',
    'https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js',
    'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js',
    'https://cdnjs.cloudflare.com/ajax/libs/jspdf-autotable/3.5.31/jspdf.plugin.autotable.min.js',
    'https://unpkg.com/docx@8.5.0/build/index.js'
];

// Install event - cache local assets with best-effort CDN caching
self.addEventListener('install', (event) => {
    console.log('[Service Worker] Installing...');
    
    event.waitUntil((async () => {
        const cache = await caches.open(CACHE_NAME);
        
        // CRITICAL: Cache local assets - these MUST succeed
        console.log('[Service Worker] Caching local app shell');
        await cache.addAll(LOCAL_ASSETS);
        
        // BEST-EFFORT: Try to cache CDN assets, but don't fail install if they're unavailable
        console.log('[Service Worker] Best-effort caching of CDN libraries');
        await Promise.allSettled(
            CDN_ASSETS.map(async (url) => {
                try {
                    await cache.add(url);
                    console.log('[Service Worker] Cached:', url);
                } catch (error) {
                    console.warn('[Service Worker] Failed to cache (non-critical):', url, error.message);
                }
            })
        );
        
        console.log('[Service Worker] Installation complete');
        await self.skipWaiting();
    })());
});

// Activate event - clean up old caches
self.addEventListener('activate', (event) => {
    console.log('[Service Worker] Activating...');
    
    event.waitUntil(
        caches.keys()
            .then((cacheNames) => {
                return Promise.all(
                    cacheNames.map((cacheName) => {
                        if (cacheName !== CACHE_NAME && cacheName !== RUNTIME_CACHE) {
                            console.log('[Service Worker] Deleting old cache:', cacheName);
                            return caches.delete(cacheName);
                        }
                    })
                );
            })
            .then(() => {
                console.log('[Service Worker] Activation complete');
                // Notify all open tabs that the app is now ready for offline use
                return self.clients.matchAll({ includeUncontrolled: true, type: 'window' })
                    .then(clients => {
                        clients.forEach(client => client.postMessage({ type: 'OFFLINE_READY' }));
                    });
            })
            .then(() => self.clients.claim()) // Take control immediately
    );
});

// Fetch event - serve from cache, fallback to network
self.addEventListener('fetch', (event) => {
    const { request } = event;
    const url = new URL(request.url);
    
    // FIX: Skip blob URLs to prevent caching temporary data and large PDFs
    if (url.protocol === 'blob:') {
        return;
    }
    
    // Skip cross-origin requests from non-CDN sources
    if (url.origin !== location.origin && 
        !url.hostname.includes('cdnjs.cloudflare.com') && 
        !url.hostname.includes('cdn.jsdelivr.net') &&
        !url.hostname.includes('unpkg.com')) {
        return;
    }
    
    // Handle API requests differently (always network-first)
    if (request.method !== 'GET') {
        return;
    }
    
    // FIX: Use stale-while-revalidate for CDN resources
    const isCDN = url.origin !== location.origin;
    
    if (isCDN) {
        // Stale-while-revalidate for CDN libraries
        event.respondWith(
            caches.match(request).then((cachedResponse) => {
                const fetchPromise = fetch(request).then((networkResponse) => {
                    if (networkResponse && networkResponse.status === 200) {
                        // FIX: Don't cache large responses (> 10MB) to prevent storage bloat
                        const contentLength = networkResponse.headers.get('content-length');
                        const size = contentLength ? parseInt(contentLength) : 0;
                        const MAX_CACHE_SIZE = 10 * 1024 * 1024; // 10 MB
                        
                        if (size === 0 || size < MAX_CACHE_SIZE) {
                            const responseToCache = networkResponse.clone();
                            caches.open(RUNTIME_CACHE).then((cache) => {
                                cache.put(request, responseToCache);
                            });
                        } else {
                            console.log('[Service Worker] Skipping cache for large resource:', url.pathname, `${(size/1024/1024).toFixed(1)}MB`);
                        }
                    }
                    return networkResponse;
                }).catch(() => cachedResponse); // Fallback to cache on network error
                
                // Return cached immediately, update in background
                return cachedResponse || fetchPromise;
            })
        );
    } else {
        // Cache-first for local resources (app shell)
        event.respondWith(
            caches.match(request)
                .then((cachedResponse) => {
                    if (cachedResponse) {
                        console.log('[Service Worker] Serving from cache:', request.url);
                        return cachedResponse;
                    }
                    
                    // Not in cache, fetch from network
                    return fetch(request)
                        .then((networkResponse) => {
                            // Cache successful responses
                            if (networkResponse && networkResponse.status === 200) {
                                const responseToCache = networkResponse.clone();
                                
                                caches.open(RUNTIME_CACHE)
                                    .then((cache) => {
                                        cache.put(request, responseToCache);
                                    });
                            }
                            
                            return networkResponse;
                        })
                        .catch((error) => {
                            console.error('[Service Worker] Fetch failed:', error);
                            
                            // Return offline page if available — use relative path so it works on subpaths (e.g. GitHub Pages)
                            if (request.destination === 'document') {
                                return caches.match('./index.html') || caches.match('/');
                            }
                            
                            throw error;
                        });
                })
        );
    }
});

// Message event - handle commands from the app
self.addEventListener('message', (event) => {
    if (event.data && event.data.type === 'SKIP_WAITING') {
        self.skipWaiting();
    }
    
    if (event.data && event.data.type === 'CLEAR_CACHE') {
        event.waitUntil(
            caches.keys().then((cacheNames) => {
                return Promise.all(
                    cacheNames.map((cacheName) => caches.delete(cacheName))
                );
            })
        );
    }
});

// Background sync (future enhancement)
self.addEventListener('sync', (event) => {
    if (event.tag === 'sync-pdfs') {
        event.waitUntil(
            // Placeholder for future background sync functionality
            Promise.resolve()
        );
    }
});

console.log('[Service Worker] Loaded successfully');
