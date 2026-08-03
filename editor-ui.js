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
   CLOSE ALL FLOATING EDITOR TOOLS
   Call this whenever the user navigates to a different page/filter
   so the block gutter, slash menu, and image context menu don't
   linger on top of unrelated views.
   ============================================================ */
function closeAllContextTools(){
  // Block gutter
  const gutter = document.getElementById('blockGutter');
  if(gutter) gutter.classList.remove('show','touch-dragging');

  // Slash / block command menu
  const slashMenu = document.getElementById('blockCommandMenu');
  if(slashMenu) slashMenu.classList.remove('show');

  // Image / media context menu
  const imageMenu = document.getElementById('imageContextMenu');
  if(imageMenu) imageMenu.classList.remove('show');

  // Font-style dropdown
  const fontDrop = document.getElementById('fontStyleDropdown');
  if(fontDrop) fontDrop.classList.remove('show');

  // Cancel any in-progress touch drag
  if(typeof handleTouchCancel === 'function') handleTouchCancel();
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
  let isLastInputTouch=false;

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
    gutter.classList.add('show');
    const rect=block.getBoundingClientRect();
    const gutterWidth=gutter.offsetWidth||60;
    const gutterHeight=gutter.offsetHeight||30;

    const vpTop=window.visualViewport?window.visualViewport.offsetTop:0;
    const vpHeight=window.visualViewport?window.visualViewport.height:window.innerHeight;

    let left=rect.left-gutterWidth-6;
    const isMobileTablet = window.innerWidth <= 1024 || 'ontouchstart' in window;
    if(left < 6 || isMobileTablet){
      if(rect.left - gutterWidth < 8){
        left=Math.max(6, rect.left + 4);
        gutter.classList.add('touch-active');
      } else {
        left=rect.left-gutterWidth-4;
        gutter.classList.remove('touch-active');
      }
    } else {
      gutter.classList.remove('touch-active');
    }
    let top=rect.top;
    if(top < vpTop + 6) top=vpTop + 6;
    if(top + gutterHeight > vpTop + vpHeight - 8) top=vpTop + vpHeight - gutterHeight - 8;

    gutter.style.left=`${Math.round(left)}px`;
    gutter.style.top=`${Math.round(top)}px`;
  };

  const syncGutterToActiveSelection=()=>{
    const selection=window.getSelection();
    if(selection && selection.anchorNode){
      const b=blockForNode(selection.anchorNode);
      if(b) showGutterForBlock(b);
    }
  };

  if(window.visualViewport){
    const handleViewportUpdate=()=>{
      if(activeGutterBlock?.isConnected) showGutterForBlock(activeGutterBlock);
      else syncGutterToActiveSelection();
    };
    window.visualViewport.addEventListener('resize', handleViewportUpdate, {passive:true});
    window.visualViewport.addEventListener('scroll', handleViewportUpdate, {passive:true});
  }

  ed.addEventListener('pointerdown', e=>{
    if(e.pointerType==='touch'||e.pointerType==='pen') isLastInputTouch=true;
    else isLastInputTouch=false;
  }, {passive:true});

  ed.addEventListener('pointermove', e=>{
    if(e.pointerType==='mouse'){
      isLastInputTouch=false;
      showGutterForBlock(blockForNode(e.target));
    }
  }, {passive:true});

  ed.addEventListener('focusin', e=>{
    showGutterForBlock(blockForNode(e.target));
  });

  ed.addEventListener('touchstart', e=>{
    isLastInputTouch=true;
    const touch=e.touches[0];
    if(touch){
      const targetEl=document.elementFromPoint(touch.clientX, touch.clientY);
      const b=blockForNode(targetEl);
      if(b) showGutterForBlock(b);
    }
  }, {passive:true});

  document.addEventListener('selectionchange', ()=>{
    if(document.activeElement===ed || ed.contains(document.activeElement)){
      syncGutterToActiveSelection();
    }
  }, {passive:true});

  ed.addEventListener('keyup', syncGutterToActiveSelection);

  ed.addEventListener('pointerleave', ()=>{
    if(isLastInputTouch) return;
    gutterHideTimer=setTimeout(()=>{ if(!gutter.matches(':hover')) hideGutter(); },180);
  });

  scrollHost.addEventListener('scroll',()=>{
    if(activeGutterBlock?.isConnected) showGutterForBlock(activeGutterBlock);
    else syncGutterToActiveSelection();
  },{passive:true});

  gutter.addEventListener('pointerenter',()=>clearTimeout(gutterHideTimer));
  gutter.addEventListener('pointerleave',()=>{
    if(!isLastInputTouch) hideGutter();
  });

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

  /* ---------- Drag & drop block & media rearrangement ---------- */
  const dragHandle=document.getElementById('blockDragHandle');
  let dropIndicator=null;
  let activeDragBlock=null;
  let isTouchDragging=false;

  function ensureDropIndicator(){
    if(!dropIndicator){
      dropIndicator=document.createElement('div');
      dropIndicator.className='block-drop-indicator';
    }
    return dropIndicator;
  }

  function cleanupDragState(){
    if(activeDragBlock) activeDragBlock.style.opacity='';
    activeDragBlock=null;
    isTouchDragging=false;
    if(activeGutterBlock) activeGutterBlock.classList.remove('opacity-50');
    if(dropIndicator && dropIndicator.parentElement) dropIndicator.remove();
    dropIndicator=null;
    stopAutoScroll();
  }

  if(dragHandle){
    dragHandle.addEventListener('dragstart', e=>{
      if(!activeGutterBlock) return;
      activeDragBlock=activeGutterBlock;
      // Use custom MIME type to avoid browser inserting text into contenteditable on drop
      e.dataTransfer.clearData();
      e.dataTransfer.setData('application/x-paperuss-drag', 'block');
      e.dataTransfer.effectAllowed='move';
      activeGutterBlock.classList.add('opacity-50');
      ensureDropIndicator();
      try{ e.dataTransfer.setDragImage(activeGutterBlock, 20, 20); }catch(_){}
    });
    dragHandle.addEventListener('dragend', cleanupDragState);
  }

  /* ---------- Touch Drag Support for Mobile — Lift & Move ---------- */
  let touchGhost = null;           // floating clone that follows the finger
  let touchGhostOffsetX = 0;       // where on the element the finger landed
  let touchGhostOffsetY = 0;
  let touchLongPressTimer = null;  // 140ms hold before drag activates
  let touchDragReady = false;      // becomes true after long-press fires
  let touchStartX = 0, touchStartY = 0;
  let ghostCleanupTimer = null;

  function removeTouchGhost(specificGhost){
    if(ghostCleanupTimer){
      clearTimeout(ghostCleanupTimer);
      ghostCleanupTimer = null;
    }
    if(specificGhost){
      if(specificGhost.parentElement) specificGhost.remove();
      if(touchGhost === specificGhost) touchGhost = null;
    } else {
      if(touchGhost && touchGhost.parentElement) touchGhost.remove();
      touchGhost = null;
    }
    // Only perform sweep if we are NOT currently in an active touch drag
    if(!isTouchDragging){
      document.querySelectorAll('body > .touch-ghost-clone').forEach(el => el.remove());
    }
  }

  function createTouchGhost(block, touchX, touchY){
    removeTouchGhost(); // Wipe any existing ghosts first
    const rect = block.getBoundingClientRect();
    touchGhostOffsetX = touchX - rect.left;
    touchGhostOffsetY = touchY - rect.top;

    touchGhost = block.cloneNode(true);
    touchGhost.className += ' touch-ghost-clone';
    touchGhost.style.cssText = `
      position:fixed;
      left:${touchX - touchGhostOffsetX}px;
      top:${touchY - touchGhostOffsetY}px;
      width:${rect.width}px;
      z-index:9999;
      pointer-events:none;
      border-radius:12px;
      box-shadow:0 20px 60px rgba(0,0,0,0.45), 0 0 0 2px var(--accent,#3b82f6);
      opacity:0.92;
      transform:scale(1.04) rotate(-1deg);
      transform-origin:${touchGhostOffsetX}px ${touchGhostOffsetY}px;
      transition:transform 0.18s cubic-bezier(.34,1.56,.64,1), box-shadow 0.18s ease;
      background:var(--canvas,#fff);
      will-change:transform,left,top;
    `;
    document.body.appendChild(touchGhost);
  }

  function moveTouchGhost(touchX, touchY){
    if(!touchGhost) return;
    const newLeft = touchX - touchGhostOffsetX;
    const newTop  = touchY - touchGhostOffsetY;
    touchGhost.style.left = `${newLeft}px`;
    touchGhost.style.top  = `${newTop}px`;
  }

  function triggerHaptic(type='light'){
    if(!navigator.vibrate) return;
    if(type==='light') navigator.vibrate(10);
    else if(type==='success') navigator.vibrate([10,30,20]);
    else if(type==='heavy') navigator.vibrate(30);
  }

  function handleTouchDragStart(startTouch, targetBlock){
    if(!targetBlock || isTouchDragging) return;
    isTouchDragging = true;
    activeDragBlock = targetBlock;

    // Visual: show dragging state on original
    activeDragBlock.style.opacity = '0.28';
    activeDragBlock.style.transform = 'scale(0.98)';
    activeDragBlock.style.transition = 'opacity 0.15s ease, transform 0.15s ease';

    gutter.classList.add('touch-dragging');
    createTouchGhost(activeDragBlock, startTouch.clientX, startTouch.clientY);
    ensureDropIndicator();
    triggerHaptic('heavy');
  }

  let touchMoveRaf = null;
  function handleTouchDragMove(e){
    const touch = e.touches ? e.touches[0] : (e.clientX !== undefined ? e : null);
    if(!touch) return;

    // If long press is pending, check if user scrolled/moved more than 6px
    if(!isTouchDragging && touchLongPressTimer){
      const dx = Math.abs(touch.clientX - touchStartX);
      const dy = Math.abs(touch.clientY - touchStartY);
      if(dx > 6 || dy > 6){
        clearTimeout(touchLongPressTimer);
        touchLongPressTimer = null;
        touchDragReady = false;
        return;
      }
    }

    if(!isTouchDragging || !activeDragBlock) return;
    if(e.cancelable) e.preventDefault();

    moveTouchGhost(touch.clientX, touch.clientY);
    scheduleAutoScroll(touch.clientY);

    if(touchMoveRaf) return;
    touchMoveRaf = requestAnimationFrame(() => {
      touchMoveRaf = null;
      if(!isTouchDragging || !touchGhost) return;
      // Hide ghost temporarily to hit-test the element underneath
      touchGhost.style.display = 'none';
      const overEl = document.elementFromPoint(touch.clientX, touch.clientY);
      touchGhost.style.display = '';

      if(overEl && ed.contains(overEl)){
        const ind = ensureDropIndicator();
        const overBlock = overEl.closest('p, div, h1, h2, h3, h4, blockquote, table, figure, .media-card, img, video, audio') || overEl;
        const validBlock = overBlock ? (overBlock.closest('.note-editor > *') || overBlock) : null;
        if(validBlock && validBlock !== activeDragBlock && validBlock !== ind && ed.contains(validBlock)){
          const r = validBlock.getBoundingClientRect();
          const isBottom = (touch.clientY - r.top) > (r.height / 2);
          if(isBottom) validBlock.parentElement.insertBefore(ind, validBlock.nextSibling);
          else validBlock.parentElement.insertBefore(ind, validBlock);
        }
      }
    });
  }

  function handleTouchDragEnd(){
    clearTimeout(touchLongPressTimer);
    touchLongPressTimer = null;

    if(!isTouchDragging && !touchGhost){
      touchDragReady = false;
      return;
    }
    stopAutoScroll();
    if(touchMoveRaf){ cancelAnimationFrame(touchMoveRaf); touchMoveRaf = null; }

    const ind = dropIndicator;
    const target = activeDragBlock;
    const currentGhost = touchGhost;
    touchGhost = null;
    isTouchDragging = false;

    // Animate ghost snapping to drop position or fading out
    if(currentGhost){
      if(ind && ind.parentElement){
        const dropRect = ind.getBoundingClientRect();
        currentGhost.style.transition = 'left 0.18s cubic-bezier(.34,1.1,.64,1), top 0.18s cubic-bezier(.34,1.1,.64,1), opacity 0.15s ease, transform 0.15s ease';
        currentGhost.style.left = `${dropRect.left}px`;
        currentGhost.style.top  = `${dropRect.top}px`;
        currentGhost.style.transform = 'scale(1) rotate(0deg)';
        currentGhost.style.opacity = '0';
      } else {
        currentGhost.style.transition = 'opacity 0.15s ease, transform 0.15s ease';
        currentGhost.style.opacity = '0';
        currentGhost.style.transform = 'scale(0.95)';
      }
    }

    // Commit the DOM move
    if(target && ind && ind.parentElement){
      ind.parentElement.insertBefore(target, ind);
      ind.remove();
      handleBodyInput();
      save();
      triggerHaptic('success');
    }

    // Restore original element
    if(target){
      target.style.opacity = '';
      target.style.transform = '';
      target.style.transition = '';
    }

    gutter.classList.remove('touch-dragging');
    ghostCleanupTimer = setTimeout(() => removeTouchGhost(currentGhost), 200);
    activeDragBlock = null;
    if(dropIndicator && dropIndicator.parentElement) dropIndicator.remove();
    dropIndicator = null;
    stopAutoScroll();
    touchDragReady = false;
  }

  function handleTouchCancel(){
    clearTimeout(touchLongPressTimer);
    touchLongPressTimer = null;
    if(touchMoveRaf){ cancelAnimationFrame(touchMoveRaf); touchMoveRaf = null; }
    if(activeDragBlock){
      activeDragBlock.style.opacity = '';
      activeDragBlock.style.transform = '';
      activeDragBlock.style.transition = '';
    }
    gutter.classList.remove('touch-dragging');
    removeTouchGhost();
    cleanupDragState();
    touchDragReady = false;
  }

  // Wire long-press and Stylus/Pen on drag handle
  if(dragHandle){
    dragHandle.addEventListener('mousedown', () => {
      touchDragReady = false;
      isTouchDragging = false;
    });

    // Prevent default native HTML5 drag on touch start so no browser preview image interferes
    dragHandle.addEventListener('dragstart', e => {
      if(isTouchDragging || touchDragReady) {
        e.preventDefault();
      }
    });

    // Stylus (Apple Pencil / S-Pen) instant lift
    dragHandle.addEventListener('pointerdown', e => {
      if(e.pointerType === 'pen') {
        clearTimeout(touchLongPressTimer);
        touchDragReady = true;
        touchStartX = e.clientX;
        touchStartY = e.clientY;
        handleTouchDragStart({ clientX: e.clientX, clientY: e.clientY }, activeGutterBlock);
      }
    }, {passive:true});

    // Touch screen quick-hold drag
    dragHandle.addEventListener('touchstart', e=>{
      const touch = e.touches[0];
      if(!touch) return;
      clearTimeout(touchLongPressTimer);
      touchDragReady = false;
      touchStartX = touch.clientX;
      touchStartY = touch.clientY;
      triggerHaptic('light');
      touchLongPressTimer = setTimeout(() => {
        if(activeGutterBlock){
          touchDragReady = true;
          handleTouchDragStart(touch, activeGutterBlock);
        }
      }, 140);
    }, {passive:true});

    dragHandle.addEventListener('touchmove', e=>{
      handleTouchDragMove(e);
    }, {passive:false});

    dragHandle.addEventListener('touchend', e=>{
      clearTimeout(touchLongPressTimer);
      handleTouchDragEnd();
    });

    dragHandle.addEventListener('touchcancel', ()=>{
      clearTimeout(touchLongPressTimer);
      handleTouchCancel();
    });
  }

  // Global window listeners for drag safety (catches touch release outside handle)
  window.addEventListener('touchmove', e => {
    handleTouchDragMove(e);
  }, {passive:false});
  window.addEventListener('touchend', () => {
    handleTouchDragEnd();
  });
  window.addEventListener('touchcancel', () => {
    handleTouchCancel();
  });



  // Allow direct grabbing of media elements anywhere on the block
  ed.addEventListener('pointerover', e=>{
    const mediaEl=e.target.closest('[data-media-id], .media-card, figure');
    if(mediaEl && !mediaEl.getAttribute('draggable')){
      mediaEl.setAttribute('draggable', 'true');
    }
  });

  ed.addEventListener('dragstart', e=>{
    const mediaEl=e.target.closest('[data-media-id], .media-card, figure');
    if(mediaEl && ed.contains(mediaEl)){
      activeDragBlock = mediaEl;
      // Use a custom MIME type — NOT text/plain — so the browser does NOT
      // insert a text string into the contenteditable on drop, which causes
      // the element to appear duplicated.
      e.dataTransfer.clearData();
      e.dataTransfer.setData('application/x-paperuss-drag', 'media');
      e.dataTransfer.effectAllowed = 'move';
      mediaEl.style.opacity = '0.45';
      ensureDropIndicator();
    }
  });

  ed.addEventListener('dragend', cleanupDragState);

  ed.addEventListener('dragover', e=>{
    if(!activeDragBlock) return;
    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = 'move';
    scheduleAutoScroll(e.clientY);

    const ind = ensureDropIndicator();
    const overBlock = e.target.closest('p, div, h1, h2, h3, h4, blockquote, table, figure, .media-card, img, video, audio') || e.target;
    const validBlock = overBlock ? (overBlock.closest('.note-editor > *') || overBlock) : null;

    if(validBlock && validBlock !== activeDragBlock && validBlock !== ind && ed.contains(validBlock)){
      const r = validBlock.getBoundingClientRect();
      const isBottom = (e.clientY - r.top) > (r.height / 2);
      if(isBottom){
        validBlock.parentElement.insertBefore(ind, validBlock.nextSibling);
      } else {
        validBlock.parentElement.insertBefore(ind, validBlock);
      }
    }
  });

  ed.addEventListener('drop', e=>{
    if(!activeDragBlock) return;
    e.preventDefault();
    e.stopPropagation();
    stopAutoScroll();

    const ind = dropIndicator;
    if(ind && ind.parentElement){
      ind.parentElement.insertBefore(activeDragBlock, ind);
      ind.remove();
      handleBodyInput();
      save();
      addNotification({type:'edit',title:'Block rearranged',body:'A media or content block was moved.',icon:'grip-vertical',activity:true});
    }
    cleanupDragState();
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
    else if(cmd==='callout') applyCommand('callout', 'tip');
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

/* ============================================================
   PAGE LAYOUT / WYSIWYG EDITOR LOGIC
   ============================================================ */
function initPageLayoutUI() {
  const dropdown = document.getElementById('pageLayoutDropdown');
  if(!dropdown) return;

  // Insert explicit page break
  const btnBreak = document.getElementById('insertPageBreakBtn');
  if(btnBreak) {
    btnBreak.onclick = (e) => {
      e.stopPropagation();
      dropdown.classList.remove('show');
      const ed = document.getElementById('noteBody');
      ed.focus();
      const sel = window.getSelection();
      if(!sel.rangeCount) return;
      const range = sel.getRangeAt(0);
      const pb = document.createElement('div');
      pb.className = 'page-break';
      pb.contentEditable = 'false';
      range.insertNode(pb);
      // Move cursor after the page break
      const p = document.createElement('p');
      p.innerHTML = '<br>';
      pb.parentNode.insertBefore(p, pb.nextSibling);
      range.setStart(p, 0);
      range.collapse(true);
      sel.removeAllRanges();
      sel.addRange(range);
      if(typeof handleBodyInput === 'function') handleBodyInput();
    };
  }

  // Handle option clicks
  dropdown.addEventListener('click', e => {
    const opt = e.target.closest('.pl-opt[data-prop]');
    if(!opt) return;
    e.stopPropagation();
    
    const prop = opt.dataset.prop;
    const val = opt.dataset.val;
    const note = activeNoteForAction();
    if(!note) return;

    if(prop === 'mode') note.pageViewEnabled = (val === 'wysiwyg');
    else if(prop === 'size') note.pageSize = val;
    else if(prop === 'orient') note.pageOrientation = val;
    else if(prop === 'margin') note.pageMargins = val;
    
    // Save metadata
    note.updatedAt = Date.now();
    if(typeof save === 'function') save();
    if(typeof updateNoteList === 'function') updateNoteList();
    
    applyPageLayoutToEditor(note);
    syncPageLayoutDropdown(note);
  });
}

function syncPageLayoutDropdown(note) {
  const dropdown = document.getElementById('pageLayoutDropdown');
  if(!dropdown) return;
  const isWysiwyg = !!note.pageViewEnabled;
  const size = note.pageSize || 'a4';
  const orient = note.pageOrientation || 'portrait';
  const margin = note.pageMargins || 'normal';

  dropdown.querySelectorAll('.pl-opt[data-prop]').forEach(btn => {
    const prop = btn.dataset.prop;
    const val = btn.dataset.val;
    if(prop === 'mode') btn.classList.toggle('active', (val === 'wysiwyg') === isWysiwyg);
    else if(prop === 'size') btn.classList.toggle('active', val === size);
    else if(prop === 'orient') btn.classList.toggle('active', val === orient);
    else if(prop === 'margin') btn.classList.toggle('active', val === margin);
  });
}

function applyPageLayoutToEditor(note) {
  const edScroll = document.getElementById('editorScroll');
  const edBody = document.getElementById('noteBody');
  if(!edScroll || !edBody || !note) return;

  const isWysiwyg = !!note.pageViewEnabled;
  const zoomControls = document.getElementById('zoomControls');
  
  if(isWysiwyg) {
    edScroll.classList.add('wysiwyg-mode');
    edBody.classList.add('wysiwyg-paper');
    if(zoomControls) zoomControls.style.display = 'flex';
    
    // Dimensions map (at 96 DPI approximation for web)
    const sizes = {
      'a4': { w: 794, h: 1123 },
      'letter': { w: 816, h: 1056 },
      'legal': { w: 816, h: 1344 }
    };
    
    const size = note.pageSize || 'a4';
    const orient = note.pageOrientation || 'portrait';
    const marginType = note.pageMargins || 'normal';
    
    let dim = sizes[size] || sizes['a4'];
    let w = orient === 'landscape' ? dim.h : dim.w;
    
    let pad = '20mm'; // normal
    if(marginType === 'narrow') pad = '12mm';
    if(marginType === 'wide') pad = '30mm';

    edBody.style.width = w + 'px';
    edBody.style.maxWidth = '100%';
    const pageH = (orient === 'landscape' ? dim.w : dim.h);
    edBody.style.minHeight = pageH + 'px';
    edBody.style.padding = pad;
    edBody.style.margin = '0 auto';
    // Visual auto pagebreak guidelines
    edBody.style.background = `repeating-linear-gradient(to bottom, transparent, transparent calc(${pageH}px - 2px), #cbd5e1 calc(${pageH}px - 2px), #cbd5e1 ${pageH}px), #fff`;
    
    applyZoom();
  } else {
    edScroll.classList.remove('wysiwyg-mode');
    edBody.classList.remove('wysiwyg-paper');
    if(zoomControls) zoomControls.style.display = 'none';
    edBody.style.width = '';
    edBody.style.maxWidth = '';
    edBody.style.minHeight = '';
    edBody.style.padding = '';
    edBody.style.margin = '';
    edBody.style.background = '';
    edBody.style.transform = '';
    edBody.style.transformOrigin = '';
    edBody.style.marginBottom = '';
  }
}

let currentZoom = 1.0;

function applyZoom() {
  const edBody = document.getElementById('noteBody');
  if(!edBody) return;
  
  edBody.style.transform = `scale(${currentZoom})`;
  edBody.style.transformOrigin = 'top center';
  
  // When scaling, the layout height doesn't physically change in DOM flow,
  // so we add a margin bottom to allow scrolling the scaled content.
  const rect = edBody.getBoundingClientRect();
  const scaledHeight = rect.height; // Client rect returns scaled height
  const originalHeight = edBody.offsetHeight;
  const heightDiff = scaledHeight - originalHeight;
  edBody.style.marginBottom = heightDiff > 0 ? `${heightDiff}px` : '0';
  
  const label = document.getElementById('zoomLevelLabel');
  if(label) label.textContent = `${Math.round(currentZoom * 100)}%`;
}

function initZoomControls() {
  const zoomIn = document.getElementById('zoomInBtn');
  const zoomOut = document.getElementById('zoomOutBtn');
  
  if(zoomIn) {
    zoomIn.onclick = () => {
      if(currentZoom < 2.0) {
        currentZoom += 0.1;
        applyZoom();
      }
    };
  }
  if(zoomOut) {
    zoomOut.onclick = () => {
      if(currentZoom > 0.5) {
        currentZoom -= 0.1;
        applyZoom();
      }
    };
  }
}

// Call init once
document.addEventListener('DOMContentLoaded', () => {
  initPageLayoutUI();
  initZoomControls();
});

/* ============================================================
   FIND IN NOTE
   ============================================================ */
let findMatches = [];
let findCurrentIndex = -1;

function initFindInNote() {
  const input = document.getElementById('findInput');
  const prevBtn = document.getElementById('findPrevBtn');
  const nextBtn = document.getElementById('findNextBtn');
  const closeBtn = document.getElementById('findCloseBtn');
  
  if(!input) return;
  
  input.addEventListener('input', () => {
    executeFind(input.value);
  });
  
  input.addEventListener('keydown', e => {
    if(e.key === 'Enter') {
      e.preventDefault();
      if(e.shiftKey) findPrev();
      else findNext();
    }
    if(e.key === 'Escape') {
      closeFind();
    }
  });
  
  prevBtn.onclick = findPrev;
  nextBtn.onclick = findNext;
  closeBtn.onclick = closeFind;
  
  const replaceBtn = document.getElementById('replaceBtn');
  const replaceAllBtn = document.getElementById('replaceAllBtn');
  const replaceInput = document.getElementById('replaceInput');
  const bottomBarTriggerBtn = document.getElementById('findReplaceTriggerBtn');
  
  if(replaceBtn) replaceBtn.onclick = executeReplace;
  if(replaceAllBtn) replaceAllBtn.onclick = executeReplaceAll;
  
  if(replaceInput) {
    replaceInput.addEventListener('keydown', e => {
      if(e.key === 'Enter') {
        e.preventDefault();
        executeReplace();
      }
    });
  }
  
  if(bottomBarTriggerBtn) {
    bottomBarTriggerBtn.onclick = () => {
      const panel = document.getElementById('findPanel');
      if(panel && !panel.classList.contains('hidden')) {
        closeFind();
      } else {
        openFind();
      }
    };
  }
  
  // Intercept Ctrl+F / Cmd+F globally
  document.addEventListener('keydown', e => {
    if((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'f') {
      // Only open if editor view is visible
      const edView = document.getElementById('editorView');
      if(edView && !edView.classList.contains('hidden')) {
        e.preventDefault();
        openFind();
      }
    }
  });
}

function openFind() {
  const panel = document.getElementById('findPanel');
  if(!panel) return;
  panel.classList.remove('hidden');
  const input = document.getElementById('findInput');
  input.focus();
  input.select();
  if(input.value) executeFind(input.value);
}

function closeFind() {
  const panel = document.getElementById('findPanel');
  if(panel) panel.classList.add('hidden');
  clearFindHighlights();
  document.getElementById('noteBody').focus();
}

function executeFind(query) {
  clearFindHighlights();
  findMatches = [];
  findCurrentIndex = -1;
  updateFindCount();
  
  if(!query || query.trim().length === 0) return;
  if(!window.CSS || !CSS.highlights) return;
  
  const ed = document.getElementById('noteBody');
  const text = query.toLowerCase();
  
  const walker = document.createTreeWalker(ed, NodeFilter.SHOW_TEXT, null, false);
  let node;
  const ranges = [];
  
  while(node = walker.nextNode()) {
    const nodeText = node.nodeValue.toLowerCase();
    let idx = nodeText.indexOf(text);
    while(idx !== -1) {
      const range = new Range();
      range.setStart(node, idx);
      range.setEnd(node, idx + text.length);
      ranges.push(range);
      findMatches.push(range);
      idx = nodeText.indexOf(text, idx + text.length);
    }
  }
  
  if(ranges.length > 0) {
    const searchHighlight = new Highlight(...ranges);
    CSS.highlights.set('search-result', searchHighlight);
    findNext();
  } else {
    updateFindCount();
  }
}

function clearFindHighlights() {
  if(window.CSS && CSS.highlights) {
    CSS.highlights.delete('search-result');
    CSS.highlights.delete('search-active');
  }
  findMatches = [];
  findCurrentIndex = -1;
  updateFindCount();
}

function updateFindCount() {
  const countEl = document.getElementById('findMatchCount');
  if(!countEl) return;
  if(findMatches.length === 0) {
    countEl.textContent = '0/0';
  } else {
    countEl.textContent = `${findCurrentIndex + 1}/${findMatches.length}`;
  }
}

function findNext() {
  if(findMatches.length === 0) return;
  findCurrentIndex = (findCurrentIndex + 1) % findMatches.length;
  highlightActiveMatch();
}

function findPrev() {
  if(findMatches.length === 0) return;
  findCurrentIndex = (findCurrentIndex - 1 + findMatches.length) % findMatches.length;
  highlightActiveMatch();
}

function highlightActiveMatch() {
  if(!window.CSS || !CSS.highlights) return;
  
  const activeRange = findMatches[findCurrentIndex];
  const activeHighlight = new Highlight(activeRange);
  CSS.highlights.set('search-active', activeHighlight);
  
  updateFindCount();
  
  const el = activeRange.startContainer.parentElement;
  if(el && el.scrollIntoView) {
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }
}

function executeReplace() {
  if (findMatches.length === 0 || findCurrentIndex < 0) return;
  
  const replaceInput = document.getElementById('replaceInput');
  const findInput = document.getElementById('findInput');
  if (!replaceInput || !findInput) return;
  
  const replaceText = replaceInput.value;
  const activeRange = findMatches[findCurrentIndex];
  
  // Safely replace text using the range
  activeRange.deleteContents();
  activeRange.insertNode(document.createTextNode(replaceText));
  
  // Trigger a save since we mutated the DOM
  if(typeof save === 'function') save();
  
  // Re-run find to update matches and ranges since DOM was mutated
  executeFind(findInput.value);
}

function executeReplaceAll() {
  if (findMatches.length === 0) return;
  
  const replaceInput = document.getElementById('replaceInput');
  const findInput = document.getElementById('findInput');
  if (!replaceInput || !findInput) return;
  
  const replaceText = replaceInput.value;
  
  // Replace in reverse order so DOM mutations don't invalidate subsequent ranges
  for (let i = findMatches.length - 1; i >= 0; i--) {
    const range = findMatches[i];
    range.deleteContents();
    range.insertNode(document.createTextNode(replaceText));
  }
  
  // Trigger a save since we mutated the DOM
  if(typeof save === 'function') save();
  
  // Re-run find to update matches
  executeFind(findInput.value);
}
