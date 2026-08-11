import codecs

with codecs.open('js/tables.js', 'r', encoding='utf-8', errors='ignore') as f:
    content = f.read()

content = content.replace(
    "const el=document.getElementById(id);",
    "const el=document.getElementById(id) || document.querySelector(`[data-ctx=\"${id}\"]`);"
)

with codecs.open('js/tables.js', 'w', encoding='utf-8') as f:
    f.write(content)
print('Wiring patched!')
