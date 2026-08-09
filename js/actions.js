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

function sanitizeContentForPrint(rawHtml, noteTitle) {
  if (!rawHtml) return '';
  const temp = document.createElement('div');
  temp.innerHTML = rawHtml;

  // Find first child heading and check if it duplicates the note title
  const firstEl = temp.firstElementChild;
  if (firstEl && (firstEl.tagName === 'H1' || firstEl.tagName === 'H2' || firstEl.tagName === 'H3')) {
    const hText = firstEl.textContent.trim().toLowerCase();
    const nTitle = (noteTitle || '').trim().toLowerCase();
    if (hText === nTitle || nTitle.startsWith(hText) || hText.startsWith(nTitle)) {
      firstEl.remove(); // Remove the duplicated top-level heading
    }
  }

  // Remove ALL transient editor UI elements, block handles, card controls, toolbars, docks, sheets, and drop indicators
  temp.querySelectorAll(
    '.block-drop-indicator, .block-gutter, .block-hero-ghost, .ghost-drag-avatar, ' +
    '.leafline-ui, .resize-handle, .card-resize-handle, .image-resize-handle, .itb-container, .itb-dropdown, ' +
    '.embed-tb-container, .embed-tb-segment, .embed-tb-btn, .embed-tb-dropdown, .embed-wrap-dropdown, .embed-mode-dropdown, .embed-more-menu, .embed-editor-toolbar, .embed-context-panel, ' +
    '.table-controls, .table-controls-container, .table-btn, .mc-action, .table-action-menu, .tbl-tools, .tbl-submenu, .tbl-color-dropdown, .tbl-sheet, .tbl-sheet-backdrop, ' +
    '.checklist-controls, .checklist-drag-handle, ' +
    '.paperuss-card-controls, .card-header-actions, .delete-card-btn, .card-options-btn, ' +
    '.image-context-menu, .img-sheet, .img-sheet-backdrop, .img-toolbar, .img-batch-bar, .img-handle, .img-fullscreen, ' +
    '.floating-fab-dock, .floating-quick-insert-fab, .leaf-toggle-fab, .leaves-drawer-overlay, .leaf-context-menu, .music-hub-modal-overlay, .notif-panel, .profile-panel, ' +
    '.broken-card-retry, .broken-card-actions, .ui-control, .editor-only'
  ).forEach(el => el.remove());

  // Strip contenteditable attributes to prevent selection outlines
  temp.querySelectorAll('[contenteditable]').forEach(el => el.removeAttribute('contenteditable'));

  if (typeof window.dehydrateProductivityReferences === 'function') {
    window.dehydrateProductivityReferences(temp);
  }

  return temp.innerHTML;
}

async function preparePrintSheet(targetNote, options) {
  const note = targetNote || activeNoteForAction();
  if (!note) return null;
  const sheet = ensurePrintSheet();

  options = options || {};
  const scope = options.scope || 'active';
  const pageSize = options.pageSize || note.pageSize || 'auto';
  const orientation = options.orientation || note.pageOrientation || 'portrait';
  const margin = options.margin || note.pageMargins || 'normal';
  const showHeader = options.showHeader !== false;
  const showFooter = options.showFooter !== false;
  const showPageNums = options.showPageNums !== false;
  const customHeaderTitle = options.customHeaderTitle || 'PapeRuss';
  const customSubtitle = options.customSubtitle || 'Professional note record';

  let cleanHtml = '';

  if (scope === 'all' && window.paperussLeaves && window.paperussLeaves.leafGet) {
    const leafOrder = (typeof window.getNoteLeafOrder === 'function')
      ? window.getNoteLeafOrder(note)
      : (note.leafOrder || ['virtual_main_' + note.id]);

    const leafObjects = [];
    for (let i = 0; i < leafOrder.length; i++) {
      let lObj = await window.paperussLeaves.leafGet(leafOrder[i]);
      if (!lObj && (leafOrder[i] === 'virtual_main_' + note.id || i === 0)) {
        lObj = { id: leafOrder[i], title: 'Main', content: note.content };
      }
      if (lObj) leafObjects.push(lObj);
    }

    if (leafObjects.length > 1) {
      cleanHtml += `<div class="ps-toc-box">
        <h2 class="ps-toc-header">Table of Contents</h2>
        <ol class="ps-toc-list">
          ${leafObjects.map((l, idx) => `<li><span class="ps-toc-num">${idx + 1}.</span> <span class="ps-toc-title">${esc(l.title || `Leaf ${idx + 1}`)}</span></li>`).join('')}
        </ol>
      </div><div class="ps-leaf-break"></div>`;
    }

    for (let i = 0; i < leafObjects.length; i++) {
      const l = leafObjects[i];
      if (i > 0) cleanHtml += `<div class="ps-leaf-break"></div>`;
      cleanHtml += `<h2 class="ps-leaf-title">${esc(l.title || `Leaf ${i + 1}`)}</h2>`;
      cleanHtml += sanitizeContentForPrint(l.content || '', l.title);
    }
  } else {
    // Single active leaf
    let currentHtml = (typeof bodyEl === 'function' && bodyEl() ? bodyEl().innerHTML : '') || note.content || '';
    cleanHtml = sanitizeContentForPrint(currentHtml, titleOf(note));
  }

  const tags = (note.tags || []).map(t => `<span class="ps-tag">${esc(t)}</span>`).join('');
  const printedAt = new Date().toLocaleString();
  const reference = `paperuss://note/${note.id}?updated=${note.updatedAt}`;

  let marginCss = '16mm 17mm 19mm'; // default auto margins
  if (margin === 'narrow') marginCss = '10mm';
  else if (margin === 'wide') marginCss = '25mm';

  let pageCss = pageSize !== 'auto'
    ? `@page { size: ${pageSize} ${orientation}; margin: ${marginCss}; }`
    : `@page { size: auto; margin: ${marginCss}; }`;

  if (showPageNums) {
    pageCss += `\n@page { @bottom-right { content: "Page " counter(page) " of " counter(pages); font-size: 8pt; color: #64748b; font-family: sans-serif; } }`;
  }

  sheet.innerHTML = `
    <style>${pageCss}</style>
    ${showHeader ? `
    <div class="ps-header">
      <div>
        <div class="ps-brand">${esc(customHeaderTitle)}</div>
        <div style="font-size:10px;color:#64748b;margin-top:3px">${esc(customSubtitle)}</div>
      </div>
      <div class="ps-meta">
        Created ${fullDate(note.createdAt)}<br>
        Last edited ${fullDate(note.updatedAt)}<br>
        Printed ${printedAt}
      </div>
    </div>` : ''}
    <h1>${esc(titleOf(note))}</h1>
    ${tags ? `<div class="ps-tags">${tags}</div>` : ''}
    <main class="ps-content">${cleanHtml}</main>
    ${showFooter ? `
    <footer class="ps-footer">
      <div class="ps-footer-copy">
        PapeRuss offline note record<br>
        Reference ID: ${esc(note.id)}
      </div>
      <div id="printQr" aria-label="Note reference QR code"></div>
    </footer>` : ''}`;

  const qr = document.getElementById('printQr');
  if (qr) {
    if (window.QRCode) {
      qr.innerHTML = '';
      new QRCode(qr, { text: reference, width: 60, height: 60, colorDark: '#111827', colorLight: '#ffffff', correctLevel: QRCode.CorrectLevel.M });
    } else {
      fallbackReferenceMark(qr, reference);
    }
  }
  return sheet;
}

function openPrintModal() {
  const note = activeNoteForAction();
  if (!note) {
    if (typeof toast === 'function') toast('No active note available to print.');
    return;
  }

  const root = document.getElementById('modalRoot');
  if (!root) return;

  const leafCount = (typeof window.paperussLeaves !== 'undefined' && window.paperussLeaves.getNoteLeafCount)
    ? window.paperussLeaves.getNoteLeafCount(note)
    : (note.leafOrder ? note.leafOrder.length : 1);

  const activeLeafTitle = (window.currentActiveLeaf ? window.currentActiveLeaf.title : '') || 'Active Leaf';

  let printScope = 'active'; // 'active' or 'all'
  let pageSize = note.pageSize || 'auto';
  let orientation = note.pageOrientation || 'portrait';
  let margin = note.pageMargins || 'normal';
  let showHeader = true;
  let showFooter = true;
  let showPageNums = true;
  let customHeaderTitle = 'PapeRuss';
  let customSubtitle = 'Professional note record';

  function renderModal() {
    root.innerHTML = `
      <div class="modal-overlay" id="printModalOverlay">
        <div class="print-setup-modal" role="dialog" aria-label="Print & PDF Setup">
          <div class="print-modal-header">
            <div class="pm-header-title">
              <i data-lucide="printer" class="w-5 h-5 text-indigo-500 inline mr-2"></i>
              <h3 style="display:inline;font-size:16px;font-weight:700;">Print & PDF Export Setup</h3>
            </div>
            <button type="button" class="changelog-close" id="printModalClose" aria-label="Close"><i data-lucide="x"></i></button>
          </div>

          <div class="print-modal-body-wrapper" style="display:flex;gap:16px;padding:20px;overflow-y:auto;max-height:calc(90vh - 120px);">
            <div class="print-modal-body-fields" style="flex:1;display:flex;flex-direction:column;gap:14px;min-width:260px;">
              <!-- Print Scope (Single Leaf vs All Leaves) -->
              <div class="pm-field-group">
                <label class="pm-label">Print Scope</label>
                <div class="pm-segmented-control">
                  <button type="button" class="pm-segment-btn ${printScope === 'active' ? 'active' : ''}" id="pmScopeActive">
                    <i data-lucide="file-text" class="w-4 h-4 inline mr-1"></i>
                    <span>Active Leaf (${esc(activeLeafTitle)})</span>
                  </button>
                  <button type="button" class="pm-segment-btn ${printScope === 'all' ? 'active' : ''}" id="pmScopeAll">
                    <i data-lucide="files" class="w-4 h-4 inline mr-1"></i>
                    <span>All Leaves (${leafCount}) + TOC</span>
                  </button>
                </div>
              </div>

              <!-- Custom Header Titles -->
              <div class="pm-field-group">
                <label class="pm-label">Custom Document Header</label>
                <div class="pm-grid-2">
                  <input type="text" id="pmCustomTitle" class="pm-select" value="${esc(customHeaderTitle)}" placeholder="Brand / Company">
                  <input type="text" id="pmCustomSubtitle" class="pm-select" value="${esc(customSubtitle)}" placeholder="Subtitle">
                </div>
              </div>

              <!-- Page Size & Orientation -->
              <div class="pm-grid-2">
                <div class="pm-field-group">
                  <label class="pm-label" for="pmPageSize">Paper Size</label>
                  <select id="pmPageSize" class="pm-select">
                    <option value="auto" ${pageSize === 'auto' ? 'selected' : ''}>Auto / Default</option>
                    <option value="A4" ${pageSize === 'A4' ? 'selected' : ''}>A4 (210 × 297 mm)</option>
                    <option value="letter" ${pageSize === 'letter' ? 'selected' : ''}>US Letter (8.5 × 11 in)</option>
                    <option value="legal" ${pageSize === 'legal' ? 'selected' : ''}>US Legal (8.5 × 14 in)</option>
                  </select>
                </div>

                <div class="pm-field-group">
                  <label class="pm-label" for="pmOrientation">Orientation</label>
                  <select id="pmOrientation" class="pm-select">
                    <option value="portrait" ${orientation === 'portrait' ? 'selected' : ''}>Portrait</option>
                    <option value="landscape" ${orientation === 'landscape' ? 'selected' : ''}>Landscape</option>
                  </select>
                </div>
              </div>

              <!-- Page Margins -->
              <div class="pm-field-group">
                <label class="pm-label" for="pmMargins">Page Margins</label>
                <select id="pmMargins" class="pm-select">
                  <option value="normal" ${margin === 'normal' ? 'selected' : ''}>Normal (16mm 17mm 19mm)</option>
                  <option value="narrow" ${margin === 'narrow' ? 'selected' : ''}>Narrow (10mm)</option>
                  <option value="wide" ${margin === 'wide' ? 'selected' : ''}>Wide (25mm)</option>
                </select>
              </div>

              <!-- Content Toggles -->
              <div class="pm-field-group">
                <label class="pm-label">Document Elements</label>
                <div class="pm-toggles-grid">
                  <label class="pm-checkbox-label">
                    <input type="checkbox" id="pmShowHeader" ${showHeader ? 'checked' : ''}>
                    <span>Header & Metadata</span>
                  </label>
                  <label class="pm-checkbox-label">
                    <input type="checkbox" id="pmShowFooter" ${showFooter ? 'checked' : ''}>
                    <span>Footer & QR Reference Code</span>
                  </label>
                  <label class="pm-checkbox-label">
                    <input type="checkbox" id="pmShowPageNums" ${showPageNums ? 'checked' : ''}>
                    <span>Page Numbers (Page X of Y)</span>
                  </label>
                </div>
              </div>
            </div>

            <!-- Live Mini Preview Thumbnail Column -->
            <div class="pm-preview-column" style="width:180px;display:flex;flex-direction:column;align-items:center;justify-content:center;background:var(--bg-secondary, #f8fafc);border:1px solid var(--border, rgba(0,0,0,0.08));border-radius:12px;padding:12px;">
              <span style="font-size:10px;font-weight:700;color:var(--fg-muted,#64748b);text-transform:uppercase;letter-spacing:0.5px;margin-bottom:8px;">Live Preview</span>
              <div class="pm-paper-thumbnail ${orientation}" id="pmPaperThumb" style="width:${orientation === 'landscape' ? '140px' : '100px'};height:${orientation === 'landscape' ? '100px' : '140px'};background:#fff;border:1px solid #cbd5e1;box-shadow:0 4px 12px rgba(0,0,0,0.1);border-radius:4px;padding:8px;display:flex;flex-direction:column;justify-content:space-between;position:relative;transition:all 0.2s ease;">
                <div style="display:${showHeader ? 'flex' : 'none'};justify-content:space-between;border-bottom:1px solid #1d4ed8;padding-bottom:2px;margin-bottom:4px;">
                  <span style="font-size:6px;font-weight:700;color:#1d4ed8;">${esc(customHeaderTitle || 'PapeRuss')}</span>
                  <span style="font-size:5px;color:#94a3b8;">${fullDate(Date.now())}</span>
                </div>
                <div style="flex:1;overflow:hidden;">
                  <div style="font-size:7px;font-weight:700;color:#1e293b;margin-bottom:2px;">${esc(titleOf(note))}</div>
                  ${printScope === 'all' ? '<div style="font-size:5px;background:#eff6ff;color:#1d4ed8;padding:1px 3px;border-radius:2px;margin-bottom:3px;">Table of Contents (All Leaves)</div>' : ''}
                  <div style="height:3px;background:#e2e8f0;margin-bottom:2px;border-radius:1px;"></div>
                  <div style="height:3px;background:#e2e8f0;margin-bottom:2px;border-radius:1px;width:80%;"></div>
                  <div style="height:3px;background:#e2e8f0;margin-bottom:2px;border-radius:1px;width:90%;"></div>
                </div>
                <div style="display:${showFooter ? 'flex' : 'none'};justify-content:space-between;align-items:center;border-top:1px solid #e2e8f0;padding-top:2px;margin-top:4px;">
                  <span style="font-size:5px;color:#94a3b8;">Ref ID: ${esc(note.id.substring(0,8))}</span>
                  <div style="width:10px;height:10px;background:#111827;border-radius:1px;"></div>
                </div>
                <div style="display:${showPageNums ? 'block' : 'none'};position:absolute;bottom:2px;right:4px;font-size:5px;color:#64748b;">Page 1 of 1</div>
              </div>
            </div>
          </div>

          <div class="print-modal-footer">
            <button type="button" class="btn" id="printModalCancel">Cancel</button>
            <button type="button" class="btn btn-primary" id="printModalSubmit">
              <i data-lucide="printer" class="w-4 h-4 mr-1 inline"></i> Open Print / PDF Dialog
            </button>
          </div>
        </div>
      </div>
    `;

    if (window.lucide && typeof window.lucide.createIcons === 'function') {
      try { window.lucide.createIcons(); } catch (e) {}
    }

    // Attach Event Listeners
    document.getElementById('printModalClose').onclick = closeModal;
    document.getElementById('printModalCancel').onclick = closeModal;

    const overlay = document.getElementById('printModalOverlay');
    if (overlay) {
      overlay.onclick = (e) => { if (e.target === overlay) closeModal(); };
    }

    document.getElementById('pmScopeActive').onclick = () => { printScope = 'active'; renderModal(); };
    document.getElementById('pmScopeAll').onclick = () => { printScope = 'all'; renderModal(); };

    document.getElementById('pmCustomTitle').oninput = (e) => { customHeaderTitle = e.target.value; updateThumbnail(); };
    document.getElementById('pmCustomSubtitle').oninput = (e) => { customSubtitle = e.target.value; };

    document.getElementById('pmPageSize').onchange = (e) => { pageSize = e.target.value; };
    document.getElementById('pmOrientation').onchange = (e) => { orientation = e.target.value; renderModal(); };
    document.getElementById('pmMargins').onchange = (e) => { margin = e.target.value; };

    document.getElementById('pmShowHeader').onchange = (e) => { showHeader = e.target.checked; renderModal(); };
    document.getElementById('pmShowFooter').onchange = (e) => { showFooter = e.target.checked; renderModal(); };
    document.getElementById('pmShowPageNums').onchange = (e) => { showPageNums = e.target.checked; renderModal(); };

    function updateThumbnail() {
      const thumb = document.getElementById('pmPaperThumb');
      if (thumb) {
        thumb.style.width = orientation === 'landscape' ? '140px' : '100px';
        thumb.style.height = orientation === 'landscape' ? '100px' : '140px';
      }
    }

    document.getElementById('printModalSubmit').onclick = async () => {
      closeModal();
      await preparePrintSheet(note, {
        scope: printScope,
        pageSize,
        orientation,
        margin,
        showHeader,
        showFooter,
        showPageNums,
        customHeaderTitle,
        customSubtitle
      });
      setTimeout(() => window.print(), 120);
    };
  }

  function closeModal() {
    root.innerHTML = '';
  }

  renderModal();
}

function printCurrentNote() {
  openPrintModal();
}

// Export functions to global scope
window.openPrintModal = openPrintModal;
window.preparePrintSheet = preparePrintSheet;
window.printCurrentNote = printCurrentNote;

// Automatically sync printSheet whenever native browser print (Ctrl+P, Cmd+P, or browser menu) is triggered
window.addEventListener('beforeprint', () => {
  const note = typeof activeNoteForAction === 'function' ? activeNoteForAction() : null;
  if (note) {
    preparePrintSheet(note);
  }
});

function createNote(){
  let initialCategory = '';
  let initialBranchId = '';
  if (window.BranchEngine) {
    const activeBId = window.BranchEngine.getActiveBranchId();
    if (activeBId && activeBId !== 'all') {
      const branches = window.BranchEngine.loadBranches();
      const activeB = branches.find(b => b.id === activeBId || b.name === activeBId);
      if (activeB) {
        initialCategory = activeB.name;
        initialBranchId = activeB.id;
      }
    }
  }
  const n={ id:uid(), title:'', content:'', category: initialCategory, branchId: initialBranchId, tags:[], pinned:false, archived:false, createdAt:Date.now(), updatedAt:Date.now(), fontStyle:appSettings.defaultFont||'sans' };
  notes.unshift(n);
  state.currentId=n.id;
  save(); renderAll();
  showMobileEditor();
  setTimeout(()=>document.getElementById('noteTitle').focus(),50);
  toast(initialCategory ? `New note created in "${initialCategory}"` : 'New note created');
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
      const leafMap = {};
      oldLeaves.forEach(l => { leafMap[l.id] = l; });
      const leafOrderIds = (Array.isArray(n.leafOrder) && n.leafOrder.length > 0)
        ? n.leafOrder
        : oldLeaves.map(l => l.id);

      const idMap = {};
      const newLeafOrder = [];
      
      for (const oldLeafId of leafOrderIds) {
        const lf = leafMap[oldLeafId] || (oldLeafId.startsWith('virtual_main') ? window.paperussLeaves.getVirtualMainLeaf(n) : null);
        if (!lf) continue;

        const newLeafId = 'leaf_' + Date.now() + '_' + Math.random().toString(36).substr(2,6);
        idMap[oldLeafId] = newLeafId;
        if (oldLeafId === n.defaultLeafId) idMap['default'] = newLeafId;
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
      newNote.leafCount = newLeafOrder.length;
      newNote.defaultLeafId = idMap[n.defaultLeafId] || idMap['default'] || newLeafOrder[0];
      
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
    if (window.currentActiveLeaf && window.currentActiveLeaf.id === leafId) {
      window.currentActiveLeaf.title = newTitle.trim();
    }
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
  if (!skipConfirm) {
    confirmDialog('Delete Leaf?', 'This leaf and its content will be removed.', 'Delete Leaf', doDelete);
  } else {
    return await doDelete();
  }
}
window.deleteLeafAction = deleteLeafAction;

async function mergeAllLeavesAction(noteId) {
  const targetId = noteId || state.currentId;
  const n = getNote(targetId);
  if (!n || !window.paperussLeaves) return false;
  const order = window.paperussLeaves.getNoteLeafOrder(n);
  if (!order || order.length <= 1) {
    if (typeof toast === 'function') toast('Note has only 1 leaf.');
    return false;
  }
  confirmDialog('Merge all Leaves?', 'All sub-leaves will be combined into the main Leaf.', 'Merge Leaves', async () => {
    try {
      let combinedContent = '';
      const leaves = await window.paperussLeaves.leafGetByNoteId(n.id);
      const leafMap = {};
      leaves.forEach(l => { leafMap[l.id] = l; });
      for (let i = 0; i < order.length; i++) {
        const lf = leafMap[order[i]];
        if (!lf) continue;
        const title = lf.title || `Leaf ${i + 1}`;
        combinedContent += `<h2>${typeof esc === 'function' ? esc(title) : title}</h2>` + (lf.content || '') + '<hr>';
      }
      const defaultId = window.paperussLeaves.getNoteDefaultLeafId(n);
      const mainLeaf = leafMap[defaultId] || leaves[0];
      if (mainLeaf) {
        mainLeaf.content = combinedContent;
        mainLeaf.updatedAt = Date.now();
        await window.paperussLeaves.leafPut(mainLeaf);
      }
      n.content = combinedContent;
      n.leafOrder = [defaultId || mainLeaf.id];
      n.leafCount = 1;
      n.updatedAt = Date.now();
      if (typeof save === 'function') save();
      // Remove other leaves from IDB
      for (const lf of leaves) {
        if (lf.id !== (defaultId || mainLeaf.id)) {
          await window.paperussLeaves.leafDel(lf.id);
        }
      }
      if (typeof switchLeafAction === 'function') await switchLeafAction(defaultId || mainLeaf.id);
      if (typeof toast === 'function') toast('Merged all leaves into main leaf');
    } catch (e) {
      console.error('mergeAllLeavesAction error:', e);
    }
  });
}
window.mergeAllLeavesAction = mergeAllLeavesAction;
