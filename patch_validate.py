with open(r'c:\Users\ASITSD\Documents\GitHub\Paperuss-2.0\js\tables.js', 'r', encoding='utf-8') as f:
    text = f.read()

old_validate = '''  if (expr.endsWith('()') && checkTokens[checkTokens.length-1].value === ')') return { status: 'invalid', msg: 'Choose at least one cell to add.' };
  const last = checkTokens[checkTokens.length - 1];'''

new_validate = '''  if (expr.endsWith('()') && checkTokens[checkTokens.length-1].value === ')') return { status: 'invalid', msg: 'Choose at least one cell to add.' };
  
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

  const last = checkTokens[checkTokens.length - 1];'''

text = text.replace(old_validate, new_validate)

with open(r'c:\Users\ASITSD\Documents\GitHub\Paperuss-2.0\js\tables.js', 'w', encoding='utf-8') as f:
    f.write(text)
    print("Patched validateFormulaState")
