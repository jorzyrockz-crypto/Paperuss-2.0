/* ============================================================
   TABLE TOOLS
   Contextual toolbar, range selection, resizing, and block movement.
   ============================================================ */
let activeCell=null;
let selectedCells=new Set();  // multi-cell selection
let selAnchor=null;            // shift-click / drag anchor

/* Return all cells inside a table in row-then-column order */
function tableCells(tbl){ return tbl?Array.from(tbl.querySelectorAll('td,th')):[] ; }

/*
 * Build a logical grid so selections continue to work after cells have been
 * merged with rowspan/colspan. Each cell records the rectangle it occupies.
 */
function tableCellLayout(tbl){
  const grid=[];
  const positions=new Map();
  Array.from(tbl?.rows||[]).forEach((row,rowIndex)=>{
    if(!grid[rowIndex]) grid[rowIndex]=[];
    let columnIndex=0;
    Array.from(row.cells).forEach(cell=>{
      while(grid[rowIndex][columnIndex]) columnIndex++;
      const rowSpan=Math.max(1,Number(cell.rowSpan)||1);
      const colSpan=Math.max(1,Number(cell.colSpan)||1);
      const position={
        rowStart:rowIndex,
        rowEnd:rowIndex+rowSpan-1,
        colStart:columnIndex,
        colEnd:columnIndex+colSpan-1
      };
      positions.set(cell,position);
      for(let r=position.rowStart;r<=position.rowEnd;r++){
        if(!grid[r]) grid[r]=[];
        for(let c=position.colStart;c<=position.colEnd;c++) grid[r][c]=cell;
      }
      columnIndex+=colSpan;
    });
  });
  return positions;
}

/* Get the rectangular logical range between two cells (inclusive). */
function cellRange(tbl,a,b){
  if(!tbl||!a||!b) return new Set([a].filter(Boolean));
  if(a.closest('table')!==tbl||b.closest('table')!==tbl) return new Set([b]);
  const positions=tableCellLayout(tbl);
  const start=positions.get(a);
  const end=positions.get(b);
  if(!start||!end) return new Set([b]);
  
  let rowStart=Math.min(start.rowStart,end.rowStart);
  let rowEnd=Math.max(start.rowEnd,end.rowEnd);
  let colStart=Math.min(start.colStart,end.colStart);
  let colEnd=Math.max(start.colEnd,end.colEnd);

  // Iteratively expand bounding box until no merged cell is partially cut off
  let changed = true;
  while(changed){
    changed = false;
    positions.forEach((position)=>{
      const intersects =
        position.rowEnd >= rowStart && position.rowStart <= rowEnd &&
        position.colEnd >= colStart && position.colStart <= colEnd;
      if(intersects){
        if(position.rowStart < rowStart){ rowStart = position.rowStart; changed = true; }
        if(position.rowEnd > rowEnd){ rowEnd = position.rowEnd; changed = true; }
        if(position.colStart < colStart){ colStart = position.colStart; changed = true; }
        if(position.colEnd > colEnd){ colEnd = position.colEnd; changed = true; }
      }
    });
  }

  const out=new Set();
  positions.forEach((position,cell)=>{
    const inside =
      position.rowStart >= rowStart && position.rowEnd <= rowEnd &&
      position.colStart >= colStart && position.colEnd <= colEnd;
    if(inside) out.add(cell);
  });
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
  bodyEl()?.querySelectorAll('table.table-selection-mode').forEach(tbl=>tbl.classList.remove('table-selection-mode'));
}

/* Apply a fn to every selected cell (falls back to activeCell) */
function onSelected(fn){ if(selectedCells.size>0) selectedCells.forEach(fn); else if(activeCell) fn(activeCell); }

function currentTable(){ return activeCell ? activeCell.closest('table') : null; }

/*
 * The enclosure keeps wide tables from widening the editor and supplies one
 * stable block boundary for movement and deletion. Normalize imported tables
 * so old and pasted content receives the same behavior as newly inserted data.
 */
function ensureTableWrapper(tbl){
  if(!tbl||tbl.closest('table')!==tbl) return null;
  let wrapper=tbl.parentElement?.classList?.contains('table-wrapper')?tbl.parentElement:null;
  if(!wrapper){
    wrapper=document.createElement('div');
    wrapper.className='table-wrapper';
    tbl.parentNode?.insertBefore(wrapper,tbl);
    wrapper.appendChild(tbl);
  }
  wrapper.setAttribute('contenteditable','false');
  wrapper.setAttribute('data-table-wrapper','1');
  tbl.setAttribute('contenteditable','true');
  return wrapper;
}

function normalizeEditorTables(){
  const ed=bodyEl();
  if(!ed) return;
  Array.from(ed.querySelectorAll('table')).forEach(tbl=>{
    if(!tbl.parentElement?.closest('table')) ensureTableWrapper(tbl);
  });
}

function normalizeTableStructure(tbl){
  if(!tbl) return;
  // Remove rows that have no cells
  Array.from(tbl.rows).forEach(r => { if(r.cells.length === 0) r.remove(); });
  if(tbl.rows.length === 0){
    const wrapper = tbl.closest('.table-wrapper');
    if(wrapper) wrapper.remove();
    else tbl.remove();
  }
}

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
  const ed=(document.getElementById('editorScroll')||bodyEl()).getBoundingClientRect();
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
  const positions=tableCellLayout(tbl);
  const sel=[...selectedCells];
  
  let minRow = Infinity, maxRow = -Infinity, minCol = Infinity, maxCol = -Infinity;
  sel.forEach(cell => {
    const pos = positions.get(cell);
    if(pos){
      minRow = Math.min(minRow, pos.rowStart);
      maxRow = Math.max(maxRow, pos.rowEnd);
      minCol = Math.min(minCol, pos.colStart);
      maxCol = Math.max(maxCol, pos.colEnd);
    }
  });
  
  const targetColSpan = maxCol - minCol + 1;
  const targetRowSpan = maxRow - minRow + 1;
  
  // Find pivot (top-left cell in selection)
  let pivot = null;
  sel.forEach(cell => {
    const pos = positions.get(cell);
    if(pos && pos.rowStart === minRow && pos.colStart === minCol){
      pivot = cell;
    }
  });
  if(!pivot) pivot = sel[0];
  
  // Collect text content from all merged cells
  const html = sel.map(c=>c.innerHTML.replace(/&nbsp;/g,'').trim()).filter(Boolean).join('<br>');
  pivot.innerHTML = html || '&nbsp;';
  
  if(targetColSpan > 1) pivot.setAttribute('colspan', String(targetColSpan));
  else pivot.removeAttribute('colspan');
  
  if(targetRowSpan > 1) pivot.setAttribute('rowspan', String(targetRowSpan));
  else pivot.removeAttribute('rowspan');
  
  // Remove all other merged cells
  sel.forEach(c => {
    if(c !== pivot && c.parentNode) c.remove();
  });
  
  normalizeTableStructure(tbl);
  activeCell = pivot;
  clearCellSelection();
  selectedCells.add(pivot);
  highlightSelected();
  handleBodyInput();
  positionTableTools();
  toast('Cells merged');
}

function tblSplitCell(){
  if(!activeCell) return;
  const cs=parseInt(activeCell.getAttribute('colspan')||'1',10);
  const rs=parseInt(activeCell.getAttribute('rowspan')||'1',10);
  if(cs===1&&rs===1){ toast('Cell is not merged'); return; }
  const tag=activeCell.tagName.toLowerCase();
  
  const tbl=activeCell.closest('table');
  const positions=tableCellLayout(tbl);
  const pos=positions.get(activeCell);
  if(!pos) return;

  activeCell.removeAttribute('colspan'); activeCell.removeAttribute('rowspan');
  const row=activeCell.parentElement;
  const rows=Array.from(tbl.rows);
  
  // Insert missing cells in same row
  for(let c=1;c<cs;c++){
    const cell=document.createElement(tag); cell.innerHTML='&nbsp;';
    row.insertBefore(cell,activeCell.nextSibling);
  }
  
  // Insert cells in subsequent rows
  for(let r=1;r<rs;r++){
    const targetRow=rows[pos.rowStart+r]; if(!targetRow) break;
    
    // Find the right place to insert in targetRow
    let insertBeforeCell = null;
    Array.from(targetRow.cells).forEach(c => {
      const p = positions.get(c);
      if(p && p.colStart >= pos.colStart && !insertBeforeCell){
        insertBeforeCell = c;
      }
    });
    
    for(let c=0;c<cs;c++){
      const cell=document.createElement(tag); cell.innerHTML='&nbsp;';
      targetRow.insertBefore(cell, insertBeforeCell);
    }
  }
  
  normalizeTableStructure(tbl);
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
const tblMenuIds=['tblMenuInsert','tblMenuMerge','tblMenuFit','tblMenuAlign','tblMenuFormula','tblMenuFormat','tblMenuMore'];
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
  normalizeEditorTables();

  /* ── Track active cell + multi-cell selection ── */
  let selectionGesture=null;
  let touchSelectionMode=false;
  let longPressTimer=null;

  function pickCell(e){ return e.target.closest?.('td,th'); }
  function cellInEditor(c){ return c && ed.contains(c); }
  function cellAtPoint(x,y){
    const cell=document.elementFromPoint(x,y)?.closest?.('td,th');
    return cellInEditor(cell)?cell:null;
  }
  function selectRange(anchor,cell){
    const tbl=anchor?.closest('table');
    if(!tbl||cell?.closest('table')!==tbl) return;
    clearCellSelection();
    selectedCells=cellRange(tbl,anchor,cell);
    selAnchor=anchor;
    activeCell=cell;
    highlightSelected();
    if(touchSelectionMode) tbl.classList.add('table-selection-mode');
    positionTableTools();
  }
  function selectOnly(cell){
    if(!cell) return;
    clearCellSelection();
    activeCell=cell;
    selAnchor=cell;
    selectedCells=new Set([cell]);
    highlightSelected();
    positionTableTools();
  }
  function toggleSelectedCell(cell){
    if(!cell) return;
    if(activeCell?.closest('table')!==cell.closest('table')) selectOnly(cell);
    else{
      activeCell=cell;
      selAnchor=selAnchor||cell;
      if(selectedCells.has(cell)&&selectedCells.size>1) selectedCells.delete(cell);
      else selectedCells.add(cell);
      highlightSelected();
      positionTableTools();
    }
  }
  function endSelectionGesture(){
    if(longPressTimer){ clearTimeout(longPressTimer); longPressTimer=null; }
    if(selectionGesture?.dragging) document.body.style.userSelect='';
    selectionGesture=null;
  }

  ed.addEventListener('pointerdown', e=>{
    if(e.button!==0) return;
    const cell=pickCell(e);
    if(!cellInEditor(cell)) return;

    // Mouse resize zones are handled by the dedicated listeners below.
    const r=cell.getBoundingClientRect();
    if(e.pointerType==='mouse'&&(e.clientX>=r.right-8||e.clientY>=r.bottom-6)) return;

    if(e.pointerType==='touch'){
      selectionGesture={
        pointerId:e.pointerId,
        pointerType:'touch',
        startX:e.clientX,
        startY:e.clientY,
        anchor:cell,
        dragging:false,
        longPressed:false
      };
      longPressTimer=setTimeout(()=>{
        if(!selectionGesture||selectionGesture.pointerId!==e.pointerId) return;
        selectionGesture.longPressed=true;
        selectionGesture.dragging=true;
        touchSelectionMode=true;
        selectOnly(cell);
        cell.closest('table')?.classList.add('table-selection-mode');
        document.body.style.userSelect='none';
        toast('Selection mode: drag or tap more cells');
        try{ ed.setPointerCapture(e.pointerId); }catch(_){}
      },420);
      return;
    }

    if(e.shiftKey&&selAnchor&&cellInEditor(selAnchor)){
      selectRange(selAnchor,cell);
      e.preventDefault();
      return;
    }
    if(e.ctrlKey||e.metaKey){
      toggleSelectedCell(cell);
      e.preventDefault();
      return;
    }

    selectOnly(cell);
    selectionGesture={
      pointerId:e.pointerId,
      pointerType:'mouse',
      startX:e.clientX,
      startY:e.clientY,
      anchor:cell,
      dragging:false,
      longPressed:false
    };
  });

  ed.addEventListener('pointermove', e=>{
    const gesture=selectionGesture;
    if(!gesture||gesture.pointerId!==e.pointerId) return;
    const distance=Math.hypot(e.clientX-gesture.startX,e.clientY-gesture.startY);

    if(gesture.pointerType==='touch'&&!gesture.longPressed){
      if(distance>10) endSelectionGesture(); // keep ordinary table scrolling
      return;
    }
    if(gesture.pointerType==='mouse'&&!gesture.dragging&&distance<5) return;

    const cell=cellAtPoint(e.clientX,e.clientY);
    if(!cell||cell.closest('table')!==gesture.anchor.closest('table')) return;
    gesture.dragging=true;
    document.body.style.userSelect='none';
    selectRange(gesture.anchor,cell);
    e.preventDefault();
  });

  ed.addEventListener('pointerup', e=>{
    const gesture=selectionGesture;
    if(!gesture||gesture.pointerId!==e.pointerId) return;
    if(gesture.pointerType==='touch'&&!gesture.longPressed){
      if(longPressTimer){ clearTimeout(longPressTimer); longPressTimer=null; }
      const cell=cellAtPoint(e.clientX,e.clientY)||gesture.anchor;
      if(touchSelectionMode&&cell?.closest('table')===activeCell?.closest('table')){
        toggleSelectedCell(cell);
        cell.closest('table')?.classList.add('table-selection-mode');
        e.preventDefault();
      }else{
        touchSelectionMode=false;
        selectOnly(cell);
      }
    }
    endSelectionGesture();
  });
  ed.addEventListener('pointercancel', endSelectionGesture);
  ed.addEventListener('contextmenu',e=>{
    if(e.target.closest?.('table.table-selection-mode')) e.preventDefault();
  });

  ed.addEventListener('keyup', ()=>{
    const sel=window.getSelection();
    if(!sel||!sel.anchorNode) return;
    let n=sel.anchorNode.nodeType===3?sel.anchorNode.parentElement:sel.anchorNode;
    const cell=n&&n.closest?n.closest('td,th'):null;
    if(cell!==activeCell){ activeCell=cell; if(cell&&!selectedCells.has(cell)){ clearCellSelection(); if(cell){selectedCells=new Set([cell]);highlightSelected();} } positionTableTools(); }
  });

  (document.getElementById('editorScroll')||ed).addEventListener('scroll',positionTableTools,{passive:true});
  window.addEventListener('resize', positionTableTools);

  /* ── Column drag-resize (mouse, right edge of any cell) ── */
  let dragCol=null;
  ed.addEventListener('mousedown', e=>{
    const cell=pickCell(e); if(!cellInEditor(cell)) return;
    const r=cell.getBoundingClientRect();
    if(e.clientX < r.right-8) return;  // not on the resize edge
    e.preventDefault(); e.stopPropagation();
    endSelectionGesture();
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
    endSelectionGesture();
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
  /* Move the enclosed table as one editor block using the toolbar grip. */
  const moveHandle=document.getElementById('tblMoveHandle');
  let tableMove=null;
  function directEditorChild(node){
    let current=node;
    while(current&&current.parentElement!==ed) current=current.parentElement;
    return current;
  }
  function updateTableDropPosition(clientY){
    if(!tableMove) return;
    const blocks=Array.from(ed.children).filter(block=>
      block!==tableMove.placeholder&&block!==tableMove.originBlock
    );
    const before=blocks.find(block=>{
      const rect=block.getBoundingClientRect();
      return clientY<rect.top+rect.height/2;
    });
    ed.insertBefore(tableMove.placeholder,before||null);
  }
  function finishTableMove(commit=true){
    if(!tableMove) return;
    const {unit,placeholder,originParent,originNext,originBlock}=tableMove;
    const moved=commit&&(
      placeholder.parentElement!==originParent||
      placeholder.nextSibling!==unit
    );
    if(commit) placeholder.parentNode?.insertBefore(unit,placeholder);
    else originParent?.insertBefore(unit,originNext);
    placeholder.remove();
    unit.classList.remove('table-moving');
    if(originBlock!==unit&&originBlock?.isConnected&&!originBlock.textContent.trim()&&!originBlock.children.length){
      originBlock.remove();
    }
    document.body.classList.remove('table-block-moving');
    document.body.style.userSelect='';
    tableMove=null;
    if(moved){
      handleBodyInput();
      toast('Table moved');
    }
    positionTableTools();
  }
  moveHandle?.addEventListener('pointerdown',e=>{
    if(e.button!==0) return;
    const tbl=currentTable();
    if(!tbl) return;
    const unit=ensureTableWrapper(tbl)||tbl;
    const originBlock=directEditorChild(unit)||unit;
    const placeholder=document.createElement('div');
    placeholder.className='table-move-placeholder';
    placeholder.setAttribute('contenteditable','false');
    const originParent=unit.parentNode;
    const originNext=unit.nextSibling;
    ed.insertBefore(placeholder,originBlock);
    unit.classList.add('table-moving');
    document.body.classList.add('table-block-moving');
    document.body.style.userSelect='none';
    tableMove={pointerId:e.pointerId,unit,placeholder,originParent,originNext,originBlock};
    try{ moveHandle.setPointerCapture(e.pointerId); }catch(_){}
    e.preventDefault();
    e.stopPropagation();
  });
  moveHandle?.addEventListener('pointermove',e=>{
    if(!tableMove||tableMove.pointerId!==e.pointerId) return;
    updateTableDropPosition(e.clientY);
    e.preventDefault();
  });
  moveHandle?.addEventListener('pointerup',e=>{
    if(!tableMove||tableMove.pointerId!==e.pointerId) return;
    finishTableMove(true);
    e.preventDefault();
  });
  moveHandle?.addEventListener('pointercancel',()=>finishTableMove(false));

  const menuBtnMap={
    tblBtnInsert:'tblMenuInsert',
    tblBtnMerge:'tblMenuMerge',
    tblBtnFit:'tblMenuFit',
    tblBtnAlign:'tblMenuAlign',
    tblBtnFormula:'tblMenuFormula',
    tblBtnFormat:'tblMenuFormat',
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
    tblTplExpense:()=>insertFinancialTemplate('expense'),
    tblTplBudget:()=>insertFinancialTemplate('budget'),
    tblTplVariance:()=>insertFinancialTemplate('variance'),
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
    tblFmSum:()=>tblInsertFormula('=SUM()'),
    tblFmAvg:()=>tblInsertFormula('=AVERAGE()'),
    tblFmCount:()=>tblInsertFormula('=COUNT()'),
    tblFmMin:()=>tblInsertFormula('=MIN()'),
    tblFmMax:()=>tblInsertFormula('=MAX()'),
    tblFmIf:()=>tblInsertFormula('=IF()'),
    tblFmtNone:()=>setCellFormat('number'),
    tblFmtUsd:()=>setCellFormat('currency','$'),
    tblFmtEur:()=>setCellFormat('currency','€'),
    tblFmtGbp:()=>setCellFormat('currency','£'),
    tblFmtJpy:()=>setCellFormat('currency','¥'),
    tblFmtPct:()=>setCellFormat('percent'),
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
    if(!e.target.closest('table')&&!e.target.closest('#tblTools,.tbl-submenu,.tbl-sheet,.tbl-color-dropdown')){
      touchSelectionMode=false;
      clearCellSelection();
      activeCell=null;
      positionTableTools();
    }
  });

  document.addEventListener('keydown',e=>{
    const tbl=currentTable();
    if(!tbl) return;
    
    if(e.key==='Escape'){
      touchSelectionMode=false;
      clearCellSelection();
      activeCell=null;
      positionTableTools();
      return;
    }
    
    // Expand table cell selection with Shift+Arrow IF there is already a multi-cell selection.
    // We require selectedCells.size > 1 to avoid breaking normal text selection within a single cell.
    if(e.shiftKey && ['ArrowUp','ArrowDown','ArrowLeft','ArrowRight'].includes(e.key) && selectedCells.size > 1){
      e.preventDefault();
      const positions = tableCellLayout(tbl);
      let minRow=Infinity, maxRow=-Infinity, minCol=Infinity, maxCol=-Infinity;
      selectedCells.forEach(c => {
        const pos = positions.get(c);
        if(pos){
          minRow=Math.min(minRow,pos.rowStart); maxRow=Math.max(maxRow,pos.rowEnd);
          minCol=Math.min(minCol,pos.colStart); maxCol=Math.max(maxCol,pos.colEnd);
        }
      });
      
      let dRow=0, dCol=0;
      if(e.key==='ArrowUp') dRow=-1;
      if(e.key==='ArrowDown') dRow=1;
      if(e.key==='ArrowLeft') dCol=-1;
      if(e.key==='ArrowRight') dCol=1;
      
      let targetCell = null;
      for (let [cell, pos] of positions.entries()) {
        if (dRow < 0 && pos.rowEnd === minRow - 1 && pos.colStart <= maxCol && pos.colEnd >= minCol) targetCell = cell;
        if (dRow > 0 && pos.rowStart === maxRow + 1 && pos.colStart <= maxCol && pos.colEnd >= minCol) targetCell = cell;
        if (dCol < 0 && pos.colEnd === minCol - 1 && pos.rowStart <= maxRow && pos.rowEnd >= minRow) targetCell = cell;
        if (dCol > 0 && pos.colStart === maxCol + 1 && pos.rowStart <= maxRow && pos.rowEnd >= minRow) targetCell = cell;
        if (targetCell) break;
      }
      
      if(targetCell){
        const anchor = selAnchor || activeCell;
        clearCellSelection();
        selAnchor = anchor;
        selectedCells = cellRange(tbl, anchor, targetCell);
        highlightSelected();
        handleBodyInput();
        positionTableTools();
      }
    }
  });

  /* ── On mobile, show sheet button, hide full toolbar ── */
  function adaptTblToolbar(){
    const isMobile=window.innerWidth<=640;
    const sheetBtn=document.getElementById('tblBtnMobileSheet');
    const fullBtns=document.querySelectorAll('#tblTools button:not(#tblMoveHandle):not(#tblBtnMobileSheet):not(#tblDel)');
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
  (document.getElementById('editorScroll')||ed).addEventListener('scroll',()=>{ if(selectedImg) syncImageChrome(); reposBadges(); },{passive:true});
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

    }
  });

  // Re-apply device defaults when crossing a breakpoint (portrait ↔ landscape)
  let lastDev=deviceClass();
  window.addEventListener('resize', ()=>{
    const d=deviceClass();
    if(d!==lastDev){
      lastDev=d;
      setTimeout(()=>{ if(document.getElementById('imgFullscreen')?.classList.contains('show')) applyFs(); }, 100);
    }
  });
}

/* ============================================================
   TABLE FORMULAS & FINANCIAL TOOLS
   ============================================================ */

function colIndexToLabel(idx) {
  let label = '';
  while (idx >= 0) {
    label = String.fromCharCode((idx % 26) + 65) + label;
    idx = Math.floor(idx / 26) - 1;
  }
  return label;
}

function labelToColIndex(str) {
  let idx = 0;
  for (let i = 0; i < str.length; i++) {
    idx = idx * 26 + (str.charCodeAt(i) - 64);
  }
  return idx - 1;
}

function formatNumber(val, decimals = 2) {
  const num = parseFloat(val);
  if (isNaN(num)) return val;
  return new Intl.NumberFormat('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals }).format(num);
}

function formatCurrency(val, symbol = '$', decimals = 2) {
  const num = parseFloat(val);
  if (isNaN(num)) return val;
  const isNegative = num < 0;
  const absNum = Math.abs(num);
  const formatted = new Intl.NumberFormat('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals }).format(absNum);
  return isNegative ? `(${symbol}${formatted})` : `${symbol}${formatted}`;
}

// Map A1 references to cell elements
function resolveCellRange(tbl, refStr, positions) {
  const match = refStr.trim().toUpperCase().match(/^([A-Z]+)(\d+)(?::([A-Z]+)(\d+))?$/);
  if (!match) return [];
  const colStart = labelToColIndex(match[1]);
  const rowStart = parseInt(match[2], 10) - 1;
  
  let colEnd = colStart;
  let rowEnd = rowStart;
  
  if (match[3] && match[4]) {
    colEnd = labelToColIndex(match[3]);
    rowEnd = parseInt(match[4], 10) - 1;
  }
  
  const minRow = Math.min(rowStart, rowEnd);
  const maxRow = Math.max(rowStart, rowEnd);
  const minCol = Math.min(colStart, colEnd);
  const maxCol = Math.max(colStart, colEnd);
  
  const cells = [];
  positions.forEach((pos, cell) => {
    if (pos.rowStart >= minRow && pos.rowStart <= maxRow && pos.colStart >= minCol && pos.colStart <= maxCol) {
      cells.push(cell);
    }
  });
  return cells;
}

function getCellValue(cell) {
  let txt = cell.textContent.replace(/[^0-9.\-()]/g, '');
  if (cell.textContent.includes('(') && cell.textContent.includes(')')) {
    txt = '-' + txt.replace(/[()]/g, '');
  }
  const val = parseFloat(txt);
  return isNaN(val) ? 0 : val;
}

function evaluateCellFormula(tbl, formulaStr, positions) {
  const expr = formulaStr.substring(1).toUpperCase().trim();
  
  // Custom functions
  const sumMatch = expr.match(/^SUM\(([^)]+)\)$/);
  if (sumMatch) {
    const refs = sumMatch[1].split(',');
    let total = 0;
    refs.forEach(r => resolveCellRange(tbl, r, positions).forEach(c => total += getCellValue(c)));
    return total;
  }
  
  const avgMatch = expr.match(/^(?:AVERAGE|AVG)\(([^)]+)\)$/);
  if (avgMatch) {
    const refs = avgMatch[1].split(',');
    let total = 0, count = 0;
    refs.forEach(r => resolveCellRange(tbl, r, positions).forEach(c => { total += getCellValue(c); count++; }));
    return count > 0 ? total / count : 0;
  }

  const countMatch = expr.match(/^COUNT\(([^)]+)\)$/);
  if (countMatch) {
    const refs = countMatch[1].split(',');
    let count = 0;
    refs.forEach(r => resolveCellRange(tbl, r, positions).forEach(c => { if (!isNaN(parseFloat(c.textContent.replace(/[^0-9.\-()]/g, '')))) count++; }));
    return count;
  }

  const minMatch = expr.match(/^MIN\(([^)]+)\)$/);
  if (minMatch) {
    let min = Infinity;
    minMatch[1].split(',').forEach(r => resolveCellRange(tbl, r, positions).forEach(c => min = Math.min(min, getCellValue(c))));
    return min === Infinity ? 0 : min;
  }

  const maxMatch = expr.match(/^MAX\(([^)]+)\)$/);
  if (maxMatch) {
    let max = -Infinity;
    maxMatch[1].split(',').forEach(r => resolveCellRange(tbl, r, positions).forEach(c => max = Math.max(max, getCellValue(c))));
    return max === -Infinity ? 0 : max;
  }

  const ifMatch = expr.match(/^IF\(([^,]+),([^,]+),(.*)\)$/);
  if (ifMatch) {
    let cond = ifMatch[1].replace(/[A-Z]+\d+/g, match => {
      const cells = resolveCellRange(tbl, match, positions);
      return cells.length > 0 ? getCellValue(cells[0]) : 0;
    });
    let tVal = ifMatch[2].replace(/^["'](.*)["']$/, '$1').trim();
    let fVal = ifMatch[3].replace(/^["'](.*)["']$/, '$1').trim();
    try {
      if (new Function(`return ${cond}`)()) return tVal;
      return fVal;
    } catch(e) { return '#ERROR!'; }
  }

  const roundMatch = expr.match(/^ROUND\(([^,]+),(\d+)\)$/);
  if(roundMatch){
    let valExpr = roundMatch[1].replace(/[A-Z]+\d+/g, match => {
      const cells = resolveCellRange(tbl, match, positions);
      return cells.length > 0 ? getCellValue(cells[0]) : 0;
    });
    try {
       let val = new Function(`return ${valExpr}`)();
       let dec = parseInt(roundMatch[2]);
       return Number(Math.round(val+'e'+dec)+'e-'+dec);
    }catch(e) { return '#ERROR!'; }
  }

  // Basic Arithmetic
  try {
    let replacedExpr = expr.replace(/[A-Z]+\d+/g, match => {
      const cells = resolveCellRange(tbl, match, positions);
      return cells.length > 0 ? getCellValue(cells[0]) : 0;
    });
    if (/^[0-9+\-*/(). ]+$/.test(replacedExpr)) {
      return new Function(`return ${replacedExpr}`)();
    }
  } catch (e) {
    return '#ERROR!';
  }
  
  return '#ERROR!';
}

function recalculateTableFormulas(tbl) {
  if (!tbl) return;
  const positions = tableCellLayout(tbl);
  const formulaCells = Array.from(tbl.querySelectorAll('[data-formula]'));
  
  for(let pass=0; pass<3; pass++) {
    formulaCells.forEach(cell => {
      if (cell === document.activeElement) return;
      const formula = cell.getAttribute('data-formula');
      if (formula && formula.startsWith('=')) {
        const result = evaluateCellFormula(tbl, formula, positions);
        const format = cell.getAttribute('data-format');
        const symbol = cell.getAttribute('data-currency') || '$';
        
        let output = result;
        if (typeof result === 'number') {
          if (format === 'currency') output = formatCurrency(result, symbol);
          else if (format === 'percent') output = formatNumber(result * 100) + '%';
          else output = formatNumber(result);
        }
        
        cell.innerHTML = output;
      }
    });
  }
}

const originalHandleBodyInput = window.handleBodyInput;
window.handleBodyInput = function(e) {
  if(originalHandleBodyInput) originalHandleBodyInput(e);
  document.querySelectorAll('.editor-content table').forEach(tbl => {
    recalculateTableFormulas(tbl);
  });
};

document.addEventListener('focusin', e => {
  const cell = e.target.closest('td,th');
  if (cell && cell.getAttribute('data-formula')) {
    cell.textContent = cell.getAttribute('data-formula');
  }
});
document.addEventListener('focusout', e => {
  const cell = e.target.closest('td,th');
  if (cell && cell.isContentEditable) {
    const text = cell.textContent.trim();
    if (text.startsWith('=')) {
      cell.setAttribute('data-formula', text);
      recalculateTableFormulas(cell.closest('table'));
    } else if (cell.hasAttribute('data-formula')) {
      cell.removeAttribute('data-formula');
    }
  }
});

function tblInsertFormula(formulaTpl) {
  if (!activeCell) return;
  activeCell.setAttribute('data-formula', formulaTpl);
  activeCell.textContent = formulaTpl;
  activeCell.focus();
}

function setCellFormat(format, symbol='$') {
  onSelected(c => {
    c.setAttribute('data-format', format);
    if(format === 'currency') c.setAttribute('data-currency', symbol);
    else c.removeAttribute('data-currency');
  });
  const tbl = currentTable();
  if(tbl) recalculateTableFormulas(tbl);
}

function insertFinancialTemplate(type) {
  const ed = bodyEl();
  if(!ed) return;
  let html = '';
  if (type === 'expense') {
    html = `<div class="table-wrapper" contenteditable="false"><table contenteditable="true">
      <tbody>
        <tr><th>Date</th><th>Category</th><th>Description</th><th>Amount</th></tr>
        <tr><td></td><td></td><td></td><td data-format="currency" data-currency="$">0</td></tr>
        <tr><td></td><td></td><td></td><td data-format="currency" data-currency="$">0</td></tr>
        <tr style="border-top:2px solid currentColor; border-bottom:3px double currentColor; font-weight:bold;">
          <td colspan="3">TOTAL</td><td data-format="currency" data-currency="$" data-formula="=SUM(D2:D3)">$0.00</td>
        </tr>
      </tbody>
    </table></div><p><br></p>`;
  } else if (type === 'budget') {
    html = `<div class="table-wrapper" contenteditable="false"><table contenteditable="true">
      <tbody>
        <tr><th>Item</th><th>Qty</th><th>Unit Cost</th><th>Total Cost</th></tr>
        <tr><td></td><td>1</td><td data-format="currency" data-currency="$">0</td><td data-format="currency" data-currency="$" data-formula="=B2*C2">$0.00</td></tr>
        <tr><td></td><td>1</td><td data-format="currency" data-currency="$">0</td><td data-format="currency" data-currency="$" data-formula="=B3*C3">$0.00</td></tr>
        <tr style="border-top:2px solid currentColor; border-bottom:3px double currentColor; font-weight:bold;">
          <td colspan="3">TOTAL</td><td data-format="currency" data-currency="$" data-formula="=SUM(D2:D3)">$0.00</td>
        </tr>
      </tbody>
    </table></div><p><br></p>`;
  } else if (type === 'variance') {
     html = `<div class="table-wrapper" contenteditable="false"><table contenteditable="true">
      <tbody>
        <tr><th>Category</th><th>Budgeted</th><th>Actual</th><th>Variance</th></tr>
        <tr><td></td><td data-format="currency" data-currency="$">0</td><td data-format="currency" data-currency="$">0</td><td data-format="currency" data-currency="$" data-formula="=C2-B2">$0.00</td></tr>
        <tr style="border-top:2px solid currentColor; border-bottom:3px double currentColor; font-weight:bold;">
          <td>TOTAL</td><td data-format="currency" data-currency="$" data-formula="=SUM(B2:B2)">$0.00</td><td data-format="currency" data-currency="$" data-formula="=SUM(C2:C2)">$0.00</td><td data-format="currency" data-currency="$" data-formula="=C3-B3">$0.00</td>
        </tr>
      </tbody>
    </table></div><p><br></p>`;
  }
  document.execCommand('insertHTML', false, html);
  normalizeEditorTables();
  handleBodyInput();
}
