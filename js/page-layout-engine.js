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

  function createHeaderHtml(noteTitle, leafTitle) {
    return `<div class="pv-header-overlay" contenteditable="false">
      <div class="pv-header-left"><strong style="color:var(--accent,#6366f1);">PapeRuss</strong> <span class="pv-dot">•</span> <span>${esc(noteTitle)}</span></div>
      <div class="pv-header-right" style="color:var(--fg-muted,#64748b);">${esc(leafTitle)}</div>
    </div>`;
  }

  function createFooterHtml(pageNum, totalPages, refId) {
    return `<div class="pv-footer-overlay" contenteditable="false">
      <div class="pv-footer-left" style="color:var(--fg-muted,#94a3b8);">Ref ID: ${esc(refId)}</div>
      <div class="pv-footer-right" style="font-weight:700;color:var(--fg-muted,#64748b);">Page ${pageNum} of ${totalPages}</div>
    </div>`;
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
      page1Header.innerHTML = createHeaderHtml(noteTitle, leafTitle);
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
          prevFooter.innerHTML = createFooterHtml(currentPageNum - 1, totalEstimatedPages, refId);

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
          nextPageHeader.innerHTML = createHeaderHtml(noteTitle, leafTitle);

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
      finalFooter.innerHTML = createFooterHtml(currentPageNum, Math.max(currentPageNum, totalEstimatedPages), refId);
      edBody.appendChild(finalFooter.firstElementChild);

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
