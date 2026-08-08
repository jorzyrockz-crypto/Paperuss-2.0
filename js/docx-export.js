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
      if (ctx.strikethrough) rPr += '<w:strike/>';
      if (ctx.highlight) rPr += '<w:highlight w:val="yellow"/>';
      if (ctx.superscript) rPr += '<w:vertAlign w:val="superscript"/>';
      if (ctx.subscript) rPr += '<w:vertAlign w:val="subscript"/>';
      if (ctx.textColor) {
        let hexColor = ctx.textColor.replace(/^#/, '');
        if (hexColor.length === 3) hexColor = hexColor.split('').map(c => c + c).join('');
        if (/^[0-9A-Fa-f]{6}$/.test(hexColor)) {
          rPr += `<w:color w:val="${hexColor.toUpperCase()}"/>`;
        }
      }
      if (ctx.fontFamily) {
        rPr += `<w:rFonts w:ascii="${escXml(ctx.fontFamily)}" w:hAnsi="${escXml(ctx.fontFamily)}"/>`;
      } else if (ctx.code) {
        rPr += '<w:rFonts w:ascii="Consolas" w:hAnsi="Consolas"/><w:shd w:val="clear" w:color="auto" w:fill="F1F5F9"/>';
      }
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

    // Blockquote
    if (tag === 'BLOCKQUOTE') {
      const runsXml = await convertChildrenToWml(el, { ...ctx, italic: true });
      const pBdr = `<w:pBdr><w:left w:val="single" w:sz="18" w:space="12" w:color="6366F1"/></w:pBdr>`;
      const ind = `<w:ind w:left="360"/>`;
      return `<w:p><w:pPr><w:pStyle w:val="Normal"/>${pBdr}${ind}</w:pPr>${runsXml}</w:p>`;
    }

    // Preformatted Code Block
    if (tag === 'PRE') {
      const codeText = el.textContent || '';
      const lines = codeText.split(/\r\n|\r|\n/);
      const pBdr = `<w:pBdr><w:top w:val="single" w:sz="4" w:space="4" w:color="E2E8F0"/><w:left w:val="single" w:sz="4" w:space="4" w:color="E2E8F0"/><w:bottom w:val="single" w:sz="4" w:space="4" w:color="E2E8F0"/><w:right w:val="single" w:sz="4" w:space="4" w:color="E2E8F0"/></w:pBdr>`;
      const shd = `<w:shd w:val="clear" w:color="auto" w:fill="F8FAFC"/>`;
      const rPr = `<w:rPr><w:rFonts w:ascii="Consolas" w:hAnsi="Consolas"/><w:sz w:val="20"/><w:color w:val="334155"/></w:rPr>`;
      
      let runsXml = '';
      lines.forEach((line, idx) => {
        if (idx > 0) runsXml += '<w:br/>';
        runsXml += `<w:r>${rPr}<w:t xml:space="preserve">${escXml(line)}</w:t></w:r>`;
      });
      return `<w:p><w:pPr><w:pStyle w:val="Normal"/>${pBdr}${shd}</w:pPr>${runsXml}</w:p>`;
    }

    // Callout Alert Box
    if (el.classList && (el.classList.contains('callout') || el.classList.contains('callout-box') || el.getAttribute('data-callout'))) {
      const type = (el.getAttribute('data-callout') || 'tip').toLowerCase();
      let hexFill = 'F0FDF4'; // tip (green)
      let hexBdr = '22C55E';
      if (type === 'warning') { hexFill = 'FEFCE8'; hexBdr = 'EAB308'; }
      else if (type === 'info') { hexFill = 'EFF6FF'; hexBdr = '3B82F6'; }
      else if (type === 'danger') { hexFill = 'FEF2F2'; hexBdr = 'EF4444'; }

      const runsXml = await convertChildrenToWml(el, ctx);
      const pBdr = `<w:pBdr><w:left w:val="single" w:sz="24" w:space="12" w:color="${hexBdr}"/></w:pBdr>`;
      const shd = `<w:shd w:val="clear" w:color="auto" w:fill="${hexFill}"/>`;
      const ind = `<w:ind w:left="360"/>`;
      return `<w:p><w:pPr><w:pStyle w:val="Normal"/>${pBdr}${shd}${ind}</w:pPr>${runsXml}</w:p>`;
    }

    // Card Grid Row (2-column layout)
    if (el.classList && el.classList.contains('card-grid-row')) {
      const children = Array.from(el.children || []);
      let cellsXml = '';
      for (const child of children) {
        const contentXml = await convertElementToWml(child, ctx);
        const pXml = contentXml.includes('<w:p>') ? contentXml : `<w:p><w:pPr><w:pStyle w:val="Normal"/></w:pPr>${contentXml}</w:p>`;
        cellsXml += `<w:tc><w:tcPr><w:tcW w:w="4500" w:type="dxa"/></w:tcPr>${pXml}</w:tc>`;
      }
      const tblPr = `<w:tblPr><w:tblStyle w:val="TableGrid"/><w:tblW w:w="0" w:type="auto"/><w:tblBorders><w:top w:val="none"/><w:left w:val="none"/><w:bottom w:val="none"/><w:right w:val="none"/><w:insideH w:val="none"/><w:insideV w:val="none"/></w:tblBorders></w:tblPr>`;
      return `<w:tbl>${tblPr}<w:tr>${cellsXml}</w:tr></w:tbl>`;
    }

    // Horizontal Rule / Section Divider
    if (tag === 'HR' || (el.classList && el.classList.contains('paperuss-divider'))) {
      const pBdr = `<w:pBdr><w:bottom w:val="single" w:sz="6" w:space="1" w:color="CBD5E1"/></w:pBdr>`;
      return `<w:p><w:pPr><w:pStyle w:val="Normal"/>${pBdr}</w:pPr></w:p>`;
    }

    // Canvas element -> export as PNG data URL drawing snapshot
    if (tag === 'CANVAS' && typeof el.toDataURL === 'function') {
      try {
        const dataUrl = el.toDataURL('image/png');
        const img = document.createElement('img');
        img.setAttribute('src', dataUrl);
        return await convertImageToWml(img, ctx);
      } catch (e) {}
    }
    // Paperuss Embed Card or Generic Card Container (print/PDF/DOCX static card fallback)
    if (el.classList && (el.classList.contains('paperuss-embed') || el.classList.contains('paperuss-card') || el.classList.contains('media-card') || el.classList.contains('paperuss-card-file') || el.classList.contains('paperuss-card-audio') || el.classList.contains('paperuss-card-video'))) {
      return await convertEmbedToWml(el, ctx);
    }

    // Productivity Linked Compartments
    if (el.classList && el.classList.contains('productivity-ref')) {
      const children = Array.from(el.children || el.childNodes || []);
      const staticEl = children.find(c => c.classList && c.classList.contains('productivity-ref-static'));
      if (staticEl) {
        return await convertChildrenToWml(staticEl, ctx);
      }
      return '';
    }

    // Paragraph or Div
    if (tag === 'P' || tag === 'DIV') {
      const runsXml = await convertChildrenToWml(el, ctx);
      if (!runsXml.trim()) return '';
      const styleAttr = el.getAttribute ? el.getAttribute('style') || '' : '';
      let spacingXml = '';
      const lhMatch = styleAttr.match(/line-height:\s*([0-9.]+)/i);
      if (lhMatch) {
        const val = parseFloat(lhMatch[1]);
        const wLine = Math.round(val * 240);
        spacingXml = `<w:spacing w:line="${wLine}" w:lineRule="auto"/>`;
      }
      
      let jcXml = '';
      const alignAttr = el.getAttribute ? (el.getAttribute('data-card-align') || el.getAttribute('data-card-wrap') || el.getAttribute('data-wrap-mode')) : '';
      let alignMode = (alignAttr || '').toLowerCase();
      if (!alignMode) {
        const alignMatch = styleAttr.match(/(?:text-align|float):\s*(left|center|right|justify)/i);
        if (alignMatch) alignMode = alignMatch[1].toLowerCase();
      }
      if (alignMode === 'center') jcXml = '<w:jc w:val="center"/>';
      else if (alignMode === 'right') jcXml = '<w:jc w:val="right"/>';
      else if (alignMode === 'justify') jcXml = '<w:jc w:val="both"/>';

      return `<w:p><w:pPr><w:pStyle w:val="Normal"/>${spacingXml}${jcXml}</w:pPr>${runsXml}</w:p>`;
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
          outXml += await convertListItemToWml(child, { ...ctx, listLevel: level + 1 }, listType, Math.min(level, 8));
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

    // Extract inline style properties if node has style attribute
    const styleAttr = el.getAttribute ? el.getAttribute('style') || '' : '';
    let nodeTextColor = ctx.textColor;
    const colorMatch = styleAttr.match(/color:\s*([^;]+)/i);
    if (colorMatch) {
      const cVal = colorMatch[1].trim();
      if (cVal.startsWith('#')) {
        nodeTextColor = cVal;
      } else if (cVal.startsWith('rgb')) {
        const rgbVals = cVal.match(/\d+/g);
        if (rgbVals && rgbVals.length >= 3) {
          const hex = rgbVals.slice(0, 3).map(x => parseInt(x, 10).toString(16).padStart(2, '0')).join('');
          nodeTextColor = '#' + hex;
        }
      }
    }

    let nodeFontFamily = ctx.fontFamily;
    const fontMatch = styleAttr.match(/font-family:\s*([^;]+)/i);
    if (fontMatch) {
      const fontVal = fontMatch[1].split(',')[0].replace(/["']/g, '').trim();
      if (fontVal) nodeFontFamily = fontVal;
    }

    // Inline formatting tags
    const nextCtx = {
      ...ctx,
      bold: ctx.bold || tag === 'B' || tag === 'STRONG',
      italic: ctx.italic || tag === 'I' || tag === 'EM',
      underline: ctx.underline || tag === 'U',
      strikethrough: ctx.strikethrough || tag === 'S' || tag === 'STRIKE' || tag === 'DEL',
      highlight: ctx.highlight || tag === 'MARK',
      superscript: ctx.superscript || tag === 'SUP',
      subscript: ctx.subscript || tag === 'SUB',
      code: ctx.code || tag === 'CODE',
      textColor: nodeTextColor,
      fontFamily: nodeFontFamily
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
      const fldVal = isChecked ? '1' : '0';
      prefixRun = `<w:r><w:rPr><w:b/></w:rPr><w:t xml:space="preserve">${symbol}</w:t></w:r><w:fldSimple w:instr="FORMCHECKBOX ${fldVal}"/>`;
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
      let isHeaderRow = false;

      for (let c = 0; c < cells.length; c++) {
        const cell = cells[c];
        const cellTag = (cell.tagName || '').toUpperCase();
        if (cellTag === 'TH') isHeaderRow = true;
        if (cellTag === 'TD' || cellTag === 'TH') {
          const contentXml = await convertChildrenToWml(cell, ctx);
          const cellStyle = cell.getAttribute ? cell.getAttribute('style') || '' : '';
          
          // Alignment
          let jcXml = '';
          const alignMatch = cellStyle.match(/text-align:\s*(left|center|right|justify)/i);
          if (alignMatch) {
            const alignVal = alignMatch[1].toLowerCase();
            const wmlAlign = alignVal === 'justify' ? 'both' : alignVal;
            jcXml = `<w:jc w:val="${wmlAlign}"/>`;
          }

          const pXml = contentXml.includes('<w:p>')
            ? contentXml
            : `<w:p><w:pPr><w:pStyle w:val="Normal"/>${jcXml}</w:pPr>${contentXml}</w:p>`;
          
          // Background shading
          let fillHex = cellTag === 'TH' ? 'F1F5F9' : '';
          const bgMatch = cellStyle.match(/background(?:-color)?:\s*([^;]+)/i);
          if (bgMatch) {
            const bgVal = bgMatch[1].trim();
            if (bgVal.startsWith('#')) {
              let hex = bgVal.replace('#', '');
              if (hex.length === 3) hex = hex.split('').map(x => x + x).join('');
              if (/^[0-9A-Fa-f]{6}$/.test(hex)) fillHex = hex.toUpperCase();
            } else if (bgVal.startsWith('rgb')) {
              const rgbVals = bgVal.match(/\d+/g);
              if (rgbVals && rgbVals.length >= 3) {
                fillHex = rgbVals.slice(0, 3).map(x => parseInt(x, 10).toString(16).padStart(2, '0')).join('').toUpperCase();
              }
            }
          }

          const shdXml = fillHex ? `<w:shd w:val="clear" w:color="auto" w:fill="${fillHex}"/>` : '';
          cellsXml += `<w:tc><w:tcPr><w:tcW w:w="2500" w:type="dxa"/>${shdXml}</w:tcPr>${pXml}</w:tc>`;
        }
      }
      const trPr = `<w:trPr><w:cantSplit/>${isHeaderRow ? '<w:tblHeader/>' : ''}</w:trPr>`;
      rowsXml += `<w:tr>${trPr}${cellsXml}</w:tr>`;
    }

    const tblPr = `<w:tblPr><w:tblStyle w:val="TableGrid"/><w:tblW w:w="0" w:type="auto"/><w:tblBorders><w:top w:val="single" w:sz="4" w:space="0" w:color="CCCCCC"/><w:bottom w:val="single" w:sz="4" w:space="0" w:color="CCCCCC"/><w:left w:val="single" w:sz="4" w:space="0" w:color="CCCCCC"/><w:right w:val="single" w:sz="4" w:space="0" w:color="CCCCCC"/><w:insideH w:val="single" w:sz="4" w:space="0" w:color="EEEEEE"/><w:insideV w:val="single" w:sz="4" w:space="0" w:color="EEEEEE"/></w:tblBorders></w:tblPr>`;
    return `<w:tbl>${tblPr}${rowsXml}</w:tbl>`;
  }

  async function convertEmbedToWml(el, ctx) {
    try {
      const provider = el.getAttribute('data-provider') || 'Embed';
      const badgeEl = el.querySelector('.embed-provider-badge');
      const providerName = badgeEl ? badgeEl.textContent.trim() : provider;
      const url = el.getAttribute('data-canonical-url') || '';
      const strongEl = el.querySelector('.embed-canonical-text strong');
      const title = strongEl ? strongEl.textContent.trim() : `${providerName} Content`;
      const descEl = el.querySelector('.embed-fallback-desc');
      const desc = descEl ? descEl.textContent.trim() : '';

      const pBdr = `<w:pBdr><w:top w:val="single" w:sz="6" w:space="4" w:color="CCCCCC"/><w:left w:val="single" w:sz="6" w:space="4" w:color="CCCCCC"/><w:bottom w:val="single" w:sz="6" w:space="4" w:color="CCCCCC"/><w:right w:val="single" w:sz="6" w:space="4" w:color="CCCCCC"/></w:pBdr>`;
      const pPr = `<w:pPr><w:pStyle w:val="Normal"/>${pBdr}</w:pPr>`;

      let runXml = `<w:r><w:rPr><w:b/><w:color w:val="333333"/></w:rPr><w:t xml:space="preserve">[${escXml(providerName)}] ${escXml(title)} </w:t></w:r>`;
      if (desc) {
        runXml += `<w:r><w:rPr><w:color w:val="666666"/></w:rPr><w:t xml:space="preserve">— ${escXml(desc)} </w:t></w:r>`;
      }
      if (url) {
        const rId = nextRId(ctx.relsCounter);
        ctx.hyperlinks.push({ id: rId, target: url });
        runXml += `<w:hyperlink r:id="${rId}"><w:r><w:rPr><w:color w:val="0563C1"/><w:u w:val="single"/></w:rPr><w:t xml:space="preserve">(${escXml(url)})</w:t></w:r></w:hyperlink>`;
      }
      return `<w:p>${pPr}${runXml}</w:p>`;
    } catch (e) {
      const url = el.getAttribute ? el.getAttribute('data-canonical-url') : '';
      return `<w:p><w:r><w:t>[Embed: ${escXml(url || 'Content')}]</w:t></w:r></w:p>`;
    }
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
      if (!blob && src && (src.startsWith('blob:') || src.startsWith('http:') || src.startsWith('https:')) && typeof fetch === 'function') {
        try {
          const res = await fetch(src);
          if (res.ok) {
            blob = await res.blob();
            if (blob.type) {
              const m = blob.type.match(/image\/([a-zA-Z0-9]+)/);
              if (m) ext = m[1].toLowerCase();
            }
          }
        } catch (fe) {
          console.warn('docx export image fetch error:', fe);
        }
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

    // Inspect alignment / text wrapping attributes
    const parent = img.parentElement;
    const wrapAttr = (img.getAttribute ? (img.getAttribute('data-card-wrap') || img.getAttribute('data-wrap-mode') || img.getAttribute('data-card-align')) : '') ||
                     ((parent && parent.getAttribute) ? (parent.getAttribute('data-card-wrap') || parent.getAttribute('data-wrap-mode') || parent.getAttribute('data-card-align')) : '');
    const styleAttr = ((img.getAttribute ? img.getAttribute('style') || '' : '') + ';' + ((parent && parent.getAttribute) ? parent.getAttribute('style') || '' : '')).toLowerCase();

    let wrapMode = (wrapAttr || '').toLowerCase();
    if (!wrapMode) {
      if (/float:\s*left/i.test(styleAttr)) wrapMode = 'left';
      else if (/float:\s*right/i.test(styleAttr)) wrapMode = 'right';
      else if (/text-align:\s*center/i.test(styleAttr) || /margin:\s*[^;]*auto/i.test(styleAttr)) wrapMode = 'center';
      else wrapMode = 'none';
    }

    let jcVal = 'left';
    if (wrapMode === 'center') jcVal = 'center';
    else if (wrapMode === 'right') jcVal = 'right';
    else if (wrapMode === 'left') jcVal = 'left';

    // Estimate image width / height EMUs
    let pxW = 500;
    let pxH = 350;
    const wMatch = styleAttr.match(/width:\s*([0-9.]+)(px|%)/i);
    if (wMatch && wMatch[2] === 'px') pxW = Math.min(650, Math.max(40, parseFloat(wMatch[1])));
    const hMatch = styleAttr.match(/height:\s*([0-9.]+)(px|%)/i);
    if (hMatch && hMatch[2] === 'px') pxH = Math.min(800, Math.max(40, parseFloat(hMatch[1])));

    const cx = Math.round(pxW * 9525);
    const cy = Math.round(pxH * 9525);

    const pPr = `<w:pPr><w:pStyle w:val="Normal"/><w:jc w:val="${jcVal}"/></w:pPr>`;
    const graphicXml = `<a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:blipFill><a:blip r:embed="${rId}" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"/></pic:blipFill><pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm></pic:spPr></pic:pic></a:graphicData></a:graphic>`;

    if (wrapMode === 'left' || wrapMode === 'right') {
      const anchorXml = `<wp:anchor distT="0" distB="0" distL="114300" distR="114300" simplePos="0" relativeHeight="251658240" behindDoc="0" locked="0" layoutInCell="1" allowOverlap="1" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing"><wp:simplePos x="0" y="0"/><wp:positionH relativeFrom="column"><wp:align>${wrapMode}</wp:align></wp:positionH><wp:positionV relativeFrom="paragraph"><wp:align>top</wp:align></wp:positionV><wp:extent cx="${cx}" cy="${cy}"/><wp:wrapSquare wrapText="bothSides"/><wp:docPr id="${docPrId}" name="Image ${docPrId}" descr="PapeRuss Wrapped Image"/>${graphicXml}</wp:anchor>`;
      return `<w:p>${pPr}<w:r><w:drawing>${anchorXml}</w:drawing></w:r></w:p>`;
    }

    const inlineXml = `<wp:inline xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing"><wp:extent cx="${cx}" cy="${cy}"/><wp:docPr id="${docPrId}" name="Image ${docPrId}" descr="PapeRuss Image"/>${graphicXml}</wp:inline>`;
    return `<w:p>${pPr}<w:r><w:drawing>${inlineXml}</w:drawing></w:r></w:p>`;
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
      `<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/numbering" Target="numbering.xml"/>` +
      `<Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/fontTable" Target="fontTable.xml"/>`;

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
      `<Override PartName="/word/numbering.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml"/>` +
      `<Override PartName="/word/fontTable.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.fontTable+xml"/>`;

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
   * Build standard word/fontTable.xml for system font fallbacks.
   */
  function buildFontTableXml() {
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n` +
      `<w:fonts xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">` +
      `<w:font w:name="Calibri"><w:family w:val="swiss"/><w:pitch w:val="variable"/></w:font>` +
      `<w:font w:name="Segoe UI"><w:family w:val="swiss"/><w:pitch w:val="variable"/></w:font>` +
      `<w:font w:name="Consolas"><w:family w:val="modern"/><w:pitch w:val="fixed"/></w:font>` +
      `<w:font w:name="Georgia"><w:family w:val="roman"/><w:pitch w:val="variable"/></w:font>` +
      `<w:font w:name="Arial"><w:family w:val="swiss"/><w:pitch w:val="variable"/></w:font>` +
      `<w:font w:name="Bookman Old Style"><w:family w:val="roman"/><w:pitch w:val="variable"/></w:font>` +
      `<w:font w:name="Old English Text MT"><w:family w:val="decorative"/><w:pitch w:val="variable"/></w:font>` +
      `</w:fonts>`;
  }

  /**
   * Build standard word/styles.xml string with Word outline levels.
   */
  function buildStylesXml(fontFamilyName) {
    const fontName = fontFamilyName || 'Calibri';
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n` +
      `<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">` +
      `<w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="${escXml(fontName)}" w:hAnsi="${escXml(fontName)}"/><w:sz w:val="22"/></w:rPr></w:rPrDefault></w:docDefaults>` +
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
   * Build standard word/numbering.xml for multi-level lists.
   */
  function buildNumberingXml() {
    let bulletLevels = '';
    let decimalLevels = '';
    for (let lvl = 0; lvl <= 8; lvl++) {
      const leftIndent = 720 + (lvl * 360);
      bulletLevels += `<w:lvl w:ilvl="${lvl}"><w:numFmt w:val="bullet"/><w:lvlText w:val="•"/><w:lvlJc w:val="left"/><w:pPr><w:ind w:left="${leftIndent}" w:hanging="360"/></w:pPr></w:lvl>`;
      decimalLevels += `<w:lvl w:ilvl="${lvl}"><w:numFmt w:val="decimal"/><w:lvlText w:val="%${lvl + 1}."/><w:lvlJc w:val="left"/><w:pPr><w:ind w:left="${leftIndent}" w:hanging="360"/></w:pPr></w:lvl>`;
    }

    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n` +
      `<w:numbering xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">` +
      `<w:abstractNum w:abstractNumId="1">${bulletLevels}</w:abstractNum>` +
      `<w:abstractNum w:abstractNumId="2">${decimalLevels}</w:abstractNum>` +
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
    const relsCounter = { count: 3 }; // rId1=styles, rId2=numbering, rId3=fontTable
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

      // Add Hybrid Table of Contents section if note has multiple leaves
      if (leafOrder.length > 1) {
        bodyXml += `<w:p><w:pPr><w:pStyle w:val="Heading2"/></w:pPr><w:r><w:rPr><w:b/><w:color w:val="1F497D"/></w:rPr><w:t xml:space="preserve">Table of Contents</w:t></w:r></w:p>`;
        bodyXml += `<w:p><w:pPr><w:pStyle w:val="Normal"/></w:pPr><w:fldSimple w:instr="TOC \\o &quot;1-3&quot; \\h \\z \\u"/></w:p>`;
        for (let j = 0; j < leafOrder.length; j++) {
          const lId = leafOrder[j];
          let lObj = null;
          if (global.paperussLeaves && global.paperussLeaves.leafGet) {
            lObj = await global.paperussLeaves.leafGet(lId);
          }
          const tStr = lObj ? (lObj.title || `Leaf ${j + 1}`) : `Leaf ${j + 1}`;
          bodyXml += `<w:p><w:pPr><w:pStyle w:val="ListParagraph"/><w:ind w:left="360"/></w:pPr><w:r><w:rPr><w:color w:val="0563C1"/><w:u w:val="single"/></w:rPr><w:t xml:space="preserve">${j + 1}. ${escXml(tStr)}</w:t></w:r></w:p>`;
        }
        bodyXml += `<w:p><w:r><w:br w:type="page"/></w:r></w:p>`;
      }

      let validLeafCount = 0;
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
        
        validLeafCount++;

        // Each Leaf begins on a new page (except if first leaf right after title)
        if (validLeafCount > 1) {
          bodyXml += `<w:p><w:r><w:br w:type="page"/></w:r></w:p>`;
        }

        const leafTitle = leaf.title || `Leaf ${validLeafCount}`;
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
      
      if (validLeafCount === 0) {
        if (typeof global.toast === 'function') global.toast('This Note has no Leaves available to export.');
        return null;
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
        if (!note.leafOrder || note.leafOrder.length === 0 || note.leafOrder.includes('virtual_main_' + note.id)) {
          activeLeaf = { id: 'main', title: note.title || 'Main', content: note.content };
        }
      }
      
      if (!activeLeaf) {
        if (typeof global.toast === 'function') global.toast('No active Leaf found.');
        return null;
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

    const fontStyleMap = {
      calibri: 'Calibri',
      segoe: 'Segoe UI',
      serif: 'Georgia',
      mono: 'Consolas',
      arial: 'Arial',
      bookman: 'Bookman Old Style',
      oldenglish: 'Old English Text MT',
      sans: 'Inter',
      rounded: 'Calibri'
    };
    const targetFont = fontStyleMap[note.fontStyle] || 'Calibri';

    // Assemble package files
    zip.file('[Content_Types].xml', buildContentTypesXml(images));
    zip.file('_rels/.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n` +
      `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
      `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>` +
      `</Relationships>`);
    zip.file('word/document.xml', buildDocumentXml(bodyXml));
    zip.file('word/styles.xml', buildStylesXml(targetFont));
    zip.file('word/numbering.xml', buildNumberingXml());
    zip.file('word/fontTable.xml', buildFontTableXml());
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
   * Main export handler for Word document generation.
   * @param {string} mode - "active" or "all"
   */
  async function exportDocx(mode) {
    if (mode instanceof Event) {
      console.warn('exportDocx received an Event instead of a mode string. Defaulting to active.');
      mode = 'active';
    }
    try {
      const note = typeof global.getCurrentOpenNote === 'function' ? global.getCurrentOpenNote() : null;
      if (!note) {
        if (typeof global.toast === 'function') global.toast('Open a Note before exporting to Word.');
        return null;
      }

      if (typeof global.flushActiveLeaf === 'function') {
        await global.flushActiveLeaf();
      }

      if (typeof global.toast === 'function') {
        global.toast(mode === 'all' ? 'Generating Word document (.docx) for all leaves...' : 'Generating Word document (.docx)...');
      }

      const blob = await generateDocxBlob({ note, mode });
      if (!blob) return null; // Can happen if validation inside generateDocxBlob fails (e.g. no valid leaves)

      const suffix = mode === 'all' ? '-all-leaves' : '';
      const filename = `${(note.title || 'Note').replace(/[^\w\s-]/g, '').trim() || 'Note'}${suffix}.docx`;
      triggerBlobDownload(blob, filename);

      if (typeof global.toast === 'function') {
        global.toast(mode === 'all' ? 'Exported All Leaves to Word' : 'Exported Active Leaf to Word');
      }
      return blob;
    } catch (err) {
      console.error('exportDocx error:', err);
      if (typeof global.toast === 'function') global.toast('Word export failed: ' + err.message);
      return null;
    }
  }

  // Export on global window
  global.generateDocxBlob = generateDocxBlob;
  global.exportDocx = exportDocx;

})(typeof window !== 'undefined' ? window : global);
