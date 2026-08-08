/* ============================================================
   PAPERUSS CUSTOM TEXT DRAG ENGINE  v2.0 — Warp Comet
   ============================================================
   Intercepts highlighted-text drags BEFORE the native browser
   drag system fires by using:
     1. capture-phase pointerdown  — registers drag intent
     2. setPointerCapture on target — owns all future pointer events
     3. capture-phase dragstart    — blocks native ghost completely
     4. capture-phase pointermove  — drives Comet at 60fps via RAF
     5. capture-phase pointerup    — commits rich-text drop

   Ghost: Warp Speed Comet — velocity-tracked star head + character
   tail that fans behind the drag direction, stretching wider/longer
   the faster you move. Slowing down collapses the tail to orbit.

   Card Morphing Hero Ghost: 🚧 UNDER CONSTRUCTION 🚧
   ============================================================ */

// ── State ────────────────────────────────────────────────────
let _txtDragging    = false;
let _txtPreparing   = false;
let _txtStartX      = 0;
let _txtStartY      = 0;
let _txtSourceRange = null;
let _txtText        = '';
let _txtHTML        = '';
let _txtCaptureEl   = null;
let _txtCaretMarker = null;

// ── Comet State ──────────────────────────────────────────────
let _cometOrb       = null;    // the star-head element
let _cometTailEls   = [];      // individual char tail elements
let _trailBuffer    = [];      // ring buffer of past {x,y} positions
let _prevX          = 0;
let _prevY          = 0;
let _rafId          = null;
const TRAIL_MAX     = 16;      // how many past positions we remember
const TAIL_CHARS    = 9;       // max characters in tail

// ── Helpers ──────────────────────────────────────────────────
function _removeComet() {
  if (_cometOrb) { _cometOrb.remove(); _cometOrb = null; }
  _cometTailEls.forEach(el => el.remove());
  _cometTailEls = [];
  _trailBuffer  = [];
  if (_rafId)   { cancelAnimationFrame(_rafId); _rafId = null; }
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
  _removeComet();
  _removeTxtCaret();
  document.body.classList.remove('is-text-dragging');
}

// ── Caret marker ─────────────────────────────────────────────
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
  if (!range) return;
  const rects = range.getClientRects();
  if (!rects.length) return;
  const rect = rects[0];
  if (!_txtCaretMarker) {
    _txtCaretMarker = document.createElement('div');
    _txtCaretMarker.className = 'text-drag-caret-marker';
    document.body.appendChild(_txtCaretMarker);
  }
  _txtCaretMarker.style.left   = `${rect.left + window.scrollX}px`;
  _txtCaretMarker.style.top    = `${rect.top  + window.scrollY}px`;
  _txtCaretMarker.style.height = `${Math.max(rect.height, 16)}px`;
}

// ── Spawn comet ───────────────────────────────────────────────
function _spawnComet(clientX, clientY) {
  _removeComet();

  // ── Star head orb ──
  _cometOrb = document.createElement('div');
  _cometOrb.className = 'comet-orb-head';
  _cometOrb.textContent = '✦';
  _cometOrb.style.left = `${clientX}px`;
  _cometOrb.style.top  = `${clientY}px`;
  document.body.appendChild(_cometOrb);

  // ── Tail character elements ──
  const chars = Array.from(_txtText.replace(/\s+/g, '')).slice(0, TAIL_CHARS);
  if (!chars.length) chars.push('·');

  chars.forEach((ch, i) => {
    const el = document.createElement('span');
    el.className = 'comet-tail-char';
    el.textContent = ch;
    // i=0 is closest to orb (brightest), i=last is furthest (faintest)
    el.style.setProperty('--tail-idx', String(i));
    el.style.setProperty('--tail-total', String(chars.length));
    el.style.left = `${clientX}px`;
    el.style.top  = `${clientY}px`;
    document.body.appendChild(el);
    _cometTailEls.push(el);
  });

  // Seed trail buffer at spawn point
  for (let i = 0; i < TRAIL_MAX; i++) _trailBuffer.push({ x: clientX, y: clientY });
  _prevX = clientX;
  _prevY = clientY;

  _rafId = requestAnimationFrame(_cometRafLoop);
}

// ── RAF update loop ────────────────────────────────────────────
function _cometRafLoop() {
  if (!_txtDragging) return;

  // Velocity — distance moved since last frame
  const dx       = _cometOrb ? parseFloat(_cometOrb.style.left) - _prevX : 0;
  const dy       = _cometOrb ? parseFloat(_cometOrb.style.top)  - _prevY : 0;
  const speed    = Math.hypot(dx, dy);

  // Tail spread multiplier — faster drag = longer tail spacing
  const spread   = Math.min(1 + speed * 0.35, 5.5);

  _cometTailEls.forEach((el, i) => {
    // Each char samples a different point in the trail history
    // i=0 → very recent past (just behind orb)
    // i=last → oldest point (furthest back)
    const bufIdx  = Math.round((i + 1) * (TRAIL_MAX / (_cometTailEls.length + 1)) * spread);
    const clamped = Math.min(bufIdx, _trailBuffer.length - 1);
    const pos     = _trailBuffer[Math.max(0, _trailBuffer.length - 1 - clamped)];

    if (pos) {
      el.style.left = `${pos.x}px`;
      el.style.top  = `${pos.y}px`;
    }

    // Opacity + scale fade with distance
    const t = i / Math.max(_cometTailEls.length - 1, 1);
    el.style.opacity   = String((1 - t * 0.88).toFixed(3));
    el.style.fontSize  = `${Math.max(10, 17 - i * 0.9)}px`;
  });

  _rafId = requestAnimationFrame(_cometRafLoop);
}

// ── Update orb position + trail buffer ────────────────────────
function _updateComet(clientX, clientY) {
  if (!_cometOrb) return;

  _prevX = parseFloat(_cometOrb.style.left) || clientX;
  _prevY = parseFloat(_cometOrb.style.top)  || clientY;

  // Move star head to cursor instantly
  _cometOrb.style.left = `${clientX}px`;
  _cometOrb.style.top  = `${clientY}px`;

  // Push new position into ring buffer
  _trailBuffer.push({ x: clientX, y: clientY });
  if (_trailBuffer.length > TRAIL_MAX) _trailBuffer.shift();
}

// ── Commit drop ───────────────────────────────────────────────
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

  // Delete source selection
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

  // Drop-release burst
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
    }, 1400); // matches CSS animation duration
  }

  if (typeof handleBodyInput === 'function') handleBodyInput();
  if (typeof save === 'function') save();
}

// ═══════════════════════════════════════════════════════════════
//  EVENT LISTENERS — all in capture phase so they fire FIRST
// ═══════════════════════════════════════════════════════════════

// ── 1. pointerdown ────────────────────────────────────────────
document.addEventListener('pointerdown', (e) => {
  _resetTxt();
  if (e.button !== 0 && e.pointerType === 'mouse') return;

  const sel = window.getSelection();
  if (!sel || sel.isCollapsed || !sel.toString().trim()) return;

  const target = (e.target && e.target.nodeType === 3) ? e.target.parentElement : e.target;
  const editable = target && target.closest
    ? target.closest('[contenteditable="true"],input,textarea,#noteTitle,#noteBody,td,th,li,p,h1,h2,h3,h4,h5,h6,.note-editor')
    : null;
  if (!editable) return;

  try {
    const range  = sel.getRangeAt(0);
    const rects  = Array.from(range.getClientRects());
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

  _txtStartX    = e.clientX;
  _txtStartY    = e.clientY;
  _txtPreparing = true;

  // Claim pointer — guarantees pointermove fires even after e.preventDefault() elsewhere
  try {
    if (e.target && e.target.setPointerCapture && e.pointerId != null) {
      e.target.setPointerCapture(e.pointerId);
      _txtCaptureEl = e.target;
    }
  } catch (_) {}
}, true);


// ── 2. dragstart — block native ghost ─────────────────────────
document.addEventListener('dragstart', (e) => {
  if (_txtDragging || _txtPreparing) {
    e.preventDefault();
    e.stopImmediatePropagation();
    return;
  }
  // Yield to block gutter drag
  if (e.dataTransfer && e.dataTransfer.types &&
      e.dataTransfer.types.includes && e.dataTransfer.types.includes('application/x-paperuss-drag')) {
    return;
  }
}, true);


// ── 3. pointermove — drive comet at 60fps ─────────────────────
document.addEventListener('pointermove', (e) => {
  if (!_txtPreparing && !_txtDragging) return;

  // Activate once threshold crossed
  if (_txtPreparing && !_txtDragging) {
    const dist = Math.hypot(e.clientX - _txtStartX, e.clientY - _txtStartY);
    if (dist > 5) {
      _txtDragging  = true;
      _txtPreparing = false;
      document.body.classList.add('is-text-dragging');
      try { window.getSelection().removeAllRanges(); } catch (_) {}
      _spawnComet(e.clientX, e.clientY);
    }
  }

  if (_txtDragging) {
    e.preventDefault();
    _updateComet(e.clientX, e.clientY);
    _updateCaretMarker(e.clientX, e.clientY);
  }
}, true);


// ── 4. pointerup — commit drop ────────────────────────────────
document.addEventListener('pointerup', (e) => {
  if (!_txtDragging) { _resetTxt(); return; }
  e.preventDefault();
  _commitDrop(e.clientX, e.clientY);
  _resetTxt();
}, true);


// ── 5. abort ─────────────────────────────────────────────────
document.addEventListener('pointercancel',       _resetTxt, true);
document.addEventListener('lostpointercapture',  _resetTxt, true);
