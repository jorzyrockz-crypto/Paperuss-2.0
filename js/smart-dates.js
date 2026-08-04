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

  window.scanSmartDatesInBlock = function(block, contextDate) {
    if (!block || !block.textContent) return;
    
    // Do not scan inside existing suggestions, productivity blocks, embeds, pre/code
    if (block.closest('.smart-date-suggestion, .productivity-ref, [data-embed], pre, code, [contenteditable="false"]')) return;
    
    // Clear old suggestions in this block by unwrapping
    const oldSpans = block.querySelectorAll('.smart-date-suggestion');
    oldSpans.forEach(span => {
      while (span.firstChild) span.parentNode.insertBefore(span.firstChild, span);
      span.remove();
    });
    
    // Normalize text nodes after unwrapping
    block.normalize();
    
    const text = block.textContent;
    const matches = window.parseSmartDatePhrase(text, contextDate);
    if (!matches.length) return;
    
    const caret = getCaretOffsets(block);
    
    // Text nodes array mapping
    let textNodes = [];
    let currentIndex = 0;
    
    function buildTextNodes(node) {
      if (node.nodeType === 3) {
        textNodes.push({ node, start: currentIndex, end: currentIndex + node.length });
        currentIndex += node.length;
      } else {
        // Skip links, code, embeds, non-editable areas
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
    
    // Only apply valid matches
    let offsetAdjustment = 0; // if we mutate DOM, indices might drift, but we do it backwards or just recreate block
    // Actually, modifying text nodes is simpler backwards
    matches.reverse().forEach(m => {
      // Caret protection
      if (caret) {
        let overlap = Math.max(0, Math.min(caret.end, m.endIndex) - Math.max(caret.start, m.startIndex));
        if (overlap > 0 || caret.start === m.endIndex || caret.end === m.endIndex) {
          return;
        }
      }
      
      // Find the text node that fully contains this match
      let containingNodeObj = textNodes.find(n => m.startIndex >= n.start && m.endIndex <= n.end);
      if (!containingNodeObj) return; // Crosses boundaries, skip
      
      let node = containingNodeObj.node;
      let localStart = m.startIndex - containingNodeObj.start;
      let localEnd = m.endIndex - containingNodeObj.start;
      
      let beforeText = node.textContent.slice(0, localStart);
      let matchText = node.textContent.slice(localStart, localEnd);
      let afterText = node.textContent.slice(localEnd);
      
      let parent = node.parentNode;
      
      let span = document.createElement('span');
      span.className = 'smart-date-suggestion';
      span.setAttribute('data-paperuss-smart-date', 'true');
      span.setAttribute('contenteditable', 'false');
      span.setAttribute('tabindex', '0');
      span.setAttribute('role', 'button');
      span.setAttribute('aria-label', `Detected date: ${matchText}`);
      span.textContent = matchText;
      
      if (beforeText) parent.insertBefore(document.createTextNode(beforeText), node);
      parent.insertBefore(span, node);
      if (afterText) parent.insertBefore(document.createTextNode(afterText), node);
      
      node.remove();
    });
    
    if (caret) {
      try {
        setCaretOffsets(block, caret.start, caret.end);
      } catch (e) {
        console.warn('Smart dates caret restore failed', e);
      }
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

  function safeScan() {
    if (isComposing) return;
    if (!scheduledBlock || !scheduledRoot) return;
    if (!document.contains(scheduledRoot)) return;
    if (!document.contains(scheduledBlock)) return;
    if (!scheduledRoot.contains(scheduledBlock)) return;
    
    const activeEditor = document.getElementById('noteBody');
    if (activeEditor && scheduledRoot !== activeEditor) return;
    
    window.scanSmartDatesInBlock(scheduledBlock, scheduledContextDate || new Date());
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
    if (scheduledBlock && scheduledRoot) {
      clearTimeout(scanTimer);
      scanTimer = setTimeout(safeScan, 500);
    }
  });

  window.hydrateSmartDateSuggestions = function(root, contextDate) {
    if (!root) return;
    const cd = contextDate || new Date();
    
    const executeHydration = () => {
      if (!root.isConnected) return;
      const activeEditor = document.getElementById('noteBody');
      if (activeEditor && root !== activeEditor) return;
      
      const blocks = root.querySelectorAll('p, div, li, h1, h2, h3, h4, h5, h6, blockquote');
      blocks.forEach(block => {
        if (!block.isConnected) return;
        if (!root.contains(block)) return;
        window.scanSmartDatesInBlock(block, cd);
      });
    };

    if (window.requestIdleCallback) {
      window.requestIdleCallback(executeHydration);
    } else {
      setTimeout(executeHydration, 500);
    }
  };

  window.dehydrateSmartDateSuggestions = function(root) {
    if (!root) return;
    const spans = root.querySelectorAll('.smart-date-suggestion');
    spans.forEach(span => {
      const parent = span.parentNode;
      if (!parent) return;
      while (span.firstChild) {
        parent.insertBefore(span.firstChild, span);
      }
      span.remove();
      parent.normalize();
    });
  };

  window.clearSmartDateSuggestions = window.dehydrateSmartDateSuggestions;

  // Single delegated root listener logic
  let listenerAttached = false;
  
  function attachDelegatedListeners() {
    if (listenerAttached) return;
    listenerAttached = true;
    
    const clickHandler = (e) => {
      const span = e.target.closest('.smart-date-suggestion');
      if (!span) return;
      e.preventDefault();
      e.stopPropagation();
      if(typeof toast === 'function') toast('Date detected. Calendar creation will be added next.');
    };
    
    const keyHandler = (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        const span = e.target.closest('.smart-date-suggestion');
        if (!span) return;
        e.preventDefault();
        if(typeof toast === 'function') toast('Date detected. Calendar creation will be added next.');
      }
    };
    
    // We attach to document.body, avoiding duplicate attachments per Leaf switch
    document.body.addEventListener('click', clickHandler, true);
    document.body.addEventListener('keydown', keyHandler, true);
  }

  // Hook into generic leaf loading if we need to, but it's safer to just attach once on script load
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', attachDelegatedListeners);
  } else {
    attachDelegatedListeners();
  }

})();
