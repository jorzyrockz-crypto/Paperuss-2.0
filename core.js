/* ============================================================
   STATE & PERSISTENCE
   ============================================================ */
const STORAGE_KEY = 'octonotes:v2';
const THEME_KEY = 'octonotes:theme';

/* ============================================================
   MEDIA STORAGE (IndexedDB blobs) + URL cache
   ============================================================ */
const MEDIA_DB='octonotes-media', MEDIA_STORE='media';
let mediaDB=null;
const urlCache=new Map();  // mediaId -> objectURL (revoked on note switch)

function openMediaDB(){
  return new Promise((resolve,reject)=>{
    if(mediaDB) return resolve(mediaDB);
    const req=indexedDB.open(MEDIA_DB,1);
    req.onupgradeneeded=()=>{
      const db=req.result;
      if(!db.objectStoreNames.contains(MEDIA_STORE)) db.createObjectStore(MEDIA_STORE,{keyPath:'id'});
    };
    req.onsuccess=()=>{ mediaDB=req.result; resolve(mediaDB); };
    req.onerror=()=>reject(req.error);
  });
}
async function mediaPut(record){
  const db=await openMediaDB();
  return new Promise((res,rej)=>{
    const tx=db.transaction(MEDIA_STORE,'readwrite');
    tx.objectStore(MEDIA_STORE).put(record);
    tx.oncomplete=()=>res(record); tx.onerror=()=>rej(tx.error);
  });
}
async function mediaGet(id){
  const db=await openMediaDB();
  return new Promise((res,rej)=>{
    const tx=db.transaction(MEDIA_STORE,'readonly');
    const r=tx.objectStore(MEDIA_STORE).get(id);
    r.onsuccess=()=>res(r.result||null); r.onerror=()=>rej(r.error);
  });
}
async function mediaDel(id){
  if(typeof recordCloudDeletion==='function') recordCloudDeletion('media',id);
  if(typeof removeFromOfflineUploadQueue==='function') removeFromOfflineUploadQueue(id);
  const db=await openMediaDB();
  return new Promise((res,rej)=>{
    const tx=db.transaction(MEDIA_STORE,'readwrite');
    tx.objectStore(MEDIA_STORE).delete(id);
    tx.oncomplete=()=>res(); tx.onerror=()=>rej(tx.error);
  });
}
async function mediaAll(){
  const db=await openMediaDB();
  return new Promise((res,rej)=>{
    const tx=db.transaction(MEDIA_STORE,'readonly');
    const r=tx.objectStore(MEDIA_STORE).getAll();
    r.onsuccess=()=>res(r.result||[]); r.onerror=()=>rej(r.error);
  });
}

const mediaUid = () => 'm_'+Date.now().toString(36)+Math.random().toString(36).slice(2,8);

async function computeBlobHash(blob){
  try {
    const buf = await blob.arrayBuffer();
    const hashBuffer = await crypto.subtle.digest('SHA-256', buf);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
  } catch(_) { return null; }
}

const pendingSaveIds = new Set();
async function saveMediaBlob(blob, name, kind, customId){
  const id = customId || mediaUid();
  pendingSaveIds.add(id);
  try {
    let processedBlob = blob;
    if((kind === 'image' || (blob && blob.type && blob.type.startsWith('image/'))) && typeof downscaleImageBlob === 'function'){
      try{ processedBlob = await downscaleImageBlob(blob); }catch(_){}
    }
    const hash = await computeBlobHash(processedBlob);
    if(hash){
      try {
        const existing = (await mediaAll()).find(r => r.hash === hash);
        if(existing){
          pendingSaveIds.delete(id);
          return existing.id;
        }
      } catch(_){}
    }
    const now = Date.now();
    await mediaPut({
      id,
      kind,
      name: name || 'file',
      type: processedBlob.type || blob.type || '',
      size: processedBlob.size || 0,
      blob: processedBlob,
      hash: hash || '',
      createdAt: now,
      updatedAt: now,
      cloudSyncedAt: 0,
      pendingUpload: true,
      uploadFailures: 0,
      lastUploadAttempt: 0
    });
    if(typeof queueCloudSync==='function') queueCloudSync();
    return id;
  } finally {
    pendingSaveIds.delete(id);
  }
}


function mediaVersion(record){
  return +record?.updatedAt||+record?.createdAt||0;
}
function mediaSyncIndicator(record){
  const isSignedIn=typeof currentSession==='object' && currentSession?.mode==='auth';
  const failures = record?.uploadFailures||0;
  const isPermanentlyFailed = isSignedIn && failures >= (typeof MAX_UPLOAD_FAILURES!=='undefined' ? MAX_UPLOAD_FAILURES : 5);
  const isSynced=isSignedIn && !record?.pendingUpload && (+record?.cloudSyncedAt||0)>=mediaVersion(record);
  if(isPermanentlyFailed) return {icon:'cloud-off',label:`Upload failed (${failures} attempts) — will retry when reconnected`,error:true};
  if(isSynced) return {icon:'cloud-check',label:'Synced online'};
  return isSignedIn
    ? {icon:'cloud-upload',label: failures>0 ? `Retrying upload (attempt ${failures+1})…` : 'Waiting to sync online'}
    : {icon:'hard-drive',label:'Local only'};
}
function addMediaSyncIndicator(el,record){
  if(!el || el.dataset.mediaKind==='link') return;
  const status=mediaSyncIndicator(record);
  const isSignedIn=typeof currentSession==='object' && currentSession?.mode==='auth';
  const isSynced=isSignedIn && !record?.pendingUpload && (+record?.cloudSyncedAt||0)>=mediaVersion(record);
  const isUploading=isSignedIn && !isSynced;
  const isPermanentlyFailed = status.error;

  // ── Animated glassmorphic overlay layer ──
  let overlayWrap = el.closest('.media-sync-overlay-wrap');
  let overlay = (overlayWrap || el.parentElement)?.querySelector?.('.media-sync-overlay');

  if(isUploading && !isPermanentlyFailed){
    if(!overlayWrap && el.tagName === 'IMG' && el.parentNode){
      overlayWrap = document.createElement('span');
      overlayWrap.className = 'media-sync-overlay-wrap';
      el.parentNode.insertBefore(overlayWrap, el);
      overlayWrap.appendChild(el);
    }
    const container = overlayWrap || el;
    overlay = container.querySelector('.media-sync-overlay');
    if(!overlay){
      overlay = document.createElement('div');
      overlay.className = 'media-sync-overlay';
      overlay.contentEditable = 'false';
      const retryLabel = (record?.uploadFailures||0) > 0
        ? ` (retry ${record.uploadFailures})` : '';
      overlay.innerHTML = `
        <div class="mso-spinner"></div>
        <div class="mso-progress-bar"><div class="mso-progress-fill" style="width:0%"></div></div>
        <div class="mso-text"><i data-lucide="cloud-upload" class="w-4 h-4"></i> Syncing online${retryLabel}...</div>
      `;
      container.appendChild(overlay);
      if(typeof lucide==='object' && typeof lucide.createIcons==='function') lucide.createIcons();

      // Wire live progress events for this specific media element
      const mediaId = el.getAttribute('data-media-id') || record?.id;
      if(mediaId){
        const onProgress = (e) => {
          if(e.detail.id !== mediaId) return;
          const fill = overlay.querySelector('.mso-progress-fill');
          const text = overlay.querySelector('.mso-text');
          if(e.detail.error){
            if(fill) fill.style.width = '0%';
            if(text) text.innerHTML = `<i data-lucide="alert-circle" class="w-4 h-4"></i> Retrying (${e.detail.failures}/${typeof MAX_UPLOAD_FAILURES!=='undefined'?MAX_UPLOAD_FAILURES:5})…`;
            if(typeof lucide==='object' && typeof lucide.createIcons==='function') lucide.createIcons();
          } else {
            if(fill) fill.style.width = `${e.detail.percent}%`;
            if(text) text.innerHTML = `<i data-lucide="cloud-upload" class="w-3.5 h-3.5"></i> ${e.detail.percent}%`;
            if(typeof lucide==='object' && typeof lucide.createIcons==='function') lucide.createIcons();
          }
        };
        document.addEventListener('media-upload-progress', onProgress);
        // Auto-remove listener when overlay is removed from DOM
        const obs = new MutationObserver(() => {
          if(!overlay.isConnected){ document.removeEventListener('media-upload-progress', onProgress); obs.disconnect(); }
        });
        obs.observe(document.body, {childList:true, subtree:true});
      }
    }
    overlay.classList.remove('synced-fade','mso-error');
  } else if(overlay){
    if(isPermanentlyFailed){
      overlay.classList.add('mso-error');
      const text = overlay.querySelector('.mso-text');
      if(text) text.innerHTML = `<i data-lucide="cloud-off" class="w-4 h-4"></i> Upload failed — tap to retry`;
      if(typeof lucide==='object' && typeof lucide.createIcons==='function') lucide.createIcons();
    } else {
      overlay.classList.add('synced-fade');
      setTimeout(() => { if(overlay && overlay.parentElement) overlay.remove(); }, 350);
    }
  }

  // ── Compact sync badge (cloud icon below media) ──
  let badge;
  if(el.classList.contains('media-card')){
    badge=el.querySelector('[data-media-sync-indicator]');
    if(!badge){
      badge=document.createElement('span');
      badge.dataset.mediaSyncIndicator='1';
      badge.contentEditable='false';
      el.appendChild(badge);
    }
  }else{
    badge=el.nextElementSibling;
    if(!badge || !badge.matches('[data-media-sync-indicator]')){
      badge=document.createElement('span');
      badge.dataset.mediaSyncIndicator='1';
      badge.contentEditable='false';
      el.insertAdjacentElement('afterend',badge);
    }
  }
  const isBadgeUploading = status.icon==='loader' || status.icon==='cloud-upload' || (record && record.pendingUpload && !isPermanentlyFailed);
  badge.className=`media-sync-indicator ${status.icon==='cloud-check'?'is-synced':''} ${isPermanentlyFailed?'is-error':''} ${isBadgeUploading?'is-uploading':''}`;
  badge.title=status.label;
  badge.setAttribute('aria-label',status.label);
  badge.innerHTML=`<i data-lucide="${status.icon}" aria-hidden="true"></i>`;
}

const pendingFetches = new Map();
async function getMediaURL(id){
  if(urlCache.has(id)) return urlCache.get(id);
  if(pendingFetches.has(id)) return pendingFetches.get(id);

  const fetchPromise = _getMediaURLInner(id);
  pendingFetches.set(id, fetchPromise);
  try {
    const result = await fetchPromise;
    return result;
  } finally {
    pendingFetches.delete(id);
  }
}
async function _getMediaURLInner(id){
  // 1. Check local IndexedDB first (0ms fast Blob URL)
  const rec = await mediaGet(id);
  if(rec && rec.blob){
    const url = URL.createObjectURL(rec.blob);
    urlCache.set(id, url);
    return url;
  }

  // 2. Secondary Device Hybrid Fallback: check remote cloudUrl in manifest or local record
  const manifestItem = (window.__remoteMediaManifest || new Map()).get(id) || rec;
  if(manifestItem && manifestItem.cloudUrl && !manifestItem.cloudUrl.startsWith('firestore:')){
    urlCache.set(id, manifestItem.cloudUrl);
    return manifestItem.cloudUrl;
  }

  // 2.5. Firestore-only media fallback: fetch dataUrl from Firestore subcollection
  try {
    if(typeof fbDb !== 'undefined' && fbDb){
      const session = (typeof currentSession !== 'undefined' && currentSession) || (typeof loadSession === 'function' ? loadSession() : null);
      if(session && session.uid){
        let remoteUrl = null;
        if(typeof fetchFirestoreMediaDataUrl === 'function'){
          remoteUrl = await fetchFirestoreMediaDataUrl(session.uid, id);
        } else {
          const docSnap = await fbDb.collection('paperuss_users').doc(session.uid).collection('media').doc(id).get();
          if(docSnap && docSnap.exists){
            const data = docSnap.data();
            if(data.chunked === true && data.totalChunks > 0){
              const chunkPromises = [];
              for(let c = 0; c < data.totalChunks; c++){
                chunkPromises.push(fbDb.collection('paperuss_users').doc(session.uid).collection('media').doc(`${id}_chunk_${c}`).get());
              }
              const chunkSnaps = await Promise.all(chunkPromises);
              remoteUrl = chunkSnaps.map(snap => (snap && snap.exists && snap.data().data) || '').join('');
            } else {
              remoteUrl = data.dataUrl || null;
            }
          }
        }
        if(remoteUrl){
          if(manifestItem) manifestItem.cloudUrl = remoteUrl;
          urlCache.set(id, remoteUrl);
          return remoteUrl;
        }
      }
    }
  } catch(_){}

  // 3. Fallback for older uploaded media without stored cloudUrl: fetch download URL from Firebase Storage
  try {
    if(typeof mediaStorageRef === 'function'){
      const session = (typeof currentSession !== 'undefined' && currentSession) || (typeof loadSession === 'function' ? loadSession() : null);
      if(session && session.uid){
        const remoteUrl = await mediaStorageRef(session.uid, id).getDownloadURL();
        if(remoteUrl){
          if(manifestItem) manifestItem.cloudUrl = remoteUrl;
          urlCache.set(id, remoteUrl);
          return remoteUrl;
        }
      }
    }
  } catch(_){}

  return null;
}
function revokeCachedURLs(){
  urlCache.forEach(u=>{ try{URL.revokeObjectURL(u);}catch(e){} });
  urlCache.clear();
}
function formatBytes(b){
  if(!b) return '0 B';
  const u=['B','KB','MB','GB']; let i=0;
  while(b>=1024 && i<u.length-1){ b/=1024; i++; }
  return b.toFixed(b<10&&i>0?1:0)+' '+u[i];
}
/* Convert Blob <-> base64 for export/import portability */
const MAX_BLOB_DATAURL_SIZE = 50 * 1024 * 1024; // 50 MB safety limit
function blobToDataURL(blob){
  if(blob && blob.size > MAX_BLOB_DATAURL_SIZE){
    return Promise.reject(new Error(`File too large for Base64 conversion (${formatBytes(blob.size)}). Maximum is 50 MB.`));
  }
  return new Promise((res,rej)=>{
    const r=new FileReader();
    r.onload=()=>res(r.result); r.onerror=()=>rej(r.error);
    r.readAsDataURL(blob);
  });
}
function dataURLToBlob(dataURL){
  try {
    if(!dataURL || typeof dataURL !== 'string' || !dataURL.includes(',')) return null;
    const [meta,b64]=dataURL.split(',');
    const type=(meta.match(/data:([^;]+)/)||[])[1]||'application/octet-stream';
    const bin=atob(b64); const arr=new Uint8Array(bin.length);
    for(let i=0;i<bin.length;i++) arr[i]=bin.charCodeAt(i);
    return new Blob([arr],{type});
  } catch(e) {
    console.warn('PapeRuss: dataURLToBlob failed — corrupted or malformed data', e);
    return null;
  }
}

/* Collect all media IDs referenced by a set of notes. */
function referencedMediaIds(sourceNotes=notes){
  const set=new Set();
  sourceNotes.forEach(n=>{
    if(!n.content) return;
    const matches=n.content.match(/(?:data-media-id|data-original-media-id)="([^"]+)"/g)||[];
    matches.forEach(m=>set.add(m.match(/"([^"]+)"/)[1]));
  });
  return set;
}

/*
   Rich-link cards have a data-media-id for editor consistency but no blob to
   upload. Everything else with a media id must exist in IndexedDB or Firebase
   Storage before the note document is allowed to sync.
*/
function referencedStoredMediaIds(sourceNotes=notes){
  const set=new Set();
  sourceNotes.forEach(n=>{
    const tags=String(n.content||'').match(/<[^>]*\b(?:data-media-id|data-original-media-id)="[^"]+"[^>]*>/g)||[];
    tags.forEach(tag=>{
      if(/\bdata-media-kind="link"/.test(tag)) return;
      const matches=tag.match(/\b(?:data-media-id|data-original-media-id)="([^"]+)"/g);
      if(matches){
        matches.forEach(m=>set.add(m.match(/"([^"]+)"/)[1]));
      }
    });
  });
  return set;
}
async function gcOrphanMedia(){
  try{
    const all=await mediaAll();
    const used=referencedMediaIds();
    for(const rec of all){
      // Skip media currently being saved (in-flight async saveMediaBlob)
      if(pendingSaveIds.has(rec.id)) continue;
      if(!used.has(rec.id)) await mediaDel(rec.id);
    }
    renderStorageStats();
  }catch(e){}
}
async function renderStorageStats(){
  let total = 0;
  let quotaBytes = 500 * 1024 * 1024; // Fallback quota
  let usingEstimate = false;

  if (navigator.storage && navigator.storage.estimate) {
    try {
      const est = await navigator.storage.estimate();
      total = est.usage || 0;
      quotaBytes = est.quota || quotaBytes;
      usingEstimate = true;
    } catch(e) {}
  }

  if (!usingEstimate) {
    const jsonBytes=new Blob([JSON.stringify(notes)]).size;
    let mediaBytes=0;
    try{ (await mediaAll()).forEach(r=>mediaBytes+=(r.size||0)); }catch(e){}
    total=jsonBytes+mediaBytes;
  }

  const formatBytesStr = (bytes) => {
    if (bytes >= 1024*1024*1024) return (bytes / (1024*1024*1024)).toFixed(2) + ' GB';
    if (bytes >= 1024*1024) return (bytes / (1024*1024)).toFixed(2) + ' MB';
    return (bytes / 1024).toFixed(1) + ' KB';
  };

  const usageLabel = formatBytesStr(total);
  const quotaLabel = formatBytesStr(quotaBytes);
  const pct = ((total / quotaBytes) * 100).toFixed(1);
  const isWarning = (total / quotaBytes) >= 0.90;

  const liveCount=notes.filter(n=>!n.deletedAt).length;
  const trashCount=notes.length-liveCount;

  const el = document.getElementById('storageText');
  if(el){
    el.textContent = `${liveCount} note${liveCount!==1?'s':''}${trashCount?` · ${trashCount} in Trash`:''} · ${usageLabel} used`;
    el.title = `Browser Storage: ${usageLabel} of ${quotaLabel} used (${pct}%)`;
  }

  const fill = document.getElementById('storageFill');
  if(fill){
    fill.style.width = Math.max(1, Math.min(100, (total / quotaBytes) * 100)) + '%';
    if(isWarning){
      fill.classList.add('is-warning');
    } else {
      fill.classList.remove('is-warning');
    }
  }

  // Update Storage Sense Settings UI if present
  const senseEl = document.getElementById('settingsStorageText');
  if(senseEl){
    senseEl.textContent = `Usage: ${usageLabel} / Quota: ${quotaLabel} (${pct}%)`;
    if(isWarning) senseEl.style.color = 'var(--danger-color)';
    else senseEl.style.color = 'inherit';
  }
}

async function runStorageSense() {
  if (typeof toast === 'function') toast('Running Storage Sense... cleaning up memory and caches');
  let freed = 0;
  
  // 1. GC Orphaned Media
  const beforeGC = await navigator.storage.estimate().then(e => e.usage).catch(()=>0);
  await gcOrphanMedia();
  
  // 2. Revoke blob URLs from RAM
  revokeCachedURLs();
  
  // 3. Clear old service worker caches
  try {
    if ('caches' in window) {
      const keys = await caches.keys();
      const currentCache = window.PAPERUSS_BUILD?.cacheName || 'paperuss-shell-v22';
      for (const key of keys) {
        if (key !== currentCache && key.startsWith('paperuss-shell')) {
          await caches.delete(key);
        }
      }
    }
  } catch(e) {}
  
  const afterGC = await navigator.storage.estimate().then(e => e.usage).catch(()=>0);
  freed = beforeGC > afterGC ? (beforeGC - afterGC) : 0;
  
  await renderStorageStats();
  if (typeof toast === 'function') {
    if (freed > 0) {
      toast(`Storage Sense complete! Freed ${formatBytes(freed)}`);
    } else {
      toast('Storage Sense complete! Your storage is already fully optimized.');
    }
  }
}

/* Hydrate media placeholders in the loaded editor with real blob URLs or remote cloudUrls */
async function hydrateMediaInEditor(){
  const ed=document.getElementById('noteBody');
  if(!ed) return;
  const nodes=ed.querySelectorAll('[data-media-id]');
  for(const el of nodes){
    const id=el.getAttribute('data-media-id');
    const kind=el.getAttribute('data-media-kind');
    if(kind==='link') continue; // rich links don't need blob URLs
    const url = await getMediaURL(id);
    if(!url){
      el.setAttribute('data-missing','1');
      if(el.tagName==='IMG' && typeof setupBrokenImageElement==='function'){
        setupBrokenImageElement(el);
      }
      continue;
    }
    el.removeAttribute('data-missing');
    if(el.tagName==='IMG' || el.tagName==='AUDIO' || el.tagName==='VIDEO'){
      el.src=url;
    } else if(el.classList.contains('media-card')){
      // Attach a click handler for download button
      el.dataset.blobUrl=url;
    }
    const record = (await mediaGet(id)) || (window.__remoteMediaManifest || new Map()).get(id) || { id, cloudUrl: url };
    addMediaSyncIndicator(el, record);
  }
  const deadImgs = ed.querySelectorAll('img:not([data-media-id])');
  for(const img of deadImgs){
    if(img.complete && img.naturalWidth === 0 && typeof setupBrokenImageElement==='function'){
      setupBrokenImageElement(img);
    }
  }
  if(typeof autoCaptureExternalImages==='function') autoCaptureExternalImages();
  refreshIcons();
}

let notes = [];
// Queued remote note update to apply on next editor blur (set by scheduleActiveNoteRefresh)
let _pendingRemoteNote = null;
let state = {
  currentId: null,
  filter: 'all',
  tag: null,
  query: '',
  sort: 'updated',
  suppressInput: false,
  mediaTypeFilter: 'all',
  currentMediaId: null,
  calendarYear: new Date().getFullYear(),
  calendarMonth: new Date().getMonth(),
  calendarView: localStorage.getItem('octonotes:calendarView')||'month',
  calendarSelectedDate: +(localStorage.getItem('octonotes:calendarSelectedDate')||Date.now()),
  taskFilter: 'today',
  selectedImageEl: null,
  lightboxScale: 1,
  lightboxTranslateX: 0,
  lightboxTranslateY: 0
};
// Restore the persisted calendar position from the selected date.
if(state.calendarSelectedDate){
  const persistedCalendarDate=new Date(state.calendarSelectedDate);
  state.calendarYear=persistedCalendarDate.getFullYear();
  state.calendarMonth=persistedCalendarDate.getMonth();
}

function refreshIcons(){
  try{
    if(window.lucide && typeof window.lucide.createIcons === 'function'){
      window.lucide.createIcons();
    }
  }catch(e){}
}

function load(){
  try{
    notes = sanitizeNoteCollection(JSON.parse(localStorage.getItem(STORAGE_KEY)) || []);
  }catch(e){ notes = []; }

  // Migrate from v1 markdown notes if present
  if(!notes.length){
    try{
      const old = JSON.parse(localStorage.getItem('octonotes:v1')) || [];
      if(old.length){
        notes = sanitizeNoteCollection(old.map(n=>({
          ...n,
          content: looksLikeHtml(n.content) ? n.content : mdToHtml(n.content||'')
        })));
        save();
      }
    }catch(e){}
  }
  if(!notes.length){
    notes=seedNotes();
    localStorage.setItem('paperuss:seedNoteIds',JSON.stringify(notes.map(note=>note.id)));
    save();
  }
}
function save(){
  localStorage.setItem(STORAGE_KEY, JSON.stringify(notes));
  if(typeof queueCloudSync==='function') queueCloudSync();
}
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2,7);
function looksLikeHtml(s){ return /<\/?[a-z][\s\S]*>/i.test(s||''); }

/* ============================================================
   MARKDOWN → HTML (for migration + seed convenience)
   ============================================================ */
function esc(s){
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
function inline(text){
  text = esc(text);
  const codes = [];
  text = text.replace(/`([^`]+)`/g,(m,c)=>{codes.push(c);return '\u0000'+(codes.length-1)+'\u0000';});
  text = text.replace(/!\[([^\]]*)\]\(([^)\s]+)\)/g,'<img alt="$1" src="$2">');
  text = text.replace(/\[([^\]]+)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g,'<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>');
  text = text.replace(/\*\*([^*]+)\*\*/g,'<strong>$1</strong>').replace(/__([^_]+)__/g,'<strong>$1</strong>');
  text = text.replace(/~~([^~]+)~~/g,'<s>$1</s>');
  text = text.replace(/(^|[^*])\*(?!\s)([^*\n]+)\*(?!\*)/g,'$1<em>$2</em>');
  text = text.replace(/(^|[^_])_(?!\s)([^_\n]+)_(?!_)/g,'$1<em>$2</em>');
  text = text.replace(/\u0000(\d+)\u0000/g,(m,i)=>'<code>'+codes[i]+'</code>');
  return text;
}
function mdToHtml(md){
  if(!md || !md.trim()) return '';
  const lines = md.replace(/\r\n/g,'\n').split('\n');
  let html='', i=0;
  while(i < lines.length){
    let line = lines[i];
    if(/^```/.test(line.trim())){
      let code=''; i++;
      while(i<lines.length && !/^```/.test(lines[i].trim())){ code+=lines[i]+'\n'; i++; }
      i++;
      html+='<pre><code>'+esc(code.replace(/\n$/,''))+'</code></pre>'; continue;
    }
    if(/^\s*$/.test(line)){ i++; continue; }
    if(/\|/.test(line) && i+1<lines.length && /^\s*\|?\s*:?-{2,}/.test(lines[i+1])){
      const splitRow = (r)=> r.replace(/^\s*\|/,'').replace(/\|\s*$/,'').split('|').map(c=>c.trim());
      const header = splitRow(lines[i]);
      const rows = [];
      i += 2;
      while(i<lines.length && /\|/.test(lines[i]) && !/^\s*$/.test(lines[i])){ rows.push(splitRow(lines[i])); i++; }
      html += '<table><thead><tr>'+header.map(h=>'<th>'+inline(h)+'</th>').join('')+'</tr></thead><tbody>';
      html += rows.map(r=>'<tr>'+r.map(c=>'<td>'+inline(c)+'</td>').join('')+'</tr>').join('');
      html += '</tbody></table>'; continue;
    }
    let m = line.match(/^(#{1,6})\s+(.*)$/);
    if(m){ const lv=m[1].length; html+='<h'+lv+'>'+inline(m[2])+'</h'+lv+'>'; i++; continue; }
    if(/^(\s*[-*_]){3,}\s*$/.test(line)){ html+='<hr>'; i++; continue; }
    if(/^\s*[-*+]\s+/.test(line)){
      let items='', isTask=false;
      while(i<lines.length && /^\s*[-*+]\s+/.test(lines[i])){
        let item=lines[i].replace(/^\s*[-*+]\s+/,'');
        let tm=item.match(/^\[([ xX])\]\s+(.*)$/);
        if(tm){
          isTask=true;
          const chk=tm[1].toLowerCase()==='x';
          items+='<li data-task="1"><input type="checkbox" '+(chk?'checked':'')+'> '+inline(tm[2])+'</li>';
        } else items+='<li>'+inline(item)+'</li>';
        i++;
      }
      html+='<ul>'+items+'</ul>'; continue;
    }
    if(/^\s*\d+\.\s+/.test(line)){
      let items='';
      while(i<lines.length && /^\s*\d+\.\s+/.test(lines[i])){
        items+='<li>'+inline(lines[i].replace(/^\s*\d+\.\s+/,''))+'</li>'; i++;
      }
      html+='<ol>'+items+'</ol>'; continue;
    }
    if(/^\s*>\s?/.test(line)){
      let buf='';
      while(i<lines.length && /^\s*>\s?/.test(lines[i])){ buf+=lines[i].replace(/^\s*>\s?/,'')+'\n'; i++; }
      html+='<blockquote><p>'+inline(buf.trim().replace(/\n/g,' '))+'</p></blockquote>'; continue;
    }
    let para='';
    while(i<lines.length && !/^\s*$/.test(lines[i]) && !/^(#{1,6}\s|```|(\s*[-*+]\s)|(\s*\d+\.\s)|\s*>\s?|(\s*[-*_]){3,}\s*$)/.test(lines[i])){
      para+=lines[i]+' '; i++;
    }
    html+='<p>'+inline(para.trim())+'</p>';
  }
  return html;
}

/* ============================================================
   HELPERS
   ============================================================ */
function getNote(id){ return notes.find(n=>n.id===id); }
function debounce(fn,ms){ let t; return (...a)=>{ clearTimeout(t); t=setTimeout(()=>fn(...a),ms); }; }
function timeAgo(ts){
  const d=Date.now()-ts, s=Math.floor(d/1000);
  if(s<60) return 'just now';
  const m=Math.floor(s/60); if(m<60) return m+'m ago';
  const h=Math.floor(m/60); if(h<24) return h+'h ago';
  const dd=Math.floor(h/24); if(dd<7) return dd+'d ago';
  return new Date(ts).toLocaleDateString(undefined,{month:'short',day:'numeric'});
}
function fullDate(ts){ return new Date(ts).toLocaleString(undefined,{month:'short',day:'numeric',hour:'2-digit',minute:'2-digit'}); }
function stripHtml(html){
  const d=document.createElement('div');
  d.innerHTML=typeof sanitizeNoteHTML==='function'?sanitizeNoteHTML(html||''):(html||'');
  return (d.textContent||'').replace(/\s+/g,' ').trim();
}
function titleOf(n){ return (n.title||stripHtml(n.content).slice(0,80)||'Untitled'); }
function isEditorEmpty(html){
  const t=stripHtml(html);
  return !t && !/<img\b/i.test(html||'');
}

/* ============================================================
   RENDER
   ============================================================ */
const bodyEl = () => document.getElementById('noteBody');

function renderSidebar(){
  const liveNotes=notes.filter(n=>!n.deletedAt);
  document.getElementById('countAll').textContent = liveNotes.filter(n=>!n.archived).length;
  document.getElementById('countPinned').textContent = liveNotes.filter(n=>n.pinned&&!n.archived).length;
  document.getElementById('countArchived').textContent = liveNotes.filter(n=>n.archived).length;
  const trashEl=document.getElementById('countTrash');
  if(trashEl) trashEl.textContent=notes.filter(n=>n.deletedAt).length;
  const calendarCount = liveNotes.filter(n=>(n.tags||[]).includes('calendar')||(n.tags||[]).some(t=>t==='meeting'||t==='deadline')).length;
  const calEl=document.getElementById('countCalendar');
  if(calEl) calEl.textContent = calendarCount;
  renderStorageStats();
  updateMediaCount();
  updateTasksCount();
  document.querySelectorAll('.nav-btn').forEach(b=>b.classList.toggle('active', b.dataset.filter===state.filter && !state.tag));
  refreshIcons();
}

function updateTasksCount(){
  let count=0;
  notes.forEach(n=>{
    if(n.deletedAt||!n.content) return;
    const matches=n.content.match(/type=["']?checkbox["']?/gi)||[];
    count += matches.length;
  });
  count += standaloneTasks.length;
  const pending = standaloneTasks.filter(t=>!t.completed).length;
  const el=document.getElementById('countTasks');
  if(el) el.textContent=count;
  const statPill=document.getElementById('tasksStatPill');
  if(statPill) statPill.textContent=`${count} task${count!==1?'s':''}`;
  // Badge the nav item when reminders are overdue
  const overdue=standaloneTasks.filter(t=>!t.completed && t.due && t.due<=Date.now()).length;
  if(el){
    el.style.background = overdue ? 'var(--danger)' : '';
    el.style.color = overdue ? '#fff' : '';
    el.title = overdue ? `${overdue} overdue` : `${pending} pending`;
  }
}

function collectLinksFromNotes(sourceNotes=notes){
  const links=[];
  sourceNotes.forEach(n=>{
    if(n.deletedAt || !n.content) return;
    const parser=document.createElement('div');
    parser.innerHTML=typeof sanitizeNoteHTML==='function'?sanitizeNoteHTML(n.content||''):(n.content||'');
    const anchorElements=parser.querySelectorAll('[data-media-kind="link"], a[href]');
    anchorElements.forEach(a=>{
      const href=a.getAttribute('href');
      if(!href || href.startsWith('#') || href.startsWith('javascript:')) return;
      const title=a.querySelector('.mc-title')?.textContent || a.textContent?.trim() || href;
      let host=a.querySelector('.mc-meta')?.textContent || '';
      if(!host){
        try{ host=new URL(href).hostname.replace(/^www\./,''); }catch(_){ host=href; }
      }
      const id=a.getAttribute('data-media-id') || ('l_'+href);
      if(!links.some(l=>l.id===id || l.url===href)){
        links.push({
          id,
          kind:'link',
          name:title,
          type:'web/link',
          url:href,
          host,
          size:0,
          createdAt:n.createdAt||Date.now(),
          refNote:n
        });
      }
    });
  });
  return links;
}

async function mediaAllWithLinks(){
  let dbMedia=[];
  try{ dbMedia=await mediaAll(); }catch(_){ dbMedia=[]; }
  const links=collectLinksFromNotes();
  return [...dbMedia, ...links];
}

async function updateMediaCount(){
  try{
    const dbMedia=await mediaAll();
    const links=collectLinksFromNotes();
    const totalCount=dbMedia.length + links.length;
    const countEl=document.getElementById('countMedia');
    if(countEl) countEl.textContent=totalCount;
    const statPill=document.getElementById('mhStatPill');
    if(statPill){
      const bytes=dbMedia.reduce((s,r)=>s+(r.size||0), 0);
      statPill.textContent=`${totalCount} item${totalCount!==1?'s':''} (${dbMedia.length} asset${dbMedia.length!==1?'s':''}, ${links.length} link${links.length!==1?'s':''}) · ${formatBytes(bytes)}`;
    }
  }catch(e){}
}


function filteredNotes(){
  let arr=notes.filter(n=>{
    if(state.filter==='trash'){
      if(!n.deletedAt) return false;
    }else if(n.deletedAt) return false;
    if(state.filter==='all' && n.archived) return false;
    if(state.filter==='pinned' && (!n.pinned || n.archived)) return false;
    if(state.filter==='archived' && !n.archived) return false;
    if(state.tag && !(n.tags||[]).includes(state.tag)) return false;
    if(state.query){
      const q=state.query.toLowerCase();
      if(!titleOf(n).toLowerCase().includes(q) && !stripHtml(n.content).toLowerCase().includes(q) && !(n.tags||[]).join(' ').toLowerCase().includes(q)) return false;
    }
    return true;
  });
  const s=state.sort;
  arr.sort((a,b)=>{
    if(s==='title') return titleOf(a).localeCompare(titleOf(b));
    if(s==='created') return b.createdAt-a.createdAt;
    return b.updatedAt-a.updatedAt;
  });
  if(state.filter==='all' && s!=='title') arr.sort((a,b)=>(b.pinned?1:0)-(a.pinned?1:0));
  return arr;
}

function renderList(){
  if(state.filter==='media'){
    renderMediaList();
    return;
  }
  if(state.filter==='calendar'){
    renderCalendarPlannerList();
    return;
  }
  const c=document.getElementById('notesContainer');
  let arr=filteredNotes();
  let titleText=state.tag?('#'+state.tag) : ({all:'All Notes',pinned:'Pinned',archived:'Archived',trash:'Trash',calendar:'Events / Planner',tasks:'Tasks & Todos',settings:'Settings'}[state.filter]);
  document.getElementById('listTitle').textContent = titleText || 'All Notes';

  if(state.filter==='settings'){
    // Settings renders as a full page; the note-list column is hidden.
    c.innerHTML='';
    return;
  }
  if(state.filter==='tasks'){
    arr = arr.filter(n=>n.content && /type=["']?checkbox["']?/i.test(n.content));
  }
  if(!arr.length){
    c.innerHTML=state.filter==='trash'
      ? `<div class="list-empty"><i data-lucide="trash-2" style="width:30px;height:30px;margin:0 auto 10px;opacity:.45"></i>Trash is empty.<br>Deleted notes will appear here.</div>`
      : `<div class="list-empty">No notes match.<br>Try a different filter or create a new note.</div>`;
    refreshIcons();
    return;
  }
  c.innerHTML=arr.map(n=>{
    const prev=stripHtml(n.content).slice(0,140);
    const content=n.content||'';
    const hasImage=content.includes('data-media-kind="image"')||content.includes('<img');
    const hasVideo=content.includes('data-media-kind="video"')||content.includes('<video');
    const hasAudio=content.includes('data-media-kind="audio"')||content.includes('<audio');
    const hasFile=content.includes('data-media-kind="file"');
    const mediaCount=((content).match(/data-media-id="/g)||[]).length;
    let mediaIcon='';
    if(hasImage) mediaIcon='<i data-lucide="image" class="w-3.5 h-3.5 text-accent" title="Has images"></i>';
    else if(hasVideo) mediaIcon='<i data-lucide="video" class="w-3.5 h-3.5 text-accent" title="Has video"></i>';
    else if(hasAudio) mediaIcon='<i data-lucide="mic" class="w-3.5 h-3.5 text-accent" title="Has audio"></i>';
    else if(hasFile) mediaIcon='<i data-lucide="paperclip" class="w-3.5 h-3.5 text-accent" title="Has attachments"></i>';
    return `<div class="note-card ${n.id===state.currentId?'active':''}" data-id="${n.id}">
      <div class="note-title">
        ${n.pinned?'<i data-lucide="pin" class="w-3.5 h-3.5 note-pin"></i>':''}
        ${esc(titleOf(n))}
        ${mediaIcon}
      </div>
      <div class="note-preview">${prev?esc(prev):'<span style="color:var(--fg-muted)">Empty note</span>'}</div>
      <div class="note-meta">
        ${n.deletedAt?'<span class="archived">In Trash</span>':(n.archived?'<span class="archived">Archived</span>':'')}
        <span>${n.deletedAt?'Deleted '+timeAgo(n.deletedAt):timeAgo(n.updatedAt)}</span>
        ${mediaCount?`<span class="media-badge" title="${mediaCount} attachment${mediaCount!==1?'s':''}">
          <i data-lucide="paperclip" class="w-3 h-3"></i>${mediaCount}</span>`:''}
        ${(n.tags||[]).slice(0,2).map(t=>'<span class="chip">'+esc(t)+'</span>').join('')}
      </div>
    </div>`;
  }).join('');
  refreshIcons();
}

function captureEditorSelection(editor){
  const selection=window.getSelection();
  if(!selection || !selection.rangeCount || !editor.contains(selection.anchorNode)) return null;
  const pathFor=node=>{
    const path=[];
    while(node && node!==editor){
      const parent=node.parentNode;
      if(!parent) return null;
      path.unshift(Array.prototype.indexOf.call(parent.childNodes,node));
      node=parent;
    }
    return node===editor?path:null;
  };
  const range=selection.getRangeAt(0);
  const startPath=pathFor(range.startContainer);
  const endPath=pathFor(range.endContainer);
  return startPath&&endPath?{startPath,startOffset:range.startOffset,endPath,endOffset:range.endOffset}:null;
}

function restoreEditorSelection(editor,savedSelection){
  if(!savedSelection) return;
  const nodeFor=path=>path.reduce((node,index)=>node?.childNodes[index]||null,editor);
  const start=nodeFor(savedSelection.startPath);
  const end=nodeFor(savedSelection.endPath);
  if(!start || !end) return;
  const safeOffset=(node,offset)=>Math.min(offset,node.nodeType===Node.TEXT_NODE?node.textContent.length:node.childNodes.length);
  try{
    const range=document.createRange();
    range.setStart(start,safeOffset(start,savedSelection.startOffset));
    range.setEnd(end,safeOffset(end,savedSelection.endOffset));
    const selection=window.getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
  }catch(_){ /* A changed remote document has no safe equivalent selection. */ }
}

function renderEditor(){
  const empty=document.getElementById('editorEmpty');
  const content=document.getElementById('editorContent');
  const mhView=document.getElementById('mediaHubView');
  const calView=document.getElementById('calendarView');
  const tasksView=document.getElementById('tasksView');
  const settingsView=document.getElementById('settingsView');

  const listPanel=document.getElementById('noteList');

  // Page reactive header buttons
  const shareBtn=document.getElementById('shareBtn');
  const printBtn=document.getElementById('printBtn');
  const isSpecialPage = ['media','calendar','tasks','settings'].includes(state.filter);
  const activeNote = getNote(state.currentId);
  const isNoteEditable = !isSpecialPage && activeNote && !activeNote.deletedAt;

  if(shareBtn) shareBtn.style.display = isNoteEditable ? 'inline-flex' : 'none';
  if(printBtn) printBtn.style.display = isNoteEditable ? 'inline-flex' : 'none';
  const moreShareBtn=document.getElementById('moreShareBtn');
  const morePrintBtn=document.getElementById('morePrintBtn');
  if(moreShareBtn) moreShareBtn.style.display=isNoteEditable?'':'none';
  if(morePrintBtn) morePrintBtn.style.display=isNoteEditable?'':'none';

  if(mhView) mhView.classList.remove('show');
  if(calView) calView.classList.remove('show');
  if(tasksView) tasksView.classList.remove('show');
  if(settingsView) settingsView.classList.remove('show');
  // Restore the note-list column when leaving Settings
  if(listPanel) listPanel.classList.remove('settings-hidden');

  if(state.filter==='settings'){
    if(empty) empty.style.display='none';
    if(content) content.classList.remove('show');
    if(settingsView) settingsView.classList.add('show');
    // Settings takes the full page: hide the note-list column
    if(listPanel) listPanel.classList.add('settings-hidden');
    // On phones the editor pane must be brought forward
    if(window.innerWidth<=640) showMobileEditor();
    renderSettingsView();
    return;
  }
  if(state.filter==='media'){
    if(empty) empty.style.display='none';
    if(content) content.classList.remove('show');
    if(mhView) mhView.classList.add('show');
    renderMediaHubView();
    return;
  }
  if(state.filter==='calendar'){
    if(empty) empty.style.display='none';
    if(content) content.classList.remove('show');
    if(calView) calView.classList.add('show');
    renderCalendarView();
    return;
  }
  if(state.filter==='tasks'){
    if(empty) empty.style.display='none';
    if(content) content.classList.remove('show');
    if(tasksView) tasksView.classList.add('show');
    renderTasksView();
    return;
  }

  const n=getNote(state.currentId);
  if(!n){
    const trashEmpty=state.filter==='trash';
    const emptyTitle=empty.querySelector('h2');
    const emptyText=empty.querySelector('p');
    const emptyCreate=empty.querySelector('button');
    if(emptyTitle) emptyTitle.textContent=trashEmpty?'Trash is empty':'No note selected';
    if(emptyText) emptyText.textContent=trashEmpty
      ? 'Notes moved to Trash can be restored before they are permanently deleted.'
      : 'Pick a note from the list, or create a new one to start writing.';
    if(emptyCreate) emptyCreate.style.display=trashEmpty?'none':'inline-flex';
    empty.style.display='flex';
    content.classList.remove('show','trash-preview');
    revokeCachedURLs();
    return;
  }
  const emptyCreate=empty.querySelector('button');
  if(emptyCreate) emptyCreate.style.display='inline-flex';
  empty.style.display='none'; content.classList.add('show');
  const trashMode=state.filter==='trash'&&!!n.deletedAt;
  content.classList.toggle('trash-preview',trashMode);
  const titleInput=document.getElementById('noteTitle');
  titleInput.value=n.title||'';
  titleInput.readOnly=trashMode;
  state.suppressInput=true;
  revokeCachedURLs();
  const ed=bodyEl();
  // Background sync refreshes the editor after a paste or edit. Keep the live
  // range so replacing innerHTML cannot send the caret back to the first block.
  const savedSelection=!trashMode && document.activeElement===ed ? captureEditorSelection(ed) : null;
  ed.setAttribute('contenteditable',trashMode?'false':'true');
  const tagInput=document.getElementById('tagInput');
  if(tagInput) tagInput.disabled=trashMode;
  const fontStyle = n.fontStyle || 'sans';
  ed.setAttribute('data-fontstyle', fontStyle);
  const fsLabel = document.getElementById('fontStyleLabel');
  const fsMap = {'sans':'Sans', 'serif':'Serif', 'mono':'Mono', 'rounded':'Rounded'};
  if(fsLabel) fsLabel.textContent = fsMap[fontStyle] || 'Sans';
  document.querySelectorAll('#fontStyleDropdown .fs-opt').forEach(opt=>{
    opt.classList.toggle('active', opt.dataset.fontstyle === fontStyle);
  });

  // Only replace the DOM when content actually changed. This prevents the
  // 60-second cloud sync from resetting the cursor / scrollposition when no
  // remote data has arrived. Also preserve scroll position across real swaps.
  const incomingContent = typeof sanitizeNoteHTML==='function'?sanitizeNoteHTML(n.content||''):(n.content||'');
  if(incomingContent!==n.content) n.content=incomingContent;
  const editorScroll = document.getElementById('editorScroll');
  if(ed.innerHTML !== incomingContent){
    const savedScroll = editorScroll ? editorScroll.scrollTop : 0;
    ed.innerHTML = incomingContent;
    if(editorScroll) editorScroll.scrollTop = savedScroll;
  }
  if(typeof normalizeEditorTables==='function') normalizeEditorTables();
  if(trashMode){
    ed.querySelectorAll('input,button,select,textarea').forEach(control=>{ control.disabled=true; });
    ed.querySelectorAll('table').forEach(table=>table.setAttribute('contenteditable','false'));
  }
  state.suppressInput=false;
  hydrateMediaInEditor();
  if(window.HistoryManager && window.HistoryManager.activeNoteId !== n.id) {
    window.HistoryManager.reset(n.id);
  }
  if(typeof renderNotebookCover==='function') renderNotebookCover();
  if(typeof normalizeEditorImages==='function') normalizeEditorImages();
  if(typeof applyPageLayoutToEditor==='function') applyPageLayoutToEditor(n);
  if(typeof syncPageLayoutDropdown==='function') syncPageLayoutDropdown(n);
  restoreEditorSelection(ed,savedSelection);
  if(typeof clearImageSelection==='function') clearImageSelection();
  if(trashMode&&typeof clearCellSelection==='function'){
    clearCellSelection();
    activeCell=null;
    positionTableTools();
  }
  renderTags(n);
  renderStats(n);
  const pinBtn=document.getElementById('pinBtn');
  const archiveBtn=document.getElementById('archiveBtn');
  const restoreBtn=document.getElementById('restoreBtn');
  const deleteBtn=document.getElementById('deleteBtn');
  pinBtn.style.display=trashMode?'none':'';
  archiveBtn.style.display=trashMode?'none':'';
  restoreBtn.style.display=trashMode?'inline-flex':'none';
  pinBtn.style.color = n.pinned?'var(--attention)':'';
  archiveBtn.style.color = n.archived?'var(--attention)':'';
  deleteBtn.title=trashMode?'Delete permanently':'Move to Trash';
  deleteBtn.setAttribute('aria-label',deleteBtn.title);
  const morePinBtn=document.getElementById('morePinBtn');
  const moreArchiveBtn=document.getElementById('moreArchiveBtn');
  const moreDeleteBtn=document.getElementById('moreDeleteBtn');
  if(morePinBtn) morePinBtn.style.display=trashMode?'none':'';
  if(moreArchiveBtn) moreArchiveBtn.innerHTML=trashMode
    ? '<i data-lucide="rotate-ccw" class="w-4 h-4"></i> Restore note'
    : '<i data-lucide="archive" class="w-4 h-4"></i> Archive / Restore';
  if(moreDeleteBtn) moreDeleteBtn.innerHTML=trashMode
    ? '<i data-lucide="trash-2" class="w-4 h-4"></i> Delete permanently'
    : '<i data-lucide="trash-2" class="w-4 h-4"></i> Move to Trash';
  document.getElementById('saveStatus').className='save-status';
  document.getElementById('saveStatus').innerHTML=trashMode
    ? '<span class="dot"></span><span>Deleted '+timeAgo(n.deletedAt)+'</span>'
    : '<span class="dot"></span><span>Saved '+timeAgo(n.updatedAt)+'</span>';
  updateToolbarState();
  refreshIcons();
}

async function renderMediaList(){
  const c=document.getElementById('notesContainer');
  document.getElementById('listTitle').textContent = 'Media Assets & Links';
  try{
    let all=await mediaAllWithLinks();
    if(state.mediaTypeFilter && state.mediaTypeFilter!=='all'){
      all=all.filter(r=>r.kind===state.mediaTypeFilter);
    }
    if(state.query){
      const q=state.query.toLowerCase();
      all=all.filter(r=>r.name.toLowerCase().includes(q) || r.kind.toLowerCase().includes(q) || (r.url&&r.url.toLowerCase().includes(q)));
    }
    all.sort((a,b)=>b.createdAt - a.createdAt);
    if(!all.length){
      c.innerHTML=`<div class="list-empty">No media or links found.<br>Attach images, voice, files, or rich links in your notes.</div>`;
      refreshIcons();
      return;
    }
    c.innerHTML=all.map(r=>{
      const active=r.id===state.currentMediaId?'active':'';
      let iconName='file';
      if(r.kind==='image') iconName='image';
      else if(r.kind==='audio') iconName='mic';
      else if(r.kind==='video') iconName='video';
      else if(r.kind==='link') iconName='globe';
      return `<div class="note-card ${active}" data-media-card-id="${esc(r.id)}">
        <div class="note-title" style="align-items:center">
          <i data-lucide="${iconName}" class="w-4 h-4 text-accent"></i>
          <span>${esc(r.name)}</span>
        </div>
        <div class="note-preview">${esc(r.kind==='link'?(r.host||r.url):(r.type||'file'))}</div>
        <div class="note-meta">
          <span>${r.kind==='link'?'Web link':formatBytes(r.size)}</span>
          <span>${timeAgo(r.createdAt)}</span>
        </div>
      </div>`;
    }).join('');
  }catch(e){
    c.innerHTML=`<div class="list-empty">Failed to load media assets.</div>`;
  }
  refreshIcons();
}

async function renderMediaHubView(){
  const gridEl=document.getElementById('mhGrid');
  const detailEl=document.getElementById('mhDetailView');
  const bodyEl=document.getElementById('mhBody');
  document.querySelectorAll('#mhTabs .mh-tab').forEach(b=>{
    b.classList.toggle('active', b.dataset.mhtab===(state.mediaTypeFilter||'all'));
  });

  try{
    let all=await mediaAllWithLinks();
    if(state.mediaTypeFilter && state.mediaTypeFilter!=='all'){
      all=all.filter(r=>r.kind===state.mediaTypeFilter);
    }
    if(state.query){
      const q=state.query.toLowerCase();
      all=all.filter(r=>r.name.toLowerCase().includes(q) || r.kind.toLowerCase().includes(q) || (r.url&&r.url.toLowerCase().includes(q)));
    }
    all.sort((a,b)=>b.createdAt - a.createdAt);

    if(state.currentMediaId){
      if(bodyEl) bodyEl.style.display='none';
      if(detailEl){
        detailEl.style.display='flex';
        detailEl.classList.add('show');
        let rec=await mediaGet(state.currentMediaId);
        if(!rec){
          rec=collectLinksFromNotes().find(l=>l.id===state.currentMediaId);
        }
        if(!rec){
          state.currentMediaId=null;
          renderMediaHubView();
          return;
        }
        const rawUrl=rec.kind==='link'?rec.url:(await getMediaURL(rec.id));
        const url=rec.kind==='link'
          ? ((typeof paperussSafeUrl!=='function'||paperussSafeUrl(rawUrl,'href','A'))?rawUrl:'')
          : rawUrl;
        const refNote=rec.refNote||notes.find(n=>n.content && n.content.includes(rec.id));
        let previewHtml='';
        if(rec.kind==='image'){
          previewHtml=`<div class="mh-detail-preview"><img src="${esc(url)}" alt="${esc(rec.name)}" data-mh-preview-image style="cursor:zoom-in"></div>`;
        } else if(rec.kind==='video'){
          previewHtml=`<div class="mh-detail-preview"><video controls src="${esc(url)}"></video></div>`;
        } else if(rec.kind==='audio'){
          previewHtml=`<div class="mh-detail-preview" style="padding:24px"><audio controls src="${esc(url)}"></audio></div>`;
        } else if(rec.kind==='link'){
          const favicon=`https://www.google.com/s2/favicons?domain=${encodeURIComponent(rec.host||'google.com')}&sz=64`;
          previewHtml=`<div class="mh-detail-preview" style="padding:32px;display:flex;flex-direction:column;align-items:center;gap:12px">
            <img src="${favicon}" alt="" style="width:48px;height:48px;border-radius:12px">
            <h3 style="font-size:17px;font-weight:700;color:var(--fg);text-align:center">${esc(rec.name)}</h3>
            ${url?`<a href="${esc(url)}" target="_blank" rel="noopener noreferrer" class="text-accent" style="word-break:break-all;font-size:13px;font-weight:500">${esc(url)}</a>`:'<span class="text-fg-muted">Unsafe link blocked</span>'}
          </div>`;
        } else {
          previewHtml=`<div class="mh-detail-preview" style="padding:40px"><i data-lucide="file-text" class="w-16 h-16 text-accent"></i></div>`;
        }

        const actionBtns=rec.kind==='link'?`
          <button class="btn btn-primary" id="mhOpenLinkBtn" ${url?'':'disabled'}><i data-lucide="external-link" class="w-4 h-4"></i> Open Link</button>
        `:`
          <button class="btn" id="mhDownloadBtn"><i data-lucide="download" class="w-4 h-4"></i> Download</button>
          <button class="btn btn-danger" id="mhDeleteBtn"><i data-lucide="trash-2" class="w-4 h-4"></i> Delete</button>
        `;

        detailEl.innerHTML=`
          <div class="mh-detail-top">
            <button class="btn" id="mhDetailBackBtn"><i data-lucide="arrow-left" class="w-4 h-4"></i> Back to Gallery</button>
            <div style="display:flex;gap:8px">
              ${actionBtns}
            </div>
          </div>
          ${previewHtml}
          <div class="mh-detail-meta-box">
            <div class="mh-detail-row">
              <span class="text-fg-muted font-medium">${rec.kind==='link'?'Title':'Filename'}</span>
              <span class="font-semibold">${esc(rec.name)}</span>
            </div>
            <div class="mh-detail-row">
              <span class="text-fg-muted font-medium">Type / MIME</span>
              <span>${esc(rec.type||rec.kind)}</span>
            </div>
            <div class="mh-detail-row">
              <span class="text-fg-muted font-medium">${rec.kind==='link'?'Domain / Host':'File Size'}</span>
              <span>${rec.kind==='link'?esc(rec.host||rec.url):formatBytes(rec.size)}</span>
            </div>
            <div class="mh-detail-row">
              <span class="text-fg-muted font-medium">Created</span>
              <span>${new Date(rec.createdAt).toLocaleString()}</span>
            </div>
            ${refNote ? `
              <div class="mh-detail-row" style="align-items:center">
                <span class="text-fg-muted font-medium">Attached in Note</span>
                <button class="mh-note-link" data-jump-note="${esc(refNote.id)}">
                  <i data-lucide="file-text" class="w-3.5 h-3.5"></i>
                  <span>${esc(titleOf(refNote))}</span>
                  <i data-lucide="arrow-right" class="w-3.5 h-3.5"></i>
                </button>
              </div>
            `: `
              <div class="mh-detail-row">
                <span class="text-fg-muted font-medium">Attached in Note</span>
                <span class="text-fg-muted">Unattached / Orphan asset</span>
              </div>
            `}
          </div>
        `;
        detailEl.querySelector('#mhDetailBackBtn')?.addEventListener('click',closeMediaDetail);
        detailEl.querySelector('[data-mh-preview-image]')?.addEventListener('click',()=>openImageLightbox(url));
        detailEl.querySelector('#mhOpenLinkBtn')?.addEventListener('click',()=>openLinkInAppOrTab(url));
        detailEl.querySelector('#mhDownloadBtn')?.addEventListener('click',()=>downloadMediaById(rec.id,rec.name));
        detailEl.querySelector('#mhDeleteBtn')?.addEventListener('click',()=>confirmDeleteMediaAsset(rec.id,rec.name));
        detailEl.querySelector('[data-jump-note]')?.addEventListener('click',event=>{ event.stopPropagation(); jumpToNote(event.currentTarget.dataset.jumpNote); });
      }
    } else {
      if(bodyEl) bodyEl.style.display='flex';
      if(detailEl){ detailEl.style.display='none'; detailEl.classList.remove('show'); }
      if(!all.length){
        gridEl.innerHTML=`<div class="list-empty" style="grid-column:1/-1">No items in this view.<br>Upload attachments or paste links into your notes!</div>`;
      } else {
        const cardsHtml=await Promise.all(all.map(async r=>{
          const url=r.kind==='link'?r.url:(await getMediaURL(r.id));
          const refNote=r.refNote||notes.find(n=>n.content && n.content.includes(r.id));
          let thumbContent=`<i data-lucide="file" class="mh-thumb-icon"></i>`;
          if(r.kind==='image'){
            thumbContent=`<img src="${esc(url)}" alt="${esc(r.name)}" loading="lazy">`;
          } else if(r.kind==='video'){
            thumbContent=`<i data-lucide="video" class="mh-thumb-icon"></i>`;
          } else if(r.kind==='audio'){
            thumbContent=`<i data-lucide="mic" class="mh-thumb-icon"></i>`;
          } else if(r.kind==='link'){
            const safeHost=String(r.host||'google.com').replace(/[^A-Za-z0-9.-]/g,'').slice(0,253)||'google.com';
            const favicon=`https://www.google.com/s2/favicons?domain=${encodeURIComponent(safeHost)}&sz=64`;
            thumbContent=`<img src="${esc(favicon)}" alt="" loading="lazy" decoding="async" style="width:36px;height:36px;border-radius:8px">`;
          }
          return `<div class="mh-card" data-mh-select="${esc(r.id)}">
            <div class="mh-thumb">${thumbContent}</div>
            <div class="mh-info">
              <div class="mh-title">${esc(r.name)}</div>
              <div class="mh-meta">
                <span>${r.kind==='link'?esc(r.host||'Web Link'):formatBytes(r.size)}</span>
                <span>${timeAgo(r.createdAt)}</span>
              </div>
              ${refNote ? `
                <div class="mh-note-link" data-jump-note="${esc(refNote.id)}" title="Jump to Note">
                  <i data-lucide="file-text" class="w-3 h-3"></i>
                  <span>${esc(titleOf(refNote))}</span>
                </div>
              ` : ''}
            </div>
          </div>`;
        }));
        gridEl.innerHTML=cardsHtml.join('');
      }
    }
  }catch(e){
    gridEl.innerHTML=`<div class="list-empty" style="grid-column:1/-1">Failed to load media gallery.</div>`;
  }
  refreshIcons();
}

function closeMediaDetail(){
  state.currentMediaId=null;
  renderMediaHubView();
  renderList();
}

function selectMediaAsset(id){
  state.currentMediaId=id;
  renderMediaHubView();
  renderList();
  showMobileEditor();
}

function jumpToNote(noteId){
  state.filter='all';
  state.tag=null;
  state.currentMediaId=null;
  document.querySelectorAll('.nav-btn').forEach(b=>b.classList.toggle('active', b.dataset.filter==='all'));
  selectNote(noteId);
}

function confirmDeleteMediaAsset(id, name){
  confirmDialog('Delete media asset?', `"${esc(name)}" will be permanently deleted from local storage.`, 'Delete', async ()=>{
    await mediaDel(id);
    state.currentMediaId=null;
    // Remove references in note contents if any
    notes.forEach(n=>{
      if(n.content && n.content.includes(id)){
        const tmp=document.createElement('div');
        tmp.innerHTML=n.content;
        const selectorId=(window.CSS&&typeof CSS.escape==='function')?CSS.escape(String(id)):String(id).replace(/[^A-Za-z0-9_.:-]/g,'');
        if(selectorId) tmp.querySelectorAll(`[data-media-id="${selectorId}"],[data-media-card-id="${selectorId}"],[data-original-media-id="${selectorId}"]`).forEach(el=>el.remove());
        n.content=tmp.innerHTML;
        n.updatedAt=Date.now();
      }
    });
    save();
    renderAll();
    toast('Media asset deleted');
    addNotification({type:'media',title:'Media asset deleted',body:`"${name}" was removed from local storage.`,icon:'trash-2',activity:true});
  });
}

function renderTags(n){
  const wrap=document.getElementById('tagChips');
  wrap.innerHTML=(n.tags||[]).map(t=>`<span class="tag-chip">${esc(t)}<button data-rmtag="${esc(t)}" title="Remove">×</button></span>`).join('');
}

function renderStats(n){
  const text=stripHtml(n.content||'');
  const words=text?text.split(/\s+/).filter(Boolean).length:0;
  document.getElementById('wordCount').textContent=words+' word'+(words!==1?'s':'');
  document.getElementById('charCount').textContent=text.length+' chars';
  document.getElementById('updatedTime').textContent='Edited '+fullDate(n.updatedAt);
}

function reconcileCurrentNote(){
  if(!['all','pinned','archived','trash'].includes(state.filter)) return;
  const visible=filteredNotes();
  if(!state.currentId||!visible.some(n=>n.id===state.currentId)){
    state.currentId=visible[0]?.id||null;
  }
}

function renderAll(){
  reconcileCurrentNote();
  renderSidebar();
  renderList();
  renderEditor();
}

/* ============================================================
   SYNC-SAFE ACTIVE NOTE REFRESH
   Called by cloud sync when the active note has a newer remote
   version. Defers the DOM update if the user is currently typing.
   ============================================================ */
function scheduleActiveNoteRefresh(remoteNote){
  if(!remoteNote || !remoteNote.id) return;
  const ed=bodyEl();
  const titleInput=document.getElementById('noteTitle');
  const isEditorFocused=document.activeElement===ed || document.activeElement===titleInput;

  if(!isEditorFocused){
    // Safe to apply immediately — only swap if remote is genuinely newer
    const local=getNote(remoteNote.id);
    if(!local || (remoteNote.updatedAt||0) > (local.updatedAt||0)){
      const idx=notes.findIndex(n=>n.id===remoteNote.id);
      if(idx!==-1) notes[idx]=remoteNote; else notes.push(remoteNote);
      renderEditor();   // targeted — no full list/sidebar rebuild
    }
    return;
  }

  // Editor is focused — queue the update for application on next blur
  // so we don't interrupt an active typing session.
  _pendingRemoteNote=remoteNote;
}

