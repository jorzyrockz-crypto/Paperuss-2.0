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

  let leafSearchTimer = null;
  document.getElementById('searchInput').addEventListener('input', e => {
    const q = e.target.value;
    state.query = q;
    renderList(); // render main note matches immediately
    
    clearTimeout(leafSearchTimer);
    if (q && window.paperussLeaves) {
      leafSearchTimer = setTimeout(async () => {
        if (state.query !== q) return;
        try {
          const results = await window.paperussLeaves.leafGetAll();
          if (state.query === q) {
            state.leafSearchResults = results;
            renderList();
          }
        } catch(err) {
          console.error('Leaf search error', err);
        }
      }, 300);
    } else {
      state.leafSearchResults = null;
      renderList();
    }
  });

  document.querySelectorAll('.nav-btn').forEach(b=>b.onclick=()=>selectFilter(b.dataset.filter));


  document.getElementById('sortSelect').onchange=e=>{ state.sort=e.target.value; renderList(); };

  document.getElementById('notesContainer').onclick=e=>{
    const mediaCard=e.target.closest('[data-media-card-id]');
    if(mediaCard){ selectMediaAsset(mediaCard.dataset.mediaCardId); return; }
    const card=e.target.closest('.note-card');
    if(card && card.dataset.id){
      if(typeof closeAllContextTools==='function') closeAllContextTools();
      selectNote(card.dataset.id, card.dataset.leafId || null);
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
    const jump=e.target.closest('[data-jump-note]');
    if(jump){ e.stopPropagation(); jumpToNote(jump.dataset.jumpNote); return; }
    const c=e.target.closest('[data-mh-select]'); if(!c) return;
    selectMediaAsset(c.dataset.mhSelect);
  };

  document.getElementById('noteTitle').addEventListener('input', e=>editField('title', e.target.value));

  const ed=bodyEl();
  ed.addEventListener('input', handleBodyInput);
  ed.addEventListener('input', () => {
    const ov = document.getElementById('overflowDropdown');
    if(ov && ov.classList.contains('show')) ov.classList.remove('show');
  });
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
      if(e.target.checked) e.target.setAttribute('checked', '');
      else e.target.removeAttribute('checked');
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
  ed.addEventListener('change', e=>{
    if(e.target && e.target.matches && e.target.matches('input[type=checkbox]')){
      if(e.target.checked) e.target.setAttribute('checked', '');
      else e.target.removeAttribute('checked');
      setTimeout(handleBodyInput, 0);
    }
  });
  ed.addEventListener('keydown', e=>{
    if(e.key === ' ' && e.target && e.target.matches && e.target.matches('input[type=checkbox]')){
      setTimeout(()=>{
        if(e.target.checked) e.target.setAttribute('checked', '');
        else e.target.removeAttribute('checked');
        handleBodyInput();
      }, 0);
    }
  });

  // Intercept Undo / Redo / Link shortcuts
  ed.addEventListener('keydown', e => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
      e.preventDefault();
      if (typeof applyCommand === 'function') applyCommand('createLink');
      return;
    }
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

  // Unified Word-like list keyboard handling for Enter, Tab, and Backspace inside lists
  ed.addEventListener('keydown', e => {
    const sel = window.getSelection();
    if (!sel || !sel.anchorNode || !ed.contains(sel.anchorNode)) return;
    const ctx = typeof window.getListContext === 'function' ? window.getListContext() : null;
    if (!ctx || !ctx.li) return;

    if (e.key === 'Enter' && !e.shiftKey) {
      const textContent = Array.from(ctx.li.childNodes)
        .filter(n => n.nodeType !== 1 || n.tagName !== 'INPUT')
        .map(n => n.textContent).join('').trim();
      if (textContent === '') {
        e.preventDefault();
        if (typeof window.exitEmptyListItem === 'function') window.exitEmptyListItem(ctx.li, ctx.list);
      } else if (ctx.type === 'task') {
        e.preventDefault();
        if (typeof window.createNextTaskListItem === 'function') window.createNextTaskListItem(ctx.li);
      }
    } else if (e.key === 'Tab') {
      e.preventDefault();
      if (e.shiftKey) {
        if (typeof window.outdentListItem === 'function') window.outdentListItem(ctx.li);
      } else {
        if (typeof window.indentListItem === 'function') window.indentListItem(ctx.li);
      }
    } else if (e.key === 'Backspace' && !e.shiftKey && sel.isCollapsed) {
      let atStart = false;
      const range = sel.getRangeAt(0);
      if (range.startOffset === 0) {
        const firstNonCb = Array.from(ctx.li.childNodes).find(n => n.nodeType !== 1 || n.tagName !== 'INPUT');
        if (!firstNonCb || sel.anchorNode === ctx.li || sel.anchorNode === firstNonCb) {
          atStart = true;
        }
      }
      if (atStart) {
        const textContent = Array.from(ctx.li.childNodes)
          .filter(n => n.nodeType !== 1 || n.tagName !== 'INPUT')
          .map(n => n.textContent).join('').trim();
        const parentLi = ctx.list.parentElement && ctx.list.parentElement.closest('li');
        if (parentLi) {
          e.preventDefault();
          if (typeof window.outdentListItem === 'function') window.outdentListItem(ctx.li);
        } else if (textContent === '') {
          e.preventDefault();
          if (typeof window.exitEmptyListItem === 'function') window.exitEmptyListItem(ctx.li, ctx.list);
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
      } else if((text === '- [ ]' || text === '* [ ]' || text === '+ [ ]' || text === '[ ]') && (block.tagName === 'P' || block.tagName === 'DIV')){
        e.preventDefault();
        node.textContent = node.textContent.slice(text.length);
        if(typeof toggleList === 'function') toggleList('task');
        setTimeout(handleBodyInput, 0);
      } else if((text === '- [x]' || text === '- [X]' || text === '* [x]' || text === '* [X]' || text === '+ [x]' || text === '+ [X]' || text === '[x]' || text === '[X]') && (block.tagName === 'P' || block.tagName === 'DIV')){
        e.preventDefault();
        node.textContent = node.textContent.slice(text.length);
        if(typeof toggleList === 'function') toggleList('task');
        setTimeout(() => {
          const li = window.getSelection()?.anchorNode?.parentElement?.closest?.('li[data-task]');
          if(li && typeof _addTask === 'function') _addTask(li, true);
          handleBodyInput();
        }, 0);
      } else if((text === '-' || text === '*' || text === '+') && (block.tagName === 'P' || block.tagName === 'DIV')){
        e.preventDefault();
        node.textContent = node.textContent.slice(text.length);
        if(typeof toggleList === 'function') toggleList('ul');
        setTimeout(handleBodyInput, 0);
      } else if(text === '1.' && (block.tagName === 'P' || block.tagName === 'DIV')){
        e.preventDefault();
        node.textContent = node.textContent.slice(2);
        if(typeof toggleList === 'function') toggleList('ol');
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

  const undoBtn = document.getElementById('undoBtn');
  if(undoBtn) undoBtn.onclick = () => window.HistoryManager && window.HistoryManager.undo();
  const redoBtn = document.getElementById('redoBtn');
  if(redoBtn) redoBtn.onclick = () => window.HistoryManager && window.HistoryManager.redo();

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
  const dupBtn = document.getElementById('moreDuplicateBtn');
  if(dupBtn) dupBtn.onclick=()=>{ closeEditorMore(); duplicateNoteAction(); };
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
      if(typeof window.recalculateToolbarOverflow === 'function') window.recalculateToolbarOverflow();
    };
  }

  document.getElementById('formatBar').onclick=e=>{
    if(e.target.closest('#quotePicker') || e.target.closest('#quoteStyleDropdown')) return;
    const media=e.target.closest('[data-media]');
    if(media){
      e.preventDefault();
      handleMediaAction(media.dataset.media);
      if(typeof window.closeAllEditorDropdowns === 'function') window.closeAllEditorDropdowns();
      return;
    }
    const b=e.target.closest('[data-cmd]'); if(!b) return;
    if(b.id === 'quoteBtn' || b.closest('#quotePicker')) return;
    e.preventDefault();
    applyCommand(b.dataset.cmd, b.dataset.val);
    if(typeof window.closeAllEditorDropdowns === 'function') window.closeAllEditorDropdowns();
  };
  // Preserve editor selection before dropdown triggers receive focus. Pointerdown
  // covers mouse, pen, and touch; mousedown prevention keeps desktop selection visible.
  document.getElementById('formatBar').addEventListener('pointerdown', e=>{
    if(e.target.closest('button,[role="menuitem"]')){
      window.captureEditorFormattingSelection?.();
    }
  }, true);
  document.getElementById('formatBar').addEventListener('mousedown', e=>{
    if(e.target.closest('input')) return;
    if(e.detail !== 0) e.preventDefault();
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

    // 1b. Clean raw CSS declarations prepended by AI engines (e.g. "a { text-decoration: none; ... }")
    const cssHeaderRegex = /^\s*a\s*\{[^}]*\}\s*(?:tr\s*th[^}]*\}\s*)*/i;
    const walker = doc.createTreeWalker(doc.body, 4); // SHOW_TEXT
    let firstNode = walker.nextNode();
    if (firstNode && cssHeaderRegex.test(firstNode.textContent)) {
      firstNode.textContent = firstNode.textContent.replace(cssHeaderRegex, '');
    }

    // 1c. Parse unrendered inline markdown inside AI paragraph nodes
    doc.querySelectorAll('p, li, span, td').forEach(node => {
      const hasOnlyBRs = Array.from(node.children).every(c => c.tagName === 'BR');
      if (hasOnlyBRs && (node.textContent.includes('**') || node.textContent.includes('['))) {
        const raw = node.innerHTML;
        const parsed = parseMarkdownInline(raw);
        node.innerHTML = parsed;
      }
    });
    // 2. Remove dangerous or non-semantic tags
    doc.querySelectorAll('script, style, meta, link, iframe, object, embed, o\\:p').forEach(el => el.remove());

    // 3. Normalize AI List Items & Markdown Task Markers (e.g. <li>[ ] Task</li> or <li>- [x] Task</li>)
    doc.querySelectorAll('li').forEach(li => {
      const ps = Array.from(li.querySelectorAll('p'));
      if(ps.length > 0){
        li.innerHTML = ps.map(p => p.innerHTML).join('<br>');
      }
      // Check for existing checkbox input
      const cbInput = li.querySelector(':scope > input[type="checkbox"]');
      if(cbInput){
        li.setAttribute('data-task', '1');
        if(li.parentElement) li.parentElement.classList.add('task-list');
        if(cbInput.checked) cbInput.setAttribute('checked', '');
        return;
      }
      // Intercept text node patterns: - [ ], * [x], [ ], [X]
      const textMatch = li.textContent.match(/^\s*(?:[-*+]\s*|\d+\.\s*)?\[([ xX])\]\s*/);
      if(textMatch){
        const isChecked = textMatch[1].toLowerCase() === 'x';
        // Strip the [ ] or [x] prefix marker
        const taskRegex = /^\s*(?:[-*+]\s*|\d+\.\s*)?\[([ xX])\]\s*/;
        const walker = doc.createTreeWalker(li, NodeFilter.SHOW_TEXT);
        const firstText = walker.nextNode();
        if(firstText){
          firstText.textContent = firstText.textContent.replace(taskRegex, '');
        }
        li.setAttribute('data-task', '1');
        if(li.parentElement) li.parentElement.classList.add('task-list');
        const cb = doc.createElement('input');
        cb.type = 'checkbox';
        if(isChecked){
          cb.checked = true;
          cb.setAttribute('checked', '');
        }
        li.insertBefore(cb, li.firstChild);
        if(!cb.nextSibling) li.appendChild(doc.createTextNode(' '));
        else if(cb.nextSibling.nodeType === 3 && !cb.nextSibling.textContent.startsWith(' ')){
          cb.nextSibling.textContent = ' ' + cb.nextSibling.textContent;
        }
      }
    });

    // 3b. Intercept paragraph/div blocks starting with Markdown tasks: e.g. <p>- [ ] Task 1</p>
    const blockTaskRegex = /^\s*(?:[-*+]\s*|\d+\.\s*)?\[([ xX])\]\s*/;
    doc.querySelectorAll('p, div').forEach(blk => {
      if(blk.querySelector('ul, ol, table')) return;
      const text = blk.textContent;
      const match = text.match(blockTaskRegex);
      if(match){
        const isChecked = match[1].toLowerCase() === 'x';
        const cleanHTML = blk.innerHTML.replace(blockTaskRegex, '');
        const li = doc.createElement('li');
        li.setAttribute('data-task', '1');
        const cb = doc.createElement('input');
        cb.type = 'checkbox';
        if(isChecked){
          cb.checked = true;
          cb.setAttribute('checked', '');
        }
        li.appendChild(cb);
        li.appendChild(doc.createTextNode(' '));
        const temp = doc.createElement('span');
        temp.innerHTML = cleanHTML;
        while(temp.firstChild) li.appendChild(temp.firstChild);

        const ul = doc.createElement('ul');
        ul.className = 'task-list';
        ul.appendChild(li);
        blk.replaceWith(ul);
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


function parseMarkdownInline(text) {
  if (!text) return '';
  let str = String(text);

  const codeSpans = [];
  str = str.replace(/`([^`]+)`/g, (_, code) => {
    const idx = codeSpans.length;
    codeSpans.push(`<code>${esc(code)}</code>`);
    return `\uE000C${idx}\uE000`;
  });

  const imageSpans = [];
  str = str.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, (_, alt, url) => {
    const idx = imageSpans.length;
    const res = window.LinkParser ? window.LinkParser.parseAndValidateUrl(url) : { valid: true, url: url };
    const src = res.valid ? res.url : url;
    imageSpans.push(`<img src="${esc(src)}" alt="${esc(alt)}">`);
    return `\uE000I${idx}\uE000`;
  });

  const linkSpans = [];
  str = str.replace(/\[((?:\\[\[\]]|[^\]])+)\]?\(([^)]+)\)/g, (_, rawTitle, url) => {
    const title = rawTitle.replace(/\\([\[\]])/g, '$1').replace(/^\[|\]$/g, '');
    const idx = linkSpans.length;
    const res = window.LinkParser ? window.LinkParser.parseAndValidateUrl(url) : { valid: true, url: url, isExternal: true };
    const targetAttr = (res.isExternal || !res.url.startsWith('#')) ? ' target="_blank" rel="noopener noreferrer"' : '';
    const href = res.valid ? res.url : url;
    const renderedTitle = parseMarkdownInline(title);
    linkSpans.push(`<a href="${esc(href)}"${targetAttr}>${renderedTitle}</a>`);
    return `\uE000L${idx}\uE000`;
  });

  str = esc(str);

  str = str.replace(/\*\*\*([^*]+)\*\*\*/g, '<strong><em>$1</em></strong>');
  str = str.replace(/___([^_]+)___/g, '<strong><em>$1</em></strong>');
  str = str.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  str = str.replace(/__([^_]+)__/g, '<strong>$1</strong>');
  str = str.replace(/(?<!\*)\*([^*]+)\*(?!\*)/g, '<em>$1</em>');
  str = str.replace(/(?<!_)_([^_]+)_(?!_)/g, '<em>$1</em>');
  str = str.replace(/~~([^~]+)~~/g, '<del>$1</del>');
  str = str.replace(/==([^=]+)==/g, '<mark>$1</mark>');

  str = str.replace(/\uE000L(\d+)\uE000/g, (_, idx) => linkSpans[+idx] || '');
  str = str.replace(/\uE000I(\d+)\uE000/g, (_, idx) => imageSpans[+idx] || '');
  str = str.replace(/\uE000C(\d+)\uE000/g, (_, idx) => codeSpans[+idx] || '');

  return str;
}

function parseMarkdownToPaperussHTML(markdown) {
  if (!markdown || !String(markdown).trim()) return '';
  const lines = String(markdown).replace(/\r\n?/g, '\n').split('\n');

  let html = '';
  let inList = null;
  let inCodeBlock = false;
  let codeBuffer = [];
  let inTable = false;
  let tableRows = [];

  const closeList = () => {
    if (inList) {
      html += inList === 'ol' ? '</ol>' : '</ul>';
      inList = null;
    }
  };

  const closeTable = () => {
    if (inTable && tableRows.length > 0) {
      let tHtml = '<table class="note-table"><thead>';
      tableRows.forEach((row, rIdx) => {
        if (rIdx === 1 && row.every(cell => /^:?-+:?$/.test(cell.trim()))) return;
        const tag = rIdx === 0 ? 'th' : 'td';
        if (rIdx === 1) tHtml += '</thead><tbody>';
        tHtml += '<tr>';
        row.forEach(cell => {
          tHtml += `<${tag}>${parseMarkdownInline(cell.trim())}</${tag}>`;
        });
        tHtml += '</tr>';
      });
      if (tableRows.length > 1) tHtml += '</tbody>';
      tHtml += '</table>';
      html += tHtml;
      tableRows = [];
      inTable = false;
    }
  };

  for (let i = 0; i < lines.length; i++) {
    const rawLine = lines[i];
    const line = rawLine.trim();

    if (/^```/.test(line)) {
      if (inCodeBlock) {
        closeList(); closeTable();
        html += `<pre><code>${esc(codeBuffer.join('\n'))}</code></pre>`;
        codeBuffer = [];
        inCodeBlock = false;
      } else {
        closeList(); closeTable();
        inCodeBlock = true;
        codeBuffer = [];
      }
      continue;
    }

    if (inCodeBlock) {
      codeBuffer.push(rawLine);
      continue;
    }

    if (/^\|.*\|$/.test(line)) {
      closeList();
      const cells = line.slice(1, -1).split('|');
      tableRows.push(cells);
      inTable = true;
      continue;
    } else if (inTable) {
      closeTable();
    }

    if (!line) {
      closeList(); closeTable();
      continue;
    }

    if (/^(?:---|\*\*\*|___)$/.test(line)) {
      closeList(); closeTable();
      html += '<hr>';
      continue;
    }

    const headingMatch = line.match(/^(#{1,6})\s+(.+)$/);
    if (headingMatch) {
      closeList(); closeTable();
      const level = Math.min(headingMatch[1].length, 6);
      const tag = `h${level}`;
      html += `<${tag}>${parseMarkdownInline(headingMatch[2])}</${tag}>`;
      continue;
    }

    const calloutMatch = line.match(/^>\s*\[!(TIP|WARNING|SUMMARY|INFO|NOTE|DANGER|CAUTION)\]\s*(.*)$/i) || line.match(/^!(tip|warning|summary|info|note|danger|caution)\s*(.*)$/i);
    if (calloutMatch) {
      closeList(); closeTable();
      const type = calloutMatch[1].toLowerCase();
      const text = calloutMatch[2];
      const iconMap = { tip: '💡', warning: '⚠️', summary: '📋', info: 'ℹ️', note: '📌', danger: '🚨', caution: '⚠️' };
      const title = type.toUpperCase();
      html += `<div class="callout callout-${type}" contenteditable="true" data-callout="${type}">
        <div class="callout-title">${iconMap[type] || '📌'} ${title}</div>
        <div class="callout-body">${parseMarkdownInline(text)}</div>
      </div>`;
      continue;
    }

    const quoteMatch = line.match(/^>\s*(.+)$/);
    if (quoteMatch) {
      closeList(); closeTable();
      html += `<blockquote>${parseMarkdownInline(quoteMatch[1])}</blockquote>`;
      continue;
    }

    const taskMatch = line.match(/^(?:[-*+]\s*|\d+[.)]\s*)?\[([ xX])\]\s*(.*)$/);
    if (taskMatch) {
      closeTable();
      if (inList !== 'task') {
        closeList();
        html += '<ul class="task-list">';
        inList = 'task';
      }
      const isChecked = taskMatch[1].toLowerCase() === 'x';
      const checkedAttr = isChecked ? ' checked=""' : '';
      html += `<li data-task="1"><input type="checkbox"${checkedAttr}> ${parseMarkdownInline(taskMatch[2])}</li>`;
      continue;
    }

    const bulletMatch = line.match(/^[-*+]\s+(.+)$/);
    if (bulletMatch) {
      closeTable();
      if (inList !== 'ul') {
        closeList();
        html += '<ul>';
        inList = 'ul';
      }
      html += `<li>${parseMarkdownInline(bulletMatch[1])}</li>`;
      continue;
    }

    const orderedMatch = line.match(/^\d+[.)]\s+(.+)$/);
    if (orderedMatch) {
      closeTable();
      if (inList !== 'ol') {
        closeList();
        html += '<ol>';
        inList = 'ol';
      }
      html += `<li>${parseMarkdownInline(orderedMatch[1])}</li>`;
      continue;
    }

    closeList(); closeTable();
    html += `<p>${parseMarkdownInline(line)}</p>`;
  }

  if (inCodeBlock) {
    html += `<pre><code>${esc(codeBuffer.join('\n'))}</code></pre>`;
  }
  closeList();
  closeTable();

  return html;
}

function isMarkdownText(text) {
  if (!text || typeof text !== 'string') return false;
  const str = text.trim();
  if (!str) return false;
  return /^[ \t]*#{1,6}\s+/m.test(str) ||
         /^[ \t]*(?:[-*+]\s*|\d+[.)]\s*)?\[[ xX]\]/m.test(str) ||
         /^[ \t]*(?:[-*+]\s+|\d+[.)]\s+)/m.test(str) ||
         /^[ \t]*>\s+/m.test(str) ||
         /```/.test(str) ||
         /^[ \t]*(?:---|\*\*\*|___)[ \t]*$/m.test(str) ||
         /\*\*[^\*\s][^\*]*\*\*|~~[^~\s][^~]*~~|`[^`]+`|\[[^\]]+\]\([^)]+\)|!\[[^\]]*\]\([^)]+\)|==[^=]+==/.test(str) ||
         /^\|.*\|$/m.test(str);
}

function isSingleStandaloneUrl(str) {
  if (!str || typeof str !== 'string') return false;
  let trimmed = str.trim();
  const iframeMatch = trimmed.match(/^<iframe[^>]+src=["']([^"']+)["']/i);
  if (iframeMatch && iframeMatch[1]) {
    trimmed = iframeMatch[1];
  }
  if (/\s/.test(trimmed) && !iframeMatch) return false;
  if (window.LinkParser) {
    const res = window.LinkParser.parseAndValidateUrl(trimmed);
    return res.valid && (res.protocol === 'http:' || res.protocol === 'https:');
  }
  return /^https?:\/\/[^\s]+$/i.test(trimmed);
}

  // Paste images, spreadsheet tables, or clean formatted HTML from clipboard
  edEl.addEventListener('paste', e=>{
    if (window.ProductivityClipboard && window.ProductivityClipboard.handlePaste(e)) {
        return;
    }
    if(!e.clipboardData) return;
    const items=e.clipboardData.items||[];
    for(const it of items){
      if(it.kind==='file'){
        const f=it.getAsFile();
        if(f && f.type.startsWith('image/')){ e.preventDefault(); insertImageFile(f); return; }
      }
    }
    const text = e.clipboardData.getData('text/plain');

    // Single-Link Paste Interception: automatically open unified embed modal for single URLs
    if (text && isSingleStandaloneUrl(text)) {
      e.preventDefault();
      if (typeof window.openEmbedModal === 'function') {
        window.openEmbedModal({ initialUrl: text.trim() });
      }
      return;
    }
    if(text && /\t/.test(text) && /\n/.test(text)){
      const tableHtml = tsvToPaperussTable(text);
      if(tableHtml){
        e.preventDefault();
        document.execCommand('insertHTML', false, tableHtml);
        setTimeout(handleBodyInput, 0);
        return;
      }
    }
    if(text && isMarkdownText(text)){
      const markdownHTML = parseMarkdownToPaperussHTML(text);
      if(markdownHTML){
        e.preventDefault();
        document.execCommand('insertHTML', false, markdownHTML);
        showPasteAsPlainTextChip(text);
        setTimeout(handleBodyInput, 0);
        return;
      }
    }

    const html = e.clipboardData.getData('text/html');
    if(html){
      e.preventDefault();
      const doc = new DOMParser().parseFromString(html, 'text/html');
      normalizeAIPasteHTML(doc);
      const cleanHTML = typeof sanitizeNoteHTML==='function'?sanitizeNoteHTML(doc.body.innerHTML):doc.body.innerHTML;
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
  document.getElementById('importFile').onchange=e=>{
    const f=e.target.files[0];
    if(f){
      if(typeof importSelectedFile==='function') {
        importSelectedFile(f);
      } else {
        importNotes(f);
      }
    }
    e.target.value='';
  };

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
  const profileExportDocxActiveBtn=document.getElementById('profileExportDocxActiveBtn');
  const profileExportDocxAllBtn=document.getElementById('profileExportDocxAllBtn');
  if(profileExportDocxActiveBtn) profileExportDocxActiveBtn.onclick=()=>{
    closeProfilePanel();
    if(typeof window.exportDocx==='function') window.exportDocx('active');
  };
  if(profileExportDocxAllBtn) profileExportDocxAllBtn.onclick=()=>{
    closeProfilePanel();
    if(typeof window.exportDocx==='function') window.exportDocx('all');
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
  const backBtnEl = document.getElementById('backBtn');
  if(backBtnEl){
    backBtnEl.onclick = () => {
      toggleNoteListPanel();
    };
  }

  // Note-list tablet panel toggle
  const listToggleBtn = document.getElementById('noteListToggle');
  if(listToggleBtn){
    listToggleBtn.onclick = () => {
      toggleNoteListPanel();
    };
  }

  // Resizer logic
  const resizer = document.getElementById('noteListResizer');
  if(resizer) {
    let isResizing = false;
    let startX = 0;
    let startWidth = 0;
    const listEl = document.getElementById('noteList');

    resizer.addEventListener('mousedown', e => {
      isResizing = true;
      startX = e.clientX;
      startWidth = listEl.getBoundingClientRect().width;
      resizer.classList.add('dragging');
      document.body.style.cursor = 'col-resize';
      document.body.style.userSelect = 'none';
    });

    window.addEventListener('mousemove', e => {
      if (!isResizing) return;
      const dx = e.clientX - startX;
      let newWidth = startWidth + dx;
      if (newWidth < 220) newWidth = 220;
      if (newWidth > 600) newWidth = 600;
      document.documentElement.style.setProperty('--list-width', `${newWidth}px`);
    });

    window.addEventListener('mouseup', () => {
      if (isResizing) {
        isResizing = false;
        resizer.classList.remove('dragging');
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
        // optionally save width to localStorage
        localStorage.setItem('octonotes:listWidth', document.documentElement.style.getPropertyValue('--list-width'));
      }
    });
    
    // Restore saved width
    const savedWidth = localStorage.getItem('octonotes:listWidth');
    if(savedWidth) document.documentElement.style.setProperty('--list-width', savedWidth);

    // Restore collapsed state (desktop / landscape only)
    const savedCollapsed = localStorage.getItem('octonotes:listCollapsed');
    if(savedCollapsed === '1' && window.innerWidth > 900){
      const listEl2 = document.getElementById('noteList');
      const iconEl2 = document.getElementById('backBtnIcon');
      const backBtn2 = document.getElementById('backBtn');
      const toggleBtn2 = document.getElementById('noteListToggle');
      if(listEl2) listEl2.classList.add('collapsed');
      if(iconEl2) iconEl2.setAttribute('data-lucide', 'panel-left-open');
      const collLabel = 'Show note list';
      if(backBtn2){
        backBtn2.title = collLabel;
        backBtn2.setAttribute('aria-expanded', 'false');
        backBtn2.setAttribute('aria-label', collLabel);
      }
      if(toggleBtn2){
        toggleBtn2.title = collLabel;
        toggleBtn2.setAttribute('aria-expanded', 'false');
        toggleBtn2.setAttribute('aria-label', collLabel);
      }
      if(typeof refreshIcons === 'function') setTimeout(refreshIcons, 0);
    }
  }

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
  const fsBtn = document.getElementById('fontStyleBtn');
  if (fsBtn) {
    fsBtn.onclick = e => { e.stopPropagation(); toggleDropdown('fontStyleDropdown'); };
  }

  const fsDrop = document.getElementById('fontStyleDropdown');
  if (fsDrop) {
    fsDrop.onclick = e => {
      const opt = e.target.closest('[data-fontstyle]'); if (!opt) return;
      e.preventDefault();
      e.stopPropagation();
      window.restoreEditorFormattingSelection?.();
      if (typeof window.closeAllEditorDropdowns === 'function') window.closeAllEditorDropdowns();
      applyFontStyle(opt.dataset.fontstyle);
      window.captureEditorFormattingSelection?.();
    };
  }

  /* ---------- LINE SPACING PICKER ---------- */
  const lsBtn=document.getElementById('lineSpacingBtn');
  if(lsBtn) lsBtn.onclick=e=>{ e.stopPropagation(); toggleDropdown('lineSpacingDropdown'); };
  const lsDrop=document.getElementById('lineSpacingDropdown');
  if(lsDrop) lsDrop.onclick=e=>{
    const opt=e.target.closest('[data-spacing]'); if(!opt) return;
    lsDrop.classList.remove('show');
    if(typeof applyLineSpacing === 'function') applyLineSpacing(opt.dataset.spacing);
  };

  /* ---------- QUOTE STYLE PICKER ---------- */
  let activeQuoteForPicker = null;
  const qBtn = document.getElementById('quoteBtn');
  if (qBtn) qBtn.onclick = e => {
    e.preventDefault();
    e.stopPropagation();
    window.restoreEditorFormattingSelection?.();
    activeQuoteForPicker = typeof window.resolveQuoteForFormatting === 'function'
      ? window.resolveQuoteForFormatting(null, false)
      : null;
    window.styleQuotePresetMenu?.(activeQuoteForPicker?.dataset.quoteStyle || '');
    window.captureEditorFormattingSelection?.();
    toggleDropdown('quoteStyleDropdown');
  };
  const qDrop = document.getElementById('quoteStyleDropdown');
  if (qDrop) {
    qDrop.onclick = e => {
      const opt = e.target.closest('[data-qstyle]');
      if (!opt) return;
      e.preventDefault();
      e.stopPropagation();
      window.restoreEditorFormattingSelection?.();
      if (typeof window.closeAllEditorDropdowns === 'function') window.closeAllEditorDropdowns();
      const style = opt.dataset.qstyle;

      const ed = bodyEl();
      const sel = window.getSelection();
      let bq = activeQuoteForPicker?.isConnected ? activeQuoteForPicker : null;
      if (sel && sel.anchorNode && ed && ed.contains(sel.anchorNode)) {
        let node = sel.anchorNode;
        if (node.nodeType === 3) node = node.parentElement;
        bq = (node.closest && node.closest('blockquote')) || bq;
      }

      if (style === 'clear') {
        if (typeof window.clearQuoteFormatting === 'function' && !window.clearQuoteFormatting(bq) && typeof toast === 'function') {
          toast('Place the cursor inside a quote to clear it');
        }
      } else if (typeof window.applyQuotePresetStyle === 'function') {
        window.applyQuotePresetStyle(style, bq, true);
      }
      activeQuoteForPicker = null;
      window.captureEditorFormattingSelection?.();
    };
  }

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
    if((e.ctrlKey||e.metaKey) && e.key.toLowerCase()==='p'){
      e.preventDefault();
      if(typeof openPrintModal === 'function') openPrintModal();
      else if(typeof printCurrentNote === 'function') printCurrentNote();
    }
    if(e.key==='Escape'){ document.getElementById('modalRoot').innerHTML=''; document.getElementById('searchInput').blur(); }
    if(e.key==='F11'){
      e.preventDefault();
      toggleDistractionFree();
    }
  });

  const dfBtn = document.getElementById('distractionFreeBtn');
  if(dfBtn) dfBtn.onclick = toggleDistractionFree;

  function toggleDistractionFree() {
    const isDf = document.body.classList.toggle('distraction-free');
    const icon = document.getElementById('distractionFreeIcon');
    if(icon) {
      icon.setAttribute('data-lucide', isDf ? 'minimize' : 'maximize');
      refreshIcons();
    }
    toast(isDf ? 'Distraction-free mode on (F11 to exit)' : 'Distraction-free mode off');
    if(typeof window.recalculateToolbarOverflow === 'function') setTimeout(window.recalculateToolbarOverflow, 150);
  }

  document.addEventListener('selectionchange', ()=>{
    const active = document.activeElement;
    if(active===bodyEl() || active?.matches?.('[data-header-field], [data-footer-field]')) updateToolbarState();
  });

  // Paragraph Style dropdown
  const paraStyleBtn = document.getElementById('paraStyleBtn');
  if(paraStyleBtn) paraStyleBtn.onclick=e=>{ e.stopPropagation(); toggleDropdown('paraStyleDropdown'); };
  const paraStyleDropdown = document.getElementById('paraStyleDropdown');
  if(paraStyleDropdown) paraStyleDropdown.onclick=e=>{
    const opt=e.target.closest('[data-cmd]');
    if(!opt) return;
    e.preventDefault();
    e.stopPropagation();
    window.restoreEditorFormattingSelection?.();
    paraStyleDropdown.classList.remove('show');
    applyCommand(opt.dataset.cmd, opt.dataset.val);
    window.captureEditorFormattingSelection?.();
  };

  // Highlight dropdown
  document.getElementById('hlBtn').onclick=e=>{ e.stopPropagation(); toggleDropdown('hlDropdown'); };
  document.getElementById('hlDropdown').onclick=e=>{
    const sw=e.target.closest('[data-cmd]');
    if(!sw) return;
    document.getElementById('hlDropdown').classList.remove('show');
    applyCommand(sw.dataset.cmd, sw.dataset.val);
  };

  // Text Color dropdown
  document.getElementById('tcBtn').onclick=e=>{ e.stopPropagation(); toggleDropdown('tcDropdown'); };
  document.getElementById('tcDropdown').onclick=e=>{
    const sw=e.target.closest('[data-cmd]');
    if(!sw) return;
    document.getElementById('tcDropdown').classList.remove('show');
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

  // Templates dropdown
  const tplBtn = document.getElementById('templateBtn');
  if(tplBtn) tplBtn.onclick = e => { e.stopPropagation(); toggleDropdown('templateDropdown'); };
  const tplDrop = document.getElementById('templateDropdown');
  if(tplDrop) tplDrop.onclick = e => {
    const opt = e.target.closest('[data-tpl]');
    if(!opt) return;
    if(typeof window.closeAllEditorDropdowns === 'function') window.closeAllEditorDropdowns();
    if(typeof insertFinancialTemplate === 'function') insertFinancialTemplate(opt.dataset.tpl);
    if(tplBtn) tplBtn.focus();
  };

  // Footer Tags dropdown
  const tagsBtn = document.getElementById('footerTagsBtn');
  if(tagsBtn) tagsBtn.onclick = e => { e.stopPropagation(); toggleDropdown('footerTagsDropdown'); };

  // Overflow Menu dropdown
  const ovfBtn = document.getElementById('overflowBtn');
  if(ovfBtn) {
    ovfBtn.addEventListener('mousedown', e => {
      if(e.detail !== 0) e.preventDefault();
    });
    ovfBtn.addEventListener('click', e => {
      e.stopPropagation();
      if(!ovfBtn.disabled && typeof toggleDropdown === 'function'){
        toggleDropdown('overflowDropdown');
      }
    });
  }

  // Responsive Toolbar Overflow
  window.recalculateToolbarOverflow = function() {
    const scrollBar = document.getElementById('formatBar');
    const overflowDropdown = document.getElementById('overflowDropdown');
    const overflowPicker = document.getElementById('overflowPicker');
    const overflowBtn = document.getElementById('overflowBtn');
    if(!scrollBar || !overflowDropdown || !overflowPicker || !overflowBtn) return;
    
    while(overflowDropdown.children.length > 0) {
      scrollBar.insertBefore(overflowDropdown.children[0], overflowPicker);
    }

    const movableTools = Array.from(scrollBar.children).filter(el => 
      el.id !== 'overflowPicker' && 
      el.id !== 'toolbarCollapseBtn' &&
      !el.classList.contains('para-style-picker') && 
      !el.classList.contains('font-style-picker')
    ).reverse();

    if(scrollBar.scrollWidth > scrollBar.clientWidth + 2) { 
      for(let el of movableTools) {
        if(el.parentElement === scrollBar) {
          overflowDropdown.insertBefore(el, overflowDropdown.firstChild);
          if(scrollBar.scrollWidth <= scrollBar.clientWidth + 2) break;
        }
      }
    }

    const hasOverflow = overflowDropdown.children.length > 0;
    if(hasOverflow) {
      overflowPicker.style.display = 'inline-flex';
      overflowBtn.disabled = false;
    } else {
      overflowPicker.style.display = 'none';
      overflowBtn.disabled = true;
      overflowBtn.setAttribute('aria-expanded', 'false');
      overflowDropdown.classList.remove('show');
    }
  };

  function initResponsiveToolbar() {
    const scrollBar = document.getElementById('formatBar');
    if(!scrollBar) return;
    const resizeObserver = new ResizeObserver(() => {
      requestAnimationFrame(() => {
        if(typeof window.recalculateToolbarOverflow === 'function') window.recalculateToolbarOverflow();
      });
    });
    resizeObserver.observe(scrollBar);
    const editorScroll = document.getElementById('editorScroll');
    if(editorScroll) resizeObserver.observe(editorScroll);
    const mainArea = document.querySelector('.main-area');
    if(mainArea) resizeObserver.observe(mainArea);
    window.addEventListener('resize', () => requestAnimationFrame(window.recalculateToolbarOverflow));
    window.addEventListener('orientationchange', () => setTimeout(window.recalculateToolbarOverflow, 150));
  }
  
  setTimeout(() => {
    initResponsiveToolbar();
    if(typeof window.recalculateToolbarOverflow === 'function') window.recalculateToolbarOverflow();
  }, 100);


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
        if(url && (typeof paperussSafeUrl!=='function' || paperussSafeUrl(url,'href','A'))) window.open(url, '_blank','noopener,noreferrer');
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
  window.closeAllEditorDropdowns = () => {
    ['tcDropdown','paraStyleDropdown','hlDropdown','szDropdown','fontStyleDropdown','lineSpacingDropdown','quoteStyleDropdown','tableGridPicker','pageLayoutDropdown','templateDropdown','footerTagsDropdown','overflowDropdown'].forEach(id=>{
      const el=document.getElementById(id);
      if(el && el.classList.contains('show')){
        el.classList.remove('show');
        el.style.position=''; el.style.top=''; el.style.left='';
        el.style.right=''; el.style.zIndex=''; el.style.maxHeight=''; el.style.overflowY='';
      }
    });
    ['tcBtn','paraStyleBtn','hlBtn','szBtn','fontStyleBtn','lineSpacingBtn','quoteBtn','tableBtn','pageLayoutBtn','templateBtn','footerTagsBtn','overflowBtn'].forEach(id=>{
      const btn=document.getElementById(id);
      if(btn) btn.setAttribute('aria-expanded', 'false');
    });
    if(notifPanel) notifPanel.classList.remove('show');
  };
  const closeAllDropdowns = window.closeAllEditorDropdowns;
  document.addEventListener('click', e=>{
    if(!e.target.closest('#tcPicker') && !e.target.closest('#paraStylePicker') && !e.target.closest('#hlPicker') && !e.target.closest('.sz-picker')
      && !e.target.closest('#fontStylePicker') && !e.target.closest('#lineSpacingPicker') && !e.target.closest('#quotePicker') && !e.target.closest('#tablePicker')
      && !e.target.closest('#pageLayoutPicker') && !e.target.closest('#templatePicker')
      && !e.target.closest('#footerTagsPicker') && !e.target.closest('#overflowPicker')
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
  
  // init Page Layout defaults
  if(typeof initPageLayoutUI === 'function') initPageLayoutUI();

  // init Find in Note
  if(typeof initFindInNote === 'function') initFindInNote();

  // Zen Mode / Scroll-to-Hide Title Row, keeping Formatting Toolbar pinned
  const scrollEl = document.getElementById('editorScroll');
  const editorContent = document.getElementById('editorContent');
  const topbar = document.querySelector('.editor-topbar');

  if (scrollEl && editorContent) {
    let lastScrollTop = 0;
    let ignoreUntil = 0;
    scrollEl.addEventListener('scroll', () => {
      const scrollTop = scrollEl.scrollTop;
      const now = Date.now();

      // Re-engage: Always show Title Row when at or near the absolute top
      if (scrollTop <= 20) {
        editorContent.classList.remove('hide-title-row');
        if (topbar) topbar.classList.remove('hide-title-row', 'topbar-hidden');
        lastScrollTop = scrollTop;
        return;
      }

      // If we are currently ignoring scroll changes (during transition), just update baseline
      if (now < ignoreUntil) {
        lastScrollTop = scrollTop;
        return;
      }

      // Hysteresis buffer (8px) to prevent scroll jitter
      if (Math.abs(scrollTop - lastScrollTop) < 8) return;

      // Scroll Down -> apply negative margin collapse to Title Row
      if (scrollTop > lastScrollTop && scrollTop > 40) {
        if (!editorContent.classList.contains('hide-title-row')) {
          editorContent.classList.add('hide-title-row');
          if (topbar) topbar.classList.add('hide-title-row', 'topbar-hidden');
          ignoreUntil = now + 400; // ignore layout-shift induced scroll events during transition
        }
      } else if (scrollTop < lastScrollTop) {
        // Scroll Up -> restore Title Row
        if (editorContent.classList.contains('hide-title-row')) {
          editorContent.classList.remove('hide-title-row');
          if (topbar) topbar.classList.remove('hide-title-row', 'topbar-hidden');
          ignoreUntil = now + 400;
        }
      }

      lastScrollTop = scrollTop;
    }, { passive: true });
  }

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
  if(typeof rescheduleAllEventNotifications==='function') rescheduleAllEventNotifications();
  const urlParams = new URLSearchParams(window.location.search);
  const targetNoteId = urlParams.get('noteId');
  const targetLeafId = urlParams.get('leafId');
  if (targetNoteId && getNote(targetNoteId)) {
    state.currentId = targetNoteId;
  } else {
    state.currentId = filteredNotes()[0]?.id || null;
  }
  renderAll();
  if (targetNoteId && targetLeafId && typeof switchLeafAction === 'function') {
    setTimeout(() => { switchLeafAction(targetLeafId); }, 100);
  }
  if (window.paperussLeaves && typeof window.paperussLeaves.repairContaminatedLeavesOnce === 'function') {
    window.paperussLeaves.repairContaminatedLeavesOnce().then((repaired) => {
      if (repaired > 0 && typeof renderEditor === 'function') renderEditor();
    }).catch(e => console.error('Leaf recovery check error:', e));
  }
  updateNotifBar();
  updateNotifBadge();
  startReminderWatcher();
  if(typeof checkIncomingSharedData === 'function') setTimeout(checkIncomingSharedData, 300);
  if('launchQueue' in window){
    window.launchQueue.setConsumer(async (launchParams)=>{
      if(!launchParams.files || !launchParams.files.length) return;
      for(const handle of launchParams.files){
        try{
          const file = await handle.getFile();
          const text = await file.text();
          if(typeof createNoteFromSharedData === 'function'){
            createNoteFromSharedData({ title: file.name.replace(/\.[^/.]+$/, ""), text: text });
          }
        }catch(e){ console.error('Launch file error:', e); }
      }
    });
  }
  if(typeof checkWhatsNewAutoPopup === 'function') setTimeout(checkWhatsNewAutoPopup, 1500);
  document.querySelectorAll('[data-cmd="task"]').forEach(btn => {
    btn.setAttribute('title', 'Checklist');
    btn.setAttribute('aria-label', 'Checklist');
  });
})();
