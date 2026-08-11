with open(r'c:\Users\ASITSD\Documents\GitHub\Paperuss-2.0\js\tables.js', 'r', encoding='utf-8') as f:
    text = f.read()

old_code = '''    if (window.formulaMode && (window.formulaMode.phase === 'edit' || window.formulaMode.phase === 'inspect')) {
      if (e.target.closest('table') || e.target.closest('.formula-autocomplete-menu')) {
        return; // Don't close anything if clicking inside formula ecosystem
      }
    }'''

new_code = '''    if (window.formulaMode && (window.formulaMode.phase === 'edit' || window.formulaMode.phase === 'inspect')) {
      if (e.target.closest('table') || e.target.closest('.formula-autocomplete-menu')) {
        return; // Don't close anything if clicking inside formula ecosystem
      }
      cancelFormulaMode(); // Clicked outside the table, cancel formula mode
    }'''

text = text.replace(old_code, new_code)

with open(r'c:\Users\ASITSD\Documents\GitHub\Paperuss-2.0\js\tables.js', 'w', encoding='utf-8') as f:
    f.write(text)
    print("Patched tables.js cancel behavior")
