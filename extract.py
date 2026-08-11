import codecs
with codecs.open('app.html', 'r', encoding='utf-8', errors='ignore') as f:
    lines = f.readlines()
    start = -1
    for i, line in enumerate(lines):
        if 'id="tblTools"' in line or "id='tblTools'" in line:
            start = i
            break
    if start != -1:
        print(''.join(lines[start:start+100]))
