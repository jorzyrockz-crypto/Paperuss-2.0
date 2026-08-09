/* ============================================================
   PAPERRUSS REAL-TIME ELEMENT PAGINATION ENGINE (PAGE VIEW)
   ============================================================ */
(function() {
  let isPaginating = false;
  let debounceTimer = null;

  const PAGE_SIZES = {
    'a4': { w: 794, h: 1123 },
    'letter': { w: 816, h: 1056 },
    'legal': { w: 816, h: 1344 }
  };

  function getPageDimensions(note) {
    const sizeKey = (note && note.pageSize && PAGE_SIZES[note.pageSize]) ? note.pageSize : 'a4';
    const dim = PAGE_SIZES[sizeKey];
    const isLandscape = note && note.pageOrientation === 'landscape';
    const w = isLandscape ? dim.h : dim.w;
    const h = isLandscape ? dim.w : dim.h;
    return { w, h };
  }

  function clearPaginationMarkers(edBody) {
    if (!edBody) return;
    const markers = edBody.querySelectorAll('.pv-page-divider, .pv-header-overlay, .pv-footer-overlay');
    markers.forEach(m => m.remove());

    const children = Array.from(edBody.children);
    children.forEach(child => {
      if (child.dataset && child.dataset.pvBreakPushed) {
        child.style.marginTop = '';
        delete child.dataset.pvBreakPushed;
      }
    });
  }

  function formatPresetPageNum(pageNum, totalPages, style) {
    const pStr = String(pageNum).padStart(2, '0');
    const tStr = String(totalPages).padStart(2, '0');
    if (style === 'serif') return `— Page ${pageNum} of ${totalPages} —`;
    if (style === 'blueprint') return `[ PAGE: ${pStr} / ${tStr} ]`;
    if (style === 'botanical') return `Leaf 1 • Page ${pageNum}`;
    if (style === 'vintage') return `PAGE ${pageNum}.`;
    if (style === 'cyber') return `< PAGE // ${pStr} >`;
    return `Page ${pageNum} of ${totalPages}`;
  }

  function getDocumentStyle(note) {
    let saved = {};
    try { saved = JSON.parse(localStorage.getItem('paperuss_print_prefs') || '{}'); } catch(e) {}
    return (note && note.documentStyle) || saved.documentStyle || 'executive';
  }

  function createHeaderHtml(noteTitle, leafTitle, targetNote) {
    const style = getDocumentStyle(targetNote);
    const headerImgSrc = targetNote?.headerImage || (targetNote?.useCoverAsHeader && targetNote?.coverImage?.src);
    const customHeader = targetNote?.customHeaderTitle || 'PapeRuss';
    const customSubtitle = targetNote?.customSubtitle || leafTitle;

    let bannerHtml = '';
    if (headerImgSrc) {
      bannerHtml = `<div class="pv-header-banner-wrap" style="width:100%;height:38px;margin-bottom:6px;overflow:hidden;border-radius:4px;"><img src="${esc(headerImgSrc)}" style="width:100%;height:100%;object-fit:cover;" /></div>`;
    }

    return `<div class="pv-header-overlay pv-header-${style}" contenteditable="false">
      ${bannerHtml}
      <div class="pv-header-content" style="display:flex;justify-content:space-between;align-items:center;width:100%;">
        <div class="pv-header-left" contenteditable="true" data-header-field="title"><strong class="pv-brand-${style}">${esc(customHeader)}</strong> <span class="pv-dot">•</span> <span>${esc(noteTitle)}</span></div>
        <div class="pv-header-right" contenteditable="true" data-header-field="subtitle" style="color:var(--fg-muted,#64748b);">${esc(customSubtitle)}</div>
      </div>
      <div class="pv-header-resizer" title="Drag to adjust Header Height"></div>
    </div>`;
  }

  function createFooterHtml(pageNum, totalPages, refId, targetNote) {
    const style = getDocumentStyle(targetNote);
    const pagenumText = formatPresetPageNum(pageNum, totalPages, style);

    return `<div class="pv-footer-overlay pv-footer-${style}" contenteditable="false">
      <div class="pv-footer-resizer" title="Drag to adjust Footer Height"></div>
      <div class="pv-footer-content" style="display:flex;justify-content:space-between;align-items:center;width:100%;">
        <div class="pv-footer-left" contenteditable="true" data-footer-field="ref" style="color:var(--fg-muted,#94a3b8);">Ref ID: ${esc(refId)}</div>
        <div class="pv-footer-right pv-pagenum-${style}">${pagenumText}</div>
      </div>
    </div>`;
  }

  /* ============================================================
     HEADER & FOOTER CONTEXT-AWARE FLOATING TOOLBAR
     ============================================================ */
  let hfPanel = null;
  let activeHFZone = null;

  function initHeaderFooterContextPanel() {
    if (hfPanel) return;

    hfPanel = document.createElement('div');
    hfPanel.id = 'hfContextPanel';
    hfPanel.className = 'hf-context-panel glass-panel hidden';
    hfPanel.style.display = 'none';
    hfPanel.style.zIndex = '10000';
    hfPanel.innerHTML = `
      <div class="hf-panel-group" style="display:flex;align-items:center;gap:4px;">
        <span class="hf-label" style="font-size:10px;font-weight:700;color:var(--fg-muted,#64748b);">Theme:</span>
        <button type="button" class="hf-theme-btn" data-hf-theme="executive" title="Executive Indigo">🏢 Exec</button>
        <button type="button" class="hf-theme-btn" data-hf-theme="serif" title="Editorial Serif">📜 Serif</button>
        <button type="button" class="hf-theme-btn" data-hf-theme="blueprint" title="Tech Blueprint">⚡ Mono</button>
        <button type="button" class="hf-theme-btn" data-hf-theme="botanical" title="Zen Botanical">🌸 Zen</button>
        <button type="button" class="hf-theme-btn" data-hf-theme="vintage" title="Vintage Press">📰 Press</button>
        <button type="button" class="hf-theme-btn" data-hf-theme="cyber" title="Cyber Codex">🔮 Cyber</button>
      </div>
      <div class="hf-sep" style="width:1px;height:16px;background:var(--border,rgba(0,0,0,0.15));margin:0 4px;"></div>
      <div class="hf-panel-group" style="display:flex;align-items:center;gap:4px;">
        <button type="button" class="hf-action-btn" id="hfBannerToggle" title="Toggle Header Banner Image">
          <i data-lucide="image" class="w-3.5 h-3.5"></i>
          <span>Banner</span>
        </button>
        <button type="button" class="hf-action-btn" id="hfResetText" title="Reset Header/Footer Text">
          <i data-lucide="rotate-ccw" class="w-3.5 h-3.5"></i>
          <span>Reset</span>
        </button>
      </div>
    `;
    document.body.appendChild(hfPanel);

    // Prevent mousedown inside panel from stealing active selection/editable focus
    hfPanel.addEventListener('mousedown', (e) => e.preventDefault());

    document.addEventListener('selectionchange', handleHFSelectionChange);
    document.addEventListener('click', handleHFClick);

    hfPanel.addEventListener('click', (e) => {
      const themeBtn = e.target.closest('button[data-hf-theme]');
      const bannerBtn = e.target.closest('#hfBannerToggle');
      const resetBtn = e.target.closest('#hfResetText');

      const targetNote = (typeof activeNoteForAction === 'function' ? activeNoteForAction() : null) || (typeof getNote === 'function' && typeof state !== 'undefined' ? getNote(state.currentId) : null);
      if (!targetNote) return;

      if (themeBtn) {
        const theme = themeBtn.dataset.hfTheme;
        targetNote.documentStyle = theme;
        try {
          const saved = JSON.parse(localStorage.getItem('paperuss_print_prefs') || '{}');
          saved.documentStyle = theme;
          localStorage.setItem('paperuss_print_prefs', JSON.stringify(saved));
        } catch(_) {}
        targetNote.updatedAt = Date.now();
        if (typeof save === 'function') save();
        recalculatePageViewPagination(targetNote);
        if (typeof toast === 'function') toast(`Document theme set to ${theme}`);
      } else if (bannerBtn) {
        if (targetNote.headerImage) {
          targetNote.headerImage = '';
          targetNote.useCoverAsHeader = false;
          if (typeof toast === 'function') toast('Header banner removed');
        } else if (targetNote.coverImage?.src) {
          targetNote.headerImage = targetNote.coverImage.src;
          targetNote.useCoverAsHeader = true;
          if (typeof toast === 'function') toast('Cover set as Header Banner');
        } else {
          const imgInput = document.getElementById('mediaImageInput');
          if (imgInput) imgInput.click();
        }
        targetNote.updatedAt = Date.now();
        if (typeof save === 'function') save();
        recalculatePageViewPagination(targetNote);
      } else if (resetBtn) {
        delete targetNote.customHeaderTitle;
        delete targetNote.customSubtitle;
        delete targetNote.customFooterText;
        targetNote.updatedAt = Date.now();
        if (typeof save === 'function') save();
        recalculatePageViewPagination(targetNote);
        if (typeof toast === 'function') toast('Header & Footer reset to default');
      }
    });
  }

  function handleHFSelectionChange() {
    const edBody = document.getElementById('noteBody');
    if (!edBody) return;
    const sel = window.getSelection();
    if (sel && sel.anchorNode && edBody.contains(sel.anchorNode)) {
      let node = sel.anchorNode;
      if (node.nodeType === 3) node = node.parentElement;
      const hfZone = node.closest && node.closest('.pv-header-overlay, .pv-footer-overlay');
      if (hfZone) {
        activeHFZone = hfZone;
        const rect = hfZone.getBoundingClientRect();
        hfPanel.style.position = 'fixed';
        hfPanel.style.left = `${Math.max(10, Math.min(rect.left, window.innerWidth - 340))}px`;
        hfPanel.style.top = `${Math.max(10, rect.top - 48)}px`;
        hfPanel.style.display = 'flex';
        hfPanel.classList.remove('hidden');
        if (typeof lucide?.createIcons === 'function') {
          try { lucide.createIcons(); } catch(_) {}
        }
        return;
      }
    }
    if (hfPanel && !hfPanel.contains(document.activeElement)) {
      hfPanel.style.display = 'none';
      hfPanel.classList.add('hidden');
    }
  }

  function handleHFClick(e) {
    if (hfPanel && !hfPanel.contains(e.target) && !e.target.closest('.pv-header-overlay, .pv-footer-overlay')) {
      hfPanel.style.display = 'none';
      hfPanel.classList.add('hidden');
    }
  }

  function autoExpandHeaderFooterHeights(edBody, targetNote) {
    // Only auto-expand if the user has NOT manually set a custom height via the resizer
    const hasCustomHeader = targetNote && targetNote._headerResized;
    const hasCustomFooter = targetNote && targetNote._footerResized;

    const headerOverlays = edBody.querySelectorAll('.pv-header-overlay');
    const footerOverlays = edBody.querySelectorAll('.pv-footer-overlay');

    if (!hasCustomHeader) {
      let maxHeaderH = 50;
      headerOverlays.forEach(h => {
        maxHeaderH = Math.max(maxHeaderH, h.offsetHeight || h.scrollHeight || 50);
      });
      const targetTop = maxHeaderH + 24;
      edBody.style.paddingTop = `${targetTop}px`;
      if (targetNote) targetNote.headerHeight = edBody.style.paddingTop;
    }

    if (!hasCustomFooter) {
      let maxFooterH = 50;
      footerOverlays.forEach(f => {
        maxFooterH = Math.max(maxFooterH, f.offsetHeight || f.scrollHeight || 50);
      });
      const targetBottom = maxFooterH + 24;
      edBody.style.paddingBottom = `${targetBottom}px`;
      if (targetNote) targetNote.footerHeight = edBody.style.paddingBottom;
    }
  }

  function attachResizerDragHandlers(edBody, targetNote) {
    edBody.querySelectorAll('.pv-header-resizer, .pv-footer-resizer').forEach(resizer => {
      if (resizer.dataset.dragAttached) return;
      resizer.dataset.dragAttached = 'true';

      resizer.onpointerdown = (e) => {
        e.preventDefault();
        e.stopPropagation();
        const isHeader = resizer.classList.contains('pv-header-resizer');
        const startY = e.clientY;
        const startPad = isHeader
          ? (parseFloat(window.getComputedStyle(edBody).paddingTop) || 75)
          : (parseFloat(window.getComputedStyle(edBody).paddingBottom) || 75);

        let tooltip = document.createElement('div');
        tooltip.className = 'pv-resize-tooltip';
        document.body.appendChild(tooltip);

        let liveRaf = null;
        const onMove = (moveEv) => {
          const deltaY = moveEv.clientY - startY;
          const newPad = Math.max(20, Math.min(250, Math.round(isHeader ? startPad + deltaY : startPad - deltaY)));
          const mmVal = Math.round(newPad * 0.264583);

          if (isHeader) edBody.style.paddingTop = `${newPad}px`;
          else edBody.style.paddingBottom = `${newPad}px`;

          tooltip.style.left = `${moveEv.clientX + 15}px`;
          tooltip.style.top = `${moveEv.clientY - 10}px`;
          tooltip.style.display = 'block';
          tooltip.textContent = `${isHeader ? 'Header Height' : 'Footer Height'}: ${mmVal}mm (${newPad}px)`;

          if (!liveRaf) {
            liveRaf = requestAnimationFrame(() => {
              liveRaf = null;
              recalculatePageViewPagination(targetNote);
            });
          }
        };

        const onUp = () => {
          window.removeEventListener('pointermove', onMove);
          window.removeEventListener('pointerup', onUp);
          tooltip.remove();
          if (liveRaf) { cancelAnimationFrame(liveRaf); liveRaf = null; }
          if (targetNote) {
            if (isHeader) { targetNote.headerHeight = edBody.style.paddingTop; targetNote._headerResized = true; }
            else { targetNote.footerHeight = edBody.style.paddingBottom; targetNote._footerResized = true; }
            targetNote.updatedAt = Date.now();
            if (typeof save === 'function') save();
          }
          recalculatePageViewPagination(targetNote);
        };

        window.addEventListener('pointermove', onMove);
        window.addEventListener('pointerup', onUp);
      };
    });
  }

  function attachHeaderFooterEditableListeners(edBody, targetNote) {
    if (!targetNote) return;
    edBody.querySelectorAll('[data-header-field], [data-footer-field]').forEach(field => {
      if (field.dataset.editListenerAttached) return;
      field.dataset.editListenerAttached = 'true';

      field.addEventListener('input', () => {
        if (!targetNote) return;
        const hField = field.dataset.headerField;
        const fField = field.dataset.footerField;
        const text = field.textContent.trim();

        if (hField === 'title') targetNote.customHeaderTitle = text;
        else if (hField === 'subtitle') targetNote.customSubtitle = text;
        else if (fField === 'ref') targetNote.customFooterText = text;

        targetNote.updatedAt = Date.now();
        if (typeof save === 'function') save();
        autoExpandHeaderFooterHeights(edBody, targetNote);
      });
    });
  }

  function recalculatePageViewPagination(note) {
    const edScroll = document.getElementById('editorScroll');
    const edBody = document.getElementById('noteBody');
    if (!edScroll || !edBody || !edScroll.classList.contains('wysiwyg-mode')) return;

    if (isPaginating) return;
    isPaginating = true;

    try {
      clearPaginationMarkers(edBody);

      const targetNote = note
        || (typeof getNote === 'function' && typeof state !== 'undefined' && state.currentId ? getNote(state.currentId) : null)
        || (typeof window.currentNote !== 'undefined' ? window.currentNote : null);
      if (!targetNote) { isPaginating = false; return; }

      const { h: pageH } = getPageDimensions(targetNote);

      const noteTitle = (typeof titleOf === 'function' ? titleOf(targetNote) : targetNote.title) || 'Untitled Note';
      const leafTitle = (window.currentActiveLeaf ? window.currentActiveLeaf.title : '') || 'Active Leaf';
      const refId = targetNote.id ? targetNote.id.substring(0, 8) : 'PAPERUSS';

      const children = Array.from(edBody.children).filter(el =>
        !el.classList.contains('pv-page-divider') &&
        !el.classList.contains('pv-header-overlay') &&
        !el.classList.contains('pv-footer-overlay')
      );

      if (children.length === 0) {
        isPaginating = false;
        return;
      }

      const bodyRect = edBody.getBoundingClientRect();
      const bodyTop = bodyRect.top;
      const totalHeight = edBody.scrollHeight;
      const totalEstimatedPages = Math.max(1, Math.ceil(totalHeight / pageH));

      // Inject Page 1 Header at top
      const page1Header = document.createElement('div');
      page1Header.innerHTML = createHeaderHtml(noteTitle, leafTitle, targetNote);
      edBody.insertBefore(page1Header.firstElementChild, edBody.firstChild);

      let currentPageNum = 1;
      let currentThreshold = bodyTop + pageH;

      for (let i = 0; i < children.length; i++) {
        const child = children[i];
        const childRect = child.getBoundingClientRect();
        const childTop = childRect.top;
        const childBottom = childRect.bottom;

        // If block crosses current page threshold
        if (childBottom > currentThreshold && childTop < currentThreshold) {
          currentPageNum++;

          // Footer for previous page
          const prevFooter = document.createElement('div');
          prevFooter.innerHTML = createFooterHtml(currentPageNum - 1, totalEstimatedPages, refId, targetNote);

          // Physical page split divider
          const divider = document.createElement('div');
          divider.className = 'pv-page-divider';
          divider.contentEditable = 'false';
          divider.innerHTML = `<span class="pv-page-label">PAGE ${currentPageNum}</span>`;

          const padLeft = window.getComputedStyle(edBody).paddingLeft || '20mm';
          const padRight = window.getComputedStyle(edBody).paddingRight || '20mm';
          divider.style.marginLeft = `-${padLeft}`;
          divider.style.marginRight = `-${padRight}`;

          // Header for next page
          const nextPageHeader = document.createElement('div');
          nextPageHeader.innerHTML = createHeaderHtml(noteTitle, leafTitle, targetNote);

          // If block is large (e.g. card, callout, table, image), push it down to next page top
          const isComplexBlock = child.classList.contains('paperuss-card') ||
                                 child.classList.contains('paperuss-embed') ||
                                 child.classList.contains('callout') ||
                                 child.tagName === 'TABLE' ||
                                 child.tagName === 'IMG' ||
                                 child.tagName === 'H1' ||
                                 child.tagName === 'H2';

          if (isComplexBlock) {
            const pushDistance = currentThreshold - childTop + 16;
            child.style.marginTop = `${pushDistance}px`;
            child.dataset.pvBreakPushed = 'true';

            edBody.insertBefore(prevFooter.firstElementChild, child);
            edBody.insertBefore(divider, child);
            edBody.insertBefore(nextPageHeader.firstElementChild, child);
          } else {
            const targetRef = child.nextSibling || child;
            edBody.insertBefore(prevFooter.firstElementChild, targetRef);
            edBody.insertBefore(divider, targetRef);
            edBody.insertBefore(nextPageHeader.firstElementChild, targetRef);
          }

          currentThreshold += pageH;
        } else if (childTop >= currentThreshold) {
          currentPageNum++;
          currentThreshold += pageH;
        }
      }

      // Inject Final Page Footer at bottom of document
      const finalFooter = document.createElement('div');
      finalFooter.innerHTML = createFooterHtml(currentPageNum, Math.max(currentPageNum, totalEstimatedPages), refId, targetNote);
      edBody.appendChild(finalFooter.firstElementChild);

      autoExpandHeaderFooterHeights(edBody, targetNote);
      attachResizerDragHandlers(edBody, targetNote);
      attachHeaderFooterEditableListeners(edBody, targetNote);
      initHeaderFooterContextPanel();

    } catch (e) {
      console.warn('PageView Pagination error:', e);
    } finally {
      isPaginating = false;
    }
  }

  function esc(str) {
    if (!str) return '';
    return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function schedulePagination(note) {
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      recalculatePageViewPagination(note);
    }, 120);
  }

  function attachEditorObserver() {
    const edBody = document.getElementById('noteBody');
    if (!edBody || edBody.dataset.pvObserverAttached) return;

    edBody.dataset.pvObserverAttached = 'true';

    const getCurrentNote = () =>
      (typeof getNote === 'function' && typeof state !== 'undefined' && state.currentId)
        ? getNote(state.currentId) : null;

    edBody.addEventListener('input', () => schedulePagination(getCurrentNote()));
    edBody.addEventListener('keyup', () => schedulePagination(getCurrentNote()));

    // Window resize handler
    window.addEventListener('resize', () => schedulePagination(getCurrentNote()));
  }

  window.PageLayoutEngine = {
    apply: function(note) {
      attachEditorObserver();
      setTimeout(() => recalculatePageViewPagination(note), 60);
    },
    recalculate: function(note) {
      recalculatePageViewPagination(note);
    },
    clear: function() {
      const edBody = document.getElementById('noteBody');
      clearPaginationMarkers(edBody);
    }
  };
})();
