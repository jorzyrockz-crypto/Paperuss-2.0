(function(window){
  'use strict';

  const docxStyleMap = [
    "p[style-name='Title'] => h1.editor-title:fresh",
    "p[style-name='Heading 1'] => h1:fresh",
    "p[style-name='Heading 2'] => h2:fresh",
    "p[style-name='Heading 3'] => h3:fresh",
    "p[style-name='Heading 4'] => h4:fresh",
    "p[style-name='Heading 5'] => h5:fresh",
    "p[style-name='Heading 6'] => h6:fresh",
    "p[style-name='Subtitle'] => p.editor-subtitle:fresh",
    "p[style-name='Quote'] => blockquote:fresh",
    "p[style-name='Intense Quote'] => blockquote:fresh",
    "p[style-name='Code'] => pre > code:fresh",
    "r[style-name='Strong'] => strong",
    "r[style-name='Emphasis'] => em",
    "r[style-name='Underline'] => u",
    "r[style-name='Strikethrough'] => del",
    "r[style-name='Superscript'] => sup",
    "r[style-name='Subscript'] => sub",
    "r[style-name='Highlight'] => mark",
    "r[style-name='Highlight Yellow'] => mark",
    "r[style-name='CodeChar'] => code",
    "u => u",
    "strike => del",
    "s => del",
    "del => del",
    "sup => sup",
    "sub => sub",
    "mark => mark",
    "table => table:fresh"
  ];

  async function importDocxFile(file) {
    if (!file) return;

    if (typeof toast === 'function') {
      toast('Importing Word document…');
    }

    if (typeof mammoth === 'undefined') {
      if (typeof toast === 'function') {
        toast('Import failed: Word parser library is offline or unavailable.');
      }
      return;
    }

    const createdMediaIds = [];
    let addedNote = null;
    const prevCurrentId = (typeof state !== 'undefined') ? state.currentId : null;

    async function rollback(reasonErr) {
      console.warn('docx import rollback triggered:', reasonErr);
      // 1. Roll back created media records
      for (const mid of createdMediaIds) {
        try {
          if (typeof mediaDel === 'function') {
            await mediaDel(mid);
          }
        } catch (e) {
          console.warn('docx rollback: failed to delete media', mid, e);
        }
      }

      // 2. Roll back created Note & Leaf if inserted
      if (addedNote) {
        try {
          if (typeof notes !== 'undefined' && Array.isArray(notes)) {
            const idx = notes.findIndex(x => x.id === addedNote.id);
            if (idx !== -1) notes.splice(idx, 1);
          }
          if (typeof state !== 'undefined') {
            state.currentId = prevCurrentId;
          }
          if (window.paperussLeafManager && typeof window.paperussLeafManager.deleteLeaf === 'function' && addedNote.defaultLeafId) {
            await window.paperussLeafManager.deleteLeaf(addedNote.id, addedNote.defaultLeafId);
          }
        } catch (e) {
          console.warn('docx rollback: failed to remove note/leaf', e);
        }
      }

      if (typeof toast === 'function') {
        toast('Import failed: Unsupported or corrupted DOCX file');
      }
    }

    try {
      const arrayBuffer = await file.arrayBuffer();

      const options = {
        styleMap: docxStyleMap,
        convertImage: mammoth.images.imgElement(async function(image) {
          try {
            const imageBuffer = await image.read();
            const contentType = image.contentType || "image/png";
            const ext = contentType.split('/')[1] || "png";
            const altName = (file.name ? file.name.replace(/\.[^/.]+$/, "") : "image") + "-" + Date.now() + "." + ext;
            const blob = new Blob([imageBuffer], { type: contentType });

            const id = await window.saveMediaBlob(blob, altName, 'image');
            if (id) createdMediaIds.push(id);
            const localUrl = await window.getMediaURL(id);
            if (typeof window.urlCache !== 'undefined' && window.urlCache) {
              window.urlCache.set(id, localUrl);
            }

            return {
              src: localUrl,
              "data-media-id": id,
              "data-media-kind": "image",
              alt: altName
            };
          } catch (e) {
            console.warn('docx import: image save error', e);
            throw e;
          }
        })
      };

      const result = await mammoth.convertToHtml({ arrayBuffer: arrayBuffer }, options);
      let html = result.value || '';
      const messages = result.messages || [];

      // Post-process HTML:
      const doc = new DOMParser().parseFromString(`<body>${html}</body>`, 'text/html');
      const body = doc.body;

      // 1) Ensure Document Title becomes h1.editor-title
      let docTitle = '';
      const existingTitleEl = body.querySelector('h1.editor-title, h1');
      if (existingTitleEl) {
        existingTitleEl.classList.add('editor-title');
        docTitle = (existingTitleEl.textContent || '').trim();
      } else {
        docTitle = (file.name || '').replace(/\.docx$/i, '').trim() || 'Imported Document';
        const titleEl = document.createElement('h1');
        titleEl.className = 'editor-title';
        titleEl.textContent = docTitle;
        body.insertBefore(titleEl, body.firstChild);
      }

      // 2) Map any standard h1 (not .editor-title) to h2 if there are multiple h1s
      const allH1s = body.querySelectorAll('h1');
      allH1s.forEach((h1, i) => {
        if (i > 0 && !h1.classList.contains('editor-title')) {
          const h2 = document.createElement('h2');
          h2.innerHTML = h1.innerHTML;
          h1.replaceWith(h2);
        } else {
          h1.classList.add('editor-title');
        }
      });

      // 3) Recognize Checklists in list items or paragraphs
      const checkRegex = /^(\[[ xX]\]|☐|☑|✓|v\s+)\s*(.*)/;
      body.querySelectorAll('li, p').forEach(el => {
        const text = el.textContent || '';
        const match = text.trim().match(checkRegex);
        if (match) {
          const isChecked = /^(\[[xX]\]|☑|✓)/.test(match[1]);
          const remainderText = match[2];

          if (el.tagName === 'LI') {
            el.setAttribute('data-task', '1');
            el.innerHTML = `<input type="checkbox"${isChecked ? ' checked=""' : ''}> ${remainderText}`;
            if (el.parentElement && (el.parentElement.tagName === 'UL' || el.parentElement.tagName === 'OL')) {
              el.parentElement.classList.add('task-list');
            }
          } else if (el.tagName === 'P') {
            const ul = document.createElement('ul');
            ul.className = 'task-list';
            const li = document.createElement('li');
            li.setAttribute('data-task', '1');
            li.innerHTML = `<input type="checkbox"${isChecked ? ' checked=""' : ''}> ${remainderText}`;
            ul.appendChild(li);
            el.replaceWith(ul);
          }
        }
      });

      // 4) Check links for safety
      body.querySelectorAll('a').forEach(a => {
        const href = a.getAttribute('href') || '';
        const checkSafe = typeof window.paperussSafeUrl === 'function' ? window.paperussSafeUrl : (typeof isSafeUrl === 'function' ? isSafeUrl : null);
        if (checkSafe && !checkSafe(href, 'href', 'A')) {
          a.removeAttribute('href');
        } else if (/^(javascript|vbscript|data|file):/i.test(href)) {
          a.removeAttribute('href');
        } else if (href) {
          a.setAttribute('target', '_blank');
          a.setAttribute('rel', 'noopener noreferrer');
        }
      });

      // 5) Convert any remaining data:image URLs if present
      const dataImgs = Array.from(body.querySelectorAll('img[src^="data:image/"]'));
      for (const img of dataImgs) {
        try {
          const src = img.getAttribute('src');
          if (typeof dataURLToBlob === 'function') {
            const blob = dataURLToBlob(src);
            const altName = img.getAttribute('alt') || 'imported-img.png';
            const id = await window.saveMediaBlob(blob, altName, 'image');
            if (id) createdMediaIds.push(id);
            const localUrl = await window.getMediaURL(id);
            if (typeof window.urlCache !== 'undefined' && window.urlCache) {
              window.urlCache.set(id, localUrl);
            }
            img.setAttribute('data-media-id', id);
            img.setAttribute('data-media-kind', 'image');
            img.setAttribute('src', localUrl);
          }
        } catch (e) {
          throw e;
        }
      }

      // Check storage quota prior to processing large import
      if (navigator.storage && typeof navigator.storage.estimate === 'function') {
        try {
          const est = await navigator.storage.estimate();
          if (est.quota && est.usage && (est.usage / est.quota) > 0.9) {
            if (typeof toast === 'function') toast('Storage Warning: Device storage is 90%+ full.');
          }
        } catch (_) {}
      }

      // Wrap tables in responsive scroll containers
      body.querySelectorAll('table').forEach(table => {
        if (!table.parentElement || !table.parentElement.classList.contains('table-responsive')) {
          const wrap = document.createElement('div');
          wrap.className = 'table-responsive';
          table.parentNode.insertBefore(wrap, table);
          wrap.appendChild(table);
        }
      });

      // Detect multi-leaf sections if doc has page breaks or section headings
      const rawLeafSections = [];
      let currentSection = { title: docTitle || 'Main', nodes: [] };
      const children = Array.from(body.childNodes);

      for (const child of children) {
        const isHeadingDivider = (child.tagName === 'H1' && !child.classList.contains('editor-title')) ||
                                 (child.tagName === 'H2' && rawLeafSections.length > 0);
        const isPageBreak = (child.tagName === 'HR' && child.style && (child.style.pageBreakBefore === 'always' || child.style.pageBreakAfter === 'always')) ||
                            (child.querySelector && (child.querySelector('br[type="page"]') || child.querySelector('hr[style*="page-break"]')));

        if ((isHeadingDivider || isPageBreak) && currentSection.nodes.length > 0) {
          rawLeafSections.push(currentSection);
          let newTitle = `Leaf ${rawLeafSections.length + 1}`;
          if (child.tagName === 'H1' || child.tagName === 'H2') {
            newTitle = (child.textContent || '').trim() || newTitle;
          }
          currentSection = { title: newTitle, nodes: [] };
          if (child.tagName !== 'H1' && child.tagName !== 'H2') continue;
        }
        currentSection.nodes.push(child);
      }
      if (currentSection.nodes.length > 0) {
        rawLeafSections.push(currentSection);
      }

      // Filter leafSections: enforce 150+ char minimum threshold to prevent over-fragmentation
      const leafSections = [];
      for (let i = 0; i < rawLeafSections.length; i++) {
        const sec = rawLeafSections[i];
        const textLen = sec.nodes.map(n => n.textContent || '').join(' ').trim().length;
        const hasMedia = sec.nodes.some(n => n.querySelector && (n.querySelector('img') || n.querySelector('table') || n.querySelector('iframe')));
        if (i === 0 || textLen >= 150 || hasMedia) {
          leafSections.push(sec);
        } else if (leafSections.length > 0) {
          sec.nodes.forEach(node => leafSections[leafSections.length - 1].nodes.push(node));
        }
      }

      // If multi-leaf sections were found (2+): use section 1 for Main leaf content
      if (leafSections.length > 1) {
        const sec1Div = document.createElement('div');
        leafSections[0].nodes.forEach(n => sec1Div.appendChild(n));
        let sec1Html = sec1Div.innerHTML;
        if (typeof cleanInternalEditorUI === 'function') sec1Html = cleanInternalEditorUI(sec1Html);
        if (typeof sanitizeNoteHTML === 'function') sec1Html = sanitizeNoteHTML(sec1Html);
        body.innerHTML = sec1Html;
      }

      // Sanitize HTML for primary note content
      let cleanHtml = body.innerHTML;
      if (typeof cleanInternalEditorUI === 'function') {
        cleanHtml = cleanInternalEditorUI(cleanHtml);
      }
      if (typeof sanitizeNoteHTML === 'function') {
        cleanHtml = sanitizeNoteHTML(cleanHtml);
      }

      // Create new Note
      const noteId = typeof uid === 'function' ? uid() : ('n_' + Date.now());
      const now = Date.now();
      const n = {
        id: noteId,
        title: docTitle || 'Imported Document',
        content: cleanHtml,
        tags: [],
        pinned: false,
        archived: false,
        createdAt: now,
        updatedAt: now,
        fontStyle: (typeof appSettings !== 'undefined' && appSettings.defaultFont) ? appSettings.defaultFont : 'sans'
      };

      if (typeof notes !== 'undefined' && Array.isArray(notes)) {
        notes.unshift(n);
      }
      if (typeof state !== 'undefined') {
        state.currentId = n.id;
      }
      addedNote = n;

      // Automatically create Main Leaf
      if (window.paperussLeafManager && typeof window.paperussLeafManager.materializeVirtualNote === 'function') {
        const materialized = await window.paperussLeafManager.materializeVirtualNote(n);
        if (!materialized) {
          throw new Error('Failed to materialize Main Leaf');
        }

        // Add additional leaves if multi-leaf sections were detected
        if (leafSections.length > 1) {
          for (let s = 1; s < leafSections.length; s++) {
            const sec = leafSections[s];
            const secDiv = document.createElement('div');
            sec.nodes.forEach(node => secDiv.appendChild(node));
            let secHtml = secDiv.innerHTML;
            if (typeof cleanInternalEditorUI === 'function') secHtml = cleanInternalEditorUI(secHtml);
            if (typeof sanitizeNoteHTML === 'function') secHtml = sanitizeNoteHTML(secHtml);

            const newLeafId = await window.paperussLeafManager.addLeaf(n.id, sec.title || `Leaf ${s + 1}`);
            if (newLeafId && window.paperussLeaves) {
              const leafObj = await window.paperussLeaves.leafGet(newLeafId);
              if (leafObj) {
                leafObj.content = secHtml;
                leafObj.updatedAt = Date.now();
                await window.paperussLeaves.leafPut(leafObj);
              }
            }
          }
        }
      } else {
        if (typeof persist === 'function') persist();
        else if (typeof save === 'function') save();
      }

      if (typeof renderAll === 'function') renderAll();
      else if (typeof renderList === 'function') renderList();
      if (typeof showMobileEditor === 'function') showMobileEditor();
      if (typeof hydrateMediaInEditor === 'function') hydrateMediaInEditor();
      if (typeof triggerLeaflineUpdate === 'function') triggerLeaflineUpdate();
      if (typeof updateLeafTitleBar === 'function') updateLeafTitleBar();

      // Show completion message
      if (typeof toast === 'function') {
        const skippedUnsupported = messages.some(m => m.type === 'warning' && /unrecognised|unsupported|ignored/i.test(m.message));
        if (skippedUnsupported) {
          toast('Imported Note; skipped unsupported Word content');
        } else {
          toast('Imported Word document successfully');
        }
      }

    } catch (err) {
      await rollback(err);
    }
  }

  window.importDocxFile = importDocxFile;
  window.docxStyleMap = docxStyleMap;

})(window);
