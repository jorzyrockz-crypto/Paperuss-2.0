/* ============================================================
   PAPERUSS 2.0 — BRANCH ENGINE (Sidebar Categories & Notebooks)
   ============================================================ */

(function () {
  'use strict';

  const STORAGE_KEY = 'paperuss_branches_v1';
  const ACTIVE_BRANCH_KEY = 'paperuss_active_branch_v1';

  const OUTLINE_ICONS = [
    'folder', 'briefcase', 'user', 'lightbulb', 'archive', 
    'bookmark', 'code', 'heart', 'star', 'terminal', 
    'target', 'zap', 'coffee', 'database', 'shield', 
    'globe', 'hash', 'layers', 'file-text', 'compass'
  ];

  const COLOR_PRESETS = [
    '#6366f1', '#10b981', '#3b82f6', '#f59e0b', 
    '#ec4899', '#a855f7', '#f43f5e', '#14b8a6', '#64748b'
  ];

  // Default initial branches
  const DEFAULT_BRANCHES = [
    { id: 'branch-personal', name: 'Personal', color: '#10b981', icon: 'user', parentId: null, order: 0 },
    { id: 'branch-work', name: 'Work & Projects', color: '#3b82f6', icon: 'briefcase', parentId: null, order: 1 },
    { id: 'branch-ideas', name: 'Ideas & Brainstorm', color: '#f59e0b', icon: 'lightbulb', parentId: null, order: 2 },
    { id: 'branch-archive', name: 'Archive', color: '#6b7280', icon: 'archive', parentId: null, order: 3 }
  ];

  let branchesCache = null;
  let activeBranchId = null;
  let activeMoreMenu = null;

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
      console.warn('[BranchEngine] Failed to load branches:', e);
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
          console.warn('[BranchEngine] Firestore sync suppressed:', err);
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

  function closeMoreMenu() {
    if (activeMoreMenu && activeMoreMenu.parentElement) {
      activeMoreMenu.remove();
    }
    activeMoreMenu = null;
  }

  function openBranchMoreMenu(e, branch) {
    e.stopPropagation();
    closeMoreMenu();

    const menu = document.createElement('div');
    menu.className = 'branch-more-dropdown show';
    menu.innerHTML = `
      <button type="button" class="branch-menu-item" id="bmiEdit">
        <i data-lucide="pencil" class="w-3.5 h-3.5"></i> Edit Branch
      </button>
      <button type="button" class="branch-menu-item" id="bmiAddSub">
        <i data-lucide="plus-circle" class="w-3.5 h-3.5"></i> Add Sub-Branch
      </button>
      <div class="branch-menu-divider"></div>
      <button type="button" class="branch-menu-item danger" id="bmiDelete">
        <i data-lucide="trash-2" class="w-3.5 h-3.5"></i> Delete Branch
      </button>
    `;

    document.body.appendChild(menu);
    activeMoreMenu = menu;

    const rect = e.target.getBoundingClientRect();
    let top = rect.bottom + 4;
    let left = Math.min(rect.left, window.innerWidth - 180);

    menu.style.top = `${top}px`;
    menu.style.left = `${left}px`;

    if (window.lucide && typeof window.lucide.createIcons === 'function') {
      window.lucide.createIcons({ el: menu });
    }

    menu.querySelector('#bmiEdit').onclick = () => {
      closeMoreMenu();
      openBranchModal(branch);
    };

    menu.querySelector('#bmiAddSub').onclick = () => {
      closeMoreMenu();
      openBranchModal(null, branch.id);
    };

    menu.querySelector('#bmiDelete').onclick = () => {
      closeMoreMenu();
      if (confirm(`Delete branch "${branch.name}"? Notes inside will be unassigned.`)) {
        deleteBranch(branch.id);
      }
    };

    setTimeout(() => {
      const dismissHandler = (evt) => {
        if (!menu.contains(evt.target)) {
          closeMoreMenu();
          document.removeEventListener('pointerdown', dismissHandler);
        }
      };
      document.addEventListener('pointerdown', dismissHandler);
    }, 50);
  }

  function renderSidebarBranchTree() {
    const container = document.getElementById('sidebarBranchTree');
    if (!container) return;

    const branches = loadBranches();
    const currentActive = getActiveBranchId();

    let html = `
      <div class="branch-tree-header">
        <span class="branch-tree-title">
          <i data-lucide="git-branch" class="w-3.5 h-3.5"></i> BRANCHES
        </span>
        <button type="button" class="btn-new-branch-icon" id="btnAddBranch" title="Create New Branch">
          <i data-lucide="plus" class="w-3.5 h-3.5"></i>
        </button>
      </div>
      <div class="branch-tree-list">
        <div class="branch-item ${currentActive === 'all' ? 'active' : ''}" data-branch-id="all">
          <i data-lucide="library" class="branch-icon w-4 h-4" style="color:#6366f1"></i>
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
      const iconName = b.icon || 'folder';

      html += `
        <div class="branch-item ${isSelected ? 'active' : ''}" data-branch-id="${b.id}" data-branch-name="${escHtml(b.name)}">
          <i data-lucide="${iconName}" class="branch-icon w-4 h-4" style="color:${b.color || '#6366f1'}"></i>
          <span class="branch-name">${escHtml(b.name)}</span>
          <span class="branch-count">${count}</span>
          <button type="button" class="branch-opt-btn" data-branch-id="${b.id}" title="Branch Options">⋮</button>
        </div>
      `;

      // Render Sub-Branches if any
      if (subBranches.length > 0) {
        html += `<div class="sub-branch-group">`;
        subBranches.forEach(sub => {
          const subCount = countNotesInBranch(sub.id);
          const subSelected = currentActive === sub.id || currentActive === sub.name;
          const subIcon = sub.icon || 'folder';
          html += `
            <div class="branch-item sub-branch-item ${subSelected ? 'active' : ''}" data-branch-id="${sub.id}" data-branch-name="${escHtml(sub.name)}">
              <i data-lucide="${subIcon}" class="branch-icon w-3.5 h-3.5" style="color:${sub.color || '#6366f1'}"></i>
              <span class="branch-name">${escHtml(sub.name)}</span>
              <span class="branch-count">${subCount}</span>
              <button type="button" class="branch-opt-btn" data-branch-id="${sub.id}" title="Branch Options">⋮</button>
            </div>
          `;
        });
        html += `</div>`;
      }
    });

    html += `</div>`;
    container.innerHTML = html;

    // Refresh Lucide outline icons
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

    // 3-dot More Menu triggers
    container.querySelectorAll('.branch-opt-btn').forEach(btn => {
      btn.onclick = (e) => {
        const bId = btn.dataset.branchId;
        const branch = branches.find(b => b.id === bId);
        if (branch) openBranchMoreMenu(e, branch);
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

  function openBranchModal(editBranch = null, parentId = null) {
    let modal = document.getElementById('branchModal');
    if (!modal) {
      modal = document.createElement('div');
      modal.id = 'branchModal';
      modal.className = 'modal-backdrop hidden';
      
      let iconGridHtml = OUTLINE_ICONS.map(ic => `
        <button type="button" class="bm-icon-btn ${ic === 'folder' ? 'active' : ''}" data-icon="${ic}" title="${ic}">
          <i data-lucide="${ic}" class="w-4 h-4"></i>
        </button>
      `).join('');

      let colorPresetsHtml = COLOR_PRESETS.map(c => `
        <button type="button" class="bm-color-preset ${c === '#6366f1' ? 'active' : ''}" data-color="${c}" style="background:${c}"></button>
      `).join('');

      modal.innerHTML = `
        <div class="modal-card print-setup-modal" style="max-width:440px">
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
              <label class="pm-label">Outline Icon</label>
              <div class="bm-icon-grid" id="bmIconGrid">
                ${iconGridHtml}
              </div>
            </div>

            <div class="pm-field-group">
              <label class="pm-label">Color Accent</label>
              <div class="bm-color-picker-row">
                <div class="bm-color-presets" id="bmColorPresets">
                  ${colorPresetsHtml}
                </div>
                <input type="color" id="bmCustomHexInput" class="bm-custom-hex" value="#6366f1" title="Custom Hex Color" />
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

      if (window.lucide && typeof window.lucide.createIcons === 'function') {
        window.lucide.createIcons({ el: modal });
      }

      modal.querySelector('#btnCloseBranchModal').onclick = () => modal.classList.add('hidden');
      modal.querySelector('#btnCancelBranch').onclick = () => modal.classList.add('hidden');

      // Icon Selector
      modal.querySelectorAll('#bmIconGrid .bm-icon-btn').forEach(btn => {
        btn.onclick = () => {
          modal.querySelectorAll('#bmIconGrid .bm-icon-btn').forEach(b => b.classList.remove('active'));
          btn.classList.add('active');
        };
      });

      // Color Selector
      modal.querySelectorAll('#bmColorPresets .bm-color-preset').forEach(btn => {
        btn.onclick = () => {
          modal.querySelectorAll('#bmColorPresets .bm-color-preset').forEach(b => b.classList.remove('active'));
          btn.classList.add('active');
          modal.querySelector('#bmCustomHexInput').value = btn.dataset.color;
        };
      });

      modal.querySelector('#bmCustomHexInput').oninput = (e) => {
        modal.querySelectorAll('#bmColorPresets .bm-color-preset').forEach(b => b.classList.remove('active'));
      };

      modal.querySelector('#btnSaveBranch').onclick = () => {
        const name = modal.querySelector('#bmNameInput').value.trim();
        const activeIconBtn = modal.querySelector('#bmIconGrid .bm-icon-btn.active');
        const activeColorBtn = modal.querySelector('#bmColorPresets .bm-color-preset.active');
        const customHex = modal.querySelector('#bmCustomHexInput').value;

        const icon = activeIconBtn ? activeIconBtn.dataset.icon : 'folder';
        const color = activeColorBtn ? activeColorBtn.dataset.color : customHex;
        const editId = modal.dataset.editBranchId;
        const pId = modal.dataset.parentId;

        if (name) {
          if (editId) {
            updateBranch(editId, { name, icon, color });
          } else {
            createBranch({ name, icon, color, parentId: pId || null });
          }
          modal.classList.add('hidden');
        }
      };
    }

    modal.dataset.editBranchId = editBranch ? editBranch.id : '';
    modal.dataset.parentId = parentId || '';
    modal.querySelector('#branchModalTitle').textContent = editBranch ? 'Edit Branch' : (parentId ? 'Add Sub-Branch' : 'New Branch Category');
    modal.querySelector('#bmNameInput').value = editBranch ? editBranch.name : '';

    // Select active icon
    const activeIcon = editBranch ? (editBranch.icon || 'folder') : 'folder';
    modal.querySelectorAll('#bmIconGrid .bm-icon-btn').forEach(b => {
      b.classList.toggle('active', b.dataset.icon === activeIcon);
    });

    // Select active color
    const activeColor = editBranch ? (editBranch.color || '#6366f1') : '#6366f1';
    modal.querySelector('#bmCustomHexInput').value = activeColor;
    modal.querySelectorAll('#bmColorPresets .bm-color-preset').forEach(b => {
      b.classList.toggle('active', b.dataset.color === activeColor);
    });

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
