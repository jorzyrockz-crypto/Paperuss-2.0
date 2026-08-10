/* ============================================================
   PAPERUSS 2.1.3 — LEAVES STORAGE & METADATA MODULE
   Option C (Hybrid Compatibility Model) — Dedicated Leaf Module
   ============================================================ */

const LEAVES_DB_NAME = 'paperuss_leaves_db';
const LEAVES_DB_VERSION = 1;
const LEAVES_STORE = 'leaves';
const LEAVES_QUEUE_STORE = 'offline_leaf_queue';
const ACTIVE_LEAVES_KEY = 'octonotes:activeLeaves';

let _leavesDBInstance = null;

/**
 * Open or return the cached IndexedDB database for Leaf records.
 */
function openLeavesDB() {
  return new Promise((resolve, reject) => {
    if (_leavesDBInstance && _leavesDBInstance.name === LEAVES_DB_NAME) {
      return resolve(_leavesDBInstance);
    }
    const req = indexedDB.open(LEAVES_DB_NAME, LEAVES_DB_VERSION);

    req.onupgradeneeded = (e) => {
      const db = req.result;
      if (!db.objectStoreNames.contains(LEAVES_STORE)) {
        const store = db.createObjectStore(LEAVES_STORE, { keyPath: 'id' });
        store.createIndex('noteId', 'noteId', { unique: false });
      }
      if (!db.objectStoreNames.contains(LEAVES_QUEUE_STORE)) {
        db.createObjectStore(LEAVES_QUEUE_STORE, { keyPath: 'id' });
      }
    };

    req.onblocked = () => {
      console.warn('Leaves database upgrade blocked by another connection');
      reject(new Error('Leaves DB Upgrade Blocked'));
    };

    req.onsuccess = () => {
      _leavesDBInstance = req.result;
      const openedDb = _leavesDBInstance;
      openedDb.onversionchange = () => {
        openedDb.close();
        if (_leavesDBInstance === openedDb) _leavesDBInstance = null;
      };
      resolve(_leavesDBInstance);
    };

    req.onerror = () => {
      reject(req.error || new Error('Failed to open Leaves DB'));
    };
  });
}

/**
 * Close the current open DB instance (useful for upgrades or tests).
 */
function closeLeavesDB() {
  if (_leavesDBInstance) {
    _leavesDBInstance.close();
    _leavesDBInstance = null;
  }
}

/**
 * Delete the entire Leaves database (useful for testing and reset).
 */
function deleteLeavesDB() {
  closeLeavesDB();
  return new Promise((resolve, reject) => {
    const req = indexedDB.deleteDatabase(LEAVES_DB_NAME);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error || new Error('Failed to delete Leaves DB'));
    req.onblocked = () => resolve();
  });
}

/**
 * Put a Leaf record into IndexedDB 'leaves' store.
 * @param {Object} record - Leaf record { id, noteId, title, content, order, createdAt, updatedAt, deletedAt }
 */
async function leafPut(record) {
  if (!record || !record.id || !record.noteId) {
    throw new Error('Leaf record must contain id and noteId');
  }
  const db = await openLeavesDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(LEAVES_STORE, 'readwrite');
    const store = tx.objectStore(LEAVES_STORE);
    const req = store.put(record);
    req.onsuccess = () => resolve(record);
    req.onerror = () => reject(req.error || tx.error || new Error('leafPut failed'));
  });
}

/**
 * Get a Leaf record by its id.
 * @param {string} id - Leaf unique ID
 */
async function leafGet(id) {
  if (!id) return null;
  const db = await openLeavesDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(LEAVES_STORE, 'readonly');
    const store = tx.objectStore(LEAVES_STORE);
    const req = store.get(id);
    req.onsuccess = () => {
      const res = req.result || null;
      if (res && res.deletedAt && res.deletedAt > 0) resolve(null);
      else resolve(res);
    };
    req.onerror = () => reject(req.error || tx.error || new Error('leafGet failed'));
  });
}

async function leafGetRaw(id) {
  if (!id) return null;
  const db = await openLeavesDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(LEAVES_STORE, 'readonly');
    const store = tx.objectStore(LEAVES_STORE);
    const req = store.get(id);
    req.onsuccess = () => resolve(req.result || null);
    req.onerror = () => reject(req.error || tx.error || new Error('leafGetRaw failed'));
  });
}

/**
 * Get all Leaf records from the database.
 */
async function leafGetAll() {
  const db = await openLeavesDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(LEAVES_STORE, 'readonly');
    const store = tx.objectStore(LEAVES_STORE);
    const req = store.getAll();
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => reject(req.error || tx.error || new Error('leafGetAll failed'));
  });
}

/**
 * Get all Leaf records belonging to a parent Note, ordered by their 'order' property ascending.
 * @param {string} noteId - Parent Note ID
 */
async function leafGetByNoteId(noteId) {
  if (!noteId) return [];
  const db = await openLeavesDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(LEAVES_STORE, 'readonly');
    const store = tx.objectStore(LEAVES_STORE);
    const index = store.index('noteId');
    const req = index.getAll(IDBKeyRange.only(noteId));
    req.onsuccess = () => {
      const arr = (req.result || []).filter(leaf => !leaf.deletedAt);
      arr.sort((a, b) => (a.order || 0) - (b.order || 0));
      resolve(arr);
    };
    req.onerror = () => reject(req.error || tx.error || new Error('leafGetByNoteId failed'));
  });
}

/**
 * Delete a Leaf record from IndexedDB by its id.
 * @param {string} id - Leaf unique ID
 */
async function leafDel(id) {
  if (!id) return;
  const existing = await leafGetRaw(id);
  const db = await openLeavesDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(LEAVES_STORE, 'readwrite');
    const store = tx.objectStore(LEAVES_STORE);
    const tombstone = {
      id: id,
      noteId: (existing && existing.noteId) || 'unknown',
      deletedAt: Date.now(),
      updatedAt: Date.now()
    };
    const req = store.put(tombstone);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error || tx.error || new Error('leafDel failed'));
  });
}

/* ============================================================
   INDEXEDDB OFFLINE LEAF QUEUE
   ============================================================ */

/**
 * Put an item into the offline Leaf mutation queue.
 * @param {Object} entry - Queue entry { id, noteId, action: 'put'|'delete', data, timestamp }
 */
async function leafQueuePut(entry) {
  if (!entry || !entry.id) throw new Error('Queue entry must contain an id');
  const db = await openLeavesDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(LEAVES_QUEUE_STORE, 'readwrite');
    const store = tx.objectStore(LEAVES_QUEUE_STORE);
    const item = {
      id: entry.id,
      noteId: entry.noteId || '',
      action: entry.action || 'put',
      data: entry.data || null,
      timestamp: entry.timestamp || Date.now()
    };
    const req = store.put(item);
    req.onsuccess = () => resolve(item);
    req.onerror = () => reject(req.error || tx.error || new Error('leafQueuePut failed'));
  });
}

/**
 * Get all queued offline Leaf mutations, sorted by timestamp ascending.
 */
async function leafQueueGetAll() {
  const db = await openLeavesDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(LEAVES_QUEUE_STORE, 'readonly');
    const store = tx.objectStore(LEAVES_QUEUE_STORE);
    const req = store.getAll();
    req.onsuccess = () => {
      const arr = req.result || [];
      arr.sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0));
      resolve(arr);
    };
    req.onerror = () => reject(req.error || tx.error || new Error('leafQueueGetAll failed'));
  });
}

/**
 * Delete an entry from the offline Leaf queue by its queue id.
 * @param {string} id - Queue entry ID
 */
async function leafQueueDel(id) {
  if (!id) return;
  const db = await openLeavesDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(LEAVES_QUEUE_STORE, 'readwrite');
    const store = tx.objectStore(LEAVES_QUEUE_STORE);
    const req = store.delete(id);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error || tx.error || new Error('leafQueueDel failed'));
  });
}

/**
 * Clear all entries from the offline Leaf queue.
 */
async function leafQueueClear() {
  const db = await openLeavesDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(LEAVES_QUEUE_STORE, 'readwrite');
    const store = tx.objectStore(LEAVES_QUEUE_STORE);
    const req = store.clear();
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error || tx.error || new Error('leafQueueClear failed'));
  });
}

/* ============================================================
   LEAF METADATA & COMPATIBILITY HELPERS
   ============================================================ */

/**
 * Get the ordered array of Leaf IDs belonging to a Note.
 * @param {Object} note - Parent Note object
 * @returns {string[]} Array of Leaf IDs
 */
function getNoteLeafOrder(note) {
  if (!note) return [];
  if (!Array.isArray(note.leafOrder) || note.leafOrder.length === 0) {
    return ['virtual_main_' + note.id];
  }
  return note.leafOrder.slice();
}

/**
 * Get the ID of the default Main Leaf for a Note.
 * @param {Object} note - Parent Note object
 * @returns {string|null}
 */
function getNoteDefaultLeafId(note) {
  if (!note) return null;
  return note.defaultLeafId || ('virtual_main_' + note.id);
}

/**
 * Get the total number of Leaves in a Note.
 * @param {Object} note - Parent Note object
 * @returns {number}
 */
function getNoteLeafCount(note) {
  if (!note) return 0;
  if (typeof note.leafCount === 'number') return note.leafCount;
  if (Array.isArray(note.leafOrder) && note.leafOrder.length > 0) return note.leafOrder.length;
  return 1;
}

/**
 * Get the per-device local active Leaf ID for a Note.
 * Excluded from parent Note synchronization; stored in local storage map.
 * @param {Object} note - Parent Note object
 * @returns {string|null}
 */
function getNoteActiveLeafId(note) {
  if (!note || !note.id) return null;
  try {
    const map = JSON.parse(localStorage.getItem(ACTIVE_LEAVES_KEY)) || {};
    if (map[note.id] && typeof map[note.id] === 'string') {
      return map[note.id];
    }
  } catch (_) {}
  return getNoteDefaultLeafId(note);
}

/**
 * Set the per-device local active Leaf ID for a Note.
 * @param {string} noteId - Parent Note ID
 * @param {string} leafId - Selected Leaf ID
 */
function setNoteActiveLeafId(noteId, leafId) {
  if (!noteId || !leafId) return;
  try {
    const map = JSON.parse(localStorage.getItem(ACTIVE_LEAVES_KEY)) || {};
    map[noteId] = leafId;
    localStorage.setItem(ACTIVE_LEAVES_KEY, JSON.stringify(map));
  } catch (_) {}
}

/**
 * Get a virtual Main Leaf object representing a legacy unmigrated Note.
 * Does NOT mutate or write migration data to the Note on opening.
 * @param {Object} note - Legacy parent Note object
 * @returns {Object} Virtual Leaf object
 */
function getVirtualMainLeaf(note) {
  if (!note) return null;
  return {
    id: 'virtual_main_' + note.id,
    noteId: note.id,
    title: 'Main',
    content: note.content || '',
    color: 'emerald',
    order: 0,
    createdAt: note.createdAt || Date.now(),
    updatedAt: note.updatedAt || Date.now(),
    deletedAt: null,
    isVirtual: true
  };
}

/**
 * Determine if a Note is already migrated to separate Leaf records.
 * @param {Object} note
 * @returns {boolean}
 */
function isNoteMigratedToLeaves(note) {
  return !!(note && Array.isArray(note.leafOrder) && note.leafOrder.length > 0 && note.defaultLeafId);
}

/**
 * Repair already-contaminated Leaves safely and one time.
 * Backs up original raw HTML to localStorage recovery key before cleaning.
 * @returns {Promise<number>} Number of repaired records
 */
async function repairContaminatedLeavesOnce() {
  let repairedCount = 0;
  try {
    const allLeaves = await leafGetAll();
    let recoveryLog = [];
    try {
      const storedLog = localStorage.getItem('octonotes:contaminated_leaf_recovery_v1');
      if (storedLog) recoveryLog = JSON.parse(storedLog);
      if (!Array.isArray(recoveryLog)) recoveryLog = [];
    } catch (e) {
      recoveryLog = [];
    }

    const isContaminated = typeof window.isLeafContentContaminated === 'function'
      ? window.isLeafContentContaminated
      : (html => html && String(html).indexOf('data-paperuss-ui') !== -1);

    const cleanUI = typeof window.cleanInternalEditorUI === 'function'
      ? window.cleanInternalEditorUI
      : (html => html || '');

    for (const leaf of allLeaves) {
      if (isContaminated(leaf.content)) {
        const originalRawHTML = leaf.content;
        recoveryLog.push({
          noteId: leaf.noteId || '',
          leafId: leaf.id,
          timestamp: Date.now(),
          originalRawHTML: originalRawHTML
        });

        const cleaned = cleanUI(leaf.content);
        leaf.content = cleaned;
        leaf.updatedAt = Date.now();
        await leafPut(leaf);
        await leafQueuePut({
          id: 'mut_fix_' + Date.now() + '_' + Math.random().toString(36).substr(2,6),
          noteId: leaf.noteId || '',
          action: 'put',
          data: Object.assign({}, leaf),
          timestamp: Date.now()
        });
        repairedCount++;
      }
    }

    // Also check window.notes in memory / localStorage
    if (typeof window !== 'undefined' && Array.isArray(window.notes)) {
      let notesModified = false;
      for (const n of window.notes) {
        if (isContaminated(n.content)) {
          const originalRawHTML = n.content;
          recoveryLog.push({
            noteId: n.id,
            leafId: 'note_default_' + n.id,
            timestamp: Date.now(),
            originalRawHTML: originalRawHTML
          });
          n.content = cleanUI(n.content);
          n.updatedAt = Date.now();
          notesModified = true;
          repairedCount++;
        }
      }
      if (notesModified && typeof window.persist === 'function') {
        window.persist();
      }
    }

    if (recoveryLog.length > 0) {
      try {
        localStorage.setItem('octonotes:contaminated_leaf_recovery_v1', JSON.stringify(recoveryLog));
      } catch (e) {}
    }
  } catch (err) {
    console.error('repairContaminatedLeavesOnce error:', err);
  }
  return repairedCount;
}

// Expose on global window object for clean modular access across existing scripts and tests
if (typeof window !== 'undefined') {
  window.paperussLeaves = {
    openLeavesDB,
    closeLeavesDB,
    deleteLeavesDB,
    leafPut,
    leafGet,
    leafGetAll,
    leafGetRaw,
    leafGetByNoteId,
    leafDel,
    leafQueuePut,
    leafQueueGetAll,
    leafQueueDel,
    leafQueueClear,
    getNoteLeafOrder,
    getNoteDefaultLeafId,
    getNoteLeafCount,
    getNoteActiveLeafId,
    setNoteActiveLeafId,
    getVirtualMainLeaf,
    isNoteMigratedToLeaves,
    repairContaminatedLeavesOnce
  };
}
