(function() {
  class LeaflineManager {
    constructor() {
      this.debounceTimer = null;
      this.cachedHeadings = [];
      this.cachedAllEntries = [];
      this.scrollTicking = false;
      this.init();
    }

    init() {
      window.state = window.state || {};
      window.state.drawerMode = window.state.drawerMode || 'leaves';
      window.state.leaflineScope = window.state.leaflineScope || 'current';

      this.bindEvents();
      this.exposeGlobals();
    }

    escapeHtml(value) {
      return String(value == null ? '' : value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
    }

    getHeadingsFromRoot(root) {
      if (!root) return [];
      return Array.from(root.querySelectorAll('h1, h2, h3, h4'))
        .filter(node => !node.closest('[data-paperuss-page-ui="true"], [data-paperuss-ui="true"]'))
        .map(node => ({
          el: node,
          text: node.innerText || node.textContent || 'Untitled Heading',
          level: parseInt(node.tagName.substring(1), 10),
          isTitle: node.tagName === 'H1' && node.classList.contains('editor-title')
        }));
    }

    getHeadings() {
      return this.getHeadingsFromRoot(document.getElementById('noteBody'));
    }

    getHeadingsFromHTML(html) {
      // Optimized parsing without injecting potentially huge/unsafe HTML into the DOM
      // We use DOMParser to safely parse it into a document fragment
      const parser = new DOMParser();
      const doc = parser.parseFromString(html || '', 'text/html');
      return this.getHeadingsFromRoot(doc.body).map(({ text, level, isTitle }) => ({ text, level, isTitle }));
    }

    getCurrentNote() {
      if (typeof window.getNote === 'function') return window.getNote(window.state.currentId);
      return (window.notes || []).find(note => note.id === window.state.currentId) || null;
    }

    getContext(note) {
      let branchName = note?.category || 'Unassigned';
      if (note?.branchId && window.BranchEngine) {
        const branch = window.BranchEngine.loadBranches().find(item => item.id === note.branchId);
        if (branch) branchName = branch.name;
      }
      return { branchName, leafTitle: window.currentActiveLeaf?.title || 'Main' };
    }


    itemMeta(h) {
      return h.isTitle ? 'Document title' : ({ 1: 'Primary heading', 2: 'Section', 3: 'Subsection', 4: 'Detail' }[h.level] || `Heading ${h.level}`);
    }

    scopeControls() {
      const scope = window.state.leaflineScope;
      return `<div class="leafline-scope" role="tablist" aria-label="Leafline scope"><button type="button" role="tab" aria-selected="${scope==='current'}" class="${scope==='current'?'active':''}" onclick="window.setLeaflineScope('current')">Current Leaf</button><button type="button" role="tab" aria-selected="${scope==='all'}" class="${scope==='all'?'active':''}" onclick="window.setLeaflineScope('all')">All Leaflines</button></div>`;
    }

    updateCurrentDOM(container, headings) {
      const note = this.getCurrentNote();
      const context = this.getContext(note);
      let html = '<div class="leafline-container" role="region" aria-label="Current Leaf outline"><div class="leafline-heading"><strong>Leafline</strong></div>' + this.scopeControls();
      html += `<div class="leafline-context">${this.escapeHtml(context.branchName)} ┬╖ ${this.escapeHtml(context.leafTitle)}</div>`;
      if (!headings.length) {
        container.innerHTML = html + '<div class="list-empty leafline-empty">Add headings to this Leaf to create its Leafline.</div></div>';
        return;
      }
      html += '<div class="leafline-track">';
      headings.forEach((h, index) => {
        const depth = Math.max(0, Math.min(3, h.level - 1));
        html += `<button type="button" class="leafline-item" data-index="${index}" style="--leafline-depth:${depth}" aria-label="Jump to ${this.escapeHtml(h.text)}" onclick="window.scrollToLeaflineHeading(${index})"><span class="leafline-dot" aria-hidden="true"></span><span class="leafline-item-copy"><span class="leafline-item-title">${this.escapeHtml(h.text)}</span><span class="leafline-item-meta">${this.itemMeta(h)}</span></span></button>`;
      });
      container.innerHTML = html + '</div></div>';
      this.highlightActiveHeading();
    }

    async renderAllLeaflines(container) {
      const note = this.getCurrentNote();
      if (!note) {
        container.innerHTML = '<div class="leafline-container">' + this.scopeControls() + '<div class="list-empty leafline-empty">Select a Note to view its Leaflines.</div></div>';
        return;
      }
      const noteId = note.id;
      const leafApi = window.paperussLeaves;
      const order = leafApi?.getNoteLeafOrder(note) || [note.defaultLeafId || 'virtual_main_' + note.id];
      const activeLeafId = leafApi?.getNoteActiveLeafId(note) || order[0];
      const groups = [];
      this.cachedAllEntries = [];
      for (let leafIndex = 0; leafIndex < order.length; leafIndex++) {
        const leafId = order[leafIndex];
        let leaf = leafId === activeLeafId ? window.currentActiveLeaf : null;
        if (!leaf && leafApi?.leafGet) leaf = await leafApi.leafGet(leafId);
        if (!leaf && (leafId === 'virtual_main_' + note.id || leafIndex === 0)) {
          leaf = leafApi?.getVirtualMainLeaf(note) || { id: leafId, title: 'Main', content: note.content || '' };
        }
        const headings = leafId === activeLeafId ? this.getHeadings() : this.getHeadingsFromHTML(leaf?.content || '');
        const group = { title: leaf?.title || `Leaf ${leafIndex + 1}`, entries: [] };
        headings.forEach((heading, headingIndex) => {
          const entry = { leafId, headingIndex, heading, index: this.cachedAllEntries.length };
          this.cachedAllEntries.push(entry);
          group.entries.push(entry);
        });
        groups.push(group);
      }
      if (window.state.currentId !== noteId || window.state.leaflineScope !== 'all') return;
      const context = this.getContext(note);
      let html = '<div class="leafline-container" role="region" aria-label="All Leaflines in current Note"><div class="leafline-heading"><strong>All Leaflines</strong></div>' + this.scopeControls();
      html += `<div class="leafline-context">${this.escapeHtml(context.branchName)} ┬╖ ${this.escapeHtml(note.title || 'Untitled Note')}</div>`;
      groups.forEach(group => {
        html += `<section class="leafline-group"><div class="leafline-group-title">${this.escapeHtml(group.title)}</div>`;
        if (!group.entries.length) {
          html += '<div class="leafline-group-empty">No headings</div>';
        } else {
          html += '<div class="leafline-track">';
          group.entries.forEach(entry => {
            const h = entry.heading;
            const depth = Math.max(0, Math.min(3, h.level - 1));
            html += `<button type="button" class="leafline-item" style="--leafline-depth:${depth}" onclick="window.openLeaflineEntry(${entry.index})"><span class="leafline-dot" aria-hidden="true"></span><span class="leafline-item-copy"><span class="leafline-item-title">${this.escapeHtml(h.text)}</span><span class="leafline-item-meta">${this.itemMeta(h)}</span></span></button>`;
          });
          html += '</div>';
        }
        html += '</section>';
      });
      container.innerHTML = html + '</div>';
    }

    scrollHeading(heading) {
      const scroller = document.getElementById('editorScroll');
      if (!scroller || !heading?.el) return;
      const sr = scroller.getBoundingClientRect();
      const er = heading.el.getBoundingClientRect();
      scroller.scrollTo({ top: scroller.scrollTop + (er.top - sr.top) - 20, behavior: 'smooth' });
    }

    async openLeaflineEntry(index) {
      const entry = this.cachedAllEntries[index];
      if (!entry) return;
      
      if (window.currentActiveLeaf?.id !== entry.leafId && typeof window.switchLeafAction === 'function') {
        if (window.WorkspaceAudio?.playLeaflineNav) window.WorkspaceAudio.playLeaflineNav();
        await window.switchLeafAction(entry.leafId);
      }
      
      let attempts = 0;
      const locate = () => {
        const editor = document.getElementById('noteBody');
        if (editor?.getAttribute('data-active-leaf-id') === entry.leafId || window.currentActiveLeaf?.id === entry.leafId) {
          const heading = this.getHeadings()[entry.headingIndex];
          if (heading) { this.scrollHeading(heading); return; }
        }
        if (++attempts < 12) window.requestAnimationFrame(locate);
      };
      window.requestAnimationFrame(locate);
    }

    highlightActiveHeading(fromCaret = false) {
      if (!this.cachedHeadings.length) return;
      const scroller = document.getElementById('editorScroll');
      if (!scroller) return;
      
      let activeIndex = 0;
      if (fromCaret) {
        const selection = window.getSelection();
        let node = selection?.anchorNode;
        if (node?.nodeType === 3) node = node.parentNode;
        if (node && scroller.contains(node)) {
          this.cachedHeadings.forEach((h, i) => {
            if (h.el.getBoundingClientRect().top <= node.getBoundingClientRect().top + 10) activeIndex = i;
          });
        }
      } else {
        const line = scroller.getBoundingClientRect().top + Math.min(180, scroller.getBoundingClientRect().height * 0.32);
        this.cachedHeadings.forEach((h, i) => {
          if (h.el.getBoundingClientRect().top <= line) activeIndex = i;
        });
      }
      
      document.querySelectorAll('.leafline-item[data-index]').forEach(item => {
        const active = parseInt(item.dataset.index, 10) === activeIndex;
        item.classList.toggle('active', active);
        if (active) {
          item.setAttribute('aria-current', 'location');
        } else {
          item.removeAttribute('aria-current');
        }
      });
    }

    bindEvents() {
      const scroller = document.getElementById('editorScroll');
      if (scroller) {
        scroller.addEventListener('scroll', () => {
          if (!this.scrollTicking) {
            window.requestAnimationFrame(() => {
              this.highlightActiveHeading(false);
              this.scrollTicking = false;
            });
            this.scrollTicking = true;
          }
        }, { passive: true });
      }

      document.addEventListener('selectionchange', () => {
        if (window.state && (window.state.listMode === 'leafline' || window.state.drawerMode === 'leafline')) {
          if (document.activeElement?.closest('#noteBody')) {
            this.highlightActiveHeading(true);
          }
        }
      });
    }

    exposeGlobals() {
      // 1. Maintain Drawer Mode API inside leafline to not break core.js tabs
      window.setDrawerMode = (mode) => {
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
        } else {
          window.renderLeafline(content);
        }
      };

      window.renderLeafline = (container = null) => {
        const targets = container ? [container] : [
          window.state.listMode === 'leafline' ? document.getElementById('notesContainer') : null,
          window.state.drawerMode === 'leafline' ? document.getElementById('leavesDrawerContent') : null
        ].filter(Boolean);
        
        if (window.state.leaflineScope === 'all') {
          targets.forEach(t => this.renderAllLeaflines(t));
          return;
        }
        this.cachedHeadings = this.getHeadings();
        targets.forEach(target => this.updateCurrentDOM(target, this.cachedHeadings));
      };

      window.setLeaflineScope = (scope) => {
        if (scope !== 'current' && scope !== 'all') return;
        window.state.leaflineScope = scope;
        window.renderLeafline();
      };

      window.scrollToLeaflineHeading = (index) => {
        this.scrollHeading(this.cachedHeadings[index]);
      };

      window.openLeaflineEntry = (index) => {
        this.openLeaflineEntry(index);
      };

      window.triggerLeaflineUpdate = () => {
        if (this.debounceTimer) clearTimeout(this.debounceTimer);
        this.debounceTimer = setTimeout(() => {
          if (window.state.listMode === 'leafline' || window.state.drawerMode === 'leafline') {
            window.renderLeafline();
          }
        }, 500);
      };
    }
  }

  // Initialize immediately to map to globals
  const manager = new LeaflineManager();
})();
