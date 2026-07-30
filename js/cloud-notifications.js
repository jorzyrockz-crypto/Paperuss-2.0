/* ============================================================
   FIREBASE AUTH + CLOUD SYNC (with full offline fallback)
   ============================================================ */
// Fill these with your own Firebase project credentials to enable real
// cross-device sign-in/sync. Left blank, PapeRuss runs fully offline —
// the landing page will still appear but cloud sign-in gracefully
// falls back to Guest mode with a friendly notice.
const FIREBASE_CONFIG={
  apiKey:"AIzaSyDVurj0n57qBiSBwuCjaDpi5CSQs-3I3f0",
  authDomain:"paperuss-2.firebaseapp.com",
  projectId:"paperuss-2",
  storageBucket:"paperuss-2.firebasestorage.app",
  messagingSenderId:"158402331948",
  appId:"1:158402331948:web:a3abb73a2c84b14e78d889",
  measurementId:"G-1ZC6WLYCPG"
};
const AUTH_SESSION_KEY='octonotes:session';
const LAST_SYNC_KEY='octonotes:lastSyncAt';
const CLOUD_DELETIONS_KEY='paperuss:cloudDeletions';
const PORTABLE_STATE_UPDATED_KEY='paperuss:portableStateUpdatedAt';
const PROFILE_PHOTO_KEY='paperuss:profilePhoto';

let fbApp=null, fbAuth=null, fbDb=null, fbStorage=null, fbAnalytics=null, firebaseReady=false;
let currentSession=null; // {mode:'guest'} | {mode:'auth', uid, name, email, photoURL}
let syncState='offline'; // offline | synced | syncing | error
let syncDebounceTimer=null;
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
    fbAuth.onAuthStateChanged(user=>{
      if(user){
        saveSession({mode:'auth', uid:user.uid, name:user.displayName||user.email||'Account', email:user.email||'', photoURL:user.photoURL||''});
        renderProfileMenu();
        syncNow({silent:true});
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
}
function hideAuthLanding(){
  const el=document.getElementById('authLanding');
  if(el) el.classList.add('hidden');
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

async function signInWithGoogle(fromLanding){
  if(!firebaseReady){
    toast('Cloud sign-in is not configured — continuing offline');
    if(fromLanding) continueAsGuest();
    return;
  }
  try{
    const provider=new firebase.auth.GoogleAuthProvider();
    const result=await fbAuth.signInWithPopup(provider);
    const user=result.user;
    saveSession({mode:'auth', uid:user.uid, name:user.displayName||user.email||'Account', email:user.email||'', photoURL:user.photoURL||''});
    hideAuthLanding();
    renderProfileMenu();
    toast('Signed in as '+(user.displayName||user.email));
    syncNow();
  }catch(err){
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
  return messages[code]||'Authentication failed. Please try again.';
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

function mediaManifestEntry(record){
  return {
    id:record.id,
    kind:record.kind||'file',
    name:record.name||'file',
    type:record.type||'application/octet-stream',
    size:+record.size||record.blob?.size||0,
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

async function syncMedia(uid,remoteManifest,deletions,requiredMediaIds){
  const localRecords=await mediaAll();
  if(!fbStorage){
    if(localRecords.length || (remoteManifest||[]).length) console.warn('Firebase Storage SDK is unavailable');
    return Array.from((remoteManifest||[]).values?.() || remoteManifest || []);
  }

  const localMap=new Map(localRecords.map(record=>[record.id,record]));
  const manifestMap=new Map((remoteManifest||[]).map(item=>[item.id,item]));

  for(const [id,deletedAt] of Object.entries(deletions||{})){
    const local=localMap.get(id);
    const remote=manifestMap.get(id);
    const itemTime=Math.max(local?.updatedAt||local?.createdAt||0,remote?.updatedAt||remote?.createdAt||0);
    if((+deletedAt||0)<itemTime) continue;
    if(local){
      cloudSyncApplyingRemote=true;
      try{ await mediaDel(id); }finally{ cloudSyncApplyingRemote=false; }
      localMap.delete(id);
    }
    if(remote){
      try{ await mediaStorageRef(uid,id).delete(); }
      catch(err){ if(!String(err?.code||'').includes('object-not-found')) console.warn(err); }
      manifestMap.delete(id);
    }
  }

  const pendingUploads = Array.from(localMap.values()).filter(record => {
    const remote = manifestMap.get(record.id);
    const localUpdated = record.updatedAt || record.createdAt || 0;
    const remoteUpdated = remote?.updatedAt || remote?.createdAt || 0;
    return !remote || localUpdated > remoteUpdated;
  });

  if(pendingUploads.length > 0){
    console.log(`PapeRuss: Cloud sync uploading ${pendingUploads.length} media asset(s)...`);
    updateSyncStatus('syncing', `Uploading ${pendingUploads.length} asset${pendingUploads.length!==1?'s':''}...`);
  }

  for(let i=0; i<pendingUploads.length; i++){
    const record = pendingUploads[i];
    if(record.blob && (record.blob instanceof Blob)){
      updateSyncStatus('syncing', `Uploading ${i+1}/${pendingUploads.length}: ${record.name||'photo'} (${formatBytes(record.blob.size)})`);
      try {
        const putPromise = mediaStorageRef(uid, record.id).put(record.blob, {
          contentType: record.type || record.blob?.type || 'application/octet-stream'
        });
        await withTimeout(putPromise, 15000, `Upload timed out for ${record.name||record.id}`);
        manifestMap.set(record.id, mediaManifestEntry(record));
      } catch(uploadErr) {
        console.warn(`PapeRuss: Media upload warning for ${record.id}:`, uploadErr);
      }
    } else {
      console.warn(`Media ${record.id} has no valid blob, skipping upload`);
    }
  }

  for(const record of localMap.values()){
    const localUpdated = record.updatedAt || record.createdAt || 0;
    const syncedRecord = {...record, cloudSyncedAt: localUpdated || Date.now()};
    try { await mediaPut(syncedRecord); } catch(_){}
    localMap.set(record.id, syncedRecord);
  }

  for(const item of manifestMap.values()){
    if(localMap.has(item.id)) continue;
    try {
      const url=await withTimeout(mediaStorageRef(uid,item.id).getDownloadURL(), 10000, `Download URL timeout for ${item.id}`);
      const response=await withTimeout(fetch(url), 10000, `Fetch timeout for ${item.id}`);
      if(response.ok){
        const blob=await response.blob();
        const downloadedRecord={...item,size:blob.size,blob,cloudSyncedAt:item.updatedAt||item.createdAt||Date.now()};
        await mediaPut(downloadedRecord);
        localMap.set(item.id,downloadedRecord);
      }
    } catch(dlErr) {
      console.warn(`PapeRuss: Media download warning for ${item.id}:`, dlErr);
    }
  }

  return Array.from(manifestMap.values());
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
    const snap=await docRef.get();
    const manifest=snap.exists?(snap.data().mediaManifest||[]):[];
    if(fbStorage){
      await Promise.all(manifest.map(async item=>{
        try{ await mediaStorageRef(session.uid,item.id).delete(); }
        catch(err){ if(!String(err?.code||'').includes('object-not-found')) throw err; }
      }));
    }else if(manifest.length){
      throw new Error('Firebase Storage SDK is unavailable');
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
  const session=currentSession||loadSession();
  if(!session || session.mode!=='auth' || !firebaseReady){
    updateSyncStatus('offline');
    if(!opts.silent) toast(session && session.mode==='auth' ? 'Sync unavailable right now' : 'Sign in to enable cloud sync');
    return;
  }
  if(!navigator.onLine){
    updateSyncStatus('offline','Offline · changes saved locally');
    return;
  }
  updateSyncStatus('syncing');
  try{
    const docRef=fbDb.collection('paperuss_users').doc(session.uid);
    const snap=await docRef.get();
    const remote=snap.exists?snap.data():{};

    standaloneTasks.forEach(task=>{ if(!task.updatedAt) task.updatedAt=task.createdAt||Date.now(); });
    const localDeletions=readCloudDeletions();
    const mergedDeletions=mergeDeletionSets(localDeletions,remote.deletions);
    let localNotes=notes;
    if((remote.notes||[]).length){
      try{
        const seedIds=new Set(JSON.parse(localStorage.getItem('paperuss:seedNoteIds'))||[]);
        if(seedIds.size) localNotes=notes.filter(note=>!seedIds.has(note.id));
      }catch(_){}
    }
    const mergedNotes=mergeById(localNotes,remote.notes||[],'updatedAt',mergedDeletions.notes);
    const mergedTasks=mergeById(standaloneTasks,remote.tasks||[],'updatedAt',mergedDeletions.tasks);
    const localSettingsUpdated=+localStorage.getItem('octonotes:settingsUpdatedAt')||0;
    const mergedSettingsUpdated=Math.max(localSettingsUpdated,+remote.settingsUpdatedAt||0)||Date.now();
    const mergedSettings = (+remote.settingsUpdatedAt||0)>localSettingsUpdated
      ? {...appSettings, ...(remote.settings||{})}
      : appSettings;
    const localPortableUpdated=+localStorage.getItem(PORTABLE_STATE_UPDATED_KEY)||0;
    const mergedPortableUpdated=Math.max(localPortableUpdated,+remote.portableStateUpdatedAt||0)||Date.now();
    const mergedPortable=(+remote.portableStateUpdatedAt||0)>localPortableUpdated
      ? {...collectPortableState(),...(remote.portableState||{})}
      : collectPortableState();

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
      renderAll();
      renderStorageStats();
    }finally{
      cloudSyncApplyingRemote=false;
    }

    // Save notes text, tables & tasks to Firestore IMMEDIATELY so notes sync across devices in ~150ms!
    await docRef.set({
      notes:mergedNotes, tasks:mergedTasks, settings:mergedSettings,
      settingsUpdatedAt:mergedSettingsUpdated,
      portableState:mergedPortable, portableStateUpdatedAt:mergedPortableUpdated,
      mediaManifest:remote.mediaManifest||[], deletions:mergedDeletions,
      schemaVersion:2, updatedAt:Date.now(),
      owner:session.uid, email:session.email||''
    }, {merge:true});

    // Now sync media files non-blockingly with timeouts
    const requiredMediaIds=typeof referencedStoredMediaIds==='function'
      ? referencedStoredMediaIds(mergedNotes)
      : new Set();
    try {
      const mergedMediaManifest=await syncMedia(
        session.uid,remote.mediaManifest||[],mergedDeletions.media,requiredMediaIds
      );
      await docRef.set({ mediaManifest: mergedMediaManifest, updatedAt: Date.now() }, {merge:true});
    } catch(mediaErr) {
      console.warn('PapeRuss media sync non-blocking warning:', mediaErr);
    }

    localStorage.setItem(LAST_SYNC_KEY, String(Date.now()));
    updateSyncStatus('synced');
    if(typeof hydrateMediaInEditor==='function') hydrateMediaInEditor();
    if(!opts.silent) toast('Synced with cloud');
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

  window.addEventListener('online', ()=>{ if((currentSession||{}).mode==='auth') syncNow({silent:true}); });
  window.addEventListener('offline', ()=>updateSyncStatus('offline'));

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

function loadNotifications(){
  try{ appNotifications=JSON.parse(localStorage.getItem(NOTIF_KEY))||[]; }
  catch(e){ appNotifications=[]; }
}
function saveNotifications(){
  localStorage.setItem(NOTIF_KEY, JSON.stringify(appNotifications.slice(0,200)));
  markPortableStateChanged();
}

function addNotification({type,title,body,icon,action,actionLabel}){
  if(!title) return;
  const n={
    id:'n_'+Date.now().toString(36)+Math.random().toString(36).slice(2,6),
    type:type||'system',
    title, body:body||'',
    icon:icon||'bell',
    action:action||null,
    actionLabel:actionLabel||null,
    read:false,
    createdAt:Date.now()
  };
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
