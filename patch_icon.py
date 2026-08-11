css_append = '''

.formula-opt:hover .formula-picker-icon, .formula-opt.selected .formula-picker-icon {
  background: rgba(255, 255, 255, 0.2);
  color: #fff;
}
'''

for file in [r'c:\Users\ASITSD\Documents\GitHub\Paperuss-2.0\features.css', r'c:\Users\ASITSD\Documents\GitHub\Paperuss-2.0\assets\css\features.css']:
    try:
        with open(file, 'a', encoding='utf-8') as f:
            f.write(css_append)
        print(f"Patched {file}")
    except Exception as e:
        print(f"Error {file}: {e}")
