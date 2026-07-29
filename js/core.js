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

async function saveMediaBlob(blob, name, kind){
  const id=mediaUid();
  await mediaPut({id, kind, name:name||'file', type:blob.type||'', size:blob.size||0, blob, createdAt:Date.now()});
  if(typeof queueCloudSync==='function') queueCloudSync();
  return id;
}
async function getMediaURL(id){
  if(urlCache.has(id)) return urlCache.get(id);
  const rec=await mediaGet(id);
  if(!rec) return null;
  const url=URL.createObjectURL(rec.blob);
  urlCache.set(id,url);
  return url;
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
function blobToDataURL(blob){
  return new Promise((res,rej)=>{
    const r=new FileReader();
    r.onload=()=>res(r.result); r.onerror=()=>rej(r.error);
    r.readAsDataURL(blob);
  });
}
function dataURLToBlob(dataURL){
  const [meta,b64]=dataURL.split(',');
  const type=(meta.match(/data:([^;]+)/)||[])[1]||'application/octet-stream';
  const bin=atob(b64); const arr=new Uint8Array(bin.length);
  for(let i=0;i<bin.length;i++) arr[i]=bin.charCodeAt(i);
  return new Blob([arr],{type});
}

/* Collect all media IDs referenced by the current notes */
function referencedMediaIds(){
  const set=new Set();
  notes.forEach(n=>{
    if(!n.content) return;
    const matches=n.content.match(/data-media-id="([^"]+)"/g)||[];
    matches.forEach(m=>set.add(m.match(/"([^"]+)"/)[1]));
  });
  return set;
}
async function gcOrphanMedia(){
  try{
    const all=await mediaAll();
    const used=referencedMediaIds();
    for(const rec of all){ if(!used.has(rec.id)) await mediaDel(rec.id); }
    renderStorageStats();
  }catch(e){}
}
async function renderStorageStats(){
  const jsonBytes=new Blob([JSON.stringify(notes)]).size;
  let mediaBytes=0;
  try{ (await mediaAll()).forEach(r=>mediaBytes+=(r.size||0)); }catch(e){}
  const total=jsonBytes+mediaBytes;
  const kb=(total/1024).toFixed(total<1024*1024?1:0);
  const label = total>=1024*1024 ? (total/1024/1024).toFixed(2)+' MB' : kb+' KB';
  const el=document.getElementById('storageText');
  const cloudEnabled=typeof currentSession==='object' && currentSession?.mode==='auth';
  if(el) el.textContent=`${notes.length} note${notes.length!==1?'s':''} · ${label} · ${cloudEnabled?'cloud sync on':'local only'}`;
  const fill=document.getElementById('storageFill');
  if(fill) fill.style.width=Math.min(100,(total/(50*1024*1024))*100)+'%';
}

/* Hydrate media placeholders in the loaded editor with real blob URLs */
async function hydrateMediaInEditor(){
  const ed=document.getElementById('noteBody');
  if(!ed) return;
  const nodes=ed.querySelectorAll('[data-media-id]');
  for(const el of nodes){
    const id=el.getAttribute('data-media-id');
    const kind=el.getAttribute('data-media-kind');
    if(kind==='link') continue; // rich links don't need blob URLs
    const url=await getMediaURL(id);
    if(!url){ el.setAttribute('data-missing','1'); continue; }
    if(el.tagName==='IMG' || el.tagName==='AUDIO' || el.tagName==='VIDEO'){
      el.src=url;
    } else if(el.classList.contains('media-card')){
      // Attach a click handler for download button (delegated below too, but this ensures URL is warm)
      el.dataset.blobUrl=url;
    }
  }
}

let notes = [];
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
    notes = JSON.parse(localStorage.getItem(STORAGE_KEY)) || [];
  }catch(e){ notes = []; }

  // Migrate from v1 markdown notes if present
  if(!notes.length){
    try{
      const old = JSON.parse(localStorage.getItem('octonotes:v1')) || [];
      if(old.length){
        notes = old.map(n=>({
          ...n,
          content: looksLikeHtml(n.content) ? n.content : mdToHtml(n.content||'')
        }));
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
  d.innerHTML=html||'';
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
  document.getElementById('countAll').textContent = notes.length;
  document.getElementById('countPinned').textContent = notes.filter(n=>n.pinned).length;
  document.getElementById('countArchived').textContent = notes.filter(n=>n.archived).length;
  const calendarCount = notes.filter(n=>(n.tags||[]).includes('calendar')||(n.tags||[]).some(t=>t==='meeting'||t==='deadline')).length;
  const calEl=document.getElementById('countCalendar');
  if(calEl) calEl.textContent = calendarCount;
  const tagMap={};
  notes.forEach(n=>(n.tags||[]).forEach(t=>tagMap[t]=(tagMap[t]||0)+1));
  const tl=document.getElementById('tagList');
  const tags=Object.keys(tagMap).sort();
  if(!tags.length){ tl.innerHTML='<div style="padding:4px 8px;font-size:12px;color:var(--fg-muted)">No tags yet</div>'; }
  else tl.innerHTML=tags.map(t=>`<button class="tag-btn ${state.tag===t?'active':''}" data-tag="${esc(t)}"><span class="tag-dot"></span><span>${esc(t)}</span><span class="count" style="margin-left:auto">${tagMap[t]}</span></button>`).join('');
  renderStorageStats();
  updateMediaCount();
  updateTasksCount();
  document.querySelectorAll('.nav-btn').forEach(b=>b.classList.toggle('active', b.dataset.filter===state.filter && !state.tag));
  refreshIcons();
}

function updateTasksCount(){
  let count=0;
  notes.forEach(n=>{
    if(!n.content) return;
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

async function updateMediaCount(){
  try{
    const all=await mediaAll();
    const count=all.length;
    const countEl=document.getElementById('countMedia');
    if(countEl) countEl.textContent=count;
    const statPill=document.getElementById('mhStatPill');
    if(statPill){
      const bytes=all.reduce((s,r)=>s+(r.size||0), 0);
      statPill.textContent=`${count} asset${count!==1?'s':''} · ${formatBytes(bytes)}`;
    }
  }catch(e){}
}

function filteredNotes(){
  let arr=notes.filter(n=>{
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
  let titleText=state.tag?('#'+state.tag) : ({all:'All Notes',pinned:'Pinned',archived:'Archived',calendar:'Events / Planner',tasks:'Tasks & Todos',settings:'Settings'}[state.filter]);
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
    c.innerHTML=`<div class="list-empty">No notes match.<br>Try a different filter or create a new note.</div>`;
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
        ${n.archived?'<span class="archived">Archived</span>':''}
        <span>${timeAgo(n.updatedAt)}</span>
        ${mediaCount?`<span class="media-badge" title="${mediaCount} attachment${mediaCount!==1?'s':''}">
          <i data-lucide="paperclip" class="w-3 h-3"></i>${mediaCount}</span>`:''}
        ${(n.tags||[]).slice(0,2).map(t=>'<span class="chip">'+esc(t)+'</span>').join('')}
      </div>
    </div>`;
  }).join('');
  refreshIcons();
}

async function renderMediaList(){
  const c=document.getElementById('notesContainer');
  document.getElementById('listTitle').textContent = 'Media Assets';
  try{
    let all=await mediaAll();
    if(state.mediaTypeFilter && state.mediaTypeFilter!=='all'){
      all=all.filter(r=>r.kind===state.mediaTypeFilter);
    }
    if(state.query){
      const q=state.query.toLowerCase();
      all=all.filter(r=>r.name.toLowerCase().includes(q) || r.kind.toLowerCase().includes(q));
    }
    all.sort((a,b)=>b.createdAt - a.createdAt);
    if(!all.length){
      c.innerHTML=`<div class="list-empty">No media assets found.<br>Attach images, voice, or files in your notes.</div>`;
      refreshIcons();
      return;
    }
    c.innerHTML=all.map(r=>{
      const active=r.id===state.currentMediaId?'active':'';
      let iconName='file';
      if(r.kind==='image') iconName='image';
      else if(r.kind==='audio') iconName='mic';
      else if(r.kind==='video') iconName='video';
      return `<div class="note-card ${active}" data-media-card-id="${r.id}">
        <div class="note-title" style="align-items:center">
          <i data-lucide="${iconName}" class="w-4 h-4 text-accent"></i>
          <span>${esc(r.name)}</span>
        </div>
        <div class="note-preview">${esc(r.type||'file')}</div>
        <div class="note-meta">
          <span>${formatBytes(r.size)}</span>
          <span>${timeAgo(r.createdAt)}</span>
        </div>
      </div>`;
    }).join('');
  }catch(e){
    c.innerHTML=`<div class="list-empty">Failed to load media assets.</div>`;
  }
  refreshIcons();
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
  const isNoteEditable = !isSpecialPage && activeNote;

  if(shareBtn) shareBtn.style.display = isNoteEditable ? 'inline-flex' : 'none';
  if(printBtn) printBtn.style.display = isNoteEditable ? 'inline-flex' : 'none';

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
  if(!n){ empty.style.display='flex'; content.classList.remove('show'); revokeCachedURLs(); return; }
  empty.style.display='none'; content.classList.add('show');
  document.getElementById('noteTitle').value=n.title||'';
  state.suppressInput=true;
  revokeCachedURLs();
  const ed=bodyEl();
  const fontStyle = n.fontStyle || 'sans';
  ed.setAttribute('data-fontstyle', fontStyle);
  const fsLabel = document.getElementById('fontStyleLabel');
  const fsMap = {'sans':'Sans', 'serif':'Serif', 'mono':'Mono', 'rounded':'Rounded'};
  if(fsLabel) fsLabel.textContent = fsMap[fontStyle] || 'Sans';
  document.querySelectorAll('#fontStyleDropdown .fs-opt').forEach(opt=>{
    opt.classList.toggle('active', opt.dataset.fontstyle === fontStyle);
  });
  ed.innerHTML = n.content || '';
  state.suppressInput=false;
  hydrateMediaInEditor();
  if(typeof renderNotebookCover==='function') renderNotebookCover();
  if(typeof normalizeEditorImages==='function') normalizeEditorImages();
  if(typeof clearImageSelection==='function') clearImageSelection();
  renderTags(n);
  renderStats(n);
  document.getElementById('pinBtn').style.color = n.pinned?'var(--attention)':'';
  document.getElementById('archiveBtn').style.color = n.archived?'var(--attention)':'';
  document.getElementById('saveStatus').className='save-status';
  document.getElementById('saveStatus').innerHTML='<span class="dot"></span><span>Saved '+timeAgo(n.updatedAt)+'</span>';
  updateToolbarState();
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
    let all=await mediaAll();
    if(state.mediaTypeFilter && state.mediaTypeFilter!=='all'){
      all=all.filter(r=>r.kind===state.mediaTypeFilter);
    }
    if(state.query){
      const q=state.query.toLowerCase();
      all=all.filter(r=>r.name.toLowerCase().includes(q) || r.kind.toLowerCase().includes(q));
    }
    all.sort((a,b)=>b.createdAt - a.createdAt);

    if(state.currentMediaId){
      if(bodyEl) bodyEl.style.display='none';
      if(detailEl){
        detailEl.style.display='flex';
        detailEl.classList.add('show');
        const rec=await mediaGet(state.currentMediaId);
        if(!rec){
          state.currentMediaId=null;
          renderMediaHubView();
          return;
        }
        const url=await getMediaURL(rec.id);
        const refNote=notes.find(n=>n.content && n.content.includes(rec.id));
        let previewHtml='';
        if(rec.kind==='image'){
          previewHtml=`<div class="mh-detail-preview"><img src="${url}" alt="${esc(rec.name)}" onclick="openImageLightbox('${url}')" style="cursor:zoom-in"></div>`;
        } else if(rec.kind==='video'){
          previewHtml=`<div class="mh-detail-preview"><video controls src="${url}"></video></div>`;
        } else if(rec.kind==='audio'){
          previewHtml=`<div class="mh-detail-preview" style="padding:24px"><audio controls src="${url}"></audio></div>`;
        } else {
          previewHtml=`<div class="mh-detail-preview" style="padding:40px"><i data-lucide="file-text" class="w-16 h-16 text-accent"></i></div>`;
        }
        detailEl.innerHTML=`
          <div class="mh-detail-top">
            <button class="btn" onclick="closeMediaDetail()"><i data-lucide="arrow-left" class="w-4 h-4"></i> Back to Gallery</button>
            <div style="display:flex;gap:8px">
              <button class="btn" onclick="downloadMediaById('${rec.id}','${esc(rec.name)}')"><i data-lucide="download" class="w-4 h-4"></i> Download</button>
              <button class="btn btn-danger" onclick="confirmDeleteMediaAsset('${rec.id}','${esc(rec.name)}')"><i data-lucide="trash-2" class="w-4 h-4"></i> Delete</button>
            </div>
          </div>
          ${previewHtml}
          <div class="mh-detail-meta-box">
            <div class="mh-detail-row">
              <span class="text-fg-muted font-medium">Filename</span>
              <span class="font-semibold">${esc(rec.name)}</span>
            </div>
            <div class="mh-detail-row">
              <span class="text-fg-muted font-medium">Type / MIME</span>
              <span>${esc(rec.type||rec.kind)}</span>
            </div>
            <div class="mh-detail-row">
              <span class="text-fg-muted font-medium">File Size</span>
              <span>${formatBytes(rec.size)}</span>
            </div>
            <div class="mh-detail-row">
              <span class="text-fg-muted font-medium">Created</span>
              <span>${new Date(rec.createdAt).toLocaleString()}</span>
            </div>
            ${refNote ? `
              <div class="mh-detail-row" style="align-items:center">
                <span class="text-fg-muted font-medium">Attached in Note</span>
                <button class="mh-note-link" onclick="jumpToNote('${refNote.id}')">
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
      }
    } else {
      if(bodyEl) bodyEl.style.display='flex';
      if(detailEl){ detailEl.style.display='none'; detailEl.classList.remove('show'); }
      if(!all.length){
        gridEl.innerHTML=`<div class="list-empty" style="grid-column:1/-1">No media in this view.<br>Upload or drop attachments into your notes!</div>`;
      } else {
        const cardsHtml=await Promise.all(all.map(async r=>{
          const url=await getMediaURL(r.id);
          const refNote=notes.find(n=>n.content && n.content.includes(r.id));
          let thumbContent=`<i data-lucide="file" class="mh-thumb-icon"></i>`;
          if(r.kind==='image'){
            thumbContent=`<img src="${url}" alt="${esc(r.name)}" loading="lazy">`;
          } else if(r.kind==='video'){
            thumbContent=`<i data-lucide="video" class="mh-thumb-icon"></i>`;
          } else if(r.kind==='audio'){
            thumbContent=`<i data-lucide="mic" class="mh-thumb-icon"></i>`;
          }
          return `<div class="mh-card" data-mh-select="${r.id}">
            <div class="mh-thumb">${thumbContent}</div>
            <div class="mh-info">
              <div class="mh-title">${esc(r.name)}</div>
              <div class="mh-meta">
                <span>${formatBytes(r.size)}</span>
                <span>${timeAgo(r.createdAt)}</span>
              </div>
              ${refNote ? `
                <div class="mh-note-link" onclick="event.stopPropagation(); jumpToNote('${refNote.id}')" title="Jump to Note">
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
        tmp.querySelectorAll(`[data-media-id="${id}"],[data-media-card-id="${id}"]`).forEach(el=>el.remove());
        n.content=tmp.innerHTML;
        n.updatedAt=Date.now();
      }
    });
    save();
    renderAll();
    toast('Media asset deleted');
    addNotification({type:'media',title:'Media asset deleted',body:`"${esc(name)}" was removed from local storage.`,icon:'trash-2'});
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

function renderAll(){ renderSidebar(); renderList(); renderEditor(); }
