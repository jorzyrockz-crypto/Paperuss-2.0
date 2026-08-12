/* ============================================================
   SYNC ENGINE - Handles all Firebase/Firestore communication
   ============================================================ */

function updateSyncStatusForRun(runId, newState, customText) {
  if (runId !== syncGeneration || !syncInFlight) return;
  updateSyncStatus(newState, customText);
}

function updateSyncStatus(newState, customText){
  syncState=newState;
  const pill=document.getElementById('syncStatusPill');
  const text=document.getElementById('syncStatusText');
  const detail=document.getElementById('setSyncDetail');
  const session=currentSession||loadSession()||{mode:'guest'};
  const labels={
    offline: customText||(session.mode==='auth'?'Offline ┬╖ will sync when online':'Offline ┬╖ local only'),
    synced: customText||('Synced ┬╖ '+(getLastSyncLabel())),
    partial: customText||('Synced (Partial) ┬╖ '+(getLastSyncLabel())),
    syncing: customText||'SyncingΓÇª',
    error: customText||'Sync error ┬╖ retry later'
  };
  const msg=labels[newState]||labels.offline;
  if(pill){ pill.className='sync-status-pill '+newState; }
  if(text) text.textContent=msg;
  if(detail) detail.textContent=msg;
}

function getLastSyncLabel(){
  const ts=+localStorage.getItem(LAST_SYNC_KEY)||0;
  return ts?timeAgo(ts):'never';
}

function readCloudDeletions(){
  try{
    const value=JSON.parse(localStorage.getItem(CLOUD_DELETIONS_KEY));
    return value && typeof value==='object'
      ? {notes:value.notes||{},tasks:value.tasks||{},media:value.media||{}}
      : {notes:{},tasks:{},media:{}};
  }catch(_){
    return {notes:{},tasks:{},media:{}};
  }
}

function writeCloudDeletions(value){
  localStorage.setItem(CLOUD_DELETIONS_KEY,JSON.stringify(value));
}

function recordCloudDeletion(kind,id){
  if(cloudSyncApplyingRemote || !id) return;
  const value=readCloudDeletions();
  if(!value[kind]) value[kind]={};
  value[kind][id]=Date.now();
  writeCloudDeletions(value);
  queueCloudSync();
}

function clearCloudDeletion(kind,id){
  const value=readCloudDeletions();
  if(value[kind]) delete value[kind][id];
  writeCloudDeletions(value);
}

function mergeDeletionSets(localValue,remoteValue){
  const merged={notes:{},tasks:{},media:{}};
  Object.keys(merged).forEach(kind=>{
    const local=(localValue&&localValue[kind])||{};
    const remote=(remoteValue&&remoteValue[kind])||{};
    new Set([...Object.keys(local),...Object.keys(remote)]).forEach(id=>{
      merged[kind][id]=Math.max(+local[id]||0,+remote[id]||0);
    });
  });
  return merged;
}

function mergeById(localArr,remoteArr,tsField,deletions){
  const map=new Map();
  (remoteArr||[]).forEach(r=>{
    const existing = map.get(r.id);
    if (!existing || (r[tsField]||0) >= (existing[tsField]||0)) {
      map.set(r.id, r);
    }
  });
  (localArr||[]).forEach(l=>{
    const r=map.get(l.id);
    if(!r || (l[tsField]||0) >= (r[tsField]||0)) map.set(l.id, l);
  });
  Object.keys(deletions||{}).forEach(id=>{
    const deletedAt = deletions[id];
    const record = map.get(id);
    if(record) {
      if ((+deletedAt||0) > (record[tsField]||record.createdAt||0)) {
        map.delete(id);
      } else {
        deletions[id] = 0; // Neutralize stale tombstone
      }
    }
  });
  return Array.from(map.values());
}

function markPortableStateChanged(){
  if(cloudSyncApplyingRemote) return;
  localStorage.setItem(PORTABLE_STATE_UPDATED_KEY,String(Date.now()));
  queueCloudSync();
}

function collectPortableState(){
  return {
    theme:localStorage.getItem(THEME_KEY)||'olive-groove',
    themeMode:localStorage.getItem(THEME_MODE_KEY)||(typeof getThemeMode==='function' ? getThemeMode() : 'light'),
    calendarView:state.calendarView||'month',
    calendarSelectedDate:+state.calendarSelectedDate||Date.now(),
    notifications:(appNotifications||[]).slice(0,200),
    profilePhoto:localStorage.getItem(PROFILE_PHOTO_KEY)||''
  };
}

function applyPortableState(value){
  if(!value || typeof value!=='object') return;
  if(value.theme){
    /* Route synced themes through the same validator/side effects as a local
       selection so named palettes update color-scheme, meta theme color, and
       the theme toggle icon instead of leaving a half-applied DOM attribute. */
    if(typeof setTheme==='function') setTheme(value.theme,false);
    else {
      localStorage.setItem(THEME_KEY,value.theme);
      document.documentElement.setAttribute('data-theme',value.theme);
      const fallbackMode=value.themeMode==='dark' ? 'dark' : 'light';
      localStorage.setItem(THEME_MODE_KEY,fallbackMode);
      document.documentElement.setAttribute('data-theme-mode',fallbackMode);
    }
  }
  if(value.themeMode && typeof setThemeMode==='function') setThemeMode(value.themeMode,false);
  if(value.calendarView) state.calendarView=value.calendarView;
  if(value.calendarSelectedDate){
    state.calendarSelectedDate=+value.calendarSelectedDate;
    const selected=new Date(state.calendarSelectedDate);
    state.calendarYear=selected.getFullYear();
    state.calendarMonth=selected.getMonth();
  }
  localStorage.setItem('octonotes:calendarView',state.calendarView);
  localStorage.setItem('octonotes:calendarSelectedDate',String(state.calendarSelectedDate));
  if(Array.isArray(value.notifications)){
    appNotifications=value.notifications.slice(0,200);
    localStorage.setItem(NOTIF_KEY,JSON.stringify(appNotifications));
    updateNotifBadge();
  }
  if(typeof value.profilePhoto==='string'){
    if(value.profilePhoto) localStorage.setItem(PROFILE_PHOTO_KEY,value.profilePhoto);
    else localStorage.removeItem(PROFILE_PHOTO_KEY);
  }
}

function mediaStorageRef(uid,id){
  return fbStorage.ref().child(`paperuss_users/${uid}/media/${id}`);
}

async function fetchFirestoreMediaDataUrl(uid, id){
  if(!fbDb) return null;
  const docSnap = await fbDb.collection('paperuss_users').doc(uid).collection('media').doc(id).get();
  if(!docSnap || !docSnap.exists) return null;
  const data = docSnap.data();
  if(data.chunked === true && data.totalChunks > 0){
    const chunkPromises = [];
    for(let c = 0; c < data.totalChunks; c++){
      chunkPromises.push(fbDb.collection('paperuss_users').doc(uid).collection('media').doc(`${id}_chunk_${c}`).get());
    }
    const chunkSnaps = await Promise.all(chunkPromises);
    return chunkSnaps.map(snap => (snap && snap.exists && snap.data().data) || '').join('');
  }
  return data.dataUrl || null;
}

function mediaManifestEntry(record){
  return {
    id:record.id,
    kind:record.kind||'file',
    name:record.name||'file',
    type:record.type||'application/octet-stream',
    size:+record.size||record.blob?.size||0,
    cloudUrl:record.cloudUrl||'',
    chunked:!!record.chunked,
    totalChunks:+record.totalChunks||1,
    createdAt:+record.createdAt||Date.now(),
    updatedAt:+record.updatedAt||+record.createdAt||Date.now()
  };
}

function withTimeout(promise, ms, errmsg){
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(errmsg || `Operation timed out after ${ms}ms`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

function withCancellableTimeout(uploadTask, ms, errmsg){
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => {
      try { uploadTask.cancel(); } catch(_) {}
      reject(new Error(errmsg || `Upload timed out and was cancelled after ${ms}ms`));
    }, ms);
  });
  return Promise.race([uploadTask, timeout]).finally(() => clearTimeout(timer));
}

function readOfflineUploadQueue(){
  try{ return JSON.parse(localStorage.getItem(OFFLINE_UPLOAD_QUEUE_KEY))||{}; }catch(_){ return {}; }
}

function addToOfflineUploadQueue(id){
  const q=readOfflineUploadQueue();
  q[id]={id, queuedAt:Date.now()};
  localStorage.setItem(OFFLINE_UPLOAD_QUEUE_KEY,JSON.stringify(q));
}

function removeFromOfflineUploadQueue(id){
  const q=readOfflineUploadQueue();
  delete q[id];
  localStorage.setItem(OFFLINE_UPLOAD_QUEUE_KEY,JSON.stringify(q));
}

function drainOfflineQueue(){
  const q=readOfflineUploadQueue();
  if(Object.keys(q).length>0){
    console.log(`PapeRuss: Draining ${Object.keys(q).length} queued media upload(s) after reconnect`);
    queueCloudSync();
  }
}

function schedulePendingMediaRetry(){
  clearTimeout(mediaRetryTimer);
  mediaRetryTimer=null;
  mediaAll().then(records=>{
    const retryAt=records
      .filter(record=>record.pendingUpload && (record.uploadFailures||0) > 0 && (record.uploadFailures||0) < MAX_UPLOAD_FAILURES)
      .map(record=>{
        const failures=record.uploadFailures||0;
        const backoffMs=Math.min(UPLOAD_RETRY_BASE_MS*Math.pow(2,failures-1),8*60*1000);
        return (record.lastUploadAttempt||0)+backoffMs;
      });
    if(!retryAt.length) return;
    const delay=Math.max(0,Math.min(...retryAt)-Date.now());
    mediaRetryTimer=setTimeout(()=>syncNow({silent:true}),delay);
  }).catch(()=>{});
}

function timeoutForSize(bytes){
  return Math.min(Math.max(20000, Math.round(bytes * 1.5)), 15*60*1000);
}

async function syncMedia(uid, deletions, requiredMediaIds, runId) {
  const res = { ok: true, status: 'success', reason: null, stats: { attempted: 0, succeeded: 0, failed: 0, skipped: 0, retryable: 0 }, errors: [] };
  const localUpdateSyncStatus = (state, text) => {
    if (runId !== undefined) updateSyncStatusForRun(runId, state, text);
    else updateSyncStatus(state, text);
  };
  const localRecords = await mediaAll();
  const storageConsecutiveFailures = window.__fbStorageFailCount || 0;
  const useStorage = !FIRESTORE_ONLY_MEDIA && !!(fbStorage && storageConsecutiveFailures < 3);

  const localMap = new Map(localRecords.map(record => [record.id, record]));

  for (const [id, deletedAt] of Object.entries(deletions || {})) {
    const local = localMap.get(id);
    if ((+deletedAt || 0) < (local?.updatedAt || local?.createdAt || 0)) continue;
    cloudSyncApplyingRemote = true;
    try { await mediaDel(id); } catch (_) {} finally { cloudSyncApplyingRemote = false; }
    localMap.delete(id);
    
    try {
      const metaSnap = await fbDb.collection('paperuss_users').doc(uid).collection('media').doc(id).get();
      if (metaSnap.exists) {
        const remote = metaSnap.data();
        if (remote.chunked && remote.totalChunks) {
          for (let c = 0; c < remote.totalChunks; c++) {
            try { await fbDb.collection('paperuss_users').doc(uid).collection('media').doc(id + "_chunk_" + c).delete(); } catch (_) {}
          }
        }
        await fbDb.collection('paperuss_users').doc(uid).collection('media').doc(id).delete();
      }
    } catch (_) {}
    if (useStorage) {
      try { await mediaStorageRef(uid, id).delete(); }
      catch (err) { if (!String(err?.code || '').includes('object-not-found')) console.warn(err); }
    }
  }

  const pendingUploads = Array.from(localMap.values()).filter(record => {
    if (!record.pendingUpload || (record.uploadFailures || 0) >= MAX_UPLOAD_FAILURES) return false;
    const failures = record.uploadFailures || 0;
    if (!failures) return true;
    const backoffMs = Math.min(UPLOAD_RETRY_BASE_MS * Math.pow(2, failures - 1), 8 * 60 * 1000);
    const isBackoff = Date.now() - (record.lastUploadAttempt || 0) < backoffMs;
    if (isBackoff) {
      res.stats.skipped++;
      res.errors.push({ id: record.id, code: 'backoff', retryable: true });
      res.stats.retryable++;
    }
    return !isBackoff;
  });

  if (res.stats.skipped > 0) {
    res.ok = false;
    res.status = 'partial';
  }

  if (pendingUploads.length > 0) {
    console.log('PapeRuss: Cloud sync uploading ' + pendingUploads.length + ' media asset(s)...');
    localUpdateSyncStatus('syncing', 'Uploading ' + pendingUploads.length + ' asset(s)...');
  }

  for (let i = 0; i < pendingUploads.length; i++) {
    const record = pendingUploads[i];
    res.stats.attempted++;
    if (!(record.blob instanceof Blob)) {
      res.stats.failed++;
      res.errors.push({ id: record.id, code: 'missing_blob', retryable: false });
      const failedRecord = {
        ...record, pendingUpload: true, uploadFailures: MAX_UPLOAD_FAILURES,
        lastUploadAttempt: Date.now(), uploadError: 'The local media file is missing from this browser.'
      };
      try { await mediaPut(failedRecord); } catch (_) {}
      localMap.set(record.id, failedRecord);
      removeFromOfflineUploadQueue(record.id);
      console.error('PapeRuss: Media ' + record.id + ' cannot upload because its local Blob is missing');
      document.dispatchEvent(new CustomEvent('media-upload-progress', {
        detail: { id: record.id, percent: 0, error: true, failures: MAX_UPLOAD_FAILURES }
      }));
      continue;
    }
    const fileBytes = record.blob.size || 0;
    const label = record.name || 'file';
    localUpdateSyncStatus('syncing', 'Uploading ' + (i + 1) + '/' + pendingUploads.length + ': ' + label + ' (' + formatBytes(fileBytes) + ')');

    try { await mediaPut({ ...record, lastUploadAttempt: Date.now() }); } catch (_) {}

    try {
      let cloudUrl = record.cloudUrl || '';
      let uploadedToStorage = false;
      if (useStorage) {
        try {
          const storageRef = mediaStorageRef(uid, record.id);
          const uploadTask = storageRef.put(record.blob, {
            contentType: record.type || record.blob?.type || 'application/octet-stream'
          });

          uploadTask.on('state_changed', snapshot => {
            const pct = snapshot.totalBytes > 0
              ? Math.round((snapshot.bytesTransferred / snapshot.totalBytes) * 100) : 0;
            document.dispatchEvent(new CustomEvent('media-upload-progress', {
              detail: { id: record.id, percent: pct, bytesTransferred: snapshot.bytesTransferred, totalBytes: snapshot.totalBytes }
            }));
            localUpdateSyncStatus('syncing',
              'Uploading ' + (i + 1) + '/' + pendingUploads.length + ': ' + label + ' - ' + pct + '% (' + formatBytes(snapshot.bytesTransferred) + '/' + formatBytes(snapshot.totalBytes) + ')'
            );
          });

          await withCancellableTimeout(uploadTask, timeoutForSize(fileBytes), 'Upload timed out for ' + label);
          cloudUrl = await storageRef.getDownloadURL();
          uploadedToStorage = true;
          window.__fbStorageFailCount = 0;

          await fbDb.collection('paperuss_users').doc(uid).collection('media').doc(record.id).set({
            id: record.id, type: record.type || record.blob?.type || 'application/octet-stream', size: fileBytes,
            name: label, uploadedToStorage: true, updatedAt: Date.now()
          }, { merge: true });

        } catch (storageErr) {
          console.warn('PapeRuss: Cloud Storage upload failed for ' + record.id + ' (' + (storageErr.message || storageErr.code) + '), using Firestore media sync');
          window.__fbStorageFailCount = (window.__fbStorageFailCount || 0) + 1;
          if (window.__fbStorageFailCount >= 3) {
            console.warn('PapeRuss: Cloud Storage disabled after 3 consecutive failures');
          }
        }
      }

      if (!uploadedToStorage) {
        if (!fbAuth || !fbAuth.currentUser || fbAuth.currentUser.uid !== uid) {
          throw new Error('permission-denied: Please sign in to sync media with your account');
        }
        let workingBlob = record.blob;
        let workingBytes = fileBytes;
        const mimeType = record.type || record.blob?.type || 'application/octet-stream';
        if (mimeType.startsWith('image/') && workingBytes > 600000 && typeof downscaleImageBlob === 'function') {
          try {
            workingBlob = await downscaleImageBlob(workingBlob, 1440, 400 * 1024);
            workingBytes = workingBlob.size || workingBytes;
          } catch (_) {}
        }
        const dataUrl = await blobToDataURL(workingBlob);
        const CHUNK_CHAR_SIZE = 600000;
        let chunked = false;
        let totalChunks = 1;
        if (dataUrl.length <= 900000) {
          await fbDb.collection('paperuss_users').doc(uid).collection('media').doc(record.id).set({
            id: record.id, dataUrl: dataUrl, type: mimeType, size: workingBytes, name: label, chunked: false, totalChunks: 1, updatedAt: Date.now()
          }, { merge: true });
        } else {
          chunked = true;
          totalChunks = Math.ceil(dataUrl.length / CHUNK_CHAR_SIZE);
          const chunkPromises = [];
          for (let c = 0; c < totalChunks; c++) {
            const sliceData = dataUrl.slice(c * CHUNK_CHAR_SIZE, (c + 1) * CHUNK_CHAR_SIZE);
            chunkPromises.push(
              fbDb.collection('paperuss_users').doc(uid).collection('media').doc(record.id + "_chunk_" + c).set({
                parentId: record.id, chunkIndex: c, data: sliceData, updatedAt: Date.now()
              })
            );
          }
          await Promise.all(chunkPromises);
          await fbDb.collection('paperuss_users').doc(uid).collection('media').doc(record.id).set({
            id: record.id, type: mimeType, size: workingBytes, name: label, chunked: true, totalChunks: totalChunks, updatedAt: Date.now()
          }, { merge: true });
        }
        if (workingBlob !== record.blob) {
          record.blob = workingBlob;
          record.size = workingBytes;
        }
        record.chunked = chunked;
        record.totalChunks = totalChunks;
        cloudUrl = 'firestore:' + record.id;
        document.dispatchEvent(new CustomEvent('media-upload-progress', {
          detail: { id: record.id, percent: 100, bytesTransferred: workingBytes, totalBytes: workingBytes }
        }));
      }

      const localUpdated = record.updatedAt || record.createdAt || Date.now();
      const syncedRecord = {
        ...record, cloudUrl, cloudSyncedAt: localUpdated, pendingUpload: false, uploadFailures: 0, lastUploadAttempt: Date.now()
      };
      try { await mediaPut(syncedRecord); } catch (_) {}
      localMap.set(record.id, syncedRecord);
      removeFromOfflineUploadQueue(record.id);
      res.stats.succeeded++;

    } catch (uploadErr) {
      const errMsg = uploadErr?.message || uploadErr?.code || String(uploadErr);
      console.error('PapeRuss: Media upload failed for ' + record.id + ':', uploadErr);
      const isPermDenied = String(errMsg).includes('permission-denied');
      const isAuthExpired = isPermDenied && (!fbAuth || !fbAuth.currentUser);
      if (isPermDenied && !isAuthExpired) {
        toast('ΓÜá∩╕Å Access denied by Firestore security rules. Please check your sign-in session.');
      }
      const failures = (record.uploadFailures || 0) + 1;
      const failedRecord = { ...record, pendingUpload: true, uploadFailures: failures, lastUploadAttempt: Date.now() };
      try { await mediaPut(failedRecord); } catch (_) {}
      localMap.set(record.id, failedRecord);
      
      const retryable = failures < MAX_UPLOAD_FAILURES && !(isPermDenied && !isAuthExpired);
      if (!retryable) removeFromOfflineUploadQueue(record.id);
      else addToOfflineUploadQueue(record.id);
      
      document.dispatchEvent(new CustomEvent('media-upload-progress', {
        detail: { id: record.id, percent: 0, error: true, failures }
      }));
      if (failures === 1) toast('ΓÜá∩╕Å Media upload failed: ' + errMsg + ' ΓÇö will retry automatically');
      else if (failures >= MAX_UPLOAD_FAILURES) toast('Γ¥î "' + label + '" could not be uploaded after ' + failures + ' attempts.', () => { if (typeof syncNow === 'function') syncNow(); }, 'Retry Now');
      
      res.stats.failed++;
      res.errors.push({ id: record.id, code: 'network', retryable });
      if (retryable) res.stats.retryable++;
    }
  }

  const needsIds = requiredMediaIds instanceof Set ? requiredMediaIds : new Set(requiredMediaIds || []);
  for (const id of needsIds) {
    if (localMap.has(id)) continue;
    try {
      res.stats.attempted++;
      let blob = null, cloudUrl = null, size = 0, name = 'file', type = 'application/octet-stream', updatedAt = Date.now();
      const metaSnap = await fbDb.collection('paperuss_users').doc(uid).collection('media').doc(id).get();
      if (!metaSnap.exists) { res.stats.failed++; res.errors.push({ id, code: 'not_found', retryable: false }); continue; }
      
      const meta = metaSnap.data();
      size = meta.size || 0; name = meta.name || 'file'; type = meta.type || 'application/octet-stream'; updatedAt = meta.updatedAt || Date.now();

      if (meta.uploadedToStorage) {
        try {
          const url = await withTimeout(mediaStorageRef(uid, id).getDownloadURL(), 12000, 'Download URL timeout for ' + id);
          cloudUrl = url;
          const response = await withTimeout(fetch(url), timeoutForSize(size || 500000), 'Fetch timeout for ' + id);
          if (response.ok) blob = await response.blob();
        } catch (storageErr) {
          console.warn('PapeRuss: Storage download failed for ' + id, storageErr);
          res.stats.failed++; res.stats.retryable++; res.errors.push({ id, code: 'network', retryable: true });
          continue;
        }
      } else {
        const dataUrl = await fetchFirestoreMediaDataUrl(uid, id);
        if (dataUrl) { blob = dataURLToBlob(dataUrl); cloudUrl = 'firestore:' + id; }
      }
      if (blob) {
        const downloadedRecord = { id, type, size, name, blob, cloudUrl, cloudSyncedAt: updatedAt, pendingUpload: false, uploadFailures: 0 };
        await mediaPut(downloadedRecord);
        localMap.set(id, downloadedRecord);
        res.stats.succeeded++;
      }
    } catch (dlErr) {
      console.warn('PapeRuss: Media download warning for ' + id + ':', dlErr);
      res.stats.failed++; res.stats.retryable++; res.errors.push({ id, code: 'network', retryable: true });
    }
  }

  if (res.stats.failed > 0 || res.stats.skipped > 0) {
     res.ok = false;
     res.status = 'partial';
  }
  return res;
}

async function resetCloudWorkspace(){
  const session=currentSession||loadSession();
  if(!session || session.mode!=='auth') return true;
  if(!firebaseReady || !navigator.onLine){
    toast('Connect to the internet before resetting your synced workspace');
    return false;
  }
  try{
    const docRef=fbDb.collection('paperuss_users').doc(session.uid);

    // Delete all documents in Firestore subcollections (notes, tasks, media)
    try {
      const notesSnap = await docRef.collection('notes').get();
      await Promise.all(notesSnap.docs.map(d=>d.ref.delete()));
    } catch(_) {}
    try {
      const tasksSnap = await docRef.collection('tasks').get();
      await Promise.all(tasksSnap.docs.map(d=>d.ref.delete()));
    } catch(_) {}
    try {
      const mediaSnap = await docRef.collection('media').get();
      await Promise.all(mediaSnap.docs.map(d=>d.ref.delete()));
    } catch(_) {}

    const snap=await docRef.get();
    const manifest=snap.exists?(snap.data().mediaManifest||[]):[];
    if(fbStorage){
      await Promise.all(manifest.map(async item=>{
        try{ await mediaStorageRef(session.uid,item.id).delete(); }
        catch(err){ if(!String(err?.code||'').includes('object-not-found')) throw err; }
      }));
    }
    await docRef.delete();
    return true;
  }catch(err){
    console.error('PapeRuss cloud reset failed',err);
    toast('Cloud reset failed ΓÇö nothing was erased');
    return false;
  }
}

async function syncNow(opts){
  opts=opts||{};
  if(syncInFlight){ syncRequestedWhileBusy=true; return; }
  // Multi-tab safety: only one tab syncs at a time
  if(typeof navigator.locks !== 'undefined'){
    try {
      await navigator.locks.request('paperuss-sync-lock', { ifAvailable: true }, async lock => {
        if(!lock){ console.log('PapeRuss: Another tab is syncing, skipping'); return; }
        await _syncNowInner(opts);
      });
    } catch(_) {
      await _syncNowInner(opts);
    }
  } else {
    await _syncNowInner(opts);
  }
}

function aggregateSyncResults(results) {
  let hasOffline = false;
  let hasFailed = false;
  let hasPartial = false;
  let unresolvedSkipped = false;
  let retryable = 0;

  for (const result of Object.values(results)) {
    if (!result || typeof result !== 'object') continue;
    retryable += Number(result.stats?.retryable || 0);

    if (result.status === 'offline') {
      hasOffline = true;
    } else if (result.status === 'failed') {
      hasFailed = true;
    } else if (result.status === 'partial') {
      hasPartial = true;
    } else if (result.status === 'skipped' && result.reason !== 'nothing_to_do') {
      unresolvedSkipped = true;
    }
  }

  if (hasOffline) return { status: 'offline', retryable };
  if (hasFailed) return { status: 'error', retryable };
  if (hasPartial || unresolvedSkipped) return { status: 'partial', retryable };

  return { status: 'synced', retryable };
}

async function _syncNowInner(opts){
  const session=currentSession||loadSession();
  if(!session || session.mode!=='auth') return;
  if(syncInFlight){
    syncRequestedWhileBusy=true;
    return;
  }
  
  syncInFlight = true;
  const runId = ++syncGeneration;
  
  try {
    if(!navigator.onLine){
      updateSyncStatusForRun(runId, 'offline','Offline ┬╖ changes saved locally');
      return;
    }
    updateSyncStatusForRun(runId, 'syncing');

    if(!opts.silent){
      window.__fbStorageFailCount = 0;
      try{
        const allMedia = await mediaAll();
        const stuck = allMedia.filter(r=>r.pendingUpload && (r.uploadFailures||0) > 0);
        for(const r of stuck){
          await mediaPut({...r, uploadFailures: 0, lastUploadAttempt: 0});
        }
        if(stuck.length > 0) console.log('PapeRuss: Reset ' + stuck.length + ' stuck media upload(s) for retry');
      }catch(_){}
    }

    const withSyncTimeout = (promise, ms, name) => Promise.race([
      promise,
      new Promise((_, rej) => setTimeout(() => rej(new Error(name + ' timed out')), ms))
    ]);

    const docRef=fbDb.collection('paperuss_users').doc(session.uid);
    let snap, notesSnap, tasksSnap;
    try {
      snap      = await withSyncTimeout(docRef.get(), 15000, 'docRef.get');
      notesSnap = await withSyncTimeout(docRef.collection('notes').get(), 15000, 'notes.get');
      tasksSnap = await withSyncTimeout(docRef.collection('tasks').get(), 15000, 'tasks.get');
    } catch (readErr) {
      console.warn('PapeRuss: Initial Firestore read failed during sync', readErr);
      const isOffline = !navigator.onLine || String(readErr?.message || '').toLowerCase().includes('offline');
      if (isOffline) {
        updateSyncStatusForRun(runId, 'offline', 'Offline ┬╖ changes saved locally');
      } else {
        updateSyncStatusForRun(runId, 'partial', 'Sync incomplete ΓÇô could not reach cloud');
      }
      return;
    }
    const remote=snap.exists?snap.data():{};
    const remoteNotes = notesSnap.docs.map(d=>d.data());
    const remoteTasks = tasksSnap.docs.map(d=>d.data());

    if(remote.notes) remoteNotes.push(...remote.notes);
    if(remote.tasks) remoteTasks.push(...remote.tasks);

    standaloneTasks.forEach(task=>{ if(!task.updatedAt) task.updatedAt=task.createdAt||Date.now(); });
    const localDeletions=readCloudDeletions();
    const mergedDeletions=mergeDeletionSets(localDeletions,remote.deletions);
    let localNotes=notes;
    
    if(remoteNotes.length){
      try{
        const seedIds=new Set(JSON.parse(localStorage.getItem('paperuss:seedNoteIds'))||[]);
        if(seedIds.size) {
          localNotes=notes.filter(note=>{
            if (seedIds.has(note.id)) {
              // Only discard if unedited. If updated, keep it.
              return (note.updatedAt || 0) > (note.createdAt || 0);
            }
            return true;
          });
        }
      }catch(_){}
    }
    const mergedNotes=sanitizeNoteCollection(mergeById(localNotes,remoteNotes,'updatedAt',mergedDeletions.notes));
    const mergedTasks=sanitizeTaskCollection(mergeById(standaloneTasks,remoteTasks,'updatedAt',mergedDeletions.tasks));

    const localSettingsUpdated=+localStorage.getItem('octonotes:settingsUpdatedAt')||0;
    const mergedSettingsUpdated=Math.max(localSettingsUpdated,+remote.settingsUpdatedAt||0)||Date.now();
    const mergedSettings = normalizeAppSettings((+remote.settingsUpdatedAt||0)>localSettingsUpdated
      ? {...appSettings, ...(remote.settings||{})}
      : appSettings);
    const localPortableUpdated=+localStorage.getItem(PORTABLE_STATE_UPDATED_KEY)||0;
    const mergedPortableUpdated=Math.max(localPortableUpdated,+remote.portableStateUpdatedAt||0)||Date.now();
    const mergedPortable=(+remote.portableStateUpdatedAt||0)>localPortableUpdated
      ? {...collectPortableState(),...(remote.portableState||{})}
      : collectPortableState();

    // Snapshot pre-merge state so we can diff what actually changed
    const preMergeMap = new Map(notes.map(n=>[n.id, n.updatedAt||0]));

    cloudSyncApplyingRemote=true;
    try{
      notes=mergedNotes; standaloneTasks=mergedTasks; appSettings=mergedSettings;
      localStorage.setItem(STORAGE_KEY,JSON.stringify(notes));
      localStorage.setItem(TASKS_KEY,JSON.stringify(standaloneTasks));
      localStorage.setItem(SETTINGS_KEY,JSON.stringify(appSettings));
      localStorage.setItem('octonotes:settingsUpdatedAt',String(mergedSettingsUpdated));
      localStorage.setItem(PORTABLE_STATE_UPDATED_KEY,String(mergedPortableUpdated));
      localStorage.removeItem('paperuss:seedNoteIds');
      writeCloudDeletions(mergedDeletions);
      applyPortableState(mergedPortable);
      applySettingsEffects(); applyAccent(appSettings.accent||'blue');
      renderProfileMenu();

      // Compute what actually changed so we can skip unnecessary DOM work.
      // A note is "changed" if its id is new, deleted, or has a newer updatedAt.
      const postMergeMap = new Map(mergedNotes.map(n=>[n.id, n.updatedAt||0]));
      let anyNoteChanged = preMergeMap.size !== postMergeMap.size;
      let changedRemoteNote = null;
      if(!anyNoteChanged){
        for(const [id, ts] of postMergeMap){
          if(preMergeMap.get(id) !== ts){ anyNoteChanged=true; break; }
        }
        if(!anyNoteChanged){
          for(const id of preMergeMap.keys()){
            if(!postMergeMap.has(id)){ anyNoteChanged=true; break; }
          }
        }
      }

      if(anyNoteChanged){
        // Find the merged version of the active note to check if it changed
        const activeId=state.currentId;
        if(activeId){
          const mergedActive=mergedNotes.find(n=>n.id===activeId);
          const preMergeTs=preMergeMap.get(activeId)||0;
          if(mergedActive && (mergedActive.updatedAt||0) > preMergeTs){
            changedRemoteNote=sanitizeNoteRecord(mergedActive);
          }
        }

        if(changedRemoteNote && typeof scheduleActiveNoteRefresh==='function'){
          // Active note got a newer remote version ΓÇö defer/apply safely
          scheduleActiveNoteRefresh(changedRemoteNote);
          // Refresh the list and sidebar but NOT the editor (handled above)
          renderList();
          renderSidebar();
        } else {
          // Notes changed but not the active one ΓÇö rebuild list/sidebar only.
          // renderEditor() is skipped because the editor content is unchanged.
          renderList();
          renderSidebar();
        }
      }
      // If nothing changed: skip all DOM work (silent no-op for background poll)

      renderStorageStats();
      if(typeof rescheduleAllEventNotifications==='function') rescheduleAllEventNotifications();
    }finally{
      cloudSyncApplyingRemote=false;
    }

    const writePromises = [];
    const remoteNotesMap = new Map(remoteNotes.map(n=>[n.id, n.updatedAt||0]));
    const remoteTasksMap = new Map(remoteTasks.map(t=>[t.id, t.updatedAt||0]));

    mergedNotes.forEach(note => {
      if((note.updatedAt||0) > (remoteNotesMap.get(note.id)||-1)) {
        writePromises.push(docRef.collection('notes').doc(note.id).set(note, {merge:true}));
      }
    });
    mergedTasks.forEach(task => {
      if((task.updatedAt||0) > (remoteTasksMap.get(task.id)||-1)) {
        writePromises.push(docRef.collection('tasks').doc(task.id).set(task, {merge:true}));
      }
    });
    Object.keys(mergedDeletions.notes||{}).forEach(id => writePromises.push(docRef.collection('notes').doc(id).delete()));
    Object.keys(mergedDeletions.tasks||{}).forEach(id => writePromises.push(docRef.collection('tasks').doc(id).delete()));
    Object.keys(mergedDeletions.media||{}).forEach(id => writePromises.push(docRef.collection('media').doc(id).delete()));

    const rootUpdate = {
      settings: mergedSettings,
      settingsUpdatedAt: mergedSettingsUpdated,
      portableState: mergedPortable,
      portableStateUpdatedAt: mergedPortableUpdated,
      deletions: mergedDeletions,
      schemaVersion: 3,
      updatedAt: Date.now(),
      owner: session.uid,
      email: session.email||''
    };
    if (remote.notes || remote.tasks || remote.mediaManifest) {
      rootUpdate.notes = firebase.firestore.FieldValue.delete();
      rootUpdate.tasks = firebase.firestore.FieldValue.delete();
      rootUpdate.mediaManifest = firebase.firestore.FieldValue.delete();
    }
    writePromises.push(docRef.set(rootUpdate, {merge:true}));

    // Chunk promises to prevent "Payload Too Large" or connection drops
    for(let i=0; i<writePromises.length; i+=50){
      await Promise.race([
        Promise.all(writePromises.slice(i, i+50)),
        new Promise((_, rej) => setTimeout(() => rej(new Error('Network timeout')), 15000))
      ]);
    }

    const requiredMediaIds=typeof referencedStoredMediaIds==='function' ? referencedStoredMediaIds(mergedNotes) : new Set();
    const finalResults = {};
    
    try {
      finalResults.media = await withSyncTimeout(syncMedia(session.uid, mergedDeletions.media, requiredMediaIds, runId), 25000, 'syncMedia');
    } catch(mediaErr) {
      finalResults.media = { ok: false, status: 'partial', reason: 'timeout', stats: { retryable: 1 }, errors: [{ code: 'timeout', retryable: true }] };
    }

    if (window.BranchEngine && typeof window.BranchEngine.syncBranchesFromCloud === 'function') {
      try {
        finalResults.branches = await withSyncTimeout(window.BranchEngine.syncBranchesFromCloud(session.uid, fbDb), 25000, 'syncBranches');
      } catch (e) { finalResults.branches = { ok: false, status: 'partial', reason: 'timeout', stats: { retryable: 1 } }; }
    }
    
    if (window.paperussLeafManager && typeof window.paperussLeafManager.syncLeavesWithCloud === 'function') {
      try {
        finalResults.leavesUpload = await withSyncTimeout(window.paperussLeafManager.syncLeavesWithCloud(session.uid), 25000, 'syncLeavesWithCloud');
      } catch (e) { finalResults.leavesUpload = { ok: false, status: 'partial', reason: 'timeout', stats: { retryable: 1 } }; }
    }
    
    if (window.paperussLeafManager && typeof window.paperussLeafManager.hydrateAllNoteLeavesFromCloud === 'function') {
      try {
        finalResults.hydration = await withSyncTimeout(window.paperussLeafManager.hydrateAllNoteLeavesFromCloud(session.uid), 45000, 'hydrateAllNoteLeavesFromCloud');
      } catch (e) { finalResults.hydration = { ok: false, status: 'partial', reason: 'timeout', stats: { retryable: 1 } }; }
    }
    
    if (window.paperussLeafManager && typeof window.paperussLeafManager.syncNoteLeavesFromCloud === 'function' && typeof state !== 'undefined' && state && state.currentId) {
      try {
        finalResults.activeNote = await withSyncTimeout(window.paperussLeafManager.syncNoteLeavesFromCloud(state.currentId, session.uid), 25000, 'syncNoteLeavesFromCloud');
      } catch (e) { finalResults.activeNote = { ok: false, status: 'partial', reason: 'timeout', stats: { retryable: 1 } }; }
    }

    localStorage.setItem(LAST_SYNC_KEY, String(Date.now()));
    
    const summary = aggregateSyncResults(finalResults);
    
    if(summary.status === 'partial'){
      updateSyncStatusForRun(runId, 'partial','Sync incomplete - retry scheduled');
      if (summary.retryable > 0) schedulePendingMediaRetry();
    } else if (summary.status === 'error') {
      updateSyncStatusForRun(runId, 'error');
    } else if (summary.status === 'offline') {
      updateSyncStatusForRun(runId, 'offline', 'Offline');
    } else {
      updateSyncStatusForRun(runId, 'synced');
    }
    
    if(typeof hydrateMediaInEditor==='function') hydrateMediaInEditor();
    if(!opts.silent) toast(summary.status === 'partial' ? 'Notes synced; some items will retry automatically' : 'Synced with cloud');
  }catch(err){
    console.error('PapeRuss cloud sync failed',err);
    updateSyncStatusForRun(runId, 'error');
    if(!opts.silent) toast('Sync failed - changes saved locally');
  } finally {

    syncInFlight = false;
    if(syncRequestedWhileBusy){ 
      syncRequestedWhileBusy=false; 
      queueCloudSync(); 
    }
  }
}

function queueCloudSync(){
  const session=currentSession||loadSession();
  if(cloudSyncApplyingRemote || !session || session.mode!=='auth') return;
  if(syncInFlight){ syncRequestedWhileBusy=true; return; }
  clearTimeout(syncDebounceTimer);
  syncDebounceTimer=setTimeout(()=>syncNow({silent:true}), 2500);
}


function initSyncEngine() {
  window.addEventListener('online', ()=>{
    if((window.currentSession||{}).mode!=='auth') return;
    drainOfflineQueue();
    syncNow({silent:true});
  });
  window.addEventListener('offline', ()=>updateSyncStatus('offline'));
  setInterval(() => {
    if((window.currentSession||{}).mode==='auth' && navigator.onLine){
      drainOfflineQueue();
      syncNow({silent:true});
    }
  }, 60000);
  const RESYNC_STALE_MS = 60 * 1000;
  window.resyncIfStale = function(){
    if((window.currentSession||{}).mode!=='auth') return;
    if(!navigator.onLine) return;
    const lastSync = +localStorage.getItem('paperuss:lastSync')||0;
    if(Date.now() - lastSync > RESYNC_STALE_MS) queueCloudSync();
  }
  document.addEventListener('visibilitychange', ()=>{ if(document.visibilityState==='visible') window.resyncIfStale(); });
  window.addEventListener('focus', window.resyncIfStale);
}
async function syncLeavesWithCloud(uid, db) {
    const res = { ok: true, status: 'success', reason: null, stats: { attempted: 0, succeeded: 0, failed: 0, skipped: 0, retryable: 0 }, errors: [] };
    if (!uid || !window.paperussLeaves) return { ...res, ok: false, status: 'failed', reason: 'unauthenticated' };
    const fireDb = db || (typeof fbDb !== 'undefined' ? fbDb : (typeof firebase !== 'undefined' && firebase.firestore ? firebase.firestore() : null));
    if (!fireDb) return { ...res, ok: false, status: 'failed', reason: 'network', stats: { ...res.stats, retryable: 1 } };

    try {
      const queue = await window.paperussLeaves.leafQueueGetAll();
      if (!queue || queue.length === 0) return { ...res, status: 'skipped', reason: 'nothing_to_do' };

      const coalesced = new Map();
      for (const item of queue) {
        const key = (item.data && item.data.id) ? item.data.id : item.id;
        if (!coalesced.has(key)) coalesced.set(key, []);
        coalesced.get(key).push(item);
      }

      for (const [leafId, items] of coalesced.entries()) {
        items.sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0));
        const matItem = items.find(x => x.action === 'materialize');
        res.stats.attempted++;

        if (matItem) {
          try {
            const materializedData = (items[items.length - 1].data && items[items.length - 1].data.id)
              ? items[items.length - 1].data : matItem.data;
            const leafRef = fireDb.collection('paperuss_users').doc(uid).collection('notes').doc(matItem.noteId).collection('leaves').doc(materializedData.id);
            const noteRef = fireDb.collection('paperuss_users').doc(uid).collection('notes').doc(matItem.noteId);
            const cleanLeaf = {
              id: materializedData.id, noteId: matItem.noteId, title: materializedData.title || 'Main',
              content: materializedData.content || '', color: materializedData.color || 'slate',
              order: typeof materializedData.order === 'number' ? materializedData.order : 0,
              createdAt: materializedData.createdAt || Date.now(), updatedAt: materializedData.updatedAt || Date.now(), deletedAt: null
            };
            await fireDb.runTransaction(async (transaction) => {
              const noteSnap = await transaction.get(noteRef);
              const noteData = noteSnap.exists ? noteSnap.data() : {};
              let leafOrder = noteData.leafOrder || [];
              if (!Array.isArray(leafOrder)) leafOrder = [];
              if (!leafOrder.includes(materializedData.id)) leafOrder.unshift(materializedData.id);
              transaction.set(leafRef, cleanLeaf, { merge: true });
              transaction.set(noteRef, {
                defaultLeafId: noteData.defaultLeafId || materializedData.id,
                leafOrder: leafOrder, leafCount: leafOrder.length, updatedAt: matItem.timestamp || Date.now()
              }, { merge: true });
            });
            for (const i of items) await window.paperussLeaves.leafQueueDel(i.id);
            res.stats.succeeded++;
          } catch (e) {
            console.warn('Transaction materialization failed, leaving local note/leaf intact for retry:', e);
            res.stats.failed++; res.stats.retryable++; res.errors.push({ id: leafId, code: e.code || 'network', retryable: true });
          }
        } else {
          const latest = items[items.length - 1];
          const targetLeafId = (latest.data && latest.data.id) ? latest.data.id : leafId;
          const leafRef = fireDb.collection('paperuss_users').doc(uid).collection('notes').doc(latest.noteId).collection('leaves').doc(targetLeafId);

          if (latest.action === 'delete') {
            try {
              await leafRef.set({
                id: targetLeafId, noteId: latest.noteId, deletedAt: latest.timestamp || Date.now(), updatedAt: latest.timestamp || Date.now()
              }, { merge: true });
              for (const i of items) await window.paperussLeaves.leafQueueDel(i.id);
              res.stats.succeeded++;
            } catch (e) {
              console.warn('Leaf tombstone upload failed, keeping queue for retry:', e);
              res.stats.failed++; res.stats.retryable++; res.errors.push({ id: targetLeafId, code: e.code || 'network', retryable: true });
            }
          } else {
            try {
              const cleanLeaf = {
                id: targetLeafId, noteId: latest.noteId, title: (latest.data && latest.data.title) || 'Leaf',
                content: (latest.data && latest.data.content) || '', color: (latest.data && latest.data.color) || 'slate',
                order: (latest.data && typeof latest.data.order === 'number') ? latest.data.order : 0,
                createdAt: (latest.data && latest.data.createdAt) || Date.now(), updatedAt: (latest.data && latest.data.updatedAt) || Date.now(),
                deletedAt: null
              };
              await leafRef.set(cleanLeaf, { merge: true });
              for (const i of items) await window.paperussLeaves.leafQueueDel(i.id);
              res.stats.succeeded++;
            } catch (e) {
              console.warn('Leaf put upload failed, keeping queue for retry:', e);
              res.stats.failed++; res.stats.retryable++; res.errors.push({ id: targetLeafId, code: e.code || 'network', retryable: true });
            }
          }
        }
      }
      if (res.stats.failed > 0) { res.ok = false; res.status = 'partial'; }
      return res;
    } catch (err) {
      console.error('syncLeavesWithCloud error:', err);
      return { ...res, ok: false, status: 'partial', reason: 'network', stats: { ...res.stats, retryable: 1 }, errors: [{ code: err.code || 'network', retryable: true }] };
    }
}






window.syncNow = syncNow;
window.enableSync = enableSync;
window.disableSync = disableSync;
window.initAuthAndSync = initAuthAndSync;
window.updateSyncStatus = updateSyncStatus;
