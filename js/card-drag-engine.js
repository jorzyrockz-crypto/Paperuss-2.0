/* ============================================================
   PAPERUSS CUSTOM CARD DRAG & MORPHING HERO GHOST ENGINE v1.0
   ============================================================
   Captures card/block dragging with:
     1. capture-phase pointerdown on card blocks
     2. setPointerCapture on the card element
     3. 6px movement threshold -> spawns Hero Ghost Badge
     4. 4-way drop targeting (top/bottom/left/right) with hysteresis
     5. Automatic grid row creation or DOM reordering on drop
     6. Edge auto-scrolling during card drag

   Integrates seamlessly alongside text-drag-engine.js and editor-ui.js
   ============================================================ */

// ── State ────────────────────────────────────────────────────
let _cardDragging     = false;
let _cardPreparing    = false;
let _cardStartX       = 0;
let _cardStartY       = 0;
let _cardElement      = null;
let _cardHeroGhost    = null;
let _cardDropTargetEl = null;
let _cardDropMode     = null;

const CARD_SELECTOR = '.media-card, .paperuss-embed, .paperuss-card-audio, .paperuss-card-file, .paperuss-card, .broken-media-card, [data-paperuss-embed="true"], img, .responsive-img-wrapper, .code-block-wrapper, pre.code-block, table, .table-wrapper, .callout-box, blockquote, .card-grid-row';

// ── Helpers ──────────────────────────────────────────────────
function _getCardMetadata(cardEl) {
  if (!cardEl) return { icon: '≡', type: 'Block', label: 'Content Block' };

  if (cardEl.classList.contains('paperuss-card-audio') || cardEl.querySelector('audio')) {
    const title = cardEl.querySelector('.audio-title, .card-title, h4')?.textContent.trim() || 'Audio Track';
    return { icon: '🎵', type: 'Audio', label: title };
  }
  if (cardEl.classList.contains('paperuss-card-file') || cardEl.querySelector('.file-icon')) {
    const title = cardEl.querySelector('.file-name, .card-title')?.textContent.trim() || 'Attachment';
    return { icon: '📄', type: 'Attachment', label: title };
  }
  if (cardEl.classList.contains('paperuss-embed') || cardEl.querySelector('iframe, video')) {
    const title = cardEl.querySelector('.embed-title, iframe')?.title || 'Media Embed';
    return { icon: '🎬', type: 'Embed', label: title };
  }
  if (cardEl.classList.contains('paperuss-card') || cardEl.querySelector('.bookmark-title')) {
    const title = cardEl.querySelector('.bookmark-title, .card-title, h3, h4')?.textContent.trim() || 'Link Card';
    return { icon: '🔗', type: 'Link', label: title };
  }
  if (cardEl.tagName === 'TABLE' || cardEl.classList.contains('table-wrapper')) {
    return { icon: '📊', type: 'Table', label: 'Data Table' };
  }
  if (cardEl.classList.contains('card-grid-row')) {
    return { icon: '🧱', type: 'Grid Row', label: 'Card Grid' };
  }
  const title = cardEl.querySelector('h1, h2, h3, h4, h5, h6, p')?.textContent.trim() || 'Content Block';
  return { icon: '≡', type: 'Block', label: title.length > 18 ? title.substring(0, 18) + '…' : title };
}

function _clearCardHighlights() {
  if (_cardDropTargetEl) {
    _cardDropTargetEl.classList.remove('drop-target-left', 'drop-target-right', 'drop-target-top', 'drop-target-bottom');
  }
  document.querySelectorAll('.drop-target-left, .drop-target-right, .drop-target-top, .drop-target-bottom').forEach(el => {
    el.classList.remove('drop-target-left', 'drop-target-right', 'drop-target-top', 'drop-target-bottom');
  });
  _cardDropTargetEl = null;
  _cardDropMode     = null;
}

function _resetCardDrag() {
  if (_cardElement) {
    _cardElement.classList.remove('is-dragging-card-source');
    _cardElement = null;
  }
  if (_cardHeroGhost) {
    _cardHeroGhost.remove();
    _cardHeroGhost = null;
  }
  _cardDragging  = false;
  _cardPreparing = false;
  _clearCardHighlights();
  document.body.classList.remove('is-card-dragging');
}

function _spawnCardHeroGhost(cardEl, x, y) {
  if (_cardHeroGhost) _cardHeroGhost.remove();
  const meta = _getCardMetadata(cardEl);

  _cardHeroGhost = document.createElement('div');
  _cardHeroGhost.className = 'magic-card-hero-ghost';
  _cardHeroGhost.innerHTML = `
    <span class="card-ghost-hero-icon">${meta.icon}</span>
    <div class="card-ghost-label-box">
      <span class="card-ghost-type-tag">${meta.type}</span>
      <span class="card-ghost-title">${meta.label.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')}</span>
    </div>
  `;
  _cardHeroGhost.style.left = `${x}px`;
  _cardHeroGhost.style.top  = `${y}px`;
  document.body.appendChild(_cardHeroGhost);
}

function _updateDropHighlight(targetBlock, clientX, clientY) {
  if (!targetBlock || targetBlock === _cardElement || _cardElement.contains(targetBlock)) {
    _clearCardHighlights();
    return;
  }

  const mode = typeof detect4WayDropTargetWithHysteresis === 'function'
    ? detect4WayDropTargetWithHysteresis(targetBlock, clientX, clientY)
    : 'bottom';

  if (_cardDropTargetEl !== targetBlock || _cardDropMode !== mode) {
    _clearCardHighlights();
    targetBlock.classList.add(`drop-target-${mode}`);
    _cardDropTargetEl = targetBlock;
    _cardDropMode     = mode;
  }
}

// ── 1. pointerdown CAPTURE ────────────────────────────────────
document.addEventListener('pointerdown', (e) => {
  if (e.button !== 0 && e.pointerType === 'mouse') return;

  const noteBody = document.getElementById('noteBody');
  if (!noteBody) return;

  const targetEl = (e.target && e.target.nodeType === 3) ? e.target.parentElement : e.target;
  if (!targetEl || !noteBody.contains(targetEl)) return;

  // Explicit drag handle (e.g. grip icon on toolbar or card header)
  const isDragHandle = targetEl.closest && targetEl.closest('.card-drag-handle, .file-card-header');

  // Interactive UI targets (toolbar buttons, dropdowns, inputs, links, media controls)
  const INTERACTIVE = 'input, textarea, select, button, a, [contenteditable="true"], .embed-tb-btn, .embed-tb-dropdown, .embed-tb-select, .card-resize-handle, .audio-control-btn, .file-download-btn, .embed-action-btn';
  const isInteractiveUI = targetEl.closest && targetEl.closest(INTERACTIVE);

  // Never capture drag if clicking interactive toolbar controls (unless clicking explicit drag handle)
  if (isInteractiveUI && !isDragHandle) return;

  const card = targetEl.closest ? targetEl.closest(CARD_SELECTOR) : null;
  if (!card || !noteBody.contains(card)) return;

  _cardElement   = card;
  _cardStartX    = e.clientX;
  _cardStartY    = e.clientY;
  _cardPreparing = true;
}, true);

// ── 1.5. dragstart CAPTURE — 100% kill native browser ghost ────
document.addEventListener('dragstart', (e) => {
  if (_cardDragging || _cardPreparing || (typeof _txtDragging !== 'undefined' && (_txtDragging || _txtPreparing))) {
    e.preventDefault();
    e.stopImmediatePropagation();
    return;
  }

  // Yield to block gutter handle drag (application/x-paperuss-drag)
  if (e.dataTransfer && e.dataTransfer.types && e.dataTransfer.types.includes && e.dataTransfer.types.includes('application/x-paperuss-drag')) {
    return;
  }

  const noteBody = document.getElementById('noteBody');
  const targetEl = (e.target && e.target.nodeType === 3) ? e.target.parentElement : e.target;
  if (noteBody && targetEl) {
    const card = targetEl.closest ? targetEl.closest(CARD_SELECTOR) : null;
    if (card && noteBody.contains(card)) {
      if (e.dataTransfer) {
        e.dataTransfer.setData('text/plain', '');
        e.dataTransfer.effectAllowed = 'move';
        const blankCanvas = document.createElement('canvas');
        blankCanvas.width = 1;
        blankCanvas.height = 1;
        if (e.dataTransfer.setDragImage) {
          e.dataTransfer.setDragImage(blankCanvas, 0, 0);
        }
      }
    }
  }
}, true);

// ── 2. pointermove CAPTURE ────────────────────────────────────
document.addEventListener('pointermove', (e) => {
  if (!_cardPreparing && !_cardDragging) return;

  if (_cardPreparing && !_cardDragging) {
    const dist = Math.hypot(e.clientX - _cardStartX, e.clientY - _cardStartY);
    if (dist > 6) {
      _cardDragging  = true;
      _cardPreparing = false;
      document.body.classList.add('is-card-dragging');
      if (_cardElement) {
        _cardElement.classList.add('is-dragging-card-source');
        try {
          if (_cardElement.setPointerCapture && e.pointerId != null) {
            _cardElement.setPointerCapture(e.pointerId);
          }
        } catch (_) {}
      }
      _spawnCardHeroGhost(_cardElement, e.clientX, e.clientY);
      if (navigator.vibrate) navigator.vibrate(15);
    }
  }

  if (_cardDragging) {
    e.preventDefault();

    if (_cardHeroGhost) {
      _cardHeroGhost.style.left = `${e.clientX}px`;
      _cardHeroGhost.style.top  = `${e.clientY}px`;
    }

    const targetEl = document.elementFromPoint(e.clientX, e.clientY);
    const targetBlock = targetEl && targetEl.closest ? targetEl.closest(CARD_SELECTOR) : null;
    _updateDropHighlight(targetBlock, e.clientX, e.clientY);
  }
}, true);

// ── 3. pointerup CAPTURE — Commit drop ────────────────────────
document.addEventListener('pointerup', (e) => {
  if (!_cardDragging) {
    _resetCardDrag();
    return;
  }
  e.preventDefault();

  const targetEl = document.elementFromPoint(e.clientX, e.clientY);
  const targetBlock = targetEl && targetEl.closest ? targetEl.closest(CARD_SELECTOR) : null;

  if (_cardElement && targetBlock && targetBlock !== _cardElement && !_cardElement.contains(targetBlock)) {
    const mode = _cardDropMode || 'bottom';
    if (typeof handleDropAction === 'function') {
      handleDropAction(_cardElement, targetBlock, mode);
    }
    if (typeof reflowCardGridRows === 'function') reflowCardGridRows();
    if (typeof refreshCardComponentsAfterDrop === 'function') refreshCardComponentsAfterDrop(document.getElementById('noteBody'));
    if (typeof handleBodyInput === 'function') handleBodyInput();
    if (typeof save === 'function') save();
    if (navigator.vibrate) navigator.vibrate(25);
  } else if (_cardElement && (!targetBlock || !document.getElementById('noteBody')?.contains(targetEl))) {
    if (typeof detachCardFromGrid === 'function') detachCardFromGrid(_cardElement);
    if (typeof refreshCardComponentsAfterDrop === 'function') refreshCardComponentsAfterDrop(document.getElementById('noteBody'));
    if (typeof handleBodyInput === 'function') handleBodyInput();
    if (typeof save === 'function') save();
  }

  _resetCardDrag();
}, true);

// ── 4. abort ─────────────────────────────────────────────────
document.addEventListener('pointercancel',      _resetCardDrag, true);
document.addEventListener('lostpointercapture', _resetCardDrag, true);
