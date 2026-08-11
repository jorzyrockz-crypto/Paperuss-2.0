import codecs
with codecs.open('js/tables.js', 'r', encoding='utf-8', errors='ignore') as f:
    content = f.read()

painter_code = """
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
"""

if 'let formatPainterState = null;' not in content:
    content = content.replace('function toggleCellBorder(){', painter_code + '\\nfunction toggleCellBorder(){')

new_map_entries = """
    tblFmtPaint: startFormatPainter,
"""

if 'tblFmtPaint:' not in content:
    content = content.replace('tblDel:tblDelete', new_map_entries + '    tblDel:tblDelete')

mousedown_handler_mod = """
    if (formatPainterState) {
        applyFormatPainter(cell);
        e.preventDefault();
        e.stopPropagation();
        return;
    }
"""

if 'if (formatPainterState) {' not in content:
    content = content.replace('if(!cellInEditor(cell)) return;\\n    if (window.formulaMode', 'if(!cellInEditor(cell)) return;\\n' + mousedown_handler_mod + '    if (window.formulaMode')

with codecs.open('js/tables.js', 'w', encoding='utf-8') as f:
    f.write(content)
print('Format painter added!')
