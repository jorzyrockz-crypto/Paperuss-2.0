/* ============================================================
   STANDALONE TASKS + REMINDERS + NOTIFICATIONS
   ============================================================ */
const TASKS_KEY='octonotes:tasks';
let standaloneTasks=[];

function loadTasks(){
  try{
    const parsed=JSON.parse(localStorage.getItem(TASKS_KEY))||[];
    standaloneTasks=typeof sanitizeTaskCollection==='function'?sanitizeTaskCollection(parsed):parsed;
  }catch(e){ standaloneTasks=[]; }
}
function saveTasks(){
  if(typeof sanitizeTaskCollection==='function') standaloneTasks=sanitizeTaskCollection(standaloneTasks);
  localStorage.setItem(TASKS_KEY, JSON.stringify(standaloneTasks));
  if(typeof queueCloudSync==='function') queueCloudSync();
}

async function openTaskCreatorModal(options){
  options = options || {};
  const intent = options.intent || 'manage';
  const root=document.getElementById('modalRoot');
  let activeTab = 'select'; // 'select' or 'create'
  let selectedTaskIds = new Set();
  let loadedTasks = [];
  let isLoading = true;
  let errorState = null;

  let isCreatingTasks = false;

  async function performLoad() {
    isLoading = true;
    errorState = null;
    renderModalContent();
    try {
      if(typeof loadTasks === 'function') await Promise.resolve(loadTasks());
      
      loadedTasks = standaloneTasks.filter(t => !t.deletedAt && !t.deleted);
    } catch(e) {
      errorState = e.message || 'Failed to load tasks';
    }
    isLoading = false;
    renderModalContent();
  }

  function renderModalContent() {
    const hasStandalone = loadedTasks.length > 0;
    if(!isLoading && !hasStandalone && activeTab === 'select') activeTab = 'create';

    root.innerHTML=`<div class="modal-overlay"><div class="modal" style="max-width:500px">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px">
        <h3 style="margin:0">✅ Tasks & Checklists</h3>
      </div>

      <div class="modal-tabs">
        <button type="button" class="modal-tab-btn ${activeTab==='select'?'active':''}" id="tabSelectTask" ${isLoading?'disabled':''}>
          <i data-lucide="check-square" class="w-4 h-4"></i> Select Existing (${isLoading ? '…' : loadedTasks.length})
        </button>
        <button type="button" class="modal-tab-btn ${activeTab==='create'?'active':''}" id="tabCreateTask" ${isLoading?'disabled':''}>
          <i data-lucide="plus-circle" class="w-4 h-4"></i> Create New
        </button>
      </div>

      ${activeTab === 'select' ? `
        <input id="tmSearchInput" class="modal-search-input" placeholder="Search tasks from Task Page…" value="" ${isLoading?'disabled':''}>
        <div class="modal-item-list" id="tmTaskList" role="listbox" aria-multiselectable="true">
          ${renderTaskListRows('')}
        </div>
        <div class="modal-actions">
          <button class="btn" id="tmCancel">Cancel</button>
          <button class="btn btn-primary" id="tmInsertSelected" ${selectedTaskIds.size===0||isLoading?'disabled':''}>Insert Selected Task(s)</button>
        </div>
      ` : `
        <p style="color:var(--fg-secondary);font-size:12.5px;margin-bottom:12px">
          Add multiple tasks — one per line. They will be saved to your Task Manager.
        </p>
        <div style="display:flex;flex-direction:column;gap:10px;margin-bottom:16px">
          <textarea id="tmTasks" rows="4" placeholder="Buy groceries&#10;Email the client&#10;Review pull request" style="background:var(--subtle);border:1px solid var(--border);border-radius:10px;padding:12px;font-size:13.5px;outline:none;color:var(--fg);resize:vertical;line-height:1.6"></textarea>
          <div style="display:flex;gap:8px;flex-wrap:wrap">
            <select id="tmPriority" style="background:var(--subtle);border:1px solid var(--border);border-radius:8px;padding:8px 10px;font-size:13px;outline:none;color:var(--fg);flex:1;min-width:100px">
              <option value="low">🟢 Low</option>
              <option value="medium" selected>🟡 Medium</option>
              <option value="high">🔴 High</option>
            </select>
            <input id="tmDue" type="datetime-local" style="background:var(--subtle);border:1px solid var(--border);border-radius:8px;padding:8px 10px;font-size:13px;outline:none;color:var(--fg);flex:1;min-width:160px" title="Shared reminder for all tasks">
          </div>
        </div>
        <div class="modal-actions">
          <button class="btn" id="tmCancel">Cancel</button>
          <button class="btn btn-primary" id="tmCreate">${intent === 'insert' ? 'Create & Insert' : 'Create List'}</button>
        </div>
      `}
    </div></div>`;

    if(typeof refreshIcons === 'function') refreshIcons();

    const close=()=>root.innerHTML='';
    const cancelBtn = document.getElementById('tmCancel');
    if(cancelBtn) cancelBtn.onclick=close;
    const overlay = root.querySelector('.modal-overlay');
    if(overlay) overlay.onclick=e=>{ if(e.target===e.currentTarget) close(); };

    const btnTabSel = document.getElementById('tabSelectTask');
    const btnTabCre = document.getElementById('tabCreateTask');
    if(btnTabSel) btnTabSel.onclick = () => { activeTab = 'select'; renderModalContent(); };
    if(btnTabCre) btnTabCre.onclick = () => { activeTab = 'create'; renderModalContent(); };

    if(activeTab === 'select') {
      const searchInput = document.getElementById('tmSearchInput');
      if(searchInput) {
        searchInput.oninput = (e) => {
          const listEl = document.getElementById('tmTaskList');
          if(listEl) listEl.innerHTML = renderTaskListRows(e.target.value);
        };
      }
      
      const listEl = document.getElementById('tmTaskList');
      if(listEl) {
        listEl.onclick = (e) => {
          const row = e.target.closest('[data-item-id]');
          if(!row) return;
          const id = String(row.getAttribute('data-item-id'));
          if(selectedTaskIds.has(id)) selectedTaskIds.delete(id);
          else selectedTaskIds.add(id);
          
          listEl.querySelectorAll('[data-item-id]').forEach(r => {
            const isSel = selectedTaskIds.has(String(r.getAttribute('data-item-id')));
            r.classList.toggle('selected', isSel);
            r.setAttribute('aria-selected', isSel);
            const cb = r.querySelector('input[type="checkbox"]');
            if(cb) cb.checked = isSel;
          });
          const btn = document.getElementById('tmInsertSelected');
          if(btn) btn.disabled = selectedTaskIds.size === 0;
        };
        
        listEl.onkeydown = (e) => {
          if(e.key === 'Enter' || e.key === ' ') {
            const row = e.target.closest('[data-item-id]');
            if(row) {
              e.preventDefault();
              row.click();
            }
          }
        };
      }

      const btnInsertSel = document.getElementById('tmInsertSelected');
      if(btnInsertSel) {
        btnInsertSel.onclick = () => {
          if(selectedTaskIds.size === 0) { toast('Select at least one task'); return; }
          const selectedItems = loadedTasks.filter(t => selectedTaskIds.has(t.id));
          if(selectedItems.length === 0) { toast('Selected tasks no longer exist in canonical store'); return; }
          
          const checklistHtml = selectedItems.map(t => `<li data-task="1"><input type="checkbox" ${t.completed?'checked':''}> ${esc(t.text)}</li>`).join('');
          
          const ed = document.getElementById('noteBody');
          if(ed) {
            ed.focus();
            document.execCommand('insertHTML', false, `<ul>${checklistHtml}</ul><p><br></p>`);
            if(typeof handleBodyInput === 'function') handleBodyInput();
          }
          toast(`Inserted ${selectedItems.length} task(s) into note`);
          close();
        };
      }
    } else {
            const btnCreate = document.getElementById('tmCreate');
      if(btnCreate) {
        btnCreate.onclick = async () => {
          if(isCreatingTasks) return;
          
          const raw=document.getElementById('tmTasks').value;
          const lines=raw.split(/\r?\n/).map(s=>s.trim()).filter(Boolean);
          if(!lines.length){ toast('Enter at least one task'); return; }
          
          isCreatingTasks = true;
          btnCreate.disabled = true;
          
          const prio=document.getElementById('tmPriority').value;
          const dueVal=document.getElementById('tmDue').value;
          const due=dueVal?new Date(dueVal).getTime():null;
          const groupId='g_'+Date.now().toString(36);
          
          const newIds = [];
          const createdTasks = [];
          lines.forEach(txt=>{
            const nid = 't_'+Date.now().toString(36)+Math.random().toString(36).slice(2,6);
            newIds.push(nid);
            createdTasks.push({
              id:nid,
              text:txt, completed:false,
              priority:prio, due, notified:false,
              groupId,
              createdAt:Date.now(), updatedAt:Date.now()
            });
          });
          
          standaloneTasks.unshift(...createdTasks);
          
          try {
            await Promise.resolve(saveTasks());
          } catch(e) {
            standaloneTasks.splice(0, createdTasks.length); // rollback
            isCreatingTasks = false;
            btnCreate.disabled = false;
            toast('Task could not be saved.');
            return;
          }
          
          renderTasksView(); updateTasksCount(); renderAll();
          
          loadedTasks = standaloneTasks.filter(t => !t.deletedAt && !t.deleted);
          
          const validIds = newIds.filter(id => loadedTasks.some(t => String(t.id) === String(id)));
          if(validIds.length !== newIds.length) {
            isCreatingTasks = false;
            btnCreate.disabled = false;
            toast('Save or load error: newly created tasks not found.');
            return;
          }
          
          addNotification({type:'task',title:`${lines.length} tasks created`,body:lines.slice(0,3).join(', ')+(lines.length>3?'…':''),icon:'check-square',activity:true});
          if (intent === 'insert') {
            const selectedItems = loadedTasks.filter(t => validIds.includes(String(t.id)));
            const checklistHtml = selectedItems.map(t => `<li data-task="1"><input type="checkbox" ${t.completed?'checked':''}> ${esc(t.text)}</li>`).join('');
            
            const ed = document.getElementById('noteBody');
            if(ed) {
              ed.focus();
              document.execCommand('insertHTML', false, `<ul>${checklistHtml}</ul><p><br></p>`);
              if(typeof handleBodyInput === 'function') handleBodyInput();
            }
            toast(`Inserted ${selectedItems.length} task(s) into note`);
          }
          isCreatingTasks = false;
          close();
        };
      }
      setTimeout(()=>document.getElementById('tmTasks')?.focus(), 50);
    }
  }

  function renderTaskListRows(query) {
    if(isLoading) return `<div style="padding:16px;text-align:center;color:var(--fg-muted);font-size:13px"><i class="w-4 h-4 spinner" style="border:2px solid;border-right-color:transparent;border-radius:50%;width:14px;height:14px;animation:spin 1s linear infinite;display:inline-block;vertical-align:middle;margin-right:6px"></i>Loading...</div>`;
    if(errorState) return `<div style="padding:16px;text-align:center;color:var(--danger);font-size:13px">${esc(errorState)}</div>`;

    const q = query.toLowerCase().trim();
    const filtered = loadedTasks.filter(t => !q || t.text.toLowerCase().includes(q));
    if(!filtered.length) return `<div class="list-empty" style="padding:16px;text-align:center;color:var(--fg-muted);font-size:13px">No tasks found.</div>`;

    return filtered.map(t => {
      const isSel = selectedTaskIds.has(t.id);
      const prioColor = t.priority==='high'?'🔴':t.priority==='medium'?'🟡':'🟢';
      return `<div class="modal-item-row ${isSel?'selected':''}" data-item-id="${t.id}" tabindex="0" role="option" aria-selected="${isSel}">
        <input type="checkbox" ${isSel?'checked':''} tabindex="-1">
        <span style="font-size:12px">${prioColor}</span>
        <div style="flex:1;font-size:13px;color:var(--fg);${t.completed?'text-decoration:line-through;opacity:0.6':''}">${esc(t.text)}</div>
        ${t.due?`<span style="font-size:11px;color:var(--fg-muted)">${new Date(t.due).toLocaleDateString(undefined,{month:'short',day:'numeric'})}</span>`:''}
      </div>`;
    }).join('');
  }

  performLoad();
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

async function requestNotifPermission(){
  if(!notifSupported()){ toast('System notifications are not supported in this browser',null,'Undo',{force:true}); return 'unsupported'; }
  try{
    const permission=await Notification.requestPermission();
    updateNotifBar();
    if(permission==='granted'){
      toast('Browser reminders enabled',null,'Undo',{force:true});
      fireNotification('PapeRuss reminders on','You will be notified while PapeRuss is allowed to run.');
      addNotification({type:'system',title:'Reminders enabled',body:'Browser notification permission was granted.',icon:'bell'});
    }else if(permission==='denied'){
      toast('Notifications are blocked in browser settings',null,'Undo',{force:true});
    }
    return permission;
  }catch(error){
    toast('Could not request notification permission',null,'Undo',{force:true});
    return 'error';
  }
}

function fireNotification(title,body){
  if(!notifSupported()) return {ok:false,status:'unsupported'};
  if(Notification.permission!=='granted') return {ok:false,status:Notification.permission||'unavailable'};
  try{
    const notification=new Notification(String(title||'PapeRuss'),{body:String(body||''),icon:'assets/icons/paperuss-192.png',badge:'assets/icons/paperuss-192.png'});
    return {ok:true,status:'shown',notification};
  }catch(error){
    console.warn('Notification display failed',error);
    return {ok:false,status:'error',error};
  }
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
      if(appSettings.notifBanner!==false){
        document.querySelectorAll('.task-due-toast').forEach(el=>el.remove());
        const msg=dueTasks.length===1
          ? '⏰ Task due: '+dueTasks[0].text
          : `⏰ ${dueTasks.length} tasks due!`;
        const toastEl=document.createElement('div');
        toastEl.className='toast task-due-toast';
        const message=document.createElement('span');
        message.style.cssText='font-size:14px;font-weight:600;flex:1';
        message.textContent=msg;
        const viewButton=document.createElement('button');
        viewButton.className='toast-action';
        viewButton.type='button';
        viewButton.style.cssText='font-size:13px;font-weight:700;color:#fff';
        viewButton.textContent='View';
        toastEl.append(message,viewButton);
        toastEl.style.cssText='position:fixed;top:70px;left:50%;transform:translateX(-50%);z-index:999;min-width:260px;max-width:calc(100vw - 32px);background:var(--danger);color:#fff;border:none;box-shadow:0 12px 40px rgba(239,68,68,.45);opacity:1;transition:opacity .3s ease';
        document.body.appendChild(toastEl);
        viewButton.onclick=()=>{
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
  notifBanner:true, notifSound:true, notifEvents:true, notifActivity:true, notifToasts:true,
  previewV2:false, previewDensity:'comfortable'
};

function normalizeAppSettings(value){
  const input=value&&typeof value==='object'?value:{};
  const intervals=new Set([15000,30000,60000,300000]);
  const accents=new Set(['blue','purple','green','rose','amber','teal','pink','slate']);
  return {
    defaultFont:['sans','serif','mono','rounded'].includes(input.defaultFont)?input.defaultFont:'sans',
    editorWidth:'auto',
    reminderInterval:intervals.has(+input.reminderInterval)?+input.reminderInterval:30000,
    accent:accents.has(input.accent)?input.accent:'blue',
    notifBanner:input.notifBanner!==false,
    notifSound:input.notifSound!==false,
    notifEvents:input.notifEvents!==false,
    notifActivity:input.notifActivity!==false,
    notifToasts:input.notifToasts!==false,
    previewV2:input.previewV2===true,
    previewDensity:input.previewDensity==='compact'?'compact':'comfortable'
  };
}

function loadSettings(){
  try{
    const saved=JSON.parse(localStorage.getItem(SETTINGS_KEY));
    appSettings=normalizeAppSettings({...appSettings,...(saved&&typeof saved==='object'?saved:{})});
  }catch(e){ appSettings=normalizeAppSettings(appSettings); }
  applySettingsEffects();
}
function saveSettings(){
  appSettings=normalizeAppSettings(appSettings);
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

  // Note Preview V2
  const prevV2Check=document.getElementById('setPreviewV2');
  if(prevV2Check) prevV2Check.checked=appSettings.previewV2===true;
  const prevDensitySel=document.getElementById('setPreviewDensity');
  if(prevDensitySel) prevDensitySel.value=appSettings.previewDensity||'comfortable';
  const densityRow=document.getElementById('previewDensityRow');
  if(densityRow) densityRow.style.display=appSettings.previewV2?'flex':'none';

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
  if(permBtn) permBtn.onclick=async()=>{ await requestNotifPermission(); renderSettingsView(); };

  // Note Preview V2 toggles
  const prevV2Check=document.getElementById('setPreviewV2');
  if(prevV2Check) prevV2Check.onchange=e=>{
    appSettings.previewV2=e.target.checked;
    saveSettings();
    const densityRow=document.getElementById('previewDensityRow');
    if(densityRow) densityRow.style.display=e.target.checked?'flex':'none';
    if(typeof renderList==='function') renderList();
  };
  
  const prevDensitySel=document.getElementById('setPreviewDensity');
  if(prevDensitySel) prevDensitySel.onchange=e=>{
    appSettings.previewDensity=e.target.value;
    saveSettings();
    if(typeof renderList==='function') renderList();
  };

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
      if(key==='notifEvents' && typeof rescheduleAllEventNotifications==='function') rescheduleAllEventNotifications();
      toast(`${label} ${e.target.checked?'enabled':'disabled'}`,null,'Undo',{force:key==='notifToasts'});
    };
  });

  const testBtn=document.getElementById('setNotifTest');
  if(testBtn) testBtn.onclick=async()=>{
    if(appSettings.notifSound!==false) playTaskCompleteSound();
    if(notifSupported() && Notification.permission==='default') await requestNotifPermission();
    const result=fireNotification('🔔 PapeRuss test','System notifications are available while the app is allowed to run.');
    addNotification({type:'system',title:'🔔 Test notification',body:'The in-app notification center is working.',icon:'bell-ring'});
    const message=result.ok
      ? 'System and in-app test notifications sent'
      : result.status==='denied'
        ? 'In-app test added; browser notifications are blocked'
        : result.status==='unsupported'
          ? 'In-app test added; system notifications are unsupported'
          : 'In-app test added; grant browser permission for system alerts';
    toast(message,null,'Undo',{force:true});
    renderSettingsView();
  };

  const expBtn=document.getElementById('setExportBtn');
  if(expBtn) expBtn.onclick=exportNotes;
  const expDocxActiveBtn=document.getElementById('setExportDocxActiveBtn');
  if(expDocxActiveBtn) expDocxActiveBtn.onclick=()=>typeof window.exportDocx==='function' && window.exportDocx('active');
  const expDocxAllBtn=document.getElementById('setExportDocxAllBtn');
  if(expDocxAllBtn) expDocxAllBtn.onclick=()=>typeof window.exportDocx==='function' && window.exportDocx('all');
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

  const runStorageSenseBtn=document.getElementById('runStorageSenseBtn');
  if(runStorageSenseBtn) {
    runStorageSenseBtn.onclick = async () => {
      runStorageSenseBtn.disabled = true;
      runStorageSenseBtn.innerHTML = '<i class="w-4 h-4 spinner" style="border:2px solid;border-right-color:transparent;border-radius:50%;width:14px;height:14px;animation:spin 1s linear infinite"></i> Cleaning...';
      try {
        if(typeof runStorageSense === 'function') await runStorageSense();
      } finally {
        runStorageSenseBtn.disabled = false;
        runStorageSenseBtn.innerHTML = '<i data-lucide="zap" class="w-4 h-4"></i> Run Cleanup';
        if(typeof lucide !== 'undefined') lucide.createIcons();
      }
    };
  }

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
      if(typeof fbAuth!=='undefined' && fbAuth){
        try{ await fbAuth.signOut(); }catch(_){}
      }
      if(typeof saveSession==='function') saveSession(null);
      localStorage.removeItem(STORAGE_KEY);
      localStorage.removeItem(TASKS_KEY);
      localStorage.removeItem(NOTIF_KEY);
      localStorage.removeItem(SETTINGS_KEY);
      localStorage.removeItem(THEME_KEY);
      localStorage.removeItem('octonotes:session');
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
      try{
        await new Promise(resolve=>{
          const req=indexedDB.deleteDatabase('firebaseLocalStorageDb');
          req.onsuccess=req.onerror=req.onblocked=()=>resolve();
        });
      }catch(e){}
      location.reload();
    });
  };
}

async function clearLocalAppCacheAndData(){
  try{
    // 1. Sign out of Firebase Auth so the app brings the user back to the sign-in / welcome page
    if(typeof fbAuth !== 'undefined' && fbAuth){
      try { await fbAuth.signOut(); } catch(_){}
    }
    if(typeof saveSession === 'function') saveSession(null);

    // 2. Clear IndexedDB (both app media and firebase token storage)
    if(mediaDB){ mediaDB.close(); mediaDB=null; }
    await Promise.all([
      new Promise(resolve=>{
        const request=indexedDB.deleteDatabase(MEDIA_DB);
        request.onsuccess=request.onerror=request.onblocked=()=>resolve();
      }),
      new Promise(resolve=>{
        const request=indexedDB.deleteDatabase('firebaseLocalStorageDb');
        request.onsuccess=request.onerror=request.onblocked=()=>resolve();
      })
    ]);

    // 3. Clear localStorage keys
    Object.keys(localStorage)
      .filter(key=>key.startsWith('octonotes:')||key.startsWith('paperuss:'))
      .forEach(key=>localStorage.removeItem(key));

    // 4. Clear service worker caches & unregister
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
