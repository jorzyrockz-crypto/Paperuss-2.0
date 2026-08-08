const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

(async () => {
  console.log('Launching browser...');
  const browser = await puppeteer.launch({
    executablePath: 'C:\\Program Files\\BraveSoftware\\Brave-Browser\\Application\\brave.exe',
    headless: "new"
  });
  
  const page = await browser.newPage();
  
  // Go to the local page
  await page.goto('file:///C:/Users/ASITSD/Documents/GitHub/Paperuss-2.0/index.html', { waitUntil: 'networkidle2' });
  
  console.log('Generating DOCX...');
  const xmlStrings = await page.evaluate(async () => {
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
        <img src="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==" style="float: left; width: 100px; height: 100px;" />
        <ul>
          <li data-task="true">Checked</li>
          <li data-task="false">Unchecked</li>
        </ul>
      `
    };

    // Access the internal functions using reflection/tricks if they are hidden, but paperussDocx should be global
    if (window.paperussDocx && window.paperussDocx.generateDocxBlob) {
      // Actually, we want to see the RAW XML strings generated, since JSZip is an opaque blob
      // Let's monkeypatch buildDocumentXml temporarily in the browser
      return new Promise((resolve) => {
        const originalZip = window.JSZip;
        let interceptedXml = {};
        window.JSZip = function() {
          const zipInstance = new originalZip();
          const origFile = zipInstance.file;
          const origFolder = zipInstance.folder;
          
          zipInstance.file = function(name, content, opts) {
            interceptedXml[name] = typeof content === 'string' ? content : 'BinaryData';
            return origFile.apply(this, arguments);
          };
          zipInstance.folder = function(name) {
            const f = origFolder.apply(this, arguments);
            const origFFile = f.file;
            f.file = function(fname, fcontent, fopts) {
               interceptedXml[name + '/' + fname] = typeof fcontent === 'string' ? fcontent : 'BinaryData';
               return origFFile.apply(this, arguments);
            };
            return f;
          };
          
          // intercept generateAsync
          const origGen = zipInstance.generateAsync;
          zipInstance.generateAsync = function(opts) {
            resolve(interceptedXml);
            return origGen.apply(this, arguments);
          };
          return zipInstance;
        };
        
        window.paperussDocx.generateDocxBlob({ note: note, mode: 'active' });
      });
    }
    return null;
  });

  console.log('Export captured.');
  if (xmlStrings) {
    fs.writeFileSync('test-word-document.xml', xmlStrings['word/document.xml']);
    fs.writeFileSync('test-word-rels.xml', xmlStrings['word/_rels/document.xml.rels']);
    console.log('XML files saved locally (test-word-document.xml, test-word-rels.xml).');
  } else {
    console.log('Failed to capture XML.');
  }

  await browser.close();
})();
