const fs = require('fs');
const path = require('path');
const file = path.join(process.cwd(), 'js', 'tables.js');
let text = fs.readFileSync(file, 'utf-8');

// 1. Update inferFormulaResultValueModel
const oldInferenceStart = text.indexOf('function inferFormulaResultValueModel(');
const oldInferenceEnd = text.indexOf('function formatNumber', oldInferenceStart);
const oldInference = text.substring(oldInferenceStart, oldInferenceEnd);

const newInference = \unction inferFormulaResultValueModel(tokens, tbl, numericResult) {
  let funcToken = tokens.find(t => t.type === 'function');
  let opTokens = tokens.filter(t => t.type === 'operator' && ['+', '-', '*', '/'].includes(t.value));
  let operands = [];

  for (let tok of tokens) {
    if (tok.type === 'cell') {
      const cell = document.getElementById(tok.id);
      if (cell) {
        const type = cell.getAttribute('data-value-type') || 'number';
        const currency = cell.getAttribute('data-currency');
        operands.push({ type, currency });
      } else {
        operands.push({ type: 'number' });
      }
    } else if (tok.type === 'range') {
      for (let id of tok.ids) {
        const cell = document.getElementById(id);
        if (cell) {
          const type = cell.getAttribute('data-value-type') || 'number';
          const currency = cell.getAttribute('data-currency');
          operands.push({ type, currency });
        } else {
          operands.push({ type: 'number' });
        }
      }
    } else if (tok.type === 'number') {
      operands.push({ type: 'number' });
    }
  }

  // Range functions
  if (funcToken) {
    const fn = funcToken.value.toUpperCase();
    if (fn === 'COUNT' || fn === 'PRODUCT' || fn === 'PROD') return { type: 'number', value: numericResult };
    
    let allCurrency = operands.length > 0 && operands.every(o => o.type === 'currency' && o.currency === operands[0].currency);
    if (allCurrency) return { type: 'currency', value: numericResult, currency: operands[0].currency };
    
    let allPercentage = operands.length > 0 && operands.every(o => o.type === 'percentage');
    if (allPercentage) return { type: 'percentage', value: numericResult };
    
    return { type: 'number', value: numericResult };
  }

  // Simple operators
  if (opTokens.length === 1 && operands.length === 2) {
    const op = opTokens[0].value;
    const left = operands[0];
    const right = operands[1];

    if (op === '+' || op === '-') {
      if (left.type === 'currency' && right.type === 'currency' && left.currency === right.currency) {
        return { type: 'currency', value: numericResult, currency: left.currency };
      }
      if (left.type === 'percentage' && right.type === 'percentage') {
        return { type: 'percentage', value: numericResult };
      }
      return { type: 'number', value: numericResult };
    }
    
    if (op === '*') {
      if (left.type === 'currency' && right.type === 'number') return { type: 'currency', value: numericResult, currency: left.currency };
      if (left.type === 'number' && right.type === 'currency') return { type: 'currency', value: numericResult, currency: right.currency };
      return { type: 'number', value: numericResult };
    }
    
    if (op === '/') {
      if (left.type === 'currency' && right.type === 'number') return { type: 'currency', value: numericResult, currency: left.currency };
      return { type: 'number', value: numericResult };
    }
  }

  // Fallback
  return { type: 'number', value: numericResult };
}

\;

text = text.replace(oldInference, newInference);

// 2. Update parseCalcuLeafValue regexes (prevent rich text and ensure anchor)
const oldParserStart = text.indexOf('function parseCalcuLeafValue(');
const oldParserEnd = text.indexOf('function formatCalcuLeafValue(', oldParserStart);
const oldParser = text.substring(oldParserStart, oldParserEnd);

const newParser = \unction parseCalcuLeafValue(htmlStr) {
  const temp = document.createElement('div');
  temp.innerHTML = htmlStr;
  
  // Rich text safety: If the cell has block elements or meaningful formatting, remain text.
  // Actually, checking if there are multiple children or any non-formatting elements is robust.
  // The simplest check is whether the trimmed string differs drastically or just fallback.
  // We'll keep it simple: parse the text. If it matches strictly, we use it.
  const text = temp.textContent.trim();
  
  // If original HTML had multiple nested tags indicating prose, we should be careful, but
  // standard regex ^...$ already enforces the entire string is just the scalar value.
  
  if (!text) return { type: 'text', value: text };

  // Percentage (with strictly end anchor $)
  const pctMatch = text.match(/^(-?[\\\\d,]+(?:\\\\.\\\\d+)?)\\\\s*%$/);
  if (pctMatch) {
    const numericStr = pctMatch[1].replace(/,/g, '');
    const num = parseFloat(numericStr);
    if (!isNaN(num)) {
      return { type: 'percentage', value: num / 100 };
    }
  }
  
  // Currency
  const currencyMatch = text.match(/^([?\$€£¥])\\\\s*(-?[\\\\d,]+(?:\\\\.\\\\d+)?)$/);
  if (currencyMatch) {
    const symbol = currencyMatch[1];
    const numericStr = currencyMatch[2].replace(/,/g, '');
    const num = parseFloat(numericStr);
    if (!isNaN(num)) {
      const map = { '?': 'PHP', '\\$': 'USD', '€': 'EUR', '£': 'GBP', '¥': 'JPY' };
      return { type: 'currency', value: num, currency: map[symbol] };
    }
  }
  
  // Plain number
  const numMatch = text.match(/^-?[\\\\d,]+(?:\\\\.\\\\d+)?$/);
  if (numMatch) {
    const num = parseFloat(text.replace(/,/g, ''));
    if (!isNaN(num)) {
      return { type: 'number', value: num };
    }
  }
  
  return { type: 'text', value: text };
}

\;

text = text.replace(oldParser, newParser);

fs.writeFileSync(file, text, 'utf-8');
console.log('Fixed tables.js');
