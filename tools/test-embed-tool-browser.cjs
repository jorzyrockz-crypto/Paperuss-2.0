/**
 * PapeRuss 2.1.8 — Embed Tool Browser Verification Suite
 * Runs inside Microsoft Edge headless via Chrome DevTools Protocol (CDP).
 */

const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

const cdp = require('./cdp-client.cjs');
const BROWSER_PATH = cdp.getBrowserPath();
const PORT = 9388;
const TEMP_PROFILE = fs.mkdtempSync(path.join(os.tmpdir(), 'paperuss-edge-embeds-'));
const TARGET_URL = 'file:///' + path.resolve(__dirname, '../index.html').replace(/\\/g, '/');

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function runBrowserTests() {
  console.log(`--- STARTING BROWSER (${BROWSER_PATH}) FOR PAPERUSS 2.1.8 EMBED TOOL TESTS ---`);
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

  console.log('Connected to Page CDP URL:', wsUrl);
  const client = await cdp.connect(wsUrl);

  await client.send('Page.enable');
  await client.send('Runtime.enable');

  client.onEvent((msg) => {
    try {
      if (msg.method === 'Runtime.consoleAPICalled') {
        const text = (msg.params.args || []).map(a => a.value || a.description || '').join(' ');
        if (text && !text.includes('lucide') && !text.includes('Failed to load resource')) {
          console.log('[BROWSER CONSOLE]', msg.params.type, text);
        }
      } else if (msg.method === 'Runtime.exceptionThrown') {
        console.log('[BROWSER EXCEPTION]', msg.params.exceptionDetails.text, msg.params.exceptionDetails.exception?.description || '');
      }
    } catch (_) {}
  });

  const waitForPageLoad = () => new Promise((resolve) => {
    let resolved = false;
    client.onEvent((msg) => {
      if (!resolved && msg.method === 'Page.loadEventFired') {
        resolved = true;
        resolve();
      }
    });
  });

  console.log('Navigating to:', TARGET_URL);
  const loadP1 = waitForPageLoad();
  await client.send('Page.navigate', { url: TARGET_URL });
  await loadP1;

  // Wait for window.detectEmbedProvider to be ready
  let ready = false;
  for (let i = 0; i < 30; i++) {
    await sleep(200);
    const check = await client.send('Runtime.evaluate', {
      expression: 'typeof window.detectEmbedProvider === "function"',
      returnByValue: true
    });
    if (check.result && check.result.value === true) {
      ready = true;
      break;
    }
  }

  if (!ready) {
    console.error('ERROR: window.detectEmbedProvider was not defined.');
  } else {
    console.log('window.detectEmbedProvider is ready.');
  }

  console.log('--- RUNNING EMBED TOOL VERIFICATION SUITE IN ACTUAL BROWSER ---');

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
        // 1. Verify all 9 provider detections + variations + fallback
        const detect = window.detectEmbedProvider;
        assert('YouTube detection (watch URL)', detect('https://www.youtube.com/watch?v=dQw4w9WgXcQ').provider === 'youtube' && detect('https://www.youtube.com/watch?v=dQw4w9WgXcQ').providerName === 'YouTube');
        assert('YouTube detection (youtu.be)', detect('https://youtu.be/dQw4w9WgXcQ').provider === 'youtube');
        assert('YouTube detection (shorts URL)', detect('https://www.youtube.com/shorts/abcdefg12345').provider === 'youtube');
        assert('Vimeo detection', detect('https://vimeo.com/123456789').provider === 'vimeo' && detect('https://vimeo.com/123456789').providerName === 'Vimeo');
        assert('Spotify detection (track)', detect('https://open.spotify.com/track/4cOdK2wGLETKBW3PvgPWqT').provider === 'spotify');
        assert('SoundCloud detection', detect('https://soundcloud.com/artist/track-name-here').provider === 'soundcloud');
        assert('TikTok detection', detect('https://www.tiktok.com/@user/video/1234567890123456789').provider === 'tiktok');
        assert('Instagram detection (post)', detect('https://www.instagram.com/p/abcdef12345/').provider === 'instagram');
        assert('Instagram detection (reel)', detect('https://www.instagram.com/reel/abcdef12345/').provider === 'instagram');
        assert('Facebook detection (post URL)', detect('https://www.facebook.com/user/posts/123456789').provider === 'facebook');
        assert('X / Twitter detection', detect('https://x.com/username/status/1234567890123456789').provider === 'x' && detect('https://x.com/username/status/1234567890123456789').providerName === 'X / Twitter');
        assert('Google Maps detection', detect('https://www.google.com/maps/place/Eiffel+Tower/').provider === 'google-maps');
        assert('Fallback provider detection', detect('https://example.com/some/article') === null);

        // Facebook iframe HTML extraction & sanitization
        const rawIframe = '<iframe src="https://www.facebook.com/plugins/post.php?href=https%3A%2F%2Fwww.facebook.com%2F20531316728%2Fposts%2F10154009990506729%2F&width=500" width="500" height="588"></iframe>';
        const fbInfo = detect(rawIframe);
        assert('Facebook iframe extraction provider', fbInfo && fbInfo.provider === 'facebook');
        assert('Facebook iframe extraction canonical URL', fbInfo && fbInfo.canonicalUrl === 'https://www.facebook.com/20531316728/posts/10154009990506729/');
        assert('Facebook iframe embedUrl validated', fbInfo && fbInfo.embedUrl.startsWith('https://www.facebook.com/plugins/post.php?href='));

        // 2. Canonical Embed HTML generation
        const build = window.buildCanonicalEmbedHtml;
        const html = build({
          provider: 'youtube',
          providerName: 'YouTube',
          canonicalUrl: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
          embedUrl: 'https://www.youtube.com/embed/dQw4w9WgXcQ',
          title: 'Never Gonna Give You Up',
          description: 'Rick Astley Official Music Video',
          thumbnail: '',
          displayMode: 'preview',
          widthPreset: 'medium'
        });

        assert('Canonical HTML has data-paperuss-embed="true"', html.includes('data-paperuss-embed="true"'));
        assert('Canonical HTML is contenteditable="false"', html.includes('contenteditable="false"'));
        assert('Canonical HTML has preview mode class', html.includes('embed-mode-preview'));
        assert('Canonical HTML has width preset class', html.includes('embed-width-medium'));
        assert('Canonical HTML has NO editor toolbar', !html.includes('embed-editor-toolbar'));
        assert('Canonical HTML has NO live iframe player', !html.includes('embed-live-player-wrap'));

        // 3. Hydration and Dehydration in real DOM
        const container = document.createElement('div');
        container.id = 'noteBody';
        container.innerHTML = build({
          provider: 'youtube',
          providerName: 'YouTube',
          canonicalUrl: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
          embedUrl: 'https://www.youtube.com/embed/dQw4w9WgXcQ',
          title: 'Demo Video',
          description: 'Test description',
          displayMode: 'interactive',
          widthPreset: 'large'
        });

        assert('Before hydration: 0 toolbars', container.querySelectorAll('.embed-editor-toolbar').length === 0);
        window.hydrateEmbeds(container);
        const tb = container.querySelector('.embed-editor-toolbar');
        assert('After hydration: toolbar injected', !!tb);
        assert('Toolbar has Edit URL button', !!(tb && tb.querySelector('[data-action="edit-url"]')));
        assert('Toolbar has Mode select', !!(tb && tb.querySelector('select[data-action="mode"]')));
        assert('Toolbar has Width select', !!(tb && tb.querySelector('select[data-action="width"]')));
        assert('Toolbar has Refresh metadata button', !!(tb && tb.querySelector('[data-action="refresh"]')));
        assert('Toolbar has Open source button', !!(tb && tb.querySelector('a[title="Open Source"]')));
        assert('Toolbar has Copy link button', !!(tb && tb.querySelector('[data-action="copy"]')));
        assert('Toolbar has Remove button', !!(tb && tb.querySelector('[data-action="remove"]')));

        const liveWrap = container.querySelector('.embed-live-player-wrap');
        assert('Interactive mode injects live player wrap', !!liveWrap);
        const iframe = liveWrap.querySelector('iframe');
        assert('Interactive mode injects iframe', !!iframe);
        assert('iframe has security sandbox attribute', iframe && (iframe.getAttribute('sandbox') || '').includes('allow-scripts'));

        // Dehydrate
        window.dehydrateEmbeds(container);
        assert('After dehydration: 0 toolbars', container.querySelectorAll('.embed-editor-toolbar').length === 0);
        assert('After dehydration: 0 live players', container.querySelectorAll('.embed-live-player-wrap').length === 0);
        assert('After dehydration: 0 iframes', container.querySelectorAll('iframe').length === 0);

        // 4. Sanitization (cleanInternalEditorUI and sanitizeNoteHTML)
        window.hydrateEmbeds(container);
        assert('Toolbar exists before cleanInternalEditorUI', !!container.querySelector('.embed-editor-toolbar'));
        const cleanHTML = window.cleanInternalEditorUI(container.innerHTML);
        assert('cleanInternalEditorUI removes embed toolbar', !cleanHTML.includes('embed-editor-toolbar'));
        assert('cleanInternalEditorUI removes iframe', !cleanHTML.includes('<iframe'));
        assert('cleanInternalEditorUI preserves canonical embed card', cleanHTML.includes('data-paperuss-embed="true"'));
        assert('cleanInternalEditorUI preserves title text', cleanHTML.includes('Demo Video'));

        const sanitized = window.sanitizeNoteHTML(cleanHTML);
        assert('sanitizeNoteHTML preserves canonical embed card', sanitized.includes('data-paperuss-embed="true"'));

        // 5. Toolbar button & Modal UI integration
        const btn = document.getElementById('embedToolBtn');
        assert('Embed toolbar button exists with id="embedToolBtn"', !!btn);
        assert('Embed toolbar button has data-cmd="embedTool"', btn && btn.getAttribute('data-cmd') === 'embedTool');
        assert('openEmbedModal is exported on window', typeof window.openEmbedModal === 'function');

        // Test opening modal
        window.openEmbedModal();
        const modal = document.querySelector('.embed-modal-card');
        assert('openEmbedModal creates modal dialog', !!modal);
        if (modal) {
          const closeBtn = modal.querySelector('button');
          if (closeBtn) closeBtn.click();
        }

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
  console.log('\n--- BROWSER VERIFICATION RESULTS ---');
  if (suite1 && suite1.tests) {
    suite1.tests.forEach((t) => {
      console.log(`[${t.status}] ${t.name}${t.msg ? ' - ' + t.msg : ''}`);
    });
  } else {
    console.error('Failed to receive valid test results from browser:', res1);
  }

  try {
    client.close();
  } catch (_) {}
  try {
    browserProc.kill();
  } catch (_) {}

  try {
    fs.rmSync(TEMP_PROFILE, { recursive: true, force: true });
  } catch (_) {}

  const totalPassed = suite1 ? suite1.passed : 0;
  const totalFailed = suite1 ? suite1.failed : 1;

  console.log(`\n========================================`);
  console.log(`TOTAL EMBED TOOL TESTS: ${totalPassed + totalFailed}`);
  console.log(`PASSED: ${totalPassed}`);
  console.log(`FAILED: ${totalFailed}`);

  if (totalFailed > 0) {
    process.exit(1);
  }
}

runBrowserTests().catch((err) => {
  console.error('Fatal test error:', err);
  process.exit(1);
});
