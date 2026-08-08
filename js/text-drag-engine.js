/* ============================================================
   PAPERUSS CUSTOM TEXT DRAG ENGINE  v1.0
   ============================================================
   Intercepts highlighted-text drags BEFORE the native browser
   drag system fires by using:
     1. capture-phase pointerdown  — registers drag intent
     2. setPointerCapture on target — owns all future pointer events
     3. capture-phase dragstart    — blocks native ghost completely
     4. capture-phase pointermove  — drives Swarm ghost at 60fps
     5. capture-phase pointerup    — commits rich-text drop

   Card Morphing Hero Ghost: 🚧 UNDER CONSTRUCTION 🚧
   Card ghost drag is disabled until a stable single engine is
   ready. The existing block-gutter drag (editor-ui.js) still
   works for block reordering via the ⠿ handle.
   ============================================================ */

// ── State ────────────────────────────────────────────────────
let _txtDragging     = false;   // ghost is live, following cursor
let _txtPreparing    = false;   // pointerdown inside selection, waiting for threshold
let _txtStartX       = 0;
let _txtStartY       = 0;
let _txtSourceRange  = null;
let _txtText         = '';
let _txtHTML         = '';
let _txtCaptureEl    = null;    // element we called setPointerCapture on
let _txtCaretMarker  = null;    // blinking drop-point caret line
let _txtGhost        = null;    // swarm ghost element

// ── Helpers ──────────────────────────────────────────────────
function _removeTxtGhost() {
  if (_txtGhost) { _txtGhost.remove(); _txtGhost = null; }
}

function _removeTxtCaret() {
  if (_txtCaretMarker) { _txtCaretMarker.remove(); _txtCaretMarker = null; }
}

function _resetTxt() {
  _txtDragging    = false;
  _txtPreparing   = false;
  _txtSourceRange = null;
  _txtText        = '';
  _txtHTML        = '';
  _txtCaptureEl   = null;
  _removeTxtGhost();
  _removeTxtCaret();
  document.body.classList.remove('is-text-dragging');
}

function _updateCaretMarker(clientX, clientY) {
  let range = null;
  if (document.caretRangeFromPoint) {
    range = document.caretRangeFromPoint(clientX, clientY);
  } else if (document.caretPositionFromPoint) {
    const pos = document.caretPositionFromPoint(clientX, clientY);
    if (pos) {
      range = document.createRange();
      range.setStart(pos.offsetNode, pos.offset);
      range.collapse(true);
    }
  }
  if (range) {
    const rects = range.getClientRects();
    if (rects.length > 0) {
      const rect = rects[0];
      if (!_txtCaretMarker) {
        _txtCaretMarker = document.createElement('div');
        _txtCaretMarker.className = 'text-drag-caret-marker';
        document.body.appendChild(_txtCaretMarker);
      }
      _txtCaretMarker.style.left   = `${rect.left + window.scrollX}px`;
      _txtCaretMarker.style.top    = `${rect.top + window.scrollY}px`;
      _txtCaretMarker.style.height = `${Math.max(rect.height, 16)}px`;
    }
  }
}

function _spawnSwarmGhost(clientX, clientY) {
  _removeTxtGhost();
  _txtGhost = document.createElement('div');
  _txtGhost.className = 'magic-flying-text-ghost';

  // ── Orbit characters — max 8, non-space chars only for clean orbit ──
  const orbitSource = Array.from(_txtText.replace(/\s+/g, '')).slice(0, 8);
  const totalChars  = orbitSource.length || 1;

  const charsHTML = orbitSource.map((ch, idx) => {
    const safe       = ch.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
    const angle      = (idx / totalChars) * 360;
    // Alternate inner/outer radius for depth illusion
    const radius     = idx % 2 === 0 ? 11 + (idx * 1.5) : 15 + (idx * 1.2);
    const flyDelay   = (idx * 0.045).toFixed(2);
    const flyDur     = (0.45 + (idx % 3) * 0.08).toFixed(2);
    // Vary orbit speed slightly per character — feels organic not robotic
    const orbitDur   = (2.4 + (idx % 4) * 0.35).toFixed(2);
    return `<span class="swarm-char" style="--angle:${angle}deg;--radius:${radius}px;--fly-delay:${flyDelay}s;--fly-dur:${flyDur}s;--orbit-dur:${orbitDur}s;">${safe}</span>`;
  }).join('');

  // ── Pill label — first 18 chars of text ──
  const snippetLabel = _txtText.length > 18 ? _txtText.substring(0, 18) + '…' : _txtText;
  const wordCount    = _txtText.trim().split(/\s+/).filter(Boolean).length;
  const wordLabel    = wordCount === 1 ? '1 word' : `${wordCount} words`;

  _txtGhost.innerHTML = `
    <span class="live-magnet-orb">✦</span>
    <span class="live-char-stream">${charsHTML}</span>
    <span class="ghost-snippet-label">${snippetLabel.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')}</span>
    <span class="ghost-word-count">${wordLabel}</span>
  `;
  _txtGhost.style.left = `${clientX}px`;
  _txtGhost.style.top  = `${clientY}px`;
  document.body.appendChild(_txtGhost);
}

function _commitDrop(clientX, clientY) {
  const el = document.elementFromPoint(clientX, clientY);
  const editable = el && el.closest
    ? el.closest('[contenteditable="true"],input,textarea,#noteTitle,#noteBody,td,th,li,p,h1,h2,h3,h4,h5,h6,.note-editor')
    : null;

  if (!editable || !_txtText) return;

  if (editable.tagName === 'INPUT' || editable.tagName === 'TEXTAREA') {
    const s = editable.selectionStart || 0;
    const v = editable.value;
    editable.value = v.substring(0, s) + _txtText + v.substring(editable.selectionEnd || 0);
    return;
  }

  // Remove source text first
  if (_txtSourceRange) {
    try { _txtSourceRange.deleteContents(); } catch (_) {}
  }

  // Get drop caret
  let dropRange = null;
  if (document.caretRangeFromPoint) {
    dropRange = document.caretRangeFromPoint(clientX, clientY);
  } else if (document.caretPositionFromPoint) {
    const pos = document.caretPositionFromPoint(clientX, clientY);
    if (pos) {
      dropRange = document.createRange();
      dropRange.setStart(pos.offsetNode, pos.offset);
      dropRange.collapse(true);
    }
  }
  if (!dropRange) return;

  const sel = window.getSelection();
  sel.removeAllRanges();
  sel.addRange(dropRange);

  const tempDiv = document.createElement('div');
  tempDiv.innerHTML = _txtHTML || _txtText;
  const frag = document.createDocumentFragment();
  let lastNode = null;
  while (tempDiv.firstChild) { lastNode = tempDiv.firstChild; frag.appendChild(lastNode); }
  dropRange.insertNode(frag);

  // Drop-release burst animation
  if (lastNode) {
    const burst = document.createElement('span');
    burst.className = 'text-drop-release-burst';
    if (lastNode.nodeType === 1) {
      burst.appendChild(lastNode.cloneNode(true));
      lastNode.parentNode && lastNode.parentNode.replaceChild(burst, lastNode);
    } else {
      burst.textContent = _txtText;
      lastNode.parentNode && lastNode.parentNode.replaceChild(burst, lastNode);
    }
    setTimeout(() => {
      if (burst.parentNode) {
        while (burst.firstChild) burst.parentNode.insertBefore(burst.firstChild, burst);
        burst.remove();
      }
    }, 350);
  }

  if (typeof handleBodyInput === 'function') handleBodyInput();
  if (typeof save === 'function') save();
}

// ── 1. pointerdown CAPTURE — register intent + claim pointer ─
document.addEventListener('pointerdown', (e) => {
  _resetTxt();

  // Only trigger on primary pointer (left mouse / first finger)
  if (e.button !== 0 && e.pointerType === 'mouse') return;

  const sel = window.getSelection();
  if (!sel || sel.isCollapsed || !sel.toString().trim()) return;

  // Must be clicking inside an editable area
  const target = (e.target && e.target.nodeType === 3) ? e.target.parentElement : e.target;
  const editable = target && target.closest
    ? target.closest('[contenteditable="true"],input,textarea,#noteTitle,#noteBody,td,th,li,p,h1,h2,h3,h4,h5,h6,.note-editor')
    : null;
  if (!editable) return;

  // Must be clicking inside the selection bounds
  try {
    const range = sel.getRangeAt(0);
    const rects = Array.from(range.getClientRects());
    const inside = rects.some(r =>
      e.clientX >= r.left && e.clientX <= r.right &&
      e.clientY >= r.top  && e.clientY <= r.bottom
    );
    if (!inside) return;

    _txtText        = sel.toString().trim();
    _txtSourceRange = range.cloneRange();
    const div = document.createElement('div');
    div.appendChild(range.cloneContents());
    _txtHTML = div.innerHTML;
  } catch (_) { return; }

  _txtStartX   = e.clientX;
  _txtStartY   = e.clientY;
  _txtPreparing = true;

  // CRITICAL: claim the pointer so pointermove fires even if
  // embeds.js or other listeners call e.preventDefault()
  try {
    if (e.target && e.target.setPointerCapture && e.pointerId != null) {
      e.target.setPointerCapture(e.pointerId);
      _txtCaptureEl = e.target;
    }
  } catch (_) {}
}, true); // ← capture phase = fires FIRST, before any other listener


// ── 2. dragstart CAPTURE — block native ghost ─────────────────
document.addEventListener('dragstart', (e) => {
  // If our text drag is active/preparing — kill native drag entirely
  if (_txtDragging || _txtPreparing) {
    e.preventDefault();
    e.stopImmediatePropagation();
    return;
  }
  // Yield to gutter block drag (editor-ui.js uses application/x-paperuss-drag)
  if (e.dataTransfer && e.dataTransfer.types &&
      e.dataTransfer.types.includes && e.dataTransfer.types.includes('application/x-paperuss-drag')) {
    return;
  }
}, true); // ← capture phase = fires FIRST


// ── 3. pointermove CAPTURE — drive ghost at 60fps ─────────────
document.addEventListener('pointermove', (e) => {
  if (!_txtPreparing && !_txtDragging) return;

  if (_txtPreparing && !_txtDragging) {
    const dist = Math.hypot(e.clientX - _txtStartX, e.clientY - _txtStartY);
    if (dist > 5) {
      _txtDragging  = true;
      _txtPreparing = false;
      document.body.classList.add('is-text-dragging');

      // Clear browser selection so it doesn't show native drag highlight
      try { window.getSelection().removeAllRanges(); } catch (_) {}

      _spawnSwarmGhost(e.clientX, e.clientY);
    }
  }

  if (_txtDragging) {
    e.preventDefault();
    if (_txtGhost) {
      _txtGhost.style.left = `${e.clientX}px`;
      _txtGhost.style.top  = `${e.clientY}px`;
    }
    _updateCaretMarker(e.clientX, e.clientY);
  }
}, true); // ← capture phase


// ── 4. pointerup CAPTURE — commit drop ────────────────────────
document.addEventListener('pointerup', (e) => {
  if (!_txtDragging) {
    _resetTxt();
    return;
  }
  e.preventDefault();
  _commitDrop(e.clientX, e.clientY);
  _resetTxt();
}, true); // ← capture phase


// ── 5. pointercancel / lostpointercapture — abort ─────────────
document.addEventListener('pointercancel', _resetTxt, true);
document.addEventListener('lostpointercapture', _resetTxt, true);
