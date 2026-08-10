const fs = require('fs');
const src = fs.readFileSync('js/bootstrap.js', 'utf-8');
const funcMatch = src.match(/function parseMarkdownInline[\s\S]*?return str;\s*}/);
if(funcMatch) {
  const func = funcMatch[0];
  const esc = "function esc(s){return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/\\\"/g,'&quot;');}";
  eval(esc + '\n' + func);
  console.log(parseMarkdownInline('File: `</>` [`app.html`](file:///app.html)'));
}
