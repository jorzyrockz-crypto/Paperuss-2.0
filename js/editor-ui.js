/* ============================================================
   SYSTEM FONT STYLING
   ============================================================ */
function applyFontStyle(fontStyle){
  const n=getNote(state.currentId);
  if(n){
    n.fontStyle = fontStyle;
    n.updatedAt = Date.now();
    save();
  }
  const ed=bodyEl();
  if(ed){
    ed.setAttribute('data-fontstyle', fontStyle);
  }
  const fsLabel=document.getElementById('fontStyleLabel');
  const fsMap={'sans':'Sans', 'serif':'Serif', 'mono':'Mono', 'rounded':'Rounded'};
  if(fsLabel) fsLabel.textContent = fsMap[fontStyle] || 'Sans';
  document.querySelectorAll('#fontStyleDropdown .fs-opt').forEach(opt=>{
    opt.classList.toggle('active', opt.dataset.fontstyle === fontStyle);
  });

  // Also if text is selected inside the editor, wrap selection in font-family span
  const sel=window.getSelection();
  if(sel && sel.rangeCount && !sel.isCollapsed && ed.contains(sel.anchorNode)){
    const fontsMap={
      'sans':'"Inter", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
      'serif':'Georgia, "Times New Roman", serif',
      'mono':'ui-monospace, SFMono-Regular, Menlo, monospace',
      'rounded':'"SF Pro Rounded", "Quicksand", system-ui, -apple-system, sans-serif'
    };
    wrapSelectionInSpan({fontFamily: fontsMap[fontStyle]});
  }
  toast(`Font set to ${fsMap[fontStyle]}`);
}

/* ============================================================
   MODULAR BLOCK GUTTER & COMMAND MENU
   ============================================================ */
let activeGutterBlock = null;

function initBlockTools(){
  const ed=bodyEl();
  const scrollHost=document.getElementById('editorScroll')||ed;
  const gutter=document.getElementById('blockGutter');
  const slashMenu=document.getElementById('blockCommandMenu');
  if(!ed || !gutter) return;

  const blockSelector='p, h1, h2, h3, h4, ul, ol, blockquote, pre, .media-card, div[data-media-id]';
  let gutterHideTimer=null;
  const hideGutter=()=>{
    clearTimeout(gutterHideTimer);
    gutter.classList.remove('show');
  };
  const blockForNode=node=>{
    const element=node?.nodeType===Node.TEXT_NODE?node.parentElement:node;
    const block=element?.closest?.(blockSelector);
    return block && ed.contains(block) && block!==ed ? block : null;
  };
  const showGutterForBlock=block=>{
    if(!block || !block.isConnected) return;
    clearTimeout(gutterHideTimer);
    activeGutterBlock=block;
    // Fixed coordinates match getBoundingClientRect(), unlike offsetTop/Left
    // which change with editor scrolling and nested formatted content.
    gutter.classList.add('show');
    const rect=block.getBoundingClientRect();
    const gutterWidth=gutter.offsetWidth||60;
    const gutterHeight=gutter.offsetHeight||30;
    const left=Math.max(8,rect.left-gutterWidth-8);
    const top=Math.max(8,Math.min(rect.top+2,window.innerHeight-gutterHeight-8));
    gutter.style.left=`${Math.round(left)}px`;
    gutter.style.top=`${Math.round(top)}px`;
  };

  /* ---------- Auto-scroll state during drag ---------- */
  let autoScrollRaf=null;
  function stopAutoScroll(){ if(autoScrollRaf){ cancelAnimationFrame(autoScrollRaf); autoScrollRaf=null; } }
  function scheduleAutoScroll(clientY){
    stopAutoScroll();
    const scrollZone=56; // px from top/bottom edge
    const maxSpeed=14;   // px per frame
    const rect=scrollHost.getBoundingClientRect();
    const step=()=>{
      let dy=0;
      if(clientY < rect.top + scrollZone) dy=-(1-(clientY-rect.top)/scrollZone)*maxSpeed;
      else if(clientY > rect.bottom - scrollZone) dy=((clientY-(rect.bottom-scrollZone))/scrollZone)*maxSpeed;
      if(dy!==0) scrollHost.scrollTop+=dy;
      autoScrollRaf=requestAnimationFrame(step);
    };
    autoScrollRaf=requestAnimationFrame(step);
  }

  ed.addEventListener('pointermove', e=>showGutterForBlock(blockForNode(e.target)));
  ed.addEventListener('focusin', e=>showGutterForBlock(blockForNode(e.target)));
  ed.addEventListener('keyup', ()=>{
    const selection=window.getSelection();
    showGutterForBlock(blockForNode(selection?.anchorNode));
  });
  ed.addEventListener('pointerleave', ()=>{
    gutterHideTimer=setTimeout(()=>{ if(!gutter.matches(':hover')) hideGutter(); },150);
  });
  scrollHost.addEventListener('scroll',()=>{
    if(activeGutterBlock?.isConnected) showGutterForBlock(activeGutterBlock);
    else hideGutter();
  },{passive:true});
  gutter.addEventListener('pointerenter',()=>clearTimeout(gutterHideTimer));
  gutter.addEventListener('pointerleave',hideGutter);

  // Keep the insert-block menu inside the visible viewport. It flips above
  // the anchor near the bottom of a long document and remains scrollable.
  function positionSlashMenu(anchorRect){
    if(!slashMenu || !anchorRect) return;
    slashMenu.classList.add('show');
    const safe=12;
    const menuW=slashMenu.offsetWidth||230;
    const menuH=Math.min(slashMenu.offsetHeight||340,window.innerHeight-safe*2);
    let top=anchorRect.bottom+6;
    if(top+menuH>window.innerHeight-safe) top=Math.max(safe,anchorRect.top-menuH-6);
    const left=Math.max(safe,Math.min(anchorRect.left,window.innerWidth-menuW-safe));
    slashMenu.style.top=`${Math.round(top)}px`;
    slashMenu.style.left=`${Math.round(left)}px`;
  }

  /* ---------- "+" insert button ---------- */
  const addBtn=document.getElementById('blockAddButton');
  if(addBtn){
    addBtn.onclick=e=>{
      e.stopPropagation();
      if(!activeGutterBlock) return;
      const rect=activeGutterBlock.getBoundingClientRect();
      positionSlashMenu(rect);
    };
  }

  /* ---------- Drag & drop block rearrangement ---------- */
  const dragHandle=document.getElementById('blockDragHandle');
  let dropIndicator=null;
  let directDraggedMedia = null;

  if(dragHandle){
    dragHandle.addEventListener('dragstart', e=>{
      if(!activeGutterBlock) return;
      e.dataTransfer.setData('text/plain', 'modular-block-drag');
      activeGutterBlock.classList.add('opacity-50');
      dropIndicator=document.createElement('div');
      dropIndicator.className='block-drop-indicator';
      try{ e.dataTransfer.setDragImage(activeGutterBlock, 20, 20); }catch(_){}
    });
    dragHandle.addEventListener('dragend', ()=>{
      if(activeGutterBlock) activeGutterBlock.classList.remove('opacity-50');
      if(dropIndicator && dropIndicator.parentElement) dropIndicator.remove();
      dropIndicator=null; stopAutoScroll();
    });
  }

  // Allow direct grabbing of media elements anywhere on the block
  ed.addEventListener('pointerover', e=>{
    const mediaEl=e.target.closest('[data-media-id], .media-card, figure');
    if(mediaEl && !mediaEl.getAttribute('draggable')){
      mediaEl.setAttribute('draggable', 'true');
    }
  });

  ed.addEventListener('dragstart', e=>{
    const mediaEl=e.target.closest('[data-media-id], .media-card, figure');
    if(mediaEl && !e.dataTransfer.getData('text/plain')){
      directDraggedMedia = mediaEl;
      e.dataTransfer.setData('application/x-paperuss-media-move', '1');
      e.dataTransfer.effectAllowed = 'move';
      mediaEl.style.opacity = '0.5';
    }
  });

  ed.addEventListener('dragend', e=>{
    if(directDraggedMedia){
      directDraggedMedia.style.opacity = '';
      directDraggedMedia = null;
    }
  });

  ed.addEventListener('dragover', e=>{
    if(directDraggedMedia){
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      return;
    }
    if(!activeGutterBlock || !dropIndicator) return;
    e.preventDefault();
    scheduleAutoScroll(e.clientY);
    const overBlock=e.target.closest(blockSelector);
    if(overBlock && overBlock !== activeGutterBlock && ed.contains(overBlock)){
      const r=overBlock.getBoundingClientRect();
      const isBottom=(e.clientY - r.top) > (r.height / 2);
      if(isBottom) overBlock.parentElement.insertBefore(dropIndicator, overBlock.nextSibling);
      else overBlock.parentElement.insertBefore(dropIndicator, overBlock);
    }
  });

  ed.addEventListener('drop', e=>{
    if(directDraggedMedia){
      e.preventDefault();
      e.stopPropagation();
      let target = document.elementFromPoint(e.clientX, e.clientY);
      if(target && ed.contains(target)){
        const blockTarget = target.closest('p, div, h1, h2, h3, blockquote, table, figure, .media-card') || target;
        if(blockTarget && blockTarget !== directDraggedMedia){
          const rect = blockTarget.getBoundingClientRect();
          const midY = rect.top + rect.height / 2;
          if(e.clientY > midY) blockTarget.after(directDraggedMedia);
          else blockTarget.before(directDraggedMedia);
        }
      }
      directDraggedMedia.style.opacity = '';
      directDraggedMedia = null;
      handleBodyInput();
      save();
      return;
    }
    if(!activeGutterBlock || !dropIndicator) return;
    if(e.dataTransfer.getData('text/plain') === 'modular-block-drag'){
      e.preventDefault(); stopAutoScroll();
      if(dropIndicator.parentElement){
        dropIndicator.parentElement.insertBefore(activeGutterBlock, dropIndicator);
        dropIndicator.remove();
        handleBodyInput();
        addNotification({type:'edit',title:'Block rearranged',body:'A content block was moved.',icon:'grip-vertical'});
      }
    }
  });

  /* ---------- Slash "/" command ---------- */
  ed.addEventListener('keyup', e=>{
    if(e.key === '/'){
      const sel=window.getSelection();
      if(sel && sel.anchorNode){
        const node=sel.anchorNode;
        if(node.textContent.trim() === '/'){
          const r=sel.getRangeAt(0).getBoundingClientRect();
          positionSlashMenu(r);
        }
      }
    }
  });
}

function initSlashMenuActions(){
  const slashMenu=document.getElementById('blockCommandMenu');
  if(!slashMenu) return;

  slashMenu.onclick=e=>{
    const item=e.target.closest('[data-block-action]');
    if(!item) return;
    slashMenu.classList.remove('show');
    const cmd=item.dataset.blockAction;
    // Remove trailing '/' character if typed
    const sel=window.getSelection();
    if(sel && sel.anchorNode && sel.anchorNode.textContent.includes('/')){
      sel.anchorNode.textContent = sel.anchorNode.textContent.replace('/', '');
    }
    if(cmd==='h1'||cmd==='h2'||cmd==='h3'||cmd==='blockquote') applyCommand('formatBlock', cmd);
    else if(cmd==='ul') applyCommand('insertUnorderedList');
    else if(cmd==='ol') applyCommand('insertOrderedList');
    else if(cmd==='task') applyCommand('task');
    else if(cmd==='code') applyCommand('code');
    else if(cmd==='quote') applyCommand('formatBlock', 'blockquote');
    else if(cmd==='image'||cmd==='audio'||cmd==='video'||cmd==='link'||cmd==='file') handleMediaAction(cmd);
    else if(cmd==='calevent'){
      const today=new Date();
      openCalendarEventCreator(today.getFullYear(), today.getMonth(), today.getDate());
    }
    else if(cmd==='newtask'){
      openTaskCreatorModal();
    }
  };

  document.addEventListener('click', e=>{
    if(!e.target.closest('#blockCommandMenu') && !e.target.closest('#blockAddButton')){
      slashMenu.classList.remove('show');
    }
  });
}

/* ============================================================
   IMAGE / MEDIA CONTEXT MENU & LONG-PRESS
   ============================================================ */
function initImageContextMenu(){
  const menu=document.getElementById('imageContextMenu');
  const ed=bodyEl();
  if(!menu || !ed) return;

  function showContextMenuForMedia(mediaEl, x, y){
    state.selectedImageEl = mediaEl;
    const resizeBtn=document.getElementById('icmResize');
    const downloadBtn=document.getElementById('icmDownload');
    const openBtn=document.getElementById('icmOpenNew');
    const isLink = mediaEl.dataset?.mediaKind==='link' || mediaEl.tagName==='A' || !!mediaEl.getAttribute('href');

    if(resizeBtn) resizeBtn.style.display=mediaEl.tagName==='IMG'?'flex':'none';
    if(downloadBtn) downloadBtn.style.display=isLink?'none':'flex';
    if(openBtn){
      const labelSpan = openBtn.querySelector('span') || openBtn;
      labelSpan.textContent = isLink ? 'Open App / Open Link' : 'Open / View Media';
    }
    menu.style.top = `${Math.min(y, window.innerHeight - 250)}px`;
    menu.style.left = `${Math.min(x, window.innerWidth - 220)}px`;
    menu.classList.add('show');
  }

  // Right-click contextmenu handler
  ed.addEventListener('contextmenu', e=>{
    const mediaEl=e.target.closest('[data-media-id], .media-card, a[href]');
    if(mediaEl){
      e.preventDefault();
      showContextMenuForMedia(mediaEl, e.clientX, e.clientY);
    }
  });

  // Touch Long-Press handler (500ms)
  let longPressTimer = null;
  ed.addEventListener('touchstart', e=>{
    const mediaEl=e.target.closest('[data-media-id], .media-card, a[href]');
    if(mediaEl && e.touches.length === 1){
      const touch = e.touches[0];
      longPressTimer = setTimeout(()=>{
        showContextMenuForMedia(mediaEl, touch.clientX, touch.clientY);
      }, 500);
    }
  },{passive:true});

  ed.addEventListener('touchend', ()=>{ if(longPressTimer) clearTimeout(longPressTimer); });
  ed.addEventListener('touchmove', ()=>{ if(longPressTimer) clearTimeout(longPressTimer); });

  document.getElementById('icmDownload').onclick=async ()=>{
    menu.classList.remove('show');
    if(state.selectedImageEl){
      const id=state.selectedImageEl.getAttribute('data-media-id');
      const rec=await mediaGet(id);
      downloadMediaById(id, rec?rec.name:'download');
    }
  };
  document.getElementById('icmResize').onclick=()=>{
    menu.classList.remove('show');
    if(state.selectedImageEl && state.selectedImageEl.tagName==='IMG'){
      openResizeDialog(state.selectedImageEl);
    }
  };
  document.getElementById('icmCopy').onclick=async ()=>{
    menu.classList.remove('show');
    if(state.selectedImageEl){
      try{
        const url = state.selectedImageEl.getAttribute('href') || state.selectedImageEl.src || state.selectedImageEl.dataset?.url || '';
        await navigator.clipboard.writeText(url);
        toast('URL copied to clipboard');
      }catch(e){ toast('Copy failed'); }
    }
  };
  document.getElementById('icmOpenNew').onclick=()=>{
    menu.classList.remove('show');
    if(state.selectedImageEl){
      const url = state.selectedImageEl.getAttribute('href') || state.selectedImageEl.src || state.selectedImageEl.querySelector('source')?.src;
      if(url){
        if(typeof openLinkInAppOrTab==='function') openLinkInAppOrTab(url);
        else window.open(url, '_blank');
      }
    }
  };
  document.getElementById('icmMetadata').onclick=async ()=>{
    menu.classList.remove('show');
    if(state.selectedImageEl){
      const id=state.selectedImageEl.getAttribute('data-media-id');
      if(id){
        const rec=await mediaGet(id);
        if(rec) toast(`${esc(rec.name)} · ${formatBytes(rec.size)} · ${rec.type}`);
        else toast(`Media ID: ${id}`);
      } else {
        const href=state.selectedImageEl.getAttribute('href');
        if(href) toast(`Web Link: ${href}`);
      }
    }
  };
  document.getElementById('icmInsertEvent').onclick=()=>{
    menu.classList.remove('show');
    const today=new Date();
    openCalendarEventCreator(today.getFullYear(), today.getMonth(), today.getDate());
  };
  document.getElementById('icmInsertTask').onclick=()=>{
    menu.classList.remove('show');
    openTaskCreatorModal();
  };
  document.getElementById('icmDelete').onclick=()=>{
    menu.classList.remove('show');
    if(state.selectedImageEl){
      const id=state.selectedImageEl.getAttribute('data-media-id');
      if(id){
        confirmDeleteMediaAsset(id, 'Media asset');
      } else {
        state.selectedImageEl.remove();
        handleBodyInput();
        toast('Media element deleted');
      }
    }
  };

  document.addEventListener('click', e=>{
    if(!e.target.closest('#imageContextMenu')) menu.classList.remove('show');
  });
}


function openResizeDialog(img){
  if(!img || img.tagName!=='IMG') return;
  const curW=img.naturalWidth||img.width||400;
  const root=document.getElementById('modalRoot');
  root.innerHTML=`<div class="modal-overlay"><div class="modal" style="max-width:340px">
    <h3>Resize Image</h3>
    <p style="color:var(--fg-secondary);font-size:12.5px;margin-bottom:12px">Original: ${curW}px wide</p>
    <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:16px">
      <button class="btn" data-rw="25">25%</button>
      <button class="btn" data-rw="50">50%</button>
      <button class="btn" data-rw="75">75%</button>
      <button class="btn" data-rw="100">100%</button>
    </div>
    <div style="display:flex;gap:8px;align-items:center;margin-bottom:16px">
      <input id="rsCustom" type="number" min="50" max="2000" value="${Math.round(curW/2)}" placeholder="Custom width" style="background:var(--subtle);border:1px solid var(--border);border-radius:8px;padding:8px 10px;font-size:13px;outline:none;color:var(--fg);flex:1">
      <span style="color:var(--fg-muted);font-size:12px">px</span>
    </div>
    <div class="modal-actions">
      <button class="btn" id="rsCancel">Cancel</button>
      <button class="btn btn-primary" id="rsApply">Apply</button>
    </div>
  </div></div>`;
  const close=()=>root.innerHTML='';
  document.getElementById('rsCancel').onclick=close;
  root.querySelector('.modal-overlay').onclick=e=>{ if(e.target===e.currentTarget) close(); };
  // Percentage buttons — map onto the shared preset scale so the value survives
  // across devices and stays in sync with the toolbar / bottom sheet.
  root.querySelectorAll('[data-rw]').forEach(b=>{
    b.onclick=()=>{
      const pct=+b.dataset.rw;
      const preset={25:'small',50:'medium',75:'large',100:'full'}[pct];
      if(preset && typeof setImageSizeEx==='function'){
        setImageSizeEx(img, preset);
      }else{
        img.removeAttribute('data-img-size');
        img.style.width=pct+'%';
        img.style.height='auto';
        handleBodyInput();
      }
      close();
      toast(`Image resized to ${pct}%`);
    };
  });
  document.getElementById('rsApply').onclick=()=>{
    const w=+document.getElementById('rsCustom').value;
    if(w>=50 && w<=4000){
      // Custom width is freeform, so drop the preset to avoid a CSS conflict.
      img.removeAttribute('data-img-size');
      img.style.width=w+'px';
      img.style.maxWidth='100%';   // never exceed the editor
      img.style.height='auto';     // preserve aspect ratio
      handleBodyInput();
      close();
      toast(`Image resized to ${w}px`);
    }
  };
}
