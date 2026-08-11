import codecs

with codecs.open('js/tables.js', 'r', encoding='utf-8', errors='ignore') as f:
    content = f.read()

sort_code = """
function tblSort(direction, scope) {
    if(!activeCell) return;
    const tbl = currentTable();
    if(!tbl || !tbl.tBodies || !tbl.tBodies[0]) return;
    
    const tbody = tbl.tBodies[0];
    const positions = tableCellLayout(tbl);
    const activePos = positions.get(activeCell);
    if(!activePos) return;
    const sortCol = activePos.colStart;
    
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
"""

if 'function tblSort(' not in content:
    content = content.replace('function toggleCellBorder(){', sort_code + '\\nfunction toggleCellBorder(){')

new_map_entries = """
    tblSortAsc: ()=>tblSort(1, 'selection'),
    tblSortDesc: ()=>tblSort(-1, 'selection'),
    tblSortSheetAsc: ()=>tblSort(1, 'sheet'),
    tblSortSheetDesc: ()=>tblSort(-1, 'sheet'),
    tblFillColor: toggleTblColorPicker,
"""

if 'tblSortAsc:' not in content:
    content = content.replace('tblDel:tblDelete', new_map_entries + '    tblDel:tblDelete')

with codecs.open('js/tables.js', 'w', encoding='utf-8') as f:
    f.write(content)
print('Phase 3 added!')
