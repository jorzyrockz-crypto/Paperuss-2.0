(function(){
  let leaflineDebounceTimer = null;
  let cachedHeadings = [];
  
  window.state = window.state || {};
  window.state.drawerMode = window.state.drawerMode || 'leaves';

  window.setDrawerMode = function(mode) {
    window.state.drawerMode = mode;
    
    const tabLeaves = document.getElementById('tabDrawerLeaves');
    const tabLeafline = document.getElementById('tabDrawerLeafline');
    
    if (tabLeaves) {
      if (mode === 'leaves') {
        tabLeaves.classList.add('active');
        tabLeaves.style.color = '';
      } else {
        tabLeaves.classList.remove('active');
        tabLeaves.style.color = 'var(--fg-muted)';
      }
    }
    
    if (tabLeafline) {
      if (mode === 'leafline') {
        tabLeafline.classList.add('active');
        tabLeafline.style.color = '';
      } else {
        tabLeafline.classList.remove('active');
        tabLeafline.style.color = 'var(--fg-muted)';
      }
    }
    
    const drawerContent = document.getElementById('leavesDrawerContent');
    if (drawerContent) {
      if (mode === 'leaves') {
        if (typeof window.renderLeavesList === 'function') window.renderLeavesList(drawerContent);
      } else {
        window.renderLeafline(drawerContent);
      }
    }
  };
  
  const origOpenLeavesDrawer = window.openLeavesDrawer;
  if(origOpenLeavesDrawer) {
    window.openLeavesDrawer = function() {
      origOpenLeavesDrawer();
      const contentEl = document.getElementById('leavesDrawerContent');
      if (contentEl && window.state.drawerMode === 'leafline') {
        window.renderLeafline(contentEl);
      }
    };
  }

  function getHeadings() {
    const ed = document.getElementById('noteBody');
    if(!ed) return [];
    
    const nodes = ed.querySelectorAll('h1.editor-title, h2, h3, h4');
    const headings = [];
    nodes.forEach((n, i) => {
      n.dataset.leaflineIndex = i; // Does not persist in storage because stabilization.js strips non-paperuss data attributes? Wait, dataset.leaflineIndex will be stripped if it's not allowed, which is good! Wait, we don't even need to modify DOM. We can just keep the element reference!
      headings.push({
        el: n,
        text: n.innerText || n.textContent || 'Untitled Heading',
        level: parseInt(n.tagName.substring(1), 10),
        isTitle: n.tagName === 'H1' && n.classList.contains('editor-title')
      });
    });
    return headings;
  }
  
  function updateLeaflineDOM(container, headings) {
    if(!headings || headings.length === 0) {
      container.innerHTML = '<div class="list-empty" style="padding:20px;text-align:center;color:var(--fg-muted);font-size:13px;">No headings found in the current view.</div>';
      return;
    }
    
    let html = '<div class="leafline-container" style="padding:12px;overflow-y:auto;height:100%;">';
    headings.forEach((h, i) => {
      let indent = (h.level - 1) * 12;
      if (h.isTitle) indent = 0;
      
      html += `<div class="leafline-item" data-index="${i}" onclick="window.scrollToLeaflineHeading(${i})" style="padding:6px 8px; margin-left:${indent}px; border-radius:4px; cursor:pointer; font-size:13px; color:var(--fg-secondary); white-space:nowrap; overflow:hidden; text-overflow:ellipsis; transition:all 0.15s ease;">
        ${h.text}
      </div>`;
    });
    html += '</div>';
    
    container.innerHTML = html;
    
    if (typeof window.refreshIcons === 'function') window.refreshIcons();
    highlightActiveHeading();
  }
  
  window.renderLeafline = function(container = null) {
    cachedHeadings = getHeadings();
    
    if (!container) {
      if (window.state.listMode === 'leafline') {
        const c = document.getElementById('notesContainer');
        if (c) updateLeaflineDOM(c, cachedHeadings);
      }
      if (window.state.drawerMode === 'leafline') {
        const drawer = document.getElementById('leavesDrawerContent');
        if (drawer) updateLeaflineDOM(drawer, cachedHeadings);
      }
    } else {
      updateLeaflineDOM(container, cachedHeadings);
    }
  };
  
  window.scrollToLeaflineHeading = function(index) {
    const heading = cachedHeadings[index];
    if (heading && heading.el) {
      const scroller = document.getElementById('editorScroll');
      if (scroller) {
        const scrollerRect = scroller.getBoundingClientRect();
        const elRect = heading.el.getBoundingClientRect();
        const scrollTop = scroller.scrollTop + (elRect.top - scrollerRect.top) - 20;
        scroller.scrollTo({ top: scrollTop, behavior: 'smooth' });
      }
    }
  };
  
  function highlightActiveHeading(fromCaret = false) {
    if (!cachedHeadings.length) return;
    
    const scroller = document.getElementById('editorScroll');
    if (!scroller) return;
    
    let activeIndex = 0;
    
    if (fromCaret) {
      const selection = window.getSelection();
      if (selection && selection.rangeCount > 0) {
        let node = selection.anchorNode;
        if (node && node.nodeType === 3) node = node.parentNode;
        
        if (node && scroller.contains(node)) {
          const nodeRect = node.getBoundingClientRect();
          let minDiff = Infinity;
          cachedHeadings.forEach((h, i) => {
            const hRect = h.el.getBoundingClientRect();
            if (hRect.top <= nodeRect.top + 10) {
              activeIndex = i;
            }
          });
        }
      }
    } else {
      cachedHeadings.forEach((h, i) => {
        const rect = h.el.getBoundingClientRect();
        if (rect.top <= window.innerHeight * 0.4) {
          activeIndex = i;
        }
      });
    }
    
    document.querySelectorAll('.leafline-item').forEach(el => {
      if (parseInt(el.dataset.index, 10) === activeIndex) {
        el.classList.add('active');
        el.style.backgroundColor = 'var(--selected)';
        el.style.color = 'var(--fg)';
        el.style.fontWeight = '600';
      } else {
        el.classList.remove('active');
        el.style.backgroundColor = 'transparent';
        el.style.color = 'var(--fg-secondary)';
        el.style.fontWeight = 'normal';
      }
    });
  }
  
  let scrollTicking = false;
  const editorScroll = document.getElementById('editorScroll');
  if (editorScroll) {
    editorScroll.addEventListener('scroll', () => {
      if (!scrollTicking) {
        window.requestAnimationFrame(() => {
          highlightActiveHeading(false);
          scrollTicking = false;
        });
        scrollTicking = true;
      }
    }, {passive:true});
  }
  
  document.addEventListener('selectionchange', () => {
    if (window.state && (window.state.listMode === 'leafline' || window.state.drawerMode === 'leafline')) {
      const activeElement = document.activeElement;
      if (activeElement && activeElement.closest('#noteBody')) {
        highlightActiveHeading(true);
      }
    }
  });
  
  window.triggerLeaflineUpdate = function() {
    if (leaflineDebounceTimer) clearTimeout(leaflineDebounceTimer);
    leaflineDebounceTimer = setTimeout(() => {
      if (window.state.listMode === 'leafline' || window.state.drawerMode === 'leafline') {
        window.renderLeafline();
      }
    }, 500);
  };
  
})();
