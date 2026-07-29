/* ============================================================
   RESPONSIVE IMAGE EXPERIENCE
   Phone   → bottom sheet + presets (one-handed, no tiny handles)
   Tablet  → corner handles + floating toolbar + pinch zoom
   Desktop → corner handles + toolbar + hover + keyboard shortcuts
   Sizes persist in the note HTML (data-img-size) so they sync across devices.
   ============================================================ */
const IMG_DEFAULT_SIZE={phone:'full', tablet:'large', desktop:'large'};
let selectedImg=null;
let imgResize=null;   // active drag-resize session
let pendingImageReplacement=null;

/* --- Multi-selection state (extensions only — no changes to single-select) --- */
let selectedImgs=new Set();  // Set of DOM <img> elements
let imgSelectMode=false;     // true while multi-select is active
let checkBadges=[];          // {img, el} pairs so we can reposition the badges

/* ---- Preset percentage lookup (shared by single + multi) ---- */
const IMG_PRESET_PCT={small:35, medium:55, large:78, full:100};

/* ---- Reflow: apply or remove float based on current width ---- */
function applyReflow(img){
  const align=img.getAttribute('data-img-align');
  const pct=parseFloat(img.style.width)||IMG_PRESET_PCT[img.getAttribute('data-img-size')]||100;
  // Generous horizontal breathing room so text never touches the image (fix #5).
  const LM='6px 24px 14px 0';   // left-float margin
  const RM='6px 0 14px 24px';   // right-float margin
  if(align==='left')  { img.style.float='left';  img.style.margin=LM; }
  else if(align==='right'){ img.style.float='right'; img.style.margin=RM; }
  else if(pct<=40 && !align){
    // Auto-float left when the image is small enough (≤40% width).
    img.style.float='left'; img.style.margin=LM;
  }else{
    img.style.float=''; img.style.margin='';
  }
}

/* Override setImageSize to also trigger reflow + gallery redistribution */
const _origSetImageSize=setImageSize;
function setImageSizeEx(img,size){
  if(!img) return;
  img.setAttribute('data-img-size',size);
  img.style.width=''; img.style.height='auto';
  applyReflow(img);
  redistributeGallery(img);
  syncImageChrome();
  handleBodyInput();
}
// Shadow the original so all existing callers that use setImageSize still work,
// but calls from within this module use setImageSizeEx for the extra behaviour.
// We cannot reassign the declared const, so we patch the global reference instead.
window._imgSetSizeOrig=setImageSize;
// Wrap the already-existing function by overwriting its body's effect via delegation:
// (The previous function object remains; we replace calls from new code only.)

/* ---- Gallery helpers ---- */
function editorImgsInOrder(){
  const ed=bodyEl(); if(!ed) return [];
  return Array.from(ed.querySelectorAll('img[data-media-id]'));
}
function areConsecutive(imgs){
  // True if all imgs are siblings with no non-whitespace content between them
  if(imgs.length<2) return false;
  const sorted=[...imgs].sort((a,b)=>{
    const pos=a.compareDocumentPosition(b);
    return pos&Node.DOCUMENT_POSITION_FOLLOWING?-1:1;
  });
  for(let i=1;i<sorted.length;i++){
    let node=sorted[i-1].nextSibling;
    let ok=false;
    while(node){
      if(node===sorted[i]){ok=true;break;}
      if(node.nodeType===3 && !node.textContent.trim()){node=node.nextSibling;continue;}
      if(node.nodeType===1 && node.tagName==='BR'){node=node.nextSibling;continue;}
      break;
    }
    if(!ok) return false;
  }
  return true;
}

function redistributeGallery(changedImg){
  // If the changed image is inside a gallery wrapper, rebalance columns
  const gallery=changedImg?.closest('[data-img-gallery]');
  if(!gallery) return;
  const imgs=Array.from(gallery.querySelectorAll('img[data-media-id]'));
  const cols=Math.min(4, Math.max(2, imgs.length));
  gallery.setAttribute('data-cols',String(cols));
  gallery.style.transition='grid-template-columns .22s cubic-bezier(.4,0,.2,1)';
}

function convertSelectionToGallery(){
  if(selectedImgs.size<2){ toast('Select 2 or more images to create a gallery'); return; }
  const imgs=[...selectedImgs];
  if(!areConsecutive(imgs)){ toast('Gallery: select consecutive images'); return; }
  const sorted=[...imgs].sort((a,b)=>a.compareDocumentPosition(b)&Node.DOCUMENT_POSITION_FOLLOWING?-1:1);
  const gallery=document.createElement('div');
  gallery.setAttribute('data-img-gallery','1');
  gallery.className='img-gallery';
  const cols=Math.min(4,Math.max(2,sorted.length));
  gallery.setAttribute('data-cols',String(cols));
  sorted[0].parentNode.insertBefore(gallery, sorted[0]);
  sorted.forEach(img=>{
    img.removeAttribute('data-img-align');
    img.style.float=''; img.style.margin='';
    gallery.appendChild(img);
  });
  clearMultiSelection();
  handleBodyInput();
  toast(`Gallery created (${sorted.length} images, ${cols} columns)`);
}

/* ---- Badge management ---- */
function showCheckBadge(img){
  const r=img.getBoundingClientRect();
  let badge=checkBadges.find(b=>b.img===img);
  if(!badge){
    const el=document.createElement('div');
    el.className='img-check-badge';
    el.innerHTML='✓';
    document.body.appendChild(el);
    badge={img,el};
    checkBadges.push(badge);
  }
  badge.el.style.left=`${r.left+6}px`;
  badge.el.style.top=`${r.top+6}px`;
  badge.el.classList.add('show');
}
function hideCheckBadge(img){
  const badge=checkBadges.find(b=>b.img===img);
  if(badge){ badge.el.classList.remove('show'); }
}
function reposBadges(){
  checkBadges.forEach(({img,el})=>{
    if(!el.classList.contains('show')) return;
    const r=img.getBoundingClientRect();
    el.style.left=`${r.left+6}px`;
    el.style.top=`${r.top+6}px`;
  });
}

/* ---- Multi-select manipulation ---- */
function addToSelection(img){
  selectedImgs.add(img);
  img.classList.add('img-multi-selected');
  showCheckBadge(img);
  updateBatchBar();
}
function removeFromSelection(img){
  selectedImgs.delete(img);
  img.classList.remove('img-multi-selected');
  hideCheckBadge(img);
  updateBatchBar();
}
function toggleMultiSelect(img){
  if(selectedImgs.has(img)) removeFromSelection(img);
  else addToSelection(img);
}
function clearMultiSelection(){
  selectedImgs.forEach(img=>{
    img.classList.remove('img-multi-selected');
    hideCheckBadge(img);
  });
  selectedImgs.clear();
  imgSelectMode=false;
  updateBatchBar();
}
function updateBatchBar(){
  const bar=document.getElementById('imgBatchBar');
  const cnt=document.getElementById('ibbCount');
  if(!bar) return;
  const n=selectedImgs.size;
  if(n===0){ bar.classList.remove('show'); imgSelectMode=false; return; }
  bar.classList.add('show');
  imgSelectMode=true;
  if(cnt) cnt.textContent=`${n} image${n>1?'s':''} selected`;
}

/* ---- Batch operations ---- */
function batchResize(size){
  selectedImgs.forEach(img=>{ setImageSizeEx(img,size); });
  handleBodyInput();
  toast(`${selectedImgs.size} images → ${size}`);
}
function batchDelete(){
  const imgs=[...selectedImgs];
  clearMultiSelection();
  imgs.forEach(img=>img.remove());
  handleBodyInput();
  toast(`${imgs.length} image${imgs.length>1?'s':''} deleted`);
}
function batchAlign(dir){
  selectedImgs.forEach(img=>{
    if(dir==='clear'){ img.removeAttribute('data-img-align'); img.style.float=''; img.style.margin=''; }
    else{ img.setAttribute('data-img-align',dir); applyReflow(img); }
  });
  handleBodyInput();
}
function batchEqualWidth(){
  if(!selectedImgs.size) return;
  const widths=[...selectedImgs].map(img=>{
    const s=img.getAttribute('data-img-size');
    return s?IMG_PRESET_PCT[s]:parseFloat(img.style.width)||100;
  });
  const avg=Math.round(widths.reduce((s,v)=>s+v,0)/widths.length);
  const snaps=Object.entries(IMG_PRESET_PCT);
  const [snapSize]=snaps.reduce(([bk,bv],[k,v])=>Math.abs(v-avg)<Math.abs(bv-avg)?[k,v]:[bk,bv]);
  batchResize(snapSize);
  toast(`All images set to ${snapSize} (~${IMG_PRESET_PCT[snapSize]}%)`);
}

/* ---- Wire batch bar buttons (called from initResponsiveImages) ---- */
function initBatchBar(){
  const map={
    ibbResizeSmall:  ()=>batchResize('small'),
    ibbResizeMedium: ()=>batchResize('medium'),
    ibbResizeLarge:  ()=>batchResize('large'),
    ibbResizeFull:   ()=>batchResize('full'),
    ibbEqualWidth:   ()=>batchEqualWidth(),
    ibbGallery:      ()=>convertSelectionToGallery(),
    ibbAlignLeft:    ()=>batchAlign('left'),
    ibbAlignRight:   ()=>batchAlign('right'),
    ibbAlignCenter:  ()=>batchAlign('clear'),
    ibbDelete:       ()=>batchDelete(),
    ibbDeselect:     ()=>clearMultiSelection()
  };
  Object.entries(map).forEach(([id,fn])=>{
    const el=document.getElementById(id);
    if(el){ el.addEventListener('mousedown',e=>e.preventDefault()); el.addEventListener('click',fn); }
  });
  // Reposition badges on scroll / resize
  bodyEl()?.addEventListener('scroll', reposBadges, {passive:true});
  window.addEventListener('resize', reposBadges);
  refreshIcons();
}

function deviceClass(){
  const w=window.innerWidth;
  if(w<=640) return 'phone';
  if(w<=1024) return 'tablet';
  return 'desktop';
}

/* Every inserted/loaded image gets a size class so behaviour is identical everywhere. */
function normalizeEditorImages(){
  const ed=bodyEl(); if(!ed) return;
  const def=IMG_DEFAULT_SIZE[deviceClass()];
  ed.querySelectorAll('img[data-media-id]').forEach(img=>{
    if(!img.getAttribute('data-img-size')){
      img.setAttribute('data-img-size', def);
    }
    // Legacy inline widths → clear so the preset governs (keeps ratio intact).
    if(img.style.width && img.getAttribute('data-img-size')) img.style.width='';
    img.style.height='auto';
    applyReflow(img);   // restore float alignment stored in data-img-align
  });
}

function setImageSize(img,size){
  if(!img) return;
  img.setAttribute('data-img-size', size);
  img.style.width='';          // let the CSS preset win
  img.style.height='auto';     // never distort
  syncImageChrome();
  handleBodyInput();           // persists into the note → syncs across devices
}

function selectImage(img){
  clearImageSelection(true);
  selectedImg=img;
  img.classList.add('img-selected');
  if(deviceClass()==='phone') openImageSheet();
  else syncImageChrome();
}

function clearImageSelection(skipSheet){
  if(selectedImg) selectedImg.classList.remove('img-selected');
  selectedImg=null;
  document.getElementById('imgToolbar')?.classList.remove('show');
  document.querySelectorAll('.img-handle').forEach(h=>h.classList.remove('show'));
  if(!skipSheet) closeImageSheet();
}

/* Position the floating toolbar + corner handles around the selection. */
function syncImageChrome(){
  const tb=document.getElementById('imgToolbar');
  const handles=document.querySelectorAll('.img-handle');
  const dev=deviceClass();
  if(!selectedImg || dev==='phone'){
    tb?.classList.remove('show');
    handles.forEach(h=>h.classList.remove('show'));
    return;
  }
  const r=selectedImg.getBoundingClientRect();
  const edRect=bodyEl().getBoundingClientRect();
  // Hide chrome if the image is scrolled out of the editor viewport.
  if(r.bottom<edRect.top || r.top>edRect.bottom){
    tb?.classList.remove('show');
    handles.forEach(h=>h.classList.remove('show'));
    return;
  }
  if(tb){
    tb.classList.add('show');
    const tw=tb.offsetWidth||300;
    let top=r.top-tb.offsetHeight-10;
    if(top<edRect.top+6) top=r.bottom+10;            // flip below when clipped
    tb.style.top=`${Math.round(top)}px`;
    tb.style.left=`${Math.round(Math.max(8,Math.min(r.left+r.width/2-tw/2,window.innerWidth-tw-8)))}px`;
    tb.querySelectorAll('[data-imgsize]').forEach(b=>{
      b.classList.toggle('active', b.dataset.imgsize===selectedImg.getAttribute('data-img-size'));
    });
  }
  const pts={nw:[r.left,r.top],ne:[r.right,r.top],sw:[r.left,r.bottom],se:[r.right,r.bottom]};
  handles.forEach(h=>{
    const [x,y]=pts[h.dataset.corner];
    h.classList.add('show');
    h.style.left=`${Math.round(x-7)}px`;
    h.style.top=`${Math.round(y-7)}px`;
  });
}

/* ---- Mobile bottom sheet ---- */
function openImageSheet(){
  const sheet=document.getElementById('imgSheet');
  const back=document.getElementById('imgSheetBackdrop');
  if(!sheet||!selectedImg) return;
  sheet.querySelectorAll('[data-imgsize]').forEach(b=>{
    b.classList.toggle('active', b.dataset.imgsize===selectedImg.getAttribute('data-img-size'));
  });
  back.classList.add('show'); sheet.classList.add('show');
  refreshIcons();
}
function closeImageSheet(){
  document.getElementById('imgSheet')?.classList.remove('show');
  document.getElementById('imgSheetBackdrop')?.classList.remove('show');
}

/* ---- Fullscreen preview with pinch / wheel zoom + pan + gallery prev/next ---- */
let fsZoom={scale:1,x:0,y:0};
let fsGalleryImgs=[];
let fsCurrentIdx=-1;

function openImageFullscreen(srcOrImg){
  const fs=document.getElementById('imgFullscreen');
  const im=document.getElementById('imgFsImage');
  if(!fs||!im) return;

  let src=srcOrImg;
  fsGalleryImgs=editorImgsInOrder();

  if(typeof srcOrImg==='object' && srcOrImg.tagName==='IMG'){
    src=srcOrImg.src;
    fsCurrentIdx=fsGalleryImgs.indexOf(srcOrImg);
  } else {
    fsCurrentIdx=fsGalleryImgs.findIndex(i=>i.src===src);
  }

  im.src=src;
  fsZoom={scale:1,x:0,y:0};
  im.style.transform='translate(0px,0px) scale(1)';

  // Show/hide prev/next buttons
  const prevBtn=document.getElementById('imgFsPrev');
  const nextBtn=document.getElementById('imgFsNext');
  if(prevBtn) prevBtn.style.display=(fsGalleryImgs.length>1)?'flex':'none';
  if(nextBtn) nextBtn.style.display=(fsGalleryImgs.length>1)?'flex':'none';

  fs.classList.add('show');
  refreshIcons();
}

function navFsImage(dir){
  if(!fsGalleryImgs.length) return;
  fsCurrentIdx = (fsCurrentIdx + dir + fsGalleryImgs.length) % fsGalleryImgs.length;
  const targetImg=fsGalleryImgs[fsCurrentIdx];
  if(targetImg){
    const im=document.getElementById('imgFsImage');
    if(im) im.src=targetImg.src;
    fsZoom={scale:1,x:0,y:0};
    if(im) im.style.transform='translate(0px,0px) scale(1)';
  }
}

function closeImageFullscreen(){
  document.getElementById('imgFullscreen')?.classList.remove('show');
}

/* ============================================================
   ENHANCED CROP, CAPTIONS & COVER INTEGRATION (Phase 2)
   ============================================================ */

/* --- Image Captions --- */
function toggleImageCaption(img){
  if(!img) return;
  const key=img.getAttribute('data-media-id');
  let caption=img.nextElementSibling;
  if(!caption || !caption.classList.contains('img-caption')) caption=null;
  if(!caption){
    caption=document.createElement('div');
    caption.className='img-caption';
    caption.setAttribute('contenteditable','true');
    caption.setAttribute('data-placeholder','Add a caption…');
    caption.setAttribute('data-caption-for',key||'');
    img.parentNode.insertBefore(caption,img.nextSibling);
  }
  caption.focus();
  handleBodyInput();
  toast('Caption added');
}

/* Replace the selected image while preserving layout, caption, crop source and
   notebook flow. The previous IndexedDB blob remains intact for non-destructive
   history and any existing cover reference. */
async function replaceImageFile(img,file){
  if(!img||!file||!file.type.startsWith('image/')) return;
  const id=await saveMediaBlob(file,file.name,'image');
  const url=await getMediaURL(id);
  img.setAttribute('data-media-id',id);
  img.setAttribute('data-original-media-id',id);
  img.setAttribute('data-raw-src',url);
  img.removeAttribute('data-crop-params');
  img.removeAttribute('data-rotate');
  img.removeAttribute('data-flip-h');
  img.removeAttribute('data-flip-v');
  img.style.transform='';img.src=url;img.alt=file.name;
  applyReflow(img);handleBodyInput();syncImageChrome();renderStorageStats();
  toast('Image replaced');
}

function requestImageReplacement(img){
  pendingImageReplacement=img;
  const input=document.getElementById('mediaImageInput');
  if(input){input.value='';input.click();}
}

/* --- Rotate / Flip Image --- */
function rotateImage(img){
  if(!img) return;
  let deg=parseInt(img.getAttribute('data-rotate')||'0',10);
  deg=(deg+90)%360;
  img.setAttribute('data-rotate', String(deg));
  const h=img.getAttribute('data-flip-h')==='true',v=img.getAttribute('data-flip-v')==='true';
  img.style.transform=`rotate(${deg}deg) scale(${h?-1:1},${v?-1:1})`;
  handleBodyInput();
  toast(`Rotated ${deg}°`);
}

function flipImage(img){
  if(!img) return;
  let flip=img.getAttribute('data-flip-h')==='true';
  flip=!flip;
  img.setAttribute('data-flip-h', String(flip));
  const deg=parseInt(img.getAttribute('data-rotate')||'0',10),v=img.getAttribute('data-flip-v')==='true';
  img.style.transform=`rotate(${deg}deg) scale(${flip?-1:1},${v?-1:1})`;
  handleBodyInput();
  toast(flip?'Flipped horizontally':'Restored orientation');
}

function flipImageVertical(img){
  if(!img) return;
  const flip=img.getAttribute('data-flip-v')!=='true';
  img.setAttribute('data-flip-v',String(flip));
  const h=img.getAttribute('data-flip-h')==='true';
  const deg=parseInt(img.getAttribute('data-rotate')||'0',10);
  img.style.transform=`rotate(${deg}deg) scale(${h?-1:1},${flip?-1:1})`;
  handleBodyInput();
  toast(flip?'Flipped vertically':'Vertical flip removed');
}

function setImageAlign(img,dir){
  if(!img)return;
  if(dir==='center'){
    img.removeAttribute('data-img-align');img.style.float='';img.style.margin='';
  }else{
    img.setAttribute('data-img-align',dir);applyReflow(img);
  }
  handleBodyInput();syncImageChrome();
}

/* --- Notebook Cover Integration --- */
function setNotebookCover(imgOrSrc){
  const n=getNote(state.currentId);
  if(!n) return;
  const src = typeof imgOrSrc==='string' ? imgOrSrc : imgOrSrc.src;
  const mediaId=typeof imgOrSrc==='object'?imgOrSrc.getAttribute('data-media-id'):null;
  const crop=typeof imgOrSrc==='object'?imgOrSrc.getAttribute('data-crop-params'):null;
  n.coverImage = { src, mediaId, cropParams:crop||null, positionY: 50 };
  save();
  renderNotebookCover();
  toast('Set as Notebook Cover');
}

function removeNotebookCover(){
  const n=getNote(state.currentId);
  if(!n) return;
  delete n.coverImage;
  save();
  renderNotebookCover();
  toast('Cover removed');
}

async function renderNotebookCover(){
  const n=getNote(state.currentId);
  const contentEl=document.getElementById('editorContent');
  let coverEl=document.getElementById('noteCoverHeader');
  if(!n || !n.coverImage){
    if(coverEl) coverEl.remove();
    return;
  }
  if(!coverEl){
    coverEl=document.createElement('div');
    coverEl.className='note-cover-header';
    coverEl.id='noteCoverHeader';
    const topBar=contentEl.querySelector('.editor-topbar');
    if(topBar) topBar.parentNode.insertBefore(coverEl, topBar.nextSibling);
    else contentEl.insertBefore(coverEl, contentEl.firstChild);
  }
  let coverSrc=n.coverImage.src||'';
  if(n.coverImage.mediaId){
    try{coverSrc=await getMediaURL(n.coverImage.mediaId)||coverSrc;}catch(e){}
  }
  coverEl.innerHTML=`
    <img src="${esc(coverSrc)}" alt="Cover" style="object-position: center ${n.coverImage.positionY||50}%">
    <div class="cover-btn-overlay">
      <button id="btnCoverReposition"><i data-lucide="move" class="w-3.5 h-3.5"></i> Reposition</button>
      <button id="btnCoverRemove"><i data-lucide="trash-2" class="w-3.5 h-3.5"></i> Remove</button>
    </div>
  `;
  document.getElementById('btnCoverRemove').onclick=removeNotebookCover;
  document.getElementById('btnCoverReposition').onclick=()=>{
    let pos=(n.coverImage.positionY||50)+25; if(pos>100) pos=0;
    n.coverImage.positionY=pos; save(); renderNotebookCover();
  };
  refreshIcons();
}

/* --- Non-destructive Image Crop Editor Modal --- */
function _legacyOpenCropModal(img){
  if(!img) return;
  // Preserve uncropped original in data-raw-src
  if(!img.getAttribute('data-raw-src')){
    img.setAttribute('data-raw-src', img.src);
  }
  const rawSrc=img.getAttribute('data-raw-src');

  let cropState = {
    ratio: 'free', // free, 1:1, 3:4, 4:5, 4:3, 16:9, 21:9, 9:16, cover
    fit: true,
    zoom: 1,
    rot: parseInt(img.getAttribute('data-rotate')||'0', 10),
    flipH: img.getAttribute('data-flip-h')==='true'
  };

  const root=document.getElementById('modalRoot');
  root.innerHTML=`
    <div class="modal-overlay">
      <div class="modal crop-modal">
        <h3><i data-lucide="crop" class="w-4 h-4 inline mr-1 text-accent"></i> Non-destructive Crop Editor</h3>
        <div class="crop-viewport" id="cropViewport">
          <img id="cropImg" src="${rawSrc}" style="transform: scale(1) rotate(${cropState.rot}deg) ${cropState.flipH?'scaleX(-1)':''}">
          <div class="crop-overlay-frame" id="cropFrame" style="top:10%;left:10%;width:80%;height:80%;">
            <div class="crop-handle nw"></div>
            <div class="crop-handle ne"></div>
            <div class="crop-handle sw"></div>
            <div class="crop-handle se"></div>
          </div>
        </div>
        <div class="crop-toolbar-row">
          <button class="crop-ratio-btn active" data-ratio="free">Freeform</button>
          <button class="crop-ratio-btn" data-ratio="1:1">1:1</button>
          <button class="crop-ratio-btn" data-ratio="4:3">4:3</button>
          <button class="crop-ratio-btn" data-ratio="16:9">16:9</button>
          <button class="crop-ratio-btn" data-ratio="cover">Cover (3:1)</button>
        </div>
        <div class="crop-toolbar-row" style="margin-top:8px">
          <div style="display:flex;gap:4px">
            <button class="btn btn-sm" id="cropZoomIn"><i data-lucide="zoom-in" class="w-3.5 h-3.5"></i></button>
            <button class="btn btn-sm" id="cropZoomOut"><i data-lucide="zoom-out" class="w-3.5 h-3.5"></i></button>
            <button class="btn btn-sm" id="cropRotate"><i data-lucide="rotate-cw" class="w-3.5 h-3.5"></i></button>
            <button class="btn btn-sm" id="cropFlip"><i data-lucide="flip-horizontal" class="w-3.5 h-3.5"></i></button>
          </div>
          <button class="btn btn-sm" id="cropReset"><i data-lucide="refresh-cw" class="w-3.5 h-3.5"></i> Reset</button>
        </div>
        <div class="modal-actions" style="margin-top:16px">
          <button class="btn" id="cropCancel">Cancel</button>
          <button class="btn btn-primary" id="cropApply">Apply Crop</button>
        </div>
      </div>
    </div>
  `;

  const close=()=>root.innerHTML='';
  document.getElementById('cropCancel').onclick=close;

  const cropImg=document.getElementById('cropImg');
  const cropFrame=document.getElementById('cropFrame');
  const viewport=document.getElementById('cropViewport');

  // Aspect ratio presets
  root.querySelectorAll('.crop-ratio-btn').forEach(btn=>{
    btn.onclick=()=>{
      root.querySelectorAll('.crop-ratio-btn').forEach(b=>b.classList.remove('active'));
      btn.classList.add('active');
      const r=btn.dataset.ratio;
      cropState.ratio=r;
      if(r==='1:1') setFrameAspect(1);
      else if(r==='4:3') setFrameAspect(4/3);
      else if(r==='16:9') setFrameAspect(16/9);
      else if(r==='cover') setFrameAspect(3);
      else { cropFrame.style.width='80%'; cropFrame.style.height='80%'; cropFrame.style.top='10%'; cropFrame.style.left='10%'; }
    };
  });

  function setFrameAspect(asp){
    const vw=viewport.clientWidth, vh=viewport.clientHeight;
    let w=vw*0.8, h=w/asp;
    if(h>vh*0.8){ h=vh*0.8; w=h*asp; }
    cropFrame.style.width=w+'px';
    cropFrame.style.height=h+'px';
    cropFrame.style.left=(vw-w)/2+'px';
    cropFrame.style.top=(vh-h)/2+'px';
  }

  // Zoom / Rotate / Flip
  document.getElementById('cropZoomIn').onclick=()=>{ cropState.zoom=Math.min(3, cropState.zoom+0.2); updateCropImgTransform(); };
  document.getElementById('cropZoomOut').onclick=()=>{ cropState.zoom=Math.max(0.5, cropState.zoom-0.2); updateCropImgTransform(); };
  document.getElementById('cropRotate').onclick=()=>{ cropState.rot=(cropState.rot+90)%360; updateCropImgTransform(); };
  document.getElementById('cropFlip').onclick=()=>{ cropState.flipH=!cropState.flipH; updateCropImgTransform(); };
  document.getElementById('cropReset').onclick=()=>{
    cropState={ratio:'free',fit:true,zoom:1,rot:0,flipH:false};
    updateCropImgTransform();
    cropFrame.style.width='80%'; cropFrame.style.height='80%'; cropFrame.style.top='10%'; cropFrame.style.left='10%';
  };

  function updateCropImgTransform(){
    cropImg.style.transform=`scale(${cropState.zoom}) rotate(${cropState.rot}deg) ${cropState.flipH?'scaleX(-1)':''}`;
  }

  // Apply Crop -> Render Canvas result
  document.getElementById('cropApply').onclick=()=>{
    const canvas=document.createElement('canvas');
    const ctx=canvas.getContext('2d');
    const imgObj=new Image();
    imgObj.crossOrigin='anonymous';
    imgObj.onload=()=>{
      canvas.width=imgObj.naturalWidth||imgObj.width;
      canvas.height=imgObj.naturalHeight||imgObj.height;
      ctx.save();
      if(cropState.flipH){ ctx.translate(canvas.width,0); ctx.scale(-1,1); }
      if(cropState.rot){
        ctx.translate(canvas.width/2, canvas.height/2);
        ctx.rotate((cropState.rot*Math.PI)/180);
        ctx.translate(-canvas.width/2, -canvas.height/2);
      }
      ctx.drawImage(imgObj, 0, 0);
      ctx.restore();

      const croppedUrl=canvas.toDataURL('image/png');
      img.src=croppedUrl;
      img.setAttribute('data-rotate', String(cropState.rot));
      img.setAttribute('data-flip-h', String(cropState.flipH));
      handleBodyInput();
      close();
      toast('Crop applied non-destructively');
    };
    imgObj.src=rawSrc;
  };

  root.querySelector('.modal-overlay').onclick=e=>{ if(e.target===e.currentTarget) close(); };
  refreshIcons();
}

/* Professional crop editor. The source blob stays untouched in IndexedDB;
   applying a crop creates a derived image record and stores crop parameters
   on the image element, so Reset/Re-crop always starts from the original. */
async function openCropModal(img){
  if(!img) return;
  const mediaId=img.getAttribute('data-original-media-id')||img.getAttribute('data-media-id');
  let sourceURL=img.getAttribute('data-raw-src')||img.src;
  try{
    const original=await mediaGet(mediaId);
    if(original){
      sourceURL=await getMediaURL(mediaId);
      img.setAttribute('data-original-media-id',mediaId);
    }
  }catch(e){}
  if(!img.getAttribute('data-raw-src')) img.setAttribute('data-raw-src',sourceURL);

  const root=document.getElementById('modalRoot');
  const ratios=[['free','Freeform'],['original','Original'],['1:1','1:1'],['3:4','3:4'],['4:5','4:5'],['4:3','4:3'],['16:9','16:9'],['21:9','21:9'],['9:16','9:16'],['cover','Notebook Cover']];
  root.innerHTML=`<div class="modal-overlay"><div class="modal crop-modal">
    <h3><i data-lucide="crop" class="w-4 h-4 inline mr-1 text-accent"></i> Non-destructive Crop</h3>
    <div class="crop-viewport" id="cropViewport">
      <img id="cropImg" src="${sourceURL}" alt="Crop preview" draggable="false">
      <div class="crop-overlay-frame" id="cropFrame">
        <div class="crop-handle nw" data-crop-handle="nw"></div><div class="crop-handle ne" data-crop-handle="ne"></div>
        <div class="crop-handle sw" data-crop-handle="sw"></div><div class="crop-handle se" data-crop-handle="se"></div>
      </div>
    </div>
    <div class="crop-toolbar-row" id="cropRatios">${ratios.map(([v,l],i)=>`<button class="crop-ratio-btn ${i===0?'active':''}" data-ratio="${v}">${l}</button>`).join('')}</div>
    <div class="crop-toolbar-row">
      <div class="crop-mode-group"><button id="cropFit" class="active">Fit</button><button id="cropFill">Fill</button></div>
      <div class="crop-mode-group"><button id="cropFrameMode" class="active">Crop Frame</button><button id="cropPanMode">Move Image</button></div>
      <div style="display:flex;align-items:center;gap:5px">
        <button class="btn btn-sm" id="cropZoomOut" title="Zoom out"><i data-lucide="zoom-out" class="w-3.5 h-3.5"></i></button>
        <input type="range" id="cropZoom" min="0.5" max="4" step="0.05" value="1" style="width:110px;accent-color:var(--accent)">
        <button class="btn btn-sm" id="cropZoomIn" title="Zoom in"><i data-lucide="zoom-in" class="w-3.5 h-3.5"></i></button>
      </div>
    </div>
    <div class="crop-toolbar-row">
      <div style="display:flex;gap:4px;flex-wrap:wrap">
        <button class="btn btn-sm" id="cropRotate"><i data-lucide="rotate-cw" class="w-3.5 h-3.5"></i> Rotate</button>
        <button class="btn btn-sm" id="cropFlipH"><i data-lucide="flip-horizontal" class="w-3.5 h-3.5"></i> Flip H</button>
        <button class="btn btn-sm" id="cropFlipV"><i data-lucide="flip-vertical" class="w-3.5 h-3.5"></i> Flip V</button>
      </div>
      <button class="btn btn-sm" id="cropReset"><i data-lucide="refresh-cw" class="w-3.5 h-3.5"></i> Reset</button>
    </div>
    <div class="modal-actions" style="margin-top:14px"><button class="btn" id="cropCancel">Cancel</button><button class="btn" id="cropCover">Use as Cover</button><button class="btn btn-primary" id="cropApply">Apply Crop</button></div>
  </div></div>`;
  refreshIcons();

  const viewport=document.getElementById('cropViewport');
  const cropImg=document.getElementById('cropImg');
  const frame=document.getElementById('cropFrame');
  const close=()=>root.innerHTML='';
  document.getElementById('cropCancel').onclick=close;
  root.querySelector('.modal-overlay').onclick=e=>{if(e.target===e.currentTarget) close();};

  const saved=(()=>{try{return JSON.parse(img.getAttribute('data-crop-params')||'{}');}catch(e){return {};}})();
  const s={ratio:saved.ratio||'free',mode:saved.mode||'fit',interaction:'frame',zoom:saved.zoom||1,rot:saved.rot||0,flipH:!!saved.flipH,flipV:!!saved.flipV,panX:saved.panX||0,panY:saved.panY||0,frame:null,nw:0,nh:0,base:1};
  let action=null;

  function ratioValue(){
    const map={'1:1':1,'3:4':3/4,'4:5':4/5,'4:3':4/3,'16:9':16/9,'21:9':21/9,'9:16':9/16,cover:3};
    if(s.ratio==='original') return s.nw/s.nh;
    return map[s.ratio]||null;
  }
  function clampFrame(f){
    const min=48,vw=viewport.clientWidth,vh=viewport.clientHeight;
    f.w=Math.max(min,Math.min(f.w,vw)); f.h=Math.max(min,Math.min(f.h,vh));
    f.x=Math.max(0,Math.min(f.x,vw-f.w)); f.y=Math.max(0,Math.min(f.y,vh-f.h));
  }
  function setRatio(ratio){
    s.ratio=ratio; const asp=ratioValue(); const vw=viewport.clientWidth,vh=viewport.clientHeight;
    let w=vw*.78,h=vh*.72;
    if(asp){h=w/asp;if(h>vh*.78){h=vh*.78;w=h*asp;}}
    s.frame={x:(vw-w)/2,y:(vh-h)/2,w,h}; clampFrame(s.frame); render();
  }
  function calcBase(){
    const vw=viewport.clientWidth,vh=viewport.clientHeight;
    return s.mode==='fill'?Math.max(vw/s.nw,vh/s.nh):Math.min(vw/s.nw,vh/s.nh);
  }
  function render(){
    if(!s.frame)return; s.base=calcBase();
    cropImg.style.width=s.nw*s.base+'px';cropImg.style.height=s.nh*s.base+'px';
    cropImg.style.transform=`translate(calc(-50% + ${s.panX}px),calc(-50% + ${s.panY}px)) scale(${s.zoom}) rotate(${s.rot}deg) scale(${s.flipH?-1:1},${s.flipV?-1:1})`;
    Object.assign(frame.style,{left:s.frame.x+'px',top:s.frame.y+'px',width:s.frame.w+'px',height:s.frame.h+'px'});
    document.getElementById('cropZoom').value=s.zoom;
    document.getElementById('cropFit').classList.toggle('active',s.mode==='fit');document.getElementById('cropFill').classList.toggle('active',s.mode==='fill');
    document.getElementById('cropFrameMode').classList.toggle('active',s.interaction==='frame');document.getElementById('cropPanMode').classList.toggle('active',s.interaction==='pan');
    root.querySelectorAll('[data-ratio]').forEach(b=>b.classList.toggle('active',b.dataset.ratio===s.ratio));
  }
  function point(e){const p=e.touches?e.touches[0]:e;return{x:p.clientX,y:p.clientY};}
  function begin(e,type,corner){e.preventDefault();const p=point(e);action={type,corner,sx:p.x,sy:p.y,frame:{...s.frame},panX:s.panX,panY:s.panY};}
  frame.addEventListener('pointerdown',e=>{if(e.target.dataset.cropHandle)begin(e,'resize',e.target.dataset.cropHandle);else begin(e,s.interaction==='pan'?'pan':'frame');});
  viewport.addEventListener('pointerdown',e=>{if(!e.target.closest('#cropFrame'))begin(e,'pan');});
  document.addEventListener('pointermove',e=>{
    if(!action)return; const p=point(e),dx=p.x-action.sx,dy=p.y-action.sy;
    if(action.type==='pan'){s.panX=action.panX+dx;s.panY=action.panY+dy;}
    else if(action.type==='frame'){s.frame.x=action.frame.x+dx;s.frame.y=action.frame.y+dy;clampFrame(s.frame);}
    else{
      let{x,y,w,h}=action.frame;const c=action.corner;if(c.includes('e'))w+=dx;if(c.includes('s'))h+=dy;if(c.includes('w')){x+=dx;w-=dx;}if(c.includes('n')){y+=dy;h-=dy;}
      const asp=ratioValue();if(asp){if(Math.abs(dx)>Math.abs(dy))h=w/asp;else w=h*asp;if(c.includes('w'))x=action.frame.x+action.frame.w-w;if(c.includes('n'))y=action.frame.y+action.frame.h-h;}
      s.frame={x,y,w,h};clampFrame(s.frame);
    }render();
  });
  document.addEventListener('pointerup',()=>action=null);

  cropImg.onload=()=>{s.nw=cropImg.naturalWidth;s.nh=cropImg.naturalHeight;setRatio(s.ratio);};
  root.querySelectorAll('[data-ratio]').forEach(b=>b.onclick=()=>setRatio(b.dataset.ratio));
  document.getElementById('cropFit').onclick=()=>{s.mode='fit';render();};document.getElementById('cropFill').onclick=()=>{s.mode='fill';render();};
  document.getElementById('cropFrameMode').onclick=()=>{s.interaction='frame';render();};document.getElementById('cropPanMode').onclick=()=>{s.interaction='pan';render();};
  document.getElementById('cropZoom').oninput=e=>{s.zoom=+e.target.value;render();};document.getElementById('cropZoomIn').onclick=()=>{s.zoom=Math.min(4,s.zoom+.15);render();};document.getElementById('cropZoomOut').onclick=()=>{s.zoom=Math.max(.5,s.zoom-.15);render();};
  document.getElementById('cropRotate').onclick=()=>{s.rot=(s.rot+90)%360;render();};document.getElementById('cropFlipH').onclick=()=>{s.flipH=!s.flipH;render();};document.getElementById('cropFlipV').onclick=()=>{s.flipV=!s.flipV;render();};
  document.getElementById('cropReset').onclick=()=>{Object.assign(s,{ratio:'free',mode:'fit',zoom:1,rot:0,flipH:false,flipV:false,panX:0,panY:0});setRatio('free');};

  async function apply(asCover){
    const vw=viewport.clientWidth,vh=viewport.clientHeight,q=Math.min(4,Math.max(1,s.nw/(s.nw*s.base*s.zoom)));
    const stage=document.createElement('canvas');stage.width=Math.round(vw*q);stage.height=Math.round(vh*q);const c=stage.getContext('2d');
    const src=new Image();src.onload=()=>{
      c.save();c.translate((vw/2+s.panX)*q,(vh/2+s.panY)*q);c.rotate(s.rot*Math.PI/180);c.scale((s.flipH?-1:1)*s.base*s.zoom*q,(s.flipV?-1:1)*s.base*s.zoom*q);c.drawImage(src,-s.nw/2,-s.nh/2);c.restore();
      const out=document.createElement('canvas');out.width=Math.max(1,Math.round(s.frame.w*q));out.height=Math.max(1,Math.round(s.frame.h*q));out.getContext('2d').drawImage(stage,s.frame.x*q,s.frame.y*q,s.frame.w*q,s.frame.h*q,0,0,out.width,out.height);
      out.toBlob(async blob=>{
        if(!blob)return toast('Crop could not be applied');
        const derivedId=await saveMediaBlob(blob,'cropped-image.png','image');const url=await getMediaURL(derivedId);
        img.setAttribute('data-original-media-id',mediaId);img.setAttribute('data-media-id',derivedId);img.setAttribute('data-crop-params',JSON.stringify({...s,frame:s.frame,sourceId:mediaId}));img.src=url;img.removeAttribute('data-rotate');img.removeAttribute('data-flip-h');img.style.transform='';
        applyReflow(img);handleBodyInput();if(asCover)setNotebookCover(img);close();toast(asCover?'Cover crop saved':'Crop applied');
      },'image/png');
    };src.src=sourceURL;
  }
  document.getElementById('cropApply').onclick=()=>apply(false);document.getElementById('cropCover').onclick=()=>apply(true);
}
