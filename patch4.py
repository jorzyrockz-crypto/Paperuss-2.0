import codecs
with codecs.open('js/tables.js', 'r', encoding='utf-8', errors='ignore') as f:
    content = f.read()

clipboard_code = """
async function tblCopy() {
    if(selectedCells.size===0 && !activeCell) return;
    const cells = selectedCells.size > 0 ? [...selectedCells] : [activeCell];
    const html = cells.map(c => c.outerHTML).join('');
    const text = cells.map(c => c.textContent).join('\\t');
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
"""

if 'async function tblCopy' not in content:
    content = content.replace('function toggleCellBorder(){', clipboard_code + '\\nfunction toggleCellBorder(){')

new_map_entries = """
    tblCut: tblCut,
    tblCopy: tblCopy,
    tblPaste: tblPaste,
    tblPasteVal: tblPasteVal,
"""

if 'tblCut:' not in content:
    content = content.replace('tblDel:tblDelete', new_map_entries + '    tblDel:tblDelete')

key_handling_code = """
    if(!tableEditCell && activeCell && (e.ctrlKey || e.metaKey)) {
        if (e.key === 'c' || e.key === 'C') {
            e.preventDefault();
            tblCopy();
            return;
        }
        if (e.key === 'x' || e.key === 'X') {
            e.preventDefault();
            tblCut();
            return;
        }
        if (e.key === 'v' || e.key === 'V') {
            e.preventDefault();
            if (e.shiftKey) tblPasteVal();
            else tblPaste();
            return;
        }
    }
"""

if 'tblCopy();' not in content:
    content = content.replace('if(!tbl||!activeCell) return;', 'if(!tbl||!activeCell) return;\\n' + key_handling_code)

with codecs.open('js/tables.js', 'w', encoding='utf-8') as f:
    f.write(content)
print('Clipboard operations added!')
