import re

with open(r'c:\Users\ASITSD\Documents\GitHub\Paperuss-2.0\js\tables.js', 'r', encoding='utf-8') as f:
    text = f.read()

# 1. Add parseCalcuLeafValue and formatCalcuLeafValue above formatNumber
val_model_code = '''/* ============================================================
   SMART VALUE METADATA (Agenda 5A)
   ============================================================ */

function parseCalcuLeafValue(htmlStr) {
  const temp = document.createElement('div');
  temp.innerHTML = htmlStr;
  const text = temp.textContent.trim();
  
  if (!text) return { type: 'text', value: text };

  // Percentage
  const pctMatch = text.match(/^(-?[\\d,]+(?:\\.\\d+)?)\\s*%$/);
  if (pctMatch) {
    const numericStr = pctMatch[1].replace(/,/g, '');
    const num = parseFloat(numericStr);
    if (!isNaN(num)) {
      return { type: 'percentage', value: num / 100 };
    }
  }
  
  // Currency
  const currencyMatch = text.match(/^([?$€£¥])\\s*(-?[\\d,]+(?:\\.\\d+)?)$/);
  if (currencyMatch) {
    const symbol = currencyMatch[1];
    const numericStr = currencyMatch[2].replace(/,/g, '');
    const num = parseFloat(numericStr);
    if (!isNaN(num)) {
      const map = { '?': 'PHP', '$': 'USD', '€': 'EUR', '£': 'GBP', '¥': 'JPY' };
      return { type: 'currency', value: num, currency: map[symbol] };
    }
  }
  
  // Plain number
  const numMatch = text.match(/^-?[\\d,]+(?:\\.\\d+)?$/);
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
    const rmap = { 'PHP': '?', 'USD': '$', 'EUR': '€', 'GBP': '£', 'JPY': '¥' };
    const sym = rmap[metadata.currency] || '$';
    return formatCurrency(metadata.value, sym);
  }
  return metadata.value;
}

function inferFormulaResultValueModel(tokens, tbl, numericResult) {
  let currencies = new Set();
  let hasPercentage = false;
  let hasCurrency = false;
  let hasNumber = false;

  for (let tok of tokens) {
    if (tok.type === 'cell') {
      const cell = document.getElementById(tok.id);
      if (cell) {
        const type = cell.getAttribute('data-value-type');
        if (type === 'currency') {
          hasCurrency = true;
          currencies.add(cell.getAttribute('data-currency') || '');
        } else if (type === 'percentage') {
          hasPercentage = true;
        } else if (type === 'number') {
          hasNumber = true;
        }
      }
    } else if (tok.type === 'range') {
      for (let id of tok.ids) {
        const cell = document.getElementById(id);
        if (cell) {
          const type = cell.getAttribute('data-value-type');
          if (type === 'currency') {
            hasCurrency = true;
            currencies.add(cell.getAttribute('data-currency') || '');
          } else if (type === 'percentage') {
            hasPercentage = true;
          } else if (type === 'number') {
            hasNumber = true;
          }
        }
      }
    }
  }

  if (hasCurrency && currencies.size === 1 && !hasPercentage) {
    return { type: 'currency', value: numericResult, currency: Array.from(currencies)[0] };
  }
  
  if (hasPercentage && !hasCurrency && !hasNumber) {
    return { type: 'percentage', value: numericResult };
  }
  
  return { type: 'number', value: numericResult };
}
'''
text = text.replace('function formatNumber', val_model_code + 'function formatNumber')

# 2. Update exitCalcuLeafEditMode
old_exit = '''function exitCalcuLeafEditMode(focusEditor=true){
  if(tableEditCell){
    const tbl=tableEditCell.closest('table');
    tableEditCell.classList.remove('tbl-editing');
    tableEditCell.removeAttribute('contenteditable');
    tableEditCell.removeAttribute('tabindex');
    tbl?.classList.remove('calculeaf-edit-mode');
    tableEditCell=null;
  }
  if(focusEditor) focusCalcuLeafSelection();
  highlightSelected();
}'''

new_exit = '''function exitCalcuLeafEditMode(focusEditor=true){
  if(tableEditCell){
    const tbl=tableEditCell.closest('table');
    tableEditCell.classList.remove('tbl-editing');
    tableEditCell.removeAttribute('contenteditable');
    tableEditCell.removeAttribute('tabindex');
    tbl?.classList.remove('calculeaf-edit-mode');
    
    // Clear stale metadata
    tableEditCell.removeAttribute('data-value-type');
    tableEditCell.removeAttribute('data-value');
    tableEditCell.removeAttribute('data-currency');
    
    if (!tableEditCell.hasAttribute('data-formula-tokens')) {
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
}'''
text = text.replace(old_exit, new_exit)

# 3. Update getCellValue
old_get_cell = '''function getCellValue(cell) {
  let txt = cell.textContent.replace(/[^0-9.\\-()]/g, '');
  if (cell.textContent.includes('(') && cell.textContent.includes(')')) txt = '-' + txt.replace(/[()]/g, '');
  const val = parseFloat(txt);
  return isNaN(val) ? 0 : val;
}'''

new_get_cell = '''function getCellValue(cell) {
  if (cell.hasAttribute('data-value')) {
    const val = parseFloat(cell.getAttribute('data-value'));
    return isNaN(val) ? 0 : val;
  }
  let txt = cell.textContent.replace(/[^0-9.\\-()]/g, '');
  if (cell.textContent.includes('(') && cell.textContent.includes(')')) txt = '-' + txt.replace(/[()]/g, '');
  const val = parseFloat(txt);
  return isNaN(val) ? 0 : val;
}'''
text = text.replace(old_get_cell, new_get_cell)

# 4. Update recalculateTableFormulas
old_recalc_start = text.find('function recalculateTableFormulas(')
old_recalc_end = text.find('}', text.find('cell.innerHTML = output;', old_recalc_start)) + 15

if old_recalc_start != -1:
    old_recalc = text[old_recalc_start:old_recalc_end]
    new_recalc = '''function recalculateTableFormulas(tbl) {
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
          
          if (typeof result === 'number') {
            const resultModel = inferFormulaResultValueModel(tokens, tbl, result);
            cell.setAttribute('data-value-type', resultModel.type);
            cell.setAttribute('data-value', resultModel.value);
            if (resultModel.currency) {
                cell.setAttribute('data-currency', resultModel.currency);
            } else {
                cell.removeAttribute('data-currency');
            }
            cell.innerHTML = formatCalcuLeafValue(resultModel);
          } else {
            cell.innerHTML = result;
          }
        } catch(e) {}
      }
    });
  }
}'''
    text = text.replace(old_recalc, new_recalc)

with open(r'c:\Users\ASITSD\Documents\GitHub\Paperuss-2.0\js\tables.js', 'w', encoding='utf-8') as f:
    f.write(text)
    print("Patched tables.js")

