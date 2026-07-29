/* ============================================================
   TABLE TOOLS (fix #7 & formatting enhancements)
   Contextual toolbar + column drag-resize. No changes to insertTable().
   ============================================================ */
let activeCell=null;
let selectedCells=new Set();  // multi-cell selection
let selAnchor=null;            // shift-click / drag anchor

/* Return all cells inside a table in row-then-column order */
function tableCells(tbl){ return tbl?Array.from(tbl.querySelectorAll('td,th')):[] ; }

/* Get rectangular range between two cells (inclusive) */
function cellRange(tbl,a,b){
  if(!tbl||!a||!b) return new Set([a].filter(Boolean));
  const rows=Array.from(tbl.rows);
  const allCells=rows.map(r=>Array.from(r.cells));
  let r1=a.parentElement,r2=b.parentElement;
  let ri1=rows.indexOf(r1),ri2=rows.indexOf(r2);
  let ci1=Array.from(r1.cells).indexOf(a),ci2=Array.from(r2.cells).indexOf(b);
  if(ri1>ri2)[ri1,ri2]=[ri2,ri1];
  if(ci1>ci2)[ci1,ci2]=[ci2,ci1];
  const out=new Set();
  for(let r=ri1;r<=ri2;r++) for(let c=ci1;c<=ci2;c++) if(allCells[r]&&allCells[r][c]) out.add(allCells[r][c]);
  return out;
}

function highlightSelected(){
  const tbl=currentTable();
  if(tbl) tableCells(tbl).forEach(c=>c.classList.toggle('tbl-selected',selectedCells.has(c)));
}

function clearCellSelection(){
  selectedCells.forEach(c=>c.classList.remove('tbl-selected'));
  selectedCells=new Set();
  selAnchor=null;
}

/* Apply a fn to every selected cell (falls back to activeCell) */
function onSelected(fn){ if(selectedCells.size>0) selectedCells.forEach(fn); else if(activeCell) fn(activeCell); }

function currentTable(){ return activeCell ? activeCell.closest('table') : null; }

function positionTableTools(){
  const tools=document.getElementById('tblTools');
  const tbl=currentTable();
  if(!tools) return;
  if(!tbl){
    tools.classList.remove('show');
    document.getElementById('tblColorDropdown')?.classList.remove('show');
    return;
  }
  const r=tbl.getBoundingClientRect();
  const ed=bodyEl().getBoundingClientRect();
  if(r.bottom<ed.top || r.top>ed.bottom){
    tools.classList.remove('show');
    document.getElementById('tblColorDropdown')?.classList.remove('show');
    return;
  }
  tools.classList.add('show');
  const w=tools.offsetWidth||400;
  let top=r.top-tools.offsetHeight-8;
  if(top<ed.top+6) top=r.bottom+8;
  tools.style.top=`${Math.round(Math.max(8,top))}px`;
  tools.style.left=`${Math.round(Math.max(8,Math.min(r.left+r.width/2-w/2,window.innerWidth-w-8)))}px`;
}

function tblFitWindow(){
  const tbl=currentTable(); if(!tbl) return;
  tbl.style.tableLayout='fixed';
  tbl.style.width='100%';
  const cols=tbl.querySelector('tr')?.children.length||1;
  tbl.querySelectorAll('th,td').forEach(c=>{ c.style.width=`${Math.round(100/cols)}%`; });
  handleBodyInput(); positionTableTools();
  toast('Table fit to window width');
}

function tblFitContent(){
  const tbl=currentTable(); if(!tbl) return;
  tbl.style.tableLayout='auto';
  tbl.style.width='auto';
  tbl.querySelectorAll('th,td').forEach(c=>{ c.style.width=''; });
  handleBodyInput(); positionTableTools();
  toast('Table fit to content size');
}

function tblDistribute(){
  const tbl=currentTable(); if(!tbl) return;
  const tr=tbl.querySelector('tr'); if(!tr) return;
  const cols=tr.children.length;
  tbl.style.tableLayout='fixed';
  tbl.style.width='100%';
  tbl.querySelectorAll('th,td').forEach(c=>{ c.style.width=`${Math.round(100/cols)}%`; });
  handleBodyInput(); positionTableTools();
  toast('Columns distributed evenly');
}

function tblHeaderRow(){
  const tbl=currentTable(); if(!tbl) return;
  const headRow=tbl.querySelector('tr'); if(!headRow) return;
  const isHeader=Array.from(headRow.children).every(c=>c.tagName==='TH');
  const tag=isHeader?'td':'th';
  const newRow=document.createElement('tr');
  Array.from(headRow.children).forEach(c=>{
    const cell=document.createElement(tag);
    cell.innerHTML=c.innerHTML;
    if(c.style.cssText) cell.style.cssText=c.style.cssText;
    newRow.appendChild(cell);
  });
  headRow.replaceWith(newRow);
  activeCell=newRow.firstElementChild;
  handleBodyInput(); positionTableTools();
  toast('Header row toggled');
}

function tblHeaderCol(){
  const tbl=currentTable(); if(!tbl) return;
  tbl.querySelectorAll('tr').forEach(tr=>{
    const firstCell=tr.firstElementChild; if(!firstCell) return;
    const tag=firstCell.tagName==='TH'?'td':'th';
    const cell=document.createElement(tag);
    cell.innerHTML=firstCell.innerHTML;
    if(firstCell.style.cssText) cell.style.cssText=firstCell.style.cssText;
    firstCell.replaceWith(cell);
  });
  handleBodyInput(); positionTableTools();
  toast('Header column toggled');
}

function tblAltRowShading(){
  const tbl=currentTable(); if(!tbl) return;
  const hasAlt=tbl.classList.toggle('alt-shading');
  handleBodyInput(); positionTableTools();
  toast(hasAlt?'Alternate shading enabled':'Alternate shading disabled');
}

function toggleCellBorder(){
  const tbl=currentTable(); if(!tbl) return;
  const cells=tbl.querySelectorAll('th,td');
  let hasBorders=true;
  if(cells[0] && cells[0].style.borderStyle==='none') hasBorders=false;
  cells.forEach(c=>{
    c.style.border=hasBorders?'none':'';
  });
  handleBodyInput(); positionTableTools();
  toast(hasBorders?'Cell borders hidden':'Cell borders shown');
}

function tblInsertRow(where){
  if(!activeCell) return;
  const row=activeCell.parentElement;
  const cols=row.children.length;
  const tr=document.createElement('tr');
  for(let i=0;i<cols;i++){
    const td=document.createElement(row.children[i].tagName.toLowerCase()||'td');
    td.innerHTML='&nbsp;';
    tr.appendChild(td);
  }
  if(where==='above') row.parentElement.insertBefore(tr,row);
  else row.parentElement.insertBefore(tr,row.nextSibling);
  handleBodyInput(); positionTableTools();
}

function tblDeleteRow(){
  if(!activeCell) return;
  const row=activeCell.parentElement;
  const parent=row.parentElement;
  if(parent.children.length<=1){ toast('Cannot delete last row'); return; }
  const next=row.nextElementSibling||row.previousElementSibling;
  row.remove();
  activeCell=next?next.querySelector('td,th'):null;
  handleBodyInput(); positionTableTools();
}

function tblInsertCol(where){
  if(!activeCell) return;
  const tbl=currentTable(); if(!tbl) return;
  const row=activeCell.parentElement;
  const idx=Array.from(row.children).indexOf(activeCell);
  tbl.querySelectorAll('tr').forEach(tr=>{
    const ref=tr.children[idx];
    const isHead=ref && ref.tagName==='TH';
    const cell=document.createElement(isHead?'th':'td');
    cell.innerHTML='&nbsp;';
    if(where==='left') tr.insertBefore(cell, ref);
    else tr.insertBefore(cell, ref?ref.nextSibling:null);
  });
  handleBodyInput(); positionTableTools();
}

function tblDeleteCol(){
  if(!activeCell) return;
  const tbl=currentTable(); if(!tbl) return;
  const row=activeCell.parentElement;
  const idx=Array.from(row.children).indexOf(activeCell);
  const cols=row.children.length;
  if(cols<=1){ toast('Cannot delete last column'); return; }
  tbl.querySelectorAll('tr').forEach(tr=>{ if(tr.children[idx]) tr.children[idx].remove(); });
  activeCell=null;
  handleBodyInput(); positionTableTools();
}

/* tblCellAlign and tblCellValign defined later with multi-selection support */

function toggleTblColorPicker(e){
  e.stopPropagation();
  const dropdown=document.getElementById('tblColorDropdown'); if(!dropdown) return;
  const wasShow=dropdown.classList.contains('show');
  document.querySelectorAll('.tbl-color-dropdown').forEach(d=>d.classList.remove('show'));
  if(!wasShow && activeCell){
    dropdown.classList.add('show');
    const r=document.getElementById('tblCellBg').getBoundingClientRect();
    dropdown.style.top=`${Math.round(r.bottom+6)}px`;
    dropdown.style.left=`${Math.round(Math.max(8,Math.min(r.left,window.innerWidth-180)))}px`;
  }
}

function tblDelete(){
  const tbl=currentTable(); if(!tbl) return;
  confirmDialog('Delete table?','This will permanently remove the table and its contents.','Delete',()=>{
    const wrap=tbl.closest('.table-wrapper');
    if(wrap) wrap.remove(); else tbl.remove();
    activeCell=null;
    document.getElementById('tblTools')?.classList.remove('show');
    document.getElementById('tblColorDropdown')?.classList.remove('show');
    handleBodyInput();
  });
}
function tblEqualRowH(){
  const tbl=currentTable(); if(!tbl) return;
  tbl.querySelectorAll('tr').forEach(r=>{ r.style.height=''; });
  const rows=Array.from(tbl.rows);
  const max=rows.reduce((m,r)=>Math.max(m,r.offsetHeight),0);
  rows.forEach(r=>{ r.style.height=max+'px'; });
  handleBodyInput(); positionTableTools();
  toast('Equal row heights applied');
}

function tblMobileWrap(){
  const tbl=currentTable(); if(!tbl) return;
  const hasWrap=tbl.classList.toggle('tbl-mobile-wrap');
  handleBodyInput(); positionTableTools();
  toast(hasWrap?'Mobile scroll mode on':'Mobile scroll mode off');
}

/* ── Merge / Split ── */
function tblMergeCells(){
  if(selectedCells.size<2){ toast('Select 2 or more cells to merge'); return; }
  const tbl=currentTable(); if(!tbl) return;
  const rows=Array.from(tbl.rows);
  const allCells=rows.map(r=>Array.from(r.cells));
  const sel=[...selectedCells];
  // Validate rectangular shape
  const rowIdxs=[...new Set(sel.map(c=>rows.indexOf(c.parentElement)))].sort((a,b)=>a-b);
  const colIdxs=[...new Set(sel.map(c=>{const r=c.parentElement;return Array.from(r.cells).indexOf(c);}))].sort((a,b)=>a-b);
  const expected=rowIdxs.length*colIdxs.length;
  if(sel.length!==expected){ toast('Only rectangular selections can be merged'); return; }
  // Collect content
  const pivot=allCells[rowIdxs[0]]?.[colIdxs[0]]; if(!pivot) return;
  const html=sel.map(c=>c.innerHTML.replace(/&nbsp;/g,'').trim()).filter(Boolean).join('<br>');
  pivot.innerHTML=html||'&nbsp;';
  pivot.setAttribute('colspan',String(colIdxs.length));
  pivot.setAttribute('rowspan',String(rowIdxs.length));
  // Remove the other selected cells
  sel.forEach(c=>{ if(c!==pivot) c.remove(); });
  activeCell=pivot; clearCellSelection(); selectedCells.add(pivot); highlightSelected();
  handleBodyInput(); positionTableTools();
  toast('Cells merged');
}

function tblSplitCell(){
  if(!activeCell) return;
  const cs=parseInt(activeCell.getAttribute('colspan')||'1',10);
  const rs=parseInt(activeCell.getAttribute('rowspan')||'1',10);
  if(cs===1&&rs===1){ toast('Cell is not merged'); return; }
  const tag=activeCell.tagName.toLowerCase();
  const html=activeCell.innerHTML;
  activeCell.removeAttribute('colspan'); activeCell.removeAttribute('rowspan');
  activeCell.setAttribute('colspan','1'); activeCell.setAttribute('rowspan','1');
  const row=activeCell.parentElement;
  // Insert missing cells in same row
  for(let c=1;c<cs;c++){
    const cell=document.createElement(tag); cell.innerHTML='&nbsp;';
    row.insertBefore(cell,activeCell.nextSibling);
  }
  // Insert rows for rowspan>1
  const rows=Array.from(activeCell.closest('table').rows);
  const rowIdx=rows.indexOf(row);
  for(let r=1;r<rs;r++){
    const targetRow=rows[rowIdx+r]; if(!targetRow) break;
    for(let c=0;c<cs;c++){
      const cell=document.createElement(tag); cell.innerHTML='&nbsp;';
      targetRow.appendChild(cell);
    }
  }
  handleBodyInput(); positionTableTools();
  toast('Cell split');
}

function tblMergeRow(){
  const tbl=currentTable(); if(!tbl||!activeCell) return;
  const row=activeCell.parentElement;
  const cells=Array.from(row.cells);
  if(cells.length<=1){ toast('Row has only one cell'); return; }
  const html=cells.map(c=>c.innerHTML.trim()).filter(Boolean).join('<br>');
  cells[0].innerHTML=html||'&nbsp;';
  cells[0].setAttribute('colspan',String(cells.length));
  cells.slice(1).forEach(c=>c.remove());
  activeCell=cells[0]; handleBodyInput(); positionTableTools();
  toast('Row merged');
}

function tblMergeCol(){
  const tbl=currentTable(); if(!tbl||!activeCell) return;
  const rows=Array.from(tbl.rows);
  const colIdx=Array.from(activeCell.parentElement.cells).indexOf(activeCell);
  const colCells=rows.map(r=>r.cells[colIdx]).filter(Boolean);
  if(colCells.length<=1){ toast('Column has only one cell'); return; }
  const html=colCells.map(c=>c.innerHTML.trim()).filter(Boolean).join('<br>');
  colCells[0].innerHTML=html||'&nbsp;';
  colCells[0].setAttribute('rowspan',String(colCells.length));
  colCells.slice(1).forEach(c=>c.remove());
  activeCell=colCells[0]; handleBodyInput(); positionTableTools();
  toast('Column merged');
}

/* Update alignment ops to work on selection */
function tblCellAlign(val){
  onSelected(c=>{ c.style.textAlign=val; });
  handleBodyInput();
}
function tblCellValign(val){
  onSelected(c=>{ c.style.verticalAlign=val; });
  handleBodyInput();
}

/* Open/close a submenu anchored to a toolbar button, closing others first */
const tblMenuIds=['tblMenuInsert','tblMenuMerge','tblMenuFit','tblMenuAlign','tblMenuMore'];
function openTblMenu(id,triggerEl){
  const menu=document.getElementById(id); if(!menu) return;
  const isOpen=menu.classList.contains('show');
  tblMenuIds.forEach(mid=>document.getElementById(mid)?.classList.remove('show'));
  if(isOpen) return;
  menu.classList.add('show');
  const r=triggerEl.getBoundingClientRect();
  const w=menu.offsetWidth||185;
  const h=menu.offsetHeight||200;
  let top=r.bottom+6;
  if(top+h>window.innerHeight-8) top=Math.max(8,r.top-h-6);
  const left=Math.max(8,Math.min(r.left,window.innerWidth-w-8));
  menu.style.top=`${Math.round(top)}px`;
  menu.style.left=`${Math.round(left)}px`;
}

function openTblSheet(){
  document.getElementById('tblSheetBackdrop')?.classList.add('show');
  document.getElementById('tblSheet')?.classList.add('show');
  refreshIcons();
}
function closeTblSheet(){
  document.getElementById('tblSheetBackdrop')?.classList.remove('show');
  document.getElementById('tblSheet')?.classList.remove('show');
}

function initTableTools(){
  const ed=bodyEl(); if(!ed) return;

  /* ── Track active cell + multi-cell selection ── */
  let isDragSelect=false, dragStart=null;

  function pickCell(e){ return e.target.closest?.('td,th'); }
  function cellInEditor(c){ return c && ed.contains(c); }

  ed.addEventListener('mousedown', e=>{
    const cell=pickCell(e);
    if(!cellInEditor(cell)) return;
    // Column drag-resize: right-edge (within 8px of right border)
    const r=cell.getBoundingClientRect();
    if(e.clientX >= r.right-8){
      // handled below in dragCol block
      return;
    }
    // Shift+click: range selection
    if(e.shiftKey && selAnchor && cellInEditor(selAnchor)){
      clearCellSelection();
      const tbl=cell.closest('table');
      selectedCells=cellRange(tbl,selAnchor,cell);
      activeCell=cell;
      highlightSelected();
      positionTableTools();
      return;
    }
    // Start new selection / drag
    clearCellSelection();
    activeCell=cell;
    selAnchor=cell;
    selectedCells=new Set([cell]);
    highlightSelected();
    isDragSelect=true; dragStart=cell;
    positionTableTools();
  });

  ed.addEventListener('mouseover', e=>{
    if(!isDragSelect||!dragStart) return;
    const cell=pickCell(e);
    if(!cellInEditor(cell)||!cell.closest('table')) return;
    clearCellSelection();
    const tbl=dragStart.closest('table');
    selectedCells=cellRange(tbl,dragStart,cell);
    activeCell=cell;
    highlightSelected();
    positionTableTools();
  });

  document.addEventListener('mouseup', ()=>{
    if(isDragSelect) isDragSelect=false;
  });

  // Touch: single tap → cell focus; two-finger drag → pan (native)
  ed.addEventListener('touchstart', e=>{
    const cell=pickCell(e);
    if(!cellInEditor(cell)) return;
    clearCellSelection();
    activeCell=cell; selAnchor=cell; selectedCells=new Set([cell]);
    highlightSelected(); positionTableTools();
  }, {passive:true});

  ed.addEventListener('keyup', ()=>{
    const sel=window.getSelection();
    if(!sel||!sel.anchorNode) return;
    let n=sel.anchorNode.nodeType===3?sel.anchorNode.parentElement:sel.anchorNode;
    const cell=n&&n.closest?n.closest('td,th'):null;
    if(cell!==activeCell){ activeCell=cell; if(cell&&!selectedCells.has(cell)){ clearCellSelection(); if(cell){selectedCells=new Set([cell]);highlightSelected();} } positionTableTools(); }
  });

  ed.addEventListener('scroll',  positionTableTools, {passive:true});
  window.addEventListener('resize', positionTableTools);

  /* ── Column drag-resize (mouse, right edge of any cell) ── */
  let dragCol=null;
  ed.addEventListener('mousedown', e=>{
    const cell=pickCell(e); if(!cellInEditor(cell)) return;
    const r=cell.getBoundingClientRect();
    if(e.clientX < r.right-8) return;  // not on the resize edge
    e.preventDefault(); e.stopPropagation();
    isDragSelect=false;
    dragCol={cell,startX:e.clientX,startW:cell.offsetWidth};
    document.body.style.userSelect='none';
  });
  document.addEventListener('mousemove', e=>{
    if(!dragCol) return;
    dragCol.cell.style.width=Math.max(40,dragCol.startW+(e.clientX-dragCol.startX))+'px';
    const tbl=dragCol.cell.closest('table'); if(tbl) tbl.style.tableLayout='fixed';
    positionTableTools();
  });
  document.addEventListener('mouseup', ()=>{
    if(dragCol){ dragCol=null; document.body.style.userSelect=''; handleBodyInput(); }
  });

  /* ── Row drag-resize (mouse, bottom edge of any cell) ── */
  let dragRow=null;
  ed.addEventListener('mousedown', e=>{
    const cell=pickCell(e); if(!cellInEditor(cell)) return;
    const r=cell.getBoundingClientRect();
    if(e.clientY < r.bottom-6) return;
    if(e.clientX >= r.right-8) return; // let col resize win
    e.preventDefault(); e.stopPropagation();
    isDragSelect=false;
    dragRow={row:cell.parentElement,startY:e.clientY,startH:cell.parentElement.offsetHeight};
    document.body.style.userSelect='none';
  });
  document.addEventListener('mousemove', e=>{
    if(!dragRow) return;
    dragRow.row.style.height=Math.max(20,dragRow.startH+(e.clientY-dragRow.startY))+'px';
    positionTableTools();
  });
  document.addEventListener('mouseup', ()=>{
    if(dragRow){ dragRow=null; document.body.style.userSelect=''; handleBodyInput(); }
  });

  /* ── Primary toolbar button → menu mapping ── */
  const menuBtnMap={
    tblBtnInsert:'tblMenuInsert',
    tblBtnMerge:'tblMenuMerge',
    tblBtnFit:'tblMenuFit',
    tblBtnAlign:'tblMenuAlign',
    tblBtnMore:'tblMenuMore'
  };
  Object.entries(menuBtnMap).forEach(([btnId,menuId])=>{
    const btn=document.getElementById(btnId);
    const menu=document.getElementById(menuId);
    if(btn&&menu){
      btn.addEventListener('mousedown',e=>e.preventDefault());
      btn.addEventListener('click',e=>{ e.stopPropagation(); openTblMenu(menuId,btn); });
    }
  });

  // Mobile: show bottom sheet instead of floating toolbar
  document.getElementById('tblBtnMobileSheet')?.addEventListener('click', openTblSheet);

  /* ── Submenu action wiring ── */
  const actionMap={
    tblRowAbove:()=>tblInsertRow('above'),
    tblRowBelow:()=>tblInsertRow('below'),
    tblRowDel:tblDeleteRow,
    tblColLeft:()=>tblInsertCol('left'),
    tblColRight:()=>tblInsertCol('right'),
    tblColDel:tblDeleteCol,
    tblMergeCells:tblMergeCells,
    tblSplitCell:tblSplitCell,
    tblMergeRow:tblMergeRow,
    tblMergeCol:tblMergeCol,
    tblFitWindow:tblFitWindow,
    tblFitContent:tblFitContent,
    tblDistribute:tblDistribute,
    tblEqualRowH:tblEqualRowH,
    tblAlignLeft:()=>tblCellAlign('left'),
    tblAlignCenter:()=>tblCellAlign('center'),
    tblAlignRight:()=>tblCellAlign('right'),
    tblValignTop:()=>tblCellValign('top'),
    tblValignMiddle:()=>tblCellValign('middle'),
    tblValignBottom:()=>tblCellValign('bottom'),
    tblHeaderRow:tblHeaderRow,
    tblHeaderCol:tblHeaderCol,
    tblAltRowShading:tblAltRowShading,
    tblCellBg:toggleTblColorPicker,
    tblCellBorder:toggleCellBorder,
    tblMobileWrap:tblMobileWrap,
    tblDel:tblDelete
  };
  Object.entries(actionMap).forEach(([id,fn])=>{
    const el=document.getElementById(id);
    if(!el) return;
    el.addEventListener('mousedown',e=>e.preventDefault());
    el.addEventListener('click',e=>{
      e.stopPropagation();
      tblMenuIds.forEach(mid=>document.getElementById(mid)?.classList.remove('show'));
      fn(e);
    });
  });

  /* ── Mobile sheet wiring ── */
  document.getElementById('tblSheetBackdrop')?.addEventListener('click', closeTblSheet);
  document.getElementById('tblSheet')?.addEventListener('click', e=>{
    const btn=e.target.closest('[data-ts]');
    if(!btn) return;
    const fn=actionMap[btn.dataset.ts];
    if(fn){ closeTblSheet(); fn(e); }
  });

  /* ── Color picker (submenus + sheet invoke it) ── */
  const dropdown=document.getElementById('tblColorDropdown');
  if(dropdown){
    dropdown.addEventListener('mousedown',e=>e.preventDefault());
    dropdown.addEventListener('click',e=>{
      const sw=e.target.closest('[data-color]');
      if(sw){
        onSelected(c=>{ c.style.background=sw.dataset.color==='transparent'?'':sw.dataset.color; });
        dropdown.classList.remove('show');
        handleBodyInput();
      }
    });
  }

  /* ── Close all table menus on outside click ── */
  document.addEventListener('click', e=>{
    if(!e.target.closest('.tbl-submenu')&&!e.target.closest('#tblTools')){
      tblMenuIds.forEach(mid=>document.getElementById(mid)?.classList.remove('show'));
    }
    if(!e.target.closest('#tblColorDropdown')&&!e.target.closest('#tblCellBg')){
      dropdown?.classList.remove('show');
    }
    // Deselect cells if clicking outside any table
    if(!e.target.closest('table')){ clearCellSelection(); positionTableTools(); }
  });

  /* ── On mobile, show sheet button, hide full toolbar ── */
  function adaptTblToolbar(){
    const isMobile=window.innerWidth<=640;
    const sheetBtn=document.getElementById('tblBtnMobileSheet');
    const fullBtns=document.querySelectorAll('#tblTools button:not(#tblBtnMobileSheet):not(#tblDel)');
    if(sheetBtn) sheetBtn.style.display=isMobile?'inline-flex':'none';
    fullBtns.forEach(b=>{ b.style.display=isMobile?'none':''; });
  }
  adaptTblToolbar();
  window.addEventListener('resize', adaptTblToolbar);

  refreshIcons();
}

function initResponsiveImages(){
  const ed=bodyEl();
  const tb=document.getElementById('imgToolbar');
  const sheet=document.getElementById('imgSheet');
  if(!ed) return;

  // Wire batch bar (multi-select actions) — extends single-select, no conflicts
  initBatchBar();

  /* ----- Selection & gestures inside the editor ----- */
  let lastTap=0, longPressTimer=null;
  let lastClickedImg=null; // for Shift-range selection

  ed.addEventListener('click', e=>{
    const img=e.target.closest('img[data-media-id]');
    if(!img){
      // Click outside image: clear both selections unless clicking our own chrome
      if(!e.target.closest('.img-toolbar') && !e.target.closest('#imgBatchBar')){
        clearImageSelection();
        clearMultiSelection();
      }
      return;
    }
    e.preventDefault();
    const now=Date.now();
    if(now-lastTap<300){
      lastTap=0;
      // Double-tap / double-click → fullscreen; clear any multi-selection first
      clearMultiSelection();
      if(deviceClass()==='desktop'){
        const cur=img.getAttribute('data-img-size');
        setImageSizeEx(img, cur==='full'?'large':'full');
      }else{
        openImageFullscreen(img.src);
      }
      return;
    }
    lastTap=now;

    // --- Multi-select modifiers (desktop) ---
    if(deviceClass()==='desktop'){
      if(e.ctrlKey || e.metaKey){
        // Ctrl/Cmd+Click: add/remove from multi-selection
        clearImageSelection(true);
        toggleMultiSelect(img);
        lastClickedImg=img;
        return;
      }
      if(e.shiftKey && lastClickedImg){
        // Shift+Click: range select all images between lastClickedImg and img
        clearImageSelection(true);
        const all=editorImgsInOrder();
        const a=all.indexOf(lastClickedImg), b=all.indexOf(img);
        const [lo,hi]=[Math.min(a,b),Math.max(a,b)];
        all.slice(lo,hi+1).forEach(im=>addToSelection(im));
        return;
      }
    }

    // --- Multi-select tap (mobile/tablet when already in select mode) ---
    if(imgSelectMode){
      toggleMultiSelect(img);
      lastClickedImg=img;
      return;
    }

    // Normal single-select
    clearMultiSelection();
    lastClickedImg=img;
    selectImage(img);
  });

  // Long press: enters multi-select mode on mobile/tablet; opens context on desktop
  ed.addEventListener('touchstart', e=>{
    const img=e.target.closest('img[data-media-id]');
    if(!img) return;
    longPressTimer=setTimeout(()=>{
      if(deviceClass()==='phone'){
        // First long-press enters multi-select mode and selects this image
        if(!imgSelectMode){ clearImageSelection(true); }
        addToSelection(img);
        // Vibration feedback if available
        try{ if('vibrate' in navigator) navigator.vibrate(40); }catch(_){}
      }else{
        selectImage(img);
        if(deviceClass()!=='phone') openImageSheet();
      }
    }, 500);
  }, {passive:true});
  ['touchend','touchmove','touchcancel'].forEach(ev=>
    ed.addEventListener(ev, ()=>{ clearTimeout(longPressTimer); }, {passive:true}));

  // Keep chrome glued to the image while scrolling / resizing
  ed.addEventListener('scroll', ()=>{ if(selectedImg) syncImageChrome(); reposBadges(); }, {passive:true});
  window.addEventListener('resize', ()=>{ if(selectedImg) syncImageChrome(); reposBadges(); });

  /* ----- Floating toolbar ----- */
  if(tb){
    tb.addEventListener('mousedown', e=>e.preventDefault()); // keep selection
    tb.addEventListener('click', e=>{
      const btn=e.target.closest('button'); if(!btn||!selectedImg) return;
      if(btn.dataset.imgsize) return setImageSizeEx(selectedImg, btn.dataset.imgsize);
      if(btn.id==='imgTbCrop') return openCropModal(selectedImg);
      if(btn.id==='imgTbAlignLeft') return setImageAlign(selectedImg,'left');
      if(btn.id==='imgTbAlignCenter') return setImageAlign(selectedImg,'center');
      if(btn.id==='imgTbAlignRight') return setImageAlign(selectedImg,'right');
      if(btn.id==='imgTbRotate') return rotateImage(selectedImg);
      if(btn.id==='imgTbFlip') return flipImage(selectedImg);
      if(btn.id==='imgTbFlipV') return flipImageVertical(selectedImg);
      if(btn.id==='imgTbCaption') return toggleImageCaption(selectedImg);
      if(btn.id==='imgTbCover') return setNotebookCover(selectedImg);
      if(btn.id==='imgTbReplace') return requestImageReplacement(selectedImg);
      if(btn.id==='imgTbView') return openImageFullscreen(selectedImg);
      if(btn.id==='imgTbDownload'){
        const id=selectedImg.getAttribute('data-media-id');
        mediaGet(id).then(rec=>downloadMediaById(id, rec?rec.name:'image'));
        return;
      }
      if(btn.id==='imgTbDelete'){
        const img=selectedImg; clearImageSelection();
        img.remove(); handleBodyInput(); toast('Image removed');
      }
    });
  }

  /* ----- Corner drag resize (tablet + desktop), ratio locked ----- */
  document.querySelectorAll('.img-handle').forEach(h=>{
    const start=e=>{
      if(!selectedImg) return;
      e.preventDefault();
      const pt=e.touches?e.touches[0]:e;
      imgResize={
        startX:pt.clientX,
        startW:selectedImg.getBoundingClientRect().width,
        editorW:bodyEl().clientWidth,
        corner:h.dataset.corner,
        shift:e.shiftKey
      };
      document.body.style.userSelect='none';
    };
    h.addEventListener('mousedown', start);
    h.addEventListener('touchstart', start, {passive:false});
  });

  const moveResize=e=>{
    if(!imgResize||!selectedImg) return;
    const pt=e.touches?e.touches[0]:e;
    const dir=(imgResize.corner==='ne'||imgResize.corner==='se')?1:-1;
    const delta=(pt.clientX-imgResize.startX)*dir;
    const raw=imgResize.startW+delta;
    // Clamp: never smaller than 15% nor wider than the editor.
    const pct=Math.max(15,Math.min(100,(raw/imgResize.editorW)*100));
    selectedImg.style.width=pct.toFixed(1)+'%';
    selectedImg.style.height='auto';          // ratio preserved
    selectedImg.removeAttribute('data-img-size');
    applyReflow(selectedImg);                 // live text-wrap recalculation
    syncImageChrome();
  };
  const endResize=()=>{
    if(!imgResize) return;
    const resizeSession=imgResize;
    imgResize=null;
    document.body.style.userSelect='';
    // Snap to the nearest preset unless the user held Shift (freeform).
    if(selectedImg && !resizeSession.shift){
      const pct=parseFloat(selectedImg.style.width)||100;
      const snaps=[['small',35],['medium',55],['large',78],['full',100]];
      const near=snaps.find(([,v])=>Math.abs(pct-v)<7);
      if(near){ selectedImg.style.width=''; selectedImg.setAttribute('data-img-size',near[0]); }
    }
    if(selectedImg) applyReflow(selectedImg);
    syncImageChrome();
    handleBodyInput();
  };
  document.addEventListener('mousemove', moveResize);
  document.addEventListener('touchmove', moveResize, {passive:false});
  document.addEventListener('mouseup', endResize);
  document.addEventListener('touchend', endResize);

  /* ----- Mobile bottom sheet ----- */
  document.getElementById('imgSheetBackdrop')?.addEventListener('click', ()=>{
    closeImageSheet(); clearImageSelection(true);
  });
  sheet?.addEventListener('click', e=>{
    const btn=e.target.closest('button'); if(!btn||!selectedImg) return;
    if(btn.dataset.imgsize){
      setImageSizeEx(selectedImg, btn.dataset.imgsize);
      sheet.querySelectorAll('[data-imgsize]').forEach(b=>
        b.classList.toggle('active', b.dataset.imgsize===btn.dataset.imgsize));
      return;
    }
    if(btn.id==='imgSheetCrop'){ closeImageSheet(); openCropModal(selectedImg); return; }
    if(btn.id==='imgSheetAlignLeft'){ setImageAlign(selectedImg,'left'); return; }
    if(btn.id==='imgSheetAlignCenter'){ setImageAlign(selectedImg,'center'); return; }
    if(btn.id==='imgSheetAlignRight'){ setImageAlign(selectedImg,'right'); return; }
    if(btn.id==='imgSheetCaption'){ closeImageSheet(); toggleImageCaption(selectedImg); return; }
    if(btn.id==='imgSheetCover'){ closeImageSheet(); setNotebookCover(selectedImg); return; }
    if(btn.id==='imgSheetReplace'){ const target=selectedImg; closeImageSheet(); requestImageReplacement(target); return; }
    if(btn.id==='imgSheetRotate'){ rotateImage(selectedImg); return; }
    if(btn.id==='imgSheetFlip'){ flipImage(selectedImg); return; }
    if(btn.id==='imgSheetFlipV'){ flipImageVertical(selectedImg); return; }
    if(btn.id==='imgSheetView'){ closeImageSheet(); openImageFullscreen(selectedImg); return; }
    if(btn.id==='imgSheetDownload'){
      const id=selectedImg.getAttribute('data-media-id');
      mediaGet(id).then(rec=>downloadMediaById(id, rec?rec.name:'image'));
      closeImageSheet(); return;
    }
    if(btn.id==='imgSheetDelete'){
      const img=selectedImg; closeImageSheet(); clearImageSelection(true);
      img.remove(); handleBodyInput(); toast('Image removed');
    }
  });

  /* ----- Fullscreen: pinch (touch) + wheel (mouse) zoom, drag to pan + gallery nav ----- */
  const fs=document.getElementById('imgFullscreen');
  const fsImg=document.getElementById('imgFsImage');
  document.getElementById('imgFsClose')?.addEventListener('click', closeImageFullscreen);
  document.getElementById('imgFsPrev')?.addEventListener('click', e=>{ e.stopPropagation(); navFsImage(-1); });
  document.getElementById('imgFsNext')?.addEventListener('click', e=>{ e.stopPropagation(); navFsImage(1); });
  fs?.addEventListener('click', e=>{ if(e.target===fs) closeImageFullscreen(); });

  const applyFs=()=>{
    fsImg.style.transform=`translate(${fsZoom.x}px,${fsZoom.y}px) scale(${fsZoom.scale})`;
  };
  fs?.addEventListener('wheel', e=>{
    e.preventDefault();
    fsZoom.scale=Math.max(1,Math.min(5,fsZoom.scale-e.deltaY*0.0018));
    if(fsZoom.scale===1){ fsZoom.x=0; fsZoom.y=0; }
    applyFs();
  }, {passive:false});

  let pinchStart=0, panStart=null;
  fs?.addEventListener('touchstart', e=>{
    if(e.touches.length===2){
      pinchStart=Math.hypot(e.touches[0].clientX-e.touches[1].clientX,
                            e.touches[0].clientY-e.touches[1].clientY)/fsZoom.scale;
    }else if(e.touches.length===1 && fsZoom.scale>1){
      panStart={x:e.touches[0].clientX-fsZoom.x, y:e.touches[0].clientY-fsZoom.y};
    }
  }, {passive:true});
  fs?.addEventListener('touchmove', e=>{
    if(e.touches.length===2 && pinchStart){
      e.preventDefault();
      const d=Math.hypot(e.touches[0].clientX-e.touches[1].clientX,
                         e.touches[0].clientY-e.touches[1].clientY);
      fsZoom.scale=Math.max(1,Math.min(5,d/pinchStart));
      if(fsZoom.scale===1){ fsZoom.x=0; fsZoom.y=0; }
      applyFs();
    }else if(e.touches.length===1 && panStart && fsZoom.scale>1){
      e.preventDefault();
      fsZoom.x=e.touches[0].clientX-panStart.x;
      fsZoom.y=e.touches[0].clientY-panStart.y;
      applyFs();
    }
  }, {passive:false});
  fs?.addEventListener('touchend', ()=>{ pinchStart=0; panStart=null; }, {passive:true});

  // Desktop drag-to-pan when zoomed
  let mousePan=null;
  fsImg?.addEventListener('mousedown', e=>{
    if(fsZoom.scale<=1) return;
    e.preventDefault();
    mousePan={x:e.clientX-fsZoom.x, y:e.clientY-fsZoom.y};
  });
  document.addEventListener('mousemove', e=>{
    if(!mousePan) return;
    fsZoom.x=e.clientX-mousePan.x; fsZoom.y=e.clientY-mousePan.y; applyFs();
  });
  document.addEventListener('mouseup', ()=>{ mousePan=null; });

  /* ----- Desktop keyboard shortcuts (extend only) ----- */
  document.addEventListener('keydown', e=>{
    if(document.getElementById('imgFullscreen')?.classList.contains('show')){
      if(e.key==='Escape'){ e.preventDefault(); closeImageFullscreen(); }
      else if(e.key==='ArrowLeft'){ e.preventDefault(); navFsImage(-1); }
      else if(e.key==='ArrowRight'){ e.preventDefault(); navFsImage(1); }
      return;
    }
    // Batch: Escape clears multi-select before clearing single-select
    if(e.key==='Escape'){
      if(selectedImgs.size){ clearMultiSelection(); return; }
      clearImageSelection();
      return;
    }
    // Batch keyboard actions when multiple images are selected
    if(selectedImgs.size>0){
      const sizeMap={'1':'small','2':'medium','3':'large','4':'full'};
      if(sizeMap[e.key]){ e.preventDefault(); batchResize(sizeMap[e.key]); return; }
      if(e.key==='Delete'||e.key==='Backspace'){ e.preventDefault(); batchDelete(); return; }
      if(e.key==='g'||(e.key==='g'&&(e.ctrlKey||e.metaKey))){ e.preventDefault(); convertSelectionToGallery(); return; }
    }
    if(!selectedImg) return;
    const map={'1':'small','2':'medium','3':'large','4':'full'};
    if(map[e.key]){ e.preventDefault(); setImageSizeEx(selectedImg, map[e.key]); }
    else if(e.key==='Enter'){ e.preventDefault(); openImageFullscreen(selectedImg.src); }
    else if(e.key==='Delete'||e.key==='Backspace'){
      e.preventDefault();
      const img=selectedImg; clearImageSelection();
      img.remove(); handleBodyInput(); toast('Image removed');
    }
  });

  // Re-apply device defaults when crossing a breakpoint (portrait ↔ landscape)
  let lastDev=deviceClass();
  window.addEventListener('resize', ()=>{
    const d=deviceClass();
    if(d!==lastDev){
      lastDev=d;
      clearImageSelection();
      clearMultiSelection();
      normalizeEditorImages();
    }
  });
}
