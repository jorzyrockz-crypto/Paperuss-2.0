import re

with open(r'c:\Users\ASITSD\Documents\GitHub\Paperuss-2.0\js\tables.js', 'r', encoding='utf-8') as f:
    text = f.read()

# The current logic in renderFormulaMenu is:
old_start = text.find('  const rect = window.formulaMode.destinationCell.getBoundingClientRect();')
old_end = text.find('  menu.querySelectorAll(\'.formula-opt\').forEach(btn => {', old_start)

if old_start != -1 and old_end != -1:
    pos_logic = '''  window.positionFormulaMenu = function(menuEl) {
    if (!window.formulaMode || !window.formulaMode.destinationCell) return;
    const menu = menuEl || document.getElementById('formulaMenu');
    if (!menu || !menu.classList.contains('show')) return;
    
    const rect = window.formulaMode.destinationCell.getBoundingClientRect();
    const margin = 12;
    const gap = 8;
    
    menu.style.maxHeight = 'none';
    
    const naturalHeight = menu.scrollHeight;
    const panelWidth = menu.offsetWidth;
    
    const spaceBelow = window.innerHeight - rect.bottom - margin - gap;
    const spaceAbove = rect.top - margin - gap;
    
    let availableHeight;
    let top;
    
    if (naturalHeight <= spaceBelow) {
      top = rect.bottom + gap;
      availableHeight = naturalHeight;
    }
    else if (naturalHeight <= spaceAbove) {
      top = rect.top - naturalHeight - gap;
      availableHeight = naturalHeight;
    }
    else if (spaceBelow >= spaceAbove) {
      top = rect.bottom + gap;
      availableHeight = spaceBelow;
    }
    else {
      availableHeight = spaceAbove;
      top = margin;
    }
    
    const viewportMaxHeight = window.innerHeight - (margin * 2);
    const finalMaxHeight = Math.min(naturalHeight, availableHeight, viewportMaxHeight);
    
    menu.style.maxHeight = \px;
    
    let left = rect.left;
    if (left + panelWidth > window.innerWidth - margin) {
        left = window.innerWidth - panelWidth - margin;
    }
    left = Math.max(margin, left);
    
    menu.style.left = \px;
    menu.style.top = \px;
  };
  
  window.positionFormulaMenu(menu);
  
'''
    new_text = text[:old_start] + pos_logic + text[old_end:]
    
    # Add scroll/resize listeners at the end of the file
    listeners = '''
window.addEventListener('resize', () => {
  if (window.positionFormulaMenu) window.positionFormulaMenu();
});
document.addEventListener('scroll', (e) => {
  // don't reposition if scrolling inside the menu itself
  if (e.target && e.target.closest && e.target.closest('.formula-autocomplete-menu')) return;
  if (window.positionFormulaMenu) window.positionFormulaMenu();
}, true);
'''
    if 'document.addEventListener(\'scroll\'' not in new_text[-500:]:
        new_text += listeners

    with open(r'c:\Users\ASITSD\Documents\GitHub\Paperuss-2.0\js\tables.js', 'w', encoding='utf-8') as f:
        f.write(new_text)
    print('Refactored positioning logic!')
else:
    print('Failed to find block')
