const fs = require('fs');

global.JSZip = class {
  constructor() {
    this.files = {};
  }
  file(name, content, opts) {
    this.files[name] = typeof content === 'string' ? content : 'BinaryData';
    return this;
  }
  folder(name) {
    const parent = this;
    return {
      file(fname, fcontent, fopts) {
        parent.file(name + '/' + fname, fcontent, fopts);
        return this;
      },
      folder(fname) {
        return parent.folder(name + '/' + fname);
      }
    }
  }
  generateAsync() {
    return Promise.resolve(this.files);
  }
};

const code = fs.readFileSync('js/docx-export.js', 'utf8');
eval(code);

(async () => {
  const note = {
    title: "Test Note",
    content: `
      <h1>Test Header</h1>
      <p>A paragraph</p>
      <div class="card-grid-row">
        <div><p>Col 1</p></div>
        <div><p>Col 2</p></div>
      </div>
      <hr class="paperuss-divider" />
      <div class="callout" data-callout="tip">Tip text</div>
      <img src="https://via.placeholder.com/150" style="float: left; width: 100px; height: 100px;" />
      <ul>
        <li data-task="true">Checked</li>
        <li data-task="false">Unchecked</li>
      </ul>
      <table>
        <tr><th>Header 1</th></tr>
        <tr><td>Data 1</td></tr>
      </table>
    `
  };

  const files = await global.generateDocxBlob({ note, mode: 'active' });
  console.log('--- document.xml ---');
  console.log(files['word/document.xml']);
  
  // Also validate that there's no dangling <w:tbl> before <w:sectPr>
  const docXml = files['word/document.xml'];
  if (docXml.match(/<\/w:tbl><w:sectPr>/)) {
    console.log('\n\nERROR: <w:tbl> is the last element before <w:sectPr>! This causes Word corruption.');
  } else {
    console.log('\n\nNo trailing <w:tbl> found.');
  }

})();
