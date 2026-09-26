const CACHE='matrix-top3-v1.4.4-live';
const ASSETS=['./','./index.html','./styles.css','./app.js','./lab-detector.js','./top3-data.js','./top3-live.json','./matrix-logo.png','./manifest.webmanifest','./icon-192.png','./icon-512.png'];
const NETWORK_FIRST=['/','/index.html','/app.js','/lab-detector.js','/styles.css','/top3-live.json'];

self.addEventListener('install',e=>e.waitUntil(
  caches.open(CACHE).then(c=>c.addAll(ASSETS)).then(()=>self.skipWaiting())
));
self.addEventListener('activate',e=>e.waitUntil(
  caches.keys().then(keys=>Promise.all(keys.filter(k=>k!==CACHE).map(k=>caches.delete(k)))).then(()=>self.clients.claim())
));
self.addEventListener('fetch',e=>{
  if(e.request.method!=='GET')return;
  const path=new URL(e.request.url).pathname;
  const networkFirst=NETWORK_FIRST.some(x=>path.endsWith(x));
  if(networkFirst){
    // Live polling uses cache-busting queries; retain only one offline copy.
    const cacheKey=path.endsWith('/top3-live.json')?new URL('./top3-live.json',self.location.href).href:e.request;
    e.respondWith(
      fetch(e.request,{cache:'no-store'}).then(resp=>{
        if(!resp.ok)throw new Error(`HTTP ${resp.status}`);
        const copy=resp.clone();
        e.waitUntil(caches.open(CACHE).then(c=>c.put(cacheKey,copy)));
        return resp
      }).catch(()=>caches.match(cacheKey))
    );
    return
  }
  e.respondWith(
    caches.match(e.request).then(r=>r||fetch(e.request).then(resp=>{
      const copy=resp.clone();
      caches.open(CACHE).then(c=>c.put(e.request,copy));
      return resp
    }))
  );
});
