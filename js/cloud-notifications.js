/* ============================================================
   FIREBASE AUTH + CLOUD SYNC (with full offline fallback)
   ============================================================ */
// Fill these with your own Firebase project credentials to enable real
// cross-device sign-in/sync. Left blank, PapeRuss runs fully offline —
// the landing page will still appear but cloud sign-in gracefully
// falls back to Guest mode with a friendly notice.
const getEnvVar = (key) => {
  if (typeof window !== 'undefined' && window[key]) return window[key];
  if (typeof process !== 'undefined' && process.env && process.env[key]) return process.env[key];
  return null;
};

const FIREBASE_CONFIG={
  apiKey: getEnvVar('VITE_FIREBASE_API_KEY') || "AIzaSyCGPLY38o2Mym1Q2aeKuDdp5gigN36Wg-I",
  authDomain: getEnvVar('VITE_FIREBASE_AUTH_DOMAIN') || "my-paperuss-database-2.firebaseapp.com",
  projectId: getEnvVar('VITE_FIREBASE_PROJECT_ID') || "my-paperuss-database-2",
  storageBucket: getEnvVar('VITE_FIREBASE_STORAGE_BUCKET') || "my-paperuss-database-2.firebasestorage.app",
  messagingSenderId: getEnvVar('VITE_FIREBASE_MESSAGING_SENDER_ID') || "506884695642",
  appId: getEnvVar('VITE_FIREBASE_APP_ID') || "1:506884695642:web:afef991984b581d06b9a63",
  measurementId: getEnvVar('VITE_FIREBASE_MEASUREMENT_ID') || "G-V2SFSNKGZK"
};
const AUTH_SESSION_KEY='octonotes:session';
const LAST_SYNC_KEY='octonotes:lastSyncAt';
const CLOUD_DELETIONS_KEY='paperuss:cloudDeletions';
const PORTABLE_STATE_UPDATED_KEY='paperuss:portableStateUpdatedAt';
const PROFILE_PHOTO_KEY='paperuss:profilePhoto';
const OFFLINE_UPLOAD_QUEUE_KEY='paperuss:offlineUploadQueue'; // persists upload IDs that need retry
const MAX_UPLOAD_FAILURES=5;   // give up after this many consecutive failed attempts
// This deployment keeps attachment data in Firestore. Set to false only after
// Firebase Storage is intentionally configured and deployed for this project.
const FIRESTORE_ONLY_MEDIA=true;
const UPLOAD_RETRY_BASE_MS=30000; // 30s base; doubles each failure: 30s→1m→2m→4m→8m

let fbApp=null, fbAuth=null, fbDb=null, fbStorage=null, fbAnalytics=null, firebaseReady=false;
let currentSession=null; // {mode:'guest'} | {mode:'auth', uid, name, email, photoURL}
let syncState='offline'; // offline | synced | syncing | error
let syncDebounceTimer=null;
let mediaRetryTimer=null;
let cloudSyncApplyingRemote=false;
let syncRequestedWhileBusy=false;

function firebaseConfigured(){
  return !!(FIREBASE_CONFIG.apiKey && FIREBASE_CONFIG.projectId && FIREBASE_CONFIG.appId);
}

function initFirebase(){
  try{
    if(window.__fbLoadFailed || typeof firebase==='undefined' || !firebaseConfigured()) return false;
    fbApp = firebase.apps && firebase.apps.length ? firebase.apps[0] : firebase.initializeApp(FIREBASE_CONFIG);
    fbAuth = firebase.auth();
    fbDb = firebase.firestore();
    fbStorage = !window.__fbStorageLoadFailed && typeof firebase.storage==='function' ? firebase.storage() : null;
    if(!window.__fbAnalyticsLoadFailed && typeof firebase.analytics==='function' && FIREBASE_CONFIG.measurementId){
      try{ fbAnalytics=firebase.analytics(); }catch(_){ fbAnalytics=null; }
    }
    firebaseReady=true;
    // Handle redirect sign-in result first (mobile/PWA fallback)
    fbAuth.getRedirectResult().then(result=>{
      if(result && result.user){
        const u=result.user;
        saveSession({mode:'auth', uid:u.uid, name:u.displayName||u.email||'Account', email:u.email||'', photoURL:u.photoURL||''});
        hideAuthLanding();
        renderProfileMenu();
        toast('Signed in as '+(u.displayName||u.email));
        syncNow();
      }
    }).catch(err=>{
      if(err && err.code) toast(authErrorMessage(err));
    });
    fbAuth.onAuthStateChanged(user=>{
      if(user){
        saveSession({mode:'auth', uid:user.uid, name:user.displayName||user.email||'Account', email:user.email||'', photoURL:user.photoURL||''});
        hideAuthLanding();
        renderProfileMenu();
        syncNow({silent:true});
      } else {
        // User signed out or Firebase lost the session
        const sess=loadSession();
        if(!sess){
          // They are a new user, no session at all
          showAuthLanding();
        } else if (sess.mode==='auth') {
          // Firebase token dropped (e.g. third-party cookie blocked or token expired),
          // but they previously signed in. Do NOT kick them out of their notes.
          // Let them continue offline. syncNow() will abort safely.
          console.warn('Firebase session dropped, but local auth session remains. Pausing sync.');
          updateSyncStatus('error', 'Cloud disconnected (please sign in again later)');
        }
        // If sess.mode === 'guest', do nothing. They are intentionally offline.
      }
    });
    return true;
  }catch(e){
    firebaseReady=false;
    return false;
  }
}

function loadSession(){
  try{ currentSession=JSON.parse(localStorage.getItem(AUTH_SESSION_KEY)); }catch(e){ currentSession=null; }
  return currentSession;
}
function saveSession(session){
  currentSession=session;
  if(session) localStorage.setItem(AUTH_SESSION_KEY, JSON.stringify(session));
  else localStorage.removeItem(AUTH_SESSION_KEY);
}

function showAuthLanding(){
  const el=document.getElementById('authLanding');
  if(el) el.classList.remove('hidden');
  document.documentElement.classList.remove('auth-pending');
  if(typeof closeLeavesDrawer === 'function') closeLeavesDrawer();
  if(typeof updateLeafTitleBar === 'function') updateLeafTitleBar();
}
function hideAuthLanding(){
  const el=document.getElementById('authLanding');
  if(el) el.classList.add('hidden');
  document.documentElement.classList.remove('auth-pending');
  if(typeof updateLeafTitleBar === 'function') updateLeafTitleBar();
}

async function continueAsGuest(){
  // Explicit guest choice also clears any persisted Firebase session so auth
  // state cannot immediately override local-only mode.
  try{ if(firebaseReady && fbAuth && fbAuth.currentUser) await fbAuth.signOut(); }catch(e){}
  saveSession({mode:'guest'});
  hideAuthLanding();
  renderProfileMenu();
  updateSyncStatus('offline','Offline · local only');
  toast('Continuing in guest mode — everything stays on this device');
}

function isMobileOrPWA(){
  return window.matchMedia('(display-mode: standalone)').matches
    || (window.navigator.standalone === true)
    || /android|iphone|ipad|ipod/i.test(navigator.userAgent);
}

async function signInWithGoogle(fromLanding){
  if(!firebaseReady){
    toast('Cloud sign-in is not configured — continuing offline');
    if(fromLanding) continueAsGuest();
    return;
  }
  try{
    const provider=new firebase.auth.GoogleAuthProvider();
    provider.setCustomParameters({ prompt: 'select_account' });
    

    
    const result=await fbAuth.signInWithPopup(provider);
    const user=result.user;
    saveSession({mode:'auth', uid:user.uid, name:user.displayName||user.email||'Account', email:user.email||'', photoURL:user.photoURL||''});
    hideAuthLanding();
    renderProfileMenu();
    toast('Signed in as '+(user.displayName||user.email));
    syncNow();
  }catch(err){
    if(err && err.code==='auth/popup-blocked'){
      try{
        const provider2=new firebase.auth.GoogleAuthProvider();
        provider2.setCustomParameters({ prompt: 'select_account' });
        await fbAuth.signInWithRedirect(provider2);
      }catch(e2){
        const message=authErrorMessage(e2);
        toast(message);
        setEmailAuthMessage(message,true);
      }
      return;
    }
    const message=authErrorMessage(err);
    toast(message);
    setEmailAuthMessage(message,true);
  }
}

function authErrorMessage(error){
  const code=String(error?.code||'');
  const messages={
    'auth/invalid-email':'Enter a valid email address.',
    'auth/missing-password':'Enter your password.',
    'auth/weak-password':'Use a password with at least 6 characters.',
    'auth/email-already-in-use':'That email already has an account. Sign in instead.',
    'auth/invalid-credential':'Email or password is incorrect. If you registered with Google, use Google sign-in.',
    'auth/user-not-found':'Email or password is incorrect.',
    'auth/wrong-password':'Email or password is incorrect.',
    'auth/account-exists-with-different-credential':'This email already uses another sign-in method. Use the method you originally chose.',
    'auth/too-many-requests':'Too many attempts. Wait a little and try again.',
    'auth/network-request-failed':'Network unavailable. Check your connection and try again.',
    'auth/operation-not-allowed':'Email/password sign-in is not enabled for this Firebase project.'
  };
  return messages[code]||`Authentication failed. Please try again. (${code})`;
}

function setEmailAuthMessage(message,isError){
  const el=document.getElementById('authFormMessage');
  if(!el) return;
  el.textContent=message||'';
  el.classList.toggle('error',!!isError);
}

function setEmailAuthBusy(busy){
  ['authEmailSignInBtn','authEmailCreateBtn','authResetPasswordBtn'].forEach(id=>{
    const el=document.getElementById(id);
    if(el) el.disabled=!!busy;
  });
}

function readEmailCredentials(){
  return {
    email:(document.getElementById('authEmail')?.value||'').trim(),
    password:document.getElementById('authPassword')?.value||''
  };
}

async function signInWithEmailPassword(){
  if(!firebaseReady){ setEmailAuthMessage('Cloud sign-in is unavailable right now.',true); return; }
  const {email,password}=readEmailCredentials();
  if(!email || !password){ setEmailAuthMessage('Enter your email and password.',true); return; }
  setEmailAuthBusy(true); setEmailAuthMessage('Signing in…');
  try{
    const result=await fbAuth.signInWithEmailAndPassword(email,password);
    const user=result.user;
    saveSession({mode:'auth',uid:user.uid,name:user.displayName||user.email||'Account',email:user.email||'',photoURL:user.photoURL||''});
    hideAuthLanding(); renderProfileMenu(); toast('Signed in as '+(user.email||'your account'));
    syncNow();
  }catch(error){
    setEmailAuthMessage(authErrorMessage(error),true);
  }finally{
    setEmailAuthBusy(false);
  }
}

async function createEmailPasswordAccount(){
  if(!firebaseReady){ setEmailAuthMessage('Cloud sign-up is unavailable right now.',true); return; }
  const {email,password}=readEmailCredentials();
  if(!email || !password){ setEmailAuthMessage('Enter an email and password.',true); return; }
  setEmailAuthBusy(true); setEmailAuthMessage('Creating account…');
  try{
    const result=await fbAuth.createUserWithEmailAndPassword(email,password);
    const user=result.user;
    try{ await user.sendEmailVerification(); }catch(_){}
    saveSession({mode:'auth',uid:user.uid,name:user.email||'Account',email:user.email||'',photoURL:''});
    hideAuthLanding(); renderProfileMenu();
    toast('Account created — check your inbox to verify your email');
    syncNow();
  }catch(error){
    setEmailAuthMessage(authErrorMessage(error),true);
  }finally{
    setEmailAuthBusy(false);
  }
}

async function sendPasswordReset(){
  if(!firebaseReady){ setEmailAuthMessage('Password reset is unavailable right now.',true); return; }
  const email=(document.getElementById('authEmail')?.value||'').trim();
  if(!email){ setEmailAuthMessage('Enter your email address first.',true); return; }
  setEmailAuthBusy(true); setEmailAuthMessage('Sending reset link…');
  try{
    await fbAuth.sendPasswordResetEmail(email);
    setEmailAuthMessage('If an account uses that email, a reset link has been sent.');
  }catch(error){
    setEmailAuthMessage(authErrorMessage(error),true);
  }finally{
    setEmailAuthBusy(false);
  }
}

function signOutUser(){
  const session=currentSession||loadSession()||{mode:'guest'};
  const isAuth=session.mode==='auth';
  const title=isAuth?'Sign out?':'Exit guest mode?';
  const copy=isAuth
    ?'Your notes stay on this device. Cloud sync will pause until you sign in again.'
    :'Your local notes stay on this device. You will return to the welcome page.';
  confirmDialog(title,copy,isAuth?'Sign out':'Exit',async ()=>{
    try{ if(firebaseReady && isAuth) await fbAuth.signOut(); }catch(e){}
    saveSession(null);
    renderProfileMenu();
    updateSyncStatus('offline','Offline · local only');
    document.getElementById('profilePanel')?.classList.remove('show');
    showAuthLanding();
    refreshIcons();
  });
}

function initials(name){
  const s=(name||'G').trim();
  const parts=s.split(/\s+/);
  return ((parts[0]?.[0]||'G')+(parts[1]?.[0]||'')).toUpperCase();
}

function renderProfileMenu(){
  const session=currentSession||loadSession()||{mode:'guest'};
  const isAuth=session.mode==='auth';
  const name=isAuth?(session.name||session.email||'Account'):'Guest';
  const email=isAuth?(session.email||''):'Local-only mode';
  const initial=initials(isAuth?name:'Guest');

  const avatarBtn=document.getElementById('profileAvatarInitial');
  const panelInitial=document.getElementById('profilePanelInitial');
  const panelAvatar=document.getElementById('profilePanelAvatar');
  const avatarWrap=document.getElementById('profileAvatarBtn');
  const profilePhoto=localStorage.getItem(PROFILE_PHOTO_KEY)||(isAuth?session.photoURL:'');
  if(profilePhoto){
    if(avatarWrap) avatarWrap.innerHTML=`<img src="${esc(profilePhoto)}" alt="">`;
    if(panelAvatar) panelAvatar.innerHTML=`<img src="${esc(profilePhoto)}" alt=""><button class="profile-avatar-upload" id="profilePictureBtn" title="Upload profile picture" aria-label="Upload profile picture"><i data-lucide="camera" class="w-2.5 h-2.5"></i></button>`;
  }else{
    if(avatarBtn) avatarBtn.textContent=initial;
    else if(avatarWrap) avatarWrap.innerHTML=`<span id="profileAvatarInitial">${initial}</span>`;
    if(panelInitial) panelInitial.textContent=initial;
    else if(panelAvatar) panelAvatar.innerHTML=`<span id="profilePanelInitial">${initial}</span><button class="profile-avatar-upload" id="profilePictureBtn" title="Upload profile picture" aria-label="Upload profile picture"><i data-lucide="camera" class="w-2.5 h-2.5"></i></button>`;
  }
  document.getElementById('profilePanelName').textContent=name;
  document.getElementById('profilePanelEmail').textContent=email;

  const signInBtn=document.getElementById('profileSignInBtn');
  const signOutBtn=document.getElementById('profileSignOutBtn');
  if(signInBtn) signInBtn.style.display=isAuth?'none':'flex';
  if(signOutBtn){
    signOutBtn.style.display='flex';
    signOutBtn.innerHTML=isAuth
      ?'<i data-lucide="log-out" class="w-4 h-4"></i> Sign out'
      :'<i data-lucide="log-out" class="w-4 h-4"></i> Exit guest mode';
  }

  // Mirror into Settings > Account & Sync
  const setName=document.getElementById('setAccountName');
  const setEmail=document.getElementById('setAccountEmail');
  const setAuthBtn=document.getElementById('setAuthBtn');
  if(setName) setName.textContent=name;
  if(setEmail) setEmail.textContent=isAuth?email:'Signed out · local-only mode';
  if(setAuthBtn){
    setAuthBtn.textContent=isAuth?'Sign out':'Sign in or create account';
    setAuthBtn.onclick=isAuth?signOutUser:showAuthLanding;
  }

  updateSyncStatus(syncState);
  refreshIcons();
}

function handleProfilePictureUpload(file){
  if(!file || !file.type.startsWith('image/')){ toast('Choose an image file'); return; }
  const reader=new FileReader();
  reader.onload=()=>{
    const image=new Image();
    image.onload=()=>{
      // Keep the local session small enough for reliable offline storage.
      const size=256;
      const scale=Math.min(1,size/Math.max(image.width,image.height));
      const canvas=document.createElement('canvas');
      canvas.width=Math.max(1,Math.round(image.width*scale));
      canvas.height=Math.max(1,Math.round(image.height*scale));
      canvas.getContext('2d').drawImage(image,0,0,canvas.width,canvas.height);
      const photoURL=canvas.toDataURL('image/jpeg',.82);
      const session=currentSession||loadSession()||{mode:'guest'};
      saveSession({...session,photoURL});
      localStorage.setItem(PROFILE_PHOTO_KEY,photoURL);
      markPortableStateChanged();
      // Update both avatar buttons immediately
      const avatarWrap=document.getElementById('profileAvatarBtn');
      const panelAvatar=document.getElementById('profilePanelAvatar');
      if(avatarWrap) avatarWrap.innerHTML=`<img src="${esc(photoURL)}" alt="">`;
      if(panelAvatar) panelAvatar.innerHTML=`<img src="${esc(photoURL)}" alt=""><button class="profile-avatar-upload" id="profilePictureBtn" title="Upload profile picture" aria-label="Upload profile picture"><i data-lucide="camera" class="w-2.5 h-2.5"></i></button>`;
      refreshIcons();
      toast('Profile picture updated');
    };
    image.onerror=()=>toast('Could not read that image');
    image.src=reader.result;
  };
  reader.readAsDataURL(file);
}

function updateSyncStatus(newState, customText){
  syncState=newState;
  const pill=document.getElementById('syncStatusPill');
  const text=document.getElementById('syncStatusText');
  const detail=document.getElementById('setSyncDetail');
  const session=currentSession||loadSession()||{mode:'guest'};
  const labels={
    offline: customText||(session.mode==='auth'?'Offline · will sync when online':'Offline · local only'),
    synced: customText||('Synced · '+(getLastSyncLabel())),
    partial: customText||('Synced (Partial) · '+(getLastSyncLabel())),
    syncing: customText||'Syncing…',
    error: customText||'Sync error · retry later'
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

/* Merge records by id, then apply deletion markers so removed data stays removed. */
function mergeById(localArr,remoteArr,tsField,deletions){
  const map=new Map();
  (remoteArr||[]).forEach(r=>map.set(r.id, r));
  (localArr||[]).forEach(l=>{
    const r=map.get(l.id);
    if(!r || (l[tsField]||0) >= (r[tsField]||0)) map.set(l.id, l);
  });
  Object.entries(deletions||{}).forEach(([id,deletedAt])=>{
    const record=map.get(id);
    if(record && (+deletedAt||0)>=(record[tsField]||record.createdAt||0)) map.delete(id);
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
    theme:localStorage.getItem(THEME_KEY)||'dark',
    calendarView:state.calendarView||'month',
    calendarSelectedDate:+state.calendarSelectedDate||Date.now(),
    notifications:(appNotifications||[]).slice(0,200),
    profilePhoto:localStorage.getItem(PROFILE_PHOTO_KEY)||''
  };
}

function applyPortableState(value){
  if(!value || typeof value!=='object') return;
  if(value.theme){
    localStorage.setItem(THEME_KEY,value.theme);
    document.documentElement.setAttribute('data-theme',value.theme);
  }
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
// Cancellable version for Firebase uploadTask objects
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

/* ============================================================
   OFFLINE UPLOAD QUEUE — persists upload IDs across reloads
   ============================================================ */
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

// Retry failed media while the browser remains online.  The per-record
// backoff still lives in syncMedia(), so this only wakes the next attempt.
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

/* Dynamic upload timeout — 1 byte/ms minimum, floor at 20s, ceiling at 15min */
function timeoutForSize(bytes){
  return Math.min(Math.max(20000, Math.round(bytes * 1.5)), 15*60*1000);
}

async function syncMedia(uid,deletions,requiredMediaIds){
  const localRecords=await mediaAll();
  const storageConsecutiveFailures = window.__fbStorageFailCount || 0;
  const useStorage = !FIRESTORE_ONLY_MEDIA && !!(fbStorage && storageConsecutiveFailures < 3);

  const localMap=new Map(localRecords.map(record=>[record.id,record]));
  let partialFailure = localRecords.some(record=>
    record.pendingUpload && (record.uploadFailures||0) >= MAX_UPLOAD_FAILURES
  );

  // Phase 1: Apply deletion markers
  for(const [id,deletedAt] of Object.entries(deletions||{})){
    const local=localMap.get(id);
    if((+deletedAt||0)<(local?.updatedAt||local?.createdAt||0)) continue;
    
    // Always attempt cloud deletion to ensure it's gone from remote
    cloudSyncApplyingRemote=true;
    try{ await mediaDel(id); }catch(_){}finally{ cloudSyncApplyingRemote=false; }
    localMap.delete(id);
    
    try{
      const metaSnap = await fbDb.collection('paperuss_users').doc(uid).collection('media').doc(id).get();
      if(metaSnap.exists) {
        const remote = metaSnap.data();
        if(remote.chunked && remote.totalChunks){
          for(let c=0; c<remote.totalChunks; c++){
            try{ await fbDb.collection('paperuss_users').doc(uid).collection('media').doc(id+"_chunk_"+c).delete(); }catch(_){}
          }
        }
        await fbDb.collection('paperuss_users').doc(uid).collection('media').doc(id).delete();
      }
    }catch(_){}
    if(useStorage){
      try{ await mediaStorageRef(uid,id).delete(); }
      catch(err){ if(!String(err?.code||'').includes('object-not-found')) console.warn(err); }
    }
  }

  // Phase 2: Upload local files missing in cloud
  const pendingUploads = Array.from(localMap.values()).filter(record=>{
    if(!record.pendingUpload || (record.uploadFailures||0) >= MAX_UPLOAD_FAILURES) return false;
    const failures=record.uploadFailures||0;
    if(!failures) return true;
    const backoffMs=Math.min(UPLOAD_RETRY_BASE_MS*Math.pow(2,failures-1),8*60*1000);
    return Date.now()-(record.lastUploadAttempt||0) >= backoffMs;
  });
  if(pendingUploads.length > 0){
    console.log('PapeRuss: Cloud sync uploading ' + pendingUploads.length + ' media asset(s)...');
    updateSyncStatus('syncing', 'Uploading ' + pendingUploads.length + ' asset(s)...');
  }

  for(let i=0; i<pendingUploads.length; i++){
    const record = pendingUploads[i];
    if(!(record.blob instanceof Blob)){
      partialFailure=true;
      const failedRecord={...record,
        pendingUpload:true,
        uploadFailures:MAX_UPLOAD_FAILURES,
        lastUploadAttempt:Date.now(),
        uploadError:'The local media file is missing from this browser.'
      };
      try{ await mediaPut(failedRecord); }catch(_){}
      localMap.set(record.id,failedRecord);
      removeFromOfflineUploadQueue(record.id);
      console.error('PapeRuss: Media '+record.id+' cannot upload because its local Blob is missing');
      document.dispatchEvent(new CustomEvent('media-upload-progress',{
        detail:{id:record.id,percent:0,error:true,failures:MAX_UPLOAD_FAILURES}
      }));
      continue;
    }
    const fileBytes = record.blob.size || 0;
    const label = record.name || 'file';
    updateSyncStatus('syncing', 'Uploading ' + (i+1) + '/' + pendingUploads.length + ': ' + label + ' (' + formatBytes(fileBytes) + ')');

    try{ await mediaPut({...record, lastUploadAttempt: Date.now()}); }catch(_){}

    try{
      let cloudUrl = record.cloudUrl || '';
      let uploadedToStorage = false;
      if(useStorage){
        try {
          const storageRef = mediaStorageRef(uid, record.id);
          const uploadTask = storageRef.put(record.blob, {
            contentType: record.type || record.blob?.type || 'application/octet-stream'
          });

          uploadTask.on('state_changed', snapshot => {
            const pct = snapshot.totalBytes > 0
              ? Math.round((snapshot.bytesTransferred / snapshot.totalBytes) * 100) : 0;
            document.dispatchEvent(new CustomEvent('media-upload-progress', {
              detail:{ id:record.id, percent:pct, bytesTransferred:snapshot.bytesTransferred, totalBytes:snapshot.totalBytes }
            }));
            updateSyncStatus('syncing',
              'Uploading ' + (i+1) + '/' + pendingUploads.length + ': ' + label + ' - ' + pct + '% (' + formatBytes(snapshot.bytesTransferred) + '/' + formatBytes(snapshot.totalBytes) + ')'
            );
          });

          await withCancellableTimeout(uploadTask, timeoutForSize(fileBytes), 'Upload timed out for ' + label);
          cloudUrl = await storageRef.getDownloadURL();
          uploadedToStorage = true;
          window.__fbStorageFailCount = 0;
          
          await fbDb.collection('paperuss_users').doc(uid).collection('media').doc(record.id).set({
            id: record.id,
            type: record.type || record.blob?.type || 'application/octet-stream',
            size: fileBytes,
            name: label,
            uploadedToStorage: true,
            updatedAt: Date.now()
          }, {merge: true});

        } catch(storageErr) {
          console.warn('PapeRuss: Cloud Storage upload failed for ' + record.id + ' (' + (storageErr.message||storageErr.code) + '), using Firestore media sync');
          window.__fbStorageFailCount = (window.__fbStorageFailCount || 0) + 1;
          if(window.__fbStorageFailCount >= 3){
            console.warn('PapeRuss: Cloud Storage disabled after 3 consecutive failures');
          }
        }
      }

      if(!uploadedToStorage){
        if(!fbAuth || !fbAuth.currentUser || fbAuth.currentUser.uid !== uid){
          throw new Error('permission-denied: Please sign in to sync media with your account');
        }
        let workingBlob = record.blob;
        let workingBytes = fileBytes;
        const mimeType = record.type || record.blob?.type || 'application/octet-stream';
        if(mimeType.startsWith('image/') && workingBytes > 600000 && typeof downscaleImageBlob === 'function'){
          try {
            workingBlob = await downscaleImageBlob(workingBlob, 1440, 400 * 1024);
            workingBytes = workingBlob.size || workingBytes;
          } catch(_) {}
        }
        const dataUrl = await blobToDataURL(workingBlob);
        const CHUNK_CHAR_SIZE = 600000;
        let chunked = false;
        let totalChunks = 1;
        if(dataUrl.length <= 900000){
          await fbDb.collection('paperuss_users').doc(uid).collection('media').doc(record.id).set({
            id: record.id,
            dataUrl: dataUrl,
            type: mimeType,
            size: workingBytes,
            name: label,
            chunked: false,
            totalChunks: 1,
            updatedAt: Date.now()
          }, {merge: true});
        } else {
          chunked = true;
          totalChunks = Math.ceil(dataUrl.length / CHUNK_CHAR_SIZE);
          const chunkPromises = [];
          for(let c = 0; c < totalChunks; c++){
            const sliceData = dataUrl.slice(c * CHUNK_CHAR_SIZE, (c + 1) * CHUNK_CHAR_SIZE);
            chunkPromises.push(
              fbDb.collection('paperuss_users').doc(uid).collection('media').doc(record.id+"_chunk_"+c).set({
                parentId: record.id,
                chunkIndex: c,
                data: sliceData,
                updatedAt: Date.now()
              })
            );
          }
          await Promise.all(chunkPromises);
          await fbDb.collection('paperuss_users').doc(uid).collection('media').doc(record.id).set({
            id: record.id,
            type: mimeType,
            size: workingBytes,
            name: label,
            chunked: true,
            totalChunks: totalChunks,
            updatedAt: Date.now()
          }, {merge: true});
        }
        if(workingBlob !== record.blob){
          record.blob = workingBlob;
          record.size = workingBytes;
        }
        record.chunked = chunked;
        record.totalChunks = totalChunks;
        cloudUrl = 'firestore:' + record.id;
        document.dispatchEvent(new CustomEvent('media-upload-progress', {
          detail:{ id:record.id, percent:100, bytesTransferred:workingBytes, totalBytes:workingBytes }
        }));
      }

      // Confirmed upload
      const localUpdated = record.updatedAt || record.createdAt || Date.now();
      const syncedRecord = {...record,
        cloudUrl, cloudSyncedAt: localUpdated, pendingUpload: false, uploadFailures: 0, lastUploadAttempt: Date.now()
      };
      try{ await mediaPut(syncedRecord); }catch(_){}
      localMap.set(record.id, syncedRecord);
      removeFromOfflineUploadQueue(record.id);

    }catch(uploadErr){
      partialFailure = true;
      const errMsg = uploadErr?.message || uploadErr?.code || String(uploadErr);
      console.error('PapeRuss: Media upload failed for ' + record.id + ':', uploadErr);
      const isPermDenied = String(errMsg).includes('permission-denied');
      const isAuthExpired = isPermDenied && (!fbAuth || !fbAuth.currentUser);
      if(isPermDenied && !isAuthExpired){
        toast('⚠️ Access denied by Firestore security rules. Please check your sign-in session.');
      }
      const failures = (record.uploadFailures||0) + 1;
      const failedRecord = {...record, pendingUpload: true, uploadFailures: failures, lastUploadAttempt: Date.now()};
      try{ await mediaPut(failedRecord); }catch(_){}
      localMap.set(record.id, failedRecord);
      if(failures >= MAX_UPLOAD_FAILURES || (isPermDenied && !isAuthExpired)){
        removeFromOfflineUploadQueue(record.id);
      } else {
        addToOfflineUploadQueue(record.id);
      }
      document.dispatchEvent(new CustomEvent('media-upload-progress', {
        detail:{ id:record.id, percent:0, error:true, failures }
      }));
      if(failures === 1){
        toast('⚠️ Media upload failed: ' + errMsg + ' — will retry automatically');
      } else if(failures >= MAX_UPLOAD_FAILURES){
        toast('❌ "' + label + '" could not be uploaded after ' + failures + ' attempts.', () => {
          if(typeof syncNow === 'function') syncNow();
        }, 'Retry Now');
      }
    }
  }

  // Phase 3: Lazy download — only fetch blobs actually referenced in current notes
  const needsIds = requiredMediaIds instanceof Set ? requiredMediaIds : new Set(requiredMediaIds||[]);
  for(const id of needsIds){
    if(localMap.has(id)) continue;
    try{
      let blob = null;
      let cloudUrl = null;
      let size = 0, name = 'file', type = 'application/octet-stream';
      let updatedAt = Date.now();

      const metaSnap = await fbDb.collection('paperuss_users').doc(uid).collection('media').doc(id).get();
      if(!metaSnap.exists) continue; // orphaned or deleted on cloud
      const meta = metaSnap.data();
      size = meta.size || 0;
      name = meta.name || 'file';
      type = meta.type || 'application/octet-stream';
      updatedAt = meta.updatedAt || Date.now();
      
      if(meta.uploadedToStorage){
        try {
          const url = await withTimeout(
            mediaStorageRef(uid,id).getDownloadURL(), 12000, 'Download URL timeout for ' + id
          );
          cloudUrl = url;
          const response = await withTimeout(fetch(url), timeoutForSize(size||500000), 'Fetch timeout for ' + id);
          if(response.ok) blob = await response.blob();
        } catch(storageErr) {
          console.warn('PapeRuss: Storage download failed for ' + id, storageErr);
          continue;
        }
      } else {
        const dataUrl = await fetchFirestoreMediaDataUrl(uid, id);
        if(dataUrl) {
           blob = dataURLToBlob(dataUrl);
           cloudUrl = 'firestore:'+id;
        }
      }
      if(blob){
        const downloadedRecord = {id, type, size, name, blob, cloudUrl,
          cloudSyncedAt: updatedAt, pendingUpload: false, uploadFailures: 0
        };
        await mediaPut(downloadedRecord);
        localMap.set(id, downloadedRecord);
      }
    }catch(dlErr){
      console.warn('PapeRuss: Media download warning for ' + id + ':', dlErr);
    }
  }

  return { partialFailure };
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
    toast('Cloud reset failed — nothing was erased');
    return false;
  }
}

async function syncNow(opts){
  opts=opts||{};
  if(syncState==='syncing'){ syncRequestedWhileBusy=true; return; }
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
async function _syncNowInner(opts){
  const session=currentSession||loadSession();
  if(!session || session.mode!=='auth') return;
  if(syncState==='syncing'){
    syncRequestedWhileBusy=true;
    return;
  }
  if(!navigator.onLine){
    updateSyncStatus('offline','Offline · changes saved locally');
    return;
  }
  updateSyncStatus('syncing');

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

  try{
    const docRef=fbDb.collection('paperuss_users').doc(session.uid);
    const snap=await docRef.get();
    const remote=snap.exists?snap.data():{};

    const notesSnap = await docRef.collection('notes').get();
    const remoteNotes = notesSnap.docs.map(d=>d.data());
    const tasksSnap = await docRef.collection('tasks').get();
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
        if(seedIds.size) localNotes=notes.filter(note=>!seedIds.has(note.id));
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
          // Active note got a newer remote version — defer/apply safely
          scheduleActiveNoteRefresh(changedRemoteNote);
          // Refresh the list and sidebar but NOT the editor (handled above)
          renderList();
          renderSidebar();
        } else {
          // Notes changed but not the active one — rebuild list/sidebar only.
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
      await Promise.all(writePromises.slice(i, i+50));
    }

    const requiredMediaIds=typeof referencedStoredMediaIds==='function'
      ? referencedStoredMediaIds(mergedNotes)
      : new Set();
    let partialFailure = false;
    try {
      const mediaResult=await syncMedia(session.uid, mergedDeletions.media, requiredMediaIds);
      partialFailure = mediaResult ? mediaResult.partialFailure : false;
    } catch(mediaErr) {
      partialFailure = true;
      console.warn('PapeRuss media sync non-blocking warning:', mediaErr);
    }

    try {
      if (window.paperussLeafManager && typeof window.paperussLeafManager.syncLeavesWithCloud === 'function') {
        await window.paperussLeafManager.syncLeavesWithCloud(session.uid);
      }
      if (window.paperussLeafManager && typeof window.paperussLeafManager.syncNoteLeavesFromCloud === 'function' && typeof state !== 'undefined' && state && state.currentId) {
        await window.paperussLeafManager.syncNoteLeavesFromCloud(state.currentId, session.uid);
      }
    } catch (leafErr) {
      console.warn('PapeRuss leaves sync non-blocking warning:', leafErr);
    }

    localStorage.setItem(LAST_SYNC_KEY, String(Date.now()));
    if(partialFailure){
      updateSyncStatus('partial','Media sync incomplete — retry scheduled');
      schedulePendingMediaRetry();
    }else{
      updateSyncStatus('synced');
    }
    if(typeof hydrateMediaInEditor==='function') hydrateMediaInEditor();
    if(!opts.silent) toast(partialFailure ? 'Notes synced; some media will retry automatically' : 'Synced with cloud');
    if(syncRequestedWhileBusy){ syncRequestedWhileBusy=false; queueCloudSync(); }
  }catch(err){
    console.error('PapeRuss cloud sync failed',err);
    updateSyncStatus('error');
    if(!opts.silent) toast('Sync failed — changes saved locally');
  }
}

function queueCloudSync(){
  const session=currentSession||loadSession();
  if(cloudSyncApplyingRemote || !session || session.mode!=='auth') return;
  if(syncState==='syncing'){ syncRequestedWhileBusy=true; return; }
  clearTimeout(syncDebounceTimer);
  syncDebounceTimer=setTimeout(()=>syncNow({silent:true}), 2500);
}

function initAuthAndSync(){
  initFirebase();
  const session=loadSession();
  if(!session){
    showAuthLanding();
  }else{
    hideAuthLanding();
  }
  renderProfileMenu();
  updateSyncStatus(session && session.mode==='auth' ? 'offline' : 'offline');

  window.addEventListener('online', ()=>{
    if((currentSession||{}).mode!=='auth') return;
    drainOfflineQueue(); // flush any uploads queued while offline
    syncNow({silent:true});
  });
  window.addEventListener('offline', ()=>updateSyncStatus('offline'));
  // Background retry polling every 60 seconds
  setInterval(() => {
    if((currentSession||{}).mode==='auth' && navigator.onLine){
      drainOfflineQueue();
      syncNow({silent:true});
    }
  }, 60000);

  // Re-sync on tab focus or screen unlock if last sync was more than 60 seconds ago
  const RESYNC_STALE_MS = 60 * 1000;
  function resyncIfStale(){
    if((currentSession||{}).mode!=='auth') return;
    if(!navigator.onLine) return;
    const lastSync = +localStorage.getItem(LAST_SYNC_KEY)||0;
    if(Date.now() - lastSync > RESYNC_STALE_MS) queueCloudSync();
  }
  document.addEventListener('visibilitychange', ()=>{ if(document.visibilityState==='visible') resyncIfStale(); });
  window.addEventListener('focus', resyncIfStale);

  const googleBtn=document.getElementById('authGoogleBtn');
  if(googleBtn) googleBtn.onclick=()=>signInWithGoogle(true);
  const emailForm=document.getElementById('authEmailForm');
  if(emailForm) emailForm.onsubmit=e=>{ e.preventDefault(); signInWithEmailPassword(); };
  const emailCreateBtn=document.getElementById('authEmailCreateBtn');
  if(emailCreateBtn) emailCreateBtn.onclick=createEmailPasswordAccount;
  const resetPasswordBtn=document.getElementById('authResetPasswordBtn');
  if(resetPasswordBtn) resetPasswordBtn.onclick=sendPasswordReset;
  const guestBtn=document.getElementById('authGuestBtn');
  if(guestBtn) guestBtn.onclick=continueAsGuest;
  const homeBtn=document.getElementById('authHomeBtn');
  if(homeBtn) homeBtn.onclick=()=>{ window.location.href='index.html'; };

  const avatarBtn=document.getElementById('profileAvatarBtn');
  const profilePanel=document.getElementById('profilePanel');
  if(avatarBtn) avatarBtn.onclick=e=>{ e.stopPropagation(); profilePanel.classList.toggle('show'); };
  const profilePictureInput=document.getElementById('profilePictureInput');
  // Use event delegation on the panel for the upload button
  if(profilePanel){
    profilePanel.addEventListener('click',e=>{
      const upload=e.target.closest('.profile-avatar-upload');
      if(upload){
        e.preventDefault();
        e.stopPropagation();
        profilePictureInput?.click();
      }
    },true);
  }
  if(profilePictureInput) profilePictureInput.onchange=e=>{
    const file=e.target.files && e.target.files[0];
    if(file) handleProfilePictureUpload(file);
    e.target.value='';
  };
  const syncNowBtn=document.getElementById('profileSyncNowBtn');
  if(syncNowBtn) syncNowBtn.onclick=()=>syncNow();
  const settingsBtn=document.getElementById('profileSettingsBtn');
  if(settingsBtn) settingsBtn.onclick=()=>{
    document.getElementById('profilePanel')?.classList.remove('show');
    if(typeof selectFilter==='function') selectFilter('settings');
  };
  const whatsNewBtn=document.getElementById('profileWhatsNewBtn');
  if(whatsNewBtn) whatsNewBtn.onclick=()=>{
    document.getElementById('profilePanel')?.classList.remove('show');
    if(typeof openChangelogModal==='function') openChangelogModal();
  };

  const signInBtn=document.getElementById('profileSignInBtn');
  if(signInBtn) signInBtn.onclick=()=>{
    document.getElementById('profilePanel')?.classList.remove('show');
    showAuthLanding();
  };
  const signOutBtn=document.getElementById('profileSignOutBtn');
  if(signOutBtn) signOutBtn.onclick=signOutUser;
  const setSyncNowBtn=document.getElementById('setSyncNowBtn');
  if(setSyncNowBtn) setSyncNowBtn.onclick=()=>syncNow();

  document.addEventListener('click', e=>{
    if(profilePanel && !e.target.closest('#profileMenuWrap') && !e.target.closest('#profilePanel')) profilePanel.classList.remove('show');
  });

  buildAccentSwatches();
  applyAccent(appSettings.accent||'blue');
  const accentSel=document.getElementById('setTheme');
  if(accentSel){ /* theme select already bound in bindSettings */ }
}

/* ============================================================
   CENTRALIZED NOTIFICATION STORE & PANEL
   ============================================================ */
const NOTIF_KEY='octonotes:notifications';
let appNotifications=[];

const NOTIF_TYPES=new Set(['task','note','media','system','edit','reminder','calendar','export','import','pin','delete','tag','archive']);
function normalizeNotification(item){
  if(!item || typeof item!=='object') return null;
  const id=typeof paperussSafeId==='function'?paperussSafeId(item.id):String(item.id||'');
  if(!id) return null;
  const action=String(item.action||'').slice(0,5000);
  return {
    id,
    type:NOTIF_TYPES.has(item.type)?item.type:'system',
    title:String(item.title||'').slice(0,500),
    body:String(item.body||'').slice(0,2000),
    icon:String(item.icon||'bell').replace(/[^A-Za-z0-9-]/g,'').slice(0,50)||'bell',
    action:action && (typeof paperussSafeUrl!=='function'||paperussSafeUrl(action,'href','A'))?action:null,
    actionLabel:String(item.actionLabel||'').slice(0,100)||null,
    read:item.read===true,
    createdAt:Number.isFinite(+item.createdAt)?+item.createdAt:Date.now()
  };
}
function loadNotifications(){
  try{
    const parsed=JSON.parse(localStorage.getItem(NOTIF_KEY))||[];
    appNotifications=Array.isArray(parsed)?parsed.map(normalizeNotification).filter(Boolean).slice(0,200):[];
  }catch(e){ appNotifications=[]; }
}
function saveNotifications(){
  appNotifications=appNotifications.map(normalizeNotification).filter(Boolean).slice(0,200);
  localStorage.setItem(NOTIF_KEY, JSON.stringify(appNotifications));
  markPortableStateChanged();
}

function addNotification({type,title,body,icon,action,actionLabel,activity=false}){
  if(!title) return;
  if(activity && typeof appSettings==='object' && appSettings.notifActivity===false) return;
  const n=normalizeNotification({
    id:'n_'+Date.now().toString(36)+Math.random().toString(36).slice(2,6),
    type:type||'system',
    title, body:body||'',
    icon:icon||'bell',
    action:action||null,
    actionLabel:actionLabel||null,
    read:false,
    createdAt:Date.now()
  });
  if(!n) return;
  appNotifications.unshift(n);
  saveNotifications();
  updateNotifBadge();
}

function markNotifRead(id){
  const n=appNotifications.find(x=>x.id===id);
  if(n){ n.read=true; saveNotifications(); updateNotifBadge(); }
}
function markAllNotifRead(){
  appNotifications.forEach(n=>n.read=true);
  saveNotifications(); updateNotifBadge(); renderNotifPanel();
  toast('All notifications marked as read');
}
function clearAllNotifs(){
  appNotifications=[]; saveNotifications(); updateNotifBadge(); renderNotifPanel();
  toast('All notifications cleared');
}
function removeNotif(id){
  appNotifications=appNotifications.filter(n=>n.id!==id);
  saveNotifications(); updateNotifBadge(); renderNotifPanel();
}

function unreadCount(){ return appNotifications.filter(n=>!n.read).length; }

function updateNotifBadge(){
  const badge=document.getElementById('notifBadge');
  const c=unreadCount();
  if(!badge) return;
  badge.textContent=c>99?'99+':c;
  badge.classList.toggle('show', c>0);
}

function renderNotifPanel(){
  const body=document.getElementById('notifPanelBody');
  if(!body) return;
  if(!appNotifications.length){
    body.innerHTML=`<div class="np-empty">
      <i data-lucide="bell-off" style="width:32px;height:32px"></i>
      No notifications yet<br><span style="font-size:11.5px">Reminders, edits & activity will appear here.</span>
    </div>`;
    refreshIcons(); return;
  }

  const now=Date.now();
  const DAY=86400000;
  const startOfToday=new Date(); startOfToday.setHours(0,0,0,0);
  const todayTs=startOfToday.getTime();
  const yesterdayTs=todayTs-DAY;
  const sevenDaysAgo=todayTs-7*DAY;

  function groupLabel(ts){
    if(ts>=todayTs) return 'Today';
    if(ts>=yesterdayTs) return 'Yesterday';
    if(ts>=sevenDaysAgo) return 'Earlier this week';
    return 'Older';
  }
  function fmtShort(ts){
    const d=new Date(ts);
    return d.toLocaleString(undefined,{hour:'2-digit',minute:'2-digit'});
  }
  function iconSvg(icon){
    const map={task:'check-square',note:'file-text',media:'image',system:'bell',edit:'pencil',reminder:'alarm-clock',export:'download',import:'upload',pin:'pin',delete:'trash-2',tag:'tag',archive:'archive'};
    return map[icon]||'bell';
  }

  let html='';
  let lastGroup='';
  appNotifications.forEach(n=>{
    const grp=groupLabel(n.createdAt);
    if(grp!==lastGroup){
      html+=`<div class="np-group-label">${grp}</div>`;
      lastGroup=grp;
    }
    const actionHtml=n.action && n.actionLabel
      ?`<div class="np-item-action" data-notif-action="${n.id}" data-notif-url="${esc(n.action)}">${esc(n.actionLabel)}</div>`:'';
    html+=`<div class="np-item ${n.read?'':'unread'}" data-notif-read="${n.id}">
      <div class="np-item-icon ${n.type}">
        <i data-lucide="${iconSvg(n.icon)}" style="width:16px;height:16px"></i>
      </div>
      <div class="np-item-body">
        <div class="np-item-title">${esc(n.title)}</div>
        ${n.body?`<div class="np-item-text">${esc(n.body)}</div>`:''}
        <div class="np-item-time">${fmtShort(n.createdAt)}</div>
        ${actionHtml}
      </div>
      <button class="np-item-dismiss" data-notif-dismiss="${n.id}" title="Dismiss">&times;</button>
    </div>`;
  });
  body.innerHTML=html;
  refreshIcons();
}
