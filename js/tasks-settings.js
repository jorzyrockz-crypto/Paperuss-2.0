/* ============================================================
   STANDALONE TASKS + REMINDERS + NOTIFICATIONS
   ============================================================ */
const TASKS_KEY='octonotes:tasks';
let standaloneTasks=[];

function loadTasks(){
  try{ standaloneTasks=JSON.parse(localStorage.getItem(TASKS_KEY))||[]; }
  catch(e){ standaloneTasks=[]; }
}
function saveTasks(){
  localStorage.setItem(TASKS_KEY, JSON.stringify(standaloneTasks));
  if(typeof queueCloudSync==='function') queueCloudSync();
}

function openTaskCreatorModal(){
  const root=document.getElementById('modalRoot');
  root.innerHTML=`<div class="modal-overlay"><div class="modal" style="max-width:480px">
    <h3>✅ Create Tasks</h3>
    <p style="color:var(--fg-secondary);font-size:12.5px;margin-bottom:14px">
      Add multiple tasks — one per line. They will be grouped as a single block.
    </p>
    <div style="display:flex;flex-direction:column;gap:10px;margin-bottom:16px">
      <textarea id="tmTasks" rows="5" placeholder="Buy groceries&#10;Email the client&#10;Review pull request" style="background:var(--subtle);border:1px solid var(--border);border-radius:10px;padding:12px;font-size:13.5px;outline:none;color:var(--fg);resize:vertical;line-height:1.6"></textarea>
      <div style="display:flex;gap:8px;flex-wrap:wrap">
        <select id="tmPriority" style="background:var(--subtle);border:1px solid var(--border);border-radius:8px;padding:8px 10px;font-size:13px;outline:none;color:var(--fg);flex:1;min-width:100px">
          <option value="low">🟢 Low</option>
          <option value="medium" selected>🟡 Medium</option>
          <option value="high">🔴 High</option>
        </select>
        <input id="tmDue" type="datetime-local" style="background:var(--subtle);border:1px solid var(--border);border-radius:8px;padding:8px 10px;font-size:13px;outline:none;color:var(--fg);flex:1;min-width:160px" title="Shared reminder for all tasks">
      </div>
      <label style="display:flex;align-items:center;gap:8px;font-size:12.5px;color:var(--fg-secondary);cursor:pointer">
        <input type="checkbox" id="tmInsertNote" checked> Also insert as a checklist in a new note
      </label>
    </div>
    <div class="modal-actions">
      <button class="btn" id="tmCancel">Cancel</button>
      <button class="btn btn-primary" id="tmCreate">Create Tasks</button>
    </div>
  </div></div>`;
  const close=()=>root.innerHTML='';
  document.getElementById('tmCancel').onclick=close;
  root.querySelector('.modal-overlay').onclick=e=>{ if(e.target===e.currentTarget) close(); };
  document.getElementById('tmCreate').onclick=()=>{
    const raw=document.getElementById('tmTasks').value;
    const lines=raw.split('\n').map(s=>s.trim()).filter(Boolean);
    if(!lines.length){ toast('Enter at least one task'); return; }
    const prio=document.getElementById('tmPriority').value;
    const dueVal=document.getElementById('tmDue').value;
    const due=dueVal?new Date(dueVal).getTime():null;
    const insertNote=document.getElementById('tmInsertNote').checked;
    const groupId='g_'+Date.now().toString(36);
    lines.forEach(txt=>{
      standaloneTasks.unshift({
        id:'t_'+Date.now().toString(36)+Math.random().toString(36).slice(2,6),
        text:txt, completed:false,
        priority:prio, due, notified:false,
        groupId,
        createdAt:Date.now(), updatedAt:Date.now()
      });
    });
    saveTasks();
    // Also create a note with checkboxes if checked
    if(insertNote){
      const checklistHtml=lines.map(t=>`<li data-task="1"><input type="checkbox"> ${esc(t)}</li>`).join('');
      const noteContent=`<p><strong>Task Block</strong></p><ul>${checklistHtml}</ul>`;
      const n={
        id:uid(), title:'Task Block · '+lines[0], content:noteContent,
        tags:['tasks'], pinned:false, archived:false,
        createdAt:Date.now(), updatedAt:Date.now(), fontStyle:'sans'
      };
      notes.unshift(n);
      save();
    }
    renderTasksView(); updateTasksCount(); renderAll();
    addNotification({type:'task',title:`${lines.length} tasks created`,body:lines.slice(0,3).join(', ')+(lines.length>3?'…':''),icon:'check-square'});
    close();
  };
  setTimeout(()=>document.getElementById('tmTasks').focus(),50);
}

let taskAudioCtx=null;
function playTaskCompleteSound(){
  try{
    if(typeof appSettings==='object' && appSettings.notifSound===false) return;
    const AC=window.AudioContext||window.webkitAudioContext;
    if(!AC) return;
    // Reuse one context — browsers cap the number of concurrent AudioContexts.
    if(!taskAudioCtx || taskAudioCtx.state==='closed') taskAudioCtx=new AC();
    if(taskAudioCtx.state==='suspended') taskAudioCtx.resume();
    const ctx=taskAudioCtx;
    const t0=ctx.currentTime;
    const o=ctx.createOscillator();
    const g=ctx.createGain();
    o.connect(g); g.connect(ctx.destination);
    o.type='sine';
    // Pleasant ascending chime: C5 -> C6
    o.frequency.setValueAtTime(523.25,t0);
    o.frequency.exponentialRampToValueAtTime(1046.5,t0+.12);
    g.gain.setValueAtTime(.0001,t0);
    g.gain.exponentialRampToValueAtTime(.15,t0+.02);
    g.gain.exponentialRampToValueAtTime(.0001,t0+.22);
    o.start(t0); o.stop(t0+.24);
    o.onended=()=>{ try{ o.disconnect(); g.disconnect(); }catch(e){} };
  }catch(e){}
}

function toggleStandaloneTask(id, checked){
  const t=standaloneTasks.find(x=>x.id===id);
  if(!t) return;
  t.completed=checked;
  t.updatedAt=Date.now();
  if(checked){ t.notified=true; playTaskCompleteSound(); }
  saveTasks(); renderTasksView(); updateTasksCount();
  toast(checked?'Task completed':'Task marked pending');
}

function deleteStandaloneTask(id){
  const idx=standaloneTasks.findIndex(x=>x.id===id);
  if(idx<0) return;
  const removed=standaloneTasks.splice(idx,1)[0];
  if(typeof recordCloudDeletion==='function') recordCloudDeletion('tasks',id);
  saveTasks(); renderTasksView(); updateTasksCount();
  toast('Task deleted', ()=>{
    standaloneTasks.splice(idx,0,removed);
    removed.updatedAt=Date.now();
    if(typeof clearCloudDeletion==='function') clearCloudDeletion('tasks',id);
    saveTasks(); renderTasksView(); updateTasksCount();
  });
}

function deleteNoteTask(noteId, taskIdx){
  const n=getNote(noteId);
  if(!n || !n.content) return;
  confirmDialog('Delete task?','This task will be removed from the note.','Delete',()=>{
    const tmp=document.createElement('div');
    tmp.innerHTML=n.content;
    const checkboxes=tmp.querySelectorAll('input[type=checkbox]');
    if(checkboxes[taskIdx]){
      const li=checkboxes[taskIdx].closest('li');
      if(li){
        if(li.parentElement.children.length===1){
          li.parentElement.remove();
        }else{
          li.remove();
        }
      }else{
        checkboxes[taskIdx].parentElement.remove();
      }
      n.content=tmp.innerHTML;
      n.updatedAt=Date.now();
      save(); renderTasksView(); renderAll();
      toast('Task deleted from note');
    }
  });
}

function formatDue(ts){
  const d=new Date(ts), now=Date.now();
  const diff=ts-now;
  const dateStr=d.toLocaleString(undefined,{month:'short',day:'numeric',hour:'2-digit',minute:'2-digit'});
  let cls='';
  if(diff<0) cls='overdue';
  else if(diff < 24*3600*1000) cls='soon';
  return {dateStr, cls, overdue:diff<0};
}

/* --- Notifications --- */
function notifSupported(){ return 'Notification' in window; }

function updateNotifBar(){
  const bar=document.getElementById('notifBar');
  if(!bar) return;
  if(notifSupported() && Notification.permission==='default') bar.style.display='flex';
  else bar.style.display='none';
}

function requestNotifPermission(){
  if(!notifSupported()){ toast('Notifications not supported here'); return; }
  Notification.requestPermission().then(p=>{
    updateNotifBar();
    if(p==='granted'){
      toast('Reminders enabled');
        fireNotification('PapeRuss reminders on', 'You will be notified when tasks are due.');
        addNotification({type:'task',title:'Reminders enabled',body:'You will be notified when tasks are due.',icon:'bell'});
    } else toast('Notifications blocked');
  });
}

function fireNotification(title, body){
  try{
    if(notifSupported() && Notification.permission==='granted'){
      new Notification(title, {body, icon:'', badge:''});
    }
  }catch(e){}
}

let reminderTimer=null;
function startReminderWatcher(){
  if(reminderTimer) clearInterval(reminderTimer);
  const check=()=>{
    const now=Date.now();
    let changed=false;
    const dueTasks=[];
    standaloneTasks.forEach(t=>{
      if(!t.completed && t.due && !t.notified && t.due<=now){
        t.notified=true; t.updatedAt=Date.now(); changed=true;
        dueTasks.push(t);
      }
    });
    if(dueTasks.length>0){
      dueTasks.forEach(t=>{
        const prio='Priority: '+(t.priority||'medium').toUpperCase();
        fireNotification('⏰ Task due: '+t.text, prio);
        addNotification({type:'task',title:'⏰ Task due: '+t.text,body:prio+' — open Tasks to complete it.',icon:'alarm-clock'});
      });
      // Only one banner at a time, so repeated cycles never stack.
      document.querySelectorAll('.task-due-toast').forEach(el=>el.remove());
      const msg=dueTasks.length===1
        ? '⏰ Task due: '+esc(dueTasks[0].text)
        : `⏰ ${dueTasks.length} tasks due!`;
      const toastEl=document.createElement('div');
      toastEl.className='toast task-due-toast';
      toastEl.innerHTML=`<span style="font-size:14px;font-weight:600;flex:1">${msg}</span><button class="toast-action" style="font-size:13px;font-weight:700;color:#fff">View</button>`;
      toastEl.style.cssText='position:fixed;top:70px;left:50%;transform:translateX(-50%);z-index:999;min-width:260px;max-width:calc(100vw - 32px);background:var(--danger);color:#fff;border:none;box-shadow:0 12px 40px rgba(239,68,68,.45);opacity:1;transition:opacity .3s ease';
      document.body.appendChild(toastEl);
      toastEl.querySelector('.toast-action').onclick=()=>{
        state.filter='tasks'; state.taskFilter='today';
        document.querySelectorAll('.nav-btn').forEach(b=>b.classList.toggle('active',b.dataset.filter==='tasks'));
        renderAll();
        if(window.innerWidth<=640) showMobileEditor();
        toastEl.remove();
      };
      setTimeout(()=>{
        toastEl.style.opacity='0';
        setTimeout(()=>toastEl.remove(),300);
      }, 10000);
    }
    if(changed){ saveTasks(); if(state.filter==='tasks') renderTasksView(); }
  };
  check();
  reminderTimer=setInterval(check, appSettings.reminderInterval||30000);
}

/* ============================================================
   SETTINGS STORE & PAGE
   ============================================================ */
const SETTINGS_KEY='octonotes:settings';
let appSettings={
  defaultFont:'sans', editorWidth:'auto', reminderInterval:30000, accent:'blue',
  notifBanner:true, notifSound:true, notifEvents:true, notifActivity:true, notifToasts:true
};

function loadSettings(){
  try{
    const saved=JSON.parse(localStorage.getItem(SETTINGS_KEY));
    if(saved && typeof saved==='object') appSettings={...appSettings, ...saved};
  }catch(e){}
  applySettingsEffects();
}
function saveSettings(){
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(appSettings));
  localStorage.setItem('octonotes:settingsUpdatedAt', String(Date.now()));
  applySettingsEffects();
  if(typeof queueCloudSync==='function') queueCloudSync();
}
const APP_FONT_STACKS={
  sans:'"Inter",-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif',
  serif:'Georgia,"Times New Roman",serif',
  mono:'ui-monospace,SFMono-Regular,Menlo,Consolas,monospace',
  rounded:'"SF Pro Rounded","Quicksand",system-ui,-apple-system,sans-serif'
};

function applySettingsEffects(){
  // App-wide font: notes keep their own per-note fontStyle, this drives the UI shell.
  const stack=APP_FONT_STACKS[appSettings.defaultFont]||APP_FONT_STACKS.sans;
  document.documentElement.style.setProperty('--app-font', stack);
  document.body.style.fontFamily=stack;
  // Editor width is automatic — clear any legacy fixed width so CSS clamp() governs it.
  const ed=document.getElementById('noteBody');
  if(ed) ed.style.maxWidth='';
  // Accent color
  if(typeof applyAccent==='function') applyAccent(appSettings.accent||'blue');
}

async function renderSettingsView(){
  // Sync control values with stored settings
  const themeSel=document.getElementById('setTheme');
  if(themeSel) themeSel.value=document.documentElement.getAttribute('data-theme')||'dark';
  const fontSel=document.getElementById('setDefaultFont');
  if(fontSel) fontSel.value=appSettings.defaultFont||'sans';
  const intSel=document.getElementById('setReminderInterval');
  if(intSel) intSel.value=String(appSettings.reminderInterval||30000);

  // Notification toggles
  [['setNotifBanner','notifBanner'],['setNotifSound','notifSound'],
   ['setNotifEvents','notifEvents'],['setNotifActivity','notifActivity'],
   ['setNotifToasts','notifToasts']].forEach(([id,key])=>{
    const el=document.getElementById(id);
    if(el) el.checked=appSettings[key]!==false;
  });

  // Accent swatches
  if(typeof buildAccentSwatches==='function') buildAccentSwatches();
  if(typeof applyAccent==='function') applyAccent(appSettings.accent||'blue');

  // Account & sync mirror
  if(typeof renderProfileMenu==='function') renderProfileMenu();

  // Notification permission status
  const permEl=document.getElementById('notifPermStatus');
  const permBtn=document.getElementById('setNotifPerm');
  if(permEl){
    if(!('Notification' in window)){ permEl.textContent='Permission: not supported'; if(permBtn) permBtn.disabled=true; }
    else{
      permEl.textContent='Permission: '+Notification.permission;
      if(permBtn) permBtn.disabled=Notification.permission==='granted';
    }
  }

  // Storage detail
  const storEl=document.getElementById('setStorageDetail');
  if(storEl){
    try{
      const jsonBytes=new Blob([JSON.stringify(notes)]).size;
      let mediaBytes=0, mediaCount=0;
      const totalBytes = jsonBytes + mediaBytes;
      const cloudEnabled = typeof currentSession==='object' && currentSession?.mode==='auth';
      const quotaStr = cloudEnabled ? ` · ${((totalBytes / (5 * 1024 * 1024 * 1024)) * 100).toFixed(2)}% of 5 GB Firebase Free Plan` : ' · Persistent Local Device Storage';
      storEl.textContent=`${notes.length} notes (${formatBytes(jsonBytes)}) · ${mediaCount} media (${formatBytes(mediaBytes)}) · ${standaloneTasks.length} tasks${quotaStr}`;
    }catch(e){ storEl.textContent='Unable to calculate'; }
  }
  refreshIcons();
}

function bindSettings(){
  const themeSel=document.getElementById('setTheme');
  if(themeSel) themeSel.onchange=e=>{ setTheme(e.target.value); toast('Theme updated'); };

  const fontSel=document.getElementById('setDefaultFont');
  if(fontSel) fontSel.onchange=e=>{ appSettings.defaultFont=e.target.value; saveSettings(); toast('App font updated'); };

  const intSel=document.getElementById('setReminderInterval');
  if(intSel) intSel.onchange=e=>{
    appSettings.reminderInterval=+e.target.value;
    saveSettings();
    startReminderWatcher();
    toast('Reminder interval updated');
  };

  const permBtn=document.getElementById('setNotifPerm');
  if(permBtn) permBtn.onclick=()=>{ requestNotifPermission(); setTimeout(renderSettingsView, 800); };

  // Notification & reminder toggles
  [['setNotifBanner','notifBanner','Due-task banner'],
   ['setNotifSound','notifSound','Completion sound'],
   ['setNotifEvents','notifEvents','Event reminders'],
   ['setNotifActivity','notifActivity','Activity log'],
   ['setNotifToasts','notifToasts','Toast pop-ups']].forEach(([id,key,label])=>{
    const el=document.getElementById(id);
    if(el) el.onchange=e=>{
      appSettings[key]=e.target.checked;
      saveSettings();
      toast(`${label} ${e.target.checked?'enabled':'disabled'}`);
    };
  });

  const testBtn=document.getElementById('setNotifTest');
  if(testBtn) testBtn.onclick=()=>{
    if(appSettings.notifSound!==false) playTaskCompleteSound();
    fireNotification('🔔 PapeRuss test', 'Notifications are working correctly.');
    addNotification({type:'system',title:'🔔 Test notification',body:'This is what a reminder looks like.',icon:'bell-ring'});
    toast('Test notification sent');
  };

  const expBtn=document.getElementById('setExportBtn');
  if(expBtn) expBtn.onclick=exportNotes;
  const impBtn=document.getElementById('setImportBtn');
  if(impBtn) impBtn.onclick=()=>document.getElementById('importFile').click();

  const gcBtn=document.getElementById('setGcBtn');
  if(gcBtn) gcBtn.onclick=async ()=>{
    await gcOrphanMedia();
    renderSettingsView();
    toast('Orphan media cleaned');
  };

  const clearCacheBtn=document.getElementById('setClearCacheBtn');
  if(clearCacheBtn) clearCacheBtn.onclick=()=>{
    confirmDialog(
      'Clear cached app data?',
      'This removes PapeRuss offline cache, notes, media and settings from this device, then reloads the newest app version. Synced cloud data is not deleted and can be restored after signing in.',
      'Clear & Reload',
      clearLocalAppCacheAndData
    );
  };

  const clearNotifsBtn=document.getElementById('setClearNotifs');
  if(clearNotifsBtn) clearNotifsBtn.onclick=clearAllNotifs;

  const clearTasksBtn=document.getElementById('setClearTasks');
  if(clearTasksBtn) clearTasksBtn.onclick=()=>{
    confirmDialog('Delete all tasks?','All standalone tasks will be permanently removed.','Delete',()=>{
      if(typeof recordCloudDeletion==='function') standaloneTasks.forEach(task=>recordCloudDeletion('tasks',task.id));
      standaloneTasks=[]; saveTasks(); updateTasksCount(); renderSettingsView();
      toast('All tasks deleted');
    });
  };

  const resetBtn=document.getElementById('setResetAll');
  if(resetBtn) resetBtn.onclick=()=>{
    confirmDialog('Reset everything?','ALL notes, media, tasks, notifications and settings will be permanently erased. This cannot be undone.','Reset App',async ()=>{
      if(typeof resetCloudWorkspace==='function' && !(await resetCloudWorkspace())) return;
      localStorage.removeItem(STORAGE_KEY);
      localStorage.removeItem(TASKS_KEY);
      localStorage.removeItem(NOTIF_KEY);
      localStorage.removeItem(SETTINGS_KEY);
      localStorage.removeItem(THEME_KEY);
      localStorage.removeItem('octonotes:calendarView');
      localStorage.removeItem('octonotes:calendarSelectedDate');
      localStorage.removeItem('paperuss:cloudDeletions');
      localStorage.removeItem('paperuss:portableStateUpdatedAt');
      localStorage.removeItem('paperuss:profilePhoto');
      localStorage.removeItem('paperuss:seedNoteIds');
      try{
        const all=await mediaAll();
        for(const rec of all) await mediaDel(rec.id);
      }catch(e){}
      location.reload();
    });
  };
}

async function clearLocalAppCacheAndData(){
  try{
    // Keep cloud records intact: deleting IndexedDB directly avoids recording
    // media deletions that would otherwise be synchronized to Firebase.
    if(mediaDB){ mediaDB.close(); mediaDB=null; }
    await new Promise(resolve=>{
      const request=indexedDB.deleteDatabase(MEDIA_DB);
      request.onsuccess=request.onerror=request.onblocked=()=>resolve();
    });

    Object.keys(localStorage)
      .filter(key=>key.startsWith('octonotes:')||key.startsWith('paperuss:'))
      .forEach(key=>localStorage.removeItem(key));

    if('caches' in window){
      const keys=await caches.keys();
      await Promise.all(keys
        .filter(key=>key.startsWith('paperuss-shell-'))
        .map(key=>caches.delete(key)));
    }

    if('serviceWorker' in navigator){
      const registration=await navigator.serviceWorker.getRegistration();
      if(registration) await registration.unregister();
    }
  }catch(error){
    console.warn('Could not fully clear local PapeRuss data',error);
  }
  location.reload();
}

/* ============================================================
   ACCENT THEMES
   ============================================================ */
const ACCENT_PRESETS={
  blue:   {accent:'#3b82f6', emphasis:'#2563eb'},
  purple: {accent:'#8b5cf6', emphasis:'#7c3aed'},
  green:  {accent:'#10b981', emphasis:'#059669'},
  rose:   {accent:'#f43f5e', emphasis:'#e11d48'},
  amber:  {accent:'#f59e0b', emphasis:'#d97706'},
  teal:   {accent:'#14b8a6', emphasis:'#0d9488'},
  pink:   {accent:'#ec4899', emphasis:'#db2777'},
  slate:  {accent:'#64748b', emphasis:'#475569'}
};

function applyAccent(key){
  const preset=ACCENT_PRESETS[key]||ACCENT_PRESETS.blue;
  const root=document.documentElement;
  root.style.setProperty('--accent', preset.accent);
  root.style.setProperty('--accent-emphasis', preset.emphasis);
  root.style.setProperty('--accent-soft', preset.accent+'24');
  root.style.setProperty('--accent-ring', preset.accent+'52');
  root.style.setProperty('--selection', preset.accent+'42');
  const themeMeta=document.querySelector('meta[name="theme-color"]');
  if(themeMeta) themeMeta.content=document.documentElement.getAttribute('data-theme')==='dark'?'#0b0e14':preset.accent;
  document.querySelectorAll('#accentSwatchRow .accent-swatch').forEach(el=>{
    el.classList.toggle('active', el.dataset.accent===key);
  });
}

function buildAccentSwatches(){
  const row=document.getElementById('accentSwatchRow');
  if(!row || row.dataset.built) return;
  row.dataset.built='1';
  row.innerHTML=Object.entries(ACCENT_PRESETS).map(([key,val])=>
    `<button class="accent-swatch" data-accent="${key}" style="background:${val.accent}" title="${key}"></button>`
  ).join('');
  row.onclick=e=>{
    const sw=e.target.closest('[data-accent]'); if(!sw) return;
    appSettings.accent=sw.dataset.accent;
    saveSettings();
    applyAccent(sw.dataset.accent);
    toast('Accent color updated');
  };
}
