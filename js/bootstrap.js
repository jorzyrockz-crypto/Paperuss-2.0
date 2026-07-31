/* ============================================================
   EVENT WIRING + INIT
   ============================================================ */
function selectFilter(filterName){
  if(!filterName) return;
  // Close any floating editor tools (gutter, slash menu, image context menu)
  // before switching pages so they don't linger on unrelated views.
  if(typeof closeAllContextTools==='function') closeAllContextTools();
  state.filter=filterName; state.tag=null; state.currentMediaId=null;
  document.querySelectorAll('.nav-btn').forEach(x=>x.classList.toggle('active', x.dataset.filter===filterName));
  if(!['media','calendar','tasks','settings'].includes(state.filter)){
    state.currentId = filteredNotes()[0]?.id || null;
  }
  renderAll();
  if(window.innerWidth<=640){
    if(['all','pinned','archived','trash'].includes(state.filter)) showMobileList();
    else showMobileEditor();
  }
  if(typeof closeSidebarMobile==='function') closeSidebarMobile();
}

function bind(){
  document.getElementById('newNoteBtn').onclick=()=>contextualNew();

  document.getElementById('searchInput').addEventListener('input', e=>{ state.query=e.target.value; renderList(); });

  document.querySelectorAll('.nav-btn').forEach(b=>b.onclick=()=>selectFilter(b.dataset.filter));


  document.getElementById('sortSelect').onchange=e=>{ state.sort=e.target.value; renderList(); };

  document.getElementById('notesContainer').onclick=e=>{
    const mediaCard=e.target.closest('[data-media-card-id]');
    if(mediaCard){ selectMediaAsset(mediaCard.dataset.mediaCardId); return; }
    const card=e.target.closest('.note-card');
    if(card && card.dataset.id){
      if(typeof closeAllContextTools==='function') closeAllContextTools();
      selectNote(card.dataset.id);
    }
  };

  // Media Hub gallery + tabs
  const mhTabsEl=document.getElementById('mhTabs');
  if(mhTabsEl) mhTabsEl.onclick=e=>{
    const t=e.target.closest('[data-mhtab]'); if(!t) return;
    state.mediaTypeFilter=t.dataset.mhtab; state.currentMediaId=null;
    renderMediaHubView(); renderList();
  };
  const mhGridEl=document.getElementById('mhGrid');
  if(mhGridEl) mhGridEl.onclick=e=>{
    const c=e.target.closest('[data-mh-select]'); if(!c) return;
    selectMediaAsset(c.dataset.mhSelect);
  };

  document.getElementById('noteTitle').addEventListener('input', e=>editField('title', e.target.value));

  const ed=bodyEl();
  ed.addEventListener('input', handleBodyInput);
  ed.addEventListener('keyup', updateToolbarState);
  ed.addEventListener('mouseup', updateToolbarState);
  ed.addEventListener('focus', updateToolbarState);
  // Apply any remote note update that was deferred while the user was typing
  function applyPendingRemoteNote(){
    if(!_pendingRemoteNote) return;
    const pending=_pendingRemoteNote;
    _pendingRemoteNote=null;
    if(pending.id !== state.currentId) return; // note switched while deferred
    const local=getNote(pending.id);
    if(!local || (pending.updatedAt||0) > (local.updatedAt||0)){
      const idx=notes.findIndex(n=>n.id===pending.id);
      if(idx!==-1) notes[idx]=pending; else notes.push(pending);
      renderEditor();
    }
  }
  ed.addEventListener('blur', applyPendingRemoteNote);
  document.getElementById('noteTitle').addEventListener('blur', applyPendingRemoteNote);
  // Keep checkbox clicks working inside contenteditable
  ed.addEventListener('click', e=>{
    if(e.target && e.target.matches && e.target.matches('input[type=checkbox]')){
      // let default toggle happen, then save
      setTimeout(handleBodyInput, 0);
    }
    const badge = e.target.closest('.callout-badge');
    if(badge){
      e.preventDefault();
      const callout = badge.closest('.note-callout');
      if(callout){
        const types = ['tip', 'warning', 'summary', 'info'];
        const cur = callout.dataset.callout || 'tip';
        const next = types[(types.indexOf(cur) + 1) % types.length];
        callout.className = `note-callout callout-${next}`;
        callout.dataset.callout = next;
        const badgeNames = { tip: '💡 Tip', warning: '⚠️ Warning', summary: '📝 Summary', info: 'ℹ️ Info' };
        badge.textContent = badgeNames[next] || '💡 Tip';
        setTimeout(handleBodyInput, 0);
      }
    }
  });

  // Intercept Undo / Redo for Custom History Manager
  ed.addEventListener('keydown', e => {
    if(window.HistoryManager) {
      if((e.ctrlKey || e.metaKey) && !e.shiftKey && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        window.HistoryManager.undo();
      } else if((e.ctrlKey || e.metaKey) && ((e.shiftKey && e.key.toLowerCase() === 'z') || e.key.toLowerCase() === 'y')) {
        e.preventDefault();
        window.HistoryManager.redo();
      }
    }
  });

  // Enter in a task item creates a new task line
  ed.addEventListener('keydown', e=>{
    if(e.key==='Enter' && !e.shiftKey){
      const sel=window.getSelection();
      if(sel && sel.anchorNode && ed.contains(sel.anchorNode)){
        let node=sel.anchorNode;
        if(node.nodeType===3) node=node.parentElement;
        const li=node.closest&&node.closest('[data-task]');
        if(li){
          e.preventDefault();
          // Create a new sibling task item after the current one
          const newLi=document.createElement('li');
          newLi.setAttribute('data-task','1');
          const cb=document.createElement('input');
          cb.type='checkbox';
          newLi.appendChild(cb);
          newLi.appendChild(document.createTextNode(' '));
          li.parentElement.insertBefore(newLi, li.nextSibling);
          // Place cursor in the new task item
          const r=document.createRange();
          r.setStart(newLi, newLi.childNodes.length===2?2:1);
          r.collapse(true);
          sel.removeAllRanges(); sel.addRange(r);
          setTimeout(handleBodyInput, 0);
        }
      }
    }
  });

  // Markdown auto-formatting shortcuts on Space
  ed.addEventListener('keydown', e=>{
    if(e.key===' '){
      const sel=window.getSelection();
      if(!sel || !sel.isCollapsed || !sel.anchorNode || !ed.contains(sel.anchorNode)) return;
      let node=sel.anchorNode;
      if(node.nodeType!==3) return;
      const text = node.textContent.slice(0, sel.anchorOffset);
      const parent = node.parentElement;
      const block = parent.closest('p, div, h1, h2, h3, h4, blockquote, li') || parent;
      if(text === '#' && (block.tagName === 'P' || block.tagName === 'DIV')){
        e.preventDefault();
        node.textContent = node.textContent.slice(1);
        document.execCommand('formatBlock', false, 'h1');
        setTimeout(handleBodyInput, 0);
      } else if(text === '##' && (block.tagName === 'P' || block.tagName === 'DIV')){
        e.preventDefault();
        node.textContent = node.textContent.slice(2);
        document.execCommand('formatBlock', false, 'h2');
        setTimeout(handleBodyInput, 0);
      } else if(text === '###' && (block.tagName === 'P' || block.tagName === 'DIV')){
        e.preventDefault();
        node.textContent = node.textContent.slice(3);
        document.execCommand('formatBlock', false, 'h3');
        setTimeout(handleBodyInput, 0);
      } else if(text === '>' && (block.tagName === 'P' || block.tagName === 'DIV')){
        e.preventDefault();
        node.textContent = node.textContent.slice(1);
        document.execCommand('formatBlock', false, 'blockquote');
        setTimeout(handleBodyInput, 0);
      } else if(text === '---'){
        e.preventDefault();
        node.textContent = node.textContent.slice(3);
        document.execCommand('insertHorizontalRule', false, null);
        setTimeout(handleBodyInput, 0);
      } else if((text === '!tip' || text === '!warning' || text === '!summary' || text === '!info') && (block.tagName === 'P' || block.tagName === 'DIV')){
        e.preventDefault();
        const type = text.slice(1);
        node.textContent = node.textContent.slice(type.length + 1);
        if(typeof insertCallout === 'function') insertCallout(type);
        setTimeout(handleBodyInput, 0);
      } else {
        // Inline markdown auto-formatting for **bold**, ~~strike~~, and *italic*
        const boldMatch = text.match(/\*\*([^\*\s][^\*]*[^\*\s]|[^\*\s])\*\*$/);
        const strikeMatch = text.match(/~~([^~\s][^~]*[^~\s]|[^~\s])~~$/);
        const italicMatch = !boldMatch && text.match(/(?<!\*)\*([^\*\s][^\*]*[^\*\s]|[^\*\s])\*(?!\*)$/);
        if(boldMatch){
          e.preventDefault();
          const word = boldMatch[1];
          const range = sel.getRangeAt(0);
          range.setStart(node, sel.anchorOffset - boldMatch[0].length);
          range.deleteContents();
          const strong = document.createElement('strong');
          strong.textContent = word;
          range.insertNode(strong);
          range.setStartAfter(strong);
          range.collapse(true);
          sel.removeAllRanges(); sel.addRange(range);
          document.execCommand('insertText', false, ' ');
          setTimeout(handleBodyInput, 0);
        } else if(strikeMatch){
          e.preventDefault();
          const word = strikeMatch[1];
          const range = sel.getRangeAt(0);
          range.setStart(node, sel.anchorOffset - strikeMatch[0].length);
          range.deleteContents();
          const del = document.createElement('del');
          del.textContent = word;
          range.insertNode(del);
          range.setStartAfter(del);
          range.collapse(true);
          sel.removeAllRanges(); sel.addRange(range);
          document.execCommand('insertText', false, ' ');
          setTimeout(handleBodyInput, 0);
        } else if(italicMatch){
          e.preventDefault();
          const word = italicMatch[1];
          const range = sel.getRangeAt(0);
          range.setStart(node, sel.anchorOffset - italicMatch[0].length);
          range.deleteContents();
          const em = document.createElement('em');
          em.textContent = word;
          range.insertNode(em);
          range.setStartAfter(em);
          range.collapse(true);
          sel.removeAllRanges(); sel.addRange(range);
          document.execCommand('insertText', false, ' ');
          setTimeout(handleBodyInput, 0);
        }
      }
    }
  });

  /* Fix #6 — Tab key inside the editor.
     Default behaviour would jump focus to the next tab-stop (kicking the user
     out of the editor). Instead we insert an indentation and let Shift+Tab
     outdent list items — but we still allow Tab to work normally when the
     editor itself is NOT focused, preserving accessibility. */
  ed.addEventListener('keydown', e=>{
    if(e.key!=='Tab') return;
    const sel=window.getSelection();
    if(!sel || !sel.anchorNode || !ed.contains(sel.anchorNode)) return;

    let node=sel.anchorNode;
    if(node.nodeType===3) node=node.parentElement;

    // Inside a table: Tab jumps to the next cell (Shift+Tab → previous cell).
    const cell=node.closest && node.closest('td,th');
    if(cell){
      e.preventDefault();
      const row=cell.parentElement;
      const cells=Array.from(row.parentElement.querySelectorAll('td,th'));
      const idx=cells.indexOf(cell);
      const next=e.shiftKey?cells[idx-1]:cells[idx+1];
      if(next){
        const r=document.createRange();
        r.selectNodeContents(next); r.collapse(true);
        sel.removeAllRanges(); sel.addRange(r);
      }else if(!e.shiftKey){
        // Tab from the last cell → add a new row and land in its first cell.
        const tbody=cell.closest('tbody')||cell.closest('table');
        const cols=row.children.length;
        const tr=document.createElement('tr');
        for(let i=0;i<cols;i++) tr.appendChild(document.createElement('td')).innerHTML='&nbsp;';
        tbody.appendChild(tr);
        const r=document.createRange();
        r.selectNodeContents(tr.firstChild); r.collapse(true);
        sel.removeAllRanges(); sel.addRange(r);
        setTimeout(handleBodyInput, 0);
      }
      return;
    }

    // Inside a list item: Tab indents, Shift+Tab outdents.
    const li=node.closest && node.closest('li');
    if(li){
      e.preventDefault();
      document.execCommand(e.shiftKey?'outdent':'indent', false, null);
      setTimeout(handleBodyInput, 0);
      return;
    }

    // Plain text: insert 2-space soft tab so focus never leaves the editor.
    e.preventDefault();
    document.execCommand('insertText', false, '  ');
    setTimeout(handleBodyInput, 0);
  });
  // Prevent navigating away when clicking links while editing; open on ctrl/cmd-click
  ed.addEventListener('click', e=>{
    const a=e.target.closest && e.target.closest('a');
    if(a){
      if(e.metaKey || e.ctrlKey){ /* allow open */ }
      else { e.preventDefault(); }
    }
  });

  document.getElementById('tagInput').addEventListener('keydown', e=>{
    if(e.key==='Enter' || e.key===','){ e.preventDefault(); addTag(e.target.value); e.target.value=''; }
    else if(e.key==='Backspace' && !e.target.value){
      const n=getNote(state.currentId); if(n&&n.tags&&n.tags.length) removeTag(n.tags[n.tags.length-1]);
    }
  });
  document.getElementById('tagChips').onclick=e=>{
    const b=e.target.closest('[data-rmtag]'); if(b) removeTag(b.dataset.rmtag);
  };

  document.getElementById('pinBtn').onclick=togglePin;
  document.getElementById('archiveBtn').onclick=toggleArchive;
  document.getElementById('restoreBtn').onclick=()=>restoreNote(state.currentId);
  document.getElementById('deleteBtn').onclick=()=>deleteNote(state.currentId);

  // Mobile editor "More" panel — pin/archive/delete consolidated
  const editorMoreBtn=document.getElementById('editorMoreBtn');
  const editorMorePanel=document.getElementById('editorMorePanel');
  const closeEditorMore=()=>editorMorePanel?.classList.remove('show');
  if(editorMoreBtn) editorMoreBtn.onclick=e=>{
    e.stopPropagation();
    editorMorePanel?.classList.toggle('show');
  };
  document.getElementById('morePinBtn').onclick=()=>{ closeEditorMore(); togglePin(); };
  document.getElementById('moreShareBtn').onclick=()=>{ closeEditorMore(); shareCurrentNote(); };
  document.getElementById('morePrintBtn').onclick=()=>{ closeEditorMore(); printCurrentNote(); };
  document.getElementById('moreArchiveBtn').onclick=()=>{
    closeEditorMore();
    const n=getNote(state.currentId);
    if(n?.deletedAt) restoreNote(n.id);
    else toggleArchive();
  };
  document.getElementById('moreDeleteBtn').onclick=()=>{ closeEditorMore(); deleteNote(state.currentId); };
  document.addEventListener('click',e=>{
    if(!e.target.closest('#editorMoreWrap')) closeEditorMore();
  });

  // Toolbar collapse / expand toggle
  const tcb=document.getElementById('toolbarCollapseBtn');
  if(tcb){
    tcb.onclick=e=>{
      e.stopPropagation();
      const bar=document.getElementById('formatBar');
      if(!bar) return;
      const was=bar.classList.toggle('expanded');
      tcb.classList.toggle('expanded', was);
      if(tcb.querySelector('i'))
        tcb.querySelector('i').setAttribute('data-lucide', was?'chevron-up':'chevron-down');
      refreshIcons();
    };
  }

  document.getElementById('formatBar').onclick=e=>{
    const media=e.target.closest('[data-media]');
    if(media){ e.preventDefault(); handleMediaAction(media.dataset.media); return; }
    const b=e.target.closest('[data-cmd]'); if(!b) return;
    e.preventDefault();
    applyCommand(b.dataset.cmd, b.dataset.val);
  };
  // Keep selection when clicking toolbar
  document.getElementById('formatBar').addEventListener('mousedown', e=>{
    if(e.target.closest('[data-cmd],[data-media]')) e.preventDefault();
  });

  // Media file inputs
  document.getElementById('mediaImageInput').onchange=e=>{
    const files=Array.from(e.target.files||[]);
    if(pendingImageReplacement && files[0]){
      replaceImageFile(pendingImageReplacement,files[0]);
      pendingImageReplacement=null;
    }else{
      files.forEach(insertImageFile);
    }
    e.target.value='';
  };
  document.getElementById('mediaVideoInput').onchange=e=>{
    Array.from(e.target.files||[]).forEach(insertVideoFile);
    e.target.value='';
  };
  document.getElementById('mediaFileInput').onchange=e=>{
    Array.from(e.target.files||[]).forEach(insertAttachmentFile);
    e.target.value='';
  };

  // Drag & drop onto editor
  const edEl=bodyEl();
  edEl.addEventListener('dragover', e=>{ if(e.dataTransfer && e.dataTransfer.types.includes('Files')){ e.preventDefault(); edEl.classList.add('drop-target'); }});
  edEl.addEventListener('dragleave', ()=>edEl.classList.remove('drop-target'));
  edEl.addEventListener('drop', e=>{
    if(!e.dataTransfer || !e.dataTransfer.files || !e.dataTransfer.files.length) return;
    e.preventDefault();
    edEl.classList.remove('drop-target');
    for(const f of e.dataTransfer.files){
      if(f.type.startsWith('image/')) insertImageFile(f);
      else if(f.type.startsWith('video/')) insertVideoFile(f);
      else if(f.type.startsWith('audio/')) insertAudioFile(f);
      else insertAttachmentFile(f);
    }
  });

  function tsvToPaperussTable(tsv){
    const rows = tsv.trim().split(/\r?\n/).map(r => r.split('\t'));
    if(rows.length < 1 || !rows[0].length || (rows.length === 1 && rows[0].length <= 1)) return null;
    let html = '<table class="note-table"><thead><tr>';
    rows[0].forEach(cell => {
      html += `<th>${esc(cell.trim())}</th>`;
    });
    html += '</tr></thead><tbody>';
    for(let i = 1; i < rows.length; i++){
      html += '<tr>';
      rows[i].forEach(cell => {
        html += `<td>${esc(cell.trim())}</td>`;
      });
      html += '</tr>';
    }
    html += '</tbody></table>';
    return html;
  }

  function showPasteAsPlainTextChip(plainText){
    let chip = document.getElementById('pastePlainTextChip');
    if(chip) chip.remove();
    chip = document.createElement('div');
    chip.id = 'pastePlainTextChip';
    chip.className = 'paste-plain-chip';
    chip.innerHTML = `<button type="button" title="Strip all formatting and paste as plain text">Paste as plain text</button>`;
    document.body.appendChild(chip);
    const removeChip = () => { if(chip && chip.parentNode) chip.remove(); };
    chip.querySelector('button').onclick = () => {
      if(window.HistoryManager) window.HistoryManager.undo();
      else document.execCommand('undo', false, null);
      document.execCommand('insertText', false, plainText);
      setTimeout(handleBodyInput, 0);
      removeChip();
    };
    setTimeout(removeChip, 4500);
  }

  function normalizeAIPasteHTML(doc){
    // 1. Strip AI UI buttons, copy controls, and header bars
    doc.querySelectorAll('button, svg, [aria-label*="Copy" i], [class*="copy-button" i], [class*="code-header" i]').forEach(el => el.remove());
    // 2. Remove dangerous or non-semantic tags
    doc.querySelectorAll('script, style, meta, link, iframe, object, embed, o\\:p').forEach(el => el.remove());

    // 3. Normalize AI List Items (<ul><li><p>Text</p></li></ul> -> <ul><li>Text</li></ul>)
    doc.querySelectorAll('li').forEach(li => {
      const ps = Array.from(li.querySelectorAll('p'));
      if(ps.length > 0){
        li.innerHTML = ps.map(p => p.innerHTML).join('<br>');
      }
    });

    // 4. Normalize AI Tables
    doc.querySelectorAll('table').forEach(tbl => {
      tbl.classList.add('note-table');
      tbl.removeAttribute('border');
      tbl.removeAttribute('width');
      tbl.removeAttribute('height');
      const parent = tbl.parentElement;
      if(parent && parent.tagName === 'DIV' && parent.children.length === 1){
        parent.replaceWith(tbl);
      }
    });

    // 5. Normalize AI Code Blocks (<pre><code>)
    doc.querySelectorAll('pre, code').forEach(el => {
      el.removeAttribute('class');
      if(el.style){
        el.style.removeProperty('background');
        el.style.removeProperty('background-color');
        el.style.removeProperty('color');
        if(!el.getAttribute('style') || !el.getAttribute('style').trim()) el.removeAttribute('style');
      }
    });

    // 6. Clean attributes and theme-breaking inline styles across all elements
    doc.body.querySelectorAll('*').forEach(el => {
      Array.from(el.attributes).forEach(attr => {
        const n = attr.name.toLowerCase();
        const v = attr.value.toLowerCase();
        if(n.startsWith('on') || v.includes('javascript:') || n.startsWith('data-mso') || n === 'id' || n.startsWith('aria-') || n === 'tabindex'){
          el.removeAttribute(n);
        }
      });
      if(el.className && typeof el.className === 'string' && (el.className.includes('Mso') || el.className.includes('apple-') || el.className.includes('token') || el.className.includes('hljs'))){
        el.removeAttribute('class');
      }
      if(el.style){
        el.style.removeProperty('color');
        el.style.removeProperty('background-color');
        el.style.removeProperty('background');
        el.style.removeProperty('font-family');
        el.style.removeProperty('font-size');
        el.style.removeProperty('line-height');
        el.style.removeProperty('margin');
        el.style.removeProperty('padding');
        if(!el.getAttribute('style') || !el.getAttribute('style').trim()) el.removeAttribute('style');
      }
    });
  }

  // Paste images, spreadsheet tables, or clean formatted HTML from clipboard
  edEl.addEventListener('paste', e=>{
    if(!e.clipboardData) return;
    const items=e.clipboardData.items||[];
    for(const it of items){
      if(it.kind==='file'){
        const f=it.getAsFile();
        if(f && f.type.startsWith('image/')){ e.preventDefault(); insertImageFile(f); return; }
      }
    }
    const text = e.clipboardData.getData('text/plain');
    if(text && /\t/.test(text) && /\n/.test(text)){
      const tableHtml = tsvToPaperussTable(text);
      if(tableHtml){
        e.preventDefault();
        document.execCommand('insertHTML', false, tableHtml);
        setTimeout(handleBodyInput, 0);
        return;
      }
    }
    const html = e.clipboardData.getData('text/html');
    if(html){
      e.preventDefault();
      const doc = new DOMParser().parseFromString(html, 'text/html');
      normalizeAIPasteHTML(doc);
      const cleanHTML = doc.body.innerHTML;
      document.execCommand('insertHTML', false, cleanHTML);
      showPasteAsPlainTextChip(text || doc.body.textContent);
      if(typeof autoCaptureExternalImages==='function') setTimeout(autoCaptureExternalImages, 50);
      setTimeout(handleBodyInput, 0);
      return;
    }
  });

  // Delegated clicks inside editor: download buttons.
  // NOTE: image clicks are owned by initResponsiveImages() (tap = select,
  // double-tap = fullscreen), so we must not also open the old lightbox here.
  edEl.addEventListener('click', e=>{
    const dl=e.target.closest('[data-mc-download]');
    if(dl){ e.preventDefault(); downloadMediaById(dl.dataset.mcDownload, dl.dataset.mcName); return; }
  });

  document.getElementById('themeToggle').onclick=()=>{
    const cur=document.documentElement.getAttribute('data-theme');
    setTheme(cur==='dark'?'light':'dark');
  };

  const shareBtn=document.getElementById('shareBtn');
  if(shareBtn) shareBtn.onclick=shareCurrentNote;
  const printBtn=document.getElementById('printBtn');
  if(printBtn) printBtn.onclick=printCurrentNote;
  const installBtn=document.getElementById('installBtn');
  if(installBtn) installBtn.onclick=installPwa;

  document.getElementById('exportBtn').onclick=exportNotes;
  document.getElementById('importBtn').onclick=()=>document.getElementById('importFile').click();
  document.getElementById('importFile').onchange=e=>{ if(e.target.files[0]) importNotes(e.target.files[0]); e.target.value=''; };

  // Profile utilities replace duplicate top-bar controls on every device.
  const profileImportBtn=document.getElementById('profileImportBtn');
  const profileExportBtn=document.getElementById('profileExportBtn');
  const profileThemeBtn=document.getElementById('profileThemeBtn');
  const profileInstallBtn=document.getElementById('profileInstallBtn');
  const closeProfilePanel=()=>document.getElementById('profilePanel')?.classList.remove('show');
  if(profileImportBtn) profileImportBtn.onclick=()=>{
    closeProfilePanel();
    document.getElementById('importFile').click();
  };
  if(profileExportBtn) profileExportBtn.onclick=()=>{
    closeProfilePanel();
    exportNotes();
  };
  if(profileThemeBtn) profileThemeBtn.onclick=()=>{
    const cur=document.documentElement.getAttribute('data-theme');
    setTheme(cur==='dark'?'light':'dark');
    closeProfilePanel();
  };
  if(profileInstallBtn) profileInstallBtn.onclick=()=>{
    closeProfilePanel();
    installPwa();
  };

  /* ---------- COLLAPSE / TOGGLE BUTTONS (all devices) ---------- */
  // Hamburger — opens drawer on phone, toggles rail on tablet/desktop
  document.getElementById('menuToggle').onclick=()=>{
    if(window.innerWidth<=640) toggleSidebarMobile();
    else toggleSidebarRail();
  };
  // Backdrop closes drawer
  const backdropEl=document.getElementById('sidebarBackdrop');
  if(backdropEl) backdropEl.onclick=closeSidebarMobile;

  // Sidebar rail collapse toggle (tablet + desktop)
  const railBtn=document.getElementById('sidebarRailToggle');
  if(railBtn) railBtn.onclick=e=>{ e.stopPropagation(); toggleSidebarRail(); };

  // Note-list panel toggle / back button
  document.getElementById('backBtn').onclick=()=>{
    if(window.innerWidth<=640){
      showMobileList();
    } else {
      toggleNoteListPanel();
    }
  };

  // Mobile FAB
  const fab=document.getElementById('mobileFab');
  if(fab) fab.onclick=()=>{ closeSidebarMobile(); contextualNew(); };

  /* ---------- CALENDAR NAVIGATION ---------- */
  const calPrev=document.getElementById('calPrevMonth');
  const calNext=document.getElementById('calNextMonth');
  const calToday=document.getElementById('calTodayBtn');
  const calViewSelect=document.getElementById('calViewSelect');
  const shiftCalendar=dir=>{
    const d=new Date(state.calendarSelectedDate||Date.now());
    if(state.calendarView==='day')d.setDate(d.getDate()+dir);
    else if(state.calendarView==='week')d.setDate(d.getDate()+dir*7);
    else d.setMonth(d.getMonth()+dir);
    state.calendarSelectedDate=d.getTime();state.calendarYear=d.getFullYear();state.calendarMonth=d.getMonth();
    persistCalendarState();renderCalendarView();renderCalendarPlannerList();
  };
  if(calPrev) calPrev.onclick=()=>{
    shiftCalendar(-1);
  };
  if(calNext) calNext.onclick=()=>{
    shiftCalendar(1);
  };
  if(calToday) calToday.onclick=()=>{
    const t=new Date();
    state.calendarSelectedDate=dayStart(t.getTime());state.calendarYear=t.getFullYear();state.calendarMonth=t.getMonth();
    persistCalendarState();renderCalendarView();renderCalendarPlannerList();
  };
  if(calViewSelect) calViewSelect.onchange=e=>{
    state.calendarView=e.target.value;
    persistCalendarState();renderCalendarView();renderCalendarPlannerList();
  };

  /* ---------- TASKS HUB ---------- */
  const tTabs=document.getElementById('tasksTabs');
  if(tTabs) tTabs.onclick=e=>{
    const b=e.target.closest('[data-taskfilter]'); if(!b) return;
    state.taskFilter=b.dataset.taskfilter;
    renderTasksView();
  };
  const addTaskBtn=document.getElementById('addTaskBtn');
  if(addTaskBtn) addTaskBtn.onclick=openTaskCreatorModal;
  const taskFab=document.getElementById('taskFab');
  if(taskFab) taskFab.onclick=openTaskCreatorModal;
  const enableNotifBtn=document.getElementById('enableNotifBtn');
  if(enableNotifBtn) enableNotifBtn.onclick=requestNotifPermission;

  /* ---------- SYSTEM FONT STYLE PICKER ---------- */
  const fsBtn=document.getElementById('fontStyleBtn');
  if(fsBtn) fsBtn.onclick=e=>{ e.stopPropagation(); toggleDropdown('fontStyleDropdown'); };
  const fsDrop=document.getElementById('fontStyleDropdown');
  if(fsDrop) fsDrop.onclick=e=>{
    const opt=e.target.closest('[data-fontstyle]'); if(!opt) return;
    fsDrop.classList.remove('show');
    applyFontStyle(opt.dataset.fontstyle);
  };

  /* ---------- TABLE SIZE PICKER ---------- */
  const tblBtn=document.getElementById('tableBtn');
  if(tblBtn) tblBtn.onclick=e=>{ e.stopPropagation(); toggleDropdown('tableGridPicker'); };
  buildTablePicker();

  /* ---------- MODULAR BLOCKS / MEDIA CONTEXT ---------- */
  initBlockTools();
  initSlashMenuActions();
  initImageContextMenu();
  initResponsiveImages();
  initTableTools();

  document.addEventListener('keydown', e=>{
    const typing = ['INPUT','TEXTAREA','SELECT'].includes(document.activeElement.tagName)
      || document.activeElement===bodyEl()
      || document.activeElement?.isContentEditable;
    if(e.key==='/' && !typing){ e.preventDefault(); document.getElementById('searchInput').focus(); }
    if((e.ctrlKey||e.metaKey) && e.key.toLowerCase()==='n'){ e.preventDefault(); createNote(); }
    if((e.ctrlKey||e.metaKey) && e.key.toLowerCase()==='s'){ e.preventDefault(); save(); toast('All notes saved'); }
    if(e.key==='Escape'){ document.getElementById('modalRoot').innerHTML=''; document.getElementById('searchInput').blur(); }
  });

  document.addEventListener('selectionchange', ()=>{
    if(document.activeElement===bodyEl()) updateToolbarState();
  });

  // Highlight dropdown
  document.getElementById('hlBtn').onclick=e=>{ e.stopPropagation(); toggleDropdown('hlDropdown'); };
  document.getElementById('hlDropdown').onclick=e=>{
    const sw=e.target.closest('[data-cmd]');
    if(!sw) return;
    document.getElementById('hlDropdown').classList.remove('show');
    applyCommand(sw.dataset.cmd, sw.dataset.val);
  };

  // Size dropdown
  document.getElementById('szBtn').onclick=e=>{ e.stopPropagation(); toggleDropdown('szDropdown'); };
  document.getElementById('szDropdown').onclick=e=>{
    const opt=e.target.closest('[data-cmd]');
    if(!opt) return;
    document.getElementById('szDropdown').classList.remove('show');
    applyCommand(opt.dataset.cmd, opt.dataset.val);
  };

  // Page Layout dropdown
  const plBtn = document.getElementById('pageLayoutBtn');
  if(plBtn) plBtn.onclick = e => { e.stopPropagation(); toggleDropdown('pageLayoutDropdown'); };


  /* ---------- NOTIFICATION BELL & PANEL ---------- */
  const notifBell=document.getElementById('notifBellBtn');
  const notifPanel=document.getElementById('notifPanel');
  if(notifBell){
    notifBell.onclick=e=>{
      e.stopPropagation();
      const open=notifPanel.classList.toggle('show');
      if(open) renderNotifPanel();
    };
  }
  if(notifPanel){
    notifPanel.onclick=e=>{
      // Mark individual notification as read
      const readEl=e.target.closest('[data-notif-read]');
      if(readEl){ markNotifRead(readEl.dataset.notifRead); return; }
      // Dismiss notification
      const disEl=e.target.closest('[data-notif-dismiss]');
      if(disEl){ removeNotif(disEl.dataset.notifDismiss); return; }
      // Notification action link
      const actEl=e.target.closest('[data-notif-action]');
      if(actEl){
        const url=actEl.dataset.notifUrl;
        if(url) window.open(url, '_blank');
        markNotifRead(actEl.dataset.notifAction);
        notifPanel.classList.remove('show');
        return;
      }
    };
  }
  const notifMarkAll=document.getElementById('notifMarkAllRead');
  if(notifMarkAll) notifMarkAll.onclick=markAllNotifRead;
  const notifClear=document.getElementById('notifClearAll');
  if(notifClear) notifClear.onclick=clearAllNotifs;

  // Close dropdowns when clicking outside
  const closeAllDropdowns=()=>{
    ['hlDropdown','szDropdown','fontStyleDropdown','tableGridPicker','pageLayoutDropdown'].forEach(id=>{
      const el=document.getElementById(id);
      if(!el) return;
      el.classList.remove('show');
      // Reset portal positioning so the element returns to its CSS default.
      el.style.position=''; el.style.top=''; el.style.left='';
      el.style.right=''; el.style.zIndex='';
    });
    if(notifPanel) notifPanel.classList.remove('show');
  };
  document.addEventListener('click', e=>{
    if(!e.target.closest('#hlPicker') && !e.target.closest('.sz-picker')
      && !e.target.closest('#fontStylePicker') && !e.target.closest('#tablePicker')
      && !e.target.closest('#pageLayoutPicker')
      && !e.target.closest('#notifBellWrap') && !e.target.closest('#notifPanel')){
      closeAllDropdowns();
    }
  });

  // Escape closes everything
  document.addEventListener('keydown', e=>{
    if(e.key==='Escape'){
      closeAllDropdowns();
      closeSidebarMobile();
      const sm=document.getElementById('blockCommandMenu'); if(sm) sm.classList.remove('show');
      const cm=document.getElementById('imageContextMenu'); if(cm) cm.classList.remove('show');
    }
  });

  // Keep layout sane when rotating a tablet / resizing.
  // IMPORTANT: the on-screen keyboard fires `resize` by changing only the HEIGHT.
  // Re-running the mobile layout switch there would kick the user out of the
  // editor mid-typing, so we only react when the WIDTH actually changes.
  let lastViewportWidth=window.innerWidth;
  window.addEventListener('resize', ()=>{
    const width=window.innerWidth;
    if(width===lastViewportWidth) return;   // keyboard show/hide → ignore
    lastViewportWidth=width;

    const taskBar=document.getElementById('taskCreateBar');
    const taskFab=document.getElementById('taskFab');
    const isTasksView=state.filter==='tasks';
    if(width>640){
      closeSidebarMobile();
      document.getElementById('editor').classList.remove('mobile-show');
      document.getElementById('noteList').classList.remove('mobile-hide');
      if(taskBar) taskBar.classList.toggle('show', isTasksView);
      if(taskFab) taskFab.classList.remove('show');
    }else{
      const list=document.getElementById('noteList');
      if(list) list.style.display='';
      // Preserve the pane the user is currently on instead of forcing the list.
      const editorOpen=document.getElementById('editor')?.classList.contains('mobile-show');
      if(['media','calendar','tasks','settings'].includes(state.filter)) showMobileEditor();
      else if(editorOpen && getNote(state.currentId)) showMobileEditor();
      else showMobileList();
      if(taskBar) taskBar.classList.remove('show');
      if(taskFab) taskFab.classList.toggle('show', isTasksView);
    }
  });
}

(function init(){
  const savedTheme = localStorage.getItem(THEME_KEY) || (window.matchMedia('(prefers-color-scheme: light)').matches?'light':'dark');
  setTheme(savedTheme,false);
  load();
  loadTasks();
  loadNotifications();
  loadSettings();
  configurePwaInstall();
  bind();
  bindSettings();
  initAuthAndSync();
  // Schedule event notifications for any existing notes that have them
  notes.forEach(n=>{ if(!n.deletedAt && n.calendarNotify && n.calendarStart) scheduleEventNotification(n); });
  state.currentId = filteredNotes()[0]?.id || null;
  renderAll();
  updateNotifBar();
  updateNotifBadge();
  startReminderWatcher();
  if(typeof checkWhatsNewAutoPopup === 'function') setTimeout(checkWhatsNewAutoPopup, 1500);
})();
