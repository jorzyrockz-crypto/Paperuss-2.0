const fs = require('fs');

let core = fs.readFileSync('js/core.js', 'utf8');
let actions = fs.readFileSync('js/actions.js', 'utf8');

// 1. Modifying renderEditor in core.js
// It currently reads `n.content`. We want it to read the active Leaf content.
// Since reading from IndexedDB is async, we'll keep renderEditor synchronous but
// it will immediately set the editor to empty/loading, then async fetch the leaf.

const renderEditorBody = `function renderEditor(){
  console.error('renderEditor CALLED for state.currentId:', state.currentId);
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
  if(listPanel) listPanel.classList.remove('settings-hidden');

  if(state.filter==='settings'){
    if(empty) empty.style.display='none';
    if(content) content.classList.remove('show');
    if(settingsView) settingsView.classList.add('show');
    if(listPanel) listPanel.classList.add('settings-hidden');
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
    
    // Clear active leaf state
    window.currentActiveLeaf = null;
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
  // LEAVES: Instead of grabbing n.content, load the leaf!
  (async () => {
    try {
      let leafToRender = null;
      if (window.paperussLeaves) {
        const order = window.paperussLeaves.getNoteLeafOrder(n);
        if (order && order.length > 0) {
          const activeLeafId = window.paperussLeaves.getNoteActiveLeafId(n);
          console.error('renderEditor IIFE: activeLeafId', activeLeafId);
          leafToRender = await window.paperussLeaves.leafGet(activeLeafId);
          console.error('renderEditor IIFE: leafToRender', leafToRender);
        }
        if (!leafToRender) {
          leafToRender = window.paperussLeaves.getVirtualMainLeaf(n);
          console.error('renderEditor IIFE: fallback to virtual leaf', leafToRender);
        }
      } else {
        leafToRender = { id: 'virtual_main', title: 'Main', content: n.content, isVirtual: true };
      }
      
      window.currentActiveLeaf = leafToRender;
      const ed=bodyEl();
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

      const incomingContent = typeof sanitizeNoteHTML==='function'?sanitizeNoteHTML(leafToRender.content||''):(leafToRender.content||'');
      if (leafToRender.isVirtual || leafToRender.id === window.paperussLeaves.getNoteDefaultLeafId(n)) {
        if(incomingContent!==n.content) n.content=incomingContent;
      }
      
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
    } catch(e) {
      console.error('renderEditor IIFE Error', e);
    }
  })();
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
  })();
}`;

// Replace renderEditor in core.js
const reRenderEditor = /function renderEditor\(\)\{([\s\S]*?)async function scheduleActiveNoteRefresh/m;
core = core.replace(reRenderEditor, renderEditorBody + '\n\nasync function scheduleActiveNoteRefresh');


// 2. Modifying editField in actions.js
// It currently directly mutates n[field]=value.
// We intercept if field === 'content' to update the activeLeaf instead of directly updating n.content (unless it's the default/virtual leaf)

const editFieldBody = `function editField(field, value){
  const n=getNote(state.currentId); if(!n) return;
  if(n.deletedAt) return;
  
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
  if(field==='content') renderStats(n);
}`;

const reEditField = /function editField\(field, value\)\{([\s\S]*?)\}\n\nfunction sanitizeForStorage/m;
actions = actions.replace(reEditField, editFieldBody + '\n\nfunction sanitizeForStorage');


// 3. Adding atomic materialization in actions.js
// We need a helper for Safe Leaf Switching / Materialization.
// Group 2 doesn't have UI to switch leaves yet, but we need the API for the targeted tests to pass.
// "Creating a second Leaf materializes Main safely."
// Let's add a global window.paperussLeafManager = { switchLeaf, createSecondLeaf }

const leafManagerCode = `
window.paperussLeafManager = {
  async switchLeaf(noteId, targetLeafId) {
    if (!window.paperussLeaves) return false;
    const n = getNote(noteId);
    console.error('switchLeaf called for', noteId, leafId, 'state.currentId:', state.currentId);
    if (!n) return;
    if (window.paperussLeaves.getNoteActiveLeafId(n.id) === leafId) return; // already active
    window.flushActiveLeaf();
    window.paperussLeaves.setNoteActiveLeafId(n.id, leafId);
    if (state.currentId === noteId) {
      console.error('switchLeaf calling renderEditor');
      await renderEditor();
    } else {
      console.error('switchLeaf skipped renderEditor because currentId != noteId');
    }
    return true;
  },
  
  async materializeVirtualNote(n) {
    if (!n || window.paperussLeaves.getNoteLeafOrder(n)) return true; // Already materialized
    const mainLeaf = window.paperussLeaves.getVirtualMainLeaf(n);
    const newId = 'leaf_' + Date.now() + '_' + Math.random().toString(36).substr(2,6);
    mainLeaf.id = newId;
    delete mainLeaf.isVirtual;
    
    try {
      await window.paperussLeaves.leafPut(mainLeaf);
      // Queue materialization action (cloud will execute as batch)
      await window.paperussLeaves.leafQueuePut({
        id: 'mut_mat_' + Date.now(),
        noteId: n.id,
        action: 'materialize',
        data: Object.assign({}, mainLeaf),
        timestamp: Date.now()
      });
      // Safety gate passed, update Note metadata
      n.defaultLeafId = newId;
      n.leafOrder = [newId];
      n.leafCount = 1;
      n.updatedAt = Date.now();
      window.paperussLeaves.setNoteActiveLeafId(n.id, newId);
      persist();
      return true;
    } catch (e) {
      console.error('Migration failed, Note untouched', e);
      return false; // Leave note untouched
    }
  },

  async addLeaf(noteId, title = 'New Leaf') {
    const n = getNote(noteId);
    if (!n) return null;
    
    // Step 1: Materialize if virtual
    const materialized = await this.materializeVirtualNote(n);
    if (!materialized) return null;

    // Step 2: Create the second leaf
    const newLeaf = {
      id: 'leaf_' + Date.now() + '_' + Math.random().toString(36).substr(2,6),
      noteId: n.id,
      title: title,
      content: '',
      order: n.leafCount,
      createdAt: Date.now(),
      updatedAt: Date.now()
    };
    
    await window.paperussLeaves.leafPut(newLeaf);
    await window.paperussLeaves.leafQueuePut({
        id: 'mut_' + Date.now(),
        noteId: n.id,
        action: 'put',
        data: Object.assign({}, newLeaf),
        timestamp: Date.now()
    });
    
    n.leafOrder.push(newLeaf.id);
    n.leafCount++;
    n.updatedAt = Date.now();
    persist();
    
    return newLeaf.id;
  }
};
`;

if (!core.includes('window.paperussLeafManager')) {
  core += '\n\n' + leafManagerCode;
}

fs.writeFileSync('js/core.js', core);
fs.writeFileSync('js/actions.js', actions);
console.log('Group 2 patch applied successfully!');
