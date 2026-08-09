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
            if (isHeader) targetNote.headerHeight = edBody.style.paddingTop;
            else targetNote.footerHeight = edBody.style.paddingBottom;
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

  function recalculatePageViewPagination(note) {
    const edScroll = document.getElementById('editorScroll');
    const edBody = document.getElementById('noteBody');
    if (!edScroll || !edBody || !edScroll.classList.contains('wysiwyg-mode')) return;

    if (isPaginating) return;
    isPaginating = true;

    try {
      clearPaginationMarkers(edBody);

      const targetNote = note || (typeof activeNoteForAction === 'function' ? activeNoteForAction() : null);
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

      attachResizerDragHandlers(edBody, targetNote);

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

    edBody.addEventListener('input', () => schedulePagination());
    edBody.addEventListener('keyup', () => schedulePagination());

    // Window resize handler
    window.addEventListener('resize', () => schedulePagination());
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
