import re
with open(r'c:\Users\ASITSD\Documents\GitHub\Paperuss-2.0\js\tables.js', 'r', encoding='utf-8') as f:
    text = f.read()

matches = re.finditer(r'document\.addEventListener\([\'"](click|pointerdown)[\'"]', text)
for m in matches:
    start = m.start()
    print(f'Match at {start}: {text[start:start+100]}')
