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
    const markers = edBody.querySelectorAll('.pv-page-divider');
    markers.forEach(m => m.remove());

    const children = Array.from(edBody.children);
    children.forEach(child => {
      if (child.dataset && child.dataset.pvBreakPushed) {
        child.style.marginTop = '';
        delete child.dataset.pvBreakPushed;
      }
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
      const { h: pageH } = getPageDimensions(targetNote);

      const children = Array.from(edBody.children).filter(el => !el.classList.contains('pv-page-divider'));
      if (children.length === 0) {
        isPaginating = false;
        return;
      }

      const bodyRect = edBody.getBoundingClientRect();
      const bodyTop = bodyRect.top;
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

          // Create physical page split divider
          const divider = document.createElement('div');
          divider.className = 'pv-page-divider';
          divider.contentEditable = 'false';
          divider.innerHTML = `<span class="pv-page-label">PAGE ${currentPageNum}</span>`;

          const padLeft = window.getComputedStyle(edBody).paddingLeft || '20mm';
          const padRight = window.getComputedStyle(edBody).paddingRight || '20mm';
          divider.style.marginLeft = `-${padLeft}`;
          divider.style.marginRight = `-${padRight}`;

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
            edBody.insertBefore(divider, child);
          } else {
            edBody.insertBefore(divider, child.nextSibling || child);
          }

          currentThreshold += pageH;
        } else if (childTop >= currentThreshold) {
          currentPageNum++;
          currentThreshold += pageH;
        }
      }
    } catch (e) {
      console.warn('PageView Pagination error:', e);
    } finally {
      isPaginating = false;
    }
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
