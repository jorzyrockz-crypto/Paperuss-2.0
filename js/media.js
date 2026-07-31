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
  if(!url) return;
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

  // Move caret after the inserted block + add an empty paragraph so users can keep typing
  const br=document.createElement('p'); br.innerHTML='<br>';
  if(last && last.parentNode){ last.parentNode.insertBefore(br, last.nextSibling); }
  try{
    const r=document.createRange(); r.setStart(br,0); r.collapse(true);
    sel.removeAllRanges(); sel.addRange(r);
    savedEditorRange=r.cloneRange();
  }catch(_){}
  handleBodyInput();
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
  // NOTE: Do NOT save() here — saveMediaBlob must complete first, otherwise
  // a failed/interrupted save leaves a permanent broken image reference in the note.

  // 2. Downscale + save to IndexedDB + queue cloud sync (runs in background)
  try {
    const realId = await saveMediaBlob(file, file.name, 'image', id);
    const targetId = realId || id;
    if(realId && realId !== id){
      // SHA-256 de-duplication matched an existing blob ID
      const imgEl = document.querySelector(`img[data-media-id="${id}"]`);
      if(imgEl) imgEl.setAttribute('data-media-id', realId);
    }
    const dbUrl = await getMediaURL(targetId);
    if(typeof urlCache !== 'undefined') urlCache.set(targetId, dbUrl);
    const imgEl = document.querySelector(`img[data-media-id="${targetId}"]`);
    if(imgEl){
      imgEl.src = dbUrl;
    }
    save();
    toast('Image added');
    renderStorageStats();
  } catch(err){
    const imgEl = document.querySelector(`img[data-media-id="${id}"]`);
    if(imgEl) imgEl.remove();
    URL.revokeObjectURL(tempUrl);
    save(); // save after removing the broken reference
    console.error('PapeRuss: image save error', err);
    toast('Could not add image — please try again');
  }
}


async function insertVideoFile(file){
  if(!file || !file.type.startsWith('video/')){ toast('Not a video'); return; }
  const id=await saveMediaBlob(file, file.name, 'video');
  const url=await getMediaURL(id);
  insertHTMLAtCaret(`<video controls preload="metadata" data-media-id="${id}" data-media-kind="video" src="${url}"></video>`);
  save();
  toast('Video added');
  renderStorageStats();
}
async function insertAudioFile(file){
  if(!file || !file.type.startsWith('audio/')){ toast('Not an audio file'); return; }
  const id=await saveMediaBlob(file, file.name, 'audio');
  const url=await getMediaURL(id);
  insertHTMLAtCaret(`<audio controls preload="metadata" data-media-id="${id}" data-media-kind="audio" src="${url}"></audio>`);
  save();
  toast('Audio added');
  renderStorageStats();
}
async function insertAudioBlob(blob, name='Voice recording'){
  const id=await saveMediaBlob(blob, name, 'audio');
  const url=await getMediaURL(id);
  insertHTMLAtCaret(`<audio controls preload="metadata" data-media-id="${id}" data-media-kind="audio" src="${url}"></audio>`);
  save();
  toast('Recording added');
  renderStorageStats();
}
async function insertAttachmentFile(file){
  if(!file){ return; }
  const id=await saveMediaBlob(file, file.name, 'file');
  const iconSVG=fileIconSVG(file.type, file.name);
  insertHTMLAtCaret(
    `<div class="media-card" contenteditable="false" data-media-id="${id}" data-media-kind="file" data-drop-block="1">
      <div class="mc-icon">${iconSVG}</div>
      <div class="mc-body">
        <div class="mc-title">${esc(file.name)}</div>
        <div class="mc-meta">${esc(file.type||'file')} · ${formatBytes(file.size)}</div>
      </div>
      <button class="mc-action" data-mc-download="${id}" data-mc-name="${esc(file.name)}">Download</button>
    </div>`
  );
  save();
  toast('File attached');
  renderStorageStats();
}

function fileIconSVG(type,name){
  const ext=(name||'').split('.').pop().toLowerCase();
  if(type.startsWith('image/')) return '<svg width="20" height="20" viewBox="0 0 16 16" fill="currentColor"><path d="M1.75 2.5a.25.25 0 0 0-.25.25v10.5c0 .138.112.25.25.25h12.5a.25.25 0 0 0 .25-.25V2.75a.25.25 0 0 0-.25-.25ZM0 2.75C0 1.784.784 1 1.75 1h12.5c.966 0 1.75.784 1.75 1.75v10.5A1.75 1.75 0 0 1 14.25 15H1.75A1.75 1.75 0 0 1 0 13.25Zm5 2.5a1.5 1.5 0 1 1-3 0 1.5 1.5 0 0 1 3 0Z"/></svg>';
  if(type.startsWith('audio/')) return '<svg width="20" height="20" viewBox="0 0 16 16" fill="currentColor"><path d="M8 1a3 3 0 0 0-3 3v4a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3Z"/></svg>';
  if(type.startsWith('video/')) return '<svg width="20" height="20" viewBox="0 0 16 16" fill="currentColor"><path d="M0 4.75C0 3.784.784 3 1.75 3h8.5c.966 0 1.75.784 1.75 1.75v6.5A1.75 1.75 0 0 1 10.25 13h-8.5A1.75 1.75 0 0 1 0 11.25Zm12 1.5 3.25-2.25a.75.75 0 0 1 1.25.62v7.76a.75.75 0 0 1-1.25.62L12 10.25Z"/></svg>';
  if(['pdf'].includes(ext)) return '<svg width="20" height="20" viewBox="0 0 16 16" fill="#e5484d"><path d="M2 1.75C2 .784 2.784 0 3.75 0h6.586c.464 0 .909.184 1.237.513l2.914 2.914c.329.328.513.773.513 1.237v9.586A1.75 1.75 0 0 1 13.25 16h-9.5A1.75 1.75 0 0 1 2 14.25Z"/></svg>';
  if(['zip','rar','7z','tar','gz'].includes(ext)) return '<svg width="20" height="20" viewBox="0 0 16 16" fill="currentColor"><path d="M6 2.75V2h1v.75H6ZM6 4.25V3.5h1v.75H6ZM6 5.75V5h1v.75H6ZM6 7.25V6.5h1v.75H6Zm3.75-5.5A1.75 1.75 0 0 0 8 3.5v10.75c0 .966.784 1.75 1.75 1.75h4.5A1.75 1.75 0 0 0 16 14.25V3.5a1.75 1.75 0 0 0-1.75-1.75Z"/></svg>';
  return '<svg width="20" height="20" viewBox="0 0 16 16" fill="currentColor"><path d="M2 1.75C2 .784 2.784 0 3.75 0h6.586c.464 0 .909.184 1.237.513l2.914 2.914c.329.328.513.773.513 1.237v9.586A1.75 1.75 0 0 1 13.25 16h-9.5A1.75 1.75 0 0 1 2 14.25Zm11 11.5V4.664L11.336 3H4.5v-.5L4 3v11.25a.25.25 0 0 0 .25.25h8.5a.25.25 0 0 0 .25-.25Z"/></svg>';
}

/* Rich link cards */
function insertRichLink(){
  const url=prompt('Paste a URL to embed as a rich card:','https://');
  if(!url) return;
  let u;
  try{ u=new URL(url); }catch(e){ toast('Invalid URL'); return; }
  const host=u.hostname.replace(/^www\./,'');
  const path=(u.pathname==='/'?'':u.pathname).replace(/\/$/,'');
  const title=prompt('Title (optional):', decodeURIComponent(path.split('/').pop()||host)) || host;
  const desc=prompt('Description (optional):','') || '';
  const favicon=`https://www.google.com/s2/favicons?domain=${host}&sz=64`;
  const id='l_'+Date.now().toString(36);
  insertHTMLAtCaret(
    `<a class="media-card link-card" contenteditable="false" data-media-id="${id}" data-media-kind="link" href="${esc(url)}" target="_blank" rel="noopener noreferrer">
      <div class="mc-top">
        <div class="mc-icon"><img src="${favicon}" alt="" onerror="this.style.display='none'"></div>
        <div class="mc-body">
          <div class="mc-title">${esc(title)}</div>
          <div class="mc-meta">${esc(host)}</div>
        </div>
      </div>
      ${desc?`<div class="mc-desc" style="margin-top:8px">${esc(desc)}</div>`:''}
    </a>`
  );
  toast('Link card added');
}

/* Voice recording modal */
let recStream=null, recRecorder=null, recChunks=[], recStart=0, recTimer=null;
function openRecordingModal(){
  const root=document.getElementById('modalRoot');
  root.innerHTML=`<div class="modal-overlay"><div class="modal rec-modal">
    <h3>Voice Recording</h3>
    <div class="rec-dot idle" id="recDot"></div>
    <div class="rec-time" id="recTime">0:00</div>
    <div class="rec-hint" id="recHint">Click Start to begin recording</div>
    <div class="modal-actions" style="justify-content:center">
      <button class="btn" id="recCancel">Cancel</button>
      <button class="btn btn-primary" id="recStart">● Start</button>
      <button class="btn btn-danger" id="recStop" style="display:none">■ Stop</button>
    </div>
  </div></div>`;
  const cleanup=()=>{
    if(recTimer){ clearInterval(recTimer); recTimer=null; }
    if(recStream){ recStream.getTracks().forEach(t=>t.stop()); recStream=null; }
    recRecorder=null; recChunks=[];
  };
  const close=()=>{ cleanup(); root.innerHTML=''; };
  document.getElementById('recCancel').onclick=close;
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
    document.getElementById('recHint').textContent='Recording… speak now';
    recTimer=setInterval(()=>{
      const s=Math.floor((Date.now()-recStart)/1000);
      document.getElementById('recTime').textContent=Math.floor(s/60)+':'+String(s%60).padStart(2,'0');
    },200);
  };
  document.getElementById('recStop').onclick=()=>{
    if(recRecorder && recRecorder.state!=='inactive') recRecorder.stop();
  };
  root.querySelector('.modal-overlay').onclick=e=>{ if(e.target===e.currentTarget) close(); };
}

/* Dispatcher for the media toolbar buttons */
function handleMediaAction(kind){
  document.getElementById('noteBody').focus();
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
  focusEditor();
  // If invoked without a direction, cycle to the next one.
  if(!dir){
    const cur=currentAlignment();
    const idx=ALIGN_ORDER.indexOf(cur);
    dir=ALIGN_ORDER[(idx+1)%ALIGN_ORDER.length];
  }
  document.execCommand(ALIGN_CMD[dir]||'justifyLeft', false, null);
  updateAlignmentButton();
  handleBodyInput();
  updateToolbarState();
}
function updateAlignmentButton(){
  const btn=document.getElementById('alignBtn');
  if(!btn) return;
  const cur=currentAlignment();
  btn.setAttribute('data-align', cur);
  btn.title='Alignment: '+cur.charAt(0).toUpperCase()+cur.slice(1)+' (click to cycle)';
  const iconEl=btn.querySelector('i');
  if(iconEl){ iconEl.setAttribute('data-lucide', ALIGN_ICON[cur]||'align-left'); refreshIcons(); }
}

function updateToolbarState(){
  const cmds=['bold','italic','underline','strikeThrough','insertUnorderedList','insertOrderedList'];
  document.querySelectorAll('#formatBar .tool-btn').forEach(btn=>{
    const cmd=btn.dataset.cmd;
    if(cmds.includes(cmd)){
      try{ btn.classList.toggle('active', document.queryCommandState(cmd)); }
      catch(e){ btn.classList.remove('active'); }
    } else {
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
}

/* ============================================================
   THEME
   ============================================================ */
function setTheme(theme,trackChange=true){
  document.documentElement.setAttribute('data-theme',theme);
  localStorage.setItem(THEME_KEY,theme);
  if(trackChange && typeof markPortableStateChanged==='function') markPortableStateChanged();
  if(typeof applyAccent==='function') applyAccent((typeof appSettings!=='undefined'&&appSettings.accent)||'blue');
  const icon=document.getElementById('themeIcon');
  if(icon){
    icon.setAttribute('data-lucide', theme==='dark' ? 'sun' : 'moon');
    icon.innerHTML='';
    refreshIcons();
  }
}

/* ============================================================
   REMOTE & EXPIRED IMAGE AUTO-CAPTURE AND RECOVERY
   ============================================================ */
function setupBrokenImageElement(img){
  if(!img || img.dataset.brokenHandled) return;
  img.dataset.brokenHandled = 'true';

  const alt = img.getAttribute('alt') || img.getAttribute('title') || 'Image attachment';
  const wrapper = document.createElement('div');
  wrapper.className = 'broken-media-card';
  wrapper.setAttribute('contenteditable', 'false');
  wrapper.innerHTML = `
    <div class="bmc-content">
      <i data-lucide="image-off" class="w-5 h-5"></i>
      <div class="bmc-info">
        <span class="bmc-title">${esc(alt)}</span>
        <span class="bmc-sub">Remote image link expired or unavailable</span>
      </div>
    </div>
    <button type="button" class="bmc-replace-btn"><i data-lucide="upload" class="w-4 h-4"></i> Re-upload Image</button>
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

  img.replaceWith(wrapper);
  if(typeof refreshIcons === 'function') refreshIcons();
}

async function autoCaptureExternalImages(){
  const ed = document.getElementById('noteBody');
  if(!ed) return;
  const imgs = Array.from(ed.querySelectorAll('img')).filter(img => {
    const src = img.getAttribute('src') || '';
    const hasMediaId = img.hasAttribute('data-media-id');
    return !hasMediaId && (src.startsWith('http://') || src.startsWith('https://') || src.startsWith('blob:'));
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
