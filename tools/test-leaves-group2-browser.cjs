/**
 * Group 2 Browser Verification: Editor State, Multi-Leaf Tabs & Drawer UI
 * Runs inside Microsoft Edge/Chrome headless via Chrome DevTools Protocol (CDP).
 */

const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');
const cdp = require('./cdp-client.cjs');

const BROWSER_PATH = cdp.getBrowserPath();
const PORT = 9322;
const TEMP_PROFILE = fs.mkdtempSync(path.join(os.tmpdir(), 'paperuss-edge-group2-'));
const TARGET_URL = 'file:///' + path.resolve(__dirname, '../index.html').replace(/\\/g, '/');

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function runBrowserTests() {
  console.log(`--- STARTING BROWSER (${BROWSER_PATH}) FOR GROUP 2 LEAVES TESTS ---`);
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

  client.onEvent((msg) => {
    if (msg.method === 'Runtime.consoleAPICalled') {
      const text = (msg.params.args || []).map(a => a.value || a.description || '').join(' ');
      if (text && !text.includes('lucide')) console.log('[BROWSER CONSOLE]', msg.params.type, text);
    } else if (msg.method === 'Runtime.exceptionThrown') {
      console.log('[BROWSER EXCEPTION]', msg.params.exceptionDetails.text, msg.params.exceptionDetails.exception?.description || '');
    }
  });

  const waitForPageLoad = () => new Promise((resolve) => {
    const handler = (msg) => {
      if (msg.method === 'Page.loadEventFired') resolve();
    };
    client.onEvent(handler);
  });

  const loadP1 = waitForPageLoad();
  await client.send('Page.navigate', { url: TARGET_URL });
  await loadP1;

  let ready = false;
  for (let i = 0; i < 30; i++) {
    await sleep(200);
    const check = await client.send('Runtime.evaluate', {
      expression: 'typeof window.paperussLeaves !== "undefined" && typeof window.paperussLeafManager !== "undefined"',
      returnByValue: true
    });
    if (check && check.result && check.result.value === true) {
      ready = true;
      break;
    }
  }

  if (!ready) throw new Error('paperussLeaves or paperussLeafManager not ready.');

  console.log('--- RUNNING TEST SUITE 1 ---');

  const testScript = `
    (async () => {
      const results = { passed: 0, failed: 0, tests: [] };
      function assert(name, condition, msg = '') {
        if (condition) {
          results.passed++;
          results.tests.push({ name, status: 'PASS' });
        } else {
          results.failed++;
          results.tests.push({ name, status: 'FAIL', msg });
        }
      }

      function wait(ms) { return new Promise(r => setTimeout(r, ms)); }

      try {
        // Setup initial legacy note
        window.createNote();
        await wait(200);
        const noteId = window.paperussState.currentId;
        
        // Ensure it's selected
        window.jumpToNote(noteId);
        
        // 1. Legacy Note remains unmigrated when opened
        window.renderEditor();
        await wait(100);
        const activeNote = window.getNote(noteId);
        assert('Legacy Note remains unmigrated when opened', activeNote.leafOrder === undefined && activeNote.defaultLeafId === undefined);
        
        // Simulate edit on virtual leaf
        document.getElementById('noteBody').innerHTML = '<div>Edited Virtual Content</div>';
        window.handleBodyInput();
        await wait(100);
        assert('Editing virtual leaf directly updates note.content', window.getNote(noteId).content.includes('Edited Virtual Content'));
        
        // 2. Creating a second Leaf materializes Main safely.
        const newLeafId = await window.paperussLeafManager.addLeaf(noteId, 'Second Leaf');
        assert('addLeaf returns new leaf ID', !!newLeafId);
        const updatedNote = window.getNote(noteId);
        assert('Note is now materialized (leafOrder exists)', Array.isArray(updatedNote.leafOrder));
        assert('Note leafCount is 2', updatedNote.leafCount === 2);
        assert('Note defaultLeafId is set', !!updatedNote.defaultLeafId);
        assert('New leaf is in leafOrder', updatedNote.leafOrder.includes(newLeafId));
        
        // Switch to the newly created leaf
        await window.paperussLeafManager.switchLeaf(noteId, newLeafId);
        await wait(500);
        
        const currentHtml = document.getElementById('noteBody').innerHTML;
        assert('Editor is empty when switching to new leaf', currentHtml.trim() === '' || currentHtml.includes('<br>') || (!currentHtml.includes('Original Legacy Content') && !currentHtml.includes('Edited Virtual Content')));
        
        // 3. Migration failure preserves note.content (mocking a failure)
        window.createNote();
        await wait(200);
        const noteFailId = window.paperussState.currentId;
        const noteFail = window.getNote(noteFailId);
        noteFail.content = 'Safe';
        window.editField('content', 'Safe');
        await wait(100);
        
        const originalLeafPut = window.paperussLeaves.leafPut;
        window.paperussLeaves.leafPut = async () => { throw new Error('Mock failure'); };
        const failRes = await window.paperussLeafManager.materializeVirtualNote(window.getNote(noteFailId));
        assert('materializeVirtualNote catches error and returns false', failRes === false);
        const failCheck = window.getNote(noteFailId);
        assert('Failed migration preserves original note structure', failCheck.leafOrder === undefined && failCheck.content === 'Safe');
        window.paperussLeaves.leafPut = originalLeafPut; // restore
        
        // 4. Active Leaf survives refresh locally
        window.paperussLeaves.setNoteActiveLeafId(noteId, newLeafId);
        
        // Persist noteId for suite 2
        window.localStorage.setItem('test_note_id', noteId);
      } catch (err) {
        results.failed++;
        results.tests.push({ name: 'UNCAUGHT EXCEPTION', status: 'FAIL', msg: err.message });
      }

      return results;
    })();
  `;

  const res1 = await client.send('Runtime.evaluate', {
    expression: testScript,
    awaitPromise: true,
    returnByValue: true
  });
  const suite1 = res1.result.value;
  suite1.tests.forEach((t) => console.log(`[${t.status}] ${t.name}${t.msg ? ' - ' + t.msg : ''}`));

  console.log('\n--- TESTING BROWSER REFRESH FOR ACTIVE LEAF (Test 4) ---');
  const loadP2 = waitForPageLoad();
  await client.send('Page.reload');
  await loadP2;

  let ready2 = false;
  for (let i = 0; i < 30; i++) {
    await sleep(200);
    const check = await client.send('Runtime.evaluate', {
      expression: 'typeof window.paperussLeaves !== "undefined"',
      returnByValue: true
    });
    if (check && check.result && check.result.value === true) { ready2 = true; break; }
  }

  const testScript2 = `
    (async () => {
      const results = { passed: 0, failed: 0, tests: [] };
      function assert(name, condition, msg = '') {
        if (condition) { results.passed++; results.tests.push({ name, status: 'PASS' }); }
        else { results.failed++; results.tests.push({ name, status: 'FAIL', msg }); }
      }
      function wait(ms) { return new Promise(r => setTimeout(r, ms)); }
      
      try {
        const noteId = window.localStorage.getItem('test_note_id');
        
        const noteActiveLeaf = window.paperussLeaves.getNoteActiveLeafId({id: noteId});
        assert('Active Leaf survives refresh locally', noteActiveLeaf && noteActiveLeaf.startsWith('leaf_'));
        
        window.jumpToNote(noteId);
        await wait(100);
        
        const mockLeafDefault = { id: window.paperussLeaves.getNoteDefaultLeafId(window.getNote(noteId)), isVirtual: false, content: 'Default Content' };
        window.currentActiveLeaf = mockLeafDefault;
        window.editField('content', 'Default Updated');
        assert('Default Leaf edits mirror to note.content', window.getNote(noteId).content === 'Default Updated');
        
        const mockLeafNonDefault = { id: noteActiveLeaf, isVirtual: false, content: 'Other Content' };
        window.currentActiveLeaf = mockLeafNonDefault;
        window.editField('content', 'Other Updated');
        assert('Non-default Leaf edits do NOT modify note.content', window.getNote(noteId).content === 'Default Updated');
        
        // 7. Rapid switching does not lose content
        const rapidLeaf1 = { id: 'rapid_1', noteId: noteId, content: 'State1', isVirtual: false };
        const rapidLeaf2 = { id: 'rapid_2', noteId: noteId, content: 'State2', isVirtual: false };
        await window.paperussLeaves.leafPut(rapidLeaf1);
        await window.paperussLeaves.leafPut(rapidLeaf2);
        
        window.currentActiveLeaf = rapidLeaf1;
        window.editField('content', 'State1 Edited');
        
        await window.paperussLeafManager.switchLeaf(noteId, 'rapid_2');
        const fetchedRapid1 = await window.paperussLeaves.leafGet('rapid_1');
        assert('Rapid switching flushed the first leaf correctly', fetchedRapid1.content === 'State1 Edited');
        
        // 8. Existing Note creation/editing still works.
        window.createNote();
        await wait(200);
        const newNoteId = window.paperussState.currentId;
        assert('createNote successfully creates note', typeof newNoteId === 'string' && newNoteId.length > 5);
        const created = window.getNote(newNoteId);
        assert('Newly created note is virtual', created.leafOrder === undefined);
        
        window.editField('content', 'Testing new note');
        await wait(100);
        assert('Can edit newly created note', created.content === 'Testing new note');

        await window.paperussLeaves.deleteLeavesDB();
      } catch (err) {
        results.failed++;
        results.tests.push({ name: 'UNCAUGHT REFRESH EXCEPTION', status: 'FAIL', msg: err.message });
      }
      return results;
    })();
  `;

  const res2 = await client.send('Runtime.evaluate', {
    expression: testScript2,
    awaitPromise: true,
    returnByValue: true
  });
  
  const suite2 = res2.result.value;
  suite2.tests.forEach((t) => console.log(`[${t.status}] ${t.name}${t.msg ? ' - ' + t.msg : ''}`));

  try { client.close(); browserProc.kill(); fs.rmSync(TEMP_PROFILE, { recursive: true, force: true }); } catch (_) {}

  const totalPassed = suite1.passed + suite2.passed;
  const totalFailed = suite1.failed + suite2.failed;

  console.log(`\n========================================`);
  console.log(`TOTAL BROWSER TESTS: ${totalPassed + totalFailed}`);
  console.log(`PASSED: ${totalPassed}`);
  console.log(`FAILED: ${totalFailed}`);
  console.log(`========================================`);

  if (totalFailed > 0) process.exit(1);
  else process.exit(0);
}

runBrowserTests().catch((err) => {
  console.error('Fatal test error:', err);
  process.exit(1);
});
