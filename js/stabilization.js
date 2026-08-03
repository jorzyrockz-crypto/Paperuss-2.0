/* ============================================================
   PAPERUSS 2.0 STABILIZATION RUNTIME
   Shared release metadata, data normalization, and HTML safety.
   ============================================================ */
(function initPaperussStabilization(global){
  'use strict';

  const BUILD=Object.freeze({
    name:'PapeRuss 2.0 Stabilization',
    version:'2.0.1-stabilization',
    cacheName:'paperuss-shell-v31',
    schemaVersion:4
  });

  const ALLOWED_TAGS=new Set([
    'A','ABBR','AUDIO','B','BLOCKQUOTE','BR','BUTTON','CAPTION','CODE','COL','COLGROUP',
    'DEL','DIV','EM','FIGCAPTION','FIGURE','H1','H2','H3','H4','H5','H6','HR','I','IMG',
    'INPUT','INS','KBD','LI','MARK','OL','P','PRE','S','SMALL','SOURCE','SPAN','STRIKE',
    'STRONG','SUB','SUP','TABLE','TBODY','TD','TFOOT','TH','THEAD','TR','U','UL','VIDEO'
  ]);
  const DROP_CONTENT_TAGS=new Set([
    'APPLET','BASE','EMBED','FORM','FRAME','FRAMESET','HEAD','IFRAME','LINK','META','NOSCRIPT',
    'OBJECT','SCRIPT','STYLE','TEMPLATE','TITLE','SVG','MATH'
  ]);
  const COMMON_ATTRS=new Set([
    'alt','aria-label','aria-hidden','aria-describedby','aria-labelledby','class','contenteditable',
    'dir','download','draggable','height','hidden','lang','role','spellcheck','style','title','width'
  ]);
  const TAG_ATTRS={
    A:new Set(['href','target','rel']),
    AUDIO:new Set(['controls','loop','muted','preload','src']),
    BUTTON:new Set(['type','disabled']),
    COL:new Set(['span']),
    INPUT:new Set(['type','checked','disabled']),
    IMG:new Set(['src','loading','decoding']),
    LI:new Set(['value']),
    OL:new Set(['start','reversed','type']),
    SOURCE:new Set(['src','type']),
    TABLE:new Set(['cellpadding','cellspacing']),
    TD:new Set(['colspan','rowspan']),
    TH:new Set(['colspan','rowspan','scope']),
    VIDEO:new Set(['controls','loop','muted','playsinline','poster','preload','src'])
  };
  const URL_ATTRS=new Set(['href','src','poster']);
  const BOOLEAN_ATTRS=new Set(['checked','controls','disabled','hidden','loop','muted','playsinline','reversed']);
  const VALID_REPEAT=new Set(['daily','weekly','monthly','yearly']);
  const VALID_PRIORITY=new Set(['low','medium','high']);
  const SAFE_ID=/^[A-Za-z0-9_.:-]{1,200}$/;

  function isSafeUrl(raw,attr,tag){
    const value=String(raw||'').trim();
    if(!value) return true;
    if(value.startsWith('#') || value.startsWith('./') || value.startsWith('../') || value.startsWith('/')) return true;
    const lower=value.replace(/[\u0000-\u0020]+/g,'').toLowerCase();
    if(lower.startsWith('javascript:') || lower.startsWith('vbscript:') || lower.startsWith('file:')) return false;
    if(lower.startsWith('data:')){
      if(attr==='href') return false;
      if(tag==='IMG') return /^data:image\/(?:png|gif|jpe?g|webp|avif);/i.test(value);
      if(tag==='AUDIO' || tag==='SOURCE') return /^data:(?:audio|video)\/[a-z0-9.+-]+;/i.test(value);
      if(tag==='VIDEO') return /^data:video\/[a-z0-9.+-]+;/i.test(value);
      return false;
    }
    if(lower.startsWith('blob:')) return ['href','src','poster'].includes(attr);
    try{
      const url=new URL(value,global.location?.href||'https://paperuss.invalid/');
      return ['http:','https:','mailto:','tel:'].includes(url.protocol) || url.origin===(global.location?.origin||'https://paperuss.invalid');
    }catch(_){
      return false;
    }
  }

  function sanitizeStyle(raw){
    const value=String(raw||'');
    if(!value) return '';
    const lower=value.toLowerCase();
    if(/expression\s*\(|javascript\s*:|vbscript\s*:|@import|behavior\s*:|-moz-binding|url\s*\(/i.test(lower)) return '';
    const probe=document.createElement('span');
    probe.setAttribute('style',value);
    const safe=[];
    const ALLOWED = new Set(['color', 'background-color', 'margin-left']);
    for(let i=0;i<probe.style.length;i++){
      const prop=probe.style[i];
      if(!ALLOWED.has(prop)) continue;
      const propValue=probe.style.getPropertyValue(prop);
      const priority=probe.style.getPropertyPriority(prop);
      if(/expression\s*\(|javascript\s*:|vbscript\s*:|@import|url\s*\(/i.test(propValue)) continue;
      
      if(prop === 'margin-left'){
        const px = parseInt(propValue, 10);
        if(isNaN(px) || px < 0 || px > 400 || !propValue.endsWith('px')) continue;
      }
      
      safe.push(`${prop}:${propValue}${priority?' !important':''}`);
    }
    return safe.join(';');
  }

  function sanitizeElementAttributes(el){
    const tag=el.tagName;
    const tagAllowed=TAG_ATTRS[tag]||new Set();
    Array.from(el.attributes).forEach(attr=>{
      const name=attr.name.toLowerCase();
      const value=attr.value;
      if(name.startsWith('on') || name==='id' || name==='srcdoc' || name==='formaction' || name==='autofocus'){
        el.removeAttribute(attr.name); return;
      }
      const isData=name.startsWith('data-') && /^data-[a-z0-9_.:-]+$/i.test(name);
      const isAria=name.startsWith('aria-') && /^aria-[a-z0-9_.:-]+$/i.test(name);
      if(!COMMON_ATTRS.has(name) && !tagAllowed.has(name) && !isData && !isAria){
        el.removeAttribute(attr.name); return;
      }
      if(URL_ATTRS.has(name) && !isSafeUrl(value,name,tag)){
        el.removeAttribute(attr.name); return;
      }
      if(name==='style'){
        const safe=sanitizeStyle(value);
        if(safe) el.setAttribute('style',safe); else el.removeAttribute('style');
      }
      if(name==='target' && value!=='_blank' && value!=='_self') el.removeAttribute('target');
      if(name==='contenteditable' && value!=='true' && value!=='false') el.removeAttribute('contenteditable');
      if(BOOLEAN_ATTRS.has(name) && value==='false') el.removeAttribute(attr.name);
    });

    if(tag==='A' && el.getAttribute('target')==='_blank') el.setAttribute('rel','noopener noreferrer');
    if(tag==='BUTTON') el.setAttribute('type','button');
    if(tag==='INPUT'){
      if((el.getAttribute('type')||'').toLowerCase()!=='checkbox'){
        el.replaceWith(document.createTextNode(''));
        return;
      }else{
        Array.from(el.attributes).forEach(attr => {
          const name = attr.name.toLowerCase();
          if(name !== 'type' && name !== 'checked' && name !== 'aria-label'){
            el.removeAttribute(attr.name);
          }
        });
        el.setAttribute('type','checkbox');
      }
    }
    if((tag==='AUDIO'||tag==='VIDEO') && !el.hasAttribute('controls')) el.setAttribute('controls','');
    if(tag==='IMG'){
      if(!el.hasAttribute('loading')) el.setAttribute('loading','lazy');
      if(!el.hasAttribute('decoding')) el.setAttribute('decoding','async');
    }
  }

  function isLeafContentContaminated(input){
    const html = String(input||'');
    if (!html) return false;
    const MARKERS = [
      'data-paperuss-ui',
      'editor-topbar',
      'editor-toolbar',
      'formatBar',
      'editor-footer',
      'findPanel',
      'saveStatus',
      'pageLayoutPicker',
      'footerTagsPicker',
      'toolbarCollapseBtn',
      'leafToggleBtn',
      'leavesDrawerOverlay',
      'leavesDrawer',
      'leafContextMenu',
      'leafTitleBar',
      'editor-more-wrap',
      'editor-leaf-context',
      'para-style-picker',
      'font-style-picker',
      'sz-picker',
      'hl-picker',
      'tc-picker',
      'tbl-picker',
      'template-picker',
      'zoom-controls',
      'footer-tags-picker',
      'noteTitle',
      'backBtn',
      'undoBtn',
      'redoBtn',
      'distractionFreeBtn',
      'pinBtn',
      'archiveBtn',
      'restoreBtn',
      'deleteBtn',
      'editorMoreBtn',
      'id="noteBody"',
      'id="editorContent"',
      'id="editorScroll"',
      'data-paperuss-content-root'
    ];
    for (let i = 0; i < MARKERS.length; i++) {
      if (html.indexOf(MARKERS[i]) !== -1) return true;
    }
    return false;
  }

  function cleanInternalEditorUI(input) {
    if (input === null || input === undefined) return '';
    const html = typeof input === 'string' ? input : (input.innerHTML || '');
    if (!html || !html.trim()) return '';

    const contaminated = isLeafContentContaminated(html);
    if (contaminated && typeof console !== 'undefined' && console.warn) {
      console.warn("[PapeRuss] Internal editor UI detected in Leaf content");
    }

    const doc = new DOMParser().parseFromString(`<body>${html}</body>`, 'text/html');
    const body = doc.body;

    const roots = Array.from(body.querySelectorAll('#noteBody, [data-paperuss-content-root="true"], .note-editor'));
    let targetNode = body;
    if (roots.length > 0) {
      for (let i = 0; i < roots.length; i++) {
        if (roots[i].querySelectorAll('#noteBody, [data-paperuss-content-root="true"], .note-editor').length === 0) {
          targetNode = roots[i];
          break;
        }
      }
    }

    const clone = targetNode.cloneNode(true);

    const UI_SELECTOR = [
      '[data-paperuss-ui="true"]',
      '.editor-topbar',
      '.editor-toolbar',
      '#formatBar',
      '.editor-footer',
      '#findPanel',
      '#saveStatus',
      '#pageLayoutPicker',
      '#footerTagsPicker',
      '#toolbarCollapseBtn',
      '#leafToggleBtn',
      '.leaf-toggle-fab',
      '#leavesDrawerOverlay',
      '#leavesDrawer',
      '.leaves-sheet',
      '#leafContextMenu',
      '.overflow-picker',
      '#editorEmpty',
      '.editor-more-wrap',
      '.editor-leaf-context',
      '.para-style-picker',
      '.font-style-picker',
      '.sz-picker',
      '.hl-picker',
      '.tc-picker',
      '.tbl-picker',
      '.template-picker',
      '.zoom-controls',
      '.page-layout-picker',
      '.footer-tags-picker',
      '#noteTitle',
      '#backBtn',
      '#undoBtn',
      '#redoBtn',
      '#distractionFreeBtn',
      '#pinBtn',
      '#archiveBtn',
      '#restoreBtn',
      '#deleteBtn',
      '#editorMoreBtn',
      '#editorContent',
      '#editorScroll',
      '.embed-editor-toolbar',
      '.embed-resize-handle',
      '.embed-live-player-wrap'
    ].join(',');

    clone.querySelectorAll(UI_SELECTOR).forEach(el => el.remove());
    if (typeof window.dehydrateEmbeds === 'function') {
      window.dehydrateEmbeds(clone);
    }

    const FORBIDDEN_IDS = ['noteBody', 'editorContent', 'editorScroll', 'formatBar', 'noteTitle', 'editorEmpty', 'findPanel'];
    clone.querySelectorAll('[id], [data-paperuss-content-root], [data-paperuss-ui]').forEach(el => {
      if (FORBIDDEN_IDS.includes(el.id)) {
        el.removeAttribute('id');
      }
      el.removeAttribute('data-paperuss-content-root');
      el.removeAttribute('data-paperuss-ui');
      el.removeAttribute('data-active-leaf-id');
    });

    clone.querySelectorAll('.link-card .broken-media-card, a[data-media-kind="link"] .broken-media-card, .mc-icon .broken-media-card, .media-card[data-media-kind="link"] .broken-media-card').forEach(bmc => {
      const placeholder = document.createElement('span');
      placeholder.className = 'domain-icon-placeholder';
      placeholder.style.cssText = 'display:inline-flex;align-items:center;justify-content:center;width:100%;height:100%;color:inherit;';
      placeholder.innerHTML = '<i data-lucide="globe" class="w-4 h-4"></i>';
      bmc.replaceWith(placeholder);
    });

    return clone.innerHTML;
  }

  function sanitizeNoteHTML(input){
    const html=String(input||'');
    if(!html) return '';
    const cleanedUI=cleanInternalEditorUI(html);
    const parsed=new DOMParser().parseFromString(`<body>${cleanedUI}</body>`,'text/html');
    const body=parsed.body;
    const walk=document.createTreeWalker(body,NodeFilter.SHOW_ELEMENT);
    const nodes=[];
    while(walk.nextNode()) nodes.push(walk.currentNode);
    nodes.reverse().forEach(el=>{
      const tag=el.tagName;
      if(DROP_CONTENT_TAGS.has(tag)){
        el.remove(); return;
      }
      if(!ALLOWED_TAGS.has(tag)){
        el.replaceWith(...Array.from(el.childNodes)); return;
      }
      sanitizeElementAttributes(el);
    });
    body.querySelectorAll('input[type=checkbox]').forEach(cb => {
      if(cb.checked || cb.hasAttribute('checked')){
        cb.setAttribute('checked', '');
      } else {
        cb.removeAttribute('checked');
      }
      const li = cb.closest('li');
      if(li && !li.hasAttribute('data-task')){
        li.setAttribute('data-task', '1');
        if(li.parentElement && (li.parentElement.tagName === 'UL' || li.parentElement.tagName === 'OL')){
          li.parentElement.classList.add('task-list');
        }
      }
    });
    return body.innerHTML;
  }

  function sanitizeId(value){
    const id=String(value||'').trim();
    return SAFE_ID.test(id)?id:'';
  }

  function safeNumber(value,fallback=null){
    const num=Number(value);
    return Number.isFinite(num)?num:fallback;
  }

  function sanitizeNoteRecord(note){
    if(!note || typeof note!=='object') return null;
    note.id=sanitizeId(note.id);
    if(!note.id) return null;
    note.title=String(note.title||'').slice(0,500);
    note.content=sanitizeNoteHTML(note.content||'');
    note.tags=Array.isArray(note.tags)
      ? Array.from(new Set(note.tags.filter(t=>typeof t==='string').map(t=>t.trim()).filter(Boolean).slice(0,100)))
      : [];
    note.pinned=!!note.pinned;
    note.archived=!!note.archived;
    note.fontStyle=['sans','serif','mono','rounded'].includes(note.fontStyle)?note.fontStyle:'sans';
    note.pageViewEnabled=note.pageViewEnabled===true;
    note.pageSize=['auto','a4','letter','legal'].includes(note.pageSize)?note.pageSize:'a4';
    note.pageOrientation=['portrait','landscape'].includes(note.pageOrientation)?note.pageOrientation:'portrait';
    note.pageMargins=['narrow','normal','wide'].includes(note.pageMargins)?note.pageMargins:'normal';
    if(note.coverImage && typeof note.coverImage==='object'){
      const source=String(note.coverImage.src||'').slice(0,5_000_000);
      const mediaId=sanitizeId(note.coverImage.mediaId);
      const positionY=Math.max(0,Math.min(100,safeNumber(note.coverImage.positionY,50)));
      note.coverImage=source?{src:source,mediaId,positionY}:null;
    } else {
      note.coverImage=null;
    }
    note.createdAt=safeNumber(note.createdAt,Date.now());
    note.updatedAt=safeNumber(note.updatedAt,note.createdAt);
    if(note.deletedAt!=null) note.deletedAt=safeNumber(note.deletedAt,null);
    if(note.calendarStart!=null) note.calendarStart=safeNumber(note.calendarStart,null);
    if(note.calendarEnd!=null) note.calendarEnd=safeNumber(note.calendarEnd,note.calendarStart);
    note.calendarNotify=note.calendarNotify===true;
    const taggedRepeat=note.tags.find(tag=>tag.startsWith('repeat-'))?.slice(7);
    note.calendarRepeat=VALID_REPEAT.has(note.calendarRepeat)
      ? note.calendarRepeat
      : (VALID_REPEAT.has(taggedRepeat)?taggedRepeat:null);
    if(note.calendarLastNotifiedAt!=null) note.calendarLastNotifiedAt=safeNumber(note.calendarLastNotifiedAt,null);
    return note;
  }

  function sanitizeNoteCollection(value){
    if(!Array.isArray(value)) return [];
    const seen=new Set();
    return value.map(sanitizeNoteRecord).filter(n=>{
      if(!n || seen.has(n.id)) return false;
      seen.add(n.id); return true;
    });
  }


  function sanitizeTaskRecord(task){
    if(!task || typeof task!=='object') return null;
    task.id=sanitizeId(task.id);
    if(!task.id) return null;
    task.noteId=sanitizeId(task.noteId);
    if(!task.noteId) return null;
    task.text=String(task.text||'').slice(0,1000);
    task.completed=task.completed===true;
    task.priority=VALID_PRIORITY.has(task.priority)?task.priority:'medium';
    task.due=task.due==null?null:safeNumber(task.due,null);
    task.notified=task.notified===true;
    task.groupId=task.groupId==null?'':sanitizeId(task.groupId);
    task.createdAt=safeNumber(task.createdAt,Date.now());
    task.updatedAt=safeNumber(task.updatedAt,task.createdAt);
    return task;
  }

  function sanitizeTaskCollection(value){
    if(!Array.isArray(value)) return [];
    const seen=new Set();
    return value.map(sanitizeTaskRecord).filter(task=>{
      if(!task || seen.has(task.id)) return false;
      seen.add(task.id); return true;
    });
  }

  global.PAPERUSS_BUILD=BUILD;
  global.cleanInternalEditorUI=cleanInternalEditorUI;
  global.isLeafContentContaminated=isLeafContentContaminated;
  global.sanitizeNoteHTML=sanitizeNoteHTML;
  global.sanitizeNoteRecord=sanitizeNoteRecord;
  global.sanitizeNoteCollection=sanitizeNoteCollection;
  global.sanitizeTaskRecord=sanitizeTaskRecord;
  global.sanitizeTaskCollection=sanitizeTaskCollection;
  global.paperussSafeId=sanitizeId;
  global.paperussSafeUrl=isSafeUrl;
})(window);
