with open(r'c:\Users\ASITSD\Documents\GitHub\Paperuss-2.0\js\tables.js', 'r', encoding='utf-8') as f:
    text = f.read()

# 1. Update getCellValue to getCalcuLeafNumericValue
oldGetCell = '''function getCellValue(cell) {
  if (cell.hasAttribute('data-value')) {
    const val = parseFloat(cell.getAttribute('data-value'));
    return isNaN(val) ? 0 : val;
  }
  let txt = cell.textContent.replace(/[^0-9.\\-()]/g, '');
  if (cell.textContent.includes('(') && cell.textContent.includes(')')) txt = '-' + txt.replace(/[()]/g, '');
  const val = parseFloat(txt);
  return isNaN(val) ? 0 : val;
}'''

newGetCell = '''function getCalcuLeafNumericValue(cell) {
  const type = cell.getAttribute('data-value-type');
  const raw = cell.getAttribute('data-value');

  if (raw !== null && (type === 'number' || type === 'currency' || type === 'percentage')) {
    const value = Number(raw);
    if (Number.isFinite(value)) {
      return value;
    }
  }

  let txt = cell.textContent.replace(/[^0-9.\\-()]/g, '');
  if (cell.textContent.includes('(') && cell.textContent.includes(')')) txt = '-' + txt.replace(/[()]/g, '');
  const val = parseFloat(txt);
  return isNaN(val) ? 0 : val;
}'''

text = text.replace(oldGetCell, newGetCell)
text = text.replace('getCellValue', 'getCalcuLeafNumericValue')

# 2. Update validateFormulaState
oldValidateStr = '''  return { status: 'completable', msg: \Preview: \\, result: result };'''
newValidateStr = '''  let formattedResult = formatNumber(result);
  if (typeof result === 'number') {
    const resultModel = inferFormulaResultValueModel(checkTokens, tbl, result);
    formattedResult = formatCalcuLeafValue(resultModel);
  }
  return { status: 'completable', msg: \Preview: \\, result: result };'''
text = text.replace(oldValidateStr, newValidateStr)

# 3. Update handleFormulaCellPointerDown
oldPointerDownStart = text.find('function handleFormulaCellPointerDown(e, cell, type) {')
oldPointerDownEnd = text.find('  window.formulaMode.selectingRange = true;', oldPointerDownStart)
oldPointerDownStr = text[oldPointerDownStart:oldPointerDownEnd]

newPointerDownStr = '''function handleFormulaCellPointerDown(e, cell, type) {
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
    window.formulaMode.tokens.splice(clickedTokenIdx, 1);
    if (window.formulaMode.activeSourceIndex !== null && window.formulaMode.activeSourceIndex >= clickedTokenIdx) {
      window.formulaMode.activeSourceIndex = Math.max(0, window.formulaMode.activeSourceIndex - 1);
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

'''

text = text.replace(oldPointerDownStr, newPointerDownStr)

with open(r'c:\Users\ASITSD\Documents\GitHub\Paperuss-2.0\js\tables.js', 'w', encoding='utf-8') as f:
    f.write(text)
    print('Patched successfully')
