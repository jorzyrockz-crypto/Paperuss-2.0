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
  const PAGE_GAP_HEIGHT = 42;

  function getPageDimensions(note) {
    if (typeof window.getPaperussPageLayoutConfig === 'function') {
      const shared = window.getPaperussPageLayoutConfig(note || {});
      return { w: shared.pageWidth, h: shared.pageHeight };
    }
    const sizeKey = (note && note.pageSize && PAGE_SIZES[note.pageSize]) ? note.pageSize : 'a4';
    const dim = PAGE_SIZES[sizeKey];
    const isLandscape = note && note.pageOrientation === 'landscape';
    const w = isLandscape ? dim.h : dim.w;
    const h = isLandscape ? dim.w : dim.h;
    return { w, h };
  }

  function clearPaginationMarkers(edBody) {
    if (!edBody) return;
    // The shared toolbar is temporarily mounted inside the active page zone.
    // Preserve it before pagination replaces that zone.
    if (hfPanel && hfPanel.isConnected && edBody.contains(hfPanel)) {
      hfPanel.classList.add('hidden');
      hfPanel.style.setProperty('display', 'none', 'important');
      document.body.appendChild(hfPanel);
      activeHFZone = null;
    }
    const markers = edBody.querySelectorAll('.pv-page-divider, .pv-page-gap, .pv-header-overlay, .pv-footer-overlay');
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
    // The header is one free-form document region. Carry forward only header
    // text that the user explicitly saved in the former split layout.
    const legacyHeader = [targetNote?.customHeaderTitle, targetNote?.customSubtitle]
      .filter(value => typeof value === 'string' && value.trim())
      .join(' • ');
    const headerContent = typeof targetNote?.customHeaderContent === 'string'
      ? targetNote.customHeaderContent
      : legacyHeader;
    const headerHtml = typeof targetNote?.customHeaderHtml === 'string'
      ? sanitizeHeaderFooterHtml(targetNote.customHeaderHtml)
      : esc(headerContent);

    let bannerHtml = '';
    if (headerImgSrc) {
      bannerHtml = `<div class="pv-header-banner-wrap" style="width:100%;height:38px;margin-bottom:6px;overflow:hidden;border-radius:4px;"><img src="${esc(headerImgSrc)}" style="width:100%;height:100%;object-fit:cover;" /></div>`;
    }

    return `<div class="pv-header-overlay pv-header-${style}" contenteditable="false" data-paperuss-page-ui="true">
      ${bannerHtml}
      <div class="pv-header-content">
        <div class="pv-header-editor pv-editable-field" contenteditable="true" spellcheck="true" tabindex="0" role="textbox" aria-label="Document header" data-placeholder="Type header" data-header-field="content">${headerHtml}</div>
      </div>
      <div class="pv-header-resizer" title="Drag to adjust Header Height"></div>
    </div>`;
  }

  function createFooterHtml(pageNum, totalPages, refId, targetNote) {
    const style = getDocumentStyle(targetNote);
    const pagenumText = formatPresetPageNum(pageNum, totalPages, style);

    const customFooter = targetNote?.customFooterText || `Ref ID: ${refId}`;
    const footerHtml = typeof targetNote?.customFooterHtml === 'string'
      ? sanitizeHeaderFooterHtml(targetNote.customFooterHtml)
      : esc(customFooter);

    const showFooterText = targetNote?.showFooter !== false;
    const showPageNums = targetNote?.showPageNums !== false;

    return `<div class="pv-footer-overlay pv-footer-${style}" contenteditable="false" data-paperuss-page-ui="true">
      <div class="pv-footer-resizer" title="Drag to adjust Footer Height"></div>
      <div class="pv-footer-content" style="display:flex;justify-content:space-between;align-items:center;width:100%;">
        ${showFooterText ? `<div class="pv-footer-left pv-editable-field" contenteditable="true" spellcheck="true" tabindex="0" data-footer-field="ref" style="color:var(--fg-muted,#94a3b8);">${footerHtml}</div>` : '<div></div>'}
        ${showPageNums ? `<div class="pv-footer-right pv-pagenum-${style}">${pagenumText}</div>` : ''}
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
    hfPanel.className = 'img-toolbar hf-context-panel show hidden';
    hfPanel.style.setProperty('display', 'none', 'important');
    hfPanel.style.zIndex = '150';
    // Only placement is specialized. The surface and controls deliberately
    // reuse the image toolbar's shared design-system classes.
    hfPanel.style.setProperty('position', 'absolute', 'important');
    hfPanel.style.setProperty('left', '50%', 'important');
    hfPanel.style.setProperty('transform', 'translateX(-50%) translateZ(0)', 'important');
    hfPanel.setAttribute('contenteditable', 'false');
    hfPanel.setAttribute('role', 'toolbar');
    hfPanel.setAttribute('aria-label', 'Header and footer options');
    hfPanel.innerHTML = `
      <button type="button" class="itb-btn hf-theme-btn" data-hf-theme="executive" title="Executive Indigo" aria-label="Executive Indigo"><i data-lucide="briefcase" class="w-4 h-4"></i></button>
      <button type="button" class="itb-btn hf-theme-btn" data-hf-theme="serif" title="Editorial Serif" aria-label="Editorial Serif"><i data-lucide="book-open" class="w-4 h-4"></i></button>
      <button type="button" class="itb-btn hf-theme-btn" data-hf-theme="blueprint" title="Tech Blueprint" aria-label="Tech Blueprint"><i data-lucide="ruler" class="w-4 h-4"></i></button>
      <button type="button" class="itb-btn hf-theme-btn" data-hf-theme="botanical" title="Zen Botanical" aria-label="Zen Botanical"><i data-lucide="leaf" class="w-4 h-4"></i></button>
      <button type="button" class="itb-btn hf-theme-btn" data-hf-theme="vintage" title="Vintage Press" aria-label="Vintage Press"><i data-lucide="newspaper" class="w-4 h-4"></i></button>
      <button type="button" class="itb-btn hf-theme-btn" data-hf-theme="cyber" title="Cyber Codex" aria-label="Cyber Codex"><i data-lucide="sparkles" class="w-4 h-4"></i></button>
      <span class="hf-format-separator" aria-hidden="true"></span>
      <button type="button" class="itb-btn hf-action-btn" id="hfBannerToggle" title="Toggle Header Banner Image" aria-label="Toggle Header Banner Image"><i data-lucide="image" class="w-4 h-4"></i></button>
      <button type="button" class="itb-btn hf-action-btn" id="hfResetText" title="Reset Header/Footer Text" aria-label="Reset Header/Footer Text"><i data-lucide="rotate-ccw" class="w-4 h-4"></i></button>
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
        delete targetNote.customHeaderHtml;
        delete targetNote.customHeaderContent;
        delete targetNote.customHeaderTitle;
        delete targetNote.customSubtitle;
        delete targetNote.customFooterHtml;
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
        if (activeHFZone && activeHFZone !== hfZone) activeHFZone.classList.remove('hf-toolbar-active');
        activeHFZone = hfZone;
        activeHFZone.classList.add('hf-toolbar-active');
        hfZone.appendChild(hfPanel);
        const targetNote = (typeof activeNoteForAction === 'function' ? activeNoteForAction() : null) || (typeof getNote === 'function' && typeof state !== 'undefined' ? getNote(state.currentId) : null);
        hfPanel.querySelectorAll('[data-hf-theme]').forEach(btn => {
          btn.classList.toggle('active', btn.dataset.hfTheme === getDocumentStyle(targetNote));
        });
        hfPanel.style.setProperty('position', 'absolute', 'important');
        hfPanel.style.setProperty('display', 'flex', 'important');
        hfPanel.classList.remove('hidden');
        if (hfZone.classList.contains('pv-header-overlay')) {
          hfPanel.style.setProperty('top', 'calc(100% + 8px)', 'important');
          hfPanel.style.setProperty('bottom', 'auto', 'important');
        } else {
          hfPanel.style.setProperty('top', 'auto', 'important');
          hfPanel.style.setProperty('bottom', 'calc(100% + 8px)', 'important');
        }
        if (typeof lucide?.createIcons === 'function') {
          try { lucide.createIcons(); } catch(_) {}
        }
        return;
      }
    }
    if (hfPanel && !hfPanel.contains(document.activeElement)) {
      hfPanel.style.setProperty('display', 'none', 'important');
      hfPanel.classList.add('hidden');
      if (activeHFZone) activeHFZone.classList.remove('hf-toolbar-active');
      activeHFZone = null;
    }
  }

  function getActiveHeaderFooterField() {
    const selection = window.getSelection();
    let node = selection && selection.anchorNode;
    if (node && node.nodeType === 3) node = node.parentElement;
    const selectedField = node?.closest?.('[data-header-field], [data-footer-field]');
    if (selectedField && activeHFZone?.contains(selectedField)) return selectedField;
    return activeHFZone?.querySelector('[data-header-field], [data-footer-field]') || null;
  }

  function handleHFClick(e) {
    if (hfPanel && !hfPanel.contains(e.target) && !e.target.closest('.pv-header-overlay, .pv-footer-overlay')) {
      hfPanel.style.setProperty('display', 'none', 'important');
      hfPanel.classList.add('hidden');
      if (activeHFZone) activeHFZone.classList.remove('hf-toolbar-active');
      activeHFZone = null;
    }
  }

  function autoExpandHeaderFooterHeights(edBody, targetNote) {
    const hasCustomHeader = targetNote && targetNote._headerResized;
    const hasCustomFooter = targetNote && targetNote._footerResized;

    const headerOverlays = edBody.querySelectorAll('.pv-header-overlay');
    const footerOverlays = edBody.querySelectorAll('.pv-footer-overlay');

    // Headers and footers participate in normal document flow, so content
    // already expands them downward. Changing page padding here double-counted
    // that growth and moved the whole header away from the top of the page.
    const legacyHeaderMinimum = hasCustomHeader ? Math.max(24, (parseFloat(targetNote.headerHeight) || 74) - 24) : 0;
    const legacyFooterMinimum = hasCustomFooter ? Math.max(24, (parseFloat(targetNote.footerHeight) || 74) - 24) : 0;
    const headerMinimum = parseFloat(targetNote?.headerMinHeight) || legacyHeaderMinimum;
    const footerMinimum = parseFloat(targetNote?.footerMinHeight) || legacyFooterMinimum;

    headerOverlays.forEach(header => {
      header.style.minHeight = headerMinimum ? `${headerMinimum}px` : '';
    });
    footerOverlays.forEach(footer => {
      footer.style.minHeight = footerMinimum ? `${footerMinimum}px` : '';
    });
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
        const zone = resizer.closest(isHeader ? '.pv-header-overlay' : '.pv-footer-overlay');
        const startHeight = Math.max(24, zone?.offsetHeight || parseFloat(window.getComputedStyle(zone).minHeight) || 50);

        let tooltip = document.createElement('div');
        tooltip.className = 'pv-resize-tooltip';
        document.body.appendChild(tooltip);

        let liveRaf = null;
        const onMove = (moveEv) => {
          const deltaY = moveEv.clientY - startY;
          const newHeight = Math.max(24, Math.min(250, Math.round(isHeader ? startHeight + deltaY : startHeight - deltaY)));
          const mmVal = Math.round(newHeight * 0.264583);

          edBody.querySelectorAll(isHeader ? '.pv-header-overlay' : '.pv-footer-overlay').forEach(item => {
            item.style.minHeight = `${newHeight}px`;
          });

          tooltip.style.left = `${moveEv.clientX + 15}px`;
          tooltip.style.top = `${moveEv.clientY - 10}px`;
          tooltip.style.display = 'block';
          tooltip.textContent = `${isHeader ? 'Header Height' : 'Footer Height'}: ${mmVal}mm (${newHeight}px)`;

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
            if (isHeader) { targetNote.headerMinHeight = zone?.style.minHeight || `${startHeight}px`; targetNote._headerResized = true; }
            else { targetNote.footerMinHeight = zone?.style.minHeight || `${startHeight}px`; targetNote._footerResized = true; }
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

  function getEditablePlainText(field) {
    let output = '';
    const blockTags = new Set(['DIV', 'P', 'LI', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6']);

    const appendNewline = () => {
      if (output && !output.endsWith('\n')) output += '\n';
    };
    const visit = node => {
      if (node.nodeType === 3) {
        output += node.nodeValue || '';
        return;
      }
      if (node.nodeType !== 1) return;
      if (node.tagName === 'BR') {
        output += '\n';
        return;
      }
      const isBlock = blockTags.has(node.tagName);
      if (isBlock) appendNewline();
      Array.from(node.childNodes).forEach(visit);
      if (isBlock) appendNewline();
    };

    Array.from(field.childNodes).forEach(visit);
    return output
      .replace(/\u00a0/g, ' ')
      .replace(/\r\n?/g, '\n')
      .replace(/\n{3,}/g, '\n\n')
      .replace(/^\n+|\n+$/g, '');
  }

  function attachHeaderFooterEditableListeners(edBody, targetNote) {
    if (!targetNote) return;

    edBody.querySelectorAll('.pv-header-content, .pv-footer-content').forEach(row => {
      if (row.dataset.editRoutingAttached) return;
      row.dataset.editRoutingAttached = 'true';
      row.addEventListener('pointerdown', (event) => {
        if (event.target.closest('.pv-editable-field')) return;
        const fields = Array.from(row.querySelectorAll('.pv-editable-field'));
        if (!fields.length) return;
        event.preventDefault();
        event.stopPropagation();
        const rect = row.getBoundingClientRect();
        const field = event.clientX >= rect.left + rect.width / 2 ? fields[fields.length - 1] : fields[0];
        field.focus({ preventScroll: true });
        const range = document.createRange();
        range.selectNodeContents(field);
        range.collapse(false);
        const selection = window.getSelection();
        selection.removeAllRanges();
        selection.addRange(range);
      });
    });

    edBody.querySelectorAll('[data-header-field], [data-footer-field]').forEach(field => {
      if (field.dataset.editListenerAttached) return;
      field.dataset.editListenerAttached = 'true';

      field.addEventListener('input', (event) => {
        event.stopPropagation();
        if (!targetNote) return;
        const hField = field.dataset.headerField;
        const fField = field.dataset.footerField;
        const text = getEditablePlainText(field);

        if (hField === 'content') {
          targetNote.customHeaderContent = text;
          targetNote.customHeaderHtml = sanitizeHeaderFooterHtml(field.innerHTML);
          delete targetNote.customHeaderTitle;
          delete targetNote.customSubtitle;
        }
        else if (hField === 'title') targetNote.customHeaderTitle = text;
        else if (hField === 'note-title') {
          if (typeof editField === 'function') editField('title', text);
          else targetNote.title = text;
          const titleInput = document.getElementById('noteTitle');
          if (titleInput) titleInput.value = text;
        }
        else if (hField === 'subtitle') targetNote.customSubtitle = text;
        else if (fField === 'ref') {
          targetNote.customFooterText = text;
          targetNote.customFooterHtml = sanitizeHeaderFooterHtml(field.innerHTML);
        }

        autoExpandHeaderFooterHeights(edBody, targetNote);
        targetNote.updatedAt = Date.now();
        if (typeof save === 'function') save();
      });

      field.addEventListener('keydown', (event) => event.stopPropagation());
      field.addEventListener('keyup', (event) => event.stopPropagation());
      field.addEventListener('blur', () => schedulePagination(targetNote));
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

      const documentStyle = getDocumentStyle(targetNote);
      edBody.dataset.documentStyle = documentStyle;
      const showHeader = targetNote.showHeader !== false;
      const showFooterChrome = targetNote.showFooter !== false || targetNote.showPageNums !== false;

      const { h: pageH } = getPageDimensions(targetNote);

      const noteTitle = (typeof titleOf === 'function' ? titleOf(targetNote) : targetNote.title) || 'Untitled Note';
      const leafTitle = (window.currentActiveLeaf ? window.currentActiveLeaf.title : '') || 'Active Leaf';
      const refId = targetNote.id ? targetNote.id.substring(0, 8) : 'PAPERUSS';

      const children = Array.from(edBody.children).filter(el =>
        !el.classList.contains('pv-page-divider') &&
        !el.classList.contains('pv-page-gap') &&
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
      if (showHeader) {
        const page1Header = document.createElement('div');
        page1Header.innerHTML = createHeaderHtml(noteTitle, leafTitle, targetNote);
        edBody.insertBefore(page1Header.firstElementChild, edBody.firstChild);
      }

      let currentPageNum = 1;
      let currentThreshold = bodyTop + pageH;

      const insertAt = (node, referenceNode) => {
        if (!node) return;
        if (referenceNode) edBody.insertBefore(node, referenceNode);
        else edBody.appendChild(node);
      };

      const insertPageBoundary = (referenceNode, nextPageNum, topFill = 0) => {
        const prevFooter = document.createElement('div');
        if (showFooterChrome) {
          prevFooter.innerHTML = createFooterHtml(nextPageNum - 1, totalEstimatedPages, refId, targetNote);
          insertAt(prevFooter.firstElementChild, referenceNode);
        }

        const pageGap = document.createElement('div');
        pageGap.className = 'pv-page-gap';
        pageGap.contentEditable = 'false';
        pageGap.dataset.paperussPageUi = 'true';
        pageGap.setAttribute('aria-hidden', 'true');
        pageGap.style.height = `${PAGE_GAP_HEIGHT}px`;
        const padLeft = window.getComputedStyle(edBody).paddingLeft || '20mm';
        const padRight = window.getComputedStyle(edBody).paddingRight || '20mm';
        pageGap.style.marginLeft = `-${padLeft}`;
        pageGap.style.marginRight = `-${padRight}`;
        pageGap.style.marginTop = `${Math.max(0, Math.round(topFill))}px`;
        insertAt(pageGap, referenceNode);

        if (showHeader) {
          const nextPageHeader = document.createElement('div');
          nextPageHeader.innerHTML = createHeaderHtml(noteTitle, leafTitle, targetNote);
          insertAt(nextPageHeader.firstElementChild, referenceNode);
        }
        return pageGap;
      };

      for (let i = 0; i < children.length; i++) {
        const child = children[i];
        const childRect = child.getBoundingClientRect();
        const childTop = childRect.top;
        const childBottom = childRect.bottom;
        const nextChild = children[i + 1];
        const isHeading = child.tagName === 'H1' || child.tagName === 'H2' || child.tagName === 'H3';
        const keepHeadingWithNext = isHeading && nextChild && childBottom <= currentThreshold &&
          nextChild.getBoundingClientRect().bottom > currentThreshold;

        if (keepHeadingWithNext) {
          currentPageNum++;
          const pageGap = insertPageBoundary(child, currentPageNum, currentThreshold - childTop);
          currentThreshold = pageGap.getBoundingClientRect().bottom + pageH;
          continue;
        }

        // If block crosses current page threshold
        if (childBottom > currentThreshold && childTop < currentThreshold) {
          currentPageNum++;

          // If block is large (e.g. card, callout, table, image), push it down to next page top
          const isComplexBlock = child.classList.contains('paperuss-card') ||
                                 child.classList.contains('paperuss-embed') ||
                                 child.classList.contains('callout') ||
                                 child.tagName === 'TABLE' ||
                                 child.tagName === 'IMG' ||
                                 child.tagName === 'H1' ||
                                 child.tagName === 'H2';

          let pageGap;
          if (isComplexBlock) {
            // Fill the remainder of the previous sheet before the gray page gap.
            // Keeping this space on the boundary avoids creating a blank area
            // between the next page's header and its first content block.
            pageGap = insertPageBoundary(child, currentPageNum, currentThreshold - childTop);
          } else {
            pageGap = insertPageBoundary(child.nextSibling, currentPageNum);
          }
          currentThreshold = pageGap.getBoundingClientRect().bottom + pageH;
        } else if (childTop >= currentThreshold) {
          currentPageNum++;
          const pageGap = insertPageBoundary(child, currentPageNum);
          currentThreshold = pageGap.getBoundingClientRect().bottom + pageH;
        }
      }

      // Inject Final Page Footer at bottom of document
      if (showFooterChrome) {
        const finalFooter = document.createElement('div');
        finalFooter.innerHTML = createFooterHtml(currentPageNum, Math.max(currentPageNum, totalEstimatedPages), refId, targetNote);
        edBody.appendChild(finalFooter.firstElementChild);
      }

      // Use the completed pagination result rather than the pre-layout height
      // estimate so every footer shows the same accurate page total.
      edBody.querySelectorAll('.pv-footer-right').forEach((pageNumber, index) => {
        pageNumber.textContent = formatPresetPageNum(index + 1, currentPageNum, documentStyle);
      });
      edBody.dataset.pageCount = String(currentPageNum);

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

  function sanitizeHeaderFooterHtml(html) {
    const source = String(html || '');
    if (!source) return '';
    if (typeof sanitizeNoteHTML === 'function') return sanitizeNoteHTML(source);
    const holder = document.createElement('div');
    holder.innerHTML = source;
    const allowed = new Set(['B', 'STRONG', 'I', 'EM', 'U', 'S', 'BR', 'DIV', 'P', 'SPAN']);
    holder.querySelectorAll('script,style,iframe,object,embed').forEach(node => node.remove());
    Array.from(holder.querySelectorAll('*')).reverse().forEach(node => {
      if (!allowed.has(node.tagName)) {
        node.replaceWith(...Array.from(node.childNodes));
        return;
      }
      Array.from(node.attributes).forEach(attr => {
        if (attr.name !== 'style') node.removeAttribute(attr.name);
      });
      if (node.hasAttribute('style') && /url\s*\(|expression\s*\(|javascript:/i.test(node.getAttribute('style'))) {
        node.removeAttribute('style');
      }
    });
    return holder.innerHTML;
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

    edBody.addEventListener('input', (e) => {
      if (e.target.closest('.pv-header-overlay, .pv-footer-overlay')) return;
      schedulePagination(getCurrentNote());
    });
    edBody.addEventListener('load', (e) => {
      if (e.target && e.target.tagName === 'IMG') schedulePagination(getCurrentNote());
    }, true);

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
      if (edBody) delete edBody.dataset.documentStyle;
    }
  };
})();
