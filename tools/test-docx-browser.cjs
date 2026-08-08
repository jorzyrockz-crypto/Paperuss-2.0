const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');
const cdp = require('./cdp-client.cjs');

const BROWSER_PATH = cdp.getBrowserPath();
const PORT = 9312;
const TEMP_PROFILE = fs.mkdtempSync(path.join(os.tmpdir(), 'paperuss-docx-'));
const TARGET_URL = 'file:///' + path.resolve(__dirname, '../index.html').replace(/\\/g, '/');

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function run() {
  console.log(`--- STARTING BROWSER (${BROWSER_PATH}) FOR DOCX TESTS ---`);
  if (!fs.existsSync(BROWSER_PATH)) {
    throw new Error('Browser not found at: ' + BROWSER_PATH);
  }

  const browserProc = spawn(BROWSER_PATH, [
    '--headless=new',
    `--remote-debugging-port=${PORT}`,
    '--remote-allow-origins=*',
    `--user-data-dir=${TEMP_PROFILE}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-gpu',
    '--allow-file-access-from-files'
  ], { stdio: 'ignore' });

  let wsUrl = null;
  for (let i = 0; i < 40; i++) {
    await sleep(300);
    try {
      const res = await fetch(`http://127.0.0.1:${PORT}/json`);
      const data = await res.json();
      const pageTarget = Array.isArray(data) ? data.find(x => x.type === 'page' && x.webSocketDebuggerUrl) : null;
      if (pageTarget) {
        wsUrl = pageTarget.webSocketDebuggerUrl;
        break;
      }
    } catch (_) {}
  }

  if (!wsUrl) {
    browserProc.kill();
    throw new Error(`Failed to connect to browser debugging port ${PORT}`);
  }

  const client = await cdp.connect(wsUrl);

  await client.send('Page.enable');
  await client.send('Runtime.enable');

  const waitForPageLoad = () => new Promise((resolve) => {
    const handler = (msg) => {
      if (msg.method === 'Page.loadEventFired') {
        resolve();
      }
    };
    client.onEvent(handler);
  });

  console.log('Navigating to:', TARGET_URL);
  const loadP1 = waitForPageLoad();
  await client.send('Page.navigate', { url: TARGET_URL });
  await loadP1;

  for (let i = 0; i < 30; i++) {
    await sleep(200);
    const check = await client.send('Runtime.evaluate', {
      expression: 'typeof window.paperussDocx !== "undefined" && typeof window.generateDocxBlob !== "undefined"',
      returnByValue: true
    });
    if (check && check.result && check.result.value === true) break;
  }

  const script = `
    (async () => {
      const note = {
        title: "Test Note",
        content: \`
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
        \`
      };

      // Monkey-patch JSZip to extract XML before it gets zipped
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
          
          const origGen = zipInstance.generateAsync;
          zipInstance.generateAsync = function(opts) {
            resolve(interceptedXml);
            return origGen.apply(this, arguments);
          };
          return zipInstance;
        };
        
        window.generateDocxBlob({ note: note, mode: 'active' });
      });
    })();
  `;

  const res = await client.send('Runtime.evaluate', {
    expression: script,
    awaitPromise: true,
    returnByValue: true
  });

  const xmlMap = res.result.value;
  console.log('--- document.xml ---');
  console.log(xmlMap['word/document.xml']);
  
  if (xmlMap['word/document.xml'].match(/<\/w:tbl><w:sectPr>/)) {
    console.log('\\n\\nERROR: <w:tbl> is the last element before <w:sectPr>! This causes Word corruption.');
  }

  try { client.close(); browserProc.kill(); fs.rmSync(TEMP_PROFILE, { recursive: true, force: true }); } catch (_) {}
}

run().catch(console.error);
