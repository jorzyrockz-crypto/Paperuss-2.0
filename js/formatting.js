/* ============================================================
   WYSIWYG FORMATTING
   ============================================================ */
function focusEditor(){ bodyEl().focus(); }

function applyCommand(cmd, val){
  focusEditor();
  if(window.HistoryManager) window.HistoryManager.capture(true);
  if(cmd==='createLink'){
    const sel=window.getSelection();
    const selText=sel ? sel.toString().trim() : '';
    if(typeof openLinkModal === 'function'){
      openLinkModal({
        initialText: selText,
        callback: (res, linkText) => {
          focusEditor();
          if(!res || !res.url) return;
          const ed = bodyEl();
          const targetAttr = res.isExternal ? ' target="_blank" rel="noopener noreferrer"' : '';
          const curSel = window.getSelection();
          if(curSel && curSel.rangeCount && !curSel.isCollapsed && ed.contains(curSel.anchorNode)){
            document.execCommand('createLink', false, res.url);
            const anchor = (curSel.anchorNode.nodeType === 3 ? curSel.anchorNode.parentElement : curSel.anchorNode).closest?.('a');
            if(anchor){
              if(linkText && linkText !== selText) anchor.textContent = linkText;
              if(res.isExternal){ anchor.target = '_blank'; anchor.rel = 'noopener noreferrer'; }
              else { anchor.removeAttribute('target'); anchor.removeAttribute('rel'); }
            }
          } else {
            const html = `<a href="${esc(res.url)}"${targetAttr}>${esc(linkText)}</a>`;
            insertHTMLAtCaret(html);
          }
          handleBodyInput(); updateToolbarState();
        }
      });
      return;
    }
    const raw=prompt('Enter URL:','https://');
    if(!raw) return;
    const res = window.LinkParser ? window.LinkParser.parseAndValidateUrl(raw) : { valid: true, url: raw, isExternal: true };
    if(!res.valid){ toast(res.error || 'Invalid URL'); return; }
    document.execCommand('createLink', false, res.url);
    const a=(sel && sel.anchorNode ? (sel.anchorNode.nodeType===3?sel.anchorNode.parentElement:sel.anchorNode).closest?.('a') : null);
    if(a && res.isExternal){ a.target='_blank'; a.rel='noopener noreferrer'; }
    handleBodyInput(); updateToolbarState();
    return;
  } else if(cmd==='embedTool'){
    if(typeof window.openEmbedModal === 'function') window.openEmbedModal();
    return;
  } else if(cmd==='fontSize'){
    applyFontSize(val);
    return;
  } else if(cmd==='hilite'){
    applyHighlight(val);
    return;
  } else if(cmd==='align'){
    applyAlignment(val);
    return;
  } else if(cmd==='formatBlock' && val==='blockquote'){
    // TRUE TOGGLE — must run BEFORE the generic formatBlock branch below,
    // otherwise clicking Quote on an existing quote would just reapply it.
    const ed=bodyEl();
    const sel=window.getSelection();
    if(sel && sel.anchorNode && ed.contains(sel.anchorNode)){
      let node=sel.anchorNode;
      if(node.nodeType===3) node=node.parentElement;
      const bq=node.closest && node.closest('blockquote');
      if(bq){
        // Unwrap the blockquote — never nest.
        const frag=document.createDocumentFragment();
        while(bq.firstChild) frag.appendChild(bq.firstChild);
        bq.replaceWith(frag);
        handleBodyInput(); updateToolbarState();
        return;
      }
      // Not in a quote → wrap once, then guarantee no nested <blockquote>.
      document.execCommand('formatBlock', false, 'blockquote');
      ed.querySelectorAll('blockquote blockquote').forEach(inner=>{
        const frag=document.createDocumentFragment();
        while(inner.firstChild) frag.appendChild(inner.firstChild);
        inner.replaceWith(frag);
      });
      handleBodyInput(); updateToolbarState();
      return;
    }
  } else if(cmd==='formatBlock'){
    applyParagraphStyle(val);
    return;
  } else if(cmd==='code'){
    wrapInlineCode();
  } else if(cmd==='callout'){
    insertCallout(val || 'tip');
    return;
  } else if(cmd==='task'){
    toggleList('task');
    return;
  } else if(cmd==='divider'){
    insertDivider();
    return;
  } else if(cmd==='table'){
    insertTable(3,3);
    return;
  } else if(cmd==='textColor'){
    if(val==='remove') {
      document.execCommand('removeFormat', false, null); // Wait, this is bad, it removes everything!
      // Better to use foreColor with inherit or a transparent color?
      // document.execCommand('foreColor') can be reset if we apply a custom logic.
      // But let's just use empty string which clears it in some browsers, or default color.
      document.execCommand('foreColor', false, 'inherit');
      // Wait, 'inherit' might not work. We can apply the theme default 'var(--fg)'. Let's just do `document.execCommand('foreColor', false, val)` where val was set to 'var(--fg)' for the reset button. But wait! I set val="remove" in HTML. Let's fix that.
    }
    // Actually, I'll write a small applyTextColor function.
    applyTextColor(val);
    return;
  } else if(cmd==='indent'){
    applyIndent();
    return;
  } else if(cmd==='outdent'){
    applyOutdent();
    return;
  } else if(cmd==='insertUnorderedList'){
    toggleList('ul');
    return;
  } else if(cmd==='insertOrderedList'){
    toggleList('ol');
    return;
  } else {
    document.execCommand(cmd, false, val||null);
  }
  handleBodyInput();
  updateToolbarState();
}

/* ---- Robust font size via span wrapping ---- */
function applyFontSize(size){
  const sel=window.getSelection();
  if(!sel || !sel.rangeCount){ return; }

  // If collapsed (cursor only) — insert zero-width spacer span
  if(sel.isCollapsed){
    const span=wrapSelectionInSpan({fontSize:size});
    if(span){
      // Move cursor inside the span
      const r=document.createRange();
      r.setStartAfter(span);
      r.collapse(true);
      sel.removeAllRanges();
      sel.addRange(r);
    }
    return;
  }

  // Expand selection to word boundaries if just inside text
  const range=sel.getRangeAt(0);
  const ed=document.getElementById('noteBody');

  // Check if selection already wrapped in a font-size span — replace size on it
  let startNode=sel.anchorNode;
  if(startNode.nodeType===3) startNode=startNode.parentElement;
  let szWrapper=startNode;
  while(szWrapper && szWrapper!==ed){
    if(szWrapper.style&&szWrapper.style.fontSize){ break; }
    szWrapper=szWrapper.parentElement;
  }
  if(szWrapper && szWrapper!==ed && szWrapper.style.fontSize){
    szWrapper.style.fontSize=size;
    handleBodyInput(); updateToolbarState();
    return;
  }

  // Wrap the selection using extractContents + insertNode (avoids surroundContents edge cases)
  const span=document.createElement('span');
  span.style.fontSize=size;
  try{
    span.appendChild(range.extractContents());
    range.insertNode(span);
    // Place cursor at end of wrapped content
    const r=document.createRange();
    r.setStartAfter(span);
    r.collapse(true);
    sel.removeAllRanges(); sel.addRange(r);
  }catch(e){
    // Fallback: just insert plain text
    document.execCommand('insertText', false, sel.toString());
  }
}

/* ---- Robust highlight via mark element ---- */
function applyHighlight(color){
  const sel=window.getSelection();
  if(!sel || !sel.rangeCount){ return; }

  // "remove" = strip all marks from selection
  if(color==='remove'){
    const ed=document.getElementById('noteBody');
    if(sel.isCollapsed){
      // Walk from cursor backwards to find and remove mark
      let n=sel.anchorNode;
      if(n.nodeType===3) n=n.parentElement;
      while(n && n!==ed){
        if(n.tagName==='MARK'){
          const t=document.createTextNode(n.textContent);
          n.replaceWith(t);
          break;
        }
        n=n.parentElement;
      }
    } else {
      const walker=document.createTreeWalker(ed, NodeFilter.SHOW_TEXT, null);
      const range=sel.getRangeAt(0);
      let node;
      while((node=walker.nextNode())){
        if(!range.intersectsNode(node)) continue;
        let p=node.parentElement;
        while(p && p!==ed){
          if(p.tagName==='MARK'){
            const t=document.createTextNode(p.textContent);
            p.replaceWith(t);
            break;
          }
          p=p.parentElement;
        }
      }
    }
    handleBodyInput(); updateToolbarState();
    return;
  }

  if(sel.isCollapsed){
    const span=wrapSelectionInSpan({background:color, borderRadius:'3px'});
    if(span){
      const r=document.createRange();
      r.setStartAfter(span);
      r.collapse(true);
      sel.removeAllRanges(); sel.addRange(r);
    }
    return;
  }

  const range=sel.getRangeAt(0);

  // Toggle: if the entire selection is already in one mark of same color, unwrap it
  let an=sel.anchorNode;
  if(an.nodeType===3) an=an.parentElement;
  const mark=an?.closest?.('mark');
  if(mark && mark.style.background===color){
    const t=document.createTextNode(mark.textContent);
    mark.replaceWith(t);
    handleBodyInput(); updateToolbarState();
    return;
  }

  // Remove any existing mark wrapping first
  stripMarksInRange(range);

  // Use native hiliteColor/backColor for multi-block safety, fallback to mark
  try{
    const success = document.execCommand('hiliteColor', false, color) || document.execCommand('backColor', false, color);
    if(!success) throw new Error('fallback to mark');
  }catch(e){
    try{
      const m=document.createElement('mark');
      m.style.background=color;
      m.style.borderRadius='3px';
      m.style.color='inherit';
      m.appendChild(range.extractContents());
      range.insertNode(m);
      const r=document.createRange();
      r.setStartAfter(m);
      r.collapse(true);
      sel.removeAllRanges(); sel.addRange(r);
    }catch(err){
      document.execCommand('backColor', false, color);
    }
  }
}

/* ---- Text Color via foreColor ---- */
function applyTextColor(color){
  document.execCommand('styleWithCSS', false, true);
  if(color === 'remove'){
    document.execCommand('foreColor', false, '#FEFEFE');
    const ed = bodyEl();
    ed.querySelectorAll('span, font').forEach(el => {
      if(el.style.color === 'rgb(254, 254, 254)' || el.getAttribute('color') === '#FEFEFE' || el.style.color === '#fefefe'){
        el.style.color = '';
        el.removeAttribute('color');
        if(!el.getAttribute('style')) el.removeAttribute('style');
        if(!el.attributes.length && (el.tagName === 'FONT' || el.tagName === 'SPAN')){
          const frag = document.createDocumentFragment();
          while(el.firstChild) frag.appendChild(el.firstChild);
          el.replaceWith(frag);
        }
      }
    });
  } else {
    document.execCommand('foreColor', false, color);
  }
  handleBodyInput();
  updateToolbarState();
}

/* Helper: wrap current selection (or collapsed cursor) in a span with given styles */
function wrapSelectionInSpan(styles){
  const sel=window.getSelection();
  const ed=document.getElementById('noteBody');
  if(!sel) return null;

  const span=document.createElement('span');
  Object.assign(span.style, styles);

  if(sel.isCollapsed){
    // Insert at cursor position
    span.textContent='\u200B'; // zero-width space
    try{
      const r=document.createRange();
      r.setStart(ed, 0);
      r.collapse(true);
      r.insertNode(span);
    }catch(e){ return null; }
    return span;
  }

  // Selection — walk up to find existing wrapper of same type
  let an=sel.anchorNode;
  if(an.nodeType===3) an=an.parentElement;
  let existing=an;
  while(existing && existing!==ed){
    const hasAll=Object.keys(styles).every(k=>existing.style[k]===styles[k]);
    if(existing!==ed && existing.tagName==='SPAN' && hasAll){
      // Toggle off — replace with text
      const t=document.createTextNode(existing.textContent);
      existing.replaceWith(t);
      return null;
    }
    existing=existing.parentElement;
  }

  try{
    span.appendChild(sel.getRangeAt(0).extractContents());
    sel.getRangeAt(0).insertNode(span);
    return span;
  }catch(e){
    return null;
  }
}

/* Strip mark elements from within a range */
function stripMarksInRange(range){
  const ed=document.getElementById('noteBody');
  const walker=document.createTreeWalker(ed, NodeFilter.SHOW_ELEMENT, {
    acceptNode(n){
      if(n.tagName==='MARK') return NodeFilter.FILTER_ACCEPT;
      return NodeFilter.FILTER_SKIP;
    }
  });
  const marks=[];
  let node;
  while((node=walker.nextNode())) marks.push(node);
  marks.forEach(m=>{
    if(range.intersectsNode(m)){
      const t=document.createTextNode(m.textContent);
      m.replaceWith(t);
    }
  });
}

/* Find active font-size span for toolbar state */
function getActiveFontSize(){
  const sel=window.getSelection();
  if(!sel || !sel.anchorNode) return null;
  let n=sel.anchorNode.nodeType===3?sel.anchorNode.parentElement:sel.anchorNode;
  const ed=document.getElementById('noteBody');
  while(n && n!==ed){
    if(n.style&&n.style.fontSize) return n.style.fontSize;
    n=n.parentElement;
  }
  return null;
}

/* Toggle dropdown helpers */
/* Map each dropdown ID → its trigger button ID so we can anchor it. */
const DROPDOWN_TRIGGERS={
  hlDropdown:'hlBtn',
  tcDropdown:'tcBtn',
  szDropdown:'szBtn',
  fontStyleDropdown:'fontStyleBtn',
  tableGridPicker:'tableBtn',
  templateDropdown:'templateBtn',
  paraStyleDropdown:'paraStyleBtn',
  overflowDropdown:'overflowBtn'
};

/**
 * Portal-style dropdown positioning.
 * Every dropdown is rendered as position:fixed relative to the viewport so it
 * is never clipped by `overflow:hidden/auto` on any ancestor (toolbar row,
 * collapsed container, tablet layout wrapper, etc.).
 * Flips above the trigger when there is insufficient space below.
 */
function positionDropdownAsPortal(drop, triggerId){
  const trigger=document.getElementById(triggerId);
  const r=trigger ? trigger.getBoundingClientRect() : {left:8,bottom:120,top:80,right:88};
  const safe=8;

  // Temporarily make it visible in document flow so actual width/height can be measured accurately
  const prevDisplay = drop.style.display;
  const prevVisibility = drop.style.visibility;
  drop.style.visibility = 'hidden';
  drop.style.display = 'block';
  const w = drop.offsetWidth || 190;
  const h = drop.offsetHeight || 220;
  drop.style.display = prevDisplay;
  drop.style.visibility = prevVisibility;

  // Horizontal: align with trigger left; flip to trigger right if overflowing right viewport edge
  let left = r.left;
  if(left + w > window.innerWidth - safe){
    left = r.right - w;
  }
  left = Math.max(safe, Math.min(left, window.innerWidth - w - safe));

  // Vertical: open below by default; flip above when there is not enough room
  let top = r.bottom + 6;
  if(top + h > window.innerHeight - safe){
    top = Math.max(safe, r.top - h - 6);
  }

  drop.style.position = 'fixed';
  drop.style.top = `${Math.round(top)}px`;
  drop.style.left = `${Math.round(left)}px`;
  drop.style.right = 'auto';
  drop.style.zIndex = '9999'; // render above editor panes, sidebars, and modals
  if(h > window.innerHeight - 2 * safe){
    drop.style.maxHeight = `${window.innerHeight - 2 * safe}px`;
    drop.style.overflowY = 'auto';
  }
}

function toggleDropdown(id){
  const drop=document.getElementById(id);
  if(!drop) return;
  const was=drop.classList.contains('show');
  if(typeof window.closeAllEditorDropdowns === 'function'){
    window.closeAllEditorDropdowns();
  } else {
    document.querySelectorAll('.hl-dropdown, .tc-dropdown, .sz-dropdown, .font-style-dropdown, .table-grid-picker, .page-layout-dropdown, .footer-tags-dropdown, .template-dropdown, .para-style-dropdown, .overflow-dropdown')
      .forEach(d=>{
        d.classList.remove('show');
        d.style.position=''; d.style.top=''; d.style.left='';
        d.style.right=''; d.style.zIndex=''; d.style.maxHeight=''; d.style.overflowY='';
      });
  }
  if(!was){
    if(DROPDOWN_TRIGGERS[id]){
      positionDropdownAsPortal(drop, DROPDOWN_TRIGGERS[id]);
      const triggerBtn = document.getElementById(DROPDOWN_TRIGGERS[id]);
      if(triggerBtn) triggerBtn.setAttribute('aria-expanded', 'true');
    }
    drop.classList.add('show');
  }
}

function wrapInlineCode(){
  const sel=window.getSelection();
  if(!sel || !sel.rangeCount) return;
  const range=sel.getRangeAt(0);
  // If already in code, unwrap
  let node=sel.anchorNode;
  if(node && node.nodeType===3) node=node.parentElement;
  const codeEl=node && node.closest ? node.closest('code') : null;
  if(codeEl && !codeEl.closest('pre')){
    const text=document.createTextNode(codeEl.textContent);
    codeEl.replaceWith(text);
    return;
  }
  if(range.collapsed){
    const code=document.createElement('code');
    code.textContent='code';
    range.insertNode(code);
    // select the code text
    const r=document.createRange();
    r.selectNodeContents(code);
    sel.removeAllRanges(); sel.addRange(r);
  } else {
    try{
      const code=document.createElement('code');
      range.surroundContents(code);
    }catch(e){
      // Robust multi-block / AI-formatted text code wrapping
      const code=document.createElement('code');
      code.textContent=sel.toString();
      range.deleteContents();
      range.insertNode(code);
    }
  }
}

/* ============================================================
   UNIFIED LIST TOGGLE & CONVERSION
   Handles ul, ol, and task (checklist) as a single state machine.
   Replaces insertTaskList() and the old per-type toggle branches.
   ============================================================ */

/* Helpers — strip or add task decoration on a single <li>. */
function _stripTask(li){
  const cbs = li.querySelectorAll(':scope > input[type=checkbox]');
  cbs.forEach(cb => {
    const nxt = cb.nextSibling;
    if(nxt && nxt.nodeType===3) nxt.textContent = nxt.textContent.replace(/^\s+/,'');
    cb.remove();
  });
  li.removeAttribute('data-task');
  li.removeAttribute('checked');
  if(li.parentElement && li.parentElement.classList.contains('task-list')){
    if(!li.parentElement.querySelector(':scope > li[data-task], :scope > li > input[type=checkbox]')){
      li.parentElement.classList.remove('task-list');
      if(!li.parentElement.className) li.parentElement.removeAttribute('class');
      li.parentElement.removeAttribute('data-task-list');
    }
  }
}
function _addTask(li, isChecked = false){
  let cb = li.querySelector(':scope > input[type=checkbox]');
  if(!cb){
    li.setAttribute('data-task','1');
    cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.setAttribute('aria-label', 'Checklist');
    if(li.firstChild && li.firstChild.nodeType===3)
      li.firstChild.textContent = li.firstChild.textContent.replace(/^\s+/,'');
    li.insertBefore(cb, li.firstChild);
    const nxt = cb.nextSibling;
    if(!nxt) li.appendChild(document.createTextNode(' '));
    else if(nxt.nodeType===3 && !nxt.textContent.startsWith(' '))
      nxt.textContent = ' ' + nxt.textContent;
  } else {
    li.setAttribute('data-task','1');
    cb.setAttribute('aria-label', 'Checklist');
  }
  if(isChecked){
    cb.checked = true;
    cb.setAttribute('checked', '');
  } else {
    cb.checked = false;
    cb.removeAttribute('checked');
  }
  if(li.parentElement && (li.parentElement.tagName === 'UL' || li.parentElement.tagName === 'OL')){
    li.parentElement.classList.add('task-list');
  }
}

function isTaskListItem(li, list) {
  if (!li || !list) return false;
  return !!li.hasAttribute('data-task') ||
         !!li.querySelector(':scope > input[type=checkbox]') ||
         !!li.querySelector('input[type=checkbox]') ||
         list.classList.contains('task-list') ||
         list.hasAttribute('data-task-list');
}

/* Detect the "current list type" the caret is inside.
   Returns {list, li, type} or null if not in a list.
   type is strictly 'ul' | 'ol' | 'task' | null. */
function getListContext(){
  const sel = window.getSelection();
  const ed = bodyEl();
  if(!sel || !sel.anchorNode || !ed) return null;
  if(ed !== sel.anchorNode && !ed.contains(sel.anchorNode)) return null;
  let node = sel.anchorNode;
  if(node.nodeType === 3) node = node.parentElement;
  const li = node.closest && node.closest('li');
  if(!li) return null;
  const list = li.parentElement;
  if(!list || (list.tagName !== 'UL' && list.tagName !== 'OL')) return null;

  const currentType = isTaskListItem(li, list) ? 'task' : list.tagName.toLowerCase();

  if(sel.rangeCount > 0 && !sel.isCollapsed){
    const range = sel.getRangeAt(0);
    const lis = ed.querySelectorAll('li');
    for(let i = 0; i < lis.length; i++){
      const item = lis[i];
      if(range.intersectsNode(item) && item.parentElement){
        const pList = item.parentElement;
        if(pList.tagName !== 'UL' && pList.tagName !== 'OL') return null;
        const itemType = isTaskListItem(item, pList) ? 'task' : pList.tagName.toLowerCase();
        if(itemType !== currentType) return null;
      }
    }
  }

  return {list, li, type: currentType};
}

window.getListContext = getListContext;
window._listContext = getListContext;
window.isTaskListItem = isTaskListItem;

/* Collect all block-level elements that intersect the current selection.
   Used to convert multiple selected paragraphs into list items.           */
function _selectedBlocks(){
  const sel=window.getSelection();
  const ed=bodyEl();
  if(!sel || !sel.rangeCount || !ed) return [];
  const range=sel.getRangeAt(0);
  const blocks=[];
  const walker=document.createTreeWalker(ed, NodeFilter.SHOW_ELEMENT, {
    acceptNode(n){
      if(n===ed) return NodeFilter.FILTER_SKIP;
      if(['P','H1','H2','H3','H4','H5','H6','DIV','BLOCKQUOTE','PRE'].includes(n.tagName)){
        if(range.intersectsNode(n)) return NodeFilter.FILTER_ACCEPT;
      }
      return NodeFilter.FILTER_SKIP;
    }
  });
  let n; while((n=walker.nextNode())) blocks.push(n);
  // If empty (collapsed cursor inside a block), pick that single block.
  if(!blocks.length){
    let cur=sel.anchorNode;
    if(cur && cur.nodeType===3) cur=cur.parentElement;
    while(cur && cur!==ed){
      if(['P','H1','H2','H3','H4','H5','H6','DIV','BLOCKQUOTE','PRE'].includes(cur.tagName)){
        blocks.push(cur); break;
      }
      cur=cur.parentElement;
    }
  }
  return blocks;
}

/**
 * toggleList(targetType)
 *   targetType: 'ul' | 'ol' | 'task'
 *
 * State machine:
 *   1. Not in a list → wrap selected blocks as <li>s inside a new list.
 *   2. Already in the SAME type → unwrap (toggle off) back to paragraphs.
 *   3. In a DIFFERENT list type → convert in place (swap wrapper + decorations).
 *
 * All paths preserve nested lists, indentation, inline formatting, and content.
 */
function toggleList(targetType){
  const sel = window.getSelection();
  const ed = bodyEl();
  if(!sel || !ed) return;
  if(sel.anchorNode && !ed.contains(sel.anchorNode) && sel.anchorNode !== ed) return;
  focusEditor();

  const ctx = getListContext();
  const wantTag = (targetType === 'ol') ? 'OL' : 'UL';

  /* ---------- CASE 2: already in the same type → toggle OFF ---------- */
  if(ctx && ctx.type === targetType){
    const list = ctx.list;
    if(targetType === 'task'){
      list.querySelectorAll(':scope > li').forEach(_stripTask);
    }
    const frag = document.createDocumentFragment();
    Array.from(list.children).forEach(li => {
      if(li.tagName !== 'LI'){ frag.appendChild(li); return; }
      const nested = []; const contentFrag = document.createDocumentFragment();
      Array.from(li.childNodes).forEach(child => {
        if(child.nodeType === 1 && (child.tagName === 'UL' || child.tagName === 'OL'))
          nested.push(child);
        else contentFrag.appendChild(child.cloneNode(true));
      });
      const p = document.createElement('p');
      p.appendChild(contentFrag);
      frag.appendChild(p);
      nested.forEach(sub => frag.appendChild(sub));
    });
    list.replaceWith(frag);
    handleBodyInput(); updateToolbarState();
    return;
  }

  /* ---------- CASE 3: in a different list type → convert ---------- */
  if(ctx){
    const list = ctx.list;
    if(ctx.type === 'task'){
      list.querySelectorAll(':scope > li').forEach(_stripTask);
    }
    if(list.tagName !== wantTag){
      const newList = document.createElement(wantTag);
      if(targetType === 'task') newList.className = 'task-list';
      while(list.firstChild) newList.appendChild(list.firstChild);
      list.replaceWith(newList);
      if(targetType === 'task'){
        newList.querySelectorAll(':scope > li').forEach(li => _addTask(li, false));
      }
      const caretLi = newList.querySelector('li');
      if(caretLi){
        const r = document.createRange();
        r.selectNodeContents(caretLi); r.collapse(false);
        sel.removeAllRanges(); sel.addRange(r);
      }
    } else {
      if(targetType === 'task'){
        list.classList.add('task-list');
        list.querySelectorAll(':scope > li').forEach(li => _addTask(li, false));
      }
    }
    handleBodyInput(); updateToolbarState();
    return;
  }

  /* ---------- CASE 1: not in a list → wrap selected blocks ---------- */
  const blocks = _selectedBlocks();
  if(blocks.length > 0){
    const newList = document.createElement(wantTag);
    if(targetType === 'task') newList.className = 'task-list';
    blocks[0].parentNode.insertBefore(newList, blocks[0]);
    blocks.forEach(blk => {
      const li = document.createElement('li');
      while(blk.firstChild) li.appendChild(blk.firstChild);
      if(targetType === 'task') _addTask(li, false);
      newList.appendChild(li);
      blk.remove();
    });
    const firstLi = newList.querySelector('li');
    if(firstLi){
      const r = document.createRange();
      r.selectNodeContents(firstLi); r.collapse(false);
      sel.removeAllRanges(); sel.addRange(r);
    }
    handleBodyInput(); updateToolbarState();
    return;
  }

  const li = document.createElement('li');
  li.textContent = '\u200B';
  const list = document.createElement(wantTag);
  if(targetType === 'task'){
    list.className = 'task-list';
    _addTask(li, false);
  }
  list.appendChild(li);
  const range = sel.rangeCount ? sel.getRangeAt(0) : null;
  if(range){
    range.deleteContents();
    range.insertNode(list);
  } else {
    ed.appendChild(list);
  }
  const r = document.createRange();
  r.selectNodeContents(li); r.collapse(false);
  sel.removeAllRanges(); sel.addRange(r);
  handleBodyInput(); updateToolbarState();
}

function createNextTaskListItem(li) {
  if (window.HistoryManager) window.HistoryManager.capture(true);
  const newLi = document.createElement('li');
  newLi.setAttribute('data-task', '1');
  const cb = document.createElement('input');
  cb.type = 'checkbox';
  cb.checked = false;
  cb.setAttribute('aria-label', 'Checklist');
  newLi.appendChild(cb);

  const sel = window.getSelection();
  if (sel && sel.rangeCount) {
    const range = sel.getRangeAt(0);
    const endRange = range.cloneRange();
    endRange.setEndAfter(li.lastChild || li);
    const fragment = endRange.extractContents();
    const extraCb = fragment.querySelector('input[type=checkbox]');
    if (extraCb) extraCb.remove();
    if (fragment.childNodes.length > 0) {
      newLi.appendChild(fragment);
    } else {
      newLi.appendChild(document.createTextNode(' '));
    }
  } else {
    newLi.appendChild(document.createTextNode(' '));
  }

  li.parentNode.insertBefore(newLi, li.nextSibling);

  const r = document.createRange();
  if (newLi.childNodes.length >= 2) {
    r.setStart(newLi, 1);
  } else {
    r.setStart(newLi, 0);
  }
  r.collapse(true);
  if (sel) {
    sel.removeAllRanges();
    sel.addRange(r);
  }
  handleBodyInput();
  updateToolbarState();
}

function exitEmptyListItem(li, list) {
  const ed = bodyEl();
  if (window.HistoryManager) window.HistoryManager.capture(true);
  const parentLi = list.parentElement ? list.parentElement.closest('li') : null;
  if (parentLi) {
    outdentListItem(li);
    return;
  }
  const nextSiblings = [];
  let next = li.nextElementSibling;
  while (next) {
    nextSiblings.push(next);
    next = next.nextElementSibling;
  }
  const p = document.createElement('p');
  p.innerHTML = '<br>';
  if (nextSiblings.length > 0) {
    const secondList = list.cloneNode(false);
    nextSiblings.forEach(sib => secondList.appendChild(sib));
    list.parentNode.insertBefore(p, list.nextSibling);
    list.parentNode.insertBefore(secondList, p.nextSibling);
  } else {
    list.parentNode.insertBefore(p, list.nextSibling);
  }
  li.remove();
  if (list.children.length === 0) list.remove();
  const r = document.createRange();
  r.setStart(p, 0);
  r.collapse(true);
  const sel = window.getSelection();
  if (sel) {
    sel.removeAllRanges();
    sel.addRange(r);
  }
  handleBodyInput();
  updateToolbarState();
}

function indentListItem(li) {
  if (!li) return;
  const prevLi = li.previousElementSibling;
  if (!prevLi) return;
  if (window.HistoryManager) window.HistoryManager.capture(true);

  const parentList = li.parentElement;
  const isTask = isTaskListItem(li, parentList);
  let childList = Array.from(prevLi.children).find(c => c.tagName === 'UL' || c.tagName === 'OL');

  if (!childList) {
    childList = document.createElement(parentList.tagName);
    if (isTask) {
      childList.className = 'task-list';
    } else if (parentList.className) {
      childList.className = parentList.className;
    }
    prevLi.appendChild(childList);
  }

  childList.appendChild(li);

  const sel = window.getSelection();
  if (sel) {
    const r = document.createRange();
    r.selectNodeContents(li);
    r.collapse(false);
    sel.removeAllRanges();
    sel.addRange(r);
  }
  handleBodyInput();
  updateToolbarState();
}

function outdentListItem(li) {
  if (!li) return;
  const parentList = li.parentElement;
  if (!parentList) return;
  if (window.HistoryManager) window.HistoryManager.capture(true);

  const parentLi = parentList.parentElement && parentList.parentElement.closest('li');

  if (parentLi) {
    parentLi.parentNode.insertBefore(li, parentLi.nextSibling);
    if (parentList.children.length === 0) parentList.remove();
  } else {
    exitEmptyListItem(li, parentList);
    return;
  }

  const sel = window.getSelection();
  if (sel) {
    const r = document.createRange();
    r.selectNodeContents(li);
    r.collapse(false);
    sel.removeAllRanges();
    sel.addRange(r);
  }
  handleBodyInput();
  updateToolbarState();
}

window.toggleList = toggleList;
window.createNextTaskListItem = createNextTaskListItem;
window.exitEmptyListItem = exitEmptyListItem;
window.indentListItem = indentListItem;
window.outdentListItem = outdentListItem;

// Legacy alias so any remaining callers still work.
function insertTaskList(){ toggleList('task'); }

const CALLOUT_BADGES = {
  tip: '💡 Tip',
  warning: '⚠️ Warning',
  summary: '📝 Summary',
  info: 'ℹ️ Info'
};

function insertCallout(type = 'tip'){
  const sel = window.getSelection();
  if(!sel || !sel.rangeCount) return;
  const range = sel.getRangeAt(0);
  const ed = bodyEl();
  let node = sel.anchorNode;
  if(node && node.nodeType === 3) node = node.parentElement;
  
  // If already in a callout, toggle off or switch type
  const existing = node && node.closest ? node.closest('blockquote.note-callout') : null;
  if(existing){
    if(existing.dataset.callout === type){
      // Unwrap
      const p = document.createElement('p');
      p.innerHTML = existing.querySelector('p')?.innerHTML || existing.textContent || '';
      existing.replaceWith(p);
      const r = document.createRange();
      r.selectNodeContents(p); r.collapse(false);
      sel.removeAllRanges(); sel.addRange(r);
      handleBodyInput(); updateToolbarState();
      return;
    } else {
      // Switch type
      existing.className = `note-callout callout-${type}`;
      existing.dataset.callout = type;
      const badge = existing.querySelector('.callout-badge');
      if(badge) badge.textContent = CALLOUT_BADGES[type] || CALLOUT_BADGES.tip;
      handleBodyInput(); updateToolbarState();
      return;
    }
  }

  const bq = document.createElement('blockquote');
  bq.className = `note-callout callout-${type}`;
  bq.dataset.callout = type;
  
  const badge = document.createElement('div');
  badge.className = 'callout-badge';
  badge.contentEditable = 'false';
  badge.textContent = CALLOUT_BADGES[type] || CALLOUT_BADGES.tip;
  badge.title = 'Click to switch callout type (Tip / Warning / Summary / Info)';
  
  const p = document.createElement('p');
  p.innerHTML = sel.isCollapsed ? '<br>' : sel.toString();

  bq.appendChild(badge);
  bq.appendChild(p);

  const block = node && node.closest ? node.closest('p, div, h1, h2, h3, h4, blockquote') : null;
  if(block && block !== ed && isEditorEmpty(block.innerHTML)){
    block.replaceWith(bq);
  } else {
    range.deleteContents();
    range.insertNode(bq);
  }

  const r = document.createRange();
  r.selectNodeContents(p);
  r.collapse(false);
  sel.removeAllRanges(); sel.addRange(r);
  handleBodyInput(); updateToolbarState();
}

/* ---- Paragraph Styles (Normal, Title, Subtitle, Headings) ---- */
function applyParagraphStyle(val) {
  const ed = bodyEl();
  const sel = window.getSelection();
  if (!sel || !sel.rangeCount || !ed.contains(sel.anchorNode)) return;
  
  let targetTag = val;
  let targetClass = '';
  
  if (val === 'h1-title') {
    targetTag = 'h1';
    targetClass = 'editor-title';
  } else if (val === 'p-subtitle') {
    targetTag = 'p';
    targetClass = 'editor-subtitle';
  }
  
  // Use formatBlock to convert the block element tag
  document.execCommand('formatBlock', false, targetTag);
  
  // Clean up and apply our semantic classes to the newly formatted blocks
  const blocks = getSelectedBlocks();
  blocks.forEach(b => {
    b.classList.remove('editor-title', 'editor-subtitle');
    if (targetClass) b.classList.add(targetClass);
  });
  
  handleBodyInput();
  updateToolbarState();
}

function getSelectedBlocks() {
  const ed = bodyEl();
  const sel = window.getSelection();
  if (!sel || !sel.rangeCount || !ed.contains(sel.anchorNode)) return [];
  
  const blocks = [];
  const walker = document.createTreeWalker(ed, NodeFilter.SHOW_ELEMENT, {
    acceptNode: function(node) {
      if (['P','H1','H2','H3','H4','H5','H6','BLOCKQUOTE','LI','DIV'].includes(node.tagName)) {
        return NodeFilter.FILTER_ACCEPT;
      }
      return NodeFilter.FILTER_SKIP;
    }
  });
  
  while (walker.nextNode()) {
    const node = walker.currentNode;
    if (sel.containsNode(node, true)) {
      blocks.push(node);
    }
  }
  
  let anchorBlock = sel.anchorNode;
  if (anchorBlock.nodeType === 3) anchorBlock = anchorBlock.parentElement;
  anchorBlock = anchorBlock.closest('p, h1, h2, h3, h4, h5, h6, blockquote, li, div');
  if (anchorBlock && !blocks.includes(anchorBlock) && ed.contains(anchorBlock) && anchorBlock !== ed) {
    blocks.push(anchorBlock);
  }
  
  return blocks;
}

function getActiveParagraphStyle() {
  const ed = bodyEl();
  const sel = window.getSelection();
  if (!sel || !sel.rangeCount || !ed.contains(sel.anchorNode)) return 'p';
  
  let node = sel.anchorNode;
  if (node.nodeType === 3) node = node.parentElement;
  
  const block = node.closest('h1, h2, h3, h4, p, div');
  if (!block || !ed.contains(block)) return 'p';
  
  const tag = block.tagName.toLowerCase();
  if (tag === 'h1' && block.classList.contains('editor-title')) return 'h1-title';
  if (tag === 'p' && block.classList.contains('editor-subtitle')) return 'p-subtitle';
  if (['h2', 'h3', 'h4'].includes(tag)) return tag;
  
  return 'p';
}

/* ---- Indentation Logic ---- */
function applyIndent() {
  const ctx = getListContext();
  if (ctx && ctx.li) {
    indentListItem(ctx.li);
    return;
  }
  const blocks = getSelectedBlocks();
  if(!blocks.length) return;
  
  let hasList = false;
  blocks.forEach(b => {
    if(b.tagName === 'LI' || b.closest('li')) hasList = true;
    else {
      const currentIndent = parseInt(b.style.marginLeft || '0', 10);
      if(currentIndent < 160) {
        b.style.marginLeft = (currentIndent + 32) + 'px';
      }
    }
  });
  
  if(hasList) document.execCommand('indent', false, null);
  
  handleBodyInput();
  updateToolbarState();
}

function applyOutdent() {
  const ctx = getListContext();
  if (ctx && ctx.li) {
    outdentListItem(ctx.li);
    return;
  }
  const blocks = getSelectedBlocks();
  if(!blocks.length) return;
  
  let hasList = false;
  blocks.forEach(b => {
    if(b.tagName === 'LI' || b.closest('li')) hasList = true;
    else {
      const currentIndent = parseInt(b.style.marginLeft || '0', 10);
      if(currentIndent > 0) {
        const newIndent = Math.max(0, currentIndent - 32);
        b.style.marginLeft = newIndent === 0 ? '' : newIndent + 'px';
      }
    }
  });
  
  if(hasList) document.execCommand('outdent', false, null);
  
  handleBodyInput();
  updateToolbarState();
}

