import os
for root, dirs, files in os.walk(r'c:\Users\ASITSD\Documents\GitHub\Paperuss-2.0'):
    if '.git' in root or 'node_modules' in root: continue
    for file in files:
        if file.endswith('.html') or file.endswith('.js'):
            path = os.path.join(root, file)
            with open(path, 'r', encoding='utf-8') as f:
                for line in f:
                    if 'id="tblCtxMenu"' in line:
                        print(f'{file}: {line.strip()[:100]}')
