with open(r'c:\Users\ASITSD\Documents\GitHub\Paperuss-2.0\js\tables.js', 'r', encoding='utf-8') as f:
    text = f.read()

old_loop = '''  window.formulaMode.tokens.forEach((tok, idx) => {
    const colorIdx = window.formulaMode.sourceVisualMap.get(idx);
    const colorClass = colorIdx ? \calculeaf-formula-source-\\ : '';
    
    const isEditing = isEdit && idx === window.formulaMode.activeSourceIndex;
    const activeClass = isEditing ? 'formula-token-active' : '';
    
    if (tok.type === 'cell' || tok.type === 'range') {'''

new_loop = '''  window.formulaMode.tokens.forEach((tok, idx) => {
    const colorIdx = window.formulaMode.sourceVisualMap.get(idx);
    const colorClass = colorIdx ? \calculeaf-formula-source-\\ : '';
    
    const isEditing = isEdit && idx === window.formulaMode.activeSourceIndex;
    const activeClass = isEditing ? 'formula-token-active' : '';
    
    if (isEditing) {
      html += \<span class="formula-token-cursor" style="display:inline-block; border-left: 2px solid var(--accent, #007bff); height:1.2em; margin-right: 2px; margin-left: 2px; transform: translateY(2px);"></span>\;
    }
    
    if (tok.type === 'cell' || tok.type === 'range') {'''

text = text.replace(old_loop, new_loop)

old_cursor = '''  if (isEdit && window.formulaMode.activeSourceIndex === window.formulaMode.tokens.length) {
    html += \<span class="formula-token-cursor" style="border-right: 2px solid var(--accent); height:1.2em; animation: blink 1s step-end infinite;">&nbsp;</span>\;
  }'''

new_cursor = '''  if (isEdit && window.formulaMode.activeSourceIndex === window.formulaMode.tokens.length) {
    html += \<span class="formula-token-cursor" style="display:inline-block; border-left: 2px solid var(--accent, #007bff); height:1.2em; margin-left: 4px; transform: translateY(2px);"></span>\;
  }'''

text = text.replace(old_cursor, new_cursor)

with open(r'c:\Users\ASITSD\Documents\GitHub\Paperuss-2.0\js\tables.js', 'w', encoding='utf-8') as f:
    f.write(text)
    print("Patched caret")
