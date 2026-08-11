with open(r'c:\Users\ASITSD\Documents\GitHub\Paperuss-2.0\js\tables.js', 'r', encoding='utf-8') as f:
    text = f.read()

# 1. Update parseCalcuLeafValue
old_parse = '''  // Plain number
  const numMatch = text.match(/^-?(?:\d{1,3}(?:,\d{3})*|\d+)(?:\.\d+)?$/);'''

new_parse = '''  // Date
  const dateStrMatch = text.match(/^(\d{4}-\d{2}-\d{2}|\d{1,2}\/\d{1,2}\/\d{4}|[A-Za-z]{3,9}\s\d{1,2},\s\d{4})$/);
  if (dateStrMatch) {
    const ts = Date.parse(text);
    if (!isNaN(ts)) {
      return { type: 'date', value: ts };
    }
  }

  // Plain number
  const numMatch = text.match(/^-?(?:\d{1,3}(?:,\d{3})*|\d+)(?:\.\d+)?$/);'''

text = text.replace(old_parse, new_parse)

# 2. Update formatCalcuLeafValue
old_format = '''  } else if (metadata.type === 'currency') {
    const rmap = { 'PHP': '?', 'USD': '$', 'EUR': '€', 'GBP': '£', 'JPY': '¥' };
    const sym = rmap[metadata.currency] || '$';
    return formatCurrency(metadata.value, sym);
  }
  return metadata.value;'''

new_format = '''  } else if (metadata.type === 'currency') {
    const rmap = { 'PHP': '?', 'USD': '$', 'EUR': '€', 'GBP': '£', 'JPY': '¥' };
    const sym = rmap[metadata.currency] || '$';
    return formatCurrency(metadata.value, sym);
  } else if (metadata.type === 'date') {
    return new Intl.DateTimeFormat('en-US', { year: 'numeric', month: 'short', day: 'numeric' }).format(new Date(metadata.value));
  }
  return metadata.value;'''

text = text.replace(old_format, new_format)

# 3. Update getCalcuLeafNumericValue
old_numeric = '''  if (raw !== null && (type === 'number' || type === 'currency' || type === 'percentage')) {
    const value = Number(raw);
    if (Number.isFinite(value)) {
      return value;
    }
  }'''

new_numeric = '''  if (raw !== null && (type === 'number' || type === 'currency' || type === 'percentage' || type === 'date')) {
    const value = Number(raw);
    if (Number.isFinite(value)) {
      return value;
    }
  }'''

text = text.replace(old_numeric, new_numeric)

with open(r'c:\Users\ASITSD\Documents\GitHub\Paperuss-2.0\js\tables.js', 'w', encoding='utf-8') as f:
    f.write(text)
    print('Patched tables.js dates')
