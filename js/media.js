let savedEditorRange = null;

function saveCurrentEditorRange(){
  const ed=document.getElementById('noteBody');
  const sel=window.getSelection();
  if(sel && sel.rangeCount > 0 && ed && ed.contains(sel.anchorNode)){
    try{ savedEditorRange = sel.getRangeAt(0).cloneRange(); }catch(_){}
  }
}

document.addEventListener('selectionchange', ()=>{
  const ed=document.getElementById('noteBody');
  if(document.activeElement===ed || (ed && ed.contains(document.activeElement))){
    saveCurrentEditorRange();
  }
});

function openLinkInAppOrTab(url){
  if(!url || (typeof paperussSafeUrl==='function' && !paperussSafeUrl(url,'href','A'))) return;
  // Allow OS deep-linking / registered app protocol handlers to launch directly
  const a=document.createElement('a');
  a.href=url;
  a.rel='noopener';
  a.click();
}

function insertHTMLAtCaret(html){
  const ed=document.getElementById('noteBody');
  if(!ed) return;
  ed.focus();
  const sel=window.getSelection();
  let range=null;

  if(savedEditorRange && ed.contains(savedEditorRange.commonAncestorContainer)){
    range=savedEditorRange.cloneRange();
  } else if(sel && sel.rangeCount && ed.contains(sel.anchorNode)){
    range=sel.getRangeAt(0);
  }

  if(!range){
    range=document.createRange();
    range.selectNodeContents(ed);
    range.collapse(false);
  } else {
    if(!range.collapsed) range.deleteContents();
  }

  const tmp=document.createElement('div'); tmp.innerHTML=html;
  const frag=document.createDocumentFragment();
  let last;
  while(tmp.firstChild){ last=tmp.firstChild; frag.appendChild(last); }
  range.insertNode(frag);

  // Insert an inline text spacer (\u200B ) after inserted card to preserve inline flow
  if(last && last.parentNode){
    const spacer = document.createTextNode('\u200B ');
    last.parentNode.insertBefore(spacer, last.nextSibling);
    try {
      const r = document.createRange();
      r.setStart(spacer, spacer.nodeValue.length);
      r.collapse(true);
      if (sel) {
        sel.removeAllRanges();
        sel.addRange(r);
      }
      savedEditorRange = r.cloneRange();
    } catch (_) {}
  }
  if (typeof handleBodyInput === 'function') handleBodyInput();
  if (typeof save === 'function') save();
}


/* Downscale and compress high-resolution photos for 95%+ faster cloud uploading & lower memory footprint */
function estimateBase64Bytes(dataUrl) {
  const commaIdx = dataUrl.indexOf(',');
  if(commaIdx === -1) return dataUrl.length;
  return Math.round((dataUrl.length - commaIdx - 1) * 0.75);
}

function dataUrlToBlob(dataUrl, fileName = 'photo.jpg') {
  const arr = dataUrl.split(',');
  const mime = (arr[0].match(/:(.*?);/) || [])[1] || 'image/jpeg';
  const bstr = atob(arr[1]);
  let n = bstr.length;
  const u8arr = new Uint8Array(n);
  while(n--){
    u8arr[n] = bstr.charCodeAt(n);
  }
  return new File([u8arr], fileName, { type: mime, lastModified: Date.now() });
}

function downscaleImageBlob(blobOrFile, maxDimension = 1920, targetMaxBytes = 250 * 1024){
  if(!blobOrFile || !(blobOrFile instanceof Blob)) return Promise.resolve(blobOrFile);
  const type = blobOrFile.type || '';
  if(!type.startsWith('image/') || type.includes('gif') || type.includes('svg')){
    return Promise.resolve(blobOrFile);
  }
  if(blobOrFile.size <= targetMaxBytes){
    return Promise.resolve(blobOrFile);
  }

  return new Promise(resolve => {
    const url = URL.createObjectURL(blobOrFile);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      let w = img.naturalWidth || img.width;
      let h = img.naturalHeight || img.height;
      
      const isPng = type === 'image/png';
      // Convert large PNGs (> 500 KB) to JPEG so lossy compression reduces file size effectively
      const outputType = (isPng && blobOrFile.size < 500 * 1024) ? 'image/png' : 'image/jpeg';
      let currentQuality = 0.85;

      if(w > maxDimension || h > maxDimension){
        if(w > h){
          h = Math.round((h * maxDimension) / w);
          w = maxDimension;
        } else {
          w = Math.round((w * maxDimension) / h);
          h = maxDimension;
        }
      }

      let bestDataUrl = null;
      let canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      let ctx = canvas.getContext('2d');
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(img, 0, 0, w, h);

      // Multi-pass compression loop (up to 8 passes)
      for(let attempt = 0; attempt < 8; attempt++){
        const dataUrl = canvas.toDataURL(outputType, currentQuality);
        const estBytes = estimateBase64Bytes(dataUrl);
        bestDataUrl = dataUrl;

        // Stop once image size falls under targetMaxBytes (250 KB)
        if(estBytes <= targetMaxBytes) break;

        // Reduce quality first down to 0.40, then downscale canvas dimensions by 15%
        if(outputType === 'image/png' || currentQuality <= 0.40){
          w = Math.max(100, Math.round(w * 0.85));
          h = Math.max(100, Math.round(h * 0.85));
          canvas.width = w;
          canvas.height = h;
          ctx = canvas.getContext('2d');
          ctx.imageSmoothingEnabled = true;
          ctx.imageSmoothingQuality = 'high';
          ctx.drawImage(img, 0, 0, w, h);
        } else {
          currentQuality = Math.max(0.40, currentQuality - 0.12);
        }
      }

      if(bestDataUrl){
        const optFile = dataUrlToBlob(bestDataUrl, blobOrFile.name || 'photo.jpg');
        if(optFile.size < blobOrFile.size){
          console.log(`PapeRuss: Multi-pass compressed photo from ${formatBytes(blobOrFile.size)} to ${formatBytes(optFile.size)} (${w}x${h})`);
          resolve(optFile);
          return;
        }
      }
      resolve(blobOrFile);
    };

    img.onerror = () => {
      URL.revokeObjectURL(url);
      resolve(blobOrFile);
    };

    img.src = url;
  });
}

async function insertImageFile(file){
  if(!file || !file.type.startsWith('image/')){ toast('Not an image'); return; }
  const id = (typeof mediaUid === 'function') ? mediaUid() : ('m_' + Date.now().toString(36));
  const tempUrl = URL.createObjectURL(file);
  const defSize = (typeof IMG_DEFAULT_SIZE==='object' && typeof deviceClass==='function')
    ? IMG_DEFAULT_SIZE[deviceClass()] : 'large';

  // 1. Show image INSTANTLY in the editor with valid data-media-id from 0ms
  insertHTMLAtCaret(`<img data-media-id="${id}" data-media-kind="image" data-img-size="${defSize}" src="${tempUrl}" alt="${esc(file.name)}">`);

  // 2. Downscale + save to IndexedDB + queue cloud sync (runs in background)
  try {
    let targetId = id;
    try {
      const realId = await saveMediaBlob(file, file.name, 'image', id);
      if (realId) targetId = realId;
    } catch(dbErr) {
      console.warn('PapeRuss: IndexedDB blob store fallback', dbErr);
    }

    if(targetId && targetId !== id){
      // SHA-256 de-duplication matched an existing blob ID
      const imgEl = document.querySelector(`img[data-media-id="${id}"]`);
      if(imgEl) imgEl.setAttribute('data-media-id', targetId);
    }

    let dbUrl = null;
    try { dbUrl = await getMediaURL(targetId); } catch(_) {}
    const finalUrl = dbUrl || tempUrl;

    if(typeof urlCache !== 'undefined') urlCache.set(targetId, finalUrl);
    const imgEl = document.querySelector(`img[data-media-id="${targetId}"], img[data-media-id="${id}"]`);
    if(imgEl){
      imgEl.src = finalUrl;
    }
    save();
    toast('Image added');
    if(typeof renderStorageStats==='function') renderStorageStats();
  } catch(err){
    console.error('PapeRuss: image insert fallback', err);
    if(typeof urlCache !== 'undefined') urlCache.set(id, tempUrl);
    save();
    toast('Image added');
  }
}


function renderVideoCardHTML(opts = {}) {
  const {
    id = '',
    url = '',
    name = 'Video Attachment',
    size = 0,
    ext = 'MP4',
    displayMode = 'preview',
    widthPreset = 'medium'
  } = opts;

  const fileSizeMeta = (size > 0 && typeof formatFileSize === 'function') ? formatFileSize(size) : (typeof formatBytes === 'function' ? formatBytes(size) : 'Video File');
  let innerCardContent = '';

  if (displayMode === 'compact') {
    innerCardContent = `
      <div class="embed-compact-card video-compact-card">
        <div class="embed-compact-hero video-compact-hero">
          <span class="embed-compact-icon video-compact-icon">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="23 7 16 12 23 17 23 7"/><rect x="1" y="5" width="15" height="14" rx="2" ry="2"/></svg>
          </span>
        </div>
        <div class="embed-compact-info video-compact-info">
          <strong contenteditable="true" data-action="inline-edit-title" title="Click to edit title">${esc(name)}</strong>
          <span>🎬 ${esc(ext)} Video · ${esc(fileSizeMeta)}</span>
        </div>
        <div class="video-compact-actions">
          <button type="button" class="btn-video-download" data-mc-download="${id}" data-mc-name="${esc(name)}" title="Download Video">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
          </button>
        </div>
      </div>`;
  } else {
    // Dedicated Cinematic 16:9 Cinema Widescreen Player
    innerCardContent = `
      <div class="embed-canonical-card video-canonical-card">
        <div class="video-hero-cinema">
          <video class="video-native-player" controls preload="metadata" data-media-id="${id}" data-media-kind="video" src="${url}"></video>
        </div>

        <div class="video-action-bar">
          <div class="video-meta-left">
            <strong contenteditable="true" data-action="inline-edit-title" class="video-card-title" title="Click to edit title">${esc(name)}</strong>
            <span class="video-card-sub">${esc(ext)} Video Attachment · ${esc(fileSizeMeta)}</span>
          </div>
          <div class="video-actions-right">
            <button type="button" class="btn-video-cinema-download" data-mc-download="${id}" data-mc-name="${esc(name)}" title="Download Video">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
              <span>Download ${esc(ext)}</span>
            </button>
          </div>
        </div>
      </div>`;
  }

  return `<div class="paperuss-card paperuss-card-video embed-mode-${displayMode} embed-width-${widthPreset} card-width-${widthPreset}" ` +
    `contenteditable="false" draggable="true" ` +
    `data-media-id="${id}" ` +
    `data-media-kind="video" ` +
    `data-display-mode="${displayMode}" ` +
    `data-width-preset="${widthPreset}" ` +
    `data-drop-block="1">` +
    `${innerCardContent}` +
    `<div class="card-resize-handle" title="Drag to resize card"></div>` +
    `</div>`;
}

async function insertVideoFile(file){
  if(!file || !file.type.startsWith('video/')){ toast('Not a video file'); return; }
  const id = (typeof mediaUid === 'function') ? mediaUid() : ('m_' + Date.now().toString(36));
  const tempUrl = URL.createObjectURL(file);
  const ext = (file.name||'').split('.').pop().toUpperCase() || 'MP4';

  const html = renderVideoCardHTML({
    id,
    url: tempUrl,
    name: file.name,
    size: file.size,
    ext,
    displayMode: 'preview',
    widthPreset: 'medium'
  });

  insertHTMLAtCaret(html);
  save();
  toast('Video card added');

  try {
    const realId = await saveMediaBlob(file, file.name, 'video', id);
    if(realId && realId !== id){
      document.querySelectorAll(`[data-media-id="${id}"]`).forEach(el => el.setAttribute('data-media-id', realId));
    }
  } catch(err) { console.warn('PapeRuss: Video store fallback', err); }
  renderStorageStats();
  if (typeof hydrateVideoCards === 'function') hydrateVideoCards();
  if (typeof reflowCardGridRows === 'function') reflowCardGridRows();
}

function buildSoundCardEditorToolbar(card) {
  if (!card) return null;
  const bar = document.createElement('div');
  bar.className = 'embed-editor-toolbar audio-editor-toolbar';
  bar.setAttribute('contenteditable', 'false');

  const displayMode = card.getAttribute('data-display-mode') || 'preview';
  const widthPreset = card.getAttribute('data-width-preset') || 'medium';
  const currentWrap = card.getAttribute('data-card-wrap') || 'none';

  const sizeLabels = { 'small': 'S', 'medium': 'M', 'large': 'L', 'full': '⬛' };
  const activeSizeLabel = sizeLabels[widthPreset] || 'M';
  const modeIcons = { 'compact': 'align-justify', 'preview': 'image' };
  const activeModeIcon = modeIcons[displayMode] || 'image';

  const wrapIcons = { 'none': 'rows-2', 'left': 'panel-left', 'right': 'panel-right', 'inline': 'move-horizontal' };
  const activeWrapIcon = 'wrap-text';

  bar.innerHTML = `
    <div class="embed-tb-segment" style="position:relative">
      <button type="button" class="embed-tb-btn" data-action="toggle-size-menu" title="Card Size">
        <i data-lucide="scaling" class="w-4 h-4"></i>
      </button>
      <div class="embed-tb-dropdown embed-size-dropdown hidden" contenteditable="false" style="top:calc(100% + 4px);bottom:auto;">
        <button type="button" class="embed-tb-dropdown-item ${widthPreset === 'small' ? 'active' : ''}" data-action="set-width" data-val="small">
          <span class="embed-sz-badge">S</span> Small (320px)
        </button>
        <button type="button" class="embed-tb-dropdown-item ${widthPreset === 'medium' ? 'active' : ''}" data-action="set-width" data-val="medium">
          <span class="embed-sz-badge">M</span> Medium (480px)
        </button>
        <button type="button" class="embed-tb-dropdown-item ${widthPreset === 'large' ? 'active' : ''}" data-action="set-width" data-val="large">
          <span class="embed-sz-badge">L</span> Large (680px)
        </button>
        <button type="button" class="embed-tb-dropdown-item ${widthPreset === 'full' ? 'active' : ''}" data-action="set-width" data-val="full">
          <span class="embed-sz-badge">⬛</span> Full Width (100%)
        </button>
      </div>
    </div>
    <div class="embed-tb-segment" style="position:relative">
      <button type="button" class="embed-tb-btn" data-action="toggle-wrap-menu" title="Wrap Text Mode">
        <i data-lucide="${activeWrapIcon}" class="w-4 h-4 embed-wrap-icon"></i>
      </button>
      <div class="embed-tb-dropdown embed-wrap-dropdown hidden" contenteditable="false" style="top:calc(100% + 4px);bottom:auto;">
        <button type="button" class="embed-tb-dropdown-item ${currentWrap === 'none' ? 'active' : ''}" data-action="set-wrap" data-val="none">
          <i data-lucide="rows-2" class="w-4 h-4"></i> Break Text (No Wrap)
        </button>
        <button type="button" class="embed-tb-dropdown-item ${currentWrap === 'left' ? 'active' : ''}" data-action="set-wrap" data-val="left">
          <i data-lucide="panel-left" class="w-4 h-4"></i> Wrap Text Right (Float Left)
        </button>
        <button type="button" class="embed-tb-dropdown-item ${currentWrap === 'right' ? 'active' : ''}" data-action="set-wrap" data-val="right">
          <i data-lucide="panel-right" class="w-4 h-4"></i> Wrap Text Left (Float Right)
        </button>
        <button type="button" class="embed-tb-dropdown-item ${currentWrap === 'inline' ? 'active' : ''}" data-action="set-wrap" data-val="inline">
          <i data-lucide="move-horizontal" class="w-4 h-4"></i> Inline with Text
        </button>
      </div>
    </div>
    <div class="embed-tb-segment" style="position:relative">
      <button type="button" class="embed-tb-btn" data-action="toggle-mode-menu" title="Display Mode">
        <i data-lucide="${activeModeIcon}" class="w-4 h-4 embed-mode-icon"></i>
      </button>
      <div class="embed-tb-dropdown embed-mode-dropdown hidden" contenteditable="false" style="top:calc(100% + 4px);bottom:auto;">
        <button type="button" class="embed-tb-dropdown-item ${displayMode === 'compact' ? 'active' : ''}" data-action="set-mode" data-val="compact">
          <i data-lucide="align-justify" class="w-4 h-4"></i> Compact Card
        </button>
        <button type="button" class="embed-tb-dropdown-item ${displayMode === 'preview' ? 'active' : ''}" data-action="set-mode" data-val="preview">
          <i data-lucide="image" class="w-4 h-4"></i> Rich Preview Card
        </button>
      </div>
    </div>
    <div class="embed-tb-segment">
      <button type="button" class="embed-tb-btn" data-action="open-media-info" title="Asset Info & Specs">
        <i data-lucide="info" class="w-4 h-4"></i>
      </button>
      <button type="button" class="embed-tb-btn" data-action="toggle-play" title="Play / Pause Audio">
        <i data-lucide="play" class="w-4 h-4 audio-tb-play-icon"></i>
      </button>
      <button type="button" class="embed-tb-btn" data-action="download" title="Download Audio File">
        <i data-lucide="download" class="w-4 h-4"></i>
      </button>
      <button type="button" class="embed-tb-btn embed-tb-btn-danger" data-action="remove" title="Delete Audio Card">
        <i data-lucide="trash-2" class="w-4 h-4"></i>
      </button>
    </div>
  `;

  setTimeout(() => {
    if (typeof lucide?.createIcons === 'function') lucide.createIcons();
  }, 0);

  const closeAllDropdowns = () => {
    bar.querySelectorAll('.embed-tb-dropdown').forEach(m => m.classList.add('hidden'));
  };

  bar.addEventListener('mousedown', e => e.stopPropagation());

  bar.addEventListener('click', (e) => {
    e.stopPropagation();
    e.preventDefault();
    const btn = e.target.closest('button[data-action]');
    if (!btn) return;
    const act = btn.getAttribute('data-action');
    const val = btn.getAttribute('data-val');

    if (act === 'toggle-size-menu') {
      const menu = bar.querySelector('.embed-size-dropdown');
      const wasHidden = menu.classList.contains('hidden');
      closeAllDropdowns();
      if (wasHidden) menu.classList.remove('hidden');

    } else if (act === 'toggle-wrap-menu') {
      const menu = bar.querySelector('.embed-wrap-dropdown');
      const wasHidden = menu.classList.contains('hidden');
      closeAllDropdowns();
      if (wasHidden) menu.classList.remove('hidden');

    } else if (act === 'set-wrap') {
      closeAllDropdowns();
      card.setAttribute('data-card-wrap', val);
      bar.querySelectorAll('.embed-wrap-dropdown .embed-tb-dropdown-item').forEach(b => {
        b.classList.toggle('active', b.getAttribute('data-val') === val);
      });
      if (typeof handleBodyInput === 'function') handleBodyInput();
      if (typeof save === 'function') save();

    } else if (act === 'toggle-mode-menu') {
      const menu = bar.querySelector('.embed-mode-dropdown');
      const wasHidden = menu.classList.contains('hidden');
      closeAllDropdowns();
      if (wasHidden) menu.classList.remove('hidden');

    } else if (act === 'set-width') {
      closeAllDropdowns();
      // Apply width preset directly — inline implementation
      const currentMode = card.getAttribute('data-display-mode') || 'preview';
      card.setAttribute('data-width-preset', val);
      // Update class list preserving all other classes
      const base = `paperuss-card paperuss-card-audio embed-mode-${currentMode} embed-width-${val} card-width-${val}`;
      card.className = base;
      // Rebuild toolbar fresh with updated active state
      hydrateSoundCards(card);
      if (typeof handleBodyInput === 'function') handleBodyInput();
      if (typeof save === 'function') save();

    } else if (act === 'set-mode') {
      closeAllDropdowns();
      if (typeof setSoundCardDisplayMode === 'function') {
        setSoundCardDisplayMode(card, val);
      } else {
        card.setAttribute('data-display-mode', val);
        const currentWidth = card.getAttribute('data-width-preset') || 'medium';
        const mediaId = card.getAttribute('data-media-id') || '';
        const audio = card.querySelector('.audio-native-player');
        const url = audio ? audio.getAttribute('src') : '';
        const title = card.querySelector('.card-title-text, .embed-compact-title, strong')?.textContent || 'Voice recording';
        
        if (typeof renderSoundCardHTML === 'function') {
          const newHTML = renderSoundCardHTML(mediaId, title, 'audio/webm', 0, url, val, currentWidth);
          const temp = document.createElement('div');
          temp.innerHTML = newHTML;
          if (temp.firstElementChild) {
            card.innerHTML = temp.firstElementChild.innerHTML;
          }
        }
        card.className = `paperuss-card paperuss-card-audio embed-mode-${val} embed-width-${currentWidth} card-width-${currentWidth}`;
        hydrateSoundCards(card);
        if (typeof handleBodyInput === 'function') handleBodyInput();
        if (typeof save === 'function') save();
      }

    } else if (act === 'toggle-play') {
      const audio = card.querySelector('.audio-native-player');
      if (!audio) return;
      if (audio.paused) {
        audio.play().catch(_ => {});
        const playIcon = bar.querySelector('.audio-tb-play-icon');
        if (playIcon) playIcon.setAttribute('data-lucide', 'pause');
        if (typeof lucide?.createIcons === 'function') lucide.createIcons();
      } else {
        audio.pause();
        const playIcon = bar.querySelector('.audio-tb-play-icon');
        if (playIcon) playIcon.setAttribute('data-lucide', 'play');
        if (typeof lucide?.createIcons === 'function') lucide.createIcons();
      }

    } else if (act === 'download') {
      // Inline download logic — no external function dependency
      const mediaId = card.getAttribute('data-media-id');
      const audioEl = card.querySelector('.audio-native-player');
      const src = audioEl ? audioEl.src : '';
      if (mediaId && typeof mediaGet === 'function') {
        mediaGet(mediaId).then(rec => {
          if (rec && rec.blob) {
            const url = URL.createObjectURL(rec.blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = rec.name || 'audio.webm';
            a.click();
            setTimeout(() => URL.revokeObjectURL(url), 1000);
          } else if (src) {
            const a = document.createElement('a');
            a.href = src;
            a.download = 'audio.webm';
            a.click();
          } else {
            if (typeof toast === 'function') toast('File not available for download');
          }
        });
      } else if (src) {
        const a = document.createElement('a');
        a.href = src;
        a.download = 'audio.webm';
        a.click();
      }

    } else if (act === 'remove') {
      card.remove();
      if (typeof handleBodyInput === 'function') handleBodyInput();
      if (typeof toast === 'function') toast('Sound Card removed');
    }
  });

  // Close dropdowns when clicking outside the toolbar
  const outsideHandler = (e) => {
    if (!bar.contains(e.target)) {
      closeAllDropdowns();
    }
  };
  document.addEventListener('click', outsideHandler, { passive: true });

  return bar;
}

function hydrateSoundCards(rootElementOrCard = document) {
  // Accept either a single .paperuss-card-audio element or a root container
  let cards;
  if (rootElementOrCard && rootElementOrCard.classList?.contains('paperuss-card-audio')) {
    cards = [rootElementOrCard];
  } else {
    cards = (rootElementOrCard || document).querySelectorAll('.paperuss-card-audio');
  }
  cards.forEach(card => {
    // Restore SVGs stripped by sanitizeNoteHTML during save cycle
    const compactHeroIcon = card.querySelector('.embed-compact-hero-icon');
    if (compactHeroIcon && !compactHeroIcon.querySelector('svg')) {
      compactHeroIcon.innerHTML = `<svg width="18" height="18" viewBox="0 0 24 24" fill="var(--accent)"><polygon points="6,4 20,12 6,20"/></svg>`;
    }
    const compactPlayBtn = card.querySelector('.audio-compact-play-btn');
    if (compactPlayBtn && !compactPlayBtn.querySelector('svg')) {
      compactPlayBtn.innerHTML = `<svg class="audio-play-icon" width="16" height="16" viewBox="0 0 24 24" fill="var(--accent)"><polygon points="6,4 20,12 6,20"/></svg><svg class="audio-pause-icon hidden" width="16" height="16" viewBox="0 0 24 24" fill="var(--accent)"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg>`;
    }
    const cardTypeIcon = card.querySelector('.card-type-icon');
    if (cardTypeIcon && !cardTypeIcon.querySelector('svg')) {
      cardTypeIcon.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg>`;
    }
    const largePlayBtn = card.querySelector('.audio-hero-play-btn-large:not(.audio-compact-play-btn)');
    if (largePlayBtn && !largePlayBtn.querySelector('svg')) {
      largePlayBtn.innerHTML = `<svg class="audio-play-icon" width="24" height="24" viewBox="0 0 24 24" fill="#6366f1" stroke="none"><polygon points="6,4 20,12 6,20"/></svg><svg class="audio-pause-icon hidden" width="24" height="24" viewBox="0 0 24 24" fill="#6366f1" stroke="none"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg>`;
    }

    // Ensure audio native player has valid blob URL and source loaded
    const audioEl = card.querySelector('.audio-native-player');
    const mediaId = card.getAttribute('data-media-id') || (audioEl ? audioEl.getAttribute('data-media-id') : null);
    if (audioEl && mediaId) {
      if (typeof getMediaURL === 'function') {
        getMediaURL(mediaId).then(url => {
          if (url && audioEl.src !== url) {
            audioEl.removeAttribute('data-missing');
            audioEl.src = url;
            try { audioEl.load(); } catch(_) {}
          }
        });
      }
    }

    // Always remove any existing toolbar first so we get a fresh one with current state
    card.querySelector('.embed-editor-toolbar')?.remove();
    const toolbar = buildSoundCardEditorToolbar(card);
    if (toolbar) card.insertBefore(toolbar, card.firstChild);
    // Ensure the global image toolbar does NOT show on audio cards
    const imgTb = document.getElementById('imgToolbar');
    if (imgTb) imgTb.classList.remove('show');
    document.querySelectorAll('.img-handle').forEach(h => h.classList.remove('show'));
  });
}

function renderSoundCardHTML(id, name, mimeType, size, url, displayMode='preview', widthPreset='medium'){
  const ext = (name||'').split('.').pop().toUpperCase() || 'AUDIO';
  const fileSizeMeta = formatBytes(size || 0);

  let innerCardContent = '';

  if (displayMode === 'compact') {
    innerCardContent = `
      <div class="embed-compact-card">
        <div class="embed-compact-hero-icon">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="var(--accent)"><polygon points="6,4 20,12 6,20"/></svg>
        </div>
        <span class="embed-compact-divider"></span>
        <div class="embed-compact-info">
          <strong class="embed-compact-title" contenteditable="true" data-action="inline-edit-title" title="Click to edit title">${esc(name)}</strong>
          <span class="embed-compact-link">${esc(fileSizeMeta)}</span>
        </div>
        <button type="button" class="audio-hero-play-btn-large audio-compact-play-btn" data-action="audio-toggle-play" title="Play/Pause" style="width:36px;height:36px;min-width:36px;">
          <svg class="audio-play-icon" width="16" height="16" viewBox="0 0 24 24" fill="var(--accent)"><polygon points="6,4 20,12 6,20"/></svg>
          <svg class="audio-pause-icon hidden" width="16" height="16" viewBox="0 0 24 24" fill="var(--accent)"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg>
        </button>
      </div>`;
  } else {
    // Rich Link Card format with Material 3 Expressive Seeker Bar
    innerCardContent = `
      <div class="embed-canonical-card">
        <div class="embed-canonical-header">
          <div class="embed-provider-badge-wrap">
            <span class="card-type-icon"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg></span>
            <span class="embed-provider-badge">${esc(ext)}</span>
          </div>
          <span class="embed-canonical-link">${esc(fileSizeMeta)}</span>
        </div>

        <div class="embed-canonical-hero audio-hero-center">
          <button type="button" class="audio-hero-play-btn-large" data-action="audio-toggle-play" title="Play/Pause">
            <svg class="audio-play-icon" width="24" height="24" viewBox="0 0 24 24" fill="#6366f1" stroke="none"><polygon points="6,4 20,12 6,20"/></svg>
            <svg class="audio-pause-icon hidden" width="24" height="24" viewBox="0 0 24 24" fill="#6366f1" stroke="none"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg>
          </button>
          <div class="audio-waveform-container">
            <div class="audio-waveform-bars">
              <span class="vbar" style="--h: 40%; --d: 0.05s"></span>
              <span class="vbar" style="--h: 75%; --d: 0.18s"></span>
              <span class="vbar" style="--h: 30%; --d: 0.12s"></span>
              <span class="vbar" style="--h: 90%; --d: 0.28s"></span>
              <span class="vbar" style="--h: 55%; --d: 0.08s"></span>
              <span class="vbar" style="--h: 80%; --d: 0.22s"></span>
              <span class="vbar" style="--h: 45%; --d: 0.14s"></span>
              <span class="vbar" style="--h: 100%; --d: 0.32s"></span>
              <span class="vbar" style="--h: 65%; --d: 0.16s"></span>
              <span class="vbar" style="--h: 85%; --d: 0.25s"></span>
              <span class="vbar" style="--h: 50%; --d: 0.10s"></span>
              <span class="vbar" style="--h: 95%; --d: 0.30s"></span>
              <span class="vbar" style="--h: 70%; --d: 0.15s"></span>
              <span class="vbar" style="--h: 35%; --d: 0.20s"></span>
              <span class="vbar" style="--h: 80%; --d: 0.27s"></span>
              <span class="vbar" style="--h: 60%; --d: 0.09s"></span>
              <span class="vbar" style="--h: 88%; --d: 0.23s"></span>
              <span class="vbar" style="--h: 42%; --d: 0.17s"></span>
              <span class="vbar" style="--h: 78%; --d: 0.29s"></span>
              <span class="vbar" style="--h: 92%; --d: 0.35s"></span>
            </div>
          </div>
          <div class="m3-seeker-container">
            <span class="audio-time-stamp audio-cur-time">0:00</span>
            <div class="m3-seeker-track" data-action="audio-seek">
              <div class="m3-seeker-fill" style="width: 0%"></div>
              <div class="m3-seeker-thumb" style="left: 0%"></div>
            </div>
            <span class="audio-time-stamp audio-dur-time">0:00</span>
          </div>
        </div>

        <div class="embed-canonical-body">
          <div class="embed-canonical-text">
            <strong contenteditable="true" data-action="inline-edit-title" title="Click to edit title">${esc(name)}</strong>
            <p class="embed-fallback-desc" contenteditable="true" data-action="inline-edit-desc" title="Click to edit caption">Add audio notes, description, or transcript...</p>
          </div>
        </div>
      </div>`;
  }

  return `<div class="paperuss-card paperuss-card-audio embed-mode-${displayMode} embed-width-${widthPreset} card-width-${widthPreset}" ` +
    `contenteditable="false" draggable="true" ` +
    `data-media-id="${id}" ` +
    `data-media-kind="audio" ` +
    `data-display-mode="${displayMode}" ` +
    `data-width-preset="${widthPreset}" ` +
    `data-drop-block="1">` +
    `${innerCardContent}` +
    `<audio class="audio-native-player" preload="metadata" data-media-id="${id}" data-media-kind="audio" src="${url}"></audio>` +
    `<div class="card-resize-handle" title="Drag to resize card"></div>` +
    `</div>`;
}

async function insertAudioFile(file){
  if(!file || !file.type.startsWith('audio/')){ toast('Not an audio file'); return; }
  const id = (typeof mediaUid === 'function') ? mediaUid() : ('m_' + Date.now().toString(36));
  const tempUrl = URL.createObjectURL(file);

  insertHTMLAtCaret(renderSoundCardHTML(id, file.name, file.type, file.size, tempUrl, 'preview', 'medium'));
  if (typeof hydrateSoundCards === 'function') hydrateSoundCards();
  save();
  toast('Audio added');

  try {
    const realId = await saveMediaBlob(file, file.name, 'audio', id);
    if(realId && realId !== id){
      document.querySelectorAll(`[data-media-id="${id}"]`).forEach(el => el.setAttribute('data-media-id', realId));
    }
  } catch(err) { console.warn('PapeRuss: Audio store fallback', err); }
  renderStorageStats();
}

async function insertAudioBlob(blob, name='Voice recording'){
  const id = (typeof mediaUid === 'function') ? mediaUid() : ('m_' + Date.now().toString(36));
  const tempUrl = URL.createObjectURL(blob);

  insertHTMLAtCaret(renderSoundCardHTML(id, name, 'audio/webm', blob.size, tempUrl, 'preview', 'medium'));
  if (typeof hydrateSoundCards === 'function') hydrateSoundCards();
  save();
  toast('Recording added');

  try {
    const realId = await saveMediaBlob(blob, name, 'audio', id);
    if(realId && realId !== id){
      document.querySelectorAll(`[data-media-id="${id}"]`).forEach(el => el.setAttribute('data-media-id', realId));
    }
    if (typeof save === 'function') save();
  } catch(err) { console.warn('PapeRuss: Recording store fallback', err); }
  renderStorageStats();
  if (typeof updateMediaCount === 'function') updateMediaCount();
  if (typeof renderMediaList === 'function') renderMediaList();
  if (typeof renderMediaHubView === 'function') renderMediaHubView();
  window.dispatchEvent(new CustomEvent('mediaAssetSaved', { detail: { id, kind: 'audio' } }));
}

function getFileThemeInfo(extName, mimeType) {
  const ext = (extName || '').toLowerCase().replace('.', '');
  const mime = (mimeType || '').toLowerCase();

  if (ext === 'pdf' || mime.includes('pdf')) {
    return {
      category: 'PDF Document',
      brandColor: '#ef4444',
      brandDark: '#b91c1c',
      heroGradient: 'linear-gradient(135deg, #fecaca 0%, #fca5a5 100%)',
      badgeBg: 'rgba(239, 68, 68, 0.18)',
      badgeColor: '#ef4444'
    };
  }
  if (['xls', 'xlsx', 'csv', 'ods'].includes(ext) || mime.includes('excel') || mime.includes('spreadsheet') || mime.includes('spreadsheetml') || mime.includes('csv')) {
    return {
      category: 'Excel Spreadsheet',
      brandColor: '#10b981',
      brandDark: '#047857',
      heroGradient: 'linear-gradient(135deg, #bbf7d0 0%, #86efac 100%)',
      badgeBg: 'rgba(16, 185, 129, 0.18)',
      badgeColor: '#10b981'
    };
  }
  if (['ppt', 'pptx', 'key', 'odp'].includes(ext) || mime.includes('powerpoint') || mime.includes('presentation') || mime.includes('presentationml')) {
    return {
      category: 'PowerPoint Presentation',
      brandColor: '#f97316',
      brandDark: '#c2410c',
      heroGradient: 'linear-gradient(135deg, #fed7aa 0%, #fdba74 100%)',
      badgeBg: 'rgba(249, 115, 22, 0.18)',
      badgeColor: '#f97316'
    };
  }
  if (['doc', 'docx', 'odt', 'rtf'].includes(ext) || mime.includes('word') || mime.includes('wordprocessingml')) {
    return {
      category: 'Word Document',
      brandColor: '#2563eb',
      brandDark: '#1d4ed8',
      heroGradient: 'linear-gradient(135deg, #bfdbfe 0%, #93c5fd 100%)',
      badgeBg: 'rgba(37, 99, 235, 0.18)',
      badgeColor: '#2563eb'
    };
  }
  if (['zip', 'rar', '7z', 'tar', 'gz', 'bz2', 'iso'].includes(ext) || mime.includes('zip') || mime.includes('compressed')) {
    return {
      category: 'Archive',
      brandColor: '#a855f7',
      brandDark: '#7e22ce',
      heroGradient: 'linear-gradient(135deg, #e9d5ff 0%, #d8b4fe 100%)',
      badgeBg: 'rgba(168, 85, 247, 0.18)',
      badgeColor: '#a855f7'
    };
  }
  if (['js', 'ts', 'jsx', 'tsx', 'py', 'html', 'css', 'json', 'cpp', 'c', 'java', 'php', 'rb', 'go', 'rs', 'sh', 'txt', 'md', 'xml', 'yaml', 'yml'].includes(ext) || mime.includes('text') || mime.includes('json') || mime.includes('javascript')) {
    return {
      category: 'Code / Text',
      brandColor: '#d97706',
      brandDark: '#b45309',
      heroGradient: 'linear-gradient(135deg, #fef08a 0%, #fde047 100%)',
      badgeBg: 'rgba(217, 119, 6, 0.18)',
      badgeColor: '#d97706'
    };
  }
  if (mime.startsWith('audio/') || ['mp3', 'wav', 'flac', 'm4a', 'ogg', 'aac'].includes(ext)) {
    return {
      category: 'Audio File',
      brandColor: '#6366f1',
      brandDark: '#4338ca',
      heroGradient: 'linear-gradient(135deg, #c7d2fe 0%, #a5b4fc 100%)',
      badgeBg: 'rgba(99, 102, 241, 0.18)',
      badgeColor: '#6366f1'
    };
  }
  if (mime.startsWith('video/') || ['mp4', 'mkv', 'avi', 'mov', 'webm'].includes(ext)) {
    return {
      category: 'Video File',
      brandColor: '#ec4899',
      brandDark: '#be185d',
      heroGradient: 'linear-gradient(135deg, #fbcfe8 0%, #f9a8d4 100%)',
      badgeBg: 'rgba(236, 72, 153, 0.18)',
      badgeColor: '#ec4899'
    };
  }
  return {
    category: 'Attachment',
    brandColor: '#8b5cf6',
    brandDark: '#6d28d9',
    heroGradient: 'linear-gradient(135deg, #ddd6fe 0%, #c4b5fd 100%)',
    badgeBg: 'rgba(139, 92, 246, 0.18)',
    badgeColor: '#8b5cf6'
  };
}

function renderAttachmentCardHTML(id, name, mimeType = 'application/octet-stream', size = 0, displayMode = 'preview', widthPreset = 'medium') {
  const ext = (name || '').split('.').pop().toUpperCase() || 'FILE';
  const iconSVG = fileIconSVG(mimeType, name);
  const theme = getFileThemeInfo(ext, mimeType);
  const fileSizeMeta = formatBytes(size);

  let innerCardContent = '';
  if (displayMode === 'compact') {
    innerCardContent = `
      <div class="embed-compact-card">
        <div class="embed-compact-hero-icon" style="background:${theme.badgeBg};color:${theme.brandColor}">
          ${iconSVG}
        </div>
        <span class="embed-compact-divider"></span>
        <div class="embed-compact-info">
          <strong class="embed-compact-title" contenteditable="false">${esc(name)}</strong>
          <span class="embed-compact-link">${esc(theme.category)} · ${esc(fileSizeMeta)}</span>
        </div>
        <button type="button" class="mc-action-compact" data-mc-download="${id}" data-mc-name="${esc(name)}" title="Download ${esc(ext)} File" style="background:linear-gradient(135deg, ${theme.brandColor}, ${theme.brandDark || theme.brandColor});color:#ffffff !important;box-shadow:0 4px 14px ${theme.brandColor}50">
          <i data-lucide="download" class="w-4 h-4 text-white"></i>
        </button>
      </div>`;
  } else {
    const cardDateStr = 'Created: ' + new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
    innerCardContent = `
      <div class="embed-canonical-card">

        <!-- ZONE 1: Fixed header — category + size badges -->
        <div class="file-card-header">
          <span class="embed-provider-badge" style="background:${theme.badgeBg};color:${theme.brandColor}">${esc(theme.category)}</span>
          <span class="file-card-size-badge" style="background:${theme.badgeBg};color:${theme.badgeColor};border:1px solid ${theme.brandColor}35">${esc(ext)} · ${esc(fileSizeMeta)}</span>
        </div>

        <!-- ZONE 2: Flexible body — icon centre, grows to fill row height -->
        <div class="file-card-body" style="background:${theme.heroGradient}">
          <div class="embed-glass-hero-badge file-glass-hero-badge">
            <span class="file-hero-icon-large" style="color:${theme.brandColor}">
              ${iconSVG}
            </span>
          </div>
        </div>

        <!-- ZONE 3: Fixed footer — non-editable title, date subtitle, download button -->
        <div class="file-card-footer">
          <div class="file-footer-meta">
            <strong class="card-title-text" contenteditable="false">${esc(name)}</strong>
            <p class="embed-fallback-desc" contenteditable="false">${esc(cardDateStr)}</p>
          </div>
          <button type="button" class="btn btn-sm mc-action file-hero-download-btn" data-mc-download="${id}" data-mc-name="${esc(name)}" style="background:${theme.brandColor};color:#ffffff !important;">
            <i data-lucide="download" class="w-4 h-4 text-white"></i>
            <span style="color:#ffffff !important">Download ${esc(ext)}</span>
          </button>
        </div>

      </div>`;
  }

  return `<div class="paperuss-card paperuss-card-file media-card embed-mode-${displayMode} embed-width-${widthPreset} card-width-${widthPreset}" ` +
    `contenteditable="false" draggable="true" ` +
    `data-media-id="${id}" ` +
    `data-media-kind="file" ` +
    `data-file-type="${esc(mimeType)}" ` +
    `data-file-size="${size}" ` +
    `data-display-mode="${displayMode}" ` +
    `data-width-preset="${widthPreset}" ` +
    `data-drop-block="1">` +
    `${innerCardContent}` +
    `<div class="card-resize-handle" title="Drag to resize card"></div>` +
    `</div>`;
}

function buildAttachmentCardEditorToolbar(card) {
  const bar = document.createElement('div');
  bar.className = 'embed-editor-toolbar';
  bar.setAttribute('contenteditable', 'false');

  const displayMode = card.getAttribute('data-display-mode') || 'preview';
  const widthPreset = card.getAttribute('data-width-preset') || 'medium';
  const currentWrap = card.getAttribute('data-card-wrap') || 'none';
  const mediaId = card.getAttribute('data-media-id') || '';
  const title = card.querySelector('.card-title-text, .embed-compact-title, strong')?.textContent || 'Attachment';

  const sizeLabels = { 'small': 'S', 'medium': 'M', 'large': 'L', 'full': 'Full' };
  const activeSizeLabel = sizeLabels[widthPreset] || 'M';
  const modeIcons = { 'compact': 'align-justify', 'preview': 'image' };
  const activeModeIcon = modeIcons[displayMode] || 'image';

  const wrapIcons = { 'none': 'rows-2', 'left': 'panel-left', 'right': 'panel-right', 'inline': 'move-horizontal' };
  const activeWrapIcon = 'wrap-text';

  bar.innerHTML = `
    <div class="embed-tb-segment">
      <button type="button" class="embed-tb-btn card-drag-handle" title="Drag card to move & snap" style="cursor:grab">
        <i data-lucide="grip-vertical" class="w-3.5 h-3.5"></i>
      </button>
    </div>
    <div class="embed-tb-segment" style="position:relative">
      <button type="button" class="embed-tb-btn" data-action="toggle-size-menu" title="Card Size (${activeSizeLabel})">
        <i data-lucide="scaling" class="w-4 h-4"></i>
      </button>
      <div class="embed-tb-dropdown embed-size-dropdown hidden" contenteditable="false">
        <button type="button" class="embed-tb-dropdown-item ${widthPreset.startsWith('small') ? 'active' : ''}" data-action="set-width" data-val="small">
          <span class="embed-sz-badge">S</span> Small (320px)
        </button>
        <button type="button" class="embed-tb-dropdown-item ${widthPreset.startsWith('medium') ? 'active' : ''}" data-action="set-width" data-val="medium">
          <span class="embed-sz-badge">M</span> Medium (480px)
        </button>
        <button type="button" class="embed-tb-dropdown-item ${widthPreset.startsWith('large') ? 'active' : ''}" data-action="set-width" data-val="large">
          <span class="embed-sz-badge">L</span> Large (680px)
        </button>
        <button type="button" class="embed-tb-dropdown-item ${widthPreset === 'full' ? 'active' : ''}" data-action="set-width" data-val="full">
          <span class="embed-sz-badge">Full</span> Full Width (100%)
        </button>
      </div>
    </div>
    <div class="embed-tb-segment" style="position:relative">
      <button type="button" class="embed-tb-btn" data-action="toggle-wrap-menu" title="Wrap Text Mode">
        <i data-lucide="${activeWrapIcon}" class="w-4 h-4 embed-wrap-icon"></i>
      </button>
      <div class="embed-tb-dropdown embed-wrap-dropdown hidden" contenteditable="false">
        <button type="button" class="embed-tb-dropdown-item ${currentWrap === 'none' ? 'active' : ''}" data-action="set-wrap" data-val="none">
          <i data-lucide="rows-2" class="w-4 h-4"></i> Break Text (No Wrap)
        </button>
        <button type="button" class="embed-tb-dropdown-item ${currentWrap === 'left' ? 'active' : ''}" data-action="set-wrap" data-val="left">
          <i data-lucide="panel-left" class="w-4 h-4"></i> Wrap Text Right (Float Left)
        </button>
        <button type="button" class="embed-tb-dropdown-item ${currentWrap === 'right' ? 'active' : ''}" data-action="set-wrap" data-val="right">
          <i data-lucide="panel-right" class="w-4 h-4"></i> Wrap Text Left (Float Right)
        </button>
        <button type="button" class="embed-tb-dropdown-item ${currentWrap === 'inline' ? 'active' : ''}" data-action="set-wrap" data-val="inline">
          <i data-lucide="move-horizontal" class="w-4 h-4"></i> Inline with Text
        </button>
      </div>
    </div>
    <div class="embed-tb-segment" style="position:relative">
      <button type="button" class="embed-tb-btn" data-action="toggle-mode-menu" title="Display Mode">
        <i data-lucide="${activeModeIcon}" class="w-4 h-4 embed-mode-icon"></i>
      </button>
      <div class="embed-tb-dropdown embed-mode-dropdown hidden" contenteditable="false">
        <button type="button" class="embed-tb-dropdown-item ${displayMode === 'compact' ? 'active' : ''}" data-action="set-mode" data-val="compact">
          <i data-lucide="align-justify" class="w-4 h-4"></i> Compact Card (1-Row)
        </button>
        <button type="button" class="embed-tb-dropdown-item ${displayMode === 'preview' ? 'active' : ''}" data-action="set-mode" data-val="preview">
          <i data-lucide="image" class="w-4 h-4"></i> Rich Preview Card
        </button>
      </div>
    </div>
    <div class="embed-tb-segment">
      <button type="button" class="embed-tb-btn" data-action="open-media-info" title="Asset Info & Specs">
        <i data-lucide="info" class="w-4 h-4"></i>
      </button>
      <button type="button" class="embed-tb-btn" data-action="download" title="Download File">
        <i data-lucide="download" class="w-4 h-4"></i>
      </button>
      <button type="button" class="embed-tb-btn embed-tb-btn-danger" data-action="remove" title="Remove Attachment Card">
        <i data-lucide="trash-2" class="w-4 h-4"></i>
      </button>
    </div>
  `;

  setTimeout(() => {
    if (typeof lucide?.createIcons === 'function') lucide.createIcons();
  }, 0);

  const closeAllDropdowns = () => {
    bar.querySelectorAll('.embed-tb-dropdown').forEach(m => m.classList.add('hidden'));
  };

  bar.addEventListener('mousedown', e => e.stopPropagation());

  bar.addEventListener('click', (e) => {
    e.stopPropagation();
    e.preventDefault();
    const btn = e.target.closest('button[data-action]');
    if (!btn) return;
    const act = btn.getAttribute('data-action');
    const val = btn.getAttribute('data-val');

    if (act === 'toggle-size-menu') {
      const menu = bar.querySelector('.embed-size-dropdown');
      const wasHidden = menu.classList.contains('hidden');
      closeAllDropdowns();
      if (wasHidden) menu.classList.remove('hidden');

    } else if (act === 'toggle-wrap-menu') {
      const menu = bar.querySelector('.embed-wrap-dropdown');
      const wasHidden = menu.classList.contains('hidden');
      closeAllDropdowns();
      if (wasHidden) menu.classList.remove('hidden');

    } else if (act === 'set-wrap') {
      closeAllDropdowns();
      card.setAttribute('data-card-wrap', val);
      bar.querySelectorAll('.embed-wrap-dropdown .embed-tb-dropdown-item').forEach(b => {
        b.classList.toggle('active', b.getAttribute('data-val') === val);
      });
      if (typeof handleBodyInput === 'function') handleBodyInput();
      if (typeof save === 'function') save();

    } else if (act === 'toggle-mode-menu') {
      const menu = bar.querySelector('.embed-mode-dropdown');
      const wasHidden = menu.classList.contains('hidden');
      closeAllDropdowns();
      if (wasHidden) menu.classList.remove('hidden');

    } else if (act === 'set-width') {
      closeAllDropdowns();
      setAttachmentCardWidth(card, val);

    } else if (act === 'set-mode') {
      closeAllDropdowns();
      setAttachmentCardDisplayMode(card, val);

    } else if (act === 'open-media-info') {
      closeAllDropdowns();
      if (typeof showMediaInfoModal === 'function') showMediaInfoModal(mediaId);

    } else if (act === 'download') {
      closeAllDropdowns();
      const downloadBtn = card.querySelector('[data-mc-download]');
      if (downloadBtn) {
        downloadBtn.click();
      } else if (mediaId && typeof downloadMediaById === 'function') {
        downloadMediaById(mediaId, title);
      }

    } else if (act === 'remove') {
      closeAllDropdowns();
      card.remove();
      if (typeof handleBodyInput === 'function') handleBodyInput();
      if (typeof save === 'function') save();
    }
  });

  return bar;
}

function setAttachmentCardDisplayMode(card, newMode) {
  if (!card) return;
  const kind = card.getAttribute('data-media-kind') || '';
  if (kind === 'video' || card.classList.contains('paperuss-card-video')) {
    return setVideoCardDisplayMode(card, newMode);
  }
  const currentWidth = card.getAttribute('data-width-preset') || 'medium';
  const mediaId = card.getAttribute('data-media-id') || '';
  const mimeType = card.getAttribute('data-file-type') || 'application/octet-stream';
  const size = parseInt(card.getAttribute('data-file-size'), 10) || 0;
  const title = card.querySelector('.card-title-text, .embed-compact-title, strong')?.textContent || 'Attachment';

  card.setAttribute('data-display-mode', newMode);
  const newHTML = renderAttachmentCardHTML(mediaId, title, mimeType, size, newMode, currentWidth);
  const temp = document.createElement('div');
  temp.innerHTML = newHTML;
  if (temp.firstElementChild) {
    card.innerHTML = temp.firstElementChild.innerHTML;
    card.className = temp.firstElementChild.className;
  }

  hydrateAttachmentCards(card);
  if (typeof handleBodyInput === 'function') handleBodyInput();
  if (typeof save === 'function') save();
}

function setVideoCardDisplayMode(card, newMode) {
  if (!card) return;
  const currentWidth = card.getAttribute('data-width-preset') || 'medium';
  const id = card.getAttribute('data-media-id') || '';
  const videoEl = card.querySelector('video');
  const url = videoEl ? videoEl.src : '';
  const title = card.querySelector('.video-card-title, .embed-compact-info strong, strong')?.textContent || 'Video Attachment';
  const ext = (title || '').split('.').pop().toUpperCase() || 'MP4';

  card.setAttribute('data-display-mode', newMode);
  const newHTML = renderVideoCardHTML({
    id,
    url,
    name: title,
    size: 0,
    ext,
    displayMode: newMode,
    widthPreset: currentWidth
  });
  const temp = document.createElement('div');
  temp.innerHTML = newHTML;
  if (temp.firstElementChild) {
    card.innerHTML = temp.firstElementChild.innerHTML;
    card.className = temp.firstElementChild.className;
  }

  if (typeof hydrateVideoCards === 'function') hydrateVideoCards(card);
  if (typeof handleBodyInput === 'function') handleBodyInput();
  if (typeof save === 'function') save();
}

function setAttachmentCardWidth(card, newWidth) {
  if (!card) return;
  const currentMode = card.getAttribute('data-display-mode') || 'preview';
  const kind = card.getAttribute('data-media-kind') || '';
  card.setAttribute('data-width-preset', newWidth);

  if (kind === 'video' || card.classList.contains('paperuss-card-video')) {
    card.className = `paperuss-card paperuss-card-video embed-mode-${currentMode} embed-width-${newWidth} card-width-${newWidth}`;
    if (typeof hydrateVideoCards === 'function') hydrateVideoCards(card);
  } else {
    card.className = `paperuss-card paperuss-card-file media-card embed-mode-${currentMode} embed-width-${newWidth} card-width-${newWidth}`;
    hydrateAttachmentCards(card);
  }
  if (typeof handleBodyInput === 'function') handleBodyInput();
  if (typeof save === 'function') save();
}

function hydrateAttachmentCards(targetContainer = document) {
  const container = targetContainer.closest ? (targetContainer.closest('#noteBody') || targetContainer) : document;
  const fileCards = container.querySelectorAll ? container.querySelectorAll('.paperuss-card-file, .media-card[data-media-kind="file"]') : [];

  fileCards.forEach(card => {
    if (!card.closest('#noteBody')) return;

    card.setAttribute('draggable', 'true');
    card.setAttribute('contenteditable', 'false');

    const mediaId = card.getAttribute('data-media-id') || '';
    const title = card.querySelector('.embed-canonical-text strong, .card-title-text, .embed-compact-title, strong')?.textContent || 'Attachment';
    const descText = card.querySelector('.embed-fallback-desc')?.textContent || '';
    let fileType = card.getAttribute('data-file-type') || '';
    if (!fileType || fileType === title) {
      fileType = title.split('.').pop() || 'file';
    }
    const fileSize = parseInt(card.getAttribute('data-file-size'), 10) || 0;
    const displayMode = card.getAttribute('data-display-mode') || 'preview';
    const widthPreset = card.getAttribute('data-width-preset') || 'medium';

    const newHTML = renderAttachmentCardHTML(mediaId, title, fileType, fileSize, displayMode, widthPreset);
    const temp = document.createElement('div');
    temp.innerHTML = newHTML;
    if (temp.firstElementChild) {
      card.innerHTML = temp.firstElementChild.innerHTML;
      card.className = temp.firstElementChild.className;
      if (descText && descText !== 'Add attachment notes, description, or tags...') {
        const descEl = card.querySelector('.embed-fallback-desc');
        if (descEl) descEl.textContent = descText;
      }
    }

    card.setAttribute('draggable', 'true');
    card.setAttribute('contenteditable', 'false');

    card.querySelectorAll('.embed-editor-toolbar').forEach(t => t.remove());
    const toolbar = buildAttachmentCardEditorToolbar(card);
    card.insertBefore(toolbar, card.firstChild);
  });

  if (typeof hydrateGlobalBlockItems === 'function') hydrateGlobalBlockItems(container);
  if (typeof reflowCardGridRows === 'function') reflowCardGridRows(container);
}
window.hydrateAttachmentCards = hydrateAttachmentCards;

function hydrateAudioCards(targetContainer = document) {
  const container = targetContainer.closest ? (targetContainer.closest('#noteBody') || targetContainer) : document;
  const audioCards = container.querySelectorAll ? container.querySelectorAll('.paperuss-card-audio, .media-card[data-media-kind="audio"]') : [];

  audioCards.forEach(card => {
    if (!card.closest('#noteBody')) return;

    card.setAttribute('draggable', 'true');
    card.setAttribute('contenteditable', 'false');

    if (!card.querySelector('.card-resize-handle')) {
      const handle = document.createElement('div');
      handle.className = 'card-resize-handle';
      handle.title = 'Drag to resize & snap';
      card.appendChild(handle);
    }
  });

  if (typeof hydrateGlobalBlockItems === 'function') hydrateGlobalBlockItems(container);
  if (typeof reflowCardGridRows === 'function') reflowCardGridRows(container);
}
function hydrateVideoCards(targetContainer = document) {
  const container = targetContainer.closest ? (targetContainer.closest('#noteBody') || targetContainer) : document;
  const videoCards = container.querySelectorAll ? container.querySelectorAll('.paperuss-card-video, .media-card[data-media-kind="video"]') : [];

  videoCards.forEach(card => {
    if (!card.closest('#noteBody')) return;

    card.setAttribute('draggable', 'true');
    card.setAttribute('contenteditable', 'false');

    card.querySelectorAll('.embed-editor-toolbar').forEach(t => t.remove());
    const toolbar = buildAttachmentCardEditorToolbar(card);
    if (toolbar) card.insertBefore(toolbar, card.firstChild);

    if (!card.querySelector('.card-resize-handle')) {
      const handle = document.createElement('div');
      handle.className = 'card-resize-handle';
      handle.title = 'Drag to resize & snap';
      card.appendChild(handle);
    }
  });

  if (typeof hydrateGlobalBlockItems === 'function') hydrateGlobalBlockItems(container);
  if (typeof reflowCardGridRows === 'function') reflowCardGridRows(container);
}
window.hydrateVideoCards = hydrateVideoCards;

async function insertAttachmentFile(file){
  if(!file){ return; }
  if (file.type && file.type.startsWith('image/')) {
    return insertImageFile(file);
  }
  if (file.type && file.type.startsWith('video/')) {
    return insertVideoFile(file);
  }
  const ext = (file.name || '').split('.').pop().toLowerCase();
  if (file.type && file.type.startsWith('audio/') || ['mp3','wav','flac','m4a','ogg','aac','opus','weba'].includes(ext)) {
    return insertAudioFile(file);
  }
  const id = (typeof mediaUid === 'function') ? mediaUid() : ('m_' + Date.now().toString(36));

  insertHTMLAtCaret(renderAttachmentCardHTML(id, file.name, file.type, file.size, 'preview', 'medium'));
  if (typeof hydrateAttachmentCards === 'function') hydrateAttachmentCards();
  save();
  toast('File attached');

  try {
    const realId = await saveMediaBlob(file, file.name, 'file', id);
    if(realId && realId !== id){
      document.querySelectorAll(`[data-media-id="${id}"]`).forEach(el => el.setAttribute('data-media-id', realId));
      document.querySelectorAll(`[data-mc-download="${id}"]`).forEach(el => el.setAttribute('data-mc-download', realId));
    }
    if (typeof save === 'function') save();
  } catch(err) { console.warn('PapeRuss: Attachment store fallback', err); }
  renderStorageStats();
  if (typeof updateMediaCount === 'function') updateMediaCount();
  if (typeof renderMediaList === 'function') renderMediaList();
  if (typeof renderMediaHubView === 'function') renderMediaHubView();
  window.dispatchEvent(new CustomEvent('mediaAssetSaved', { detail: { id, kind: 'file' } }));
}

function fileIconSVG(type,name){
  const ext=(name||'').split('.').pop().toLowerCase();
  const mime=(type||'').toLowerCase();
  if(mime.startsWith('image/')) return '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>';
  if(mime.startsWith('audio/') || ['mp3','wav','flac','m4a','ogg'].includes(ext)) return '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg>';
  if(mime.startsWith('video/') || ['mp4','mkv','avi','mov','webm'].includes(ext)) return '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="23 7 16 12 23 17 23 7"/><rect x="1" y="5" width="15" height="14" rx="2" ry="2"/></svg>';
  if(['pdf'].includes(ext) || mime.includes('pdf')) return '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>';
  if(['xls','xlsx','csv','ods'].includes(ext) || mime.includes('excel') || mime.includes('spreadsheet')) return '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2"/><line x1="3" y1="9" x2="21" y2="9"/><line x1="3" y1="15" x2="21" y2="15"/><line x1="9" y1="3" x2="9" y2="21"/><line x1="15" y1="3" x2="15" y2="21"/></svg>';
  if(['ppt','pptx','key','odp'].includes(ext) || mime.includes('powerpoint') || mime.includes('presentation')) return '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M2 3h20v14H2z"/><path d="M8 21h8"/><path d="M12 17v4"/><path d="M7 11l3-3 3 3 4-4"/></svg>';
  if(['doc','docx','odt','rtf'].includes(ext) || mime.includes('word')) return '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>';
  if(['zip','rar','7z','tar','gz'].includes(ext) || mime.includes('zip') || mime.includes('compressed')) return '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 8v13H3V3h11l7 5z"/><path d="M10 3v4"/><path d="M10 9v4"/><circle cx="10" cy="17" r="1"/></svg>';
  return '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/><polyline points="13 2 13 9 20 9"/></svg>';
}

/* Rich link cards & embeds */
function insertRichLink(){
  const sel=window.getSelection();
  const selText=sel ? sel.toString().trim() : '';
  if(typeof window.openEmbedModal === 'function'){
    window.openEmbedModal({ initialText: selText, defaultMode: 'preview' });
    return;
  }
  if(typeof openLinkModal === 'function'){
    openLinkModal({ initialText: selText });
    return;
  }
}

/* Voice recording modal */
let recStream=null, recRecorder=null, recChunks=[], recStart=0, recTimer=null, isRecMinimized=false;

function removeRecDockPill(){
  const dock=document.getElementById('voiceRecDock');
  if(dock) dock.remove();
}

function updateRecTimerDisplay(timeStr){
  const elModal=document.getElementById('recTime');
  const elDock=document.getElementById('recDockTime');
  if(elModal) elModal.textContent=timeStr;
  if(elDock) elDock.textContent=timeStr;
}

function renderRecDockPill(){
  removeRecDockPill();
  const dock=document.createElement('div');
  dock.id='voiceRecDock';
  dock.className='rec-dock-pill';
  dock.innerHTML=`
    <div class="rec-dock-dot"></div>
    <span style="font-size:11px;font-weight:700;text-transform:uppercase;color:#f87171">REC</span>
    <span class="rec-dock-time" id="recDockTime">0:00</span>
    <button type="button" class="rec-dock-btn" id="recDockStop" title="Stop & save recording">■</button>
    <button type="button" class="rec-dock-btn" id="recDockMaximize" title="Expand recorder modal">⤢</button>
  `;
  document.body.appendChild(dock);

  document.getElementById('recDockStop').onclick=()=>{
    if(recRecorder && recRecorder.state!=='inactive') recRecorder.stop();
    removeRecDockPill();
  };
  document.getElementById('recDockMaximize').onclick=()=>{
    isRecMinimized=false;
    removeRecDockPill();
    openRecordingModal();
  };
}

function openRecordingModal(){
  const root=document.getElementById('modalRoot');
  isRecMinimized=false;
  removeRecDockPill();

  const isRecordingActive = recRecorder && recRecorder.state === 'recording';

  root.innerHTML=`<div class="modal-overlay"><div class="modal rec-modal" style="position:relative">
    <button id="recMinimize" title="Minimize to dock pill" style="position:absolute;top:14px;right:14px;background:none;border:none;color:var(--fg-secondary);font-size:18px;cursor:pointer;padding:2px 8px;border-radius:4px;line-height:1" ${isRecordingActive?'':'disabled style="opacity:0.4;cursor:not-allowed"'}>–</button>
    <h3>Voice Recording</h3>
    <div class="rec-dot ${isRecordingActive?'':'idle'}" id="recDot"></div>
    <div class="rec-time" id="recTime">0:00</div>
    <div class="rec-hint" id="recHint">${isRecordingActive?'Recording… speak now':'Click Start to begin recording'}</div>
    <div class="modal-actions" style="justify-content:center">
      <button class="btn" id="recCancel">Cancel</button>
      <button class="btn btn-primary" id="recStart" style="${isRecordingActive?'display:none':''}">● Start</button>
      <button class="btn btn-danger" id="recStop" style="${isRecordingActive?'':'display:none'}">■ Stop</button>
    </div>
  </div></div>`;

  const cleanup=()=>{
    if(recTimer){ clearInterval(recTimer); recTimer=null; }
    if(recStream){ recStream.getTracks().forEach(t=>t.stop()); recStream=null; }
    recRecorder=null; recChunks=[]; isRecMinimized=false;
    removeRecDockPill();
  };

  const close=()=>{ cleanup(); root.innerHTML=''; };
  document.getElementById('recCancel').onclick=close;

  const minBtn = document.getElementById('recMinimize');
  if(minBtn) {
    minBtn.onclick = () => {
      if(!recRecorder || recRecorder.state !== 'recording') return;
      isRecMinimized = true;
      root.innerHTML = '';
      renderRecDockPill();
      toast('Voice recorder minimized to dock pill');
    };
  }

  // If already recording (re-opened via Maximize)
  if(isRecordingActive) {
    const s = Math.floor((Date.now() - recStart) / 1000);
    updateRecTimerDisplay(Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'));
  }

  document.getElementById('recStart').onclick=async ()=>{
    try{
      recStream=await navigator.mediaDevices.getUserMedia({audio:true});
    }catch(e){
      document.getElementById('recHint').textContent='Microphone access denied.';
      return;
    }
    recChunks=[];
    const mime = MediaRecorder.isTypeSupported('audio/webm;codecs=opus') ? 'audio/webm;codecs=opus' :
                 MediaRecorder.isTypeSupported('audio/webm') ? 'audio/webm' :
                 MediaRecorder.isTypeSupported('audio/mp4') ? 'audio/mp4' : '';
    const recOpts = mime ? { mimeType: mime, audioBitsPerSecond: 24000 } : { audioBitsPerSecond: 24000 };
    try {
      recRecorder = new MediaRecorder(recStream, recOpts);
    } catch(_) {
      recRecorder = mime ? new MediaRecorder(recStream, { mimeType: mime }) : new MediaRecorder(recStream);
    }
    recRecorder.ondataavailable=e=>{ if(e.data && e.data.size) recChunks.push(e.data); };
    recRecorder.onstop=async ()=>{
      const blob=new Blob(recChunks,{type:recRecorder.mimeType||'audio/webm'});
      cleanup(); root.innerHTML='';
      if(blob.size>0){
        const name='voice-'+new Date().toISOString().slice(0,19).replace(/[:T]/g,'-')+'.webm';
        await insertAudioBlob(blob, name);
      }
    };
    recRecorder.start();
    recStart=Date.now();
    document.getElementById('recDot').classList.remove('idle');
    document.getElementById('recStart').style.display='none';
    document.getElementById('recStop').style.display='';
    const minBtnActive = document.getElementById('recMinimize');
    if(minBtnActive) { minBtnActive.disabled = false; minBtnActive.style.opacity = '1'; minBtnActive.style.cursor = 'pointer'; }
    document.getElementById('recHint').textContent='Recording… speak now';

    if(recTimer) clearInterval(recTimer);
    recTimer=setInterval(()=>{
      const s=Math.floor((Date.now()-recStart)/1000);
      const timeStr=Math.floor(s/60)+':'+String(s%60).padStart(2,'0');
      updateRecTimerDisplay(timeStr);
    },200);
  };

  document.getElementById('recStop').onclick=()=>{
    if(recRecorder && recRecorder.state!=='inactive') recRecorder.stop();
  };
  root.querySelector('.modal-overlay').onclick=e=>{ if(e.target===e.currentTarget && !isRecordingActive) close(); };
}

/* Dispatcher for the media toolbar buttons */
async function handleMediaAction(kind){
  document.getElementById('noteBody').focus();
  if (window.showOpenFilePicker && (kind === 'image' || kind === 'video' || kind === 'file')) {
    try {
      const options = { multiple: true };
      if (kind === 'image') options.types = [{ description: 'Images', accept: { 'image/*': ['.png', '.jpg', '.jpeg', '.gif', '.webp'] } }];
      if (kind === 'video') options.types = [{ description: 'Videos', accept: { 'video/*': ['.mp4', '.mov', '.webm', '.mkv'] } }];
      
      const handles = await window.showOpenFilePicker(options);
      for (const handle of handles) {
        const file = await handle.getFile();
        if (file.size > 10 * 1024 * 1024) {
          file.fileHandle = handle;
          if(typeof toast === 'function') toast('Heavy file detected. Saved securely as a zero-storage local shortcut.');
        }
        if (kind === 'image' || file.type.startsWith('image/')) insertImageFile(file);
        else if (kind === 'video' || file.type.startsWith('video/')) insertVideoFile(file);
        else insertAttachmentFile(file);
      }
      return;
    } catch (err) {
      if (err.name !== 'AbortError') {
        console.warn('PapeRuss: File picker API failed, falling back to legacy input', err);
      } else {
        return; // User cancelled
      }
    }
  }

  switch(kind){
    case 'image': document.getElementById('mediaImageInput').click(); break;
    case 'video': document.getElementById('mediaVideoInput').click(); break;
    case 'file':  document.getElementById('mediaFileInput').click(); break;
    case 'link':  insertRichLink(); break;
    case 'audio':
      if(!navigator.mediaDevices || !window.MediaRecorder){ toast('Recording not supported here'); return; }
      openRecordingModal();
      break;
  }
}

/* Trigger download for an attached file card */
async function downloadMediaById(id, filename){
  const rec=await mediaGet(id);
  if(!rec){ toast('File missing'); return; }
  const url=URL.createObjectURL(rec.blob);
  const a=document.createElement('a');
  a.href=url; a.download=filename||rec.name||'download'; a.click();
  setTimeout(()=>URL.revokeObjectURL(url),1000);
}

/* Paragraph alignment — single-control cycle: left → center → right → justify → left */
const ALIGN_ORDER=['left','center','right','justify'];
const ALIGN_CMD={left:'justifyLeft',center:'justifyCenter',right:'justifyRight',justify:'justifyFull'};
const ALIGN_ICON={left:'align-left',center:'align-center',right:'align-right',justify:'align-justify'};

function currentAlignment(){
  const sel=window.getSelection();
  if(!sel || !sel.anchorNode) return 'left';
  let n=sel.anchorNode.nodeType===3?sel.anchorNode.parentElement:sel.anchorNode;
  while(n && n!==bodyEl()){
    const ta=n.style && n.style.textAlign;
    if(ta) return ta==='start'?'left':ta;
    n=n.parentElement;
  }
  return 'left';
}
function applyAlignment(dir){
  const headerFooterField = typeof window.getHeaderFooterFormattingField === 'function'
    ? window.getHeaderFooterFormattingField() : null;
  // Check if a card has explicit click focus or active selection FIRST
  let mediaBlock = document.querySelector('#noteBody .card-selected, #noteBody [data-card-selected="true"]');

  const sel = window.getSelection();
  if(!mediaBlock && sel && sel.anchorNode){
    let node = sel.anchorNode.nodeType === 3 ? sel.anchorNode.parentElement : sel.anchorNode;
    mediaBlock = node?.closest?.('.paperuss-embed, .media-card, .broken-media-card, [data-paperuss-embed="true"]');
  }

  if(mediaBlock){
    if(!dir){
      const currentFloat = mediaBlock.style.float || (mediaBlock.className.includes('left') ? 'left' : mediaBlock.className.includes('right') ? 'right' : 'none');
      if(currentFloat === 'left') dir = 'center';
      else if(currentFloat === 'none' && (mediaBlock.style.margin.includes('auto') || mediaBlock.className.includes('medium'))) dir = 'right';
      else if(currentFloat === 'right') dir = 'full';
      else dir = 'left';
    }

    if(dir === 'left'){
      mediaBlock.style.float = 'left';
      mediaBlock.style.margin = '8px 18px 12px 0';
      mediaBlock.style.clear = 'none';
      mediaBlock.setAttribute('data-card-align', 'left');
    } else if(dir === 'right'){
      mediaBlock.style.float = 'right';
      mediaBlock.style.margin = '8px 0 12px 18px';
      mediaBlock.style.clear = 'none';
      mediaBlock.setAttribute('data-card-align', 'right');
    } else if(dir === 'center'){
      mediaBlock.style.float = 'none';
      mediaBlock.style.margin = '14px auto';
      mediaBlock.style.clear = 'both';
      mediaBlock.setAttribute('data-card-align', 'center');
    } else {
      mediaBlock.style.float = 'none';
      mediaBlock.style.margin = '12px 0';
      mediaBlock.style.clear = 'both';
      mediaBlock.setAttribute('data-card-align', 'full');
    }

    updateAlignmentButton();
    if(typeof handleBodyInput === 'function') handleBodyInput();
    if(typeof save === 'function') save();
    if(typeof updateToolbarState === 'function') updateToolbarState();
    return;
  }

  focusEditor();
  if(!dir){
    const cur=currentAlignment();
    const idx=ALIGN_ORDER.indexOf(cur);
    dir=ALIGN_ORDER[(idx+1)%ALIGN_ORDER.length];
  }
  document.execCommand(ALIGN_CMD[dir]||'justifyLeft', false, null);
  updateAlignmentButton();
  if(headerFooterField && typeof window.persistHeaderFooterFormatting === 'function') {
    window.persistHeaderFooterFormatting(headerFooterField);
  } else if(typeof handleBodyInput === 'function') handleBodyInput();
  if(typeof updateToolbarState === 'function') updateToolbarState();
}

// Click-to-focus card selection event delegation
document.addEventListener('click', (e) => {
  const noteBody = document.getElementById('noteBody');
  if (!noteBody) return;
  const card = e.target.closest('.paperuss-embed, .paperuss-card-audio, .paperuss-card, .media-card, .broken-media-card, [data-paperuss-embed="true"]');
  if (card && noteBody.contains(card)) {
    noteBody.querySelectorAll('.card-selected, [data-card-selected="true"]').forEach(el => {
      if (el !== card) {
        el.classList.remove('card-selected');
        el.removeAttribute('data-card-selected');
      }
    });
    card.classList.add('card-selected');
    card.setAttribute('data-card-selected', 'true');
    updateAlignmentButton();
  } else if (!e.target.closest('#formatBar, .embed-editor-toolbar, .overflow-dropdown')) {
    noteBody.querySelectorAll('.card-selected, [data-card-selected="true"]').forEach(el => {
      el.classList.remove('card-selected');
      el.removeAttribute('data-card-selected');
    });
    updateAlignmentButton();
  }
});

// Global Block Selector for side-by-side positioning & corner handle resizing
const GLOBAL_BLOCK_SELECTOR = '.media-card, .paperuss-embed, .paperuss-card-audio, .paperuss-card-file, .paperuss-card, .broken-media-card, [data-paperuss-embed="true"], img, .responsive-img-wrapper, .code-block-wrapper, pre.code-block, table, .table-wrapper, .callout-box, blockquote';

function hydrateGlobalBlockItems(targetContainer = document) {
  const container = targetContainer.closest ? (targetContainer.closest('#noteBody') || targetContainer) : document;
  if (!container.querySelectorAll) return;

  const blocks = container.querySelectorAll(GLOBAL_BLOCK_SELECTOR);

  blocks.forEach(block => {
    if (!block.closest('#noteBody')) return;

    if (!block.hasAttribute('draggable') && block.tagName !== 'IMG') {
      block.setAttribute('draggable', 'true');
    }

    if (!block.querySelector('.card-resize-handle') && block.tagName !== 'IMG' && !block.closest('.embed-canonical-card') && !block.closest('.embed-compact-card')) {
      const handle = document.createElement('div');
      handle.className = 'card-resize-handle';
      handle.title = 'Drag to resize & snap';
      block.appendChild(handle);
    }
  });
}
window.hydrateGlobalBlockItems = hydrateGlobalBlockItems;

// Drag-and-drop side-by-side card positioning system
let draggedCardElement = null;
let lastDropTargetEl = null;
let lastDropMode = null;
let lastPointerX = 0;
let lastPointerY = 0;
let autoScrollRAF = null;
let autoScrollDir = 0;
let autoScrollSpeed = 0;

// Viewport Edge Auto-Scroll Engine for Cards & Blocks
function updateAutoScrollOnDrag(clientY) {
  const scrollHost = document.getElementById('editorScroll') || document.querySelector('.main-content-scroll') || document.querySelector('.editor-container');
  const viewportHeight = window.innerHeight;
  const threshold = 75;

  if (clientY < threshold) {
    autoScrollDir = -1;
    autoScrollSpeed = Math.min(28, Math.max(5, (threshold - clientY) * 0.5));
  } else if (clientY > viewportHeight - threshold) {
    autoScrollDir = 1;
    autoScrollSpeed = Math.min(28, Math.max(5, (clientY - (viewportHeight - threshold)) * 0.5));
  } else {
    autoScrollDir = 0;
    if (autoScrollRAF) {
      cancelAnimationFrame(autoScrollRAF);
      autoScrollRAF = null;
    }
    return;
  }

  if (!autoScrollRAF) {
    const step = () => {
      if (autoScrollDir !== 0) {
        if (scrollHost && scrollHost.scrollHeight > scrollHost.clientHeight) {
          scrollHost.scrollTop += autoScrollDir * autoScrollSpeed;
        }
        window.scrollBy(0, autoScrollDir * autoScrollSpeed);
        autoScrollRAF = requestAnimationFrame(step);
      } else {
        autoScrollRAF = null;
      }
    };
    autoScrollRAF = requestAnimationFrame(step);
  }
}

function stopAutoScrollOnDrag() {
  autoScrollDir = 0;
  if (autoScrollRAF) {
    cancelAnimationFrame(autoScrollRAF);
    autoScrollRAF = null;
  }
}
window.updateAutoScrollOnDrag = updateAutoScrollOnDrag;
window.stopAutoScrollOnDrag = stopAutoScrollOnDrag;

// 4-Way Drop Detection with Hysteresis Anti-Shake Threshold (6px)
function detect4WayDropTargetWithHysteresis(targetEl, clientX, clientY) {
  if (!targetEl) return null;
  const rect = targetEl.getBoundingClientRect();
  const relX = (clientX - rect.left) / rect.width;
  const relY = (clientY - rect.top) / rect.height;

  const dist = Math.hypot(clientX - lastPointerX, clientY - lastPointerY);
  if (targetEl === lastDropTargetEl && dist < 6 && lastDropMode) {
    return lastDropMode;
  }

  lastPointerX = clientX;
  lastPointerY = clientY;

  let mode = 'bottom';
  if (relY < 0.25) {
    mode = 'top';
  } else if (relY > 0.75) {
    mode = 'bottom';
  } else if (relX > 0.5) {
    mode = 'right';
  } else {
    mode = 'left';
  }

  lastDropTargetEl = targetEl;
  lastDropMode = mode;
  return mode;
}

// Detach card from grid row to standalone 100% full-width non-grid mode
function detachCardFromGrid(card) {
  if (!card) return;
  const originRow = card.closest('.card-grid-row');

  // Strip all grid column classes and restore 100% full width preset
  card.classList.remove('grid-col-2', 'grid-col-3', 'grid-col-4');
  card.setAttribute('data-width-preset', 'full');
  card.className = card.className.replace(/\bembed-width-\S+/g, 'embed-width-full');

  // If card is still inside originRow, extract it out to standalone position in DOM
  if (originRow && originRow.contains(card)) {
    originRow.parentNode.insertBefore(card, originRow);
  }

  // Clean up originRow if empty or single remaining card
  if (originRow && originRow.isConnected) {
    const remainingCards = originRow.querySelectorAll('.paperuss-card, .paperuss-card-file, .paperuss-card-audio, .paperuss-card-video, .paperuss-embed, .media-card, img, table');
    if (remainingCards.length === 0) {
      originRow.remove();
    } else {
      reflowCardGridRows(originRow.parentNode || document.getElementById('noteBody'));
    }
  }
}
window.detachCardFromGrid = detachCardFromGrid;

// Handle 4-Way Drop Placement
function handleDropAction(draggedEl, targetEl, mode) {
  if (!draggedEl || !targetEl || draggedEl === targetEl) return;
  const noteBody = document.getElementById('noteBody');
  if (!noteBody) return;

  const originRow = draggedEl.closest('.card-grid-row');

  if (mode === 'top') {
    const targetRow = targetEl.closest('.card-grid-row') || targetEl;
    targetRow.parentNode.insertBefore(draggedEl, targetRow);
    detachCardFromGrid(draggedEl);
  } else if (mode === 'bottom') {
    const targetRow = targetEl.closest('.card-grid-row') || targetEl;
    targetRow.parentNode.insertBefore(draggedEl, targetRow.nextSibling);
    detachCardFromGrid(draggedEl);
  } else if (mode === 'left' || mode === 'right') {
    let targetRow = targetEl.closest('.card-grid-row');
    if (!targetRow) {
      targetRow = document.createElement('div');
      targetRow.className = 'card-grid-row grid-cols-2';
      targetEl.parentNode.insertBefore(targetRow, targetEl);
      targetRow.appendChild(targetEl);
    }

    const existingCards = targetRow.querySelectorAll('.paperuss-card, .paperuss-card-file, .paperuss-card-audio, .paperuss-card-video, .paperuss-embed, .media-card');
    if (existingCards.length >= 4 && !Array.from(existingCards).includes(draggedEl)) {
      const newRow = document.createElement('div');
      newRow.className = 'card-grid-row grid-cols-2';
      targetRow.parentNode.insertBefore(newRow, targetRow.nextSibling);
      newRow.appendChild(draggedEl);
    } else {
      if (mode === 'right') {
        targetEl.after(draggedEl);
      } else {
        targetEl.before(draggedEl);
      }
    }
  }

  if (originRow && originRow.isConnected) {
    reflowCardGridRows(originRow.parentNode);
  }
  reflowCardGridRows(noteBody);
}

document.addEventListener('dragstart', (e) => {
  const noteBody = document.getElementById('noteBody');
  if (!noteBody) return;
  const card = e.target.closest(GLOBAL_BLOCK_SELECTOR);
  if (card && noteBody.contains(card)) {
    draggedCardElement = card;
    card.classList.add('is-dragging');
    if (e.dataTransfer) {
      e.dataTransfer.setData('text/plain', '');
      e.dataTransfer.effectAllowed = 'move';
      const blankCanvas = document.createElement('canvas');
      blankCanvas.width = 1;
      blankCanvas.height = 1;
      if (e.dataTransfer.setDragImage) {
        e.dataTransfer.setDragImage(blankCanvas, 0, 0);
      }
    }
  }
});

document.addEventListener('dragend', () => {
  stopAutoScrollOnDrag();
  if (draggedCardElement) {
    draggedCardElement.classList.remove('is-dragging');
    draggedCardElement = null;
  }
  document.querySelectorAll('.drop-target-left, .drop-target-right, .drop-target-top, .drop-target-bottom').forEach(el => {
    el.classList.remove('drop-target-left', 'drop-target-right', 'drop-target-top', 'drop-target-bottom');
  });
});

document.addEventListener('dragover', (e) => {
  if (!draggedCardElement) return;
  const noteBody = document.getElementById('noteBody');
  if (!noteBody) return;

  updateAutoScrollOnDrag(e.clientY);

  const targetCard = e.target.closest(GLOBAL_BLOCK_SELECTOR);
  if (targetCard && noteBody.contains(targetCard) && targetCard !== draggedCardElement) {
    e.preventDefault();
    if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';

    const mode = detect4WayDropTargetWithHysteresis(targetCard, e.clientX, e.clientY);

    document.querySelectorAll('.drop-target-left, .drop-target-right, .drop-target-top, .drop-target-bottom').forEach(el => {
      if (el !== targetCard) el.classList.remove('drop-target-left', 'drop-target-right', 'drop-target-top', 'drop-target-bottom');
    });

    targetCard.classList.remove('drop-target-left', 'drop-target-right', 'drop-target-top', 'drop-target-bottom');
    targetCard.classList.add(`drop-target-${mode}`);
  }
});

document.addEventListener('dragleave', (e) => {
  if (!draggedCardElement) return;
  const targetCard = e.target.closest(GLOBAL_BLOCK_SELECTOR);
  if (targetCard && !targetCard.contains(e.relatedTarget)) {
    targetCard.classList.remove('drop-target-left', 'drop-target-right', 'drop-target-top', 'drop-target-bottom');
  }
});

function reflowCardGridRows(container = document) {
  const root = container.closest ? (container.closest('#noteBody') || container) : document;
  if (!root.querySelectorAll) return;

  const rows = root.querySelectorAll('.card-grid-row');
  rows.forEach(row => {
    Array.from(row.childNodes).forEach(child => {
      if (child.nodeType === 3) child.remove();
    });
    const cards = Array.from(row.querySelectorAll('.paperuss-card, .paperuss-card-file, .paperuss-card-audio, .paperuss-card-video, .paperuss-embed, .media-card'));
    const count = cards.length;

    if (count === 0) {
      row.remove();
      return;
    }

    if (count === 1) {
      const singleCard = cards[0];
      singleCard.classList.remove('grid-col-2', 'grid-col-3', 'grid-col-4');
      singleCard.setAttribute('data-width-preset', 'full');
      singleCard.className = singleCard.className.replace(/\bembed-width-\S+/g, 'embed-width-full');
      row.replaceWith(singleCard);
      return;
    }

    const numCols = Math.min(count, 4);
    row.className = `card-grid-row grid-cols-${numCols}`;
    row.setAttribute('data-grid-cols', numCols);

    cards.forEach(card => {
      card.classList.remove('grid-col-2', 'grid-col-3', 'grid-col-4');
      card.classList.add(`grid-col-${numCols}`);
      const preset = numCols >= 3 ? 'small' : 'medium';
      card.setAttribute('data-width-preset', preset);
      card.className = card.className.replace(/\bembed-width-\S+/g, `embed-width-${preset}`);
    });
  });
}
window.reflowCardGridRows = reflowCardGridRows;

function refreshCardComponentsAfterDrop(rootContainer) {
  const container = rootContainer || document.getElementById('noteBody') || document;
  if (!container) return;

  // Reset embed hydration flags so floating toolbars & iframe players re-mount cleanly
  const embeds = container.querySelectorAll('.paperuss-embed');
  embeds.forEach(embed => {
    embed.removeAttribute('data-hydrated');
    embed._needsRehydration = true;
  });

  if (typeof hydrateEmbeds === 'function') hydrateEmbeds(container);
  if (typeof hydrateSoundCards === 'function') hydrateSoundCards(container);
  if (typeof hydrateAudioCards === 'function') hydrateAudioCards(container);
  if (typeof hydrateAttachmentCards === 'function') hydrateAttachmentCards(container);
  if (typeof hydrateVideoCards === 'function') hydrateVideoCards(container);
  if (typeof hydrateGlobalBlockItems === 'function') hydrateGlobalBlockItems(container);

  if (typeof lucide !== 'undefined' && typeof lucide.createIcons === 'function') {
    lucide.createIcons();
    setTimeout(() => {
      if (typeof lucide !== 'undefined' && typeof lucide.createIcons === 'function') {
        lucide.createIcons();
      }
    }, 50);
  }
}
window.refreshCardComponentsAfterDrop = refreshCardComponentsAfterDrop;

document.addEventListener('drop', (e) => {
  stopAutoScrollOnDrag();
  if (!draggedCardElement) return;
  const noteBody = document.getElementById('noteBody');
  if (!noteBody) return;
  const targetCard = e.target.closest(GLOBAL_BLOCK_SELECTOR);
  if (targetCard && noteBody.contains(targetCard) && targetCard !== draggedCardElement) {
    e.preventDefault();
    const mode = detect4WayDropTargetWithHysteresis(targetCard, e.clientX, e.clientY);
    handleDropAction(draggedCardElement, targetCard, mode);

    draggedCardElement.classList.remove('is-dragging');
    document.querySelectorAll('.drop-target-left, .drop-target-right, .drop-target-top, .drop-target-bottom').forEach(el => {
      el.classList.remove('drop-target-left', 'drop-target-right', 'drop-target-top', 'drop-target-bottom');
    });

    draggedCardElement = null;
    if (typeof handleBodyInput === 'function') handleBodyInput();
    if (typeof save === 'function') save();
  } else if (!targetCard || !noteBody.contains(e.target)) {
    // Dropped off grid onto empty note area: detach card back to standalone full width
    detachCardFromGrid(draggedCardElement);
    draggedCardElement.classList.remove('is-dragging');
    draggedCardElement = null;
    if (typeof handleBodyInput === 'function') handleBodyInput();
    if (typeof save === 'function') save();
  }
});

// Touch Device Drag-Drop Optimization
let touchDragGhost = null;
let touchDragCard = null;

document.addEventListener('touchstart', (e) => {
  const handle = e.target.closest('.card-drag-handle, .file-card-header, .embed-editor-toolbar, .paperuss-card-file');
  if (!handle) return;
  const card = e.target.closest(GLOBAL_BLOCK_SELECTOR);
  const noteBody = document.getElementById('noteBody');
  if (!card || !noteBody || !noteBody.contains(card)) return;

  touchDragCard = card;
  const touch = e.touches[0];

  if (navigator.vibrate) navigator.vibrate(15);

  touchDragGhost = card.cloneNode(true);
  touchDragGhost.classList.add('touch-drag-ghost');
  touchDragGhost.style.width = `${card.offsetWidth}px`;
  touchDragGhost.style.left = `${touch.clientX - 20}px`;
  touchDragGhost.style.top = `${touch.clientY - 20}px`;
  document.body.appendChild(touchDragGhost);

  card.classList.add('is-dragging');
}, { passive: true });

document.addEventListener('touchmove', (e) => {
  if (!touchDragCard || !touchDragGhost) return;
  const touch = e.touches[0];

  touchDragGhost.style.left = `${touch.clientX - 20}px`;
  touchDragGhost.style.top = `${touch.clientY - 20}px`;

  updateAutoScrollOnDrag(touch.clientY);

  const elementUnderFinger = document.elementFromPoint(touch.clientX, touch.clientY);
  if (elementUnderFinger) {
    const targetCard = elementUnderFinger.closest(GLOBAL_BLOCK_SELECTOR);
    if (targetCard && targetCard !== touchDragCard) {
      const mode = detect4WayDropTargetWithHysteresis(targetCard, touch.clientX, touch.clientY);
      document.querySelectorAll('.drop-target-left, .drop-target-right, .drop-target-top, .drop-target-bottom').forEach(el => {
        if (el !== targetCard) el.classList.remove('drop-target-left', 'drop-target-right', 'drop-target-top', 'drop-target-bottom');
      });
      targetCard.className = targetCard.className.replace(/\bdrop-target-\S+/g, '');
      targetCard.classList.add(`drop-target-${mode}`);
    }
  }
}, { passive: true });

document.addEventListener('touchend', (e) => {
  stopAutoScrollOnDrag();
  if (touchDragGhost) {
    touchDragGhost.remove();
    touchDragGhost = null;
  }
  if (!touchDragCard) return;

  const touch = e.changedTouches[0];
  const elementUnderFinger = document.elementFromPoint(touch.clientX, touch.clientY);
  const targetCard = elementUnderFinger?.closest(GLOBAL_BLOCK_SELECTOR);

  if (targetCard && targetCard !== touchDragCard) {
    const mode = detect4WayDropTargetWithHysteresis(targetCard, touch.clientX, touch.clientY);
    handleDropAction(touchDragCard, targetCard, mode);
    if (navigator.vibrate) navigator.vibrate(15);
  } else if (!targetCard || !document.getElementById('noteBody')?.contains(elementUnderFinger)) {
    detachCardFromGrid(touchDragCard);
  }

  touchDragCard.classList.remove('is-dragging');
  document.querySelectorAll('.drop-target-left, .drop-target-right, .drop-target-top, .drop-target-bottom').forEach(el => {
    el.classList.remove('drop-target-left', 'drop-target-right', 'drop-target-top', 'drop-target-bottom');
  });

  touchDragCard = null;
  if (typeof handleBodyInput === 'function') handleBodyInput();
  if (typeof save === 'function') save();
});

document.addEventListener('touchcancel', () => {
  stopAutoScrollOnDrag();
  if (touchDragGhost) {
    touchDragGhost.remove();
    touchDragGhost = null;
  }
  if (touchDragCard) {
    touchDragCard.classList.remove('is-dragging');
    touchDragCard = null;
  }
  document.querySelectorAll('.drop-target-left, .drop-target-right, .drop-target-top, .drop-target-bottom, .drop-target').forEach(el => {
    el.classList.remove('drop-target-left', 'drop-target-right', 'drop-target-top', 'drop-target-bottom', 'drop-target');
  });
});

// Interactive Magnetic Card Resizer logic
let activeResizingCard = null;
let resizeStartX = 0;
let resizeStartWidth = 0;
let resizeTooltipEl = null;

document.addEventListener('mousedown', (e) => {
  const handle = e.target.closest('.card-resize-handle');
  if (!handle) return;
  const card = handle.closest(GLOBAL_BLOCK_SELECTOR);
  if (!card) return;
  if (!card) return;

  e.preventDefault();
  e.stopPropagation();

  activeResizingCard = card;
  resizeStartX = e.clientX;
  resizeStartWidth = card.getBoundingClientRect().width;

  handle.classList.add('is-resizing');

  // Create floating resize tooltip
  if (!resizeTooltipEl) {
    resizeTooltipEl = document.createElement('div');
    resizeTooltipEl.className = 'card-resize-tooltip';
    document.body.appendChild(resizeTooltipEl);
  }
  updateResizeTooltip(e.clientX, e.clientY, resizeStartWidth, calculateSnapPreset(resizeStartWidth));
});

function calculateSnapPreset(width) {
  if (width <= 290) return { preset: 'small', label: 'Small (220px)', snapWidth: 220 };
  if (width > 290 && width <= 550) return { preset: 'medium', label: 'Medium (420px)', snapWidth: 420 };
  if (width > 550 && width <= 760) return { preset: 'large', label: 'Large (680px)', snapWidth: 680 };
  return { preset: 'full', label: 'Full Width (100%)', snapWidth: null };
}

function updateResizeTooltip(x, y, currentWidth, snapInfo) {
  if (!resizeTooltipEl) return;
  resizeTooltipEl.style.left = `${x}px`;
  resizeTooltipEl.style.top = `${y}px`;
  resizeTooltipEl.textContent = `${Math.round(currentWidth)}px · ${snapInfo.label}`;
}

document.addEventListener('mousemove', (e) => {
  if (!activeResizingCard) return;

  const dx = e.clientX - resizeStartX;
  let newWidth = Math.max(160, resizeStartWidth + dx);
  const snapInfo = calculateSnapPreset(newWidth);

  // Magnetic Snapping feel when within 25px of target width
  if (snapInfo.snapWidth && Math.abs(newWidth - snapInfo.snapWidth) < 25) {
    newWidth = snapInfo.snapWidth;
  }

  if (snapInfo.preset === 'full') {
    activeResizingCard.style.width = '100%';
    activeResizingCard.style.maxWidth = '100%';
  } else {
    activeResizingCard.style.width = `${newWidth}px`;
    activeResizingCard.style.maxWidth = `${newWidth}px`;
  }

  updateResizeTooltip(e.clientX, e.clientY, newWidth, snapInfo);
});

document.addEventListener('mouseup', () => {
  if (!activeResizingCard) return;

  const handle = activeResizingCard.querySelector('.card-resize-handle');
  if (handle) handle.classList.remove('is-resizing');

  const currentWidth = activeResizingCard.getBoundingClientRect().width;
  const snapInfo = calculateSnapPreset(currentWidth);

  // Clear temporary inline width & apply permanent preset class
  activeResizingCard.style.width = '';
  activeResizingCard.style.maxWidth = '';

  if (activeResizingCard.classList.contains('paperuss-embed')) {
    if (typeof window.updateEmbedSetup === 'function') {
      window.updateEmbedSetup(activeResizingCard, { widthPreset: snapInfo.preset });
    }
  } else {
    // Media card class update
    activeResizingCard.classList.remove('embed-width-small', 'embed-width-medium', 'embed-width-large', 'embed-width-full', 'card-width-small', 'card-width-medium', 'card-width-large', 'card-width-full');
    activeResizingCard.classList.add(`embed-width-${snapInfo.preset}`, `card-width-${snapInfo.preset}`);
    activeResizingCard.setAttribute('data-width-preset', snapInfo.preset);
    if (activeResizingCard.classList.contains('paperuss-card-audio') && typeof hydrateSoundCards === 'function') {
      hydrateSoundCards(activeResizingCard);
    }
    if (activeResizingCard.classList.contains('paperuss-card-file') && typeof hydrateAttachmentCards === 'function') {
      hydrateAttachmentCards(activeResizingCard);
    }
  }

  if (resizeTooltipEl) {
    resizeTooltipEl.remove();
    resizeTooltipEl = null;
  }

  activeResizingCard = null;
  if (typeof handleBodyInput === 'function') handleBodyInput();
  if (typeof save === 'function') save();
});

// Inline Caret Placement Beside Cards
function ensureCardCaretAnchors() {
  const noteBody = document.getElementById('noteBody');
  if (!noteBody) return;
  const cards = noteBody.querySelectorAll('.media-card, .paperuss-embed, .paperuss-card-file, .paperuss-card-audio, .paperuss-card-video, .broken-media-card, [data-paperuss-embed="true"]');
  cards.forEach(card => {
    const row = card.closest('.card-grid-row');
    const anchorTarget = row || card;
    const parent = anchorTarget.parentNode;
    if (!parent) return;

    if (!anchorTarget.previousSibling || (anchorTarget.previousSibling.nodeType === 3 && !anchorTarget.previousSibling.nodeValue.includes('\u200B'))) {
      parent.insertBefore(document.createTextNode('\u200B'), anchorTarget);
    }
    if (!anchorTarget.nextSibling || (anchorTarget.nextSibling.nodeType === 3 && !anchorTarget.nextSibling.nodeValue.includes('\u200B'))) {
      parent.insertBefore(document.createTextNode('\u200B'), anchorTarget.nextSibling);
    }
  });
}
window.ensureCardCaretAnchors = ensureCardCaretAnchors;

function placeCaretNextToCard(card, position = 'after') {
  if (!card) return;
  const row = card.closest('.card-grid-row');
  const targetElement = row || card;
  ensureCardCaretAnchors();
  const sel = window.getSelection();
  if (!sel) return;
  const range = document.createRange();
  const targetNode = position === 'after' ? targetElement.nextSibling : targetElement.previousSibling;
  if (targetNode && targetNode.nodeType === 3) {
    range.setStart(targetNode, targetNode.nodeValue.length);
    range.collapse(true);
    sel.removeAllRanges();
    sel.addRange(range);
  }
}
window.placeCaretNextToCard = placeCaretNextToCard;

// Keyboard Media Safeguard System: Protect cards from accidental removal via keyboard
document.addEventListener('keydown', (e) => {
  const noteBody = document.getElementById('noteBody');
  if (!noteBody) return;

  // Prevent Enter key inside inline editable card fields from breaking card layout or inserting new paragraphs
  const editableTarget = e.target.closest && e.target.closest('[data-action^="inline-edit"], .card-title-text, .embed-fallback-desc');
  if (editableTarget) {
    if (e.key === 'Enter' || e.keyCode === 13) {
      e.preventDefault();
      e.stopPropagation();
      editableTarget.blur();
      if (typeof handleBodyInput === 'function') handleBodyInput();
      if (typeof save === 'function') save();
      return;
    }
  }

  const isDeleteKey = e.key === 'Backspace' || e.key === 'Delete' || e.keyCode === 8 || e.keyCode === 46;

  // Clear deletion warnings on non-delete keypress
  if (!isDeleteKey) {
    document.querySelectorAll('#noteBody [data-deletion-warning="true"]').forEach(el => {
      el.removeAttribute('data-deletion-warning');
      el.classList.remove('card-deletion-warning');
    });
  }

  const selectedCard = document.querySelector('#noteBody .card-selected, #noteBody [data-card-selected="true"]');
  if (selectedCard) {
    if (e.key === 'ArrowRight') {
      e.preventDefault();
      selectedCard.classList.remove('card-selected', 'card-deletion-warning');
      selectedCard.removeAttribute('data-card-selected');
      selectedCard.removeAttribute('data-deletion-warning');
      placeCaretNextToCard(selectedCard, 'after');
      if (typeof updateAlignmentButton === 'function') updateAlignmentButton();
      return;
    } else if (e.key === 'ArrowLeft') {
      e.preventDefault();
      selectedCard.classList.remove('card-selected', 'card-deletion-warning');
      selectedCard.removeAttribute('data-card-selected');
      selectedCard.removeAttribute('data-deletion-warning');
      placeCaretNextToCard(selectedCard, 'before');
      if (typeof updateAlignmentButton === 'function') updateAlignmentButton();
      return;
    } else if ((e.ctrlKey || e.metaKey) && (e.key === 'd' || e.key === 'D')) {
      e.preventDefault();
      e.stopPropagation();
      const clone = selectedCard.cloneNode(true);
      clone.classList.add('card-selected');
      clone.setAttribute('data-card-selected', 'true');
      selectedCard.classList.remove('card-selected', 'card-deletion-warning');
      selectedCard.removeAttribute('data-card-selected');
      selectedCard.removeAttribute('data-deletion-warning');

      if (selectedCard.nextSibling) {
        selectedCard.parentNode.insertBefore(clone, selectedCard.nextSibling);
      } else {
        selectedCard.parentNode.appendChild(clone);
      }

      if (typeof hydrateEmbeds === 'function') hydrateEmbeds(clone.parentNode);
      if (typeof hydrateAttachmentCards === 'function') hydrateAttachmentCards(clone.parentNode);
      if (typeof hydrateAudioCards === 'function') hydrateAudioCards(clone.parentNode);
      if (typeof hydrateVideoCards === 'function') hydrateVideoCards(clone.parentNode);

      if (typeof toast === 'function') toast('Card duplicated');
      if (typeof handleBodyInput === 'function') handleBodyInput();
      if (typeof save === 'function') save();
      return;
    } else if (e.key === 'Escape') {
      e.preventDefault();
      selectedCard.classList.remove('card-selected', 'card-deletion-warning');
      selectedCard.removeAttribute('data-card-selected');
      selectedCard.removeAttribute('data-deletion-warning');
      if (typeof updateAlignmentButton === 'function') updateAlignmentButton();
      return;
    } else if (isDeleteKey) {
      const isWarned = selectedCard.getAttribute('data-deletion-warning') === 'true';
      if (!isWarned) {
        // Step 1: Arm deletion warning safeguard
        e.preventDefault();
        e.stopPropagation();
        selectedCard.setAttribute('data-deletion-warning', 'true');
        selectedCard.classList.add('card-deletion-warning');
        return;
      } else {
        // Step 2: Second Backspace/Delete keypress confirms removal
        e.preventDefault();
        e.stopPropagation();
        const nextTarget = selectedCard.nextSibling || selectedCard.previousSibling;
        selectedCard.remove();
        if (nextTarget && nextTarget.nodeType === 3) {
          const sel = window.getSelection();
          if (sel) {
            const range = document.createRange();
            range.setStart(nextTarget, 0);
            range.collapse(true);
            sel.removeAllRanges();
            sel.addRange(range);
          }
        }
        if (typeof handleBodyInput === 'function') handleBodyInput();
        if (typeof save === 'function') save();
        if (typeof updateAlignmentButton === 'function') updateAlignmentButton();
        return;
      }
    }
  }

  // Caret-adjacent card safeguard (when typing text right next to a card)
  if (isDeleteKey) {
    const sel = window.getSelection();
    if (sel && sel.anchorNode) {
      let targetCard = null;
      if (e.key === 'Backspace') {
        if (sel.anchorNode.nodeType === 3 && sel.anchorOffset === 0) {
          const prev = sel.anchorNode.previousSibling;
          if (prev && prev.nodeType === 1 && prev.matches('.media-card, .paperuss-embed, .link-card, .broken-media-card, [data-paperuss-embed="true"]')) {
            targetCard = prev;
          }
        }
      } else if (e.key === 'Delete') {
        if (sel.anchorNode.nodeType === 3 && sel.anchorOffset === sel.anchorNode.nodeValue.length) {
          const next = sel.anchorNode.nextSibling;
          if (next && next.nodeType === 1 && next.matches('.media-card, .paperuss-embed, .link-card, .broken-media-card, [data-paperuss-embed="true"]')) {
            targetCard = next;
          }
        }
      }

      if (targetCard) {
        const isWarned = targetCard.getAttribute('data-deletion-warning') === 'true';
        if (!isWarned) {
          e.preventDefault();
          e.stopPropagation();
          document.querySelectorAll('#noteBody .card-selected').forEach(c => {
            c.classList.remove('card-selected', 'card-deletion-warning');
            c.removeAttribute('data-card-selected');
            c.removeAttribute('data-deletion-warning');
          });
          targetCard.classList.add('card-selected', 'card-deletion-warning');
          targetCard.setAttribute('data-card-selected', 'true');
          targetCard.setAttribute('data-deletion-warning', 'true');
          if (typeof updateAlignmentButton === 'function') updateAlignmentButton();
          return;
        }
      }
    }
  }
});

// Between-card click caret positioning handler
document.addEventListener('click', (e) => {
  const noteBody = document.getElementById('noteBody');
  if (!noteBody || !noteBody.contains(e.target)) return;

  // Don't interfere if clicking inside interactive buttons, inputs, links or toolbars
  if (e.target.closest('button, a, input, select, textarea, .card-resize-handle, .embed-editor-toolbar, .overflow-dropdown')) return;

  const cards = Array.from(noteBody.querySelectorAll('.media-card, .paperuss-embed, .broken-media-card, [data-paperuss-embed="true"]'));
  if (!cards.length) return;

  const clickX = e.clientX;
  const clickY = e.clientY;

  for (let i = 0; i < cards.length; i++) {
    const card = cards[i];
    const rect = card.getBoundingClientRect();

    // Check if click Y aligns with the card row (within 16px vertical bounds)
    if (clickY >= rect.top - 16 && clickY <= rect.bottom + 16) {
      if (clickX < rect.left && (i === 0 || cards[i - 1].getBoundingClientRect().right <= rect.left)) {
        placeCaretNextToCard(card, 'before');
        break;
      } else if (clickX > rect.right) {
        const nextCard = cards[i + 1];
        if (!nextCard || nextCard.getBoundingClientRect().top > rect.bottom) {
          placeCaretNextToCard(card, 'after');
          break;
        } else if (clickX < nextCard.getBoundingClientRect().left) {
          // Clicked in the horizontal gap BETWEEN card and nextCard!
          placeCaretNextToCard(card, 'after');
          break;
        }
      }
    }
  }
});

function updateAlignmentButton(){
  const btn=document.getElementById('alignBtn');
  if(!btn) return;
  const sel=window.getSelection();
  let mediaBlock=null;
  if(sel && sel.anchorNode){
    let node=sel.anchorNode.nodeType===3 ? sel.anchorNode.parentElement : sel.anchorNode;
    mediaBlock=node?.closest?.('.paperuss-embed, .media-card, .broken-media-card, [data-paperuss-embed="true"]');
  }
  if (!mediaBlock) {
    mediaBlock = document.querySelector('#noteBody .card-selected, #noteBody [data-card-selected="true"]');
  }

  const isMedia = !!mediaBlock;
  btn.classList.toggle('media-target-active', isMedia);

  const cur=currentAlignment();
  btn.setAttribute('data-align', cur);

  const ALIGN_LABEL = {
    left: 'Float Left (Text wraps right)',
    center: 'Center Block (No wrap)',
    right: 'Float Right (Text wraps left)',
    full: 'Full Width (Clear floats)',
    justify: 'Full Width'
  };

  btn.title = (isMedia ? 'Card Alignment: ' : 'Text Alignment: ') + (ALIGN_LABEL[cur] || 'Left');

  const iconEl=btn.querySelector('i');
  if(iconEl){
    iconEl.setAttribute('data-lucide', ALIGN_ICON[cur]||'align-left');
    if (typeof refreshIcons === 'function') refreshIcons();
  }

  // Update active state in alignDropdown segment picker
  document.querySelectorAll('#alignDropdown .align-seg-opt').forEach(opt => {
    const val = opt.getAttribute('data-align-val');
    opt.classList.toggle('active', val === cur || (val === 'full' && cur === 'justify'));
  });
}

// Toggle alignment dropdown with position:fixed positioning so it never gets clipped by toolbar/editor overflow
document.addEventListener('click', (e) => {
  const alignBtn = e.target.closest('#alignBtn');
  const dropdown = document.getElementById('alignDropdown');

  if (alignBtn && dropdown) {
    e.preventDefault();
    e.stopPropagation();
    const isHidden = dropdown.classList.contains('hidden');
    if (isHidden) {
      const rect = alignBtn.getBoundingClientRect();
      dropdown.style.position = 'fixed';
      dropdown.style.top = (rect.bottom + 6) + 'px';
      dropdown.style.left = (rect.left + rect.width / 2) + 'px';
      dropdown.style.transform = 'translateX(-50%)';
      dropdown.style.zIndex = '100000';
      dropdown.classList.remove('hidden');
    } else {
      dropdown.classList.add('hidden');
    }
    return;
  }

  const segOpt = e.target.closest('#alignDropdown .align-seg-opt');
  if (segOpt) {
    e.preventDefault();
    e.stopPropagation();
    const val = segOpt.getAttribute('data-align-val');
    applyAlignment(val);
    if (dropdown) dropdown.classList.add('hidden');
    return;
  }

  if (dropdown && !e.target.closest('#alignPickerWrap') && !e.target.closest('#alignDropdown')) {
    dropdown.classList.add('hidden');
  }
});

function updateToolbarState(){
  const listCtx = typeof getListContext === 'function' ? getListContext() : (typeof _listContext === 'function' ? _listContext() : null);
  const isTask = listCtx && listCtx.type === 'task';
  const isUl = listCtx && listCtx.type === 'ul';
  const isOl = listCtx && listCtx.type === 'ol';
  const cmds=['bold','italic','underline','strikeThrough'];

  document.querySelectorAll('#formatBar .tool-btn, .overflow-dropdown .tool-btn').forEach(btn=>{
    const cmd=btn.dataset.cmd;
    if(cmd === 'task'){
      btn.classList.toggle('active', !!isTask);
    } else if(cmd === 'insertUnorderedList'){
      btn.classList.toggle('active', !!isUl);
    } else if(cmd === 'insertOrderedList'){
      btn.classList.toggle('active', !!isOl);
    } else if(cmds.includes(cmd)){
      try{ btn.classList.toggle('active', document.queryCommandState(cmd)); }
      catch(e){ btn.classList.remove('active'); }
    } else if(!['hilite','textColor','fontSize','formatBlock'].includes(cmd)) {
      btn.classList.remove('active');
    }
  });
  // Update size dropdown label
  const szBtn=document.getElementById('szBtn');
  if(szBtn){
    const size=getActiveFontSize();
    const labels={'13px':'Sm','15px':'N','18px':'Lg','22px':'Hg','28px':'Mx'};
    if(size && labels[size]){
      szBtn.innerHTML=`${labels[size]} <svg width="10" height="10" viewBox="0 0 16 16" fill="currentColor" style="margin-left:2px"><path d="M4.47 5.22a.75.75 0 0 0 0 1.06L7.03 9l-2.56 2.56a.75.75 0 1 0 1.06 1.06L8.97 9.19a.75.75 0 0 0 0-1.06L5.53 5.22a.75.75 0 0 0-1.06 0Z"/></svg>`;
    } else {
      szBtn.innerHTML=`Size <svg width="10" height="10" viewBox="0 0 16 16" fill="currentColor" style="margin-left:2px"><path d="M4.47 5.22a.75.75 0 0 0 0 1.06L7.03 9l-2.56 2.56a.75.75 0 1 0 1.06 1.06L8.97 9.19a.75.75 0 0 0 0-1.06L5.53 5.22a.75.75 0 0 0-1.06 0Z"/></svg>`;
    }
  }
  // Update size dropdown active state
  const activeSz=getActiveFontSize();
  document.querySelectorAll('.sz-opt').forEach(o=>o.classList.toggle('active', o.dataset.val===(activeSz||'')));
  if(typeof updateAlignmentButton==='function') updateAlignmentButton();
  
  // Update Paragraph Style label
  const paraStyleBtn = document.getElementById('paraStyleLabel');
  if(paraStyleBtn) {
    const activeBlock = typeof getActiveParagraphStyle === 'function' ? getActiveParagraphStyle() : 'p';
    const psLabels = {'p':'Normal text','h1-title':'Title','p-subtitle':'Subtitle','h2':'Heading 1','h3':'Heading 2','h4':'Heading 3'};
    paraStyleBtn.textContent = psLabels[activeBlock] || 'Normal text';
    document.querySelectorAll('.ps-opt').forEach(o => o.classList.toggle('active', o.dataset.val === activeBlock));
  }
}

/* ============================================================
   THEME
   ============================================================ */
const THEME_MODE_DEFAULTS={
  dark:'dark', light:'light', paper:'light', 'olive-groove':'light',
  'rose-pine':'dark', nord:'dark', ember:'dark'
};

function normalizeThemeMode(mode){
  return mode==='dark' ? 'dark' : 'light';
}

function getThemeMode(){
  const saved=localStorage.getItem(THEME_MODE_KEY);
  if(saved==='dark' || saved==='light') return saved;
  const theme=document.documentElement.getAttribute('data-theme')||'olive-groove';
  return THEME_MODE_DEFAULTS[theme]||'light';
}

function syncThemePresentation(theme,mode){
  const root=document.documentElement;
  root.style.colorScheme=mode;
  const themeMeta=document.querySelector('meta[name="theme-color"]');
  const surface=getComputedStyle(root).getPropertyValue('--header-bg').trim();
  if(themeMeta && surface) themeMeta.setAttribute('content',surface);
  const themeSel=document.getElementById('setTheme');
  if(themeSel) themeSel.value=theme;
  const icon=document.getElementById('themeIcon');
  if(icon){
    icon.setAttribute('data-lucide',mode==='dark' ? 'sun' : 'moon');
    icon.setAttribute('title',mode==='dark' ? 'Switch to light mode' : 'Switch to dark mode');
    icon.innerHTML='';
    if(typeof refreshIcons==='function') refreshIcons();
  }
  const modeSel=document.getElementById('setThemeMode');
  if(modeSel) modeSel.value=mode;
}

function setTheme(theme,trackChange=true){
  const supportedThemes=['dark','light','paper','olive-groove','rose-pine','nord','ember'];
  if(!supportedThemes.includes(theme)) theme='olive-groove';
  const savedMode=localStorage.getItem(THEME_MODE_KEY);
  const mode=(savedMode==='dark' || savedMode==='light')
    ? savedMode
    : (THEME_MODE_DEFAULTS[theme]||'light');
  document.documentElement.setAttribute('data-theme',theme);
  document.documentElement.setAttribute('data-theme-mode',mode);
  localStorage.setItem(THEME_KEY,theme);
  localStorage.setItem(THEME_MODE_KEY,mode);
  syncThemePresentation(theme,mode);
  if(trackChange && typeof markPortableStateChanged==='function') markPortableStateChanged();
  if(typeof applyAccent==='function') applyAccent((typeof appSettings!=='undefined'&&appSettings.accent)||'blue');
}

function setThemeMode(mode,trackChange=true){
  mode=normalizeThemeMode(mode);
  const theme=document.documentElement.getAttribute('data-theme')||'olive-groove';
  document.documentElement.setAttribute('data-theme-mode',mode);
  localStorage.setItem(THEME_MODE_KEY,mode);
  syncThemePresentation(theme,mode);
  if(trackChange && typeof markPortableStateChanged==='function') markPortableStateChanged();
  if(typeof applyAccent==='function') applyAccent((typeof appSettings!=='undefined'&&appSettings.accent)||'blue');
}

/* ============================================================
   REMOTE & EXPIRED IMAGE AUTO-CAPTURE AND RECOVERY
   ============================================================ */
function isPreviewImageElement(img){
  if(!img || !(img instanceof Element)) return false;
  if(img.closest('.paperuss-embed, .embed-canonical-card, .embed-hero-wrap, .embed-provider-badge-wrap, .link-card, .media-card[data-media-kind="link"], .mc-icon, a[data-media-kind="link"], .mh-thumb, [data-mh-preview-image]')){
    return true;
  }
  if(img.classList.contains('favicon') || img.classList.contains('v2-thumbnail') || img.classList.contains('domain-icon') || img.classList.contains('embed-placeholder-thumb') || img.classList.contains('embed-favicon-icon') || img.classList.contains('embed-fallback-thumb') || img.classList.contains('inline-link-icon')){
    return true;
  }
  return false;
}
window.isPreviewImageElement = isPreviewImageElement;

function repairMalformedLinkCards(container = document.getElementById('noteBody')){
  if(!container) return;
  const malformedCards = container.querySelectorAll('.paperuss-embed .broken-media-card, .link-card .broken-media-card, a[data-media-kind="link"] .broken-media-card, .mc-icon .broken-media-card, .media-card[data-media-kind="link"] .broken-media-card');
  malformedCards.forEach(bmc => {
    bmc.remove();
  });
  if(typeof refreshIcons === 'function') refreshIcons();
}
window.repairMalformedLinkCards = repairMalformedLinkCards;

function setupBrokenImageElement(img){
  if(!img || img.dataset.brokenHandled) return;
  img.dataset.brokenHandled = 'true';

  if(isPreviewImageElement(img)){
    const placeholder = document.createElement('span');
    placeholder.className = 'domain-icon-placeholder';
    placeholder.style.cssText = 'display:inline-flex;align-items:center;justify-content:center;width:100%;height:100%;color:inherit;';
    placeholder.innerHTML = '<i data-lucide="globe" class="w-4 h-4"></i>';
    img.replaceWith(placeholder);
    if(typeof refreshIcons === 'function') refreshIcons();
    return;
  }

  const src = img.getAttribute('src') || '';
  const alt = img.getAttribute('alt') || img.getAttribute('title') || 'Image attachment';
  const wrapper = document.createElement('div');
  wrapper.className = 'broken-media-card';
  wrapper.setAttribute('contenteditable', 'false');
  wrapper.innerHTML = `
    <div class="bmc-content">
      <i data-lucide="image-off" class="w-5 h-5"></i>
      <div class="bmc-info">
        <span class="bmc-title">${esc(alt)}</span>
        <span class="bmc-sub">Image unavailable</span>
        ${src ? `<a href="${esc(src)}" target="_blank" rel="noopener noreferrer" class="bmc-link">${esc(src)}</a>` : ''}
      </div>
    </div>
    <div class="bmc-actions">
      <button type="button" class="bmc-replace-btn"><i data-lucide="upload" class="w-4 h-4"></i> Re-upload</button>
      <button type="button" class="bmc-remove-btn"><i data-lucide="trash-2" class="w-4 h-4"></i> Remove</button>
    </div>
  `;

  const replaceBtn = wrapper.querySelector('.bmc-replace-btn');
  if(replaceBtn){
    replaceBtn.onclick = (e) => {
      e.preventDefault();
      e.stopPropagation();
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = 'image/*';
      input.onchange = async () => {
        if(input.files && input.files[0]){
          const file = input.files[0];
          try {
            const id = await saveMediaBlob(file, file.name, 'image');
            const localUrl = await getMediaURL(id);
            if(typeof urlCache !== 'undefined') urlCache.set(id, localUrl);
            const newImg = document.createElement('img');
            newImg.setAttribute('data-media-id', id);
            newImg.setAttribute('data-media-kind', 'image');
            newImg.src = localUrl;
            newImg.alt = esc(file.name);
            wrapper.replaceWith(newImg);
            toast('Image replaced & saved');
            save();
            renderStorageStats();
          } catch(err){
            toast('Could not replace image');
          }
        }
      };
      input.click();
    };
  }

  const removeBtn = wrapper.querySelector('.bmc-remove-btn');
  if(removeBtn){
    removeBtn.onclick = (e) => {
      e.preventDefault();
      e.stopPropagation();
      wrapper.remove();
      toast('Image removed');
      save();
    };
  }

  img.replaceWith(wrapper);
  if(typeof refreshIcons === 'function') refreshIcons();
}

async function autoCaptureExternalImages(){
  const ed = document.getElementById('noteBody');
  if(!ed) return;
  const imgs = Array.from(ed.querySelectorAll('img')).filter(img => {
    const src = img.getAttribute('src') || '';
    const hasMediaId = img.hasAttribute('data-media-id');
    return !hasMediaId && !isPreviewImageElement(img) && (src.startsWith('http://') || src.startsWith('https://') || src.startsWith('blob:'));
  });

  for(const img of imgs){
    const src = img.getAttribute('src');
    if(!src || img.dataset.capturing) continue;

    img.onerror = () => setupBrokenImageElement(img);
    if(img.complete && img.naturalWidth === 0){
      setupBrokenImageElement(img);
      continue;
    }

    img.dataset.capturing = 'true';
    const altName = img.getAttribute('alt') || 'chatgpt_image.png';

    try {
      const res = await fetch(src);
      if(!res.ok) throw new Error('Fetch failed ' + res.status);
      const blob = await res.blob();
      if(!blob.type.startsWith('image/')) throw new Error('Not an image blob');

      const id = await saveMediaBlob(blob, altName, 'image');
      const localUrl = await getMediaURL(id);
      if(typeof urlCache !== 'undefined') urlCache.set(id, localUrl);
      img.setAttribute('data-media-id', id);
      img.setAttribute('data-media-kind', 'image');
      img.src = localUrl;
      delete img.dataset.capturing;
      toast('Captured ChatGPT image locally');
      save();
      renderStorageStats();
    } catch(err){
      console.warn('PapeRuss: Remote image fetch failed or CORS restricted', src, err);
      delete img.dataset.capturing;
      if(!img.naturalWidth) setupBrokenImageElement(img);
    }
  }
}

// Sound Card Playback & Material 3 Seeker Delegation
function formatAudioTimeSec(sec){
  if(isNaN(sec) || !isFinite(sec) || sec < 0) return '0:00';
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${s < 10 ? '0' : ''}${s}`;
}

document.addEventListener('click', async e => {
  const playBtn = e.target.closest('[data-action="audio-toggle-play"]');
  if (playBtn) {
    const card = playBtn.closest('.paperuss-card-audio');
    if (!card) return;
    const audio = card.querySelector('.audio-native-player');
    if (!audio) return;

    const mediaId = card.getAttribute('data-media-id') || audio.getAttribute('data-media-id');
    if (mediaId && (!audio.src || audio.src === window.location.href || audio.src.endsWith('#') || audio.error)) {
      if (typeof getMediaURL === 'function') {
        const url = await getMediaURL(mediaId);
        if (url) {
          audio.removeAttribute('data-missing');
          audio.src = url;
          try { audio.load(); } catch(_) {}
        }
      }
    }

    if (audio.paused) {
      document.querySelectorAll('.audio-native-player').forEach(a => { if (a !== audio) a.pause(); });
      try {
        await audio.play();
      } catch(err) {
        if (mediaId && typeof getMediaURL === 'function') {
          const freshUrl = await getMediaURL(mediaId);
          if (freshUrl) {
            audio.src = freshUrl;
            try { audio.load(); } catch(_) {}
            audio.play().catch(_ => {});
          }
        }
      }
    } else {
      audio.pause();
    }
    return;
  }

  const seeker = e.target.closest('[data-action="audio-seek"]');
  if (seeker) {
    const card = seeker.closest('.paperuss-card-audio');
    if (!card) return;
    const audio = card.querySelector('.audio-native-player');
    if (!audio || !audio.duration) return;
    const rect = seeker.getBoundingClientRect();
    const clickX = e.clientX - rect.left;
    const ratio = Math.max(0, Math.min(1, clickX / rect.width));
    audio.currentTime = ratio * audio.duration;
  }
});

document.addEventListener('play', e => {
  if (e.target && e.target.classList?.contains('audio-native-player')) {
    const card = e.target.closest('.paperuss-card-audio');
    if (!card) return;
    card.classList.add('is-playing');
    card.querySelectorAll('.audio-hero-center').forEach(h => h.classList.add('is-playing'));
    card.querySelectorAll('.audio-play-icon').forEach(ic => ic.classList.add('hidden'));
    card.querySelectorAll('.audio-pause-icon').forEach(ic => ic.classList.remove('hidden'));
  }
}, true);

document.addEventListener('pause', e => {
  if (e.target && e.target.classList?.contains('audio-native-player')) {
    const card = e.target.closest('.paperuss-card-audio');
    if (!card) return;
    card.classList.remove('is-playing');
    card.querySelectorAll('.audio-hero-center').forEach(h => h.classList.remove('is-playing'));
    card.querySelectorAll('.audio-play-icon').forEach(ic => ic.classList.remove('hidden'));
    card.querySelectorAll('.audio-pause-icon').forEach(ic => ic.classList.add('hidden'));
  }
}, true);

document.addEventListener('timeupdate', e => {
  const audio = e.target;
  if (audio && audio.classList?.contains('audio-native-player')) {
    const card = audio.closest('.paperuss-card-audio');
    if (!card) return;
    const curTimeEl = card.querySelector('.audio-cur-time');
    const durTimeEl = card.querySelector('.audio-dur-time');
    const fillEl = card.querySelector('.m3-seeker-fill, .audio-progress-fill');
    const thumbEl = card.querySelector('.m3-seeker-thumb, .audio-scrubber-handle');

    if (curTimeEl) curTimeEl.textContent = formatAudioTimeSec(audio.currentTime);
    if (durTimeEl && audio.duration) durTimeEl.textContent = formatAudioTimeSec(audio.duration);

    if (audio.duration) {
      const pct = (audio.currentTime / audio.duration) * 100;
      if (fillEl) fillEl.style.width = `${pct}%`;
      if (thumbEl) thumbEl.style.left = `${pct}%`;
    }
  }
}, true);

document.addEventListener('click', e => {
  const infoBtn = e.target.closest('#imgTbInfo, [data-action="open-media-info"], [data-action="open-info"], .card-info-btn');
  if (infoBtn) {
    e.preventDefault();
    e.stopPropagation();
    
    let target = null;
    if (infoBtn.id === 'imgTbInfo' || infoBtn.closest('#imgToolbar')) {
      target = (typeof selectedImg !== 'undefined' ? selectedImg : null) || (typeof hoveredImg !== 'undefined' ? hoveredImg : null) || document.querySelector('.img-selected');
    }
    
    const card = infoBtn.closest('[data-media-id], [data-canonical-url]') || infoBtn.closest('.paperuss-card, .paperuss-card-audio, .paperuss-card-file, .paperuss-embed, .media-card, img');
    
    const mediaId = infoBtn.getAttribute('data-media-id') ||
                    (target ? (target.getAttribute('data-media-id') || target.src) : null) ||
                    (card ? (card.getAttribute('data-media-id') || card.getAttribute('data-canonical-url')) : null);
                    
    if (mediaId) {
      if (typeof showMediaInfoModal === 'function') {
        showMediaInfoModal(mediaId);
      } else if (typeof selectMediaAsset === 'function') {
        selectMediaAsset(mediaId);
      }
    }
  }
});
