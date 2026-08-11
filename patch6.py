import codecs
with codecs.open('js/tables.js', 'r', encoding='utf-8', errors='ignore') as f:
    content = f.read()

format_code = """
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
"""

if 'function setCellFormat(' not in content:
    content = content.replace('function toggleCellBorder(){', format_code + '\\nfunction toggleCellBorder(){')

# Replace the mismatched IDs in actionMap
content = content.replace("tblFmtNone:()=>setCellFormat('number')", "tblFmtPlain:()=>setCellFormat('number')")
content = content.replace("tblFmtUsd:()=>setCellFormat('currency','$')", "tblFmtCurUSD:()=>setCellFormat('currency','$')")
content = content.replace("tblFmtEur:()=>setCellFormat('currency','€')", "tblFmtCurEUR:()=>setCellFormat('currency','€')")
content = content.replace("tblFmtGbp:()=>setCellFormat('currency','£')", "tblFmtCurGBP:()=>setCellFormat('currency','£')")
content = content.replace("tblFmtJpy:()=>setCellFormat('currency','¥')", "tblFmtCurJPY:()=>setCellFormat('currency','¥')")
content = content.replace("tblFmtPhp:()=>setCellFormat('currency','₱')", "tblFmtCurPHP:()=>setCellFormat('currency','₱')")
content = content.replace("tblFmtPct:()=>setCellFormat('percent')", "tblFmtPercent:()=>setCellFormat('percentage')")

new_map_entries = """
    tblFmtComma: ()=>setCellFormat('number'),
    tblFmtDecInc: ()=>adjustDecimals(1),
    tblFmtDecDec: ()=>adjustDecimals(-1),
    tblDateMDY: ()=>setCellFormat('date', 'MDY'),
    tblDateDMY: ()=>setCellFormat('date', 'DMY'),
    tblDateISO: ()=>setCellFormat('date', 'ISO'),
    tblDateLong: ()=>setCellFormat('date', 'Long'),
    tblDateShortTxt: ()=>setCellFormat('date', 'ShortTxt'),
"""

if 'tblFmtDecInc:' not in content:
    content = content.replace('tblDel:tblDelete', new_map_entries + '    tblDel:tblDelete')

with codecs.open('js/tables.js', 'w', encoding='utf-8') as f:
    f.write(content)
print('Metadata formatting added!')
