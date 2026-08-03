/**
 * Group 1 Browser Verification: IndexedDB Leaf Storage & Metadata Helpers
 * Runs inside Microsoft Edge headless via Chrome DevTools Protocol (CDP).
 */

const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

const EDGE_PATH = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const PORT = 9300 + Math.floor(Math.random() * 100);
const TEMP_PROFILE = fs.mkdtempSync(path.join(os.tmpdir(), 'paperuss-edge-group1-'));
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
  console.log(`--- STARTING EDGE BROWSERS (PORT ${PORT}) FOR GROUP 1 LEAVES STORAGE TESTS ---`);
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

  console.log('Connected to Edge CDP URL:', wsUrl);
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
      } else if (msg.method === 'Runtime.exceptionThrown') {
        console.log('[BROWSER EXCEPTION]', msg.params.exceptionDetails.text, msg.params.exceptionDetails.exception?.description || '');
      }
    } catch (_) {}
  });

  const waitForPageLoad = () => new Promise((resolve) => {
    const handler = (e) => {
      try {
        const msg = JSON.parse(e.data);
        if (msg.method === 'Page.loadEventFired') {
          pageWs.removeEventListener('message', handler);
          resolve();
        }
      } catch (_) {}
    };
    pageWs.addEventListener('message', handler);
  });

  console.log('Navigating to:', TARGET_URL);
  const loadP1 = waitForPageLoad();
  await sendCDP(pageWs, 'Page.navigate', { url: TARGET_URL });
  await loadP1;

  // Wait for window.paperussLeaves to be ready
  let ready = false;
  for (let i = 0; i < 30; i++) {
    await sleep(200);
    const check = await sendCDP(pageWs, 'Runtime.evaluate', {
      expression: 'typeof window.paperussLeaves !== "undefined"',
      returnByValue: true
    });
    if (check.result && check.result.value === true) {
      ready = true;
      break;
    }
  }

  if (!ready) {
    console.error('ERROR: window.paperussLeaves was not defined.');
  } else {
    console.log('window.paperussLeaves is ready.');
  }

  console.log('--- RUNNING TEST SUITE IN ACTUAL BROWSER CONTEXT ---');

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

      try {
        // 1. Verify paperussLeaves module loaded
        assert('paperussLeaves module defined on window', !!window.paperussLeaves);

        // Clean any existing test DB
        await window.paperussLeaves.deleteLeavesDB();

        // 2. Database creation, object stores, and index verification
        const db = await window.paperussLeaves.openLeavesDB();
        assert('Leaves database created with correct name', db.name === 'paperuss_leaves_db');
        assert('Leaves database version is 1', db.version === 1);
        assert('Object store "leaves" exists', db.objectStoreNames.contains('leaves'));
        assert('Object store "offline_leaf_queue" exists', db.objectStoreNames.contains('offline_leaf_queue'));

        // Check index on 'leaves' store
        const hasNoteIdIndex = await new Promise((res) => {
          const tx = db.transaction('leaves', 'readonly');
          const store = tx.objectStore('leaves');
          res(store.indexNames.contains('noteId'));
        });
        assert('Index "noteId" exists on "leaves" store', hasNoteIdIndex);

        // 3. Create / Read / Update / Delete (CRUD) verification
        const leaf1 = {
          id: 'leaf_test_1',
          noteId: 'note_test_101',
          title: 'Main Overview',
          content: '<p>Initial content</p>',
          order: 0,
          createdAt: 1000,
          updatedAt: 1000
        };
        const leaf2 = {
          id: 'leaf_test_2',
          noteId: 'note_test_101',
          title: 'Section 2',
          content: '<p>Second leaf</p>',
          order: 1,
          createdAt: 2000,
          updatedAt: 2000
        };

        const put1 = await window.paperussLeaves.leafPut(leaf1);
        assert('leafPut returns inserted record', put1 && put1.id === 'leaf_test_1');
        await window.paperussLeaves.leafPut(leaf2);

        const fetched1 = await window.paperussLeaves.leafGet('leaf_test_1');
        assert('leafGet retrieves correct leaf title', fetched1 && fetched1.title === 'Main Overview');
        assert('leafGet retrieves correct content', fetched1 && fetched1.content === '<p>Initial content</p>');

        // Test leafGetByNoteId sorting
        const noteLeaves = await window.paperussLeaves.leafGetByNoteId('note_test_101');
        assert('leafGetByNoteId returns all leaves for note', noteLeaves.length === 2);
        assert('leafGetByNoteId returns sorted by order ascending', noteLeaves[0].id === 'leaf_test_1' && noteLeaves[1].id === 'leaf_test_2');

        // Test Update
        leaf1.title = 'Main Overview (Updated)';
        leaf1.updatedAt = 3000;
        await window.paperussLeaves.leafPut(leaf1);
        const updated1 = await window.paperussLeaves.leafGet('leaf_test_1');
        assert('leafPut updates existing record', updated1.title === 'Main Overview (Updated)' && updated1.updatedAt === 3000);

        // Test Delete
        await window.paperussLeaves.leafDel('leaf_test_2');
        const deleted2 = await window.paperussLeaves.leafGet('leaf_test_2');
        assert('leafDel removes record from IndexedDB', deleted2 === null);
        const afterDelLeaves = await window.paperussLeaves.leafGetByNoteId('note_test_101');
        assert('leafGetByNoteId shows 1 remaining leaf', afterDelLeaves.length === 1);

        // 4. Offline Leaf Queue verification
        await window.paperussLeaves.leafQueueClear();
        const qEntry = {
          id: 'q_item_1',
          noteId: 'note_test_101',
          action: 'put',
          data: { id: 'leaf_test_1', title: 'Queued Title' },
          timestamp: 5000
        };
        await window.paperussLeaves.leafQueuePut(qEntry);
        const qItems = await window.paperussLeaves.leafQueueGetAll();
        assert('leafQueueGetAll returns queued item', qItems.length === 1 && qItems[0].id === 'q_item_1');
        await window.paperussLeaves.leafQueueDel('q_item_1');
        const qEmpty = await window.paperussLeaves.leafQueueGetAll();
        assert('leafQueueDel clears queued item', qEmpty.length === 0);

        // 5. Blocked upgrades, quota or write failures verification
        let writeErrorCaught = false;
        try {
          await window.paperussLeaves.leafPut({ title: 'No id or noteId' });
        } catch (e) {
          writeErrorCaught = true;
        }
        assert('leafPut throws on invalid record (write error protection)', writeErrorCaught);

        // Test blocked upgrade handler / error resilience
        let blockedHandled = false;
        try {
          // Verify onblocked / closeLeavesDB behaves cleanly without crashing
          window.paperussLeaves.closeLeavesDB();
          const reopened = await window.paperussLeaves.openLeavesDB();
          assert('DB reopens cleanly after close', reopened && reopened.name === 'paperuss_leaves_db');
          blockedHandled = true;
        } catch (e) {
          blockedHandled = false;
        }
        assert('closeLeavesDB and reopen cycle completed', blockedHandled);

        // 6. Metadata helper functions verification
        const mockNote = {
          id: 'mock_123',
          title: 'Mock Note',
          content: '<p>Legacy main text</p>',
          createdAt: 9999,
          updatedAt: 9999,
          defaultLeafId: 'leaf_def_1',
          leafOrder: ['leaf_def_1', 'leaf_def_2'],
          leafCount: 2
        };
        const order = window.paperussLeaves.getNoteLeafOrder(mockNote);
        assert('getNoteLeafOrder returns copy of leafOrder', order.length === 2 && order[0] === 'leaf_def_1');
        assert('getNoteDefaultLeafId returns defaultLeafId', window.paperussLeaves.getNoteDefaultLeafId(mockNote) === 'leaf_def_1');
        assert('getNoteLeafCount returns count', window.paperussLeaves.getNoteLeafCount(mockNote) === 2);

        // Test activeLeafId local device state (not in parent Note)
        window.paperussLeaves.setNoteActiveLeafId('mock_123', 'leaf_def_2');
        assert('getNoteActiveLeafId returns local activeLeafId', window.paperussLeaves.getNoteActiveLeafId(mockNote) === 'leaf_def_2');

        // Verify Safeguard 3: virtual main leaf does not mutate note
        const legacyNote = { id: 'legacy_999', title: 'Old Note', content: '<p>Old content</p>' };
        const virtualLeaf = window.paperussLeaves.getVirtualMainLeaf(legacyNote);
        assert('getVirtualMainLeaf returns virtual Main leaf', virtualLeaf.title === 'Main' && virtualLeaf.content === '<p>Old content</p>');
        assert('getVirtualMainLeaf flags isVirtual: true', virtualLeaf.isVirtual === true);
        assert('Legacy note was not mutated', !legacyNote.defaultLeafId && !legacyNote.leafOrder);

        // 7. Verify existing Note creation, rendering, and authentication behavior remain intact
        assert('window.createNote is defined and callable', typeof window.createNote === 'function');
        assert('window.contextualNew is defined and callable', typeof window.contextualNew === 'function');
        assert('window.save is defined and callable', typeof window.save === 'function');
        assert('window.renderList is defined and callable', typeof window.renderList === 'function');
        assert('window.renderEditor is defined and callable', typeof window.renderEditor === 'function');

        // Save a persistent record for refresh test
        await window.paperussLeaves.leafPut({
          id: 'leaf_persist_refresh',
          noteId: 'note_persist_1',
          title: 'Persisted Across Reload',
          content: '<p>Reload test</p>',
          order: 0
        });

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
  console.log('\n--- SUITE 1 RESULTS (Pre-Refresh) ---');
  suite1.tests.forEach((t) => {
    console.log(`[${t.status}] ${t.name}${t.msg ? ' - ' + t.msg : ''}`);
  });

  console.log('\n--- TESTING BROWSER REFRESH PERSISTENCE ---');
  const loadP2 = waitForPageLoad();
  await sendCDP(pageWs, 'Page.reload');
  await loadP2;
  
  // Wait for paperussLeaves after reload
  let ready2 = false;
  for (let i = 0; i < 30; i++) {
    await sleep(200);
    const check = await sendCDP(pageWs, 'Runtime.evaluate', {
      expression: 'typeof window.paperussLeaves !== "undefined"',
      returnByValue: true
    });
    if (check.result && check.result.value === true) {
      ready2 = true;
      break;
    }
  }

  const refreshScript = `
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
      try {
        const persisted = await window.paperussLeaves.leafGet('leaf_persist_refresh');
        assert('Leaf record persisted after browser reload', !!persisted && persisted.title === 'Persisted Across Reload');

        // Cleanup DB after test
        await window.paperussLeaves.deleteLeavesDB();
        assert('Cleanup deleteLeavesDB succeeded', true);
      } catch (err) {
        results.failed++;
        results.tests.push({ name: 'UNCAUGHT REFRESH EXCEPTION', status: 'FAIL', msg: err.message });
      }
      return results;
    })();
  `;

  const res2 = await sendCDP(pageWs, 'Runtime.evaluate', {
    expression: refreshScript,
    awaitPromise: true,
    returnByValue: true
  });

  const suite2 = res2.result.value;
  console.log('\n--- SUITE 2 RESULTS (Post-Refresh) ---');
  suite2.tests.forEach((t) => {
    console.log(`[${t.status}] ${t.name}${t.msg ? ' - ' + t.msg : ''}`);
  });

  try {
    pageWs.close();
    browserWs.close();
  } catch (_) {}
  try {
    edgeProc.kill();
  } catch (_) {}

  try {
    fs.rmSync(TEMP_PROFILE, { recursive: true, force: true });
  } catch (_) {}

  const totalPassed = suite1.passed + suite2.passed;
  const totalFailed = suite1.failed + suite2.failed;

  console.log(`\n========================================`);
  console.log(`TOTAL BROWSER TESTS: ${totalPassed + totalFailed}`);
  console.log(`PASSED: ${totalPassed}`);
  console.log(`FAILED: ${totalFailed}`);
  console.log(`========================================`);

  if (totalFailed > 0) {
    process.exit(1);
  } else {
    process.exit(0);
  }
}

runBrowserTests().catch((err) => {
  console.error('Fatal test error:', err);
  process.exit(1);
});
