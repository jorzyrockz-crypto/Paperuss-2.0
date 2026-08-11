import codecs
import re

# Update app.html
with codecs.open('app.html', 'r', encoding='utf-8', errors='ignore') as f:
    html = f.read()
# Remove tblDimBadge
html = re.sub(r'<span class="tbl-dim-badge" id="tblDimBadge"></span>\s*<span class="tbl-sep"></span>', '', html)
with codecs.open('app.html', 'w', encoding='utf-8') as f:
    f.write(html)

# Update js/tables.js
with codecs.open('js/tables.js', 'r', encoding='utf-8', errors='ignore') as f:
    js = f.read()

# Replace menuBtnMap
js = re.sub(
    r'const menuBtnMap\s*=\s*\{[^}]+\};',
    '''const menuBtnMap={
    tblBtnMerge:'tblMenuMerge',
    tblBtnLayout:'tblMenuLayout',
    tblBtnThemes:'tblMenuThemes'
  };''',
    js
)

# Remove tblMenuIds
js = re.sub(
    r'const tblMenuIds\s*=\s*\[[^\]]+\];',
    '''const tblMenuIds=['tblMenuMerge','tblMenuLayout','tblMenuThemes'];''',
    js
)

with codecs.open('js/tables.js', 'w', encoding='utf-8') as f:
    f.write(js)
print('Fixed buttons and removed 5x4 indicator!')
