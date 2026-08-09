const CACHE_PREFIX = 'paperuss-shell-';
const CACHE_NAME = `${CACHE_PREFIX}v216`;
const APP_SHELL = [
  './',
  './index.html',
  './manifest.webmanifest',
  './assets/css/core.css',
  './assets/css/features.css',
  './assets/css/text-drag-engine.css',
  './assets/css/card-drag-engine.css',
  './assets/css/responsive.css',
  './assets/css/settings.css',
  './assets/icons/paperuss-logo.png',
  './assets/icons/paperuss-192.png',
  './assets/icons/paperuss-512.png',
  './assets/icons/russ-apps-banner.png',
  './js/stabilization.js',
  './js/history.js',
  './js/core.js',
  './js/leaves.js',
  './js/leafline.js',
  './js/productivity.js',
  './js/editor-ui.js',
  './js/tasks-settings.js',
  './js/cloud-notifications.js',
  './js/changelog.js',
  './js/actions.js',
  './js/link-parser.js',
  './js/embeds.js',
  './js/formatting.js',
  './js/text-drag-engine.js',
  './js/media.js',
  './js/card-drag-engine.js',
  './js/data-transfer.js',
  './js/docx-import.js',
  './assets/vendor/jszip.min.js',
  './js/docx-export.js',
  './js/responsive-images.js',
  './js/bootstrap.js',
  './assets/vendor/mammoth.browser.min.js'
];
const STATIC_CDN_HOSTS = new Set([
  'cdn.jsdelivr.net',
  'unpkg.com',
  'www.gstatic.com'
]);

async function precacheShell(){
  const cache=await caches.open(CACHE_NAME);
  const results=await Promise.allSettled(APP_SHELL.map(async path=>{
    const request=new Request(path,{cache:'reload'});
    const response=await fetch(request);
    if(!response.ok) throw new Error(`${path}: ${response.status}`);
    await cache.put(request,response);
  }));
  const failed=results
    .map((result,index)=>result.status==='rejected'?APP_SHELL[index]:null)
    .filter(Boolean);
  const indexFailed=failed.includes('./index.html') || failed.includes('./');
  if(failed.length) console.warn('PapeRuss precache skipped unavailable assets:',failed);
  if(indexFailed) throw new Error('PapeRuss offline shell could not cache index.html');
}

self.addEventListener('install',event=>{
  event.waitUntil(precacheShell().then(()=>self.skipWaiting()));
});

self.addEventListener('activate',event=>{
  event.waitUntil(
    caches.keys()
      .then(keys=>Promise.all(
        keys
          .filter(key=>key.startsWith(CACHE_PREFIX) && key!==CACHE_NAME)
          .map(key=>caches.delete(key))
      ))
      .then(()=>self.clients.claim())
  );
});

self.addEventListener('message',event=>{
  if(event.data?.type==='SKIP_WAITING') self.skipWaiting();
});

async function networkFirst(request,fallback){
  const cache=await caches.open(CACHE_NAME);
  try{
    const response=await fetch(request);
    if(response.ok) await cache.put(request,response.clone());
    return response;
  }catch(error){
    return (await caches.match(request)) || (fallback?await caches.match(fallback):null) || Response.error();
  }
}

async function staleWhileRevalidate(request){
  const cache=await caches.open(CACHE_NAME);
  const cached=await cache.match(request);
  const network=fetch(request).then(response=>{
    if(response.ok) cache.put(request,response.clone());
    return response;
  }).catch(()=>null);
  return cached || (await network) || Response.error();
}

self.addEventListener('fetch',event=>{
  const request=event.request;
  const url=new URL(request.url);

  if(request.method==='POST' && url.pathname.endsWith('/share-target')){
    event.respondWith((async()=>{
      try{
        const formData=await request.formData();
        const title=String(formData.get('title')||'').slice(0,500);
        const text=String(formData.get('text')||'').slice(0,2_000_000);
        const sharedUrl=String(formData.get('url')||'').slice(0,5000);
        const mediaFiles=formData.getAll('media');
        const filesData=[];
        for(const file of mediaFiles.slice(0,20)){
          if(file && typeof file==='object' && file.name && file.size<=25*1024*1024){
            const buffer=await file.arrayBuffer();
            filesData.push({
              name:String(file.name).slice(0,255),
              type:String(file.type||'application/octet-stream'),
              buffer:Array.from(new Uint8Array(buffer))
            });
          }
        }
        const cache=await caches.open(CACHE_NAME);
        const payloadResponse=new Response(JSON.stringify({
          title,text,url:sharedUrl,files:filesData,timestamp:Date.now()
        }),{headers:{'Content-Type':'application/json'}});
        await cache.put('./__pending_shared_payload__',payloadResponse);
        return Response.redirect('./index.html?shared=1',303);
      }catch(error){
        console.warn('Share target handling failed',error);
        return Response.redirect('./index.html',303);
      }
    })());
    return;
  }

  if(request.method!=='GET') return;

  if(url.origin===self.location.origin && url.pathname.endsWith('/changelog.json')){
    event.respondWith((async()=>{
      try {
        const response = await fetch(request);
        if (response && response.ok) {
          const cache = await caches.open(CACHE_NAME);
          cache.put('./changelog.json', response.clone());
          return response;
        }
      } catch (error) {
        console.warn('PapeRuss SW network fetch for changelog.json failed, falling back to cache:', error);
      }
      const cached = (await caches.match('./changelog.json')) || (await caches.match(request));
      if (cached) return cached;
      return new Response(JSON.stringify({ generatedAt: null, releases: [] }), {
        headers: { 'Content-Type': 'application/json' }, status: 503
      });
    })());
    return;
  }

  if(request.mode==='navigate'){
    event.respondWith(networkFirst(request,'./index.html'));
    return;
  }

  if(url.origin===self.location.origin){
    event.respondWith(staleWhileRevalidate(request));
    return;
  }

  if(STATIC_CDN_HOSTS.has(url.hostname)){
    event.respondWith(networkFirst(request));
  }
});
