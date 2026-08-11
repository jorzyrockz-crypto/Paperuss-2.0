import re

def get_file(p):
    with open(p, 'r', encoding='utf-8') as f:
        return f.read()

def write_file(p, c):
    with open(p, 'w', encoding='utf-8') as f:
        f.write(c)

def extract_function(text, fn_name):
    start = text.find('function ' + fn_name + '(')
    if start == -1: return None
    
    # find the opening brace
    brace_start = text.find('{', start)
    if brace_start == -1: return None
    
    level = 0
    for i in range(brace_start, len(text)):
        if text[i] == '{': level += 1
        elif text[i] == '}':
            level -= 1
            if level == 0:
                return text[start:i+1]
    return None

old = get_file(r'c:\Users\ASITSD\.gemini\antigravity\brain\b313702a-5c1b-4a63-b013-e7f4161c01e5\scratch\tables_copy.js')
new = get_file(r'c:\Users\ASITSD\Documents\GitHub\Paperuss-2.0\js\tables.js')

# 1. Replace window.formulaMode block
old_fm_match = re.search(r'window\.formulaMode = \{.*?pendingBinaryOperator: null\n\};', old, re.DOTALL)
new_fm_match = re.search(r'window\.formulaMode = \{.*?\n\};', new, re.DOTALL)

if old_fm_match and new_fm_match:
    new = new[:new_fm_match.start()] + old_fm_match.group(0) + new[new_fm_match.end():]
    print('Replaced window.formulaMode')

# 2. Extract UI block from old
old_ui_start = old.find('function formulaSourceKey(')
old_ui_end = old.find('function tblInsertFormula(formulaTpl) {')
old_ui_block = old[old_ui_start:old_ui_end]

# Apply fixes to old_ui_block
# 2.1 view_port aware renderFormulaMenu
old_pos = 'menu.style.top = ${rect.bottom + window.scrollY + 4}px;\n  menu.style.left = ${rect.left + window.scrollX}px;'
new_pos = '''const margin = 12;
  let left = rect.left;
  let top = rect.bottom + 6;
  
  menu.style.top = ${top}px;
  menu.style.left = ${left}px;
  menu.classList.add('show');
  
  const modalRect = menu.getBoundingClientRect();
  
  if (left + modalRect.width > window.innerWidth - margin) {
      left = window.innerWidth - modalRect.width - margin;
  }
  left = Math.max(margin, left);
  
  if (top + modalRect.height > window.innerHeight - margin) {
      const above = rect.top - modalRect.height - 6;
      if (above >= margin) {
          top = above;
      } else {
          top = margin;
      }
  }
  
  menu.style.left = ${left}px;
  menu.style.top = ${top}px;'''
old_ui_block = old_ui_block.replace(old_pos, new_pos)
old_ui_block = old_ui_block.replace('&#x192;', '&fnof;')
old_ui_block = old_ui_block.replace('ƒ', '&fnof;')

# 2.2 Re-inject single-click & toolbar suppression related functions
# clearFormulaCell
clear_func = extract_function(new, 'clearFormulaCell')
if clear_func: old_ui_block = clear_func + '\n\n' + old_ui_block

# hideTableUIForFormulaMode
hide_func = extract_function(new, 'hideTableUIForFormulaMode')
if hide_func: 
    old_ui_block = hide_func + '\n\n' + old_ui_block
    old_ui_block = old_ui_block.replace('exitCalcuLeafEditMode(false);\n', 'exitCalcuLeafEditMode(false);\n  hideTableUIForFormulaMode();\n')

# computeSourceColors
colors_old = extract_function(old_ui_block, 'computeSourceColors')
colors_new = extract_function(new, 'computeSourceColors')
if colors_old and colors_new:
    old_ui_block = old_ui_block.replace(colors_old, colors_new)

# getFormulaSourceDisplay
disp_old = extract_function(old_ui_block, 'getFormulaSourceDisplay')
disp_new = extract_function(new, 'getFormulaSourceDisplay')
if disp_old and disp_new:
    old_ui_block = old_ui_block.replace(disp_old, disp_new)

# Restore menu categories inside tables.js (not inside ui block)
old_cats = re.search(r'const FORMULA_MENU_CATEGORIES = \[.*?\];', old, re.DOTALL)
new_cats = re.search(r'const FORMULA_MENU_CATEGORIES = \[.*?\];', new, re.DOTALL)
if old_cats and new_cats:
    new = new[:new_cats.start()] + old_cats.group(0) + new[new_cats.end():]

old_flat = re.search(r'const FORMULA_LIST_FLAT = \[.*?\];', old, re.DOTALL)
new_flat = re.search(r'const FORMULA_LIST_FLAT = \[.*?\];', new, re.DOTALL)
if old_flat and new_flat:
    new = new[:new_flat.start()] + old_flat.group(0) + new[new_flat.end():]

# Swap UI block
new_ui_start = new.find('function formulaSourceKey(')
new_ui_end = new.find('function tblInsertFormula(formulaTpl) {')

new = new[:new_ui_start] + old_ui_block + new[new_ui_end:]
write_file(r'c:\Users\ASITSD\Documents\GitHub\Paperuss-2.0\js\tables.js', new)
print('Merge complete!')
