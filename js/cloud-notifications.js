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
const STARTER_SEED_VERSION=1;
// This deployment keeps attachment data in Firestore. Set to false only after
// Firebase Storage is intentionally configured and deployed for this project.
const FIRESTORE_ONLY_MEDIA=true;
const UPLOAD_RETRY_BASE_MS=30000; // 30s base; doubles each failure: 30s→1m→2m→4m→8m

let fbApp=null, fbAuth=null, fbDb=null, fbStorage=null, fbAnalytics=null, firebaseReady=false;
let currentSession=null; // {mode:'guest'} | {mode:'auth', uid, name, email, photoURL}
let syncState='offline'; // offline | synced | syncing | error
let syncGeneration=0;
let syncInFlight=false;
let syncDebounceTimer=null;
let mediaRetryTimer=null;
let cloudSyncApplyingRemote=false;
let syncRequestedWhileBusy=false;

function updateSyncStatusForRun(runId, newState, customText) {
  if (runId !== syncGeneration || !syncInFlight) return;
  updateSyncStatus(newState, customText);
}

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
        // Queue normal sync immediately so it's not blocked by starter notes
        syncNow({silent:true});
        ensureStarterNotesForAccount(user.uid)
          .then(didSeed => { if (didSeed) syncNow({silent:true}); })
          .catch(err=>console.warn('PapeRuss starter notes seed warning:',err));
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

async function seedAndSyncAccount(uid, opts){
  try{
    await ensureStarterNotesForAccount(uid);
  }catch(err){
    console.warn('PapeRuss starter notes seed warning:',err);
  }
  return syncNow(opts);
}

/* Seed the documentation note and its leaves once per signed-in account.
   The marker is written in the same Firestore transaction as the missing
   records, so multiple tabs cannot create duplicate starter packs. */
async function ensureStarterNotesForAccount(uid){
  if(!uid || !fbDb || typeof seedNotes!=='function') return false;
  const rootRef=fbDb.collection('paperuss_users').doc(uid);
  return fbDb.runTransaction(async tx=>{
    const rootSnap=await tx.get(rootRef);
    const rootData=rootSnap.exists?(rootSnap.data()||{}):{};
    if(+rootData.starterSeedVersion>=STARTER_SEED_VERSION) return false;

    const starters=seedNotes();
    const plans=[];
    // Read all existing records before issuing transaction writes.
    for(const starter of starters){
      const noteRef=rootRef.collection('notes').doc(starter.id);
      const noteSnap=await tx.get(noteRef);
      const leafPlans=[];
      for(const leaf of (starter.seedLeaves||[])){
        const leafRef=noteRef.collection('leaves').doc(leaf.id);
        leafPlans.push({leaf,ref:leafRef,snap:await tx.get(leafRef)});
      }
      plans.push({starter,noteRef,noteSnap,leafPlans});
    }

    for(const {starter,noteRef,noteSnap,leafPlans} of plans){
      if(!noteSnap.exists){
        const {seedLeaves,...noteRecord}=starter;
        tx.set(noteRef,noteRecord,{merge:true});
      }
      for(const {leaf,ref,snap} of leafPlans){
        if(!snap.exists) tx.set(ref,leaf,{merge:true});
      }
    }
    tx.set(rootRef,{starterSeedVersion:STARTER_SEED_VERSION,starterSeededAt:Date.now()},{merge:true});
    return true;
  });
}
window.ensureStarterNotesForAccount=ensureStarterNotesForAccount;

function showAuthLanding(){
  const el=document.getElementById('authLanding');
  if(el) {
    el.classList.remove('hidden');
    el.classList.remove('leaving');
  }
  // Guest mode also marks the document as having a session. Clear that
  // marker before showing the auth surface or the global CSS hides it.
  document.documentElement.classList.remove('has-session');
  document.documentElement.classList.remove('auth-pending');
  if(typeof closeLeavesDrawer === 'function') closeLeavesDrawer();
  if(typeof updateLeafTitleBar === 'function') updateLeafTitleBar();
}
function hideAuthLanding(){
  const el=document.getElementById('authLanding');
  if(el && !el.classList.contains('hidden')){
    el.classList.add('leaving');
    document.documentElement.classList.add('has-session');
    setTimeout(()=>{
      el.classList.add('hidden');
      el.classList.remove('leaving');
    }, 420);
  } else if(el) {
    el.classList.add('hidden');
    document.documentElement.classList.add('has-session');
  }
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
    await seedAndSyncAccount(user.uid);
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
    await seedAndSyncAccount(user.uid);
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
    await seedAndSyncAccount(user.uid);
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






/* Merge records by id, then apply deletion markers so removed data stays removed. */







// Cancellable version for Firebase uploadTask objects

/* ============================================================
   OFFLINE UPLOAD QUEUE — persists upload IDs across reloads
   ============================================================ */

// Retry failed media while the browser remains online.  The per-record
// backoff still lives in syncMedia(), so this only wakes the next attempt.

/* Dynamic upload timeout — 1 byte/ms minimum, floor at 20s, ceiling at 15min */








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

  if (typeof initSyncEngine === 'function') initSyncEngine();

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
