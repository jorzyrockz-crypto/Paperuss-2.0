/* ============================================================
   HISTORY MANAGER (True Undo/Redo Engine)
   Replaces the browser's native contenteditable history.
   ============================================================ */
window.HistoryManager = {
  undoStack: [],
  redoStack: [],
  maxStack: 100,
  isNavigating: false,
  captureTimeout: null,
  activeNoteId: null,

  reset: function(noteId) {
    this.undoStack = [];
    this.redoStack = [];
    this.activeNoteId = noteId;
    this.isNavigating = false;
    clearTimeout(this.captureTimeout);
    // Capture the initial state of the note upon loading
    this.capture(true);
  },

  getState: function() {
    const ed = document.getElementById('noteBody');
    if(!ed) return null;
    return {
      content: ed.innerHTML,
      selection: window.captureEditorSelection ? window.captureEditorSelection(ed) : null
    };
  },

  capture: function(force = false) {
    if(this.isNavigating) return;
    clearTimeout(this.captureTimeout);

    const state = this.getState();
    if(!state) return;

    // Avoid duplicate successive states if HTML hasn't changed
    const lastState = this.undoStack.length > 0 ? this.undoStack[this.undoStack.length - 1] : null;
    if(lastState && lastState.content === state.content) {
      // Only update selection if content is identical
      lastState.selection = state.selection;
      return;
    }

    this.undoStack.push(state);
    if(this.undoStack.length > this.maxStack) {
      this.undoStack.shift();
    }

    // Once we capture a new state, the redo branch is dead
    if(!force) {
      this.redoStack = [];
    }
  },

  queueCapture: function() {
    if(this.isNavigating) return;
    clearTimeout(this.captureTimeout);
    this.captureTimeout = setTimeout(() => {
      this.capture();
    }, 700); // Capture 700ms after user stops typing
  },

  undo: function() {
    if(this.undoStack.length <= 1) return; // Need at least the base state to pop back to

    this.isNavigating = true;
    clearTimeout(this.captureTimeout);

    // We capture right before undoing just in case the current working state wasn't captured yet,
    // so it can go to the redo stack. Wait, the redo stack gets the CURRENT state.
    const currentState = this.getState();
    if(currentState && currentState.content !== this.undoStack[this.undoStack.length - 1].content) {
      this.redoStack.push(currentState);
    } else {
      const poppedState = this.undoStack.pop();
      this.redoStack.push(poppedState);
    }

    const prevState = this.undoStack[this.undoStack.length - 1];
    if(prevState) this.applyState(prevState);

    this.isNavigating = false;
  },

  redo: function() {
    if(this.redoStack.length === 0) return;

    this.isNavigating = true;
    clearTimeout(this.captureTimeout);

    const nextState = this.redoStack.pop();
    this.undoStack.push(nextState);

    this.applyState(nextState);

    this.isNavigating = false;
  },

  applyState: function(state) {
    const ed = document.getElementById('noteBody');
    if(!ed) return;
    ed.innerHTML = state.content;
    if (typeof normalizeEditorTables === 'function') normalizeEditorTables();
    if (typeof hydrateCalcuLeafFormulas === 'function') hydrateCalcuLeafFormulas(ed);

    if (typeof window.hydrateProductivityReferences === 'function') {
      window.hydrateProductivityReferences(ed);
    }

    if(window.restoreEditorSelection && state.selection) {
      window.restoreEditorSelection(ed, state.selection);
    }

    // Trigger any downstream recalculations / UI updates
    if(typeof window.normalizeEditorTables === 'function') window.normalizeEditorTables();
    if(typeof window.normalizeEditorImages === 'function') window.normalizeEditorImages();
    if(typeof window.hydrateMediaInEditor === 'function') window.hydrateMediaInEditor();
    if(typeof window.recalculateTableFormulas === 'function') {
      document.querySelectorAll('.editor-content table').forEach(tbl => {
        window.recalculateTableFormulas(tbl);
      });
    }

    // Force sync the undo'ed state to the cloud/local store
    if(typeof window.saveData === 'function') {
      const note = window.activeNoteForAction ? window.activeNoteForAction() : null;
      if(note) {
        note.content = state.content;
        note.updatedAt = Date.now();
        window.saveData();
      }
    }
  }
};
