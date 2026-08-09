(function(){
  let leaflineDebounceTimer = null;
  let cachedHeadings = [];
  let cachedAllEntries = [];

  window.state = window.state || {};
  window.state.drawerMode = window.state.drawerMode || 'leaves';
  window.state.leaflineScope = window.state.leaflineScope || 'current';

  function escapeHtml(value) {
    return String(value == null ? '' : value).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#039;');
  }

  window.setDrawerMode = function(mode) {
    if (mode !== 'leaves' && mode !== 'leafline') return;
    window.state.drawerMode = mode;
    const leavesTab = document.getElementById('tabDrawerLeaves');
    const leaflineTab = document.getElementById('tabDrawerLeafline');
    [leavesTab, leaflineTab].forEach((tab, index) => {
      if (!tab) return;
      const active = mode === (index === 0 ? 'leaves' : 'leafline');
      tab.classList.toggle('active', active);
      tab.setAttribute('aria-selected', String(active));
      tab.style.color = active ? '' : 'var(--fg-muted)';
    });
    const content = document.getElementById('leavesDrawerContent');
    if (!content) return;
    if (mode === 'leaves') {
      if (typeof window.renderLeavesList === 'function') window.renderLeavesList(content);
    } else window.renderLeafline(content);
  };

  function getHeadingsFromRoot(root) {
    if (!root) return [];
    return Array.from(root.querySelectorAll('h1, h2, h3, h4'))
      .filter(node => !node.closest('[data-paperuss-page-ui="true"], [data-paperuss-ui="true"]'))
      .map(node => ({
        el:node,
        text:node.innerText || node.textContent || 'Untitled Heading',
        level:parseInt(node.tagName.substring(1),10),
        isTitle:node.tagName === 'H1' && node.classList.contains('editor-title')
      }));
  }

  function getHeadings() { return getHeadingsFromRoot(document.getElementById('noteBody')); }
  function getHeadingsFromHTML(html) {
    const template = document.createElement('template');
    template.innerHTML = html || '';
    return getHeadingsFromRoot(template.content).map(({text,level,isTitle}) => ({text,level,isTitle}));
  }
  function getCurrentNote() {
    if (typeof window.getNote === 'function') return window.getNote(window.state.currentId);
    return (window.notes || []).find(note => note.id === window.state.currentId) || null;
  }
  function getContext(note) {
    let branchName = note?.category || 'Unassigned';
    if (note?.branchId && window.BranchEngine) {
      const branch = window.BranchEngine.loadBranches().find(item => item.id === note.branchId);
      if (branch) branchName = branch.name;
    }
    return { branchName, leafTitle:window.currentActiveLeaf?.title || 'Main' };
  }
  function scopeControls() {
    const scope = window.state.leaflineScope;
    return `<div class="leafline-scope" role="tablist" aria-label="Leafline scope"><button type="button" role="tab" aria-selected="${scope==='current'}" class="${scope==='current'?'active':''}" onclick="window.setLeaflineScope('current')">Current Leaf</button><button type="button" role="tab" aria-selected="${scope==='all'}" class="${scope==='all'?'active':''}" onclick="window.setLeaflineScope('all')">All Leaflines</button></div>`;
  }
  function itemMeta(h) {
    return h.isTitle ? 'Document title' : ({1:'Primary heading',2:'Section',3:'Subsection',4:'Detail'}[h.level] || `Heading ${h.level}`);
  }

  function updateCurrentDOM(container, headings) {
    const note = getCurrentNote();
    const context = getContext(note);
    let html = '<div class="leafline-container" role="region" aria-label="Current Leaf outline"><div class="leafline-heading"><strong>Leafline</strong></div>' + scopeControls();
    html += `<div class="leafline-context">${escapeHtml(context.branchName)} · ${escapeHtml(context.leafTitle)}</div>`;
    if (!headings.length) {
      container.innerHTML = html + '<div class="list-empty leafline-empty">Add headings to this Leaf to create its Leafline.</div></div>';
      return;
    }
    html += '<div class="leafline-track">';
    headings.forEach((h,index) => {
      const depth = Math.max(0,Math.min(3,h.level-1));
      html += `<button type="button" class="leafline-item" data-index="${index}" style="--leafline-depth:${depth}" aria-label="Jump to ${escapeHtml(h.text)}" onclick="window.scrollToLeaflineHeading(${index})"><span class="leafline-dot" aria-hidden="true"></span><span class="leafline-item-copy"><span class="leafline-item-title">${escapeHtml(h.text)}</span><span class="leafline-item-meta">${itemMeta(h)}</span></span></button>`;
    });
    container.innerHTML = html + '</div></div>';
    highlightActiveHeading();
  }

  async function renderAllLeaflines(container) {
    const note = getCurrentNote();
    if (!note) {
      container.innerHTML = '<div class="leafline-container">' + scopeControls() + '<div class="list-empty leafline-empty">Select a Note to view its Leaflines.</div></div>';
      return;
    }
    const noteId = note.id;
    const leafApi = window.paperussLeaves;
    const order = leafApi?.getNoteLeafOrder(note) || [note.defaultLeafId || 'virtual_main_' + note.id];
    const activeLeafId = leafApi?.getNoteActiveLeafId(note) || order[0];
    const groups = [];
    cachedAllEntries = [];
    for (let leafIndex=0; leafIndex<order.length; leafIndex++) {
      const leafId = order[leafIndex];
      let leaf = leafId === activeLeafId ? window.currentActiveLeaf : null;
      if (!leaf && leafApi?.leafGet) leaf = await leafApi.leafGet(leafId);
      if (!leaf && (leafId === 'virtual_main_' + note.id || leafIndex === 0)) leaf = leafApi?.getVirtualMainLeaf(note) || {id:leafId,title:'Main',content:note.content||''};
      const headings = leafId === activeLeafId ? getHeadings() : getHeadingsFromHTML(leaf?.content || '');
      const group = {title:leaf?.title || `Leaf ${leafIndex+1}`, entries:[]};
      headings.forEach((heading,headingIndex) => {
        const entry = {leafId,headingIndex,heading,index:cachedAllEntries.length};
        cachedAllEntries.push(entry);
        group.entries.push(entry);
      });
      groups.push(group);
    }
    if (window.state.currentId !== noteId || window.state.leaflineScope !== 'all') return;
    const context = getContext(note);
    let html = '<div class="leafline-container" role="region" aria-label="All Leaflines in current Note"><div class="leafline-heading"><strong>All Leaflines</strong></div>' + scopeControls();
    html += `<div class="leafline-context">${escapeHtml(context.branchName)} · ${escapeHtml(note.title || 'Untitled Note')}</div>`;
    groups.forEach(group => {
      html += `<section class="leafline-group"><div class="leafline-group-title">${escapeHtml(group.title)}</div>`;
      if (!group.entries.length) html += '<div class="leafline-group-empty">No headings</div>';
      else {
        html += '<div class="leafline-track">';
        group.entries.forEach(entry => {
          const h=entry.heading, depth=Math.max(0,Math.min(3,h.level-1));
          html += `<button type="button" class="leafline-item" style="--leafline-depth:${depth}" onclick="window.openLeaflineEntry(${entry.index})"><span class="leafline-dot" aria-hidden="true"></span><span class="leafline-item-copy"><span class="leafline-item-title">${escapeHtml(h.text)}</span><span class="leafline-item-meta">${itemMeta(h)}</span></span></button>`;
        });
        html += '</div>';
      }
      html += '</section>';
    });
    container.innerHTML = html + '</div>';
  }

  window.renderLeafline = function(container=null) {
    const targets = container ? [container] : [window.state.listMode==='leafline'?document.getElementById('notesContainer'):null,window.state.drawerMode==='leafline'?document.getElementById('leavesDrawerContent'):null].filter(Boolean);
    if (window.state.leaflineScope === 'all') { targets.forEach(renderAllLeaflines); return; }
    cachedHeadings = getHeadings();
    targets.forEach(target => updateCurrentDOM(target,cachedHeadings));
  };
  window.setLeaflineScope = function(scope) {
    if (scope !== 'current' && scope !== 'all') return;
    window.state.leaflineScope = scope;
    window.renderLeafline();
  };

  function scrollHeading(heading) {
    const scroller=document.getElementById('editorScroll');
    if (!scroller || !heading?.el) return;
    const sr=scroller.getBoundingClientRect(), er=heading.el.getBoundingClientRect();
    scroller.scrollTo({top:scroller.scrollTop+(er.top-sr.top)-20,behavior:'smooth'});
  }
  window.scrollToLeaflineHeading = function(index) { scrollHeading(cachedHeadings[index]); };
  window.openLeaflineEntry = async function(index) {
    const entry=cachedAllEntries[index];
    if (!entry) return;
    if (window.currentActiveLeaf?.id !== entry.leafId && typeof window.switchLeafAction === 'function') await window.switchLeafAction(entry.leafId);
    let attempts=0;
    const locate=()=>{
      const editor=document.getElementById('noteBody');
      if (editor?.getAttribute('data-active-leaf-id')===entry.leafId || window.currentActiveLeaf?.id===entry.leafId) {
        const heading=getHeadings()[entry.headingIndex];
        if (heading) { scrollHeading(heading); return; }
      }
      if (++attempts<12) window.requestAnimationFrame(locate);
    };
    window.requestAnimationFrame(locate);
  };

  function highlightActiveHeading(fromCaret=false) {
    if (!cachedHeadings.length) return;
    const scroller=document.getElementById('editorScroll');
    if (!scroller) return;
    let activeIndex=0;
    if (fromCaret) {
      const selection=window.getSelection();
      let node=selection?.anchorNode;
      if (node?.nodeType===3) node=node.parentNode;
      if (node && scroller.contains(node)) cachedHeadings.forEach((h,i)=>{if(h.el.getBoundingClientRect().top<=node.getBoundingClientRect().top+10)activeIndex=i;});
    } else {
      const line=scroller.getBoundingClientRect().top+Math.min(180,scroller.getBoundingClientRect().height*.32);
      cachedHeadings.forEach((h,i)=>{if(h.el.getBoundingClientRect().top<=line)activeIndex=i;});
    }
    document.querySelectorAll('.leafline-item[data-index]').forEach(item=>{
      const active=parseInt(item.dataset.index,10)===activeIndex;
      item.classList.toggle('active',active);
      if(active)item.setAttribute('aria-current','location');else item.removeAttribute('aria-current');
    });
  }

  let scrollTicking=false;
  document.getElementById('editorScroll')?.addEventListener('scroll',()=>{if(!scrollTicking){window.requestAnimationFrame(()=>{highlightActiveHeading(false);scrollTicking=false;});scrollTicking=true;}},{passive:true});
  document.addEventListener('selectionchange',()=>{if(window.state&&(window.state.listMode==='leafline'||window.state.drawerMode==='leafline')&&document.activeElement?.closest('#noteBody'))highlightActiveHeading(true);});
  window.triggerLeaflineUpdate=function(){if(leaflineDebounceTimer)clearTimeout(leaflineDebounceTimer);leaflineDebounceTimer=setTimeout(()=>{if(window.state.listMode==='leafline'||window.state.drawerMode==='leafline')window.renderLeafline();},500);};
})();
