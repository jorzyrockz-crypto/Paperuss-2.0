window.isFormulaModalActive = function() {
  return window.formulaMode && (window.formulaMode.phase === 'inspect' || window.formulaMode.phase === 'edit');
};

/* ============================================================
   TABLE TOOLS
   Contextual toolbar, range selection, resizing, and block movement.
   ============================================================ */
let activeCell=null;
let selectedCells=new Set();  // multi-cell selection
let selAnchor=null;            // shift-click / drag anchor
let tableEditCell=null;        // CalcuLeafs Edit Mode target; null means Cell Select Mode
let tableRangeFormattingInProgress=false;

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

function tableLogicalSize(tbl, positions=tableCellLayout(tbl)){
  let cols=0;
  positions.forEach(pos=>{ cols=Math.max(cols,pos.colEnd+1); });
  return {rows:Array.from(tbl?.rows||[]).length,cols};
}

function cellAtLogicalPosition(tbl,rowIndex,colIndex,positions=tableCellLayout(tbl)){
  for(const [cell,pos] of positions.entries()){
    if(rowIndex>=pos.rowStart&&rowIndex<=pos.rowEnd&&colIndex>=pos.colStart&&colIndex<=pos.colEnd) return cell;
  }
  return null;
}

function focusCalcuLeafSelection(){
  const ed=bodyEl();
  if(!ed) return;
  try{ ed.focus({preventScroll:true}); }catch(_){ ed.focus(); }
  const sel=window.getSelection();
  if(sel) sel.removeAllRanges();
}

function exitCalcuLeafEditMode(focusEditor=true){
  if(tableEditCell){
    const tbl=tableEditCell.closest('table');
    tableEditCell.classList.remove('tbl-editing');
    tableEditCell.removeAttribute('contenteditable');
    tableEditCell.removeAttribute('tabindex');
    tbl?.classList.remove('calculeaf-edit-mode');
    
    // AGENDA 5A: Parse cell content and attach metadata
    if (!tableEditCell.hasAttribute('data-formula-tokens')) {
        // Clear stale metadata
        tableEditCell.removeAttribute('data-value-type');
        tableEditCell.removeAttribute('data-value');
        tableEditCell.removeAttribute('data-currency');
        
        const text = tableEditCell.textContent.trim();
        if (text.length > 0) {
            const meta = parseCalcuLeafValue(tableEditCell.innerHTML);
            if (meta.type !== 'text') {
                tableEditCell.setAttribute('data-value-type', meta.type);
                tableEditCell.setAttribute('data-value', meta.value);
                if (meta.currency) tableEditCell.setAttribute('data-currency', meta.currency);
            }
        }
    }
    
    tableEditCell=null;
  }
  if(focusEditor) focusCalcuLeafSelection();
  highlightSelected();
}

function placeCaretInCell(cell,clientX=null,clientY=null){
  const sel=window.getSelection();
  if(!sel||!cell) return;
  let range=null;
  if(Number.isFinite(clientX)&&Number.isFinite(clientY)){
    if(document.caretPositionFromPoint){
      const pos=document.caretPositionFromPoint(clientX,clientY);
      if(pos&&cell.contains(pos.offsetNode)){
        range=document.createRange();
        range.setStart(pos.offsetNode,pos.offset);
        range.collapse(true);
      }
    }else if(document.caretRangeFromPoint){
      const candidate=document.caretRangeFromPoint(clientX,clientY);
      if(candidate&&cell.contains(candidate.startContainer)) range=candidate;
    }
  }
  if(!range){
    range=document.createRange();
    range.selectNodeContents(cell);
    range.collapse(false);
  }
  sel.removeAllRanges();
  sel.addRange(range);
}

function enterCalcuLeafEditMode(cell,clientX=null,clientY=null){
  if(!cell) return;
  if(tableEditCell&&tableEditCell!==cell) exitCalcuLeafEditMode(false);
  activeCell=cell;
  if(!selectedCells.has(cell)||selectedCells.size!==1){
    clearCellSelection();
    selectedCells=new Set([cell]);
    selAnchor=cell;
  }
  tableEditCell=cell;
  cell.classList.add('tbl-editing');
  // Make the chosen cell an explicit temporary editing host.
  // This is more reliable than asking the nested table to own
  // a caret inside a TD/TH.
  cell.setAttribute('contenteditable','true');
  cell.setAttribute('tabindex','-1');
  const tbl=cell.closest('table');
  tbl?.classList.add('calculeaf-edit-mode');
  highlightSelected();

  try{ cell.focus({preventScroll:true}); }catch(_){ cell.focus(); }
  // Chromium can normalize the selection during focus.
  // Re-apply the caret after focus settles.
  requestAnimationFrame(()=>{
    if(tableEditCell!==cell||!cell.isConnected) return;
    try{ cell.focus({preventScroll:true}); }catch(_){ cell.focus(); }
    placeCaretInCell(cell,clientX,clientY);
  });
  placeCaretInCell(cell,clientX,clientY);
  positionTableTools();
}

function selectCalcuLeafCell(cell,focusEditor=true){
  if(!cell) return;
  exitCalcuLeafEditMode(false);
  clearCellSelection();
  activeCell=cell;
  selAnchor=cell;
  selectedCells=new Set([cell]);
  highlightSelected();
  if(focusEditor) focusCalcuLeafSelection();
  positionTableTools();
}

function adjacentTableCell(tbl,cell,key){
  if(!tbl||!cell) return null;
  const positions=tableCellLayout(tbl);
  const pos=positions.get(cell);
  if(!pos) return null;
  let row=pos.rowStart;
  let col=pos.colStart;
  if(key==='ArrowUp') row=pos.rowStart-1;
  else if(key==='ArrowDown') row=pos.rowEnd+1;
  else if(key==='ArrowLeft') col=pos.colStart-1;
  else if(key==='ArrowRight') col=pos.colEnd+1;
  if(row<0||col<0) return null;
  const size=tableLogicalSize(tbl,positions);
  if(row>=size.rows||col>=size.cols) return null;
  return cellAtLogicalPosition(tbl,row,col,positions);
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
  const ed=bodyEl();
  if(!ed) return;
  ed.querySelectorAll('table').forEach(tbl=>{
    const isCurrent=activeCell?.closest('table')===tbl;
    tbl.classList.toggle('calculeaf-select-mode',isCurrent&&!tableEditCell);
    tbl.classList.toggle('calculeaf-edit-mode',isCurrent&&!!tableEditCell);
    tableCells(tbl).forEach(c=>{
      c.classList.toggle('tbl-selected',isCurrent&&selectedCells.has(c));
      c.classList.toggle('tbl-active',isCurrent&&c===activeCell);
      c.classList.toggle('tbl-editing',c===tableEditCell);
    });
  });
}

function clearCellSelection(){
  selectedCells.forEach(c=>c.classList.remove('tbl-selected','tbl-active'));
  selectedCells=new Set();
  selAnchor=null;
  bodyEl()?.querySelectorAll('table.table-selection-mode').forEach(tbl=>tbl.classList.remove('table-selection-mode'));
  bodyEl()?.querySelectorAll('.calculeaf-delete-preview,.calculeaf-insert-left,.calculeaf-insert-right,.calculeaf-insert-top,.calculeaf-insert-bottom')
    .forEach(el=>el.classList.remove('calculeaf-delete-preview','calculeaf-insert-left','calculeaf-insert-right','calculeaf-insert-top','calculeaf-insert-bottom'));
}

/* Apply a fn to every selected cell (falls back to activeCell) */
function onSelected(fn){ if(selectedCells.size>0) selectedCells.forEach(fn); else if(activeCell) fn(activeCell); }

function currentTable(){ return activeCell ? activeCell.closest('table') : null; }

function applyFormattingToSelectedTableCells(cmd,val){
  if(tableRangeFormattingInProgress||tableEditCell||!activeCell||selectedCells.size===0) return false;
  const supported=new Set([
    'bold','italic','underline','strikeThrough','removeFormat','fontSize','hilite','textColor',
    'align','formatBlock','code','insertUnorderedList','insertOrderedList','task','indent','outdent'
  ]);
  if(!supported.has(cmd)) return false;

  const cells=[...selectedCells].filter(c=>c?.isConnected&&c.closest('table')===currentTable());
  if(!cells.length) return false;
  if(window.HistoryManager) window.HistoryManager.capture(true);

  if(cmd==='align'){
    const align=val==='full'?'justify':(val||'left');
    cells.forEach(c=>{ c.style.textAlign=align; });
    handleBodyInput();
    if(typeof updateToolbarState==='function') updateToolbarState();
    if(window.HistoryManager) window.HistoryManager.capture(true);
    return true;
  }

  const sel=window.getSelection();
  const preservedActive=activeCell;
  const preservedAnchor=selAnchor;
  tableRangeFormattingInProgress=true;
  window.__tableRangeFormattingInProgress=true;
  try{
    cells.forEach(cell=>{
      // Each CalcuLeaf table is its own nested contenteditable host. Focus it
      // so execCommand-based Paperuss formatting applies to the logical cell
      // selection rather than the surrounding note editor.
      const tbl=cell.closest('table');
      try{ tbl?.focus({preventScroll:true}); }catch(_){ tbl?.focus(); }
      const range=document.createRange();
      range.selectNodeContents(cell);
      sel.removeAllRanges();
      sel.addRange(range);
      applyCommand(cmd,val);
    });
  }finally{
    tableRangeFormattingInProgress=false;
    window.__tableRangeFormattingInProgress=false;
    sel.removeAllRanges();
    activeCell=preservedActive;
    selAnchor=preservedAnchor;
    highlightSelected();
    focusCalcuLeafSelection();
    handleBodyInput();
    if(typeof updateToolbarState==='function') updateToolbarState();
    if(window.HistoryManager) window.HistoryManager.capture(true);
  }
  return true;
}
window.applyFormattingToSelectedTableCells=applyFormattingToSelectedTableCells;
window.isCalcuLeafCellEditing=()=>!!tableEditCell;

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
  if (window.isFormulaModalActive && window.isFormulaModalActive()) {
    const tools=document.getElementById('tblTools');
    if(tools) tools.classList.remove('show');
    document.getElementById('tblColorDropdown')?.classList.remove('show');
    return;
  }
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
  
  // Calculate dimensions
  const badge = document.getElementById('tblDimBadge');
  if (badge) {
    const rows = tbl.rows.length;
    let cols = 0;
    if (rows > 0) {
      cols = Array.from(tbl.rows[0].cells).reduce((acc, cell) => acc + (cell.colSpan || 1), 0);
    }
    badge.textContent = `${rows}×${cols}`;
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


function setCellBorders(type) {
    if(tableRangeFormattingInProgress||tableEditCell||!activeCell||selectedCells.size===0) return;
    const cells=[...selectedCells].filter(c=>c?.isConnected&&c.closest('table')===currentTable());
    if(!cells.length) return;
    if(window.HistoryManager) window.HistoryManager.capture(true);
    
    cells.forEach(c => {
       if (type === 'none') {
           c.style.border = 'none';
           c.style.borderTop = c.style.borderBottom = c.style.borderLeft = c.style.borderRight = '';
       } else if (type === 'all' || type === 'outline') {
           c.style.border = '1px solid var(--border)';
       } else if (type === 'top') {
           c.style.borderTop = '1px solid var(--border)';
       } else if (type === 'bottom') {
           c.style.borderBottom = '1px solid var(--border)';
       } else if (type === 'left') {
           c.style.borderLeft = '1px solid var(--border)';
       } else if (type === 'right') {
           c.style.borderRight = '1px solid var(--border)';
       }
    });
    handleBodyInput();
    if(window.HistoryManager) window.HistoryManager.capture(true);
}

async function tblCopy() {
    if(selectedCells.size===0 && !activeCell) return;
    const cells = selectedCells.size > 0 ? [...selectedCells] : [activeCell];
    const html = cells.map(c => c.outerHTML).join('');
    const text = cells.map(c => c.textContent).join('\t');
    try {
        await navigator.clipboard.write([
            new ClipboardItem({
                'text/html': new Blob([html], {type: 'text/html'}),
                'text/plain': new Blob([text], {type: 'text/plain'})
            })
        ]);
        toast('Copied to clipboard');
    } catch (e) {
        try {
            await navigator.clipboard.writeText(text);
            toast('Copied text to clipboard');
        } catch(e2) {
            console.error(e2);
            toast('Failed to copy to clipboard');
        }
    }
}

async function tblCut() {
    await tblCopy();
    onSelected(c => { c.innerHTML = ''; c.removeAttribute('data-formula'); });
    handleBodyInput();
}

async function tblPaste() {
    if (!activeCell) return;
    try {
        const items = await navigator.clipboard.read();
        for (let item of items) {
            if (item.types.includes('text/html')) {
                const blob = await item.getType('text/html');
                const html = await blob.text();
                enterCalcuLeafEditMode(activeCell);
                document.execCommand('insertHTML', false, html);
                exitCalcuLeafEditMode(false);
                handleBodyInput();
                return;
            }
        }
        const text = await navigator.clipboard.readText();
        enterCalcuLeafEditMode(activeCell);
        document.execCommand('insertText', false, text);
        exitCalcuLeafEditMode(false);
        handleBodyInput();
    } catch (e) {
        console.error(e);
        toast('Paste failed. Check clipboard permissions.');
    }
}

async function tblPasteVal() {
    if (!activeCell) return;
    try {
        const text = await navigator.clipboard.readText();
        enterCalcuLeafEditMode(activeCell);
        document.execCommand('insertText', false, text);
        exitCalcuLeafEditMode(false);
        handleBodyInput();
    } catch(e) {
        console.error(e);
        toast('Paste failed. Check clipboard permissions.');
    }
}


let formatPainterState = null;
function startFormatPainter() {
    if (!activeCell) return;
    formatPainterState = {
        style: activeCell.getAttribute('style') || '',
        className: activeCell.className.replace(/tbl-active|tbl-selected/g, '').trim(),
        valueType: activeCell.getAttribute('data-value-type'),
        currency: activeCell.getAttribute('data-currency')
    };
    document.body.style.cursor = 'crosshair';
    toast('Format Painter active. Click a cell to apply.');
}

function applyFormatPainter(cell) {
    if (!formatPainterState || !cell) return;
    cell.setAttribute('style', formatPainterState.style);
    const classes = formatPainterState.className.split(' ').filter(c => c);
    const existing = cell.className.split(' ').filter(c => c === 'tbl-active' || c === 'tbl-selected');
    cell.className = [...classes, ...existing].join(' ');
    
    if (formatPainterState.valueType) cell.setAttribute('data-value-type', formatPainterState.valueType);
    else cell.removeAttribute('data-value-type');
    
    if (formatPainterState.currency) cell.setAttribute('data-currency', formatPainterState.currency);
    else cell.removeAttribute('data-currency');
    
    formatPainterState = null;
    document.body.style.cursor = '';
    handleBodyInput();
}


function setCellFormat(type, detail=null) {
    onSelected(cell => {
        let md = parseCalcuLeafValue(cell.innerHTML);
        if (type === 'number') {
            cell.setAttribute('data-value-type', 'number');
            cell.removeAttribute('data-currency');
            cell.removeAttribute('data-date-format');
            md.type = 'number';
        } else if (type === 'currency') {
            cell.setAttribute('data-value-type', 'currency');
            const currencyMap = {'$':'USD', '€':'EUR', '£':'GBP', '¥':'JPY', '₱':'PHP'};
            cell.setAttribute('data-currency', currencyMap[detail] || 'USD');
            md.type = 'currency';
            md.currency = currencyMap[detail] || 'USD';
        } else if (type === 'percentage') {
            cell.setAttribute('data-value-type', 'percentage');
            cell.removeAttribute('data-currency');
            cell.removeAttribute('data-date-format');
            md.type = 'percentage';
        } else if (type === 'date') {
            cell.setAttribute('data-value-type', 'date');
            cell.setAttribute('data-date-format', detail);
            md.type = 'date';
        }
        cell.innerHTML = formatCalcuLeafValue(md) || cell.innerHTML;
    });
    handleBodyInput();
}

function adjustDecimals(delta) {
    onSelected(cell => {
        let dec = parseInt(cell.getAttribute('data-decimals') || '2', 10);
        dec = Math.max(0, dec + delta);
        cell.setAttribute('data-decimals', dec);
        
        let md = parseCalcuLeafValue(cell.innerHTML);
        if (md.type === 'number' || md.type === 'currency') {
            let num = parseFloat(md.value);
            if (!isNaN(num)) {
                let formatted = num.toFixed(dec);
                if (md.type === 'currency') {
                    const rmap = { 'PHP': '₱', 'USD': '$', 'EUR': '€', 'GBP': '£', 'JPY': '¥' };
                    const sym = rmap[cell.getAttribute('data-currency')] || '$';
                    formatted = sym + formatted;
                }
                cell.innerHTML = formatted;
            }
        } else if (md.type === 'percentage') {
            let num = parseFloat(md.value);
            if (!isNaN(num)) {
                cell.innerHTML = (num * 100).toFixed(dec) + '%';
            }
        }
    });
    handleBodyInput();
}


function tblSort(direction, scope) {
    if(!activeCell) return;
    const tbl = currentTable();
    if(!tbl || !tbl.tBodies || !tbl.tBodies[0]) return;
    
    const tbody = tbl.tBodies[0];
    const positions = tableCellLayout(tbl);
    const activePos = positions.get(activeCell);
    if(!activePos) return;
    const sortCol = activePos.colStart;
    

    if(window.HistoryManager) window.HistoryManager.capture(true);
    let rowsToSort = [];

    let startIdx = -1;
    let endIdx = -1;

    if (scope === 'sheet') {
        rowsToSort = Array.from(tbody.querySelectorAll('tr'));
        startIdx = 0;
        endIdx = rowsToSort.length - 1;
    } else {
        const selectedRows = new Set();
        if (selectedCells.size > 0) {
            selectedCells.forEach(c => {
                const tr = c.closest('tr');
                if (tr && tr.closest('tbody') === tbody) selectedRows.add(tr);
            });
        } else {
            const tr = activeCell.closest('tr');
            if (tr && tr.closest('tbody') === tbody) selectedRows.add(tr);
        }
        if (selectedRows.size <= 1) return;
        
        const allRows = Array.from(tbody.querySelectorAll('tr'));
        const indices = [...selectedRows].map(r => allRows.indexOf(r)).filter(i => i >= 0).sort((a,b)=>a-b);
        startIdx = indices[0];
        endIdx = indices[indices.length - 1];
        
        for(let i = startIdx; i <= endIdx; i++) {
            rowsToSort.push(allRows[i]);
        }
    }

    if (rowsToSort.length <= 1) return;

    rowsToSort.sort((a, b) => {
        const aCell = Array.from(a.children).find(c => positions.get(c)?.colStart === sortCol);
        const bCell = Array.from(b.children).find(c => positions.get(c)?.colStart === sortCol);
        
        const numA = aCell ? getCalcuLeafNumericValue(aCell) : null;
        const numB = bCell ? getCalcuLeafNumericValue(bCell) : null;
        
        if (numA !== null && numB !== null) return (numA - numB) * direction;
        
        const aText = aCell ? aCell.textContent.trim() : '';
        const bText = bCell ? bCell.textContent.trim() : '';
        
        return aText.localeCompare(bText) * direction;
    });

    const insertBeforeElement = tbody.children[endIdx + 1] || null;
    rowsToSort.forEach(r => tbody.insertBefore(r, insertBeforeElement));
    
    handleBodyInput();
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

function tblInsertRowAt(insertionIndex,referenceCell=activeCell,colHint=null){
  const tbl=referenceCell?.closest('table'); if(!tbl) return;
  const positions=tableCellLayout(tbl);
  const size=tableLogicalSize(tbl,positions);
  insertionIndex=Math.max(0,Math.min(insertionIndex,size.rows));
  const refPos=positions.get(referenceCell);
  if(colHint==null) colHint=refPos?.colStart||0;
  const coveredCols=new Set();

  positions.forEach((pos,cell)=>{
    if(pos.rowStart<insertionIndex&&pos.rowEnd>=insertionIndex){
      cell.rowSpan=Math.max(1,Number(cell.rowSpan)||1)+1;
      for(let c=pos.colStart;c<=pos.colEnd;c++) coveredCols.add(c);
    }
  });

  const tr=document.createElement('tr');
  const beforeRow=tbl.rows[insertionIndex]||null;
  const referenceRow=referenceCell.parentElement;
  const section=beforeRow?.parentElement||referenceRow?.parentElement||tbl.tBodies?.[0]||tbl;
  const useHeader=section?.tagName==='THEAD';
  for(let c=0;c<size.cols;c++){
    if(coveredCols.has(c)) continue;
    const cell=document.createElement(useHeader?'th':'td');
    cell.innerHTML='&nbsp;';
    tr.appendChild(cell);
  }
  if(beforeRow&&beforeRow.parentElement===section) section.insertBefore(tr,beforeRow);
  else section.appendChild(tr);

  const nextPositions=tableCellLayout(tbl);
  const target=cellAtLogicalPosition(tbl,insertionIndex,Math.min(colHint,Math.max(0,size.cols-1)),nextPositions)||referenceCell;
  selectCalcuLeafCell(target,false);
  handleBodyInput(); positionTableTools();
}

function tblInsertRow(where){
  if(!activeCell) return;
  const tbl=currentTable(); if(!tbl) return;
  const positions=tableCellLayout(tbl);
  const pos=positions.get(activeCell); if(!pos) return;
  const insertionIndex=where==='above'?pos.rowStart:pos.rowEnd+1;
  tblInsertRowAt(insertionIndex,activeCell,pos.colStart);
}

function tblDeleteRowAt(rowIndex,colHint=0,tbl=currentTable()){
  if(!tbl) return;
  if(tbl.rows.length<=1){ toast('Cannot delete last row'); return; }
  const positions=tableCellLayout(tbl);
  const row=tbl.rows[rowIndex]; if(!row) return;
  const nextRow=tbl.rows[rowIndex+1]||null;

  const moving=[];
  positions.forEach((pos,cell)=>{
    if(pos.rowStart===rowIndex&&pos.rowEnd>rowIndex) moving.push({cell,pos});
    else if(pos.rowStart<rowIndex&&pos.rowEnd>=rowIndex){
      cell.rowSpan=Math.max(1,(Number(cell.rowSpan)||1)-1);
    }
  });
  moving.sort((a,b)=>a.pos.colStart-b.pos.colStart).forEach(({cell,pos})=>{
    cell.rowSpan=Math.max(1,(Number(cell.rowSpan)||1)-1);
    if(nextRow){
      const before=Array.from(nextRow.cells).find(c=>(positions.get(c)?.colStart??Infinity)>pos.colStart)||null;
      nextRow.insertBefore(cell,before);
    }
  });
  row.remove();

  const nextPositions=tableCellLayout(tbl);
  const size=tableLogicalSize(tbl,nextPositions);
  const targetRow=Math.max(0,Math.min(rowIndex,size.rows-1));
  const targetCol=Math.max(0,Math.min(colHint,size.cols-1));
  const target=cellAtLogicalPosition(tbl,targetRow,targetCol,nextPositions)||tableCells(tbl)[0]||null;
  if(target) selectCalcuLeafCell(target,false);
  else { clearCellSelection(); activeCell=null; }
  handleBodyInput(); positionTableTools();
}

function tblDeleteRow(){
  if(!activeCell) return;
  const tbl=currentTable(); if(!tbl) return;
  const positions=tableCellLayout(tbl);
  const pos=positions.get(activeCell); if(!pos) return;
  tblDeleteRowAt(pos.rowStart,pos.colStart,tbl);
}

function tblInsertColAt(insertionIndex,referenceCell=activeCell,rowHint=null){
  const tbl=referenceCell?.closest('table'); if(!tbl) return;
  const positions=tableCellLayout(tbl);
  const size=tableLogicalSize(tbl,positions);
  insertionIndex=Math.max(0,Math.min(insertionIndex,size.cols));
  const refPos=positions.get(referenceCell);
  if(rowHint==null) rowHint=refPos?.rowStart||0;
  const coveredRows=new Set();

  positions.forEach((pos,cell)=>{
    if(pos.colStart<insertionIndex&&pos.colEnd>=insertionIndex){
      cell.colSpan=Math.max(1,Number(cell.colSpan)||1)+1;
      for(let r=pos.rowStart;r<=pos.rowEnd;r++) coveredRows.add(r);
    }
  });

  Array.from(tbl.rows).forEach((row,rowIndex)=>{
    if(coveredRows.has(rowIndex)) return;
    const useHeader=row.parentElement?.tagName==='THEAD'||(row.cells.length>0&&Array.from(row.cells).every(c=>c.tagName==='TH'));
    const cell=document.createElement(useHeader?'th':'td');
    cell.innerHTML='&nbsp;';
    const before=Array.from(row.cells).find(c=>(positions.get(c)?.colStart??Infinity)>=insertionIndex)||null;
    row.insertBefore(cell,before);
  });

  const nextPositions=tableCellLayout(tbl);
  const target=cellAtLogicalPosition(tbl,Math.min(rowHint,Math.max(0,size.rows-1)),insertionIndex,nextPositions)||referenceCell;
  selectCalcuLeafCell(target,false);
  handleBodyInput(); positionTableTools();
}

function tblInsertCol(where){
  if(!activeCell) return;
  const tbl=currentTable(); if(!tbl) return;
  const positions=tableCellLayout(tbl);
  const pos=positions.get(activeCell); if(!pos) return;
  const insertionIndex=where==='left'?pos.colStart:pos.colEnd+1;
  tblInsertColAt(insertionIndex,activeCell,pos.rowStart);
}

function tblDeleteColAt(colIndex,rowHint=0,tbl=currentTable()){
  if(!tbl) return;
  const positions=tableCellLayout(tbl);
  const size=tableLogicalSize(tbl,positions);
  if(size.cols<=1){ toast('Cannot delete last column'); return; }
  positions.forEach((pos,cell)=>{
    if(pos.colStart<=colIndex&&pos.colEnd>=colIndex){
      const span=Math.max(1,Number(cell.colSpan)||1);
      if(span>1) cell.colSpan=span-1;
      else cell.remove();
    }
  });
  const nextPositions=tableCellLayout(tbl);
  const nextSize=tableLogicalSize(tbl,nextPositions);
  const targetRow=Math.max(0,Math.min(rowHint,nextSize.rows-1));
  const targetCol=Math.max(0,Math.min(colIndex,nextSize.cols-1));
  const target=cellAtLogicalPosition(tbl,targetRow,targetCol,nextPositions)||tableCells(tbl)[0]||null;
  if(target) selectCalcuLeafCell(target,false);
  else { clearCellSelection(); activeCell=null; }
  handleBodyInput(); positionTableTools();
}

function tblDeleteCol(){
  if(!activeCell) return;
  const tbl=currentTable(); if(!tbl) return;
  const positions=tableCellLayout(tbl);
  const pos=positions.get(activeCell); if(!pos) return;
  tblDeleteColAt(pos.colStart,pos.rowStart,tbl);
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
    exitCalcuLeafEditMode(false);
    clearCellSelection();
    if(wrap) wrap.remove(); else tbl.remove();
    activeCell=null;
    highlightSelected();
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
const tblMenuIds=['tblMenuMerge','tblMenuLayout','tblMenuThemes'];
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


function findPrimaryFormulaSourceIndex(tokens) {
  const presetFuncs = ['SUM', 'AVERAGE', 'COUNT', 'MIN', 'MAX', 'PRODUCT'];
  let depth = 0;
  let inTargetFunc = false;
  let targetFuncDepth = -1;
  
  for (let i = 0; i < tokens.length; i++) {
    const tok = tokens[i];
    if (tok.type === 'function' && presetFuncs.includes(tok.value.toUpperCase())) {
       inTargetFunc = true;
    } else if (tok.type === 'operator' && tok.value === '(') {
       depth++;
       if (inTargetFunc && targetFuncDepth === -1) {
          targetFuncDepth = depth;
          inTargetFunc = false;
       }
    } else if (tok.type === 'operator' && tok.value === ')') {
       if (depth === targetFuncDepth) return -1;
       depth--;
    } else if ((tok.type === 'cell' || tok.type === 'range') && depth === targetFuncDepth) {
       return i;
    }
  }
  return -1;
}

function escapeFormulaDisplay(value) {
  if (value === null || value === undefined) return '';
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function getFormulaSourceDisplay(token, tbl) {
  if (token.type === 'cell' && token.id) {
    const c = getCellById(tbl, token.id);
    const val = c ? c.textContent.trim() : '';
    return `[${escapeFormulaDisplay(val) || 'Empty'}]`;
  } else if (token.type === 'range' && token.ids) {
    const vals = token.ids.map(id => {
      const c = getCellById(tbl, id);
      return c ? c.textContent.trim() : '';
    });
    if (vals.length <= 4) {
       return `[${escapeFormulaDisplay(vals.join(', '))}]`;
    } else {
       return `[${escapeFormulaDisplay(vals.slice(0, 3).join(', '))} &hellip; +${vals.length - 3}]`;
    }
  }
  return '';
}


window.hydrateCalcuLeafFormulas = function(root = window.bodyEl ? window.bodyEl() : document.getElementById('editor')) {
  if (!root) return;
  root.querySelectorAll('table').forEach(tbl => {
    let hasValidFormula = false;
    tbl.querySelectorAll('[data-formula-tokens]').forEach(cell => {
      try {
        const tokens = JSON.parse(cell.getAttribute('data-formula-tokens'));
        if (Array.isArray(tokens)) {
          hasValidFormula = true;
        }
      } catch (_) {
        // Leave malformed cell content untouched.
      }
    });
    if (hasValidFormula && typeof recalculateTableFormulas === 'function') {
      recalculateTableFormulas(tbl);
    }
  });
};

function ensureFormulaSourceIds(tokens, tbl) {
  tokens.forEach(token => {
    if (token.type === 'cell') {
      const cell = getCellById(tbl, token.id);
      if (cell) {
        token.id = getCellId(cell);
      }
    } else if (token.type === 'range') {
      token.ids = (token.ids || []).map(id => {
        const cell = getCellById(tbl, id);
        return cell ? getCellId(cell) : id;
      });
    }
  });
}

function initTableTools(){
  const ed=bodyEl(); if(!ed) return;
  normalizeEditorTables();

  /* Track active cell + multi-cell selection. CalcuLeafs has two explicit states:
     single click = Cell Select Mode, double click/Enter = Edit Mode. */
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
    exitCalcuLeafEditMode(false);
    clearCellSelection();
    selectedCells=cellRange(tbl,anchor,cell);
    selAnchor=anchor;
    activeCell=cell;
    highlightSelected();
    if(touchSelectionMode) tbl.classList.add('table-selection-mode');
    positionTableTools();
  }
  function selectOnly(cell,focusEditor=true){
    if(!cell) return;
    selectCalcuLeafCell(cell,focusEditor);
  }
  function toggleSelectedCell(cell){
    if(!cell) return;
    exitCalcuLeafEditMode(false);
    if(activeCell?.closest('table')!==cell.closest('table')) selectOnly(cell);
    else{
      activeCell=cell;
      selAnchor=selAnchor||cell;
      if(selectedCells.has(cell)&&selectedCells.size>1) selectedCells.delete(cell);
      else selectedCells.add(cell);
      highlightSelected();
      focusCalcuLeafSelection();
      positionTableTools();
    }
  }
  function endSelectionGesture(){
    if(longPressTimer){ clearTimeout(longPressTimer); longPressTimer=null; }
    if(selectionGesture?.dragging) document.body.style.userSelect='';
    selectionGesture=null;
  }

  /* Touch keeps the existing long-press range gesture. Desktop selection is
     intentionally mouse-based below: contenteditable tables are much more
     predictable when mousedown owns selection and prevents the native caret. */
  function openExistingFormula(cell) {
    if (!cell?.hasAttribute('data-formula-tokens')) {
      return false;
    }
    try {
      const tokens = JSON.parse(cell.getAttribute('data-formula-tokens'));
      startFormulaMode(cell, tokens, true);
      return true;
    } catch (_) {
      return false;
    }
  }

  ed.addEventListener('pointerdown', e=>{
    if(e.pointerType!=='touch'||e.button!==0) return;
    const cell=pickCell(e);
    if(!cellInEditor(cell)) return;
    if (window.formulaMode && window.formulaMode.phase === 'edit') {
       handleFormulaCellPointerDown(e, cell, 'touch');
       return;
    }

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
      selectOnly(cell,false);
      cell.closest('table')?.classList.add('table-selection-mode');
      document.body.style.userSelect='none';
      toast('Selection mode: drag or tap more cells');
      try{ ed.setPointerCapture(e.pointerId); }catch(_){}
    },420);
  });

  ed.addEventListener('pointermove', e=>{
    if (window.formulaMode && window.formulaMode.phase === 'edit') {
       handleFormulaCellPointerMove(e);
       return;
    }
    const gesture=selectionGesture;
    if(!gesture||gesture.pointerId!==e.pointerId||gesture.pointerType!=='touch') return;
    const distance=Math.hypot(e.clientX-gesture.startX,e.clientY-gesture.startY);
    if(!gesture.longPressed){
      if(distance>10) endSelectionGesture();
      return;
    }
    const cell=cellAtPoint(e.clientX,e.clientY);
    if(!cell||cell.closest('table')!==gesture.anchor.closest('table')) return;
    gesture.dragging=true;
    document.body.style.userSelect='none';
    selectRange(gesture.anchor,cell);
    e.preventDefault();
  });

  ed.addEventListener('pointerup', e=>{
    if (window.formulaMode && window.formulaMode.phase === 'edit') {
       handleFormulaCellPointerUp(e);
       return;
    }
    const gesture=selectionGesture;
    if(!gesture||gesture.pointerId!==e.pointerId||gesture.pointerType!=='touch') return;
    if(!gesture.longPressed){
      if(longPressTimer){ clearTimeout(longPressTimer); longPressTimer=null; }
      const cell=cellAtPoint(e.clientX,e.clientY)||gesture.anchor;
      if(touchSelectionMode&&cell?.closest('table')===activeCell?.closest('table')){
        toggleSelectedCell(cell);
        cell.closest('table')?.classList.add('table-selection-mode');
        e.preventDefault();
      }else{
        touchSelectionMode=false;
        selectOnly(cell,false);
        
        if (cell?.hasAttribute('data-formula-tokens')) {
          document.getElementById('tblTools')?.classList.remove('show');
          document.getElementById('tblColorDropdown')?.classList.remove('show');
          openExistingFormula(cell);
        }
      }
    }
    endSelectionGesture();
  });
  ed.addEventListener('pointercancel', endSelectionGesture);
  ed.addEventListener('contextmenu',e=>{
    if(e.target.closest?.('table.table-selection-mode')) e.preventDefault();
  });

  /* Desktop CalcuLeaf selection. Single mousedown selects a cell while keeping
     the native caret out; dragging extends a rectangular logical range. */
  let mouseSelectionGesture=null;
  ed.addEventListener('mousedown',e=>{
    if(e.button!==0) return;
    const cell=pickCell(e);
    if(!cellInEditor(cell)) return;
    if (window.formulaMode && window.formulaMode.phase === 'edit') {
       handleFormulaCellPointerDown(e, cell, 'mouse');
       return;
    }

    // Once Edit Mode is active, the current cell returns to normal rich-text
    // mouse behavior. Clicking a different cell exits Edit Mode and selects it.
    if(tableEditCell===cell) return;

    // Activate Edit Mode directly on the second press instead of depending
    // entirely on dblclick crossing nested contenteditable boundaries.
    if(e.detail>=2&&selectedCells.size===1&&selectedCells.has(cell)){
      if (
        window.formulaMode?.phase === 'edit' &&
        window.formulaMode.destinationCell === cell &&
        cell.hasAttribute('data-formula-tokens')
      ) {
        e.preventDefault();
        e.stopPropagation();
        return;
      }
      e.preventDefault();
      mouseSelectionGesture=null;
      if (cell.hasAttribute('data-formula-tokens')) {
         try {
           const tokens = JSON.parse(cell.getAttribute('data-formula-tokens'));
           startFormulaMode(cell, tokens, true); // edit
         } catch(ex){}
         return;
      }
      enterCalcuLeafEditMode(cell,e.clientX,e.clientY);
      return;
    }

    const r=cell.getBoundingClientRect();
    const isColumnResize=cell.tagName==='TH'&&e.clientX>=r.right-3;
    const isRowResize=e.clientY>=r.bottom-3;
    if(isColumnResize||isRowResize) return;

    if(e.shiftKey&&selAnchor&&cellInEditor(selAnchor)){
      selectRange(selAnchor,cell);
      focusCalcuLeafSelection();
      e.preventDefault();
      return;
    }
    if(e.ctrlKey||e.metaKey){
      toggleSelectedCell(cell);
      e.preventDefault();
      return;
    }

    if (
      cell.hasAttribute('data-formula-tokens') &&
      !e.shiftKey &&
      !e.ctrlKey &&
      !e.metaKey
    ) {
      e.preventDefault();
      
      selectOnly(cell, true);
      
      const tools = document.getElementById('tblTools');
      if (tools) tools.classList.remove('show');
      const colorDropdown = document.getElementById('tblColorDropdown');
      if (colorDropdown) colorDropdown.classList.remove('show');
      
      openExistingFormula(cell);
      
      mouseSelectionGesture = null;
      return;
    }

    selectOnly(cell,true);
    mouseSelectionGesture={
      startX:e.clientX,
      startY:e.clientY,
      anchor:cell,
      dragging:false
    };
    e.preventDefault();
  });

  document.addEventListener('mousemove',e=>{
    if (window.formulaMode && window.formulaMode.phase === 'edit') {
       handleFormulaCellPointerMove(e);
       return;
    }
    const gesture=mouseSelectionGesture;
    if(!gesture) return;
    const distance=Math.hypot(e.clientX-gesture.startX,e.clientY-gesture.startY);
    if(!gesture.dragging&&distance<4) return;
    const cell=cellAtPoint(e.clientX,e.clientY);
    if(!cell||cell.closest('table')!==gesture.anchor.closest('table')) return;
    gesture.dragging=true;
    document.body.style.userSelect='none';
    selectRange(gesture.anchor,cell);
    e.preventDefault();
  });

  document.addEventListener('mouseup',e=>{
    if (window.formulaMode && window.formulaMode.phase === 'edit') {
       handleFormulaCellPointerUp(e);
       return;
    }
    if(!mouseSelectionGesture) return;
    if(mouseSelectionGesture.dragging) document.body.style.userSelect='';
    mouseSelectionGesture=null;
  });

  ed.addEventListener('dblclick',e=>{
    const cell=pickCell(e);
    if(!cellInEditor(cell)||tableEditCell===cell) return;
    
    if (
      window.formulaMode?.phase === 'edit' &&
      window.formulaMode.destinationCell === cell &&
      cell.hasAttribute('data-formula-tokens')
    ) {
      e.preventDefault();
      e.stopPropagation();
      return;
    }
    
    // Fallback for browsers that do not report mousedown.detail consistently.
    e.preventDefault();
    e.stopPropagation();

    if (cell.hasAttribute('data-formula-tokens')) {
      try {
        const tokens = JSON.parse(cell.getAttribute('data-formula-tokens'));
        startFormulaMode(cell, tokens, true);
      } catch (ex) {}
      return;
    }

    selectOnly(cell,false);
    enterCalcuLeafEditMode(cell,e.clientX,e.clientY);
  });

  ed.addEventListener('keyup', ()=>{
    if(!tableEditCell) return;
    const sel=window.getSelection();
    if(!sel||!sel.anchorNode) return;
    let n=sel.anchorNode.nodeType===3?sel.anchorNode.parentElement:sel.anchorNode;
    const cell=n&&n.closest?n.closest('td,th'):null;
    if(cell&&cell!==activeCell){ activeCell=cell; positionTableTools(); }
  });

  (document.getElementById('editorScroll')||ed).addEventListener('scroll',()=>{
    hideCalcuLeafDirectControls();
    positionTableTools();
  },{passive:true});
  window.addEventListener('resize', ()=>{
    hideCalcuLeafDirectControls();
    positionTableTools();
  });

  /* Agenda 1: direct structural controls. + stays inside the hovered cell
     outline; - stays outside the table. Controls snap to stable row/column
     positions instead of following the pointer. */
  const addControl=document.getElementById('calculeafAddControl')||document.createElement('button');
  const removeControl=document.getElementById('calculeafRemoveControl')||document.createElement('button');
  if(!addControl.id){
    addControl.id='calculeafAddControl';
    addControl.type='button';
    addControl.className='calculeaf-edge-control calculeaf-add-control';
    addControl.setAttribute('aria-label','Insert row or column');
    addControl.textContent='+';
    document.body.appendChild(addControl);
  }
  if(!removeControl.id){
    removeControl.id='calculeafRemoveControl';
    removeControl.type='button';
    removeControl.className='calculeaf-edge-control calculeaf-remove-control';
    removeControl.setAttribute('aria-label','Delete row or column');
    removeControl.textContent='-';
    document.body.appendChild(removeControl);
  }
  let directControlState=null;

  function clearDirectPreview(){
    ed.querySelectorAll('.calculeaf-delete-preview,.calculeaf-insert-left,.calculeaf-insert-right,.calculeaf-insert-top,.calculeaf-insert-bottom')
      .forEach(el=>el.classList.remove('calculeaf-delete-preview','calculeaf-insert-left','calculeaf-insert-right','calculeaf-insert-top','calculeaf-insert-bottom'));
  }
  function hideCalcuLeafDirectControls(){
    addControl.classList.remove('show');
    removeControl.classList.remove('show');
    directControlState=null;
    clearDirectPreview();
  }
  function placeDirectControl(btn,x,y){
    btn.style.left=`${Math.round(x)}px`;
    btn.style.top=`${Math.round(y)}px`;
    btn.classList.add('show');
  }
  function columnAtPointer(tbl,x){
    const positions=tableCellLayout(tbl);
    let best=null;
    positions.forEach((pos,cell)=>{
      const r=cell.getBoundingClientRect();
      if(x<r.left||x>r.right||r.width<=0) return;
      const span=Math.max(1,pos.colEnd-pos.colStart+1);
      const unit=r.width/span;
      const offset=Math.min(span-1,Math.max(0,Math.floor((x-r.left)/Math.max(1,unit))));
      const segLeft=r.left+(offset*unit);
      const segRight=offset===span-1?r.right:(segLeft+unit);
      const candidate={index:pos.colStart+offset,cell,span,centerX:(segLeft+segRight)/2};
      if(!best||candidate.span<best.span) best=candidate;
    });
    return best;
  }
  function rowAtPointer(tbl,y){
    const rows=Array.from(tbl.rows);
    for(let i=0;i<rows.length;i++){
      const r=rows[i].getBoundingClientRect();
      if(y>=r.top&&y<=r.bottom) return i;
    }
    return -1;
  }
  function previewColumn(tbl,colIndex){
    const positions=tableCellLayout(tbl);
    positions.forEach((pos,cell)=>{
      if(pos.colStart<=colIndex&&pos.colEnd>=colIndex) cell.classList.add('calculeaf-delete-preview');
    });
  }
  function previewRow(tbl,rowIndex){
    const positions=tableCellLayout(tbl);
    positions.forEach((pos,cell)=>{
      if(pos.rowStart<=rowIndex&&pos.rowEnd>=rowIndex) cell.classList.add('calculeaf-delete-preview');
    });
  }
  function handleCalcuLeafDirectHover(e){
    if (window.isFormulaModalActive && window.isFormulaModalActive()) { hideCalcuLeafDirectControls(); return; }
    if(e.pointerType&&e.pointerType!=='mouse'&&e.pointerType!=='pen'){ hideCalcuLeafDirectControls(); return; }
    if(selectionGesture?.dragging||mouseSelectionGesture?.dragging||tableEditCell){ hideCalcuLeafDirectControls(); return; }
    if(e.target.closest?.('.calculeaf-edge-control')) return;
    if(e.target.closest?.('#tblTools,.tbl-submenu,.tbl-sheet,.tbl-color-dropdown,#formatBar,.tbl-ctx-menu')){
      hideCalcuLeafDirectControls();
      return;
    }

    clearDirectPreview();
    addControl.classList.remove('show');
    removeControl.classList.remove('show');
    directControlState=null;

    const cell=pickCell(e);
    // Header cells keep their edge clean for column resizing. Row/column +
    // insertion remains available from ordinary body cells.
    if(cellInEditor(cell)&&cell.tagName!=='TH'){
      const r=cell.getBoundingClientRect();
      const distances={
        left:e.clientX-r.left,
        right:r.right-e.clientX,
        top:e.clientY-r.top,
        bottom:r.bottom-e.clientY
      };
      const candidates=Object.entries(distances)
        .filter(([side,d])=>d>=0&&d<=12&&!((side==='right'||side==='bottom')&&d<=3))
        .sort((a,b)=>a[1]-b[1]);
      if(candidates.length){
        const side=candidates[0][0];
        // Stable midpoint placement: the control identifies the active edge but
        // no longer chases the pointer along that edge.
        const cx=side==='left'?r.left:side==='right'?r.right:r.right-12;
        const cy=side==='top'?r.top:side==='bottom'?r.bottom:r.bottom-12;
        cell.classList.add(`calculeaf-insert-${side}`);
        directControlState={kind:'add',side,cell};
        placeDirectControl(addControl,cx,cy);
        return;
      }
    }

    for(const tbl of Array.from(ed.querySelectorAll('table'))){
      const r=tbl.getBoundingClientRect();
      const gutter=26;
      if(e.clientX>=r.left&&e.clientX<=r.right&&e.clientY>=r.top-gutter&&e.clientY<r.top){
        const target=columnAtPointer(tbl,e.clientX);
        if(target){
          directControlState={kind:'remove-col',tbl,colIndex:target.index,cell:target.cell};
          previewColumn(tbl,target.index);
          placeDirectControl(removeControl,target.centerX,r.top-11);
          return;
        }
      }
      if(e.clientY>=r.top&&e.clientY<=r.bottom&&e.clientX>=r.left-gutter&&e.clientX<r.left){
        const rowIndex=rowAtPointer(tbl,e.clientY);
        if(rowIndex>=0){
          const positions=tableCellLayout(tbl);
          const cell=cellAtLogicalPosition(tbl,rowIndex,0,positions)||Array.from(tbl.rows[rowIndex].cells)[0]||null;
          directControlState={kind:'remove-row',tbl,rowIndex,cell};
          previewRow(tbl,rowIndex);
          const rr=tbl.rows[rowIndex].getBoundingClientRect();
          placeDirectControl(removeControl,r.left-11,(rr.top+rr.bottom)/2);
          return;
        }
      }
    }
  }

  document.addEventListener('pointermove',handleCalcuLeafDirectHover,{passive:true});
  [addControl,removeControl].forEach(btn=>{
    btn.addEventListener('pointerdown',e=>{ e.preventDefault(); e.stopPropagation(); });
  });
  addControl.addEventListener('click',e=>{
    e.preventDefault(); e.stopPropagation();
    const state=directControlState;
    if(!state||state.kind!=='add'||!state.cell?.isConnected) return;
    selectOnly(state.cell,false);
    if(state.side==='left') tblInsertCol('left');
    else if(state.side==='right') tblInsertCol('right');
    else if(state.side==='top') tblInsertRow('above');
    else if(state.side==='bottom') tblInsertRow('below');
    hideCalcuLeafDirectControls();
  });
  removeControl.addEventListener('click',e=>{
    e.preventDefault(); e.stopPropagation();
    const state=directControlState;
    if(!state?.tbl?.isConnected) return;
    if(state.cell) selectOnly(state.cell,false);
    if(state.kind==='remove-col') tblDeleteColAt(state.colIndex,tableCellLayout(state.tbl).get(state.cell)?.rowStart||0,state.tbl);
    else if(state.kind==='remove-row') tblDeleteRowAt(state.rowIndex,tableCellLayout(state.tbl).get(state.cell)?.colStart||0,state.tbl);
    hideCalcuLeafDirectControls();
  });

  /* ── Column drag-resize (mouse, header edge only) ── */
  let dragCol=null;
  ed.addEventListener('mousedown', e=>{
    const cell=pickCell(e); if(!cellInEditor(cell)||cell.tagName!=='TH') return;
    const r=cell.getBoundingClientRect();
    if(e.clientX < r.right-3) return;
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
    if(e.clientY < r.bottom-3) return;
    if(e.clientX >= r.right-3) return; // let col resize win
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
    tblBtnMerge:'tblMenuMerge',
    tblBtnLayout:'tblMenuLayout',
    tblBtnThemes:'tblMenuThemes'
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

  // Theme Application Logic
  document.querySelectorAll('#tblMenuThemes button[data-theme]').forEach(btn => {
    btn.addEventListener('click', e => {
      e.preventDefault();
      e.stopPropagation();
      const theme = btn.getAttribute('data-theme');
      const tbl = currentTable();
      if (!tbl) return;
      
      if(window.HistoryManager) window.HistoryManager.capture(true);
      
      // Remove existing themes
      tbl.classList.remove('tbl-theme-default', 'tbl-theme-grayscale', 'tbl-theme-modern', 'tbl-theme-zebra', 'tbl-theme-elegant', 'tbl-theme-accent', 'tbl-theme-dark');
      if (theme) tbl.classList.add(`tbl-theme-${theme}`);
      
      if(window.HistoryManager) window.HistoryManager.capture(true);
      
      document.getElementById('tblMenuThemes')?.classList.remove('show');
      toast(`Applied ${theme} theme`);
    });
  });
  
  // Padding slider logic
  const paddingSlider = document.getElementById('tblMarginSlider');
  if (paddingSlider) {
      paddingSlider.addEventListener('input', e => {
          const tbl = currentTable();
          if(!tbl) return;
          const val = e.target.value;
          tbl.style.setProperty('--cell-padding', `${val}px`);
          Array.from(tbl.querySelectorAll('td, th')).forEach(c => c.classList.add('custom-padding'));
          positionTableTools();
      });
      paddingSlider.addEventListener('change', () => {
          if(window.HistoryManager) window.HistoryManager.queueCapture();
      });
  }

  // Templates Modal toggle
  const btnTemplates = document.getElementById('tblBtnTemplates');
  if (btnTemplates) {
      btnTemplates.addEventListener('click', e => {
          e.preventDefault();
          e.stopPropagation();
          tblMenuIds.forEach(mid=>document.getElementById(mid)?.classList.remove('show'));
          document.getElementById('tblTemplateModal')?.classList.add('show');
          renderTemplatesGrid();
      });
  }


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
    tblFmtPlain:()=>setCellFormat('number'),
    tblFmtCurUSD:()=>setCellFormat('currency','$'),
    tblFmtCurEUR:()=>setCellFormat('currency','€'),
    tblFmtCurGBP:()=>setCellFormat('currency','£'),
    tblFmtCurJPY:()=>setCellFormat('currency','¥'),
    tblFmtCurPHP:()=>setCellFormat('currency','₱'),
    tblFmtPercent:()=>setCellFormat('percentage'),
    tblHeaderRow:tblHeaderRow,
    tblHeaderCol:tblHeaderCol,
    tblAltRowShading:tblAltRowShading,
    tblCellBg:toggleTblColorPicker,
    tblCellBorder:toggleCellBorder,
    tblMobileWrap:tblMobileWrap,
    
    tblBold: ()=>applyFormattingToSelectedTableCells('bold'),
    tblItalic: ()=>applyFormattingToSelectedTableCells('italic'),
    tblAlign: ()=>{
       let next='left';
       if(activeCell) {
           const cur=activeCell.style.textAlign;
           next = cur==='center'?'right':(cur==='right'?'left':'center');
       }
       applyFormattingToSelectedTableCells('align', next);
    },
    tblWrap: tblMobileWrap,
    tblBorderAll: ()=>setCellBorders('all'),
    tblBorderOutline: ()=>setCellBorders('outline'),
    tblBorderTop: ()=>setCellBorders('top'),
    tblBorderBottom: ()=>setCellBorders('bottom'),
    tblBorderLeft: ()=>setCellBorders('left'),
    tblBorderRight: ()=>setCellBorders('right'),
    tblBorderNone: ()=>setCellBorders('none'),
    tblClearFmt: ()=>applyFormattingToSelectedTableCells('removeFormat'),
    tblClearCell: ()=>onSelected(c=>{ c.innerHTML=''; c.removeAttribute('data-formula'); }),
    
    tblCut: tblCut,
    tblCopy: tblCopy,
    tblPaste: tblPaste,
    tblPasteVal: tblPasteVal,
    
    tblFmtPaint: startFormatPainter,
    
    tblFmtComma: ()=>setCellFormat('number'),
    tblFmtDecInc: ()=>adjustDecimals(1),
    tblFmtDecDec: ()=>adjustDecimals(-1),
    tblDateMDY: ()=>setCellFormat('date', 'MDY'),
    tblDateDMY: ()=>setCellFormat('date', 'DMY'),
    tblDateISO: ()=>setCellFormat('date', 'ISO'),
    tblDateLong: ()=>setCellFormat('date', 'Long'),
    tblDateShortTxt: ()=>setCellFormat('date', 'ShortTxt'),
    
    tblSortAsc: ()=>tblSort(1, 'selection'),
    tblSortDesc: ()=>tblSort(-1, 'selection'),
    tblSortSheetAsc: ()=>tblSort(1, 'sheet'),
    tblSortSheetDesc: ()=>tblSort(-1, 'sheet'),
    tblFillColor: toggleTblColorPicker,
    tblDel:tblDelete
  };
  Object.entries(actionMap).forEach(([id,fn])=>{
    const el=document.getElementById(id) || document.querySelector(`[data-ctx="${id}"]`);
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
    if (window.formulaMode && (window.formulaMode.phase === 'edit' || window.formulaMode.phase === 'inspect')) {
      if (e.target.closest('table') || e.target.closest('.formula-autocomplete-menu')) {
        return; // Don't close anything if clicking inside formula ecosystem
      }
      cancelFormulaMode(); // Clicked outside the table, cancel formula mode
    }
    if(!e.target.closest('.tbl-submenu')&&!e.target.closest('#tblTools')){
      tblMenuIds.forEach(mid=>document.getElementById(mid)?.classList.remove('show'));
    }
    if(!e.target.closest('#tblColorDropdown')&&!e.target.closest('#tblCellBg')){
      dropdown?.classList.remove('show');
    }
    // Deselect only when leaving both CalcuLeafs and the formatting/tool surfaces that operate on it.
    if(!e.target.closest('table')&&!e.target.closest('#tblTools,.tbl-submenu,.tbl-sheet,.tbl-color-dropdown,.tbl-ctx-menu,.calculeaf-edge-control,#formatBar,.formula-autocomplete-menu')){
      touchSelectionMode=false;
      exitCalcuLeafEditMode(false);
      clearCellSelection();
      activeCell=null;
      highlightSelected();
      positionTableTools();
    }
  });

  document.addEventListener('keydown',e=>{
    const tbl=currentTable();
    if (typeof handleFormulaModeKeydown === 'function' && window.formulaMode && window.formulaMode.phase !== 'idle') {
      if (handleFormulaModeKeydown(e, window.formulaMode.destinationCell?.closest('table') || tbl)) return;
    }
    if(!tbl||!activeCell) return;

    if(tableEditCell){
      if(e.key==='Escape'){
        e.preventDefault();
        exitCalcuLeafEditMode(true);
        return;
      }
      if(e.key==='Tab'){
        e.preventDefault();
        const next=adjacentTableCell(tbl,activeCell,e.shiftKey?'ArrowLeft':'ArrowRight');
        exitCalcuLeafEditMode(false);
        if(next) selectOnly(next,true);
        else selectOnly(activeCell,true);
        return;
      }
      if(e.key==='Enter'){
        if(e.altKey||e.ctrlKey||e.metaKey){
          e.preventDefault();
          document.execCommand('insertLineBreak',false,null);
          return;
        }
        e.preventDefault();
        const next=adjacentTableCell(tbl,activeCell,e.shiftKey?'ArrowUp':'ArrowDown');
        exitCalcuLeafEditMode(false);
        if(next) selectOnly(next,true);
        else selectOnly(activeCell,true);
        return;
      }
      return;
    }

    if (e.key === '=' && !tableEditCell && activeCell) {
      e.preventDefault();
      e.stopPropagation();
      startFormulaMode(activeCell, [], true);
      return;
    }

    if(e.key==='Escape'){
      e.preventDefault();
      touchSelectionMode=false;
      clearCellSelection();
      activeCell=null;
      highlightSelected();
      focusCalcuLeafSelection();
      positionTableTools();
      return;
    }

    if(['ArrowUp','ArrowDown','ArrowLeft','ArrowRight'].includes(e.key)){
      const target=adjacentTableCell(tbl,activeCell,e.key);
      if(!target) return;
      e.preventDefault();
      if(e.shiftKey){
        const anchor=selAnchor||activeCell;
        clearCellSelection();
        selAnchor=anchor;
        activeCell=target;
        selectedCells=cellRange(tbl,anchor,target);
        highlightSelected();
        focusCalcuLeafSelection();
        positionTableTools();
      }else{
        selectOnly(target,true);
      }
      return;
    }

    if(e.key==='Enter'){
      e.preventDefault();
      enterCalcuLeafEditMode(activeCell);
      return;
    }

    if(e.key==='Tab'){
      e.preventDefault();
      const target=adjacentTableCell(tbl,activeCell,e.shiftKey?'ArrowLeft':'ArrowRight');
      if(target) selectOnly(target,true);
      return;
    }

    if((e.key==='Backspace'||e.key==='Delete')&&!e.ctrlKey&&!e.metaKey&&!e.altKey){
      e.preventDefault();
      onSelected(c=>{ c.innerHTML=''; c.removeAttribute('data-formula'); });
      handleBodyInput();
      return;
    }

    // Spreadsheet-style fast entry: printable typing replaces the active cell and enters Edit Mode.
    if(e.key.length===1&&!e.ctrlKey&&!e.metaKey&&!e.altKey){
      e.preventDefault();
      const cell=activeCell;
      cell.innerHTML='';
      cell.removeAttribute('data-formula');
      enterCalcuLeafEditMode(cell);
      document.execCommand('insertText',false,e.key);
      handleBodyInput();
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
    const img=e.target.closest('img');
    if(!img){
      // Click outside image: clear selections unless clicking toolbar or card chrome
      if(!e.target.closest('.img-toolbar') && !e.target.closest('#imgBatchBar') && !e.target.closest('.paperuss-card') && !e.target.closest('.paperuss-embed')){
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

  ed.addEventListener('mouseover', e => {
    const img = e.target.closest('img');
    if (img) {
      if (typeof handleImgHover === 'function') handleImgHover(img);
      else {
        if (typeof attachImgHoverGuard === 'function') attachImgHoverGuard(img);
        if (typeof attachImgTouchGuard === 'function') attachImgTouchGuard(img);
      }
    }
  }, { passive: true });

  // Long press: enters multi-select mode on mobile/tablet; opens context on desktop
  ed.addEventListener('touchstart', e=>{
    const img=e.target.closest('img');
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
    tb.addEventListener('click', e=>{
      const btn=e.target.closest('button'); if(!btn||!selectedImg) return;
      // Skip dropdown-toggle buttons — handled by responsive-images.js
      if(['imgTbSizeToggle','imgTbMoreToggle'].includes(btn.id) || btn.dataset.itbToggle) return;
      // Close all dropdowns after any action fires
      if(typeof closeAllItbDropdowns==='function') closeAllItbDropdowns(null);

      const isAudioCard = selectedImg.classList?.contains('paperuss-card-audio') || selectedImg.getAttribute?.('data-media-kind') === 'audio';

      // Mode switching for Audio cards
      if (btn.dataset.cardmode && isAudioCard) {
        setSoundCardDisplayMode(selectedImg, btn.dataset.cardmode);
        toast(`Mode switched to ${btn.dataset.cardmode}`);
        return;
      }

      // Size switching
      if (btn.dataset.imgsize) {
        if (isAudioCard) {
          setSoundCardWidthPreset(selectedImg, btn.dataset.imgsize);
          toast(`Size updated to ${btn.dataset.imgsize}`);
        } else {
          setImageSizeEx(selectedImg, btn.dataset.imgsize);
        }
        return;
      }

      if(btn.getAttribute('data-action')==='audio-toggle-play'){
        const audio = selectedImg.querySelector('.audio-native-player');
        if (audio) {
          if (audio.paused) audio.play().catch(_=>{});
          else audio.pause();
        }
        return;
      }

      if(btn.getAttribute('data-action')==='audio-download'){
        const id=selectedImg.getAttribute('data-media-id');
        if (id) mediaGet(id).then(rec=>downloadMediaById(id, rec?rec.name:'recording.webm'));
        return;
      }

      const targetImg = selectedImg || (typeof hoveredImg !== 'undefined' ? hoveredImg : null);
      if(btn.id==='imgTbCrop') return openCropModal(targetImg);
      if(btn.id==='imgTbAlignLeft') return setImageAlign(targetImg,'left');
      if(btn.id==='imgTbAlignCenter') return setImageAlign(targetImg,'center');
      if(btn.id==='imgTbAlignRight') return setImageAlign(targetImg,'right');
      if(btn.id==='imgTbRotate') return rotateImage(targetImg);
      if(btn.id==='imgTbFlip') return flipImage(targetImg);
      if(btn.id==='imgTbFlipV') return flipImageVertical(targetImg);
      if(btn.id==='imgTbCaption') return toggleImageCaption(targetImg);
      if(btn.id==='imgTbCover') return setNotebookCover(targetImg);
      if(btn.id==='imgTbHeaderBanner') return setHeaderBannerFromImage(targetImg);
      if(btn.id==='imgTbReplace') return requestImageReplacement(targetImg);
      if(btn.id==='imgTbView') return openImageFullscreen(targetImg);
      if(btn.id==='imgTbDownload'){
        if (!targetImg) return;
        const id=targetImg.getAttribute('data-media-id');
        mediaGet(id).then(rec=>downloadMediaById(id, rec?rec.name:'image'));
        return;
      }
      if(btn.id==='imgTbDelete' || btn.getAttribute('data-action')==='delete-card'){
        const img=targetImg; clearImageSelection();
        if (img) { img.remove(); handleBodyInput(); toast('Card removed'); }
      }
    });
  }

function setSoundCardDisplayMode(card, mode){
  if (!card) return;
  const id = card.getAttribute('data-media-id') || '';
  const audio = card.querySelector('.audio-native-player');
  const url = audio ? audio.getAttribute('src') : '';
  const title = card.querySelector('.card-title-text, .embed-compact-title, strong')?.textContent || 'Voice recording';
  const widthPreset = card.getAttribute('data-width-preset') || 'medium';

  card.className = `paperuss-card paperuss-card-audio embed-mode-${mode} embed-width-${widthPreset} card-width-${widthPreset}`;
  card.setAttribute('data-display-mode', mode);

  let innerCardContent = '';
  if (mode === 'compact') {
    innerCardContent = `
      <div class="embed-compact-card">
        <div class="embed-compact-hero-icon">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="var(--accent)"><polygon points="6,4 20,12 6,20"/></svg>
        </div>
        <span class="embed-compact-divider"></span>
        <div class="embed-compact-info">
          <strong class="embed-compact-title" contenteditable="true" data-action="inline-edit-title" title="Click to edit title">${esc(title)}</strong>
          <span class="embed-compact-link">audio · compact</span>
        </div>
        <button type="button" class="audio-hero-play-btn-large audio-compact-play-btn" data-action="audio-toggle-play" title="Play/Pause" style="width:36px;height:36px;min-width:36px;">
          <svg class="audio-play-icon" width="16" height="16" viewBox="0 0 24 24" fill="var(--accent)"><polygon points="6,4 20,12 6,20"/></svg>
          <svg class="audio-pause-icon hidden" width="16" height="16" viewBox="0 0 24 24" fill="var(--accent)"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg>
        </button>
      </div>`;
  } else {
    innerCardContent = `
      <div class="embed-canonical-card">
        <div class="embed-canonical-header">
          <div class="embed-provider-badge-wrap">
            <span class="card-type-icon"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg></span>
            <span class="embed-provider-badge">AUDIO</span>
          </div>
          <span class="embed-canonical-link">AUDIO FILE</span>
        </div>

        <div class="embed-canonical-hero audio-hero-center">
          <button type="button" class="audio-hero-play-btn-large" data-action="audio-toggle-play" title="Play/Pause">
            <svg class="audio-play-icon" width="24" height="24" viewBox="0 0 24 24" fill="var(--accent)" stroke="none"><polygon points="6,4 20,12 6,20"/></svg>
            <svg class="audio-pause-icon hidden" width="24" height="24" viewBox="0 0 24 24" fill="var(--accent)" stroke="none"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg>
          </button>
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
            <strong contenteditable="true" data-action="inline-edit-title" title="Click to edit title">${esc(title)}</strong>
            <p class="embed-fallback-desc" contenteditable="true" data-action="inline-edit-desc" title="Click to edit caption">Add audio notes, description, or transcript...</p>
          </div>
        </div>
      </div>`;
  }

  card.innerHTML = `${innerCardContent}<audio class="audio-native-player" preload="metadata" data-media-id="${id}" data-media-kind="audio" src="${url}"></audio><div class="card-resize-handle" title="Drag to resize card"></div>`;
  // Rebuild embed-style top-floating toolbar (NOT image toolbar)
  if (typeof hydrateSoundCards === 'function') hydrateSoundCards(card);
  if (typeof handleBodyInput === 'function') handleBodyInput();
  if (typeof save === 'function') save();
}

function setSoundCardWidthPreset(card, preset){
  if (!card) return;
  const currentMode = card.getAttribute('data-display-mode') || 'preview';
  card.setAttribute('data-width-preset', preset);
  card.className = `paperuss-card paperuss-card-audio embed-mode-${currentMode} embed-width-${preset} card-width-${preset}`;
  // Rebuild embed-style top-floating toolbar (NOT image toolbar)
  if (typeof hydrateSoundCards === 'function') hydrateSoundCards(card);
  if (typeof handleBodyInput === 'function') handleBodyInput();
  if (typeof save === 'function') save();
}

  /* ----- Corner drag resize (tablet + desktop), ratio locked ----- */
  document.querySelectorAll('.img-handle').forEach(h=>{
    const start=e=>{
      if(!selectedImg) return;
      e.preventDefault();
      e.stopPropagation();
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

window.formulaMode = {
  phase: 'idle',
  destinationCell: null,
  originalHTML: '',
  originalTokens: [],
  tokens: [],
  activeSourceIndex: null,
  sourceTargetIndex: null,
  rangeTokenIndex: null,
  sourceVisualMap: new Map(),
  selectingRange: false,
  dragAnchor: null,
  dragCurrent: null,
  menuQuery: '',
  pendingBinaryOperator: null
};

function getCellId(cell) {
  if (!cell) return null;
  let id = cell.getAttribute('data-cell-id');
  if (!id) {
    id = 'cell_' + Math.random().toString(36).substr(2, 9);
    cell.setAttribute('data-cell-id', id);
  }
  return id;
}
function getCellById(tbl, id) {
  if (!tbl || !id) return null;
  return tbl.querySelector(`[data-cell-id="${id}"]`);
}
function colIndexToLabel(idx) {
  let label = '';
  while (idx >= 0) { label = String.fromCharCode((idx % 26) + 65) + label; idx = Math.floor(idx / 26) - 1; }
  return label;
}
function labelToColIndex(str) {
  let idx = 0;
  for (let i = 0; i < str.length; i++) { idx = idx * 26 + (str.charCodeAt(i) - 64); }
  return idx - 1;
}
/* ============================================================
   SMART VALUE METADATA (Agenda 5A)
   ============================================================ */

function parseCalcuLeafValue(htmlStr) {
  if (/<[^>]+>/.test(htmlStr)) {
    const temp = document.createElement('div');
    temp.innerHTML = htmlStr;
    return { type: 'text', value: temp.textContent.trim() };
  }

  const temp = document.createElement('div');
  temp.innerHTML = htmlStr;
  const text = temp.textContent.trim();
  
  if (!text) return { type: 'text', value: text };

  // Percentage
  const pctMatch = text.match(/^(-?(?:\d{1,3}(?:,\d{3})*|\d+)(?:\.\d+)?)\s*%$/);
  if (pctMatch) {
    const numericStr = pctMatch[1].replace(/,/g, '');
    const num = parseFloat(numericStr);
    if (!isNaN(num)) {
      return { type: 'percentage', value: num / 100 };
    }
  }
  
  // Currency
  const currencyMatch = text.match(/^([₱$€£¥])\s*(-?(?:\d{1,3}(?:,\d{3})*|\d+)(?:\.\d+)?)$/);
  if (currencyMatch) {
    const symbol = currencyMatch[1];
    const numericStr = currencyMatch[2].replace(/,/g, '');
    const num = parseFloat(numericStr);
    if (!isNaN(num)) {
      const map = { '₱': 'PHP', '$': 'USD', '€': 'EUR', '£': 'GBP', '¥': 'JPY' };
      return { type: 'currency', value: num, currency: map[symbol] };
    }
  }
  
  // Date
  const dateStrMatch = text.match(/^(\d{4}-\d{2}-\d{2}|\d{1,2}\/\d{1,2}\/\d{4}|[A-Za-z]{3,9}\s\d{1,2},\s\d{4})$/);
  if (dateStrMatch) {
    const ts = Date.parse(text);
    if (!isNaN(ts)) {
      return { type: 'date', value: ts };
    }
  }

  // Plain number
  const numMatch = text.match(/^-?(?:\d{1,3}(?:,\d{3})*|\d+)(?:\.\d+)?$/);
  if (numMatch) {
    const num = parseFloat(text.replace(/,/g, ''));
    if (!isNaN(num)) {
      return { type: 'number', value: num };
    }
  }
  
  return { type: 'text', value: text };
}

function formatCalcuLeafValue(metadata) {
  if (metadata.type === 'number') {
    return formatNumber(metadata.value);
  } else if (metadata.type === 'percentage') {
    const pct = parseFloat((metadata.value * 100).toFixed(6));
    return new Intl.NumberFormat('en-US', { maximumFractionDigits: 4 }).format(pct) + '%';
  } else if (metadata.type === 'currency') {
    const rmap = { 'PHP': '₱', 'USD': '$', 'EUR': '€', 'GBP': '£', 'JPY': '¥' };
    const sym = rmap[metadata.currency] || '$';
    return formatCurrency(metadata.value, sym);
  } else if (metadata.type === 'date') {
    return new Intl.DateTimeFormat('en-US', { year: 'numeric', month: 'short', day: 'numeric' }).format(new Date(metadata.value));
  }
  return metadata.value;
}

function inferFormulaResultValueModel(tokens, tbl, numericResult) {
  let funcToken = tokens.find(t => t.type === 'function');
  let opTokens = tokens.filter(t => t.type === 'operator' && ['+', '-', '*', '/'].includes(t.value));
  let operands = [];

  for (let tok of tokens) {
    if (tok.type === 'cell') {
      const cell = getCellById(tbl, tok.id);
      if (cell) {
        const type = cell.getAttribute('data-value-type') || 'number';
        const currency = cell.getAttribute('data-currency');
        operands.push({ type, currency });
      } else {
        operands.push({ type: 'number' });
      }
    } else if (tok.type === 'range') {
      for (let id of tok.ids) {
        const cell = getCellById(tbl, id);
        if (cell) {
          const type = cell.getAttribute('data-value-type') || 'number';
          const currency = cell.getAttribute('data-currency');
          operands.push({ type, currency });
        } else {
          operands.push({ type: 'number' });
        }
      }
    } else if (tok.type === 'literal' || tok.type === 'number') {
      operands.push({ type: 'number' });
    }
  }

  // Range functions
  if (funcToken) {
    const fn = funcToken.value.toUpperCase();
    if (fn === 'COUNT' || fn === 'PRODUCT' || fn === 'PROD') return { type: 'number', value: numericResult };
    
    let allCurrency = operands.length > 0 && operands.every(o => o.type === 'currency' && o.currency === operands[0].currency);
    if (allCurrency) return { type: 'currency', value: numericResult, currency: operands[0].currency };
    
    let allPercentage = operands.length > 0 && operands.every(o => o.type === 'percentage');
    if (allPercentage) return { type: 'percentage', value: numericResult };
    
    return { type: 'number', value: numericResult };
  }

  // Simple operators
  if (opTokens.length > 0 && opTokens.every(op => op.value === '+' || op.value === '-')) {
    if (operands.length > 0 && operands.every(o => o.type === 'currency' && o.currency === operands[0].currency)) {
      return { type: 'currency', value: numericResult, currency: operands[0].currency };
    }
    if (operands.length > 0 && operands.every(o => o.type === 'percentage')) {
      return { type: 'percentage', value: numericResult };
    }
  }
  
  if (opTokens.length === 1 && operands.length === 2) {
    const op = opTokens[0].value;
    const left = operands[0];
    const right = operands[1];
    
    if (op === '-') {
      if (left.type === 'date' && right.type === 'date') {
        return { type: 'number', value: numericResult / 86400000 };
      }
    }

    if (op === '*') {
      if (left.type === 'currency' && right.type === 'number') return { type: 'currency', value: numericResult, currency: left.currency };
      if (left.type === 'number' && right.type === 'currency') return { type: 'currency', value: numericResult, currency: right.currency };
      return { type: 'number', value: numericResult };
    }
    
    if (op === '/') {
      if (left.type === 'currency' && right.type === 'number') return { type: 'currency', value: numericResult, currency: left.currency };
      return { type: 'number', value: numericResult };
    }
  }

  // Fallback
  return { type: 'number', value: numericResult };
}

function formatNumber(val, decimals = 2) {
  const num = parseFloat(val);
  if (isNaN(num)) return val;
  return new Intl.NumberFormat('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals }).format(num);
}
function formatCurrency(val, symbol = '$', decimals = 2) {
  const num = parseFloat(val);
  if (isNaN(num)) return val;
  const formatted = new Intl.NumberFormat('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals }).format(Math.abs(num));
  return num < 0 ? `(${symbol}${formatted})` : `${symbol}${formatted}`;
}
function resolveCellRange(tbl, refStr, positions) {
  const match = refStr.trim().toUpperCase().match(/^([A-Z]+)(\d+)(?::([A-Z]+)(\d+))?$/);
  if (!match) return [];
  const colStart = labelToColIndex(match[1]), rowStart = parseInt(match[2], 10) - 1;
  let colEnd = colStart, rowEnd = rowStart;
  if (match[3] && match[4]) { colEnd = labelToColIndex(match[3]); rowEnd = parseInt(match[4], 10) - 1; }
  const minRow = Math.min(rowStart, rowEnd), maxRow = Math.max(rowStart, rowEnd);
  const minCol = Math.min(colStart, colEnd), maxCol = Math.max(colStart, colEnd);
  const cells = [];
  positions.forEach((pos, cell) => {
    if (pos.rowStart >= minRow && pos.rowStart <= maxRow && pos.colStart >= minCol && pos.colStart <= maxCol) cells.push(cell);
  });
  return cells;
}
function getCalcuLeafNumericValue(cell) {
  const type = cell.getAttribute('data-value-type');
  const raw = cell.getAttribute('data-value');

  if (raw !== null && (type === 'number' || type === 'currency' || type === 'percentage' || type === 'date')) {
    const value = Number(raw);
    if (Number.isFinite(value)) {
      return value;
    }
  }

  let txt = cell.textContent.replace(/[^0-9.\-()]/g, '');
  if (cell.textContent.includes('(') && cell.textContent.includes(')')) txt = '-' + txt.replace(/[()]/g, '');
  const val = parseFloat(txt);
  return isNaN(val) ? 0 : val;
}

function evaluateCellFormula(tbl, formulaStr, positions) {
  const expr = formulaStr.substring(1).toUpperCase().trim();
  if (!expr) return null;
  const sumMatch = expr.match(/^SUM\(([^)]*)\)$/);
  if (sumMatch) {
    if (!sumMatch[1].trim()) return '#MISSING!';
    let total = 0;
    sumMatch[1].split(',').forEach(r => resolveCellRange(tbl, r.trim(), positions).forEach(c => total += getCalcuLeafNumericValue(c)));
    return total;
  }
  const avgMatch = expr.match(/^(?:AVERAGE|AVG)\(([^)]*)\)$/);
  if (avgMatch) {
    if (!avgMatch[1].trim()) return '#MISSING!';
    let total = 0, count = 0;
    avgMatch[1].split(',').forEach(r => resolveCellRange(tbl, r.trim(), positions).forEach(c => { total += getCalcuLeafNumericValue(c); count++; }));
    return count > 0 ? total / count : '#DIV/0!';
  }
  const prodMatch = expr.match(/^(?:PRODUCT|PROD)\(([^)]*)\)$/);
  if (prodMatch) {
    if (!prodMatch[1].trim()) return '#MISSING!';
    let prod = 1, count = 0;
    prodMatch[1].split(',').forEach(r => resolveCellRange(tbl, r.trim(), positions).forEach(c => { prod *= getCalcuLeafNumericValue(c); count++; }));
    return count > 0 ? prod : 0;
  }
  const countMatch = expr.match(/^COUNT\(([^)]*)\)$/);
  if (countMatch) {
    if (!countMatch[1].trim()) return '#MISSING!';
    let count = 0;
    countMatch[1].split(',').forEach(r => resolveCellRange(tbl, r.trim(), positions).forEach(c => { if (!isNaN(parseFloat(c.textContent.replace(/[^0-9.\-()]/g, '')))) count++; }));
    return count;
  }
  const minMatch = expr.match(/^MIN\(([^)]*)\)$/);
  if (minMatch) {
    if (!minMatch[1].trim()) return '#MISSING!';
    let min = Infinity;
    minMatch[1].split(',').forEach(r => resolveCellRange(tbl, r.trim(), positions).forEach(c => min = Math.min(min, getCalcuLeafNumericValue(c))));
    return min === Infinity ? 0 : min;
  }
  const maxMatch = expr.match(/^MAX\(([^)]*)\)$/);
  if (maxMatch) {
    if (!maxMatch[1].trim()) return '#MISSING!';
    let max = -Infinity;
    maxMatch[1].split(',').forEach(r => resolveCellRange(tbl, r.trim(), positions).forEach(c => max = Math.max(max, getCalcuLeafNumericValue(c))));
    return max === -Infinity ? 0 : max;
  }
  const absMatch = expr.match(/^ABS\(([^)]*)\)$/);
  if (absMatch) {
    if (!absMatch[1].trim()) return '#MISSING!';
    let valExpr = absMatch[1].replace(/[A-Z]+\d+/g, match => {
      const cells = resolveCellRange(tbl, match, positions);
      return cells.length > 0 ? getCalcuLeafNumericValue(cells[0]) : 0;
    });
    try { return Math.abs(new Function(`return ${valExpr}`)()); } catch(e) { return '#VALUE!'; }
  }
  const roundMatch = expr.match(/^ROUND\(([^,]+)(?:,(\d+))?\)$/);
  if(roundMatch){
    let valExpr = roundMatch[1].replace(/[A-Z]+\d+/g, match => {
      const cells = resolveCellRange(tbl, match, positions);
      return cells.length > 0 ? getCalcuLeafNumericValue(cells[0]) : 0;
    });
    try {
       let val = new Function(`return ${valExpr}`)();
       let dec = roundMatch[2] ? parseInt(roundMatch[2]) : 0;
       return Number(Math.round(val+'e'+dec)+'e-'+dec);
    }catch(e) { return '#VALUE!'; }
  }
  const iferrorMatch = expr.match(/^IFERROR\(([^,]+),(.*)\)$/);
  if (iferrorMatch) {
    let mainExpr = iferrorMatch[1].replace(/[A-Z]+\d+/g, match => {
      const cells = resolveCellRange(tbl, match, positions);
      return cells.length > 0 ? getCalcuLeafNumericValue(cells[0]) : 0;
    });
    let fallback = iferrorMatch[2].replace(/^["'](.*)["']$/, '$1').trim();
    try {
      let res = new Function(`return ${mainExpr}`)();
      if (!isFinite(res)) return fallback;
      return res;
    } catch(e) { return fallback; }
  }
  try {
    let replacedExpr = expr.replace(/[A-Z]+\d+/g, match => {
      const cells = resolveCellRange(tbl, match, positions);
      return cells.length > 0 ? getCalcuLeafNumericValue(cells[0]) : 0;
    });
    if (/^[0-9+\-*/(). ]+$/.test(replacedExpr)) {
      if(/\/0(?![0-9.])/.test(replacedExpr)) return '#DIV/0!';
      const res = new Function(`return ${replacedExpr}`)();
      if(!isFinite(res)) return '#DIV/0!';
      return res;
    }
  } catch (e) { return '#ERROR!'; }
  return '#ERROR!';
}

function compileFormulaForEvaluator(tokens, tbl) {
  let exprStr = '=';
  tokens.forEach(tok => {
    if (tok.type === 'literal' || tok.type === 'operator' || tok.type === 'function' || tok.type === 'comparison') {
      exprStr += tok.value;
    } else if (tok.type === 'text') {
      exprStr += `"${tok.value}"`;
    } else if (tok.type === 'literal' || tok.type === 'operator' || tok.type === 'function') {
      exprStr += tok.value;
    } else if (tok.type === 'cell' && tok.id) {
      const c = getCellById(tbl, tok.id);
      if (c && tbl) {
        const pos = tableCellLayout(tbl).get(c);
        if (pos) exprStr += colIndexToLabel(pos.colStart) + (pos.rowStart + 1);
        else exprStr += 'A1';
      } else exprStr += 'A1';
    } else if (tok.type === 'range' && tok.ids && tok.ids.length > 0) {
      const c1 = getCellById(tbl, tok.ids[0]);
      const c2 = getCellById(tbl, tok.ids[tok.ids.length - 1]);
      if (c1 && c2 && tbl) {
        const pos1 = tableCellLayout(tbl).get(c1);
        const pos2 = tableCellLayout(tbl).get(c2);
        if (pos1 && pos2) {
           exprStr += colIndexToLabel(Math.min(pos1.colStart, pos2.colStart)) + (Math.min(pos1.rowStart, pos2.rowStart) + 1) + ':' + colIndexToLabel(Math.max(pos1.colEnd, pos2.colEnd)) + (Math.max(pos1.rowEnd, pos2.rowEnd) + 1);
        } else exprStr += 'A1:A1';
      } else exprStr += 'A1:A1';
    }
  });
  return exprStr;
}

function recalculateTableFormulas(tbl) {
  if (!tbl) return;
  const positions = tableCellLayout(tbl);
  const formulaCells = Array.from(tbl.querySelectorAll('[data-formula-tokens]'));
  for(let pass=0; pass<3; pass++) {
    formulaCells.forEach(cell => {
      if (cell === window.formulaMode.destinationCell && window.formulaMode.phase === 'edit') return;
      const tokensStr = cell.getAttribute('data-formula-tokens');
      if (tokensStr) {
        try {
          const tokens = JSON.parse(tokensStr);
          const exprStr = compileFormulaForEvaluator(tokens, tbl);
          const result = evaluateCellFormula(tbl, exprStr, positions);
          if (result === null || (typeof result === 'string' && result.startsWith('#'))) return;
          
          let output = result;
          if (typeof result === 'number') {
            const resultModel = inferFormulaResultValueModel(tokens, tbl, result);
            cell.setAttribute('data-value-type', resultModel.type);
            cell.setAttribute('data-value', resultModel.value);
            if (resultModel.currency) {
                cell.setAttribute('data-currency', resultModel.currency);
            } else {
                cell.removeAttribute('data-currency');
            }
            output = formatCalcuLeafValue(resultModel);
          }
          cell.innerHTML = output;
        } catch(e) {}
      }
    });
  }
}
const originalHandleBodyInput = window.handleBodyInput;
window.handleBodyInput = function(e) {
  if(originalHandleBodyInput) originalHandleBodyInput(e);
  document.querySelectorAll('.editor-content table').forEach(tbl => recalculateTableFormulas(tbl));
};

/* ==================== FORMULA UX & COLORS ==================== */

function formulaSourceKey(token) {
  if (token.type === 'cell') return `cell:${token.id}`;
  if (token.type === 'range') return `range:${(token.ids||[]).join('|')}`;
  return null;
}

let formulaSourceColorMap = new Map();
function computeSourceColors(tokens) {
  window.formulaMode.sourceVisualMap.clear();
  let color = 1;
  tokens.forEach((token, index) => {
    if (token.type !== 'cell' && token.type !== 'range') return;
    window.formulaMode.sourceVisualMap.set(index, color);
    color = (color % 6) + 1;
  });
}

function highlightFormulaSources() {
  document.querySelectorAll('[class*="calculeaf-formula-source-"], .calculeaf-formula-destination').forEach(el => {
    el.className = el.className.replace(/calculeaf-formula-source(?:-hovered|-muted|-\d+)?/g, '').replace(/calculeaf-formula-destination/g, '').replace(/\s+/g, ' ').trim();
  });
  if (window.formulaMode.phase === 'idle') return;
  
  if (window.formulaMode.destinationCell) {
    window.formulaMode.destinationCell.classList.add('calculeaf-formula-destination');
  }
  
  const tbl = window.formulaMode.destinationCell?.closest('table');
  if (!tbl) return;
  
  computeSourceColors(window.formulaMode.tokens);
  window.formulaMode.tokens.forEach((tok, idx) => {
    if (tok.type !== 'cell' && tok.type !== 'range') return;
    const colorIdx = window.formulaMode.sourceVisualMap.get(idx);
    if (!colorIdx) return;
    if (tok.type === 'cell' && tok.id) {
      const c = getCellById(tbl, tok.id);
      if (c) c.classList.add(`calculeaf-formula-source-${colorIdx}`);
    } else if (tok.type === 'range' && tok.ids) {
      tok.ids.forEach(id => {
        const c = getCellById(tbl, id);
        if (c) c.classList.add(`calculeaf-formula-source-${colorIdx}`);
      });
    }
  });
  
  if (window.formulaMode.selectingRange && window.formulaMode.dragAnchor && window.formulaMode.dragCurrent) {
    let colorIdx = 1;
    if (window.formulaMode.rangeTokenIndex !== null) {
      colorIdx = window.formulaMode.sourceVisualMap.get(window.formulaMode.rangeTokenIndex) || 1;
    }
    const range = cellRange(tbl, window.formulaMode.dragAnchor, window.formulaMode.dragCurrent);
    range.forEach(c => c.classList.add(`calculeaf-formula-source-${colorIdx}`));
  }
}

function handleTokenHover(el, isHover) {
  if (window.formulaMode.phase === 'idle') return;
  let idx = -1;
  if (typeof el === 'number') {
    idx = el; // fallback
  } else if (el && el.hasAttribute('data-token-index')) {
    idx = Number(el.getAttribute('data-token-index'));
  }
  const token = window.formulaMode.tokens[idx];
  const targetKey = token ? formulaSourceKey(token) : null;
  
  document.querySelectorAll('[class*="calculeaf-formula-source-"]').forEach(cell => {
    cell.classList.remove('calculeaf-formula-source-hovered', 'calculeaf-formula-source-muted');
    if (!isHover) return;
    let match = false;
    if (targetKey && token.type === 'cell' && cell.getAttribute('data-cell-id') === token.id) match = true;
    else if (targetKey && token.type === 'range' && (token.ids || []).includes(cell.getAttribute('data-cell-id'))) match = true;
    
    if (match) cell.classList.add('calculeaf-formula-source-hovered');
    else cell.classList.add('calculeaf-formula-source-muted');
  });
  
  const chips = document.querySelectorAll('.formula-token-chip');
  chips.forEach((chip) => {
    chip.classList.remove('calculeaf-formula-source-hovered', 'calculeaf-formula-source-muted');
    if (!isHover) return;
    const cIdx = Number(chip.getAttribute('data-token-index'));
    const chipToken = window.formulaMode.tokens[cIdx];
    const cKey = chipToken ? formulaSourceKey(chipToken) : null;
    if (cKey === targetKey) chip.classList.add('calculeaf-formula-source-hovered');
    else chip.classList.add('calculeaf-formula-source-muted');
  });
}

function startFormulaMode(cell, initialTokens = [], isEdit = true) {
  if (!cell) return;
  exitCalcuLeafEditMode(false);
  
  window.formulaMode.phase = isEdit ? 'edit' : 'inspect';
  window.formulaMode.destinationCell = cell;
  window.formulaMode.originalHTML = cell.innerHTML;
  
  if (isEdit) {
    clearCellSelection();
    if (initialTokens.length === 0 && !cell.hasAttribute('data-formula-tokens')) {
       cell.removeAttribute('data-formula');
       cell.innerHTML = '&nbsp;';
    }
  }
  
  window.formulaMode.originalTokens = JSON.parse(JSON.stringify(initialTokens));
  window.formulaMode.tokens = JSON.parse(JSON.stringify(initialTokens));
  window.formulaMode.activeSourceIndex = isEdit ? window.formulaMode.tokens.length : null;
  window.formulaMode.sourceVisualMap.clear();
  window.formulaMode.sourceTargetIndex = null;
  
  if (isEdit && window.formulaMode.tokens.length > 0) {
    const primary = findPrimaryFormulaSourceIndex(window.formulaMode.tokens);
    if (primary !== -1) window.formulaMode.sourceTargetIndex = primary;
  }
  window.formulaMode.selectingRange = false;
  window.formulaMode.dragAnchor = null;
  window.formulaMode.dragCurrent = null;
  window.formulaMode.menuQuery = '';
  window.formulaMode.pendingBinaryOperator = null;
  
  highlightFormulaSources();
  renderFormulaMenu();
}

window.transitionToFormulaEdit = function() {
  // Deprecated: existing formulas open directly in edit.
  // Harmless compatibility wrapper.
};
function transitionToFormulaEdit() {
  window.transitionToFormulaEdit();
}

function cancelFormulaMode() {
  if (window.formulaMode.phase === 'idle') return;
  
  if (window.formulaMode.phase === 'edit') {
    window.formulaMode.tokens = JSON.parse(JSON.stringify(window.formulaMode.originalTokens));
    const cell = window.formulaMode.destinationCell;
    if (cell) cell.innerHTML = window.formulaMode.originalHTML;
    
    window.formulaMode.phase = 'idle';
    window.formulaMode.destinationCell = null;
    window.formulaMode.activeSourceIndex = null;
    window.formulaMode.sourceTargetIndex = null;
    window.formulaMode.rangeTokenIndex = null;
    window.formulaMode.sourceVisualMap.clear();
    highlightFormulaSources();
    hideFormulaMenu();
    return;
  }
  
  window.formulaMode.phase = 'idle';
  highlightFormulaSources();
  hideFormulaMenu();
}

function completeFormulaTokens(tokens) {
  let openCount = 0, closeCount = 0, expectsValue = false;
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    if (t.type === 'operator') {
      if (t.value === '(') { openCount++; expectsValue = true; }
      else if (t.value === ')') { closeCount++; expectsValue = false; }
      else if (t.value === ',') { expectsValue = true; }
      else { expectsValue = true; }
    } else if (t.type === 'function') { expectsValue = true; }
    else expectsValue = false;
  }
  
  if (expectsValue) return null; 
  if (openCount > closeCount) {
    const newTokens = [...tokens];
    for (let i = 0; i < openCount - closeCount; i++) newTokens.push({ type: 'operator', value: ')' });
    return newTokens;
  }
  if (openCount < closeCount) return null;
  return tokens;
}

function validateFormulaState(tokens, simulateCommit = false) {
  if (tokens.length === 0) return { status: 'building', msg: 'Type a formula or choose an operation' };
  let checkTokens = [...tokens];
  if (simulateCommit) {
    checkTokens = completeFormulaTokens(checkTokens);
    if (!checkTokens) return { status: 'invalid', msg: 'This calculation is missing an input.' };
  }
  
  const tbl = window.formulaMode.destinationCell?.closest('table');
  const expr = compileFormulaForEvaluator(checkTokens, tbl);
  if (expr.endsWith('()') && checkTokens[checkTokens.length-1].value === ')') return { status: 'invalid', msg: 'Choose at least one cell to add.' };
  
  // Prevent string concatenation (e.g. A1A2 -> 1312) by strictly enforcing operators between values
  for (let i = 0; i < checkTokens.length - 1; i++) {
    const curr = checkTokens[i];
    const next = checkTokens[i + 1];
    const isCurrVal = curr.type === 'cell' || curr.type === 'range' || curr.type === 'literal';
    const isNextVal = next.type === 'cell' || next.type === 'range' || next.type === 'literal';
    if (isCurrVal && isNextVal) {
      return { status: 'error', msg: 'Missing operator (like +, -) between values.' };
    }
  }

  const last = checkTokens[checkTokens.length - 1];
  if (last && (last.type === 'operator' || last.type === 'function') && last.value !== ')') {
     return simulateCommit ? { status: 'invalid', msg: 'This calculation is missing an input.' } : { status: 'building', msg: 'Choose another input' };
  }
  const result = evaluateCellFormula(tbl, expr, tableCellLayout(tbl));
  if (result === null) return { status: 'building', msg: 'Choose another input' };
  if (result === '#MISSING!') return { status: 'invalid', msg: 'Choose at least one cell.' };
  if (typeof result === 'string' && result.startsWith('#')) {
     if (result === '#DIV/0!') return { status: 'error', msg: "Can't divide by zero. Choose another source or change its value." };
     if (result === '#VALUE!') return { status: 'error', msg: 'This calculation needs a number.' };
     return { status: 'error', msg: 'This calculation has an error.' };
  }
  let formattedResult = formatNumber(result);
  if (typeof result === 'number') {
    const resultModel = inferFormulaResultValueModel(checkTokens, tbl, result);
    formattedResult = formatCalcuLeafValue(resultModel);
  }
  return { status: 'completable', msg: `Preview: ${formattedResult}`, result: result };
}

function commitFormulaMode() {
  if (window.formulaMode.phase !== 'edit') return;
  const cell = window.formulaMode.destinationCell;
  const tbl = cell?.closest('table');
  if (!cell || !tbl) return;
  
  const validation = validateFormulaState(window.formulaMode.tokens, true);
  if (validation.status === 'invalid' || validation.status === 'error') return;
  
  const finalTokens = completeFormulaTokens(window.formulaMode.tokens) || window.formulaMode.tokens;
  
  ensureFormulaSourceIds(finalTokens, tbl);
  getCellId(cell);
  
  cell.setAttribute('data-formula-tokens', JSON.stringify(finalTokens));
  cell.setAttribute('data-formula', compileFormulaForEvaluator(finalTokens, tbl));
  
  window.formulaMode.originalTokens = JSON.parse(JSON.stringify(finalTokens));
  window.formulaMode.tokens = JSON.parse(JSON.stringify(finalTokens));
  
  // Transition to idle
  window.formulaMode.phase = 'idle';
  window.formulaMode.activeSourceIndex = null;
  window.formulaMode.sourceTargetIndex = null;
  window.formulaMode.rangeTokenIndex = null;
  window.formulaMode.sourceVisualMap.clear();
  
  recalculateTableFormulas(tbl);
  
  highlightFormulaSources();
  hideFormulaMenu();
  
  if (typeof handleBodyInput === 'function') {
    handleBodyInput();
  }
  
  // Move down
  const nextCell = adjacentTableCell(tbl, cell, 'ArrowDown');
  if (nextCell) {
    selectCalcuLeafCell(nextCell);
  } else {
    selectCalcuLeafCell(cell);
  }
}

const FORMULA_MENU_CATEGORIES = [
  { name: 'Suggested', items: [ { name: 'SUM', label: 'Sum', sig: '=SUM(range)', desc: 'Sum of cells' }, { name: 'AVERAGE', label: 'Average', sig: '=AVERAGE(range)', desc: 'Average of cells' }, { name: 'COUNT', label: 'Count', sig: '=COUNT(range)', desc: 'Count numeric cells' } ] },
  { name: 'Calculate', items: [ { name: 'ADD', label: 'Add', op: '+' }, { name: 'SUBTRACT', label: 'Subtract', op: '-' }, { name: 'MULTIPLY', label: 'Multiply', op: '*' }, { name: 'DIVIDE', label: 'Divide', op: '/' } ] },
  { name: 'More', items: [ { name: 'MIN', label: 'Minimum', sig: '=MIN(range)', desc: 'Minimum value' }, { name: 'MAX', label: 'Maximum', sig: '=MAX(range)', desc: 'Maximum value' }, { name: 'PRODUCT', label: 'Product', sig: '=PRODUCT(range)', desc: 'Product of cells' }, { name: 'ROUND', label: 'Round', sig: '=ROUND(val, [dec])', desc: 'Round number' }, { name: 'ABS', label: 'Absolute', sig: '=ABS(val)', desc: 'Absolute value' }, { name: 'IF', label: 'IF', sig: '=IF(cond, true, false)', desc: 'Conditional' }, { name: 'IFERROR', label: 'IFERROR', sig: '=IFERROR(val, fallback)', desc: 'Error fallback' } ] }
];

const FORMULA_ICONS = {
  'Suggested': `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m12 3-1.912 5.813a2 2 0 0 1-1.275 1.275L3 12l5.813 1.912a2 2 0 0 1 1.275 1.275L12 21l1.912-5.813a2 2 0 0 1 1.275-1.275L21 12l-5.813-1.912a2 2 0 0 1-1.275-1.275L12 3Z"/></svg>`,
  'Calculate': `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="16" height="20" x="4" y="2" rx="2"/><line x1="8" x2="16" y1="6" y2="6"/><line x1="16" x2="16" y1="14" y2="18"/><path d="M16 10h.01"/><path d="M12 10h.01"/><path d="M8 10h.01"/><path d="M12 14h.01"/><path d="M8 14h.01"/><path d="M12 18h.01"/><path d="M8 18h.01"/></svg>`,
  'More': `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="7" height="7" x="3" y="3" rx="1"/><rect width="7" height="7" x="14" y="3" rx="1"/><rect width="7" height="7" x="14" y="14" rx="1"/><rect width="7" height="7" x="3" y="14" rx="1"/></svg>`,
  'Conditions': `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 3v12"/><path d="M18 9a3 3 0 1 0 0-6 3 3 0 0 0 0 6z"/><path d="M6 21a3 3 0 1 0 0-6 3 3 0 0 0 0 6z"/><path d="M15 6a9 9 0 0 0-9 9"/></svg>`,
  'SUM': `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 7V4H6v16h12v-3"/><path d="M6 4l8 8-8 8"/></svg>`,
  'AVERAGE': `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 3v18h18"/><path d="m19 9-5 5-4-4-3 3"/></svg>`,
  'COUNT': `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="4" x2="20" y1="9" y2="9"/><line x1="4" x2="20" y1="15" y2="15"/><line x1="10" x2="8" y1="3" y2="21"/><line x1="16" x2="14" y1="3" y2="21"/></svg>`,
  'ADD': `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14"/><path d="M12 5v14"/></svg>`,
  'SUBTRACT': `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14"/></svg>`,
  'MULTIPLY': `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>`,
  'DIVIDE': `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="6" r="1"/><line x1="5" x2="19" y1="12" y2="12"/><circle cx="12" cy="18" r="1"/></svg>`,
  'MIN': `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 17V3"/><path d="m6 11 6 6 6-6"/><path d="M19 21H5"/></svg>`,
  'MAX': `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 7v14"/><path d="m18 13-6-6-6 6"/><path d="M5 3h14"/></svg>`,
  'PRODUCT': `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>`,
  'ROUND': `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="2"/></svg>`,
  'ABS': `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8 3v18"/><path d="M16 3v18"/></svg>`,
  'IF': `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3"/></svg>`,
  'IFERROR': `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3"/></svg>`,
};


const FORMULA_LIST_FLAT = FORMULA_MENU_CATEGORIES.flatMap(c => c.items);

let formulaMenuEl = null;
function ensureFormulaMenu() {
  if (!formulaMenuEl) { formulaMenuEl = document.createElement('div'); formulaMenuEl.className = 'formula-autocomplete-menu'; document.body.appendChild(formulaMenuEl); }
  return formulaMenuEl;
}
function hideFormulaMenu() { if (formulaMenuEl) formulaMenuEl.classList.remove('show'); }

function renderFormulaMenu() {
  if (window.formulaMode.phase === 'idle') return;
  const menu = ensureFormulaMenu();
  const isEdit = window.formulaMode.phase === 'edit';
  
  let html = '<div class="formula-bar-ui" style="padding:8px; border-bottom:1px solid var(--border); background:var(--bg); display:flex; gap:4px; flex-wrap:wrap; align-items:center;">';
  html += '<span style="font-weight:bold; color:var(--subtle-text)">ƒ</span>';
  
  const tbl = window.formulaMode.destinationCell?.closest('table');
  window.formulaMode.tokens.forEach((tok, idx) => {
    const colorIdx = window.formulaMode.sourceVisualMap.get(idx);
    const colorClass = colorIdx ? `calculeaf-formula-source-${colorIdx}` : '';
    
    const isEditing = isEdit && idx === window.formulaMode.activeSourceIndex;
    const activeClass = isEditing ? 'formula-token-active' : '';
    
    if (isEditing) {
      html += `<span class="formula-token-cursor" style="display:inline-block; border-left: 2px solid var(--accent, #007bff); height:1.2em; margin-right: 2px; margin-left: 2px; transform: translateY(2px); animation: blink 1s step-end infinite;"></span>`;
    }
    
    if (tok.type === 'cell' || tok.type === 'range') {
      const displayTxt = getFormulaSourceDisplay(tok, tbl);
      let titleTxt = "";
      if (tok.type === 'range' && tok.ids && tok.ids.length > 4) {
         titleTxt = ` title="${escapeFormulaDisplay(tok.ids.map(id => getCellById(tbl, id)?.textContent.trim()).join(', '))}"`;
      }
      html += `<span class="formula-token-chip ${colorClass} ${activeClass}" style="padding:2px 6px; border-radius:4px; font-size:0.85em; cursor:pointer;" data-token-index="${idx}" onmouseenter="window.handleTokenHover(this,true)" onmouseleave="window.handleTokenHover(this,false)" onclick="window.setFormulaActiveToken(${idx}, event)"${titleTxt}>${displayTxt}</span>`;
    } else {
      let label = tok.value;
      if (tok.type === 'function' && tok.value === 'SUM') label = 'SUM';
      html += `<span class="formula-token-text ${activeClass}" style="font-family:monospace; font-size:1.1em; padding:2px; cursor:pointer;" onclick="window.setFormulaActiveToken(${idx}, event)">${label}</span>`;
    }
  });
  
  if (isEdit && window.formulaMode.activeSourceIndex === window.formulaMode.tokens.length) {
    html += `<span class="formula-token-cursor" style="display:inline-block; border-left: 2px solid var(--accent, #007bff); height:1.2em; margin-left: 4px; transform: translateY(2px); animation: blink 1s step-end infinite;"></span>`;
  }
  
  const hasCommittedFormula = window.formulaMode.destinationCell?.hasAttribute('data-formula-tokens');
  if (hasCommittedFormula) {
    html += `<div style="margin-left:auto; display:flex; gap:4px;">`;
    html += `<button onclick="window.clearFormulaCell(window.formulaMode.destinationCell); event.stopPropagation();" title="Clear formula" style="padding:2px 6px; font-size:0.85em; background:var(--subtle); color:var(--fg); border-radius:4px; cursor:pointer; border:none; display:flex; align-items:center; justify-content:center;">`;
    html += `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 6L6 18M6 6l12 12"></path></svg>`;
    html += `</button>`;
    html += `</div>`;
  }
  
  html += '</div>';
  
    if (isEdit) {
    const validation = validateFormulaState(window.formulaMode.tokens, false);
    const color = (validation.status === 'error' || validation.status === 'invalid') ? 'var(--danger, red)' : 'var(--subtle-text)';
    
    if (window.formulaMode.destinationCell) {
      if (validation.status === 'completable') {
        const previewHtml = validation.msg.replace('Preview: ', '');
        window.formulaMode.destinationCell.innerHTML = `<span style="opacity:0.6">${previewHtml}</span>`;
      } else if (window.formulaMode.tokens.length > 0) {
        window.formulaMode.destinationCell.innerHTML = `<span style="opacity:0.6; font-style: italic;">...</span>`;
      } else {
        window.formulaMode.destinationCell.innerHTML = window.formulaMode.originalHTML;
      }
    }
    
    html += `<div class="formula-helper-text" style="color: ${color}; font-size: 0.9em; padding: 4px 8px 8px; border-bottom: 1px solid var(--border);">${validation.msg}</div>`;
    
    const query = window.formulaMode.menuQuery;
    const showMenu = window.formulaMode.tokens.length === 0 || query.length > 0;
    
    if (showMenu) {
      html += '<div class="formula-picker-container">';
      
      if (query) {
        const matches = FORMULA_LIST_FLAT.filter(f => f.name.startsWith(query.toUpperCase()) && f.sig);
        html += '<div class="formula-picker-col" style="padding-top: 8px;">';
        html += matches.map(f => {
            const icon = FORMULA_ICONS[f.name] || '';
            return `<button class="formula-opt" data-func="${f.name}">
              <span class="formula-picker-icon">${icon}</span>
              <span class="formula-picker-label">${f.label || f.name}</span>
            </button>`;
        }).join('');
        html += '</div>';
      } else {
        html += '<div class="formula-picker-grid">';
        
        const leftCol = ['Suggested', 'Calculate'];
        const rightCol = ['More', 'Conditions'];
        
        const renderSection = (catName) => {
          const cat = FORMULA_MENU_CATEGORIES.find(c => c.name === catName);
          if (!cat) return '';
          let secHtml = `<div class="formula-picker-section">`;
          secHtml += `<div class="formula-picker-header">`;
          secHtml += `<span class="formula-picker-header-icon">${FORMULA_ICONS[cat.name] || ''}</span>`;
          secHtml += `<span>${cat.name}</span>`;
          secHtml += `</div>`;
          secHtml += `<div class="formula-picker-header-divider"></div>`;
          
          cat.items.forEach(f => {
            const icon = FORMULA_ICONS[f.name] || '';
            if (f.op) {
              secHtml += `<button class="formula-opt" data-op="${f.op}" data-name="${f.name}">
                <span class="formula-picker-icon">${icon}</span>
                <span class="formula-picker-label">${f.label}</span>
              </button>`;
            } else {
              secHtml += `<button class="formula-opt" data-func="${f.name}">
                <span class="formula-picker-icon">${icon}</span>
                <span class="formula-picker-label">${f.label}</span>
              </button>`;
            }
          });
          secHtml += `</div>`;
          return secHtml;
        };
        
        html += `<div class="formula-picker-col">`;
        leftCol.forEach(c => { html += renderSection(c); });
        html += `</div>`;
        
        html += `<div class="formula-picker-col">`;
        rightCol.forEach(c => { html += renderSection(c); });
        html += `</div>`;
        
        html += '</div>';
      }
      
      html += '</div>';
    }
  }
  
  menu.innerHTML = html;
  menu.classList.add('show');
  
  window.positionFormulaMenu = function(menuEl) {
    if (!window.formulaMode || !window.formulaMode.destinationCell) return;
    const menu = menuEl || document.getElementById('formulaMenu');
    if (!menu || !menu.classList.contains('show')) return;
    
    const rect = window.formulaMode.destinationCell.getBoundingClientRect();
    const margin = 12;
    const gap = 8;
    
    menu.style.maxHeight = 'none';
    
    const naturalHeight = menu.scrollHeight;
    const panelWidth = menu.offsetWidth;
    
    const spaceBelow = window.innerHeight - rect.bottom - margin - gap;
    const spaceAbove = rect.top - margin - gap;
    
    let availableHeight;
    let top;
    
    if (naturalHeight <= spaceBelow) {
      top = rect.bottom + gap;
      availableHeight = naturalHeight;
    }
    else if (naturalHeight <= spaceAbove) {
      top = rect.top - naturalHeight - gap;
      availableHeight = naturalHeight;
    }
    else if (spaceBelow >= spaceAbove) {
      top = rect.bottom + gap;
      availableHeight = spaceBelow;
    }
    else {
      availableHeight = spaceAbove;
      top = margin;
    }
    
    const viewportMaxHeight = window.innerHeight - (margin * 2);
    const finalMaxHeight = Math.min(naturalHeight, availableHeight, viewportMaxHeight);
    
    menu.style.maxHeight = `${finalMaxHeight}px`;
    
    let left = rect.left;
    if (left + panelWidth > window.innerWidth - margin) {
        left = window.innerWidth - panelWidth - margin;
    }
    left = Math.max(margin, left);
    
    menu.style.left = `${left}px`;
    menu.style.top = `${top}px`;
  };
  
  window.positionFormulaMenu(menu);
  
  menu.querySelectorAll('.formula-opt').forEach(btn => {
    btn.onclick = e => {
      e.stopPropagation();
      if (btn.getAttribute('data-func')) applyFormulaFunction(btn.getAttribute('data-func'));
      else if (btn.getAttribute('data-op')) applyFormulaBinaryOp(btn.getAttribute('data-op'));
    };
  });
  
  if (!isEdit) {
    // Menu click no longer edits
  }
}

window.setFormulaActiveToken = function(idx, e) {
  if (e) { e.preventDefault(); e.stopPropagation(); }
  if (window.formulaMode.phase === 'inspect') return;
  window.formulaMode.activeSourceIndex = idx;
  
  const tok = window.formulaMode.tokens[idx];
  if (tok && (tok.type === 'cell' || tok.type === 'range')) {
    window.formulaMode.sourceTargetIndex = idx;
  }
  
  renderFormulaMenu();
};
window.transitionToFormulaEdit = transitionToFormulaEdit;
window.handleTokenHover = handleTokenHover;
window.handleFormulaModeKeydown = handleFormulaModeKeydown;

window.clearFormulaCell = function(cell) {
  if (!cell) return;
  
  cell.innerHTML = '&nbsp;';
  cell.removeAttribute('data-formula');
  cell.removeAttribute('data-formula-tokens');
  cell.classList.remove('calculeaf-formula-destination');
  
  const wasDestination = window.formulaMode.destinationCell === cell;
  
  if (wasDestination) {
    window.formulaMode.phase = 'idle';
    window.formulaMode.destinationCell = null;
    window.formulaMode.originalHTML = '';
    window.formulaMode.originalTokens = [];
    window.formulaMode.tokens = [];
    window.formulaMode.activeSourceIndex = null;
    window.formulaMode.sourceTargetIndex = null;
    window.formulaMode.rangeTokenIndex = null;
    window.formulaMode.sourceVisualMap.clear();
    window.formulaMode.selectingRange = false;
    window.formulaMode.dragAnchor = null;
    window.formulaMode.dragCurrent = null;
    window.formulaMode.menuQuery = '';
    window.formulaMode.pendingBinaryOperator = null;
    
    highlightFormulaSources();
    hideFormulaMenu();
  }
  
  selectOnly(cell, false);
  if (typeof handleBodyInput === 'function') handleBodyInput();
};


function applyFormulaFunction(funcName) {
  window.formulaMode.menuQuery = '';
  insertFormulaToken({ type: 'function', value: funcName.toUpperCase() });
  insertFormulaToken({ type: 'operator', value: '(' });
  renderFormulaMenu();
  highlightFormulaSources();
}

function applyFormulaBinaryOp(op) {
  window.formulaMode.menuQuery = '';
  window.formulaMode.pendingBinaryOperator = op;
  window.formulaMode.sourceTargetIndex = null;
  renderFormulaMenu();
  highlightFormulaSources();
}

function insertFormulaToken(token) {
  if (window.formulaMode.activeSourceIndex !== null && window.formulaMode.activeSourceIndex < window.formulaMode.tokens.length) {
     window.formulaMode.tokens.splice(window.formulaMode.activeSourceIndex, 0, token);
     window.formulaMode.activeSourceIndex++;
  } else {
     window.formulaMode.tokens.push(token);
     window.formulaMode.activeSourceIndex = window.formulaMode.tokens.length;
  }
}

// MUST return true if event was consumed (intercepted), false to let it pass
function handleFormulaModeKeydown(e, tbl) {
  if (window.formulaMode.phase === 'inspect') {
     if (e.key === 'Backspace' || e.key === 'Delete') {
        e.preventDefault(); e.stopPropagation();
        window.clearFormulaCell(window.formulaMode.destinationCell);
        return true;
     }
     if (e.key === 'Escape') {
        cancelFormulaMode();
        return true;
     }
     if (e.key === 'F2') {
        e.preventDefault(); e.stopPropagation();
        return true;
     }
     if (e.key === 'Enter') {
        // Do not enter formula edit, but also do not fall through to rich-text Edit Mode
        e.preventDefault(); e.stopPropagation();
        return true;
     }
     return false; // let normal arrows/keys pass
  }
  
  e.preventDefault(); e.stopPropagation();
  
  if (e.key === 'Escape') { cancelFormulaMode(); return true; }
  if (e.key === 'Enter') { commitFormulaMode(); return true; }
  if (e.key === 'Backspace') {
    if (window.formulaMode.menuQuery.length > 0) window.formulaMode.menuQuery = window.formulaMode.menuQuery.slice(0, -1);
    else {
       if (window.formulaMode.activeSourceIndex !== null && window.formulaMode.activeSourceIndex < window.formulaMode.tokens.length) window.formulaMode.tokens.splice(window.formulaMode.activeSourceIndex, 1);
       else if (window.formulaMode.tokens.length > 0) { window.formulaMode.tokens.pop(); window.formulaMode.activeSourceIndex = window.formulaMode.tokens.length; }
    }
    renderFormulaMenu();
    highlightFormulaSources();
    return true;
  }
  
  if (e.key.length === 1) {
    const char = e.key.toUpperCase();
    if (/[0-9.]/.test(char)) { window.formulaMode.menuQuery = ''; insertFormulaToken({ type: 'literal', value: char }); }
    else if (/[-+*/,%]/.test(char)) { 
       window.formulaMode.menuQuery = ''; 
       window.formulaMode.sourceTargetIndex = null; 
       insertFormulaToken({ type: 'operator', value: char }); 
    }
    else if (char === '(') {
       if (window.formulaMode.menuQuery) {
          const mq = window.formulaMode.menuQuery.toUpperCase();
          const match = FORMULA_LIST_FLAT.find(f => f.name === mq);
          if (match) { window.formulaMode.menuQuery = ''; insertFormulaToken({ type: 'function', value: match.name }); }
          else window.formulaMode.menuQuery = '';
       }
       insertFormulaToken({ type: 'operator', value: char });
    } else if (char === ')') { window.formulaMode.menuQuery = ''; insertFormulaToken({ type: 'operator', value: char }); }
    else if (/[A-Z]/.test(char)) window.formulaMode.menuQuery += char;
    renderFormulaMenu();
    highlightFormulaSources();
  }
  return true;
}

function handleFormulaCellPointerDown(e, cell, type) {
  e.preventDefault(); e.stopPropagation();
  if (!cell || cell === window.formulaMode.destinationCell) return;

  const cellId = getCellId(cell);
  let clickedTokenIdx = -1;
  let clickedRangeIdx = -1;
  let rangeIdIdx = -1;

  for (let i = 0; i < window.formulaMode.tokens.length; i++) {
    const t = window.formulaMode.tokens[i];
    if (t.type === 'cell' && t.id === cellId) {
      clickedTokenIdx = i;
      break;
    } else if (t.type === 'range' && t.ids.includes(cellId)) {
      clickedRangeIdx = i;
      rangeIdIdx = t.ids.indexOf(cellId);
      break;
    }
  }

  if (clickedTokenIdx !== -1) {
    let deleteCount = 1;
    let deleteStart = clickedTokenIdx;
    
    if (clickedTokenIdx > 0) {
      const prev = window.formulaMode.tokens[clickedTokenIdx - 1];
      if (prev.type === 'operator' && ['+','-','*','/'].includes(prev.value)) {
        deleteStart = clickedTokenIdx - 1;
        deleteCount = 2;
      }
    } else if (clickedTokenIdx < window.formulaMode.tokens.length - 1) {
      const next = window.formulaMode.tokens[clickedTokenIdx + 1];
      if (next.type === 'operator' && ['+','-','*','/'].includes(next.value)) {
        deleteCount = 2;
      }
    }
    
    window.formulaMode.tokens.splice(deleteStart, deleteCount);
    
    if (window.formulaMode.activeSourceIndex !== null && window.formulaMode.activeSourceIndex >= deleteStart) {
      window.formulaMode.activeSourceIndex = Math.max(0, window.formulaMode.activeSourceIndex - deleteCount);
    }
    
    if (window.formulaMode.rangeTokenIndex === clickedTokenIdx) window.formulaMode.rangeTokenIndex = null;
    if (window.formulaMode.sourceTargetIndex === clickedTokenIdx) window.formulaMode.sourceTargetIndex = null;
    window.formulaMode.selectingRange = false;
    highlightFormulaSources();
    renderFormulaMenu();
    return;
  }

  if (clickedRangeIdx !== -1) {
    const t = window.formulaMode.tokens[clickedRangeIdx];
    if (rangeIdIdx === 0 || rangeIdIdx === t.ids.length - 1) {
      t.ids.splice(rangeIdIdx, 1);
      if (t.ids.length === 1) {
        window.formulaMode.tokens[clickedRangeIdx] = { type: 'cell', id: t.ids[0] };
      } else if (t.ids.length === 0) {
        window.formulaMode.tokens.splice(clickedRangeIdx, 1);
        if (window.formulaMode.activeSourceIndex !== null && window.formulaMode.activeSourceIndex >= clickedRangeIdx) {
          window.formulaMode.activeSourceIndex = Math.max(0, window.formulaMode.activeSourceIndex - 1);
        }
      }
    }
    window.formulaMode.selectingRange = false;
    highlightFormulaSources();
    renderFormulaMenu();
    return;
  }

  window.formulaMode.selectingRange = true;
  window.formulaMode.dragAnchor = cell;
  window.formulaMode.dragCurrent = cell;
  window.formulaMode.menuQuery = '';
  
  let targetIndex = null;
  
  if (window.formulaMode.pendingBinaryOperator) {
     if (window.formulaMode.tokens.length > 0) insertFormulaToken({ type: 'operator', value: window.formulaMode.pendingBinaryOperator });
     window.formulaMode.pendingBinaryOperator = null;
     window.formulaMode.sourceTargetIndex = null;
  } else {
     const activeIdx = window.formulaMode.activeSourceIndex;
     if (activeIdx !== null && activeIdx > 0) {
        const prevTok = window.formulaMode.tokens[activeIdx - 1];
        if (prevTok && prevTok.type === 'operator' && ['+','-','*','/'].includes(prevTok.value)) {
           window.formulaMode.sourceTargetIndex = null;
        }
     }
     if (window.formulaMode.sourceTargetIndex !== null) {
        targetIndex = window.formulaMode.sourceTargetIndex;
     } else {
        const primary = findPrimaryFormulaSourceIndex(window.formulaMode.tokens);
        if (primary !== -1) {
           targetIndex = primary;
           window.formulaMode.sourceTargetIndex = primary;
        }
     }
  }
  
  if (targetIndex !== null) {
     window.formulaMode.rangeTokenIndex = targetIndex;
     window.formulaMode.tokens[targetIndex] = { type: 'cell', id: getCellId(cell) };
     window.formulaMode.activeSourceIndex = targetIndex + 1; // move cursor past
  } else {
     let insertPos = window.formulaMode.activeSourceIndex !== null ? window.formulaMode.activeSourceIndex : window.formulaMode.tokens.length;
     // insert BEFORE closing parenthesis if at the end of a preset function space
     if (insertPos < window.formulaMode.tokens.length && window.formulaMode.tokens[insertPos].value === ')') {
        // keep insertPos exactly where it is so splice pushes ) forward
     }
     
     window.formulaMode.tokens.splice(insertPos, 0, { type: 'cell', id: getCellId(cell) });
     window.formulaMode.rangeTokenIndex = insertPos;
     window.formulaMode.activeSourceIndex = insertPos + 1;
     window.formulaMode.sourceTargetIndex = window.formulaMode.rangeTokenIndex;
  }
  
  highlightFormulaSources();
  renderFormulaMenu();
}

function handleFormulaCellPointerMove(e) {
  if (!window.formulaMode.selectingRange) return;
  e.preventDefault();
  let cell = null;
  if (e.touches && e.touches.length > 0) cell = document.elementFromPoint(e.touches[0].clientX, e.touches[0].clientY)?.closest('td,th');
  else cell = document.elementFromPoint(e.clientX, e.clientY)?.closest('td,th');
  if (cell && cell !== window.formulaMode.destinationCell && cell.closest('table') === window.formulaMode.destinationCell.closest('table')) {
     if (cell !== window.formulaMode.dragCurrent) {
        window.formulaMode.dragCurrent = cell;
        const tbl = cell.closest('table');
        const rangeSet = cellRange(tbl, window.formulaMode.dragAnchor, window.formulaMode.dragCurrent);
        const ids = Array.from(rangeSet).map(c => getCellId(c)).filter(Boolean);
        if (ids.length > 1) {
           const tokenIdx = window.formulaMode.rangeTokenIndex;
           if (tokenIdx !== null && window.formulaMode.tokens[tokenIdx]) {
              window.formulaMode.tokens[tokenIdx] = { type: 'range', ids: ids };
           }
        }
        highlightFormulaSources();
        renderFormulaMenu();
     }
  }
}

function handleFormulaCellPointerUp(e) {
  if (window.formulaMode.selectingRange) {
     window.formulaMode.selectingRange = false;
     window.formulaMode.dragAnchor = null;
     window.formulaMode.dragCurrent = null;
  }
}

function tblInsertFormula(formulaTpl) {
  if (!activeCell) return;
  startFormulaMode(activeCell, [], true);
}

// Hook global clicks to detect formula cell inspection
document.addEventListener('click', e => {
  const cell = e.target.closest('td,th');
  if (cell && cell.closest('table') && !cell.closest('.formula-autocomplete-menu')) {
    if (window.formulaMode && window.formulaMode.phase === 'edit') return;
    
    if (cell.hasAttribute('data-formula-tokens')) {
       try {
         const tokens = JSON.parse(cell.getAttribute('data-formula-tokens'));
         startFormulaMode(cell, tokens, true); // directly edit
       } catch(ex){}
    }
  }
});

/* ============================================================
   TABLE CONTEXT MENU & SORTING LOGIC
   ============================================================ */

function initTableContextMenu() {
  const ctxMenu = document.getElementById('tblCtxMenu');
  if (!ctxMenu) return;

  // Intercept right click in editor
  const ed = bodyEl();
  if (ed) {
    ed.addEventListener('contextmenu', e => {
      const cell = e.target.closest('td, th');
      if (cell) {
        e.preventDefault();
        
        // If the clicked cell isn't in the selection, make it the active cell
        if (!selectedCells.has(cell)) {
          clearCellSelection();
          activeCell = cell;
          cell.classList.add('tbl-selected');
        }
        
        positionTableTools();

        // Show / hide merge options based on selection
        const mergeBtn = document.getElementById('tblCtxMerge');
        const splitBtn = document.getElementById('tblCtxSplit');
        
        
        const sortButtons = [
            document.querySelector('[data-ctx="tblSortSheetAsc"]'),
            document.querySelector('[data-ctx="tblSortSheetDesc"]'),
            document.querySelector('[data-ctx="tblSortAsc"]'),
            document.querySelector('[data-ctx="tblSortDesc"]')
        ];
        
        const isNumeric = activeCell && (activeCell.getAttribute('data-value-type') === 'number' || activeCell.getAttribute('data-value-type') === 'currency' || activeCell.getAttribute('data-value-type') === 'percentage');
        
        if (sortButtons[0]) {
            sortButtons[0].innerHTML = isNumeric ? '<i data-lucide="arrow-down-0-9" class="w-4 h-4"></i><span class="ctx-text">Sort Sheet (1 to 9)</span>' : '<i data-lucide="arrow-down-a-z" class="w-4 h-4"></i><span class="ctx-text">Sort Sheet (A to Z)</span>';
        }
        if (sortButtons[1]) {
            sortButtons[1].innerHTML = isNumeric ? '<i data-lucide="arrow-up-9-0" class="w-4 h-4"></i><span class="ctx-text">Sort Sheet (9 to 1)</span>' : '<i data-lucide="arrow-up-z-a" class="w-4 h-4"></i><span class="ctx-text">Sort Sheet (Z to A)</span>';
        }
        if (sortButtons[2]) {
            sortButtons[2].innerHTML = isNumeric ? '<i data-lucide="arrow-down-0-9" class="w-4 h-4"></i><span class="ctx-text">Sort Range (1 to 9)</span>' : '<i data-lucide="arrow-down-a-z" class="w-4 h-4"></i><span class="ctx-text">Sort Range (A to Z)</span>';
        }
        if (sortButtons[3]) {
            sortButtons[3].innerHTML = isNumeric ? '<i data-lucide="arrow-up-9-0" class="w-4 h-4"></i><span class="ctx-text">Sort Range (9 to 1)</span>' : '<i data-lucide="arrow-up-z-a" class="w-4 h-4"></i><span class="ctx-text">Sort Range (Z to A)</span>';
        }
        
        if (window.lucide) window.lucide.createIcons();

        if (mergeBtn && splitBtn) {
          if (selectedCells.size > 1) {
            mergeBtn.style.display = 'flex';
            splitBtn.style.display = 'none';
          } else {
            mergeBtn.style.display = 'none';
            const cellSpan = Math.max(Number(cell.colSpan)||1, 1) > 1 || Math.max(Number(cell.rowSpan)||1, 1) > 1;
            splitBtn.style.display = cellSpan ? 'flex' : 'none';
          }
        }

        // Position the menu
        ctxMenu.style.left = `${e.clientX}px`;
        ctxMenu.style.top = `${e.clientY}px`;
        ctxMenu.classList.add('show');
      }
    });
  }

  // Hide context menu on outside click
  document.addEventListener('pointerdown', e => {
    if (!e.target.closest('.tbl-ctx-menu')) {
      ctxMenu.classList.remove('show');
    }
  });
  // Handle menu clicks
  ctxMenu.addEventListener('click', e => {
    // Ignore clicks on submenu openers
    const clickedItem = e.target.closest('.tbl-ctx-item, .tbl-ctx-quick-btn, .tbl-ctx-submenu button');
    if (!clickedItem) return;
    
    // If it's a wrapper that just opens a submenu, do NOT trigger any action and do NOT close the menu
    if (clickedItem.classList.contains('has-submenu')) {
        return;
    }

    const action = clickedItem.getAttribute('data-ctx');

    
    switch (action) {
      case 'tblRowAbove': tblInsertRow('above'); break;
      case 'tblRowBelow': tblInsertRow('below'); break;
      case 'tblColLeft': tblInsertCol('left'); break;
      case 'tblColRight': tblInsertCol('right'); break;
      case 'tblRowDel': tblDeleteRow(); break;
      case 'tblColDel': tblDeleteCol(); break;
      case 'tblClearCell': 
        onSelected(c => c.innerHTML = '<br>');
        break;
      case 'tblMergeCells': tblMergeCells(); break;
      case 'tblSplitCell': tblSplitCell(); break;
    }
    
    positionTableTools();
    const ed = bodyEl();
    if(ed) {
      const evt = new Event('input', { bubbles: true });
      ed.dispatchEvent(evt);
    }
  });
}

function initTableSorting() {
  const ed = bodyEl();
  if(!ed) return;
  
  ed.addEventListener('click', e => {
    const th = e.target.closest('th');
    if(!th) return;
    // CalcuLeafs reserves ordinary click for Cell Select Mode. Sorting will get
    // its own explicit interaction in the data-organization phase.
    if(th.closest('table')?.classList.contains('calculeaf-select-mode')||th.closest('table')?.classList.contains('calculeaf-edit-mode')) return;
    
    const table = th.closest('table');
    if(!table || !table.tBodies || table.tBodies.length === 0) return;
    
    const tbody = table.tBodies[0];
    const row = th.closest('tr');
    
    // Ensure we are clicking a header in the thead
    if(row.parentElement.tagName !== 'THEAD') return;
    
    const colIndex = Array.from(row.children).indexOf(th);
    const isAscending = th.classList.contains('tbl-sort-asc');
    
    // Clear existing sort classes on all headers
    table.querySelectorAll('th').forEach(el => {
      el.classList.remove('tbl-sort-asc', 'tbl-sort-desc');
    });
    
    // Toggle sort direction
    const direction = isAscending ? -1 : 1;
    th.classList.add(isAscending ? 'tbl-sort-desc' : 'tbl-sort-asc');
    
    const rows = Array.from(tbody.querySelectorAll('tr'));
    
    rows.sort((a, b) => {
      const aCol = a.children[colIndex];
      const bCol = b.children[colIndex];
      
      const numA = aCol ? getCalcuLeafNumericValue(aCol) : null;
      const numB = bCol ? getCalcuLeafNumericValue(bCol) : null;
      
      if (numA !== null && numB !== null) {
        return (numA - numB) * direction;
      }
      
      const aText = aCol ? aCol.textContent.trim() : '';
      const bText = bCol ? bCol.textContent.trim() : '';
      
      return aText.localeCompare(bText) * direction;
    });
    
    // Re-append sorted rows
    rows.forEach(r => tbody.appendChild(r));
    
    const evt = new Event('input', { bubbles: true });
    ed.dispatchEvent(evt);
  });
}

// Call on load
document.addEventListener('DOMContentLoaded', () => {
  initTableContextMenu();
  initTableSorting();
});

window.addEventListener('resize', () => {
  if (window.positionFormulaMenu) window.positionFormulaMenu();
});
document.addEventListener('scroll', (e) => {
  // don't reposition if scrolling inside the menu itself
  if (e.target && e.target.closest && e.target.closest('.formula-autocomplete-menu')) return;
  if (window.positionFormulaMenu) window.positionFormulaMenu();
}, true);


const TABLE_TEMPLATES = {
  invoice: `
    <h2>Invoice</h2>
    <p>Date: _____ | Invoice #: _____</p>
    <div class="table-wrapper" data-table-wrapper="1" contenteditable="false">
      <table class="calculeaf-table tbl-theme-grayscale" contenteditable="true">
        <thead>
          <tr>
            <th style="width:40%">Description</th>
            <th style="width:15%">Qty</th>
            <th style="width:20%">Unit Price</th>
            <th style="width:25%">Total</th>
          </tr>
        </thead>
        <tbody>
          <tr><td>Consulting Hours</td><td data-value-type="number">10</td><td data-value-type="currency">150.00</td><td data-value-type="currency">=B1*C1</td></tr>
          <tr><td>Software License</td><td data-value-type="number">1</td><td data-value-type="currency">499.00</td><td data-value-type="currency">=B2*C2</td></tr>
          <tr><td>Server Setup</td><td data-value-type="number">2</td><td data-value-type="currency">250.00</td><td data-value-type="currency">=B3*C3</td></tr>
          <tr><td colspan="3" style="text-align:right"><b>Subtotal</b></td><td data-value-type="currency">=SUM(D1:D3)</td></tr>
          <tr><td colspan="3" style="text-align:right"><b>Tax (8%)</b></td><td data-value-type="currency">=D4*0.08</td></tr>
          <tr><td colspan="3" style="text-align:right"><b>Grand Total</b></td><td data-value-type="currency" style="font-weight:bold">=D4+D5</td></tr>
        </tbody>
      </table>
    </div>
    <p>Authorized by: ________________________</p><p><br></p>
  `,
  budget: `
    <h2>Monthly Budget</h2>
    <p>Month: _____</p>
    <div class="table-wrapper" data-table-wrapper="1" contenteditable="false">
      <table class="calculeaf-table tbl-theme-grayscale" contenteditable="true">
        <thead>
          <tr>
            <th style="width:30%">Category</th>
            <th style="width:20%">Planned</th>
            <th style="width:20%">Actual</th>
            <th style="width:30%">Variance</th>
          </tr>
        </thead>
        <tbody>
          <tr><td>Housing</td><td data-value-type="currency">1500</td><td data-value-type="currency">1500</td><td data-value-type="currency">=B1-C1</td></tr>
          <tr><td>Groceries</td><td data-value-type="currency">400</td><td data-value-type="currency">520</td><td data-value-type="currency">=B2-C2</td></tr>
          <tr><td>Transport</td><td data-value-type="currency">200</td><td data-value-type="currency">150</td><td data-value-type="currency">=B3-C3</td></tr>
          <tr><td><b>Totals</b></td><td data-value-type="currency">=SUM(B1:B3)</td><td data-value-type="currency">=SUM(C1:C3)</td><td data-value-type="currency">=B4-C4</td></tr>
        </tbody>
      </table>
    </div>
    <p>Notes: ________________________</p><p><br></p>
  `,
  timesheet: `
    <h2>Weekly Timesheet</h2>
    <p>Employee: _____ | Week Ending: _____</p>
    <div class="table-wrapper" data-table-wrapper="1" contenteditable="false">
      <table class="calculeaf-table tbl-theme-grayscale" contenteditable="true">
        <thead>
          <tr>
            <th style="width:25%">Day</th>
            <th style="width:20%">Regular Hrs</th>
            <th style="width:20%">Overtime Hrs</th>
            <th style="width:35%">Daily Pay ($25/hr, 1.5x OT)</th>
          </tr>
        </thead>
        <tbody>
          <tr><td>Monday</td><td data-value-type="number">8</td><td data-value-type="number">0</td><td data-value-type="currency">=(B1*25)+(C1*37.5)</td></tr>
          <tr><td>Tuesday</td><td data-value-type="number">8</td><td data-value-type="number">2.5</td><td data-value-type="currency">=(B2*25)+(C2*37.5)</td></tr>
          <tr><td>Wednesday</td><td data-value-type="number">8</td><td data-value-type="number">1</td><td data-value-type="currency">=(B3*25)+(C3*37.5)</td></tr>
          <tr><td><b>Total</b></td><td data-value-type="number">=SUM(B1:B3)</td><td data-value-type="number">=SUM(C1:C3)</td><td data-value-type="currency">=SUM(D1:D3)</td></tr>
        </tbody>
      </table>
    </div>
    <p>Signature: ________________________</p><p><br></p>
  `,
  inventory: `
    <h2>Inventory Status</h2>
    <p>Date Checked: _____ | Location: _____</p>
    <div class="table-wrapper" data-table-wrapper="1" contenteditable="false">
      <table class="calculeaf-table tbl-theme-grayscale" contenteditable="true">
        <thead>
          <tr>
            <th style="width:40%">Item Name</th>
            <th style="width:15%">In Stock</th>
            <th style="width:15%">Unit Cost</th>
            <th style="width:30%">Total Value</th>
          </tr>
        </thead>
        <tbody>
          <tr><td>Wireless Mouse</td><td data-value-type="number">45</td><td data-value-type="currency">15.50</td><td data-value-type="currency">=B1*C1</td></tr>
          <tr><td>Mechanical Keyboard</td><td data-value-type="number">12</td><td data-value-type="currency">85.00</td><td data-value-type="currency">=B2*C2</td></tr>
          <tr><td>USB-C Hub</td><td data-value-type="number">8</td><td data-value-type="currency">24.99</td><td data-value-type="currency">=B3*C3</td></tr>
          <tr><td><b>Total Assets</b></td><td></td><td></td><td data-value-type="currency">=SUM(D1:D3)</td></tr>
        </tbody>
      </table>
    </div>
    <p>Checked by: ________________________</p><p><br></p>
  `,
  schools: `
    <h2>Target Schools Planner</h2>
    <p>Student: _____ | Term: _____</p>
    <div class="table-wrapper" data-table-wrapper="1" contenteditable="false">
      <table class="calculeaf-table tbl-theme-grayscale" contenteditable="true">
        <thead>
          <tr>
            <th style="width:30%">University</th>
            <th style="width:20%">App Fee</th>
            <th style="width:20%">Tuition</th>
            <th style="width:30%">Total Cost 1st Yr</th>
          </tr>
        </thead>
        <tbody>
          <tr><td>State College</td><td data-value-type="currency">50</td><td data-value-type="currency">12000</td><td data-value-type="currency">=B1+C1</td></tr>
          <tr><td>Tech Institute</td><td data-value-type="currency">75</td><td data-value-type="currency">34000</td><td data-value-type="currency">=B2+C2</td></tr>
          <tr><td>Ivy League U</td><td data-value-type="currency">90</td><td data-value-type="currency">58000</td><td data-value-type="currency">=B3+C3</td></tr>
        </tbody>
      </table>
    </div>
    <p>Notes: ________________________</p><p><br></p>
  `,
  home: `
    <h2>Home Project Estimator</h2>
    <p>Project: _____ | Year: _____</p>
    <div class="table-wrapper" data-table-wrapper="1" contenteditable="false">
      <table class="calculeaf-table tbl-theme-grayscale" contenteditable="true">
        <thead>
          <tr>
            <th style="width:40%">Material/Labor</th>
            <th style="width:20%">Est. Cost</th>
            <th style="width:20%">Actual Cost</th>
            <th style="width:20%">Over/Under</th>
          </tr>
        </thead>
        <tbody>
          <tr><td>Lumber</td><td data-value-type="currency">400</td><td data-value-type="currency">450</td><td data-value-type="currency">=B1-C1</td></tr>
          <tr><td>Paint & Primer</td><td data-value-type="currency">120</td><td data-value-type="currency">110</td><td data-value-type="currency">=B2-C2</td></tr>
          <tr><td>Labor (20hrs)</td><td data-value-type="currency">1000</td><td data-value-type="currency">1250</td><td data-value-type="currency">=B3-C3</td></tr>
          <tr><td><b>Totals</b></td><td data-value-type="currency">=SUM(B1:B3)</td><td data-value-type="currency">=SUM(C1:C3)</td><td data-value-type="currency">=SUM(D1:D3)</td></tr>
        </tbody>
      </table>
    </div>
    <p>Owner: ________________________</p><p><br></p>
  `,
  lending: `
    <h2>Lending Tracker (Amortization)</h2>
    <p>Borrower: _____ | Start Date: _____</p>
    <div class="table-wrapper" data-table-wrapper="1" contenteditable="false">
      <table class="calculeaf-table tbl-theme-grayscale" contenteditable="true">
        <thead>
          <tr>
            <th style="width:25%">Month</th>
            <th style="width:25%">Starting Bal</th>
            <th style="width:25%">Repayment</th>
            <th style="width:25%">Ending Bal (+5% Int)</th>
          </tr>
        </thead>
        <tbody>
          <tr><td>Jan</td><td data-value-type="currency">5000</td><td data-value-type="currency">500</td><td data-value-type="currency">=(B1-C1)*1.05</td></tr>
          <tr><td>Feb</td><td data-value-type="currency">=D1</td><td data-value-type="currency">500</td><td data-value-type="currency">=(B2-C2)*1.05</td></tr>
          <tr><td>Mar</td><td data-value-type="currency">=D2</td><td data-value-type="currency">500</td><td data-value-type="currency">=(B3-C3)*1.05</td></tr>
        </tbody>
      </table>
    </div>
    <p>Signatures: ________________________</p><p><br></p>
  `,
  recipe: `
    <h2>Recipe Cost Scaler</h2>
    <p>Dish: _____ | Prep Time: _____</p>
    <div class="table-wrapper" data-table-wrapper="1" contenteditable="false">
      <table class="calculeaf-table tbl-theme-grayscale" contenteditable="true">
        <thead>
          <tr>
            <th style="width:40%">Ingredient</th>
            <th style="width:20%">Base Qty (1x)</th>
            <th style="width:20%">Scale Factor</th>
            <th style="width:20%">New Qty</th>
          </tr>
        </thead>
        <tbody>
          <tr><td>Flour (cups)</td><td data-value-type="number">2.5</td><td data-value-type="number">3</td><td data-value-type="number">=B1*C1</td></tr>
          <tr><td>Sugar (cups)</td><td data-value-type="number">1</td><td data-value-type="number">=C1</td><td data-value-type="number">=B2*C2</td></tr>
          <tr><td>Butter (tbsp)</td><td data-value-type="number">8</td><td data-value-type="number">=C1</td><td data-value-type="number">=B3*C3</td></tr>
        </tbody>
      </table>
    </div>
    <p>Instructions: ________________________</p><p><br></p>
  `,
  agenda: `
    <h2>Event Catering Budget</h2>
    <p>Event: _____ | Date: _____</p>
    <div class="table-wrapper" data-table-wrapper="1" contenteditable="false">
      <table class="calculeaf-table tbl-theme-grayscale" contenteditable="true">
        <thead>
          <tr>
            <th style="width:40%">Expense Type</th>
            <th style="width:20%">Guests</th>
            <th style="width:20%">Cost/Head</th>
            <th style="width:20%">Total</th>
          </tr>
        </thead>
        <tbody>
          <tr><td>Appetizers</td><td data-value-type="number">150</td><td data-value-type="currency">12.50</td><td data-value-type="currency">=B1*C1</td></tr>
          <tr><td>Main Course</td><td data-value-type="number">150</td><td data-value-type="currency">35.00</td><td data-value-type="currency">=B2*C2</td></tr>
          <tr><td>Drinks & Bar</td><td data-value-type="number">150</td><td data-value-type="currency">22.00</td><td data-value-type="currency">=B3*C3</td></tr>
          <tr><td><b>Grand Total</b></td><td></td><td></td><td data-value-type="currency">=SUM(D1:D3)</td></tr>
        </tbody>
      </table>
    </div>
    <p>Approved by: ________________________</p><p><br></p>
  `
};


window.insertTableTemplate = function(tplId) {
  const html = TABLE_TEMPLATES[tplId];
  if (!html) return;
  insertHTMLAtCaret(html);
  toast(`Inserted ${tplId} template`);
  document.getElementById('tblTemplateModal')?.classList.remove('show');
  
  if(typeof window.refreshCalcuLeaf === 'function'){
    window.refreshCalcuLeaf();
  }
};


window.renderTemplatesGrid = function() {
  const grid = document.getElementById('templateGrid');
  if (!grid || grid.dataset.built === '1') return;
  
  const templatesInfo = [
    { id: 'invoice', name: 'Invoice', icon: 'file-spreadsheet', desc: 'Billed items & total' },
    { id: 'budget', name: 'Budget', icon: 'wallet', desc: 'Planned vs Actual' },
    { id: 'timesheet', name: 'Timesheet', icon: 'clock', desc: 'Weekly hours tracking' },
    { id: 'inventory', name: 'Inventory', icon: 'package', desc: 'Stock levels' },
    { id: 'schools', name: 'Schools', icon: 'graduation-cap', desc: 'College tracker' },
    { id: 'home', name: 'Home Log', icon: 'home', desc: 'Maintenance schedule' },
    { id: 'lending', name: 'Lending', icon: 'hand-coins', desc: 'Loan repayments' },
    { id: 'recipe', name: 'Recipe', icon: 'utensils', desc: 'Ingredients list' },
    { id: 'agenda', name: 'Agenda', icon: 'calendar', desc: 'Meeting itinerary' }
  ];
  
  let html = '';
  for (const t of templatesInfo) {
    html += `
      <button class="template-card" onclick="insertTableTemplate('${t.id}')">
        <div class="tc-icon"><i data-lucide="${t.icon}"></i></div>
        <div class="tc-info">
          <span class="tc-name">${t.name}</span>
          <span class="tc-desc">${t.desc}</span>
        </div>
      </button>
    `;
  }
  
  grid.innerHTML = html;
  grid.dataset.built = '1';
  if (typeof refreshIcons === 'function') refreshIcons();
};

document.addEventListener('DOMContentLoaded', () => {
  const mainTplBtn = document.getElementById('mainTemplateBtn');
  if(mainTplBtn) {
    mainTplBtn.addEventListener('click', e => {
      e.preventDefault();
      e.stopPropagation();
      document.getElementById('tblTemplateModal')?.classList.add('show');
      renderTemplatesGrid();
    });
  }
});
