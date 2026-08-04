/**
 * js/smart-dates.js
 * Parses dates/times and provides transient clickable suggestions in the editor.
 */

(function() {
  
  // =========================================================================
  // PARSER
  // =========================================================================

  const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];
  const SHORT_MONTHS = MONTHS.map(m => m.slice(0, 3));
  const WEEKDAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
  
  function getDaysInMonth(year, month) {
    return new Date(year, month + 1, 0).getDate();
  }

  // Regex definitions
  // 1. Time only (e.g. "3 PM", "3:30 PM", "15:00", "at 9 AM")
  const timeRe = /\b(?:(?:at\s+)?([0-1]?[0-9]|2[0-3])(?::([0-5][0-9]))?\s*([AaPp][Mm])|(?:at\s+)?([0-1]?[0-9]|2[0-3]):([0-5][0-9]))\b/ig;
  
  // 2. Absolute Dates (e.g. "August 15, 2026", "Aug 15", "15 August 2026", "08/15/2026", "2026-08-15")
  const monthNamesStr = [...MONTHS, ...SHORT_MONTHS].join('|');
  const absDate1 = new RegExp(`\\b(?:(${monthNamesStr})\\s+([1-9]|[12][0-9]|3[01])(?:st|nd|rd|th)?(?:,?\\s+((?:19|20)\\d\\d))?)\\b`, 'ig'); // Month DD, YYYY
  const absDate2 = new RegExp(`\\b(?:([1-9]|[12][0-9]|3[01])(?:st|nd|rd|th)?\\s+(${monthNamesStr})(?:,?\\s+((?:19|20)\\d\\d))?)\\b`, 'ig'); // DD Month YYYY
  const absDate3 = new RegExp(`\\b(?:(0?[1-9]|1[0-2])/(0?[1-9]|[12][0-9]|3[01])/(?:((?:19|20)\\d\\d)|\\d\\d))\\b`, 'ig'); // MM/DD/YYYY
  const absDate4 = new RegExp(`\\b(?:((?:19|20)\\d\\d)-(0?[1-9]|1[0-2])-(0?[1-9]|[12][0-9]|3[01]))\\b`, 'ig'); // YYYY-MM-DD
  
  // 3. Relative Dates
  const weekdaysStr = WEEKDAYS.join('|');
  const relDate1 = /\b(?:today|tomorrow)\b/ig;
  const relDate2 = new RegExp(`\\b(?:next\\s+)(${weekdaysStr})\\b`, 'ig');
  const relDate3 = new RegExp(`\\b(${weekdaysStr})\\b`, 'ig');

  // Combined patterns (Date + Time) are handled by parsing dates and times separately and looking for proximity.
  
  function matchTime(m, offset) {
    let hour = -1, min = 0;
    
    if (m[4] !== undefined && m[5] !== undefined) {
      hour = parseInt(m[4], 10); min = parseInt(m[5], 10);
    } else if (m[1] !== undefined) {
      hour = parseInt(m[1], 10); if(m[2]) min = parseInt(m[2], 10);
      let ampm = m[3] ? m[3].toLowerCase() : null;
      if (ampm === 'pm' && hour < 12) hour += 12;
      if (ampm === 'am' && hour === 12) hour = 0;
    }
    
    return {
      text: m[0],
      start: m.index + offset,
      end: m.index + m[0].length + offset,
      hour, min,
      hasExplicitTime: true,
      requiresDate: true
    };
  }

  function parseDateObj(m, regexType, contextDate, offset) {
    const d = new Date(contextDate.getTime());
    let y, mo, da;
    
    if (regexType === 'abs4') {
      y = parseInt(m[1]); mo = parseInt(m[2])-1; da = parseInt(m[3]);
      if (da > getDaysInMonth(y, mo)) return null;
      d.setFullYear(y, mo, da);
    } else if (regexType === 'abs3') {
      y = m[3] ? parseInt(m[3]) : d.getFullYear();
      mo = parseInt(m[1])-1; da = parseInt(m[2]);
      if (da > getDaysInMonth(y, mo)) return null;
      d.setFullYear(y, mo, da);
      if (!m[3] && d.getTime() < contextDate.getTime() - 86400000) d.setFullYear(y+1);
    } else if (regexType === 'abs1' || regexType === 'abs2') {
      let moStr = m[1].toLowerCase();
      let daStr = m[2];
      if (regexType === 'abs2') { moStr = m[2].toLowerCase(); daStr = m[1]; }
      
      mo = MONTHS.indexOf(moStr);
      if (mo === -1) mo = SHORT_MONTHS.indexOf(moStr);
      da = parseInt(daStr);
      y = m[3] ? parseInt(m[3]) : d.getFullYear();
      
      if (da > getDaysInMonth(y, mo)) return null;
      d.setFullYear(y, mo, da);
      if (!m[3] && d.getTime() < contextDate.getTime() - 86400000) d.setFullYear(y+1);
    } else if (regexType === 'rel1') {
      let w = m[0].toLowerCase();
      if (w === 'tomorrow') d.setDate(d.getDate() + 1);
    } else if (regexType === 'rel2' || regexType === 'rel3') {
      let target = WEEKDAYS.indexOf(m[1].toLowerCase());
      let current = d.getDay();
      let diff = target - current;
      if (diff <= 0) diff += 7;
      if (regexType === 'rel2') diff += 7; // next week
      d.setDate(d.getDate() + diff);
    }
    
    return {
      text: m[0],
      start: m.index + offset,
      end: m.index + m[0].length + offset,
      date: d,
      hasExplicitDate: true,
      requiresDate: false,
      isRelative: regexType.startsWith('rel')
    };
  }

  window.parseSmartDatePhrase = function(text, contextDate) {
    contextDate = contextDate || new Date();
    let dates = [];
    let times = [];
    
    // Find all times
    timeRe.lastIndex = 0;
    let m;
    while ((m = timeRe.exec(text))) {
      let t = matchTime(m, 0);
      if (t) times.push(t);
    }
    
    // Find all dates
    const dateRegexes = [
      { re: absDate4, type: 'abs4' },
      { re: absDate3, type: 'abs3' },
      { re: absDate1, type: 'abs1' },
      { re: absDate2, type: 'abs2' },
      { re: relDate1, type: 'rel1' },
      { re: relDate2, type: 'rel2' },
      { re: relDate3, type: 'rel3' }
    ];
    
    for (let rule of dateRegexes) {
      rule.re.lastIndex = 0;
      while ((m = rule.re.exec(text))) {
        let d = parseDateObj(m, rule.type, contextDate, 0);
        if (d) dates.push(d);
      }
    }
    
    // Sort dates and times by start index so we combine them left-to-right properly
    dates.sort((a, b) => a.start - b.start);
    times.sort((a, b) => a.start - b.start);
    
    // Combine proximate dates and times
    let consumedTimes = new Set();
    let consumedDates = new Set();
    let combined = [];
    
    for (let d of dates) {
      for (let t of times) {
        if (consumedTimes.has(t)) continue;
        // Check if they are separated by small glue like " at ", " ", ", "
        let distance = Math.abs(d.start - t.end);
        let distance2 = Math.abs(t.start - d.end);
        let isClose = false;
        let start = -1, end = -1, combinedText = '';
        if (t.start >= d.end && t.start - d.end <= 5) {
          isClose = true; start = d.start; end = t.end;
        } else if (d.start >= t.end && d.start - t.end <= 5) {
          isClose = true; start = t.start; end = d.end;
        }
        if (isClose) {
          let cd = new Date(d.date.getTime());
          cd.setHours(t.hour, t.min, 0, 0);
          combined.push({
            rawText: text.substring(start, end),
            startIndex: start,
            endIndex: end,
            startDate: cd,
            hasExplicitDate: true,
            hasExplicitTime: true,
            requiresDate: false,
            confidence: 1.0
          });
          consumedDates.add(d);
          consumedTimes.add(t);
        }
      }
    }
    
    for (let d of dates) {
      if (!consumedDates.has(d)) {
        d.date.setHours(0,0,0,0);
        combined.push({
          rawText: d.text,
          startIndex: d.start,
          endIndex: d.end,
          startDate: d.date,
          hasExplicitDate: true,
          hasExplicitTime: false,
          requiresDate: false,
          confidence: 0.8
        });
      }
    }
    
    for (let t of times) {
      if (!consumedTimes.has(t)) {
        let cd = new Date(contextDate.getTime());
        cd.setHours(t.hour, t.min, 0, 0);
        combined.push({
          rawText: t.text,
          startIndex: t.start,
          endIndex: t.end,
          startDate: cd,
          hasExplicitDate: false,
          hasExplicitTime: true,
          requiresDate: true,
          confidence: 0.5
        });
      }
    }
    
    // Sort by start index, then longest text
    combined.sort((a, b) => {
      if (a.startIndex !== b.startIndex) return a.startIndex - b.startIndex;
      return b.rawText.length - a.rawText.length;
    });
    
    // Remove overlaps
    let finalResults = [];
    let lastEnd = -1;
    for (let r of combined) {
      if (r.startIndex >= lastEnd) {
        finalResults.push(r);
        lastEnd = r.endIndex;
      }
    }
    return finalResults;
  };

  // =========================================================================
  // DOM AND CARET
  // =========================================================================

  function getCaretOffsets(block) {
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0) return null;
    const range = sel.getRangeAt(0);
    if (!block.contains(range.startContainer)) return null;
    
    const preCaretRange = range.cloneRange();
    preCaretRange.selectNodeContents(block);
    preCaretRange.setEnd(range.startContainer, range.startOffset);
    let start = preCaretRange.toString().length;
    
    const postCaretRange = range.cloneRange();
    postCaretRange.selectNodeContents(block);
    postCaretRange.setEnd(range.endContainer, range.endOffset);
    let end = postCaretRange.toString().length;
    
    return { start, end };
  }

  function setCaretOffsets(block, start, end) {
    const sel = window.getSelection();
    let charIndex = 0;
    let startNode, startOffset, endNode, endOffset;
    
    function traverse(node) {
      if (node.nodeType === 3) {
        let nextIndex = charIndex + node.length;
        if (!startNode && start >= charIndex && start <= nextIndex) {
          startNode = node;
          startOffset = start - charIndex;
        }
        if (!endNode && end >= charIndex && end <= nextIndex) {
          endNode = node;
          endOffset = end - charIndex;
        }
        charIndex = nextIndex;
      } else {
        for (let i = 0; i < node.childNodes.length; i++) {
          traverse(node.childNodes[i]);
        }
      }
    }
    
    traverse(block);
    if (startNode && endNode) {
      const range = document.createRange();
      range.setStart(startNode, startOffset);
      range.setEnd(endNode, endOffset);
      sel.removeAllRanges();
      sel.addRange(range);
    }
  }

  // Suppression Set
  window.suppressedSmartDates = window.suppressedSmartDates || new Set();

  // Build marker — verify in browser: window.PAPERUSS_SMART_DATES_BUILD
  window.PAPERUSS_SMART_DATES_BUILD = 'checkpoint-c-canonical-hotfix';

  // =========================================================================
  // CANONICAL NOTES HELPERS
  // =========================================================================

  function getCanonicalNotesArray() {
    // Try the canonical getter first (core.js live reference)
    if (typeof window.getCanonicalNotes === 'function') {
      const list = window.getCanonicalNotes();
      if (Array.isArray(list)) return list;
    }
    // Try the snapshot assigned at core.js load time
    if (Array.isArray(window.paperussNotes)) return window.paperussNotes;
    // Final fallback: core.js exposes notes directly in some configurations
    if (Array.isArray(window.notes)) return window.notes;
    return null;
  }

  function getCanonicalNote(eventId) {
    if (typeof window.getNote === 'function') {
      const n = window.getNote(eventId);
      if (n) return n;
    }
    const arr = getCanonicalNotesArray();
    return arr ? (arr.find(x => String(x.id) === String(eventId)) || null) : null;
  }

  // =========================================================================
  // HYBRID LEAF CONTEXT
  // =========================================================================

  async function resolveActiveLeafContext() {
    const activeNoteId = window.HistoryManager ? window.HistoryManager.activeNoteId : null;
    if (!activeNoteId) return null;

    const n = typeof window.getNote === 'function' ? window.getNote(activeNoteId) : null;
    if (!n) return null;

    const leavesApi = window.paperussLeaves;
    const isMigrated = leavesApi &&
      typeof leavesApi.isNoteMigratedToLeaves === 'function' &&
      leavesApi.isNoteMigratedToLeaves(n);

    if (isMigrated) {
      const leafId = leavesApi.getNoteActiveLeafId(n);
      const leaf = await leavesApi.leafGet(leafId);
      if (!leaf) throw new Error('Smart Dates: physical Leaf not found for note ' + activeNoteId);
      return { note: n, leaf, isMigrated: true };
    }
    // Unmigrated virtual Main Leaf — store directly on the note
    return { note: n, leaf: null, isMigrated: false };
  }

  window.getSmartDateLinksForActiveLeaf = async function() {
    try {
      const ctx = await resolveActiveLeafContext();
      if (!ctx) return [];
      return ctx.isMigrated
        ? (ctx.leaf.smartDateLinks || [])
        : (ctx.note.smartDateLinks || []);
    } catch (e) {
      console.error('getSmartDateLinksForActiveLeaf:', e);
      return [];
    }
  };

  // NOTE: saveSmartDateLink must NOT call save() — caller is responsible.
  window.saveSmartDateLink = async function(linkObj) {
    const ctx = await resolveActiveLeafContext();
    if (!ctx) return;
    if (ctx.isMigrated) {
      ctx.leaf.smartDateLinks = ctx.leaf.smartDateLinks || [];
      ctx.leaf.smartDateLinks.push(linkObj);
      await window.paperussLeaves.leafPut(ctx.leaf);
    } else {
      // Attach to note; canonical save() will persist it
      ctx.note.smartDateLinks = ctx.note.smartDateLinks || [];
      ctx.note.smartDateLinks.push(linkObj);
    }
  };

  window.removeSmartDateLink = async function(eventId) {
    try {
      const ctx = await resolveActiveLeafContext();
      if (!ctx) return;
      if (ctx.isMigrated) {
        if (ctx.leaf.smartDateLinks) {
          ctx.leaf.smartDateLinks = ctx.leaf.smartDateLinks.filter(l => l.eventId !== eventId);
          await window.paperussLeaves.leafPut(ctx.leaf);
        }
      } else {
        if (ctx.note.smartDateLinks) {
          ctx.note.smartDateLinks = ctx.note.smartDateLinks.filter(l => l.eventId !== eventId);
          if (typeof window.save === 'function') window.save();
        }
      }
    } catch (e) {
      console.error('removeSmartDateLink:', e);
    }
  };

  // =========================================================================
  // CLEAN BLOCK HTML HELPER
  // =========================================================================

  function getCleanBlockHTML(block) {
    const clone = block.cloneNode(true);
    clone.querySelectorAll('.smart-date-suggestion').forEach(span => {
      while (span.firstChild) span.parentNode.insertBefore(span.firstChild, span);
      span.remove();
    });
    clone.normalize();
    return clone.innerHTML;
  }

  function escHtml(str) {
    if (!str) return '';
    return String(str).replace(/[&<>"']/g, function(m) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m];
    });
  }

  // =========================================================================
  // SCAN SMART DATES IN BLOCK
  // =========================================================================

  window.scanSmartDatesInBlock = function(block, contextDate, links) {
    if (!block || !block.textContent) return;

    // Dehydrate any existing schedule lines before rescanning
    block.querySelectorAll('.smart-date-linked-schedule').forEach(el => {
      if (el.dataset.sdHiddenLi === 'true') {
        el.remove();
      } else {
        const html = el.dataset.sdOriginalHtml;
        const tag = el.dataset.sdOriginalTag || 'P';
        if (html) {
          const restored = document.createElement(tag);
          restored.innerHTML = html;
          el.replaceWith(restored);
          block = restored;
        }
      }
    });
    document.querySelectorAll('.smart-date-hidden-li').forEach(li => {
      li.classList.remove('smart-date-hidden-li');
      li.style.display = '';
    });

    if (block.closest('.smart-date-suggestion, .smart-date-linked-schedule, .productivity-ref, [data-embed], pre, code, [contenteditable="false"]')) return;

    block.querySelectorAll('.smart-date-suggestion').forEach(span => {
      while (span.firstChild) span.parentNode.insertBefore(span.firstChild, span);
      span.remove();
    });

    block.normalize();
    const text = block.textContent;

    // Link matching: rawText + offsets + context for exact-occurrence disambiguation
    let matchedLink = null;
    if (links && links.length > 0) {
      for (const l of links) {
        if (l.originalBlockText !== text) continue;
        if (l.rawText && l.startOffset !== undefined && l.endOffset !== undefined) {
          const expectedRaw = text.substring(l.startOffset, l.endOffset);
          if (expectedRaw === l.rawText) { matchedLink = l; break; }
          // Fallback: context match
          if (l.contextBefore !== undefined && l.contextAfter !== undefined) {
            const ctxBefore = text.substring(0, l.startOffset);
            const ctxAfter = text.substring(l.endOffset);
            if (ctxBefore.endsWith(l.contextBefore) && ctxAfter.startsWith(l.contextAfter)) {
              matchedLink = l; break;
            }
          }
        } else {
          // Legacy link without offsets
          matchedLink = l; break;
        }
      }
    }

    if (matchedLink) {
      const eventId = matchedLink.eventId;
      const evObj = getCanonicalNote(eventId);
      const isUnavailable = !evObj || evObj.deleted || evObj.deletedAt ||
        !(Array.isArray(evObj.tags) && evObj.tags.includes('calendar'));

      const newEl = document.createElement('div');
      newEl.className = 'smart-date-linked-schedule';
      newEl.setAttribute('data-smart-date-state', isUnavailable ? 'unavailable' : 'linked');
      newEl.setAttribute('contenteditable', 'false');
      newEl.setAttribute('tabindex', '0');
      newEl.dataset.sdOriginalHtml = matchedLink.originalBlockHTML || block.innerHTML;
      newEl.dataset.sdOriginalTag = matchedLink.originalBlockTag || block.tagName;
      newEl.dataset.eventId = eventId;

      if (isUnavailable) {
        newEl.innerHTML = `<span class="smart-date-linked-main smart-date-unavailable">
            <span aria-hidden="true">📅</span>
            <span class="smart-date-linked-title">Event unavailable</span>
            <span class="smart-date-linked-separator">·</span>
            <span class="smart-date-linked-date">${escHtml(matchedLink.originalBlockText)}</span>
          </span>
          <span class="smart-date-linked-actions">
            <button class="smart-date-action-btn" onclick="window.handleSmartDateAction(event,'remove','${eventId}')">Remove Link</button>
          </span>`;
      } else {
        const start = new Date(evObj.calendarStart);
        const end = new Date(evObj.calendarEnd);
        const dateStr = start.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
        const timeStrStart = start.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
        const timeStrEnd = end.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });

        newEl.innerHTML = `<span class="smart-date-linked-main">
            <span aria-hidden="true">📅</span>
            <span class="smart-date-linked-title">${escHtml(evObj.title)}</span>
            <span class="smart-date-linked-separator">·</span>
            <span class="smart-date-linked-date">${escHtml(dateStr)}</span>
            <span class="smart-date-linked-separator">·</span>
            <span class="smart-date-linked-time">${escHtml(timeStrStart)}–${escHtml(timeStrEnd)}</span>
          </span>
          <span class="smart-date-linked-actions">
            <button class="smart-date-action-btn" onclick="window.handleSmartDateAction(event,'open','${eventId}')">Open</button>
            <button class="smart-date-action-btn" onclick="window.handleSmartDateAction(event,'edit','${eventId}')">Edit</button>
            <button class="smart-date-action-btn danger" onclick="window.handleSmartDateAction(event,'unlink','${eventId}')">Unlink</button>
            <button class="smart-date-action-btn danger" onclick="window.handleSmartDateAction(event,'delete','${eventId}')">Delete Event</button>
          </span>`;
      }

      if (block.tagName === 'LI') {
        const list = block.closest('ul, ol');
        if (list && list.parentNode) {
          list.parentNode.insertBefore(newEl, list.nextSibling);
          block.style.display = 'none';
          block.classList.add('smart-date-hidden-li');
          newEl.dataset.sdHiddenLi = 'true';
        }
      } else {
        block.replaceWith(newEl);
      }
      return;
    }

    const matches = window.parseSmartDatePhrase(text, contextDate);
    if (!matches.length) return;

    const caret = getCaretOffsets(block);
    let textNodes = [];
    let currentIndex = 0;

    function buildTextNodes(node) {
      if (node.nodeType === 3) {
        textNodes.push({ node, start: currentIndex, end: currentIndex + node.length });
        currentIndex += node.length;
      } else {
        if (['A', 'CODE', 'PRE'].includes(node.nodeName) ||
            (node.hasAttribute && node.hasAttribute('data-embed')) ||
            (node.classList && node.classList.contains('productivity-ref')) ||
            (node.getAttribute && node.getAttribute('contenteditable') === 'false')) {
          currentIndex += node.textContent.length;
          return;
        }
        Array.from(node.childNodes).forEach(buildTextNodes);
      }
    }
    buildTextNodes(block);

    matches.reverse().forEach(m => {
      if (caret) {
        const overlap = Math.max(0, Math.min(caret.end, m.endIndex) - Math.max(caret.start, m.startIndex));
        if (overlap > 0 || caret.start === m.endIndex || caret.end === m.endIndex) return;
      }

      const activeNoteId = window.HistoryManager && window.HistoryManager.activeNoteId ? window.HistoryManager.activeNoteId : 'unknown-note';
      const activeEditor = document.getElementById('noteBody');
      const activeLeafId = activeEditor && activeEditor.dataset && activeEditor.dataset.leafId ? activeEditor.dataset.leafId : 'unknown-leaf';
      const suppressionKey = `${activeNoteId}::${activeLeafId}::${m.rawText}::${text}`;

      if (window.suppressedSmartDates.has(suppressionKey)) return;

      const containingNodeObj = textNodes.find(n => m.startIndex >= n.start && m.endIndex <= n.end);
      if (!containingNodeObj) return;

      const node = containingNodeObj.node;
      const localStart = m.startIndex - containingNodeObj.start;
      const localEnd = m.endIndex - containingNodeObj.start;

      const beforeText = node.textContent.slice(0, localStart);
      const matchText = node.textContent.slice(localStart, localEnd);
      const afterText = node.textContent.slice(localEnd);
      const parent = node.parentNode;

      const span = document.createElement('span');
      span.className = 'smart-date-suggestion';
      span.setAttribute('data-paperuss-smart-date', 'true');
      span.setAttribute('contenteditable', 'false');
      span.setAttribute('tabindex', '0');
      span.setAttribute('role', 'button');
      span.setAttribute('aria-label', `Detected date: ${matchText}`);
      span.dataset.sdStart = m.startDate.getTime();
      span.dataset.sdHasDate = m.hasExplicitDate;
      span.dataset.sdHasTime = m.hasExplicitTime;
      span.dataset.sdSuppressionKey = suppressionKey;
      span.textContent = matchText;

      if (beforeText) parent.insertBefore(document.createTextNode(beforeText), node);
      parent.insertBefore(span, node);
      if (afterText) parent.insertBefore(document.createTextNode(afterText), node);
      node.remove();
    });

    if (caret) {
      try { setCaretOffsets(block, caret.start, caret.end); } catch (_) {}
    }
  };

  // =========================================================================
  // LIFECYCLE
  // =========================================================================

  let scanTimer = null;
  let isComposing = false;
  let scheduledBlock = null;
  let scheduledRoot = null;
  let scheduledContextDate = null;

  async function safeScan() {
    if (isComposing) return;
    if (!scheduledBlock || !scheduledRoot) return;
    if (!document.contains(scheduledRoot) || !document.contains(scheduledBlock)) return;
    if (!scheduledRoot.contains(scheduledBlock)) return;
    const activeEditor = document.getElementById('noteBody');
    if (activeEditor && scheduledRoot !== activeEditor) return;
    const links = await window.getSmartDateLinksForActiveLeaf();
    window.scanSmartDatesInBlock(scheduledBlock, scheduledContextDate || new Date(), links);
  }

  window.scheduleSmartDateScan = function(root, editedBlock, contextDate) {
    if (!editedBlock || !root) return;
    scheduledBlock = editedBlock;
    scheduledRoot = root;
    scheduledContextDate = contextDate || new Date();
    if (isComposing) return;
    clearTimeout(scanTimer);
    scanTimer = setTimeout(safeScan, 500);
  };

  document.addEventListener('compositionstart', () => { isComposing = true; });
  document.addEventListener('compositionend', () => {
    isComposing = false;
    if (scheduledBlock && scheduledRoot) { clearTimeout(scanTimer); scanTimer = setTimeout(safeScan, 500); }
  });

  window.hydrateSmartDateSuggestions = function(root, contextDate) {
    if (!root) return;
    const cd = contextDate || new Date();
    const run = async () => {
      if (!root.isConnected) return;
      const activeEditor = document.getElementById('noteBody');
      if (activeEditor && root !== activeEditor) return;
      const links = await window.getSmartDateLinksForActiveLeaf();
      root.querySelectorAll('p, div, li, h1, h2, h3, h4, h5, h6, blockquote').forEach(block => {
        if (!block.isConnected || !root.contains(block)) return;
        window.scanSmartDatesInBlock(block, cd, links);
      });
    };
    if (window.requestIdleCallback) window.requestIdleCallback(run);
    else setTimeout(run, 500);
  };

  window.dehydrateSmartDateSuggestions = function(root) {
    if (!root) return;
    root.querySelectorAll('.smart-date-linked-schedule').forEach(el => {
      if (el.dataset.sdHiddenLi === 'true') {
        el.remove();
        root.querySelectorAll('.smart-date-hidden-li').forEach(li => {
          li.classList.remove('smart-date-hidden-li');
          li.style.display = '';
        });
      } else {
        const html = el.dataset.sdOriginalHtml;
        const tag = el.dataset.sdOriginalTag || 'P';
        if (html) {
          const restored = document.createElement(tag);
          restored.innerHTML = html;
          el.replaceWith(restored);
        }
      }
    });
    root.querySelectorAll('.smart-date-suggestion').forEach(span => {
      const parent = span.parentNode;
      if (!parent) return;
      while (span.firstChild) parent.insertBefore(span.firstChild, span);
      span.remove();
      parent.normalize();
    });
  };

  window.clearSmartDateSuggestions = window.dehydrateSmartDateSuggestions;

  function unwrapSpan(span) {
    const parent = span.parentNode;
    if (!parent) return;
    while (span.firstChild) parent.insertBefore(span.firstChild, span);
    span.remove();
    parent.normalize();
  }

  // =========================================================================
  // MODAL — CREATE CALENDAR EVENT
  // =========================================================================

  function openSmartDateModal(span) {
    const modalRootEl = document.getElementById('modalRoot');
    if (!modalRootEl) return;
    if (modalRootEl.querySelector('.modal-overlay')) return; // guard double-open

    const startDate = new Date(parseInt(span.dataset.sdStart, 10));
    const hasDate = span.dataset.sdHasDate === 'true';
    const hasTime = span.dataset.sdHasTime === 'true';
    const suppressionKey = span.dataset.sdSuppressionKey;
    const rawText = span.textContent;

    const block = span.closest('p, div, li, h1, h2, h3, h4, h5, h6, blockquote') || span.parentNode;
    const originalBlockTag = block.tagName;
    const originalBlockText = block.textContent;

    // Compute exact offsets of the matched phrase within the block text
    const spanStartOffset = originalBlockText.indexOf(rawText);
    const spanEndOffset = spanStartOffset >= 0 ? spanStartOffset + rawText.length : -1;
    const CTX = 30;
    const contextBefore = spanStartOffset >= 0 ? originalBlockText.substring(Math.max(0, spanStartOffset - CTX), spanStartOffset) : '';
    const contextAfter = spanEndOffset >= 0 ? originalBlockText.substring(spanEndOffset, Math.min(originalBlockText.length, spanEndOffset + CTX)) : '';

    let extractedTitle = originalBlockText.replace(rawText, '').trim();
    extractedTitle = extractedTitle.replace(/^[^\w\d]+|[^\w\d]+$/g, '').trim();
    if (!extractedTitle) extractedTitle = 'Event';

    const dateStr = startDate.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
    const timeStr = startDate.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });

    let interpretedMsg = '';
    let warningMsg = '';
    if (hasDate && hasTime) {
      interpretedMsg = `${dateStr} at ${timeStr}`;
    } else if (hasDate) {
      interpretedMsg = dateStr;
      warningMsg = `<p style="color:var(--warning);font-size:13px;margin:8px 0"><i class="feather-alert-triangle" style="vertical-align:middle"></i> Time is missing.</p>`;
    } else if (hasTime) {
      interpretedMsg = timeStr;
      warningMsg = `<p style="color:var(--warning);font-size:13px;margin:8px 0"><i class="feather-alert-triangle" style="vertical-align:middle"></i> Date is missing.</p>`;
    }

    const close = () => { modalRootEl.innerHTML = ''; };

    const renderConfirmation = () => {
      modalRootEl.innerHTML = `<div class="modal-overlay">
        <div class="modal" style="max-width:360px">
          <h3 style="margin-top:0">Create Calendar Event?</h3>
          <div style="background:var(--subtle);border-radius:8px;padding:12px;margin:16px 0">
            <div style="font-weight:600;font-size:15px;margin-bottom:4px">"${escHtml(rawText)}"</div>
            <div style="color:var(--fg-secondary);font-size:13.5px">${escHtml(interpretedMsg)}</div>
            ${warningMsg}
          </div>
          <div style="display:flex;flex-direction:column;gap:8px">
            <button class="btn btn-primary" id="sdConfirmBtn" style="width:100%;justify-content:center">Create Event</button>
            <button class="btn" id="sdNotEventBtn" style="width:100%;justify-content:center">Not an event</button>
            <button class="btn" id="sdCancelBtn" style="width:100%;justify-content:center;background:transparent;border:none">Cancel</button>
          </div>
        </div>
      </div>`;
      modalRootEl.querySelector('.modal-overlay').onclick = e => { if (e.target === e.currentTarget) close(); };
      document.getElementById('sdCancelBtn').onclick = close;
      document.getElementById('sdNotEventBtn').onclick = () => {
        window.suppressedSmartDates.add(suppressionKey);
        unwrapSpan(span);
        close();
      };
      document.getElementById('sdConfirmBtn').onclick = () => {
        if (!hasDate && !hasTime) return;
        renderForm();
      };
    };

    const renderForm = () => {
      const startDVal = `${startDate.getFullYear()}-${String(startDate.getMonth()+1).padStart(2,'0')}-${String(startDate.getDate()).padStart(2,'0')}`;
      const startTVal = `${String(startDate.getHours()).padStart(2,'0')}:${String(startDate.getMinutes()).padStart(2,'0')}`;
      const endDate = new Date(startDate.getTime() + 3600000);
      const endDVal = `${endDate.getFullYear()}-${String(endDate.getMonth()+1).padStart(2,'0')}-${String(endDate.getDate()).padStart(2,'0')}`;
      const endTVal = `${String(endDate.getHours()).padStart(2,'0')}:${String(endDate.getMinutes()).padStart(2,'0')}`;

      modalRootEl.innerHTML = `<div class="modal-overlay">
        <div class="modal" style="max-width:400px;max-height:90vh;overflow-y:auto">
          <h3 style="margin-top:0">Create Event</h3>
          <div class="form-group" style="margin-bottom:12px">
            <label style="display:block;font-size:12px;font-weight:600;margin-bottom:4px;color:var(--fg-secondary)">Title</label>
            <input type="text" id="sdFormTitle" value="${escHtml(extractedTitle)}" style="width:100%;padding:8px;border-radius:6px;border:1px solid var(--border);background:var(--bg);color:var(--fg)">
          </div>
          <div style="display:flex;gap:12px;margin-bottom:12px">
            <div style="flex:1">
              <label style="display:block;font-size:12px;font-weight:600;margin-bottom:4px;color:var(--fg-secondary)">Start Date</label>
              <input type="date" id="sdFormStartDate" value="${hasDate ? startDVal : ''}" ${hasDate ? '' : 'required'} style="width:100%;padding:8px;border-radius:6px;border:1px solid var(--border);background:var(--bg);color:var(--fg)">
            </div>
            <div style="flex:1">
              <label style="display:block;font-size:12px;font-weight:600;margin-bottom:4px;color:var(--fg-secondary)">Start Time</label>
              <input type="time" id="sdFormStartTime" value="${hasTime ? startTVal : ''}" ${hasTime ? '' : 'required'} style="width:100%;padding:8px;border-radius:6px;border:1px solid var(--border);background:var(--bg);color:var(--fg)">
            </div>
          </div>
          <div style="display:flex;gap:12px;margin-bottom:12px">
            <div style="flex:1">
              <label style="display:block;font-size:12px;font-weight:600;margin-bottom:4px;color:var(--fg-secondary)">End Date</label>
              <input type="date" id="sdFormEndDate" value="${hasDate ? endDVal : ''}" style="width:100%;padding:8px;border-radius:6px;border:1px solid var(--border);background:var(--bg);color:var(--fg)">
            </div>
            <div style="flex:1">
              <label style="display:block;font-size:12px;font-weight:600;margin-bottom:4px;color:var(--fg-secondary)">End Time</label>
              <input type="time" id="sdFormEndTime" value="${(hasDate && hasTime) || hasTime ? endTVal : ''}" style="width:100%;padding:8px;border-radius:6px;border:1px solid var(--border);background:var(--bg);color:var(--fg)">
            </div>
          </div>
          <div class="form-group" style="margin-bottom:12px">
            <label style="display:block;font-size:12px;font-weight:600;margin-bottom:4px;color:var(--fg-secondary)">Type</label>
            <select id="sdFormType" style="width:100%;padding:8px;border-radius:6px;border:1px solid var(--border);background:var(--bg);color:var(--fg)">
              <option value="event">Event</option>
              <option value="meeting">Meeting</option>
              <option value="deadline">Deadline</option>
            </select>
          </div>
          <div class="form-group" style="margin-bottom:12px">
            <label style="display:block;font-size:12px;font-weight:600;margin-bottom:4px;color:var(--fg-secondary)">Description</label>
            <textarea id="sdFormDesc" rows="2" style="width:100%;padding:8px;border-radius:6px;border:1px solid var(--border);background:var(--bg);color:var(--fg);resize:vertical"></textarea>
          </div>
          <div style="display:flex;gap:16px;margin-bottom:16px">
            <label style="display:flex;align-items:center;gap:6px;font-size:13px"><input type="checkbox" id="sdFormNotify"> Reminder</label>
            <select id="sdFormRepeat" style="padding:4px;border-radius:4px;border:1px solid var(--border);background:var(--bg);color:var(--fg)">
              <option value="none">Does not repeat</option>
              <option value="daily">Daily</option>
              <option value="weekly">Weekly</option>
              <option value="monthly">Monthly</option>
              <option value="yearly">Yearly</option>
            </select>
          </div>
          <div class="modal-actions">
            <button class="btn" id="sdFormCancel">Cancel</button>
            <button class="btn btn-primary" id="sdFormSubmit">Create</button>
          </div>
        </div>
      </div>`;

      modalRootEl.querySelector('.modal-overlay').onclick = e => { if (e.target === e.currentTarget) close(); };
      document.getElementById('sdFormCancel').onclick = close;

      let isCreatingEvent = false;
      const submitBtn = document.getElementById('sdFormSubmit');

      submitBtn.onclick = () => {
        if (isCreatingEvent) return;

        const tVal = document.getElementById('sdFormTitle').value.trim() || 'Untitled Event';
        const sD = document.getElementById('sdFormStartDate').value;
        const sT = document.getElementById('sdFormStartTime').value;
        const eD = document.getElementById('sdFormEndDate').value || sD;
        const eT = document.getElementById('sdFormEndTime').value || sT;
        const typeVal = document.getElementById('sdFormType').value;
        const descVal = document.getElementById('sdFormDesc').value.trim();
        const notifyVal = document.getElementById('sdFormNotify').checked;
        const repeatVal = document.getElementById('sdFormRepeat').value;

        if (!sD || !sT) { if (typeof toast === 'function') toast('Please provide both start date and time.'); return; }

        const startTs = new Date(`${sD}T${sT}:00`).getTime();
        const endTs = new Date(`${eD}T${eT}:00`).getTime();

        if (!Number.isFinite(startTs) || !Number.isFinite(endTs)) { if (typeof toast === 'function') toast('Invalid date or time.'); return; }
        if (endTs < startTs) { if (typeof toast === 'function') toast('Event end must be after its start.'); return; }

        const canonicalNotes = getCanonicalNotesArray();
        if (!canonicalNotes) { if (typeof toast === 'function') toast('Cannot access notes storage.'); return; }

        isCreatingEvent = true;
        submitBtn.disabled = true;

        let tags = ['calendar'];
        if (typeVal === 'meeting') tags.push('meeting');
        if (typeVal === 'deadline') tags.push('deadline');
        if (repeatVal !== 'none') { tags.push('recurring'); tags.push('repeat-' + repeatVal); }

        const startFmt = new Date(startTs).toLocaleString(undefined, { weekday: 'short', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
        const endFmt = new Date(endTs).toLocaleString(undefined, { weekday: 'short', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
        const safeDesc = escHtml(descVal);

        let htmlStr = `<p><strong>📅 ${escHtml(startFmt)}</strong></p><p>→ ${escHtml(endFmt)}</p>`;
        if (repeatVal !== 'none') htmlStr += `<p>🔁 Repeats: ${escHtml(repeatVal)}</p>`;
        if (safeDesc) htmlStr += `<p>${safeDesc}</p>`;
        const content_html = (typeof window.sanitizeNoteHTML === 'function') ? window.sanitizeNoteHTML(htmlStr) : htmlStr;

        const newId = typeof window.uid === 'function' ? window.uid() : Date.now().toString();
        const n = {
          id: newId, title: tVal, content: content_html, tags,
          pinned: false, archived: false,
          createdAt: Date.now(), updatedAt: Date.now(), fontStyle: 'sans',
          calendarStart: startTs, calendarEnd: endTs,
          calendarRepeat: repeatVal === 'none' ? null : repeatVal,
          calendarNotify: notifyVal, calendarLastNotifiedAt: null,
          calendarDescription: descVal
        };

        // Capture clean HTML (no suggestion spans) before inserting into canonical store
        const originalBlockHTML = getCleanBlockHTML(block);

        const linkId = typeof window.uid === 'function' ? window.uid() : (Date.now() + 1).toString();
        const linkObj = {
          id: linkId,
          eventId: newId,
          rawText,
          originalBlockText,
          originalBlockHTML,
          originalBlockTag,
          startOffset: spanStartOffset,
          endOffset: spanEndOffset,
          contextBefore,
          contextAfter,
          createdAt: Date.now(),
          updatedAt: Date.now()
        };

        // Step 1: insert into canonical notes array
        canonicalNotes.unshift(n);

        Promise.resolve().then(async () => {
          // Step 2: persist link metadata (does NOT call save() internally)
          await window.saveSmartDateLink(linkObj);

          // Step 3: canonical save — exactly once
          if (typeof window.save !== 'function') throw new Error('Canonical save() is unavailable');
          window.save();

        }).then(async () => {
          // Step 4: side effects
          if (notifyVal && typeof window.scheduleEventNotification === 'function') window.scheduleEventNotification(n);
          if (typeof window.addNotification === 'function') {
            window.addNotification({ type: 'calendar', title: 'Event Created: ' + tVal, body: startFmt, icon: 'calendar', activity: true });
          }
          if (typeof window.renderCalendarView === 'function') window.renderCalendarView();
          if (typeof window.renderAll === 'function') window.renderAll();

          // Step 5: rehydrate the schedule line
          unwrapSpan(span);
          const links = await window.getSmartDateLinksForActiveLeaf();
          window.scanSmartDatesInBlock(block, new Date(), links);

          if (typeof toast === 'function') toast('Event created successfully.');
          close();

        }).catch(async err => {
          console.error('Smart Dates: failed to save event:', err);

          // Rollback: remove exact event from canonical notes by newId
          const arr = getCanonicalNotesArray();
          if (arr) {
            const idx = arr.findIndex(xn => String(xn.id) === String(newId));
            if (idx > -1) arr.splice(idx, 1);
          }

          // Rollback: remove link by eventId if it was persisted
          try { await window.removeSmartDateLink(newId); } catch (_) {}

          isCreatingEvent = false;
          submitBtn.disabled = false;
          if (typeof toast === 'function') toast('Failed to save event. Please try again.');
        });
      };
    };

    renderConfirmation();
  }

  // =========================================================================
  // SCHEDULE LINE ACTIONS
  // =========================================================================

  window.handleSmartDateAction = async function(e, action, eventId) {
    e.preventDefault();
    e.stopPropagation();

    if (action === 'open' || action === 'edit') {
      if (action === 'edit') window._sdPendingRefresh = true;
      if (typeof window.openCalendarEventEditor === 'function') window.openCalendarEventEditor(eventId);

    } else if (action === 'unlink' || action === 'remove') {
      await window.removeSmartDateLink(eventId);
      const schedule = e.target.closest('.smart-date-linked-schedule');
      if (schedule) {
        if (schedule.dataset.sdHiddenLi === 'true') {
          schedule.remove();
          document.querySelectorAll('.smart-date-hidden-li').forEach(li => {
            li.classList.remove('smart-date-hidden-li');
            li.style.display = '';
            window.scanSmartDatesInBlock(li, new Date(), []);
          });
        } else {
          const html = schedule.dataset.sdOriginalHtml;
          const tag = schedule.dataset.sdOriginalTag || 'P';
          const restored = document.createElement(tag);
          restored.innerHTML = html;
          schedule.replaceWith(restored);
          window.scanSmartDatesInBlock(restored, new Date(), []);
        }
      }
      if (typeof toast === 'function') toast('Link removed.');

    } else if (action === 'delete') {
      if (typeof window.deleteCalendarSource === 'function') {
        window.deleteCalendarSource(eventId);
        const schedule = e.target.closest('.smart-date-linked-schedule');
        if (schedule) {
          const parent = schedule.parentNode;
          window.dehydrateSmartDateSuggestions(parent);
          const links = await window.getSmartDateLinksForActiveLeaf();
          parent.querySelectorAll('p, div, li, h1, h2, h3, h4, h5, h6, blockquote')
            .forEach(b => window.scanSmartDatesInBlock(b, new Date(), links));
        }
      }
    }
  };

  // =========================================================================
  // MODAL CLOSE OBSERVER (Gate 6: re-hydrate after event edit)
  // =========================================================================

  function attachModalCloseObserver() {
    const modalRoot = document.getElementById('modalRoot');
    if (!modalRoot) return;
    const obs = new MutationObserver(() => {
      if (modalRoot.children.length === 0 && window._sdPendingRefresh) {
        window._sdPendingRefresh = false;
        const noteBody = document.getElementById('noteBody');
        if (noteBody) window.hydrateSmartDateSuggestions(noteBody, new Date());
      }
    });
    obs.observe(modalRoot, { childList: true });
  }

  // =========================================================================
  // DELEGATED EVENT LISTENERS
  // =========================================================================

  let listenerAttached = false;
  function attachDelegatedListeners() {
    if (listenerAttached) return;
    listenerAttached = true;

    document.body.addEventListener('click', (e) => {
      const span = e.target.closest('.smart-date-suggestion');
      if (span) { e.preventDefault(); e.stopPropagation(); openSmartDateModal(span); return; }
      const schedule = e.target.closest('.smart-date-linked-schedule');
      if (schedule && !e.target.closest('.smart-date-action-btn')) {
        document.querySelectorAll('.smart-date-linked-schedule').forEach(el => el.classList.remove('active-tap'));
        schedule.classList.add('active-tap');
      }
    }, true);

    document.body.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        const span = e.target.closest('.smart-date-suggestion');
        if (!span) return;
        e.preventDefault();
        openSmartDateModal(span);
      }
    }, true);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      attachDelegatedListeners();
      attachModalCloseObserver();
    });
  } else {
    attachDelegatedListeners();
    attachModalCloseObserver();
  }

})();
