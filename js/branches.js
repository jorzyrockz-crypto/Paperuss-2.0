/* ============================================================
   PAPERUSS 2.0 — BRANCH ENGINE (Sidebar Categories & Notebooks)
   ============================================================ */

(function () {
  'use strict';

  const STORAGE_KEY = 'paperuss_branches_v1';
  const ACTIVE_BRANCH_KEY = 'paperuss_active_branch_v1';

  // Default initial branches if none exist
  const DEFAULT_BRANCHES = [
    { id: 'branch-personal', name: 'Personal', color: '#10b981', icon: 'user', parentId: null, order: 0 },
    { id: 'branch-work', name: 'Work & Projects', color: '#3b82f6', icon: 'briefcase', parentId: null, order: 1 },
    { id: 'branch-ideas', name: 'Ideas & Brainstorm', color: '#f59e0b', icon: 'lightbulb', parentId: null, order: 2 },
    { id: 'branch-archive', name: 'Archive', color: '#6b7280', icon: 'archive', parentId: null, order: 3 }
  ];

  let branchesCache = null;
  let activeBranchId = null;

  function loadBranches() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        branchesCache = JSON.parse(raw);
      } else {
        branchesCache = [...DEFAULT_BRANCHES];
        saveBranches(branchesCache);
      }
    } catch (e) {
      console.warn('[BranchEngine] Failed to load branches from localStorage:', e);
      branchesCache = [...DEFAULT_BRANCHES];
    }
    return branchesCache;
  }

  function saveBranches(branches) {
    branchesCache = branches;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(branches));
    } catch (e) {
      console.error('[BranchEngine] Failed to save branches:', e);
    }
    syncBranchesToCloud();
    renderSidebarBranchTree();
  }

  function getActiveBranchId() {
    if (activeBranchId !== null) return activeBranchId;
    try {
      activeBranchId = localStorage.getItem(ACTIVE_BRANCH_KEY) || 'all';
    } catch (e) {
      activeBranchId = 'all';
    }
    return activeBranchId;
  }

  function setActiveBranchId(id) {
    activeBranchId = id || 'all';
    try {
      localStorage.setItem(ACTIVE_BRANCH_KEY, activeBranchId);
    } catch (e) {}
    
    // Filter notes list if state engine exists
    if (window.state && typeof window.renderNotesList === 'function') {
      window.renderNotesList();
    }
    renderSidebarBranchTree();
    if (typeof window.triggerLeaflineUpdate === 'function') {
      window.triggerLeaflineUpdate();
    }
  }

  function createBranch({ name, color, icon, parentId = null }) {
    if (!name || !name.trim()) return null;
    const branches = loadBranches();
    const newBranch = {
      id: 'branch-' + Date.now() + '-' + Math.random().toString(36).substr(2, 5),
      name: name.trim(),
      color: color || '#6366f1',
      icon: icon || 'folder',
      parentId: parentId || null,
      order: branches.length
    };
    branches.push(newBranch);
    saveBranches(branches);
    return newBranch;
  }

  function updateBranch(id, updates) {
    const branches = loadBranches();
    const idx = branches.findIndex(b => b.id === id);
    if (idx !== -1) {
      branches[idx] = { ...branches[idx], ...updates };
      saveBranches(branches);
      return branches[idx];
    }
    return null;
  }

  function deleteBranch(id) {
    let branches = loadBranches();
    branches = branches.filter(b => b.id !== id && b.parentId !== id);
    saveBranches(branches);
    if (getActiveBranchId() === id) {
      setActiveBranchId('all');
    }
  }

  function syncBranchesToCloud() {
    if (window.auth && window.auth.currentUser && window.db) {
      const uid = window.auth.currentUser.uid;
      try {
        window.db.collection('users').doc(uid).set({
          branches: branchesCache,
          branchesUpdatedAt: firebase.firestore.FieldValue.serverTimestamp()
        }, { merge: true }).catch(err => {
          console.warn('[BranchEngine] Firestore branch sync suppressed:', err);
        });
      } catch (e) {}
    }
  }

  function countNotesInBranch(branchNameOrId) {
    if (!window.state || !Array.isArray(window.state.notes)) return 0;
    const branch = branchesCache?.find(b => b.id === branchNameOrId || b.name.toLowerCase() === String(branchNameOrId).toLowerCase());
    const name = branch ? branch.name : branchNameOrId;
    return window.state.notes.filter(n => !n.archived && !n.trashed && (n.category === name || n.branchId === branch?.id)).length;
  }

  function renderSidebarBranchTree() {
    const container = document.getElementById('sidebarBranchTree');
    if (!container) return;

    const branches = loadBranches();
    const currentActive = getActiveBranchId();

    let html = `
      <div class="branch-tree-header">
        <span class="branch-tree-title"><i data-lucide="git-branch" class="w-3.5 h-3.5"></i> BRANCHES</span>
        <button type="button" class="btn-new-branch-icon" id="btnAddBranch" title="Create New Branch">
          <i data-lucide="plus" class="w-3.5 h-3.5"></i>
        </button>
      </div>
      <div class="branch-tree-list">
        <div class="branch-item ${currentActive === 'all' ? 'active' : ''}" data-branch-id="all">
          <span class="branch-color-dot" style="background:#6366f1"></span>
          <span class="branch-name">All Notes</span>
          <span class="branch-count">${window.state?.notes?.filter(n=>!n.archived&&!n.trashed).length || 0}</span>
        </div>
    `;

    // Root branches
    const rootBranches = branches.filter(b => !b.parentId);
    rootBranches.forEach(b => {
      const count = countNotesInBranch(b.id);
      const isSelected = currentActive === b.id || currentActive === b.name;
      const subBranches = branches.filter(sub => sub.parentId === b.id);

      html += `
        <div class="branch-item ${isSelected ? 'active' : ''}" data-branch-id="${b.id}" data-branch-name="${escHtml(b.name)}">
          <span class="branch-color-dot" style="background:${b.color || '#6366f1'}"></span>
          <span class="branch-name">${escHtml(b.name)}</span>
          <span class="branch-count">${count}</span>
          <button class="branch-opt-btn" data-branch-id="${b.id}" title="Branch Options">⋮</button>
        </div>
      `;

      // Render Sub-Branches if any
      if (subBranches.length > 0) {
        html += `<div class="sub-branch-group">`;
        subBranches.forEach(sub => {
          const subCount = countNotesInBranch(sub.id);
          const subSelected = currentActive === sub.id || currentActive === sub.name;
          html += `
            <div class="branch-item sub-branch-item ${subSelected ? 'active' : ''}" data-branch-id="${sub.id}" data-branch-name="${escHtml(sub.name)}">
              <span class="branch-color-dot" style="background:${sub.color || '#6366f1'}"></span>
              <span class="branch-name">${escHtml(sub.name)}</span>
              <span class="branch-count">${subCount}</span>
            </div>
          `;
        });
        html += `</div>`;
      }
    });

    html += `</div>`;
    container.innerHTML = html;

    // Refresh Lucide icons
    if (window.lucide && typeof window.lucide.createIcons === 'function') {
      window.lucide.createIcons({ el: container });
    }

    // Attach click events
    container.querySelectorAll('.branch-item').forEach(item => {
      item.onclick = (e) => {
        if (e.target.closest('.branch-opt-btn')) return;
        const bId = item.dataset.branchId;
        setActiveBranchId(bId);
      };
    });

    // Dropzone for Note Dragging
    container.querySelectorAll('.branch-item').forEach(item => {
      item.ondragover = (e) => {
        e.preventDefault();
        item.classList.add('drag-over');
      };
      item.ondragleave = () => {
        item.classList.remove('drag-over');
      };
      item.ondrop = (e) => {
        e.preventDefault();
        item.classList.remove('drag-over');
        const bName = item.dataset.branchName;
        const bId = item.dataset.branchId;
        if (!bId || bId === 'all') return;

        const activeNoteId = window.state?.activeNoteId;
        if (activeNoteId && window.state.notes) {
          const note = window.state.notes.find(n => n.id === activeNoteId);
          if (note) {
            note.category = bName;
            note.branchId = bId;
            if (typeof window.saveNotes === 'function') window.saveNotes();
            if (typeof window.renderNotesList === 'function') window.renderNotesList();
            renderSidebarBranchTree();
          }
        }
      };
    });

    // Add Branch Button
    const btnAdd = container.querySelector('#btnAddBranch');
    if (btnAdd) {
      btnAdd.onclick = () => openBranchModal();
    }
  }

  function escHtml(str) {
    if (!str) return '';
    return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function openBranchModal(editBranch = null) {
    let modal = document.getElementById('branchModal');
    if (!modal) {
      modal = document.createElement('div');
      modal.id = 'branchModal';
      modal.className = 'modal-backdrop hidden';
      modal.innerHTML = `
        <div class="modal-card print-setup-modal" style="max-width:400px">
          <div class="print-modal-header">
            <h3 style="margin:0;font-size:16px;font-weight:700" id="branchModalTitle">New Branch Category</h3>
            <button type="button" class="tool-btn" id="btnCloseBranchModal">✕</button>
          </div>
          <div class="print-modal-body">
            <div class="pm-field-group">
              <label class="pm-label">Branch Name</label>
              <input type="text" id="bmNameInput" class="pm-select" placeholder="e.g. Finance, Lofi Study, Health" />
            </div>
            <div class="pm-field-group">
              <label class="pm-label">Accent Color</label>
              <div class="pm-segmented-control" id="bmColorPicker">
                <button type="button" class="pm-segment-btn active" data-color="#6366f1" style="color:#6366f1">Indigo</button>
                <button type="button" class="pm-segment-btn" data-color="#10b981" style="color:#10b981">Emerald</button>
                <button type="button" class="pm-segment-btn" data-color="#3b82f6" style="color:#3b82f6">Blue</button>
                <button type="button" class="pm-segment-btn" data-color="#f59e0b" style="color:#f59e0b">Amber</button>
                <button type="button" class="pm-segment-btn" data-color="#ec4899" style="color:#ec4899">Pink</button>
              </div>
            </div>
          </div>
          <div class="print-modal-footer">
            <button type="button" class="btn btn-secondary" id="btnCancelBranch">Cancel</button>
            <button type="button" class="btn btn-primary" id="btnSaveBranch">Save Branch</button>
          </div>
        </div>
      `;
      document.body.appendChild(modal);

      modal.querySelector('#btnCloseBranchModal').onclick = () => modal.classList.add('hidden');
      modal.querySelector('#btnCancelBranch').onclick = () => modal.classList.add('hidden');

      const colorBtns = modal.querySelectorAll('#bmColorPicker .pm-segment-btn');
      colorBtns.forEach(btn => {
        btn.onclick = () => {
          colorBtns.forEach(b => b.classList.remove('active'));
          btn.classList.add('active');
        };
      });

      modal.querySelector('#btnSaveBranch').onclick = () => {
        const name = modal.querySelector('#bmNameInput').value.trim();
        const activeColorBtn = modal.querySelector('#bmColorPicker .pm-segment-btn.active');
        const color = activeColorBtn ? activeColorBtn.dataset.color : '#6366f1';
        if (name) {
          createBranch({ name, color });
          modal.classList.add('hidden');
        }
      };
    }

    modal.querySelector('#bmNameInput').value = editBranch ? editBranch.name : '';
    modal.classList.remove('hidden');
    modal.querySelector('#bmNameInput').focus();
  }

  // Expose global BranchEngine API
  window.BranchEngine = {
    loadBranches,
    saveBranches,
    getActiveBranchId,
    setActiveBranchId,
    createBranch,
    updateBranch,
    deleteBranch,
    renderSidebarBranchTree,
    openBranchModal
  };

  // Initialize on DOM Ready
  document.addEventListener('DOMContentLoaded', () => {
    loadBranches();
    setTimeout(renderSidebarBranchTree, 300);
  });
})();
