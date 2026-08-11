with open(r'c:\Users\ASITSD\Documents\GitHub\Paperuss-2.0\js\tables.js', 'r', encoding='utf-8') as f:
    text = f.read()

# 1. Update inferFormulaResultValueModel to handle multiple operands for +/-
old_op_logic = '''  // Simple operators
  if (opTokens.length === 1 && operands.length === 2) {
    const op = opTokens[0].value;
    const left = operands[0];
    const right = operands[1];

    if (op === '+' || op === '-') {
      if (left.type === 'currency' && right.type === 'currency' && left.currency === right.currency) {
        return { type: 'currency', value: numericResult, currency: left.currency };
      }
      if (left.type === 'percentage' && right.type === 'percentage') {
        return { type: 'percentage', value: numericResult };
      }
      return { type: 'number', value: numericResult };
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
  }'''

new_op_logic = '''  // Simple operators
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
    
    if (op === '*') {
      if (left.type === 'currency' && right.type === 'number') return { type: 'currency', value: numericResult, currency: left.currency };
      if (left.type === 'number' && right.type === 'currency') return { type: 'currency', value: numericResult, currency: right.currency };
      return { type: 'number', value: numericResult };
    }
    
    if (op === '/') {
      if (left.type === 'currency' && right.type === 'number') return { type: 'currency', value: numericResult, currency: left.currency };
      return { type: 'number', value: numericResult };
    }
  }'''

text = text.replace(old_op_logic, new_op_logic)

# 2. Update toggle to remove adjacent operator
old_toggle = '''  if (clickedTokenIdx !== -1) {
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
  }'''

new_toggle = '''  if (clickedTokenIdx !== -1) {
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
  }'''

text = text.replace(old_toggle, new_toggle)

with open(r'c:\Users\ASITSD\Documents\GitHub\Paperuss-2.0\js\tables.js', 'w', encoding='utf-8') as f:
    f.write(text)
    print('Patched tables.js')
