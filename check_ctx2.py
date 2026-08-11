with open(r'c:\Users\ASITSD\Documents\GitHub\Paperuss-2.0\app.html', 'r', encoding='utf-8') as f:
    text = f.read()

import re
matches = re.finditer(r'id="tblCtxMenu"', text)
for m in matches:
    start = max(0, m.start() - 100)
    end = text.find('</div>', text.find('</div>', start) + 1000)
    print(text[start:end])
    break
