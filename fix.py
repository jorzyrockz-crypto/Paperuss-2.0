import re

with open(r'c:\Users\ASITSD\Documents\GitHub\Paperuss-2.0\js\tables.js', 'r', encoding='utf-8') as f:
    text = f.read()

# I am looking to prepend the ƒ symbol before the fields in view === 'edit'
# Let's find this specific line: html += '<div style="display:flex; flex-wrap:wrap; align-items:center; gap:8px; margin-bottom:12px; margin-top:8px;">';

target = 'html += \'<div style="display:flex; flex-wrap:wrap; align-items:center; gap:8px; margin-bottom:12px; margin-top:8px;">\';'
new_target = '''html += '<div style="display:flex; flex-wrap:wrap; align-items:center; gap:8px; margin-bottom:12px; margin-top:8px; font-size:1.1em;">';
        html += '<span style="font-family:serif; font-style:italic; font-weight:bold; color:var(--subtle-text); margin-right:4px;">&fnof;</span>';
        if (!def.binaryOp && kind !== 'ROUND') {
            html += '<span style="font-weight:bold; color:var(--fg);">' + def.label.toUpperCase() + '</span>';
        } else if (kind === 'ROUND') {
            html += '<span style="font-weight:bold; color:var(--fg);">ROUND</span>';
        }'''

if target in text:
    text = text.replace(target, new_target)
    with open(r'c:\Users\ASITSD\Documents\GitHub\Paperuss-2.0\js\tables.js', 'w', encoding='utf-8') as f:
        f.write(text)
    print('Updated successfully!')
else:
    print('Target not found')
