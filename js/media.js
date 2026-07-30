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


async function insertImageFile(file){
  if(!file || !file.type.startsWith('image/')){ toast('Not an image'); return; }
  const id=await saveMediaBlob(file, file.name, 'image');
  const url=await getMediaURL(id);
  urlCache.set(id,url);
  // Device-appropriate default size (phone=full, tablet/desktop=large); syncs via note HTML.
  const defSize=(typeof IMG_DEFAULT_SIZE==='object' && typeof deviceClass==='function')
    ? IMG_DEFAULT_SIZE[deviceClass()] : 'large';
  insertHTMLAtCaret(`<img data-media-id="${id}" data-media-kind="image" data-img-size="${defSize}" src="${url}" alt="${esc(file.name)}">`);
  save();
  toast('Image added');
  renderStorageStats();
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
    const mime=MediaRecorder.isTypeSupported('audio/webm')?'audio/webm':'';
    recRecorder=mime?new MediaRecorder(recStream,{mimeType:mime}):new MediaRecorder(recStream);
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
