import urllib.request
import re
from html.parser import HTMLParser

class AssetParser(HTMLParser):
    def __init__(self):
        super().__init__()
        self.assets = []
    
    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        if tag == 'link' and 'href' in attrs:
            self.assets.append(attrs['href'])
        elif tag == 'script' and 'src' in attrs:
            self.assets.append(attrs['src'])
        elif tag == 'img' and 'src' in attrs:
            self.assets.append(attrs['src'])

for page in ['index.html', 'app.html']:
    print(f'Checking {page}...')
    with open(page, 'r', encoding='utf-8') as f:
        html = f.read()
    
    parser = AssetParser()
    parser.feed(html)
    
    for asset in parser.assets:
        # Ignore external URLs
        if asset.startswith('http') or asset.startswith('//'):
            continue
        
        # Remove query parameters for local checking
        local_path = asset.split('?')[0]
        try:
            with open(local_path, 'rb') as f:
                pass
        except FileNotFoundError:
            print(f'404: {asset} referenced in {page} does not exist!')
print('Done checking assets.')
