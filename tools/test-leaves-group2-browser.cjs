/**
 * Group 2 Browser Verification: Editor State, Multi-Leaf Tabs & Drawer UI (Core API behavior without actual UI for now)
 * Runs inside Microsoft Edge headless via Chrome DevTools Protocol (CDP).
 */

const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

const EDGE_PATH = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const PORT = 9300 + Math.floor(Math.random() * 100);
const TEMP_PROFILE = fs.mkdtempSync(path.join(os.tmpdir(), 'paperuss-edge-group2-'));
const TARGET_URL = 'file:///' + path.resolve(__dirname, '../index.html').replace(/\\/g, '/');

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function sendCDP(ws, method, params = {}) {
  const id = Math.floor(Math.random() * 1000000000);
  return new Promise((resolve, reject) => {
    const handler = (event) => {
      try {
        const msg = JSON.parse(event.data);
        if (msg.id === id) {
          ws.removeEventListener('message', handler);
          if (msg.error) {
            reject(new Error(msg.error.message));
          } else {
            resolve(msg.result);
          }
        }
      } catch (e) {}
    };
    ws.addEventListener('message', handler);
    ws.send(JSON.stringify({ id, method, params }));
  });
}

async function runBrowserTests() {
  console.log(`--- STARTING EDGE BROWSERS (PORT ${PORT}) FOR GROUP 2 LEAVES TESTS ---`);
  if (!fs.existsSync(EDGE_PATH)) {
    throw new Error('Microsoft Edge not found at: ' + EDGE_PATH);
  }

  const edgeProc = spawn(EDGE_PATH, [
    '--headless=new',
    `--remote-debugging-port=${PORT}`,
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
      const res = await fetch(`http://127.0.0.1:${PORT}/json/version`);
      const data = await res.json();
      if (data && data.webSocketDebuggerUrl) {
        wsUrl = data.webSocketDebuggerUrl;
        break;
      }
    } catch (_) {}
  }

  if (!wsUrl) {
    edgeProc.kill();
    throw new Error(`Failed to connect to Edge debugging port ${PORT}`);
  }

  const browserWs = new WebSocket(wsUrl);
  await new Promise((resolve) => { browserWs.onopen = resolve; });

  const targetRes = await sendCDP(browserWs, 'Target.createTarget', { url: 'about:blank' });
  const targetId = targetRes.targetId;

  const targetWsUrl = `ws://127.0.0.1:${PORT}/devtools/page/${targetId}`;
  const pageWs = new WebSocket(targetWsUrl);
  await new Promise((resolve) => { pageWs.onopen = resolve; });

  await sendCDP(pageWs, 'Page.enable');
  await sendCDP(pageWs, 'Runtime.enable');

  pageWs.addEventListener('message', (e) => {
    try {
      const msg = JSON.parse(e.data);
      if (msg.method === 'Runtime.consoleAPICalled') {
        const text = (msg.params.args || []).map(a => a.value || a.description || '').join(' ');
        if (text && !text.includes('lucide')) console.log('[BROWSER CONSOLE]', msg.params.type, text);
      }
    } catch (_) {}
  });

  const waitForPageLoad = () => new Promise((resolve) => {
    let resolved = false;
    const handler = (e) => {
      try {
        const msg = JSON.parse(e.data);
        if (msg.method === 'Page.loadEventFired') {
          if (!resolved) { resolved = true; pageWs.removeEventListener('message', handler); resolve(); }
        }
      } catch (_) {}
    };
    pageWs.addEventListener('message', handler);
    // Poll readyState as fallback
    const checkReady = async () => {
      if (resolved) return;
      try {
        const res = await sendCDP(pageWs, 'Runtime.evaluate', { expression: 'document.readyState', returnByValue: true });
        if (res && res.result && res.result.value === 'complete') {
          if (!resolved) { resolved = true; pageWs.removeEventListener('message', handler); resolve(); }
        } else { setTimeout(checkReady, 500); }
      } catch (e) { setTimeout(checkReady, 500); }
    };
    setTimeout(checkReady, 500);
    // Ultimate timeout 10s
    setTimeout(() => { if (!resolved) { resolved = true; pageWs.removeEventListener('message', handler); resolve(); } }, 10000);
  });

  const loadP1 = waitForPageLoad();
  await sendCDP(pageWs, 'Page.navigate', { url: TARGET_URL });
  await loadP1;

  let ready = false;
  for (let i = 0; i < 30; i++) {
    await sleep(200);
    const check = await sendCDP(pageWs, 'Runtime.evaluate', {
      expression: 'typeof window.paperussLeaves !== "undefined" && typeof window.paperussLeafManager !== "undefined"',
      returnByValue: true
    });
    if (check.result && check.result.value === true) {
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
        await wait(100); // wait for async renderEditor to complete
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
        console.error('TEST SCRIPT: Calling switchLeaf with noteId:', noteId, 'newLeafId:', newLeafId);
        await window.paperussLeafManager.switchLeaf(noteId, newLeafId);
        await wait(500);
        
        // The new leaf is empty initially (or contains empty placeholder like <br>)
        const currentHtml = document.getElementById('noteBody').innerHTML;
        const currentActiveLeafId = window.paperussLeaves.getNoteActiveLeafId(window.getNote(noteId));
        console.error('TEST SCRIPT: After switchLeaf, currentActiveLeafId is:', currentActiveLeafId);
        console.error('TEST SCRIPT: After switchLeaf, window.currentActiveLeaf is:', JSON.stringify(window.currentActiveLeaf));
        if (! (currentHtml.trim() === '' || currentHtml.includes('<br>') || (!currentHtml.includes('Original Legacy Content') && !currentHtml.includes('Edited Virtual Content')))) {
            console.error('Editor is NOT empty. currentHtml:', currentHtml);
        }
        assert('Editor is empty when switching to new leaf', currentHtml.trim() === '' || currentHtml.includes('<br>') || (!currentHtml.includes('Original Legacy Content') && !currentHtml.includes('Edited Virtual Content')));
        
        // 3. Migration failure preserves note.content (mocking a failure)
        window.createNote();
        await wait(200);
        const noteFailId = window.paperussState.currentId;
        console.error('noteFailId:', noteFailId);
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
        // Before reload, ensure we set active leaf
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

  const res1 = await sendCDP(pageWs, 'Runtime.evaluate', {
    expression: testScript,
    awaitPromise: true,
    returnByValue: true
  });
  const suite1 = res1.result.value;
  suite1.tests.forEach((t) => console.log(`[${t.status}] ${t.name}${t.msg ? ' - ' + t.msg : ''}`));

  console.log('\n--- TESTING BROWSER REFRESH FOR ACTIVE LEAF (Test 4) ---');
  const loadP2 = waitForPageLoad();
  await sendCDP(pageWs, 'Page.reload');
  await loadP2;

  let ready2 = false;
  for (let i = 0; i < 30; i++) {
    await sleep(200);
    const check = await sendCDP(pageWs, 'Runtime.evaluate', {
      expression: 'typeof window.paperussLeaves !== "undefined"',
      returnByValue: true
    });
    if (check.result && check.result.value === true) { ready2 = true; break; }
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
        
        // We know we persisted noteId and set its active leaf ID to the second leaf
        const noteActiveLeaf = window.paperussLeaves.getNoteActiveLeafId({id: noteId});
        assert('Active Leaf survives refresh locally', noteActiveLeaf && noteActiveLeaf.startsWith('leaf_'));
        
        window.jumpToNote(noteId);
        await wait(100);
        
        // We will test 5 & 6 by mocking the active leaf memory and directly invoking editField
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
        window.editField('content', 'State1 Edited'); // this queues a put for rapidLeaf1
        
        await window.paperussLeafManager.switchLeaf(noteId, 'rapid_2');
        // switchLeaf flushes the current leaf
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
        if (created.content !== 'Testing new note') {
            console.error('created.content was:', created.content);
            console.error('currentActiveLeaf was:', JSON.stringify(window.currentActiveLeaf));
        }
        assert('Can edit newly created note', created.content === 'Testing new note');

        await window.paperussLeaves.deleteLeavesDB();
      } catch (err) {
        results.failed++;
        results.tests.push({ name: 'UNCAUGHT REFRESH EXCEPTION', status: 'FAIL', msg: err.message });
      }
      return results;
    })();
  `;

  const res2 = await sendCDP(pageWs, 'Runtime.evaluate', {
    expression: testScript2,
    awaitPromise: true,
    returnByValue: true
  });
  
  const suite2 = res2.result.value;
  suite2.tests.forEach((t) => console.log(`[${t.status}] ${t.name}${t.msg ? ' - ' + t.msg : ''}`));

  try { pageWs.close(); browserWs.close(); edgeProc.kill(); fs.rmSync(TEMP_PROFILE, { recursive: true, force: true }); } catch (_) {}

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
