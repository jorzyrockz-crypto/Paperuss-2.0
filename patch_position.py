with open(r'c:\Users\ASITSD\Documents\GitHub\Paperuss-2.0\js\tables.js', 'r', encoding='utf-8') as f:
    text = f.read()

old_code = '''        const cx=side==='left'?r.left+10:side==='right'?r.right-10:(r.left+r.right)/2;
        const cy=side==='top'?r.top+10:side==='bottom'?r.bottom-10:(r.top+r.bottom)/2;'''

new_code = '''        const cx=side==='left'?r.left:side==='right'?r.right:r.right-12;
        const cy=side==='top'?r.top:side==='bottom'?r.bottom:r.bottom-12;'''

text = text.replace(old_code, new_code)

with open(r'c:\Users\ASITSD\Documents\GitHub\Paperuss-2.0\js\tables.js', 'w', encoding='utf-8') as f:
    f.write(text)
    print("Patched tables.js positions")
