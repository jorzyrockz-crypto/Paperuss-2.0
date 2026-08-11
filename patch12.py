import codecs

with codecs.open('app.html', 'r', encoding='utf-8', errors='ignore') as f:
    content = f.read()

if 'themes.css' not in content:
    content = content.replace('<link rel="stylesheet" href="css/style.css">', '<link rel="stylesheet" href="css/style.css">\n    <link rel="stylesheet" href="css/themes.css">')
    with codecs.open('app.html', 'w', encoding='utf-8') as f:
        f.write(content)
    print('Linked themes.css in app.html')
