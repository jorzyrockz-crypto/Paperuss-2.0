import codecs

with codecs.open('js/tables.js', 'r', encoding='utf-8', errors='ignore') as f:
    content = f.read()

dynamic_sort_code = """
        const sortButtons = [
            document.querySelector('[data-ctx="tblSortSheetAsc"]'),
            document.querySelector('[data-ctx="tblSortSheetDesc"]'),
            document.querySelector('[data-ctx="tblSortAsc"]'),
            document.querySelector('[data-ctx="tblSortDesc"]')
        ];
        
        const isNumeric = activeCell && (activeCell.getAttribute('data-value-type') === 'number' || activeCell.getAttribute('data-value-type') === 'currency' || activeCell.getAttribute('data-value-type') === 'percentage');
        
        if (sortButtons[0]) {
            sortButtons[0].innerHTML = isNumeric ? '<i data-lucide="arrow-down-0-9" class="w-4 h-4"></i><span class="ctx-text">Sort Sheet (1 to 9)</span>' : '<i data-lucide="arrow-down-a-z" class="w-4 h-4"></i><span class="ctx-text">Sort Sheet (A to Z)</span>';
        }
        if (sortButtons[1]) {
            sortButtons[1].innerHTML = isNumeric ? '<i data-lucide="arrow-up-9-0" class="w-4 h-4"></i><span class="ctx-text">Sort Sheet (9 to 1)</span>' : '<i data-lucide="arrow-up-z-a" class="w-4 h-4"></i><span class="ctx-text">Sort Sheet (Z to A)</span>';
        }
        if (sortButtons[2]) {
            sortButtons[2].innerHTML = isNumeric ? '<i data-lucide="arrow-down-0-9" class="w-4 h-4"></i><span class="ctx-text">Sort Range (1 to 9)</span>' : '<i data-lucide="arrow-down-a-z" class="w-4 h-4"></i><span class="ctx-text">Sort Range (A to Z)</span>';
        }
        if (sortButtons[3]) {
            sortButtons[3].innerHTML = isNumeric ? '<i data-lucide="arrow-up-9-0" class="w-4 h-4"></i><span class="ctx-text">Sort Range (9 to 1)</span>' : '<i data-lucide="arrow-up-z-a" class="w-4 h-4"></i><span class="ctx-text">Sort Range (Z to A)</span>';
        }
        
        if (window.lucide) window.lucide.createIcons();
"""

if 'const sortButtons =' not in content:
    content = content.replace('if (mergeBtn && splitBtn) {', dynamic_sort_code + '\n        if (mergeBtn && splitBtn) {')

with codecs.open('js/tables.js', 'w', encoding='utf-8') as f:
    f.write(content)
print('Dynamic sort options added!')
