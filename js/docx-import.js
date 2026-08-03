(function(window){
  'use strict';

  const docxStyleMap = [
    "p[style-name='Title'] => h1.editor-title:fresh",
    "p[style-name='Heading 1'] => h2:fresh",
    "p[style-name='Heading 2'] => h3:fresh",
    "p[style-name='Heading 3'] => h4:fresh",
    "p[style-name='Heading 4'] => h4:fresh",
    "p[style-name='Heading 5'] => h4:fresh",
    "p[style-name='Heading 6'] => h4:fresh",
    "p[style-name='Subtitle'] => p.editor-subtitle:fresh",
    "r[style-name='Strong'] => strong",
    "r[style-name='Emphasis'] => em",
    "r[style-name='Underline'] => u",
    "u => u",
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
            return {
              src: "",
              alt: "Failed to import image"
            };
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
            const localUrl = await window.getMediaURL(id);
            if (typeof window.urlCache !== 'undefined' && window.urlCache) {
              window.urlCache.set(id, localUrl);
            }
            img.setAttribute('data-media-id', id);
            img.setAttribute('data-media-kind', 'image');
            img.setAttribute('src', localUrl);
          }
        } catch (e) {}
      }

      // Sanitize HTML
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

      // Automatically create Main Leaf
      if (window.paperussLeafManager && typeof window.paperussLeafManager.materializeVirtualNote === 'function') {
        await window.paperussLeafManager.materializeVirtualNote(n);
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
      console.error('docx import error:', err);
      if (typeof toast === 'function') {
        toast('Import failed: Unsupported or corrupted DOCX file');
      }
    }
  }

  window.importDocxFile = importDocxFile;
  window.docxStyleMap = docxStyleMap;

})(window);
