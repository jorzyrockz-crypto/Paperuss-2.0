/* ============================================================
   DIVIDERS & TABLES
   ============================================================ */
function insertDivider(){
  insertHTMLAtCaret('<hr>');
  toast('Divider inserted');
}

function insertTable(rows, cols){
  let html='<div class="table-wrapper" data-table-wrapper="1" contenteditable="false"><table contenteditable="true"><thead><tr>';
  for(let c=0;c<cols;c++) html+=`<th>Header ${c+1}</th>`;
  html+='</tr></thead><tbody>';
  for(let r=0;r<rows-1;r++){
    html+='<tr>';
    for(let c=0;c<cols;c++) html+='<td>&nbsp;</td>';
    html+='</tr>';
  }
  html+='</tbody></table></div><p><br></p>';
  insertHTMLAtCaret(html);
  toast(`${rows}×${cols} table inserted`);
}

function buildTablePicker(){
  const grid=document.getElementById('tgpGrid');
  const label=document.getElementById('tgpLabel');
  const picker=document.getElementById('tableGridPicker');
  if(!grid || grid.dataset.built) return;
  grid.dataset.built='1';
  const MAXR=6, MAXC=6;
  let html='';
  for(let r=1;r<=MAXR;r++)
    for(let c=1;c<=MAXC;c++)
      html+=`<div class="tgp-cell" data-r="${r}" data-c="${c}"></div>`;
  grid.innerHTML=html;

  grid.addEventListener('mouseover', e=>{
    const cell=e.target.closest('.tgp-cell'); if(!cell) return;
    const R=+cell.dataset.r, C=+cell.dataset.c;
    grid.querySelectorAll('.tgp-cell').forEach(el=>{
      el.classList.toggle('hl', +el.dataset.r<=R && +el.dataset.c<=C);
    });
    if(label) label.textContent=`${R} × ${C} table`;
  });
  grid.addEventListener('click', e=>{
    const cell=e.target.closest('.tgp-cell'); if(!cell) return;
    picker.classList.remove('show');
    insertTable(+cell.dataset.r, +cell.dataset.c);
  });
}

/* ============================================================
   UNIVERSAL NOTE LIST TOGGLE & SIDEBAR COLLAPSE
   ============================================================ */
function toggleSidebarRail(){
  const sidebar=document.getElementById('sidebar');
  const icon=document.getElementById('sidebarRailIcon');
  if(!sidebar) return;
  // On desktop we collapse to a rail; on tablet we expand from the rail
  const w=window.innerWidth;
  let collapsed;
  if(w>1024){
    collapsed=sidebar.classList.toggle('rail-collapsed');
  } else {
    collapsed=!sidebar.classList.toggle('expanded');
  }
  if(icon){
    icon.setAttribute('data-lucide', collapsed?'panel-left-open':'panel-left-close');
    refreshIcons();
  }
  toast(collapsed?'Sidebar collapsed':'Sidebar expanded');
  if(typeof window.recalculateToolbarOverflow === 'function') setTimeout(window.recalculateToolbarOverflow, 150);
}

function toggleNoteListPanel(e){
  if(e && e.preventDefault) e.preventDefault();
  
  // Back button should close Leaves drawer first if open
  const leavesOverlay = document.getElementById('leavesDrawerOverlay');
  if (leavesOverlay && leavesOverlay.classList.contains('show')) {
    if (typeof window.closeLeavesDrawer === 'function') {
      window.closeLeavesDrawer();
      return;
    }
  }

  const listEl = document.getElementById('noteList');
  const iconEl = document.getElementById('backBtnIcon');
  if(!listEl) return;

  // Clear any legacy inline display style so CSS rules control layout smoothly
  if(listEl.style.display === 'none'){
    listEl.style.display = '';
  }

  const w = window.innerWidth;
  if(w <= 640){
    showMobileList();
    return;
  }

  let isCollapsed = false;
  const isDrawer = window.getComputedStyle(listEl).position === 'fixed';

  if(isDrawer){
    // Tablet portrait drawer mode: toggle 'open'
    const isOpen = listEl.classList.toggle('open');
    isCollapsed = !isOpen;
  } else {
    // Desktop / Tablet landscape mode: toggle 'collapsed'
    const collapsed = listEl.classList.toggle('collapsed');
    isCollapsed = collapsed;
    // Persist collapsed preference (desktop/landscape only)
    try {
      localStorage.setItem('octonotes:listCollapsed', collapsed ? '1' : '0');
    } catch(_) {}
  }

  // Update backBtn icon
  if(iconEl){
    iconEl.setAttribute('data-lucide', isCollapsed ? 'panel-left-open' : 'panel-left-close');
  }

  // Update button titles / tooltips and aria-expanded
  const label = isCollapsed ? 'Show note list' : 'Hide note list';
  const backBtn = document.getElementById('backBtn');
  if(backBtn){
    backBtn.title = label;
    backBtn.setAttribute('aria-expanded', isCollapsed ? 'false' : 'true');
    backBtn.setAttribute('aria-label', label);
  }
  const listToggleBtn = document.getElementById('noteListToggle');
  if(listToggleBtn){
    listToggleBtn.title = label;
    listToggleBtn.setAttribute('aria-expanded', isCollapsed ? 'false' : 'true');
    listToggleBtn.setAttribute('aria-label', label);
  }

  toast(isCollapsed ? 'Note list hidden for wider editor' : 'Note list shown');
  if(typeof refreshIcons === 'function') refreshIcons();
  if(typeof window.recalculateToolbarOverflow === 'function') setTimeout(window.recalculateToolbarOverflow, 150);
}

function toggleSidebarMobile(){
  const sidebar=document.getElementById('sidebar');
  const backdrop=document.getElementById('sidebarBackdrop');
  if(!sidebar || !backdrop) return;
  const isOpen=sidebar.classList.toggle('open');
  backdrop.classList.toggle('active', isOpen);
  if(typeof window.recalculateToolbarOverflow === 'function') setTimeout(window.recalculateToolbarOverflow, 150);
}

function closeSidebarMobile(){
  const sidebar=document.getElementById('sidebar');
  const backdrop=document.getElementById('sidebarBackdrop');
  if(sidebar) sidebar.classList.remove('open');
  if(backdrop) backdrop.classList.remove('active');
}

/* ============================================================
   ACTIONS
   ============================================================ */
function showMobileEditor(){
  document.getElementById('editor').classList.add('mobile-show');
  document.getElementById('noteList').classList.add('mobile-hide');
  document.getElementById('noteList').classList.remove('open'); // Close tablet portrait drawer on selection
}

function showMobileList(){
  const editor=document.getElementById('editor');
  const list=document.getElementById('noteList');
  // Clear desktop inline collapse state before the mobile list is shown.
  if(list){ list.style.display=''; list.classList.remove('mobile-hide'); }
  if(editor) editor.classList.remove('mobile-show');
}

function contextualNew(){
  const f=state.filter;
  if(f==='calendar'){
    const today=new Date();
    openCalendarEventCreator(today.getFullYear(), today.getMonth(), today.getDate());
  } else if(f==='tasks'){
    openTaskCreatorModal();
  } else if(f==='media'){
    document.getElementById('mediaFileInput').click();
  } else {
    if(f==='settings'||f==='trash'){
      state.filter='all'; state.tag=null;
      document.querySelectorAll('.nav-btn').forEach(b=>b.classList.toggle('active', b.dataset.filter==='all'));
    }
    createNote();
  }
}

/* ============================================================
   NOTE SHARING, PWA INSTALL & PRINT TO PDF
   ============================================================ */
let deferredInstallPrompt=null;
let pwaRegistrationPromise=null;
let pwaInstallConfigured=false;

function activeNoteForAction(){
  const note=getNote(state.currentId);
  if(!note){ toast('Select a note first'); return null; }
  return note;
}
function safeFileName(value){
  return String(value||'note').replace(/[^a-z0-9-_]+/gi,'-').replace(/^-+|-+$/g,'').slice(0,70)||'note';
}
function noteShareText(note){
  const tags=(note.tags||[]).length?`\nTags: ${(note.tags||[]).join(', ')}`:'';
  return `${titleOf(note)}\n\n${stripHtml(note.content||'')}${tags}\n\nShared from PapeRuss`;
}

async function shareCurrentNote(){
  const note=activeNoteForAction();
  if(!note) return;
  const text=noteShareText(note);
  const file=new File([text],`${safeFileName(titleOf(note))}.txt`,{type:'text/plain'});
  try{
    if(navigator.share){
      // Native sheets use a file when supported, otherwise plain rich text.
      if(navigator.canShare && navigator.canShare({files:[file]})){
        await navigator.share({title:titleOf(note),text,files:[file]});
      }else{
        await navigator.share({title:titleOf(note),text,url:location.href});
      }
      addNotification({type:'note',title:'Note shared',body:`"${titleOf(note)}" was sent from the native share sheet.`,icon:'share-2',activity:true});
      return;
    }
    await navigator.clipboard.writeText(text);
    toast('Share text copied to clipboard');
  }catch(err){
    // AbortError means the native sheet was simply dismissed.
    if(err && err.name==='AbortError') return;
    try{ await navigator.clipboard.writeText(text); toast('Share text copied to clipboard'); }
    catch(_){ toast('Sharing is unavailable in this browser'); }
  }
}

function registerPwaServiceWorker(){
  if(!('serviceWorker' in navigator) || !window.isSecureContext) return Promise.resolve(null);
  if(!pwaRegistrationPromise){
    pwaRegistrationPromise=navigator.serviceWorker
      .register('./sw.js',{scope:'./',updateViaCache:'none'})
      .catch(err=>{
        console.warn('PapeRuss service worker registration failed:',err);
        return null;
      });
  }
  return pwaRegistrationPromise;
}

function configurePwaInstall(){
  registerPwaServiceWorker();
  if(pwaInstallConfigured) return;
  pwaInstallConfigured=true;
  window.addEventListener('beforeinstallprompt',e=>{
    e.preventDefault();
    deferredInstallPrompt=e;
    const btn=document.getElementById('installBtn');
    if(btn) btn.style.display='inline-flex';
  });
  window.addEventListener('appinstalled',()=>{
    deferredInstallPrompt=null;
    const btn=document.getElementById('installBtn');
    if(btn) btn.style.display='none';
    toast('PapeRuss installed');
  });
}

async function installPwa(){
  if(deferredInstallPrompt){
    deferredInstallPrompt.prompt();
    const choice=await deferredInstallPrompt.userChoice;
    deferredInstallPrompt=null;
    if(choice.outcome==='accepted') toast('PapeRuss installation started');
    else toast('Install dismissed');
    return;
  }
  toast('Use your browser menu and choose “Install app” or “Add to Home Screen”.');
}

function ensurePrintSheet(){
  let sheet=document.getElementById('printSheet');
  if(!sheet){
    sheet=document.createElement('article');
    sheet.id='printSheet';
    document.body.appendChild(sheet);
  }
  return sheet;
}

function fallbackReferenceMark(target,text){
  // Visual reference fallback if the optional QR library has not loaded.
  let seed=0;
  for(let i=0;i<text.length;i++) seed=(seed*31+text.charCodeAt(i))>>>0;
  let cells='';
  for(let i=0;i<81;i++){
    seed=(seed*1664525+1013904223)>>>0;
    cells+=`<span style="display:block;width:6px;height:6px;background:${seed&1?'#111827':'#fff'}"></span>`;
  }
  target.innerHTML=`<div style="display:grid;grid-template-columns:repeat(9,6px);border:2px solid #111827;width:58px;height:58px">${cells}</div>`;
}

function printCurrentNote(){
  const note=activeNoteForAction();
  if(!note) return;
  const sheet=ensurePrintSheet();

  // Clean up transient editor HTML strings or duplicated headings
  let currentHtml=bodyEl().innerHTML||note.content||'';

  // Build a temporary DOM block to sanitize/remove duplicated title header at the top of content
  const temp=document.createElement('div');
  temp.innerHTML=currentHtml;

  // Find first child heading and check if it duplicates the note title
  const firstEl=temp.firstElementChild;
  if(firstEl && (firstEl.tagName==='H1' || firstEl.tagName==='H2' || firstEl.tagName==='H3')){
    const hText=firstEl.textContent.trim().toLowerCase();
    const nTitle=titleOf(note).trim().toLowerCase();
    if(hText===nTitle || nTitle.startsWith(hText) || hText.startsWith(nTitle)){
      firstEl.remove(); // Remove the duplicated top-level heading
    }
  }

  // Remove any inline block-drag indicators or empty paragraphs
  temp.querySelectorAll('.block-drop-indicator, .block-gutter').forEach(el=>el.remove());

  const cleanHtml=temp.innerHTML;
  const tags=(note.tags||[]).map(t=>`<span class="ps-tag">${esc(t)}</span>`).join('');
  const printedAt=new Date().toLocaleString();
  const reference=`paperuss://note/${note.id}?updated=${note.updatedAt}`;

  const size = note.pageSize || 'auto';
  let orient = note.pageOrientation || 'portrait';
  let margin = note.pageMargins || 'normal';
  let marginCss = '16mm 17mm 19mm'; // default auto margins
  if(note.pageViewEnabled) {
    if(margin === 'narrow') marginCss = '12mm';
    else if(margin === 'wide') marginCss = '30mm';
    else marginCss = '20mm';
  }
  
  const pageCss = note.pageViewEnabled && size !== 'auto' 
    ? `@page { size: ${size} ${orient}; margin: ${marginCss}; }`
    : `@page { size: auto; margin: ${marginCss}; }`;

  sheet.innerHTML=`
    <style>${pageCss}</style>
    <div class="ps-header">
      <div>
        <div class="ps-brand">PapeRuss</div>
        <div style="font-size:10px;color:#64748b;margin-top:3px">Professional note record</div>
      </div>
      <div class="ps-meta">
        Created ${fullDate(note.createdAt)}<br>
        Last edited ${fullDate(note.updatedAt)}<br>
        Printed ${printedAt}
      </div>
    </div>
    <h1>${esc(titleOf(note))}</h1>
    ${tags?`<div class="ps-tags">${tags}</div>`:''}
    <main class="ps-content">${cleanHtml}</main>
    <footer class="ps-footer">
      <div class="ps-footer-copy">
        PapeRuss offline note record<br>
        Reference ID: ${esc(note.id)}
      </div>
      <div id="printQr" aria-label="Note reference QR code"></div>
    </footer>`;

  const qr=document.getElementById('printQr');
  if(window.QRCode){
    qr.innerHTML='';
    new QRCode(qr,{text:reference,width:60,height:60,colorDark:'#111827',colorLight:'#ffffff',correctLevel:QRCode.CorrectLevel.M});
  }else{
    fallbackReferenceMark(qr,reference);
  }
  // Let the QR renderer paint before opening the browser print/PDF dialog.
  setTimeout(()=>window.print(),120);
}

function createNote(){
  const n={ id:uid(), title:'', content:'', tags:[], pinned:false, archived:false, createdAt:Date.now(), updatedAt:Date.now(), fontStyle:appSettings.defaultFont||'sans' };
  notes.unshift(n);
  state.currentId=n.id;
  save(); renderAll();
  showMobileEditor();
  setTimeout(()=>document.getElementById('noteTitle').focus(),50);
  toast('New note created');
}

function selectNote(id, leafId = null){
  state.currentId=id;
  state.currentMediaId=null;
  // If we're in a non-note view (media/calendar/tasks) or the note isn't in the
  // current filtered set, switch back to a notes filter so the editor shows the note.
  const nonNoteView = ['media','calendar','tasks','settings'].includes(state.filter);
  if(nonNoteView || !filteredNotes().some(n=>n.id===id)){
    if(nonNoteView){ state.filter='all'; state.tag=null; }
    document.querySelectorAll('.nav-btn').forEach(b=>b.classList.toggle('active',b.dataset.filter===state.filter));
  }
  renderAll();
  showMobileEditor();

  if (leafId && window.paperussLeafManager) {
    setTimeout(() => {
      window.paperussLeafManager.switchLeaf(id, leafId).catch(console.error);
    }, 50);
  }
}

const persist = debounce(()=>{
  save();
  const st=document.getElementById('saveStatus');
  st.className='save-status';
  const n=getNote(state.currentId);
  st.innerHTML='<span class="dot"></span><span>Saved '+timeAgo(n?n.updatedAt:Date.now())+'</span>';
},500);

// Debounced list/sidebar refresh — avoids a full DOM rebuild on every keystroke.
// 300 ms is shorter than persist's 500 ms so the preview updates before the save.
const _debouncedRenderListSidebar = debounce(()=>{
  renderList();
  renderSidebar();
}, 300);

function editField(field, value){
  const n=getNote(state.currentId); if(!n) return;
  if(n.deletedAt) return;
  if (field === 'content') {
    const cleanValue = typeof window.cleanInternalEditorUI === 'function' ? window.cleanInternalEditorUI(value) : value;
    value = typeof sanitizeNoteHTML === 'function' ? sanitizeNoteHTML(cleanValue) : cleanValue;
  }
  
  if (field === 'content' && window.currentActiveLeaf) {
    const leaf = window.currentActiveLeaf;
    leaf.content = value;
    leaf.updatedAt = Date.now();
    
    // If virtual or default leaf, mirror to Note
    if (leaf.isVirtual || leaf.id === (window.paperussLeaves ? window.paperussLeaves.getNoteDefaultLeafId(n) : '')) {
      n.content = value;
      n.updatedAt = Date.now();
      persist();
    } else {
      // Materialized non-default leaf: save only to IndexedDB!
      n.updatedAt = Date.now(); // Note metadata updated, but NOT content
      persist();
      
      // Async save leaf to IndexedDB
      if (window.paperussLeaves) {
        window.paperussLeaves.leafPut(leaf).then(() => {
          window.paperussLeaves.leafQueuePut({
            id: 'mut_' + Date.now() + '_' + Math.random().toString(36).substr(2,9),
            noteId: n.id,
            action: 'put',
            data: Object.assign({}, leaf),
            timestamp: Date.now()
          });
        });
      }
    }
  } else {
    n[field]=value; n.updatedAt=Date.now();
    persist();
  }

  const st=document.getElementById('saveStatus'); st.className='save-status saving';
  st.innerHTML='<span class="dot"></span><span>Saving…</span>';
  
  if(field==='title'){ renderList(); renderSidebar(); }
  else { _debouncedRenderListSidebar(); }
  if(field==='content') {
    renderStats(n);
    if(typeof window.triggerLeaflineUpdate === 'function') window.triggerLeaflineUpdate();
  }
}

function sanitizeForStorage(html){
  // Strip transient blob URLs and interaction-only table state.
  const clean=(html||'')
    .replace(/\ssrc="blob:[^"]*"/g,'')
    .replace(/\sdata-blob-url="[^"]*"/g,'');
  const temp=document.createElement('div');
  temp.innerHTML=clean;
  temp.querySelectorAll('[data-media-sync-indicator]').forEach(el=>el.remove());
  temp.querySelectorAll('.table-move-placeholder,[data-table-ui]').forEach(el=>el.remove());
  temp.querySelectorAll('.tbl-selected').forEach(cell=>cell.classList.remove('tbl-selected'));
  temp.querySelectorAll('.table-selection-mode,.table-moving').forEach(el=>{
    el.classList.remove('table-selection-mode','table-moving');
  });
  return typeof sanitizeNoteHTML==='function'?sanitizeNoteHTML(temp.innerHTML):temp.innerHTML;
}
function handleBodyInput(){
  if(state.suppressInput) return;
  const ed=bodyEl();
  let html=ed.innerHTML;
  if(isEditorEmpty(html) || html==='<br>' || html==='<div><br></div>') html='';
  html=sanitizeForStorage(html);
  editField('content', html);
  if(window.HistoryManager) window.HistoryManager.queueCapture();
}

function togglePin(){
  const n=getNote(state.currentId); if(!n) return;
  if(n.deletedAt) return;
  n.pinned=!n.pinned; n.updatedAt=Date.now();
  save(); renderAll(); toast(n.pinned?'Note pinned':'Note unpinned');
}
function toggleArchive(){
  const n=getNote(state.currentId); if(!n) return;
  if(n.deletedAt) return;
  n.archived=!n.archived; n.updatedAt=Date.now();
  save(); renderAll(); toast(n.archived?'Note archived':'Note restored');
}

function restoreNote(id,options={}){
  const n=getNote(id); if(!n) return;
  delete n.deletedAt;
  n.updatedAt=Date.now();
  if(options.filter){
    state.filter=options.filter;
  }else if(options.open!==false){
    state.filter=n.archived?'archived':'all';
  }
  if(options.select!==false) state.currentId=id;
  state.tag=null;
  save();
  renderAll();
  toast('Note restored');
}

function permanentlyDeleteNote(id){
  const n=getNote(id); if(!n) return;
  const idx=notes.indexOf(n);
  confirmDialog('Delete permanently?','"'+esc(titleOf(n))+'" will be permanently removed. This cannot be undone.','Delete permanently', async ()=>{
    notes.splice(idx,1);

    if (window.paperussLeaves && window.paperussLeaves.isNoteMigratedToLeaves(n)) {
      try {
        const oldLeaves = await window.paperussLeaves.leafGetByNoteId(n.id);
        for (const lf of oldLeaves) {
          await window.paperussLeaves.leafDel(lf.id);
          await window.paperussLeaves.leafQueuePut({
            id: 'mut_del_' + Date.now() + '_' + Math.random().toString(36).substr(2,6),
            noteId: n.id,
            action: 'delete',
            data: { id: lf.id },
            timestamp: Date.now()
          });
        }
      } catch (err) {
        console.warn('Failed to delete associated leaves', err);
      }
    }

    if(typeof recordCloudDeletion==='function') recordCloudDeletion('notes',id);
    if(state.currentId===id) state.currentId=filteredNotes()[0]?.id||null;
    save();
    renderAll();
    cancelEventTimers(id);
    toast('Note permanently deleted');
    setTimeout(gcOrphanMedia,500);
  });
}

async function duplicateNoteAction() {
  const n = getNote(state.currentId);
  if (!n) return;
  toast('Duplicating note...');
  
  const newNoteId = uid();
  const cleanNoteContent = typeof window.cleanInternalEditorUI === 'function' ? window.cleanInternalEditorUI(n.content || '') : (n.content || '');
  const newNote = Object.assign({}, n, {
    id: newNoteId,
    title: n.title + ' (Copy)',
    content: cleanNoteContent,
    createdAt: Date.now(),
    updatedAt: Date.now()
  });
  
  if (window.paperussLeaves && window.paperussLeaves.isNoteMigratedToLeaves(n)) {
    try {
      const oldLeaves = await window.paperussLeaves.leafGetByNoteId(n.id);
      const idMap = {};
      const newLeafOrder = [];
      
      for (const lf of oldLeaves) {
        const newLeafId = 'leaf_' + Date.now() + '_' + Math.random().toString(36).substr(2,6);
        idMap[lf.id] = newLeafId;
        newLeafOrder.push(newLeafId);
        
        const cleanLeafContent = typeof window.cleanInternalEditorUI === 'function' ? window.cleanInternalEditorUI(lf.content || '') : (lf.content || '');
        const newLeaf = Object.assign({}, lf, {
          id: newLeafId,
          noteId: newNoteId,
          content: cleanLeafContent,
          createdAt: Date.now(),
          updatedAt: Date.now()
        });
        
        await window.paperussLeaves.leafPut(newLeaf);
        await window.paperussLeaves.leafQueuePut({
          id: 'mut_dup_' + Date.now() + '_' + Math.random().toString(36).substr(2,6),
          noteId: newNoteId,
          action: 'put',
          data: Object.assign({}, newLeaf),
          timestamp: Date.now()
        });
      }
      
      newNote.leafOrder = newLeafOrder;
      newNote.defaultLeafId = idMap[n.defaultLeafId] || n.defaultLeafId || newLeafOrder[0];
      
      const oldActiveId = window.paperussLeaves.getNoteActiveLeafId(n);
      if (oldActiveId && idMap[oldActiveId]) {
        window.paperussLeaves.setNoteActiveLeafId(newNoteId, idMap[oldActiveId]);
      }
    } catch(err) {
      console.error('duplicateNoteAction leaf copy error', err);
    }
  }
  
  notes.push(newNote);
  save();
  renderAll();
  selectNote(newNoteId);
  toast('Note duplicated');
}

function deleteNote(id){
  const n=getNote(id); if(!n) return;
  if(n.deletedAt){ permanentlyDeleteNote(id); return; }
  const previousFilter=state.filter;
  confirmDialog('Move note to Trash?','"'+esc(titleOf(n))+'" can be restored later from Trash.','Move to Trash',()=>{
    n.deletedAt=Date.now();
    n.updatedAt=Date.now();
    cancelEventTimers(id);
    if(state.currentId===id) state.currentId=filteredNotes()[0]?.id||null;
    save();
    renderAll();
    toast('Note moved to Trash',()=>{
      restoreNote(id,{filter:previousFilter,select:true});
    });
  });
}
function addTag(tag){
  const n=getNote(state.currentId); if(!n) return;
  if(n.deletedAt) return;
  tag=tag.trim().replace(/^#/,''); if(!tag) return;
  n.tags=n.tags||[]; if(n.tags.includes(tag)) return;
  n.tags.push(tag); n.updatedAt=Date.now();
  save(); renderTags(n); renderList(); renderSidebar();
}
function removeTag(tag){
  const n=getNote(state.currentId); if(!n) return;
  if(n.deletedAt) return;
  n.tags=(n.tags||[]).filter(t=>t!==tag); n.updatedAt=Date.now();
  save(); renderTags(n); renderList(); renderSidebar();
}

/* ============ LEAVES (GROUP 3) ACTIONS ============ */
async function switchLeafAction(leafId) {
  const n = getNote(state.currentId);
  if (!n) return;
  if (typeof window.flushActiveLeaf === 'function') {
    await window.flushActiveLeaf();
  }
  if (window.paperussLeafManager && typeof window.paperussLeafManager.switchLeaf === 'function') {
    await window.paperussLeafManager.switchLeaf(n.id, leafId);
  } else if (window.paperussLeaves && typeof window.paperussLeaves.setNoteActiveLeafId === 'function') {
    window.paperussLeaves.setNoteActiveLeafId(n, leafId);
  }
  if (typeof renderEditor === 'function') {
    await renderEditor();
  }
  renderList();
  if (window.updateLeafTitleBar) window.updateLeafTitleBar();
  const contentEl = document.getElementById('leavesDrawerContent');
  if (contentEl && typeof renderLeavesList === 'function') {
    renderLeavesList(contentEl);
  }
}
window.switchLeafAction = switchLeafAction;

async function createNewLeafAction() {
  const n = getNote(state.currentId);
  if (!n) return;
  const newLeafId = await window.paperussLeafManager.addLeaf(n.id, 'New Leaf');
  if (newLeafId) {
    await switchLeafAction(newLeafId);
    toast('Created new leaf');
  }
}
window.createNewLeafAction = createNewLeafAction;

async function renameLeafAction(leafId) {
  const n = getNote(state.currentId);
  if (!n) return;
  let currentTitle = 'Leaf';
  if (window.paperussLeaves) {
    const leafObj = await window.paperussLeaves.leafGet(leafId);
    if (leafObj && leafObj.title) currentTitle = leafObj.title;
  }
  const newTitle = prompt('Rename leaf:', currentTitle);
  if (newTitle && newTitle.trim() !== '' && newTitle !== currentTitle) {
    await window.paperussLeafManager.renameLeaf(n.id, leafId, newTitle.trim());
    renderList();
    const contentEl = document.getElementById('leavesDrawerContent');
    if (contentEl && typeof renderLeavesList === 'function') renderLeavesList(contentEl);
    if (window.updateLeafTitleBar) window.updateLeafTitleBar();
    toast('Renamed leaf');
  }
}
window.renameLeafAction = renameLeafAction;

async function duplicateLeafAction(leafId) {
  const n = getNote(state.currentId);
  if (!n) return;
  const newId = await window.paperussLeafManager.duplicateLeaf(n.id, leafId);
  if (newId) {
    await switchLeafAction(newId);
    toast('Duplicated leaf');
  }
}
window.duplicateLeafAction = duplicateLeafAction;

async function reorderLeafAction(leafId, direction) {
  const n = getNote(state.currentId);
  if (!n) return;
  const res = await window.paperussLeafManager.reorderLeaf(n.id, leafId, direction);
  if (res) {
    renderList();
    const contentEl = document.getElementById('leavesDrawerContent');
    if (contentEl && typeof renderLeavesList === 'function') renderLeavesList(contentEl);
    toast('Reordered leaves');
  }
}
window.reorderLeafAction = reorderLeafAction;

async function deleteLeafAction(leafId, skipConfirm = false) {
  const n = getNote(state.currentId);
  if (!n) return;
  const order = window.paperussLeaves ? window.paperussLeaves.getNoteLeafOrder(n) : null;
  const leaves = order && order.length > 0 ? order : [n.defaultLeafId || 'virtual_main_' + n.id];
  if (leaves.length <= 1) {
    toast('Cannot delete the final Leaf.');
    return false;
  }
  const doDelete = async () => {
    const res = await window.paperussLeafManager.deleteLeaf(n.id, leafId);
    if (res) {
      const activeLeafId = window.paperussLeaves ? window.paperussLeaves.getNoteActiveLeafId(n) : null;
      if (activeLeafId) {
        await switchLeafAction(activeLeafId);
      } else {
        renderList();
        const contentEl = document.getElementById('leavesDrawerContent');
        if (contentEl && typeof renderLeavesList === 'function') renderLeavesList(contentEl);
      }
      if (window.updateLeafTitleBar) window.updateLeafTitleBar();
      toast('Deleted leaf');
      return true;
    }
    return false;
  };
  if (skipConfirm || window._skipConfirm) {
    await doDelete();
  } else {
    confirmDialog('Delete Leaf?', 'This Leaf will be permanently deleted.', 'Delete', async () => {
      await doDelete();
    });
  }
}
window.deleteLeafAction = deleteLeafAction;
