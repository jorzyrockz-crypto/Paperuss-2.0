/**
 * PapeRuss DOCX Export Module (v2.1.7)
 * In-browser offline export of active Leaf or all Leaves in a Note to standard Word (.docx) format.
 * Relies on vendored JSZip library (assets/vendor/jszip.min.js).
 */

(function(global) {
  'use strict';

  // Helper to escape XML characters
  function escXml(str) {
    if (!str && str !== 0) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&apos;');
  }

  // Generate unique relation ID
  function nextRId(counterRef) {
    counterRef.count = (counterRef.count || 0) + 1;
    return 'rId' + counterRef.count;
  }

  /**
   * Sanitize HTML content prior to WordprocessingML conversion.
   */
  function sanitizeForExportHTML(html) {
    if (!html) return '';
    let cleaned = String(html);

    // Remove script/style/iframe/object tags
    cleaned = cleaned.replace(/<(script|style|iframe|object|embed|link)[^>]*>[\s\S]*?<\/\1>/gi, '');
    cleaned = cleaned.replace(/<(script|style|iframe|object|embed|link)[^>]*\/?>/gi, '');

    // Remove internal UI elements
    cleaned = cleaned.replace(/<div[^>]*class="[^"]*(?:resize-handle|leafline-ui|table-controls|checklist-controls)[^"]*"[^>]*>[\s\S]*?<\/div>/gi, '');
    cleaned = cleaned.replace(/<button[^>]*class="[^"]*(?:mc-action|table-btn)[^"]*"[^>]*>[\s\S]*?<\/button>/gi, '');

    // Strip javascript: / vbscript: links
    cleaned = cleaned.replace(/href=["']\s*(?:javascript|vbscript|file):[^"']*["']/gi, 'href="#"');

    return cleaned;
  }

  /**
   * Parse simple HTML string into a lightweight AST node for conversion.
   */
  function parseAST(html) {
    if (typeof DOMParser !== 'undefined') {
      try {
        const doc = new DOMParser().parseFromString('<body>' + html + '</body>', 'text/html');
        return doc.body;
      } catch (e) {}
    }
    // Minimal fallback AST if DOMParser unavailable (e.g. basic environments)
    return { tagName: 'BODY', childNodes: [], textContent: html };
  }

  /**
   * Convert an AST element (and its children) into WordprocessingML XML strings.
   */
  async function convertElementToWml(el, ctx) {
    if (!el) return '';
    const tag = (el.tagName || '').toUpperCase();

    // Text node
    if (el.nodeType === 3 || !tag) {
      const txt = (el.textContent || '').replace(/\r\n|\r|\n/g, ' ').replace(/\s+/g, ' ');
      if (!txt.trim()) return '';
      let rPr = '';
      if (ctx.bold) rPr += '<w:b/>';
      if (ctx.italic) rPr += '<w:i/>';
      if (ctx.underline) rPr += '<w:u w:val="single"/>';
      return `<w:r>${rPr ? `<w:rPr>${rPr}</w:rPr>` : ''}<w:t xml:space="preserve">${escXml(txt)}</w:t></w:r>`;
    }

    // Skip ignored tags
    if (['SCRIPT', 'STYLE', 'BUTTON', 'INPUT', 'IFRAME'].includes(tag)) return '';

    // Headings
    if (/^H[1-6]$/.test(tag)) {
      const cls = el.getAttribute ? el.getAttribute('class') || '' : '';
      let styleId = 'Heading1';
      let outlineLvl = 0;

      if (tag === 'H1') {
        if (cls.includes('editor-title') && !ctx.allLeavesMode) {
          styleId = 'Title';
          outlineLvl = null;
        } else if (ctx.allLeavesMode) {
          // In allLeaves mode, Leaf Title is Heading1 (lvl 0), H1 inside content demoted to Heading2
          styleId = 'Heading2';
          outlineLvl = 1;
        } else {
          styleId = 'Heading1';
          outlineLvl = 0;
        }
      } else if (tag === 'H2') {
        styleId = ctx.allLeavesMode ? 'Heading3' : 'Heading2';
        outlineLvl = ctx.allLeavesMode ? 2 : 1;
      } else if (tag === 'H3') {
        styleId = ctx.allLeavesMode ? 'Heading4' : 'Heading3';
        outlineLvl = ctx.allLeavesMode ? 3 : 2;
      } else {
        styleId = 'Heading4';
        outlineLvl = 3;
      }

      const runsXml = await convertChildrenToWml(el, ctx);
      const pPr = `<w:pPr><w:pStyle w:val="${styleId}"/>${outlineLvl !== null ? `<w:outlineLvl w:val="${outlineLvl}"/>` : ''}</w:pPr>`;
      return `<w:p>${pPr}${runsXml}</w:p>`;
    }

    // Paragraph or Div
    if (tag === 'P' || tag === 'DIV') {
      const runsXml = await convertChildrenToWml(el, ctx);
      if (!runsXml.trim()) return '';
      return `<w:p><w:pPr><w:pStyle w:val="Normal"/></w:pPr>${runsXml}</w:p>`;
    }

    // Unordered / Ordered List
    if (tag === 'UL' || tag === 'OL') {
      const listType = tag === 'UL' ? 'bullet' : 'number';
      const level = ctx.listLevel || 0;
      let outXml = '';
      const children = el.children || el.childNodes || [];
      for (let i = 0; i < children.length; i++) {
        const child = children[i];
        if ((child.tagName || '').toUpperCase() === 'LI') {
          outXml += await convertListItemToWml(child, ctx, listType, level);
        }
      }
      return outXml;
    }

    // Table
    if (tag === 'TABLE') {
      return await convertTableToWml(el, ctx);
    }

    // Image
    if (tag === 'IMG') {
      return await convertImageToWml(el, ctx);
    }

    // Hyperlink
    if (tag === 'A') {
      const href = el.getAttribute ? el.getAttribute('href') : '';
      const runsXml = await convertChildrenToWml(el, { ...ctx, underline: true, hyperlinkColor: '0563C1' });
      if (!href || href.startsWith('javascript:') || href.startsWith('vbscript:') || href.startsWith('file:')) {
        return runsXml;
      }
      const rId = nextRId(ctx.relsCounter);
      ctx.hyperlinks.push({ id: rId, target: href });
      return `<w:hyperlink r:id="${rId}">${runsXml}</w:hyperlink>`;
    }

    // Line break
    if (tag === 'BR') {
      return '<w:r><w:br/></w:r>';
    }

    // Inline formatting tags
    const nextCtx = {
      ...ctx,
      bold: ctx.bold || tag === 'B' || tag === 'STRONG',
      italic: ctx.italic || tag === 'I' || tag === 'EM',
      underline: ctx.underline || tag === 'U'
    };
    return await convertChildrenToWml(el, nextCtx);
  }

  async function convertChildrenToWml(el, ctx) {
    let runsXml = '';
    const children = el.childNodes || el.children || [];
    for (let i = 0; i < children.length; i++) {
      runsXml += await convertElementToWml(children[i], ctx);
    }
    return runsXml;
  }

  async function convertListItemToWml(li, ctx, listType, level) {
    const isTask = (li.getAttribute && li.getAttribute('data-task') !== null) ||
                   (li.querySelector && li.querySelector('input[type="checkbox"]'));
    let isChecked = false;
    if (isTask) {
      const taskVal = li.getAttribute ? li.getAttribute('data-task') : null;
      if (taskVal === '1' || taskVal === 'true') {
        isChecked = true;
      } else if (li.querySelector) {
        const cb = li.querySelector('input[type="checkbox"]');
        if (cb && (cb.checked || cb.getAttribute('checked') !== null)) isChecked = true;
      }
    }

    const runsXml = await convertChildrenToWml(li, ctx);
    const numId = listType === 'bullet' ? 1 : 2;
    const pPr = `<w:pPr><w:pStyle w:val="ListParagraph"/><w:numPr><w:ilvl w:val="${level}"/><w:numId w:val="${numId}"/></w:numPr></w:pPr>`;

    let prefixRun = '';
    if (isTask) {
      const symbol = isChecked ? '☑ ' : '☐ ';
      prefixRun = `<w:r><w:rPr><w:b/></w:rPr><w:t xml:space="preserve">${symbol}</w:t></w:r>`;
    }
    return `<w:p>${pPr}${prefixRun}${runsXml}</w:p>`;
  }

  async function convertTableToWml(table, ctx) {
    let rowsXml = '';
    function getRows(el) {
      let res = [];
      const kids = el.children || el.childNodes || [];
      for (let i = 0; i < kids.length; i++) {
        const k = kids[i];
        if ((k.tagName || '').toUpperCase() === 'TR') res.push(k);
        else if (k.childNodes || k.children) res = res.concat(getRows(k));
      }
      return res;
    }
    const rows = getRows(table);
    for (let r = 0; r < rows.length; r++) {
      const tr = rows[r];
      let cellsXml = '';
      const cells = tr.children || tr.childNodes || [];
      for (let c = 0; c < cells.length; c++) {
        const cell = cells[c];
        const cellTag = (cell.tagName || '').toUpperCase();
        if (cellTag === 'TD' || cellTag === 'TH') {
          const contentXml = await convertChildrenToWml(cell, ctx);
          const pXml = contentXml.includes('<w:p>') ? contentXml : `<w:p><w:pPr><w:pStyle w:val="Normal"/></w:pPr>${contentXml}</w:p>`;
          cellsXml += `<w:tc><w:tcPr><w:tcW w:w="2500" w:type="dxa"/></w:tcPr>${pXml}</w:tc>`;
        }
      }
      rowsXml += `<w:tr>${cellsXml}</w:tr>`;
    }

    const tblPr = `<w:tblPr><w:tblStyle w:val="TableGrid"/><w:tblW w:w="0" w:type="auto"/><w:tblBorders><w:top w:val="single" w:sz="4" w:space="0" w:color="CCCCCC"/><w:bottom w:val="single" w:sz="4" w:space="0" w:color="CCCCCC"/><w:left w:val="single" w:sz="4" w:space="0" w:color="CCCCCC"/><w:right w:val="single" w:sz="4" w:space="0" w:color="CCCCCC"/><w:insideH w:val="single" w:sz="4" w:space="0" w:color="EEEEEE"/><w:insideV w:val="single" w:sz="4" w:space="0" w:color="EEEEEE"/></w:tblBorders></w:tblPr>`;
    return `<w:tbl>${tblPr}${rowsXml}</w:tbl>`;
  }

  async function convertImageToWml(img, ctx) {
    let mediaId = img.getAttribute ? img.getAttribute('data-media-id') : null;
    let src = img.getAttribute ? img.getAttribute('src') : '';

    let blob = null;
    let ext = 'png';

    try {
      if (mediaId && typeof window.mediaGet === 'function') {
        const rec = await window.mediaGet(mediaId);
        if (rec && rec.blob) {
          blob = rec.blob;
          if (rec.name && /\.(png|jpe?g|gif|webp)$/i.test(rec.name)) {
            const m = rec.name.match(/\.(png|jpe?g|gif|webp)$/i);
            if (m) ext = m[1].toLowerCase();
          }
        }
      }
      if (!blob && src && src.startsWith('data:image/')) {
        const parts = src.split(',');
        const mimeMatch = parts[0].match(/data:image\/([a-zA-Z0-9]+);base64/i);
        if (mimeMatch) ext = mimeMatch[1].toLowerCase();
        const byteStr = typeof atob === 'function' ? atob(parts[1]) : Buffer.from(parts[1], 'base64').toString('binary');
        const uint8 = new Uint8Array(byteStr.length);
        for (let i = 0; i < byteStr.length; i++) {
          uint8[i] = byteStr.charCodeAt(i);
        }
        blob = new Blob([uint8], { type: 'image/' + ext });
      }
      if (!blob && src && src.startsWith('blob:') && typeof fetch === 'function') {
        const res = await fetch(src);
        blob = await res.blob();
      }
    } catch (e) {
      console.warn('docx-export: failed to extract image blob:', e);
    }

    if (!blob) {
      // Missing image fallback requirement
      return `<w:p><w:pPr><w:pStyle w:val="Normal"/></w:pPr><w:r><w:rPr><w:i/><w:color w:val="888888"/></w:rPr><w:t xml:space="preserve">[Image: missing or unavailable]</w:t></w:r></w:p>`;
    }

    let imgData = blob;
    if (typeof blob.arrayBuffer === 'function') {
      try { imgData = await blob.arrayBuffer(); } catch (e) {}
    }

    const imageIndex = (ctx.images.length || 0) + 1;
    const filename = `image${imageIndex}.${ext}`;
    const rId = nextRId(ctx.relsCounter);
    ctx.images.push({ id: rId, filename, data: imgData });

    const docPrId = imageIndex;
    const cx = 5486400; // ~6 inches width in EMUs
    const cy = 3657600; // ~4 inches height in EMUs

    return `<w:p><w:r><w:drawing><wp:inline xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing"><wp:docPr id="${docPrId}" name="Image ${docPrId}" descr="PapeRuss Image"/><a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:blipFill><a:blip r:embed="${rId}" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"/></pic:blipFill><pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p>`;
  }

  /**
   * Build complete word/document.xml string from paragraphs XML.
   */
  function buildDocumentXml(bodyXml) {
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n` +
      `<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" ` +
      `xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" ` +
      `xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" ` +
      `xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" ` +
      `xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture">` +
      `<w:body>${bodyXml}<w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440"/></w:sectPr></w:body></w:document>`;
  }

  /**
   * Build word/_rels/document.xml.rels string.
   */
  function buildDocumentRelsXml(hyperlinks, images) {
    let rels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n` +
      `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
      `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>` +
      `<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/numbering" Target="numbering.xml"/>`;

    for (let i = 0; i < hyperlinks.length; i++) {
      const hl = hyperlinks[i];
      rels += `<Relationship Id="${hl.id}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink" Target="${escXml(hl.target)}" TargetMode="External"/>`;
    }
    for (let i = 0; i < images.length; i++) {
      const im = images[i];
      rels += `<Relationship Id="${im.id}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/${im.filename}"/>`;
    }
    rels += `</Relationships>`;
    return rels;
  }

  /**
   * Build standard [Content_Types].xml string.
   */
  function buildContentTypesXml(images) {
    let xml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n` +
      `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
      `<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
      `<Default Extension="xml" ContentType="application/xml"/>` +
      `<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>` +
      `<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>` +
      `<Override PartName="/word/numbering.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml"/>`;

    const exts = new Set(['png', 'jpeg', 'jpg', 'gif']);
    for (let i = 0; i < images.length; i++) {
      const extMatch = images[i].filename.match(/\.([a-z0-9]+)$/i);
      if (extMatch) exts.add(extMatch[1].toLowerCase());
    }
    exts.forEach(e => {
      const ct = e === 'jpg' || e === 'jpeg' ? 'image/jpeg' : (e === 'gif' ? 'image/gif' : 'image/png');
      xml += `<Default Extension="${e}" ContentType="${ct}"/>`;
    });
    xml += `</Types>`;
    return xml;
  }

  /**
   * Build standard word/styles.xml string with Word outline levels.
   */
  function buildStylesXml() {
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n` +
      `<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">` +
      `<w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri"/><w:sz w:val="22"/></w:rPr></w:rPrDefault></w:docDefaults>` +
      `<w:style w:type="paragraph" w:styleId="Normal" w:default="1"><w:name w:val="Normal"/></w:style>` +
      `<w:style w:type="paragraph" w:styleId="Title"><w:name w:val="Title"/><w:rPr><w:b/><w:sz w:val="56"/><w:color w:val="2B2B2B"/></w:rPr></w:style>` +
      `<w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:pPr><w:outlineLvl w:val="0"/></w:pPr><w:rPr><w:b/><w:sz w:val="36"/><w:color w:val="1F497D"/></w:rPr></w:style>` +
      `<w:style w:type="paragraph" w:styleId="Heading2"><w:name w:val="heading 2"/><w:pPr><w:outlineLvl w:val="1"/></w:pPr><w:rPr><w:b/><w:sz w:val="28"/><w:color w:val="2E75B6"/></w:rPr></w:style>` +
      `<w:style w:type="paragraph" w:styleId="Heading3"><w:name w:val="heading 3"/><w:pPr><w:outlineLvl w:val="2"/></w:pPr><w:rPr><w:b/><w:sz w:val="24"/><w:color w:val="41719C"/></w:rPr></w:style>` +
      `<w:style w:type="paragraph" w:styleId="Heading4"><w:name w:val="heading 4"/><w:pPr><w:outlineLvl w:val="3"/></w:pPr><w:rPr><w:b/><w:i/><w:sz w:val="22"/><w:color w:val="595959"/></w:rPr></w:style>` +
      `<w:style w:type="paragraph" w:styleId="ListParagraph"><w:name w:val="List Paragraph"/><w:pPr><w:ind w:left="720"/></w:pPr></w:style>` +
      `<w:style w:type="table" w:styleId="TableGrid"><w:name w:val="Table Grid"/></w:style>` +
      `</w:styles>`;
  }

  /**
   * Build standard word/numbering.xml for lists.
   */
  function buildNumberingXml() {
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n` +
      `<w:numbering xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">` +
      `<w:abstractNum w:abstractNumId="1"><w:lvl w:ilvl="0"><w:numFmt w:val="bullet"/><w:lvlText w:val="•"/><w:lvlJc w:val="left"/><w:pPr><w:ind w:left="720" w:hanging="360"/></w:pPr></w:lvl></w:abstractNum>` +
      `<w:abstractNum w:abstractNumId="2"><w:lvl w:ilvl="0"><w:numFmt w:val="decimal"/><w:lvlText w:val="%1."/><w:lvlJc w:val="left"/><w:pPr><w:ind w:left="720" w:hanging="360"/></w:pPr></w:lvl></w:abstractNum>` +
      `<w:num w:numId="1"><w:abstractNumId w:val="1"/></w:num>` +
      `<w:num w:numId="2"><w:abstractNumId w:val="2"/></w:num>` +
      `</w:numbering>`;
  }

  /**
   * Generate Word .docx ZIP archive as a Blob.
   * @param {Object} options - { note, mode: 'active' | 'all' }
   * @returns {Promise<Blob>}
   */
  async function generateDocxBlob(options) {
    const note = options.note;
    const mode = options.mode || 'active';
    const JSZipLib = global.JSZip || window.JSZip;
    if (!JSZipLib) {
      throw new Error('JSZip library is offline or unavailable');
    }

    const zip = new JSZipLib();
    const relsCounter = { count: 2 }; // rId1=styles, rId2=numbering
    const hyperlinks = [];
    const images = [];

    let bodyXml = '';

    if (mode === 'all') {
      // All-Leaves export: Note title as document title
      const noteTitle = note.title || 'Untitled Note';
      bodyXml += `<w:p><w:pPr><w:pStyle w:val="Title"/></w:pPr><w:r><w:t xml:space="preserve">${escXml(noteTitle)}</w:t></w:r></w:p>`;

      const leafOrder = typeof global.getNoteLeafOrder === 'function'
        ? global.getNoteLeafOrder(note)
        : (note.leafOrder || ['virtual_main_' + note.id]);

      for (let i = 0; i < leafOrder.length; i++) {
        const leafId = leafOrder[i];
        let leaf = null;
        if (typeof global.paperussLeaves !== 'undefined' && global.paperussLeaves.leafGet) {
          leaf = await global.paperussLeaves.leafGet(leafId);
        }
        if (!leaf && (leafId === 'virtual_main_' + note.id || i === 0)) {
          leaf = { id: leafId, title: 'Main', content: note.content };
        }
        if (!leaf) continue;

        // Each Leaf begins on a new page (except if first leaf right after title)
        if (i > 0) {
          bodyXml += `<w:p><w:r><w:br w:type="page"/></w:r></w:p>`;
        }

        const leafTitle = leaf.title || `Leaf ${i + 1}`;
        bodyXml += `<w:p><w:pPr><w:pStyle w:val="Heading1"/><w:outlineLvl w:val="0"/></w:pPr><w:r><w:t xml:space="preserve">${escXml(leafTitle)}</w:t></w:r></w:p>`;

        const cleanHtml = sanitizeForExportHTML(leaf.content || '');
        const ast = parseAST(cleanHtml);
        const ctx = {
          allLeavesMode: true,
          relsCounter,
          hyperlinks,
          images
        };
        const contentWml = await convertChildrenToWml(ast, ctx);
        bodyXml += contentWml;
      }
    } else {
      // Active-Leaf export
      let activeLeaf = null;
      if (typeof global.paperussLeaves !== 'undefined' && global.paperussLeaves.getNoteActiveLeafId) {
        const activeId = global.paperussLeaves.getNoteActiveLeafId(note);
        if (activeId && global.paperussLeaves.leafGet) {
          activeLeaf = await global.paperussLeaves.leafGet(activeId);
        }
      }
      if (!activeLeaf) {
        activeLeaf = { id: 'main', title: note.title || 'Main', content: note.content };
      }

      const topTitle = note.title || activeLeaf.title || 'Untitled Note';
      bodyXml += `<w:p><w:pPr><w:pStyle w:val="Title"/></w:pPr><w:r><w:t xml:space="preserve">${escXml(topTitle)}</w:t></w:r></w:p>`;

      const cleanHtml = sanitizeForExportHTML(activeLeaf.content || note.content || '');
      const ast = parseAST(cleanHtml);
      const ctx = {
        allLeavesMode: false,
        relsCounter,
        hyperlinks,
        images
      };
      bodyXml += await convertChildrenToWml(ast, ctx);
    }

    // Assemble package files
    zip.file('[Content_Types].xml', buildContentTypesXml(images));
    zip.file('_rels/.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n` +
      `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
      `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>` +
      `</Relationships>`);
    zip.file('word/document.xml', buildDocumentXml(bodyXml));
    zip.file('word/styles.xml', buildStylesXml());
    zip.file('word/numbering.xml', buildNumberingXml());
    zip.file('word/_rels/document.xml.rels', buildDocumentRelsXml(hyperlinks, images));

    for (let i = 0; i < images.length; i++) {
      const im = images[i];
      zip.file('word/media/' + im.filename, im.data);
    }

    return await zip.generateAsync({
      type: 'blob',
      mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      compression: 'DEFLATE'
    });
  }

  /**
   * Helper to trigger download of a Blob in the browser.
   */
  function triggerBlobDownload(blob, filename) {
    if (typeof document === 'undefined') return;
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename || 'paperuss-export.docx';
    document.body.appendChild(a);
    a.click();
    setTimeout(() => {
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    }, 1000);
  }

  /**
   * Main export handler for Active Leaf DOCX.
   */
  async function exportDocxActiveLeaf(targetNote) {
    try {
      const note = targetNote || (typeof global.getActiveNote === 'function' ? global.getActiveNote() : null);
      if (!note) {
        if (typeof global.toast === 'function') global.toast('No active note to export');
        return null;
      }
      if (typeof global.toast === 'function') global.toast('Generating Word document (.docx)...');

      const blob = await generateDocxBlob({ note, mode: 'active' });
      const filename = `${(note.title || 'Note').replace(/[^\w\s-]/g, '').trim() || 'Note'}.docx`;
      triggerBlobDownload(blob, filename);
      if (typeof global.toast === 'function') global.toast('Exported Active Leaf to Word');
      return blob;
    } catch (err) {
      console.error('exportDocxActiveLeaf error:', err);
      if (typeof global.toast === 'function') global.toast('Word export failed: ' + err.message);
      return null;
    }
  }

  /**
   * Main export handler for All Leaves DOCX.
   */
  async function exportDocxAllLeaves(targetNote) {
    try {
      const note = targetNote || (typeof global.getActiveNote === 'function' ? global.getActiveNote() : null);
      if (!note) {
        if (typeof global.toast === 'function') global.toast('No active note to export');
        return null;
      }
      if (typeof global.toast === 'function') global.toast('Generating Word document (.docx) for all leaves...');

      const blob = await generateDocxBlob({ note, mode: 'all' });
      const filename = `${(note.title || 'Note').replace(/[^\w\s-]/g, '').trim() || 'Note'}-all-leaves.docx`;
      triggerBlobDownload(blob, filename);
      if (typeof global.toast === 'function') global.toast('Exported All Leaves to Word');
      return blob;
    } catch (err) {
      console.error('exportDocxAllLeaves error:', err);
      if (typeof global.toast === 'function') global.toast('Word export failed: ' + err.message);
      return null;
    }
  }

  // Export on global window
  global.generateDocxBlob = generateDocxBlob;
  global.exportDocxActiveLeaf = exportDocxActiveLeaf;
  global.exportDocxAllLeaves = exportDocxAllLeaves;

})(typeof window !== 'undefined' ? window : global);
