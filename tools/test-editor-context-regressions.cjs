const fs = require('node:fs');
const { JSDOM } = require('jsdom');

const read = file => fs.readFileSync(file, 'utf8');
const assert = (condition, message) => {
  if (!condition) throw new Error(message);
};
const createDom = html => new JSDOM(`<!doctype html><body>${html}</body>`, {
  runScripts: 'outside-only',
  url: 'http://localhost/'
});
const extractFunction = (source, name) => {
  const start = source.indexOf(`function ${name}`);
  assert(start >= 0, `${name} is missing`);
  const open = source.indexOf('{', start);
  let depth = 0;
  for (let i = open; i < source.length; i += 1) {
    if (source[i] === '{') depth += 1;
    else if (source[i] === '}' && --depth === 0) return source.slice(start, i + 1);
  }
  throw new Error(`${name} is unterminated`);
};

function testFormattingSelection() {
  const dom = createDom('<div id="noteBody" contenteditable="true"><p id="p">Hello world</p></div>');
  const { window } = dom;
  const { document } = window;
  const note = { id: 'n1' };
  window.bodyEl = () => document.getElementById('noteBody');
  window.handleBodyInput = () => {};
  window.updateToolbarState = () => {};
  window.toast = () => {};
  window.save = () => {};
  window.state = { currentId: note.id };
  window.getNote = () => note;
  window.HistoryManager = { capture() {} };
  document.execCommand = (command, _ui, value) => {
    if (command !== 'formatBlock') return true;
    const selection = window.getSelection();
    let block = selection.anchorNode.nodeType === 3 ? selection.anchorNode.parentElement : selection.anchorNode;
    block = block.closest('p,h1,h2,h3,h4');
    const replacement = document.createElement(String(value).replace(/[<>]/g, ''));
    replacement.innerHTML = block.innerHTML;
    block.replaceWith(replacement);
    const range = document.createRange();
    range.selectNodeContents(replacement);
    selection.removeAllRanges();
    selection.addRange(range);
    return true;
  };

  window.eval(read('js/formatting.js'));
  window.eval(read('js/editor-ui.js'));

  const quotePicker = document.createElement('div');
  quotePicker.id = 'quotePicker';
  quotePicker.innerHTML = '<button id="quoteBtn"></button><div id="quoteStyleDropdown" class="quote-style-dropdown"></div>';
  document.body.appendChild(quotePicker);
  window.toggleDropdown('quoteStyleDropdown');
  const quoteDropdown = document.getElementById('quoteStyleDropdown');
  assert(quoteDropdown.parentElement === document.body, 'Quote dropdown was not portaled out of the toolbar');
  assert(quoteDropdown.classList.contains('show'), 'Quote dropdown did not open');

  let text = document.querySelector('#p').firstChild;
  let range = document.createRange();
  range.setStart(text, 0);
  range.setEnd(text, 5);
  window.getSelection().removeAllRanges();
  window.getSelection().addRange(range);
  assert(window.captureEditorFormattingSelection(), 'Selection capture failed');
  window.getSelection().removeAllRanges();
  assert(window.restoreEditorFormattingSelection(), 'Selection restore failed');
  window.applyFontStyle('rounded');
  const span = document.querySelector('#noteBody span');
  assert(span?.textContent === 'Hello', 'Highlighted font did not wrap the selected text');
  assert(/Trebuchet MS/.test(span.style.fontFamily), 'Rounded font fallback is missing');

  const fontExpectations = {
    sans: 'Segoe UI', calibri: 'Calibri', segoe: 'Segoe UI', serif: 'Georgia',
    mono: 'Consolas', arial: 'Arial', bookman: 'Bookman Old Style',
    oldenglish: 'Kunstler Script', rounded: 'Trebuchet MS'
  };
  Object.entries(fontExpectations).forEach(([fontStyle, expectedFamily]) => {
    document.getElementById('noteBody').innerHTML = '<p id="font-target">Font sample</p>';
    const fontText = document.querySelector('#font-target').firstChild;
    const fontRange = document.createRange();
    fontRange.selectNodeContents(fontText);
    window.getSelection().removeAllRanges();
    window.getSelection().addRange(fontRange);
    window.applyFontStyle(fontStyle);
    const fontSpan = document.querySelector('#font-target span');
    assert(fontSpan?.textContent === 'Font sample', `${fontStyle} did not apply to highlighted text`);
    assert(fontSpan.style.fontFamily.includes(expectedFamily), `${fontStyle} is missing its reliable fallback stack`);
  });

  document.getElementById('noteBody').innerHTML = '<p id="heading">Creative heading</p>';
  text = document.querySelector('#heading').firstChild;
  range = document.createRange();
  range.setStart(text, 0);
  range.setEnd(text, text.length);
  window.getSelection().removeAllRanges();
  window.getSelection().addRange(range);
  window.applyParagraphStyle('h1:banner');
  assert(document.querySelector('h1')?.dataset.headingStyle === 'banner', 'Creative heading style was not applied');

  document.getElementById('noteBody').innerHTML = '<blockquote id="quote">Quoted text</blockquote>';
  const quote = document.getElementById('quote');
  range = document.createRange();
  range.selectNodeContents(quote);
  window.getSelection().removeAllRanges();
  window.getSelection().addRange(range);
  assert(window.applyQuotePresetStyle('literary', quote), 'Quote preset helper did not find the active quote');
  assert(quote.dataset.quoteStyle === 'literary', 'Quote preset was not applied');
  assert(quote.style.textAlign === 'center' && quote.style.fontStyle === 'italic', 'Quote preset theme did not apply independently of the stylesheet');
  assert(window.clearQuoteFormatting(quote), 'Clear Quote action failed');
  assert(document.querySelector('#noteBody > p')?.textContent === 'Quoted text' && !document.querySelector('blockquote'), 'Clear Quote did not return the row to normal text');

  document.getElementById('noteBody').innerHTML = '<p id="quote-source">Create a quote</p>';
  const quoteSource = document.getElementById('quote-source');
  range = document.createRange();
  range.selectNodeContents(quoteSource);
  window.getSelection().removeAllRanges();
  window.getSelection().addRange(range);
  assert(window.applyQuotePresetStyle('tech', null, true), 'Quote preset did not create a quote from the selection');
  assert(document.querySelector('blockquote')?.dataset.quoteStyle === 'tech', 'Created quote did not receive its preset');
}

function testHeaderFooterEditing() {
  const dom = createDom('<div id="editorScroll" class="wysiwyg-mode"><div id="noteBody"><p>Body</p></div></div>');
  const { window } = dom;
  const { document } = window;
  const note = {
    id: 'note123456',
    title: 'Document',
    customHeaderTitle: 'Brand',
    customSubtitle: 'Subtitle',
    customFooterText: 'Confidential'
  };
  let saves = 0;
  let bodyInputs = 0;
  window.state = { currentId: note.id };
  window.getNote = () => note;
  window.activeNoteForAction = () => note;
  window.save = () => { saves += 1; };
  window.toast = () => {};
  window.bodyEl = () => document.getElementById('noteBody');
  window.handleBodyInput = () => {};
  window.updateToolbarState = () => {};
  window.HistoryManager = { capture() {} };
  window.requestAnimationFrame = callback => { callback(); return 1; };
  window.cancelAnimationFrame = () => {};
  window.lucide = { createIcons() {} };
  document.getElementById('noteBody').addEventListener('input', () => { bodyInputs += 1; });

  window.eval(read('js/stabilization.js'));
  window.eval(read('js/page-layout-engine.js'));
  window.eval(read('js/formatting.js'));
  window.PageLayoutEngine.recalculate(note);

  const header = document.querySelector('[data-header-field="content"]');
  const footer = document.querySelector('[data-footer-field="ref"]');
  assert(header?.textContent === 'Brand • Subtitle', 'Legacy custom header text was not carried into the unified header');
  assert(header.getAttribute('contenteditable') === 'true', 'Document header is not editable');
  assert(!document.querySelector('[data-header-field="note-title"]'), 'Generated note title still appears in the document header');
  assert(footer?.textContent === 'Confidential', 'Custom footer text was not rendered');
  assert(document.getElementById('noteBody').dataset.documentStyle === 'executive', 'WYSIWYG document aesthetic was not exposed to CSS');

  note._headerResized = true;
  note.headerHeight = '74px';
  document.getElementById('noteBody').style.paddingTop = '74px';
  Object.defineProperty(header.closest('.pv-header-overlay'), 'offsetHeight', { configurable: true, value: 130 });

  header.textContent = 'A true document header';
  header.dispatchEvent(new window.InputEvent('input', { bubbles: true, inputType: 'insertText', data: 'x' }));
  assert(note.customHeaderContent === 'A true document header', 'Unified header edit was not persisted');
  assert(!('customHeaderTitle' in note) && !('customSubtitle' in note), 'Legacy split header values were not retired after editing');
  assert(bodyInputs === 0, 'Header input leaked into note-body persistence');
  assert(saves > 0, 'Header edit did not save');
  assert(document.getElementById('noteBody').style.paddingTop === '74px', 'Header content incorrectly added space above the header');
  assert(header.closest('.pv-header-overlay').style.minHeight === '50px', 'Legacy manual header size was not migrated to a content minimum');

  header.innerHTML = '<strong>First row</strong><div>Second row</div><div>Third row</div>';
  header.dispatchEvent(new window.InputEvent('input', { bubbles: true, inputType: 'insertParagraph' }));
  assert(note.customHeaderContent === 'First row\nSecond row\nThird row', 'Header rows collapsed while saving');
  assert(/<strong>First row<\/strong>/.test(note.customHeaderHtml), 'Header rich formatting was not persisted');
  window.PageLayoutEngine.recalculate(note);
  const rebuiltHeader = document.querySelector('[data-header-field="content"]');
  assert(rebuiltHeader.querySelectorAll(':scope > div').length === 2, 'Header rows collapsed when pagination rebuilt the header');
  assert(rebuiltHeader.querySelector('strong'), 'Header rich formatting was lost when pagination rebuilt the header');

  const headerRow = rebuiltHeader.closest('.pv-header-content');
  headerRow.dispatchEvent(new window.MouseEvent('pointerdown', { bubbles: true, clientX: 0 }));
  assert(document.activeElement?.classList.contains('pv-editable-field'), 'Clicking the header row did not route focus to an editable field');

  const range = document.createRange();
  range.selectNodeContents(rebuiltHeader);
  window.getSelection().removeAllRanges();
  window.getSelection().addRange(range);
  document.dispatchEvent(new window.Event('selectionchange'));
  const panel = document.getElementById('hfContextPanel');
  assert(panel && !panel.classList.contains('hidden') && panel.style.display === 'flex', 'Header/footer toolbar did not float');
  assert(panel.classList.contains('img-toolbar') && panel.classList.contains('show'), 'Header toolbar does not reuse the image toolbar surface');
  assert(Array.from(panel.querySelectorAll('button')).every(button => button.classList.contains('itb-btn')), 'Header controls do not reuse image toolbar buttons');
  assert(panel.querySelectorAll('button[data-hf-theme]').length === 6, 'Header/footer theme controls are missing');
  assert(panel.querySelectorAll('button[data-hf-command]').length === 0, 'Header/footer toolbar still duplicates the main formatting controls');
  assert(panel.parentElement === rebuiltHeader.closest('.pv-header-overlay'), 'Header toolbar was not anchored to the active header');
  assert(panel.style.top === 'calc(100% + 8px)', 'Header toolbar was not positioned below the editable header');
  assert(panel.style.position === 'absolute', 'Header toolbar still depends on viewport positioning');
  assert(panel.style.getPropertyPriority('transform') === 'important', 'Critical toolbar positioning can still be overridden by stale CSS');
  assert(rebuiltHeader.closest('.pv-header-overlay').classList.contains('hf-toolbar-active'), 'Header did not reserve space for its toolbar');

  document.execCommand = command => {
    if (command === 'bold') rebuiltHeader.innerHTML = `<strong>${rebuiltHeader.innerHTML}</strong>`;
    if (command === 'removeFormat') rebuiltHeader.textContent = rebuiltHeader.textContent;
    return true;
  };
  window.applyCommand('bold');
  assert(/<strong>/.test(note.customHeaderHtml), 'Main editor toolbar did not apply and save header formatting');
  window.applyCommand('removeFormat');
  assert(!/<strong>/.test(note.customHeaderHtml), 'Main editor toolbar could not return header content to normal formatting');

  panel.querySelector('[data-hf-theme="serif"]').click();
  assert(note.documentStyle === 'serif', 'Header toolbar did not save the document aesthetic');
  assert(document.getElementById('noteBody').dataset.documentStyle === 'serif', 'Selected aesthetic was not applied to WYSIWYG');

  delete note.customHeaderContent;
  delete note.customHeaderHtml;
  window.PageLayoutEngine.recalculate(note);
  const blankHeader = document.querySelector('[data-header-field="content"]');
  assert(blankHeader && blankHeader.textContent === '', 'A new document header did not start empty');

  note.showHeader = false;
  note.showFooter = false;
  note.showPageNums = false;
  window.PageLayoutEngine.recalculate(note);
  assert(!document.querySelector('.pv-header-overlay, .pv-footer-overlay'), 'Clean editor preset did not hide document chrome');
  dom.window.close();
}

function testLeaflinePalette() {
  const dom = createDom(`
    <button id="tabDrawerLeaves"></button><button id="tabDrawerLeafline"></button>
    <div id="leavesDrawerContent"></div><div id="notesContainer"></div>
    <div id="editorScroll"><div id="noteBody">
      <h1>Document title</h1><h2>First section</h2>
      <div data-paperuss-page-ui="true"><h2>Generated page heading</h2></div>
    </div></div>
  `);
  const { window } = dom;
  window.state = { drawerMode: 'leaves', listMode: 'notes' };
  let leavesRenders = 0;
  window.renderLeavesList = () => { leavesRenders += 1; };
  window.eval(read('js/leafline.js'));

  window.setDrawerMode('leafline');
  const items = window.document.querySelectorAll('#leavesDrawerContent .leafline-item');
  assert(items.length === 2, 'Leaves Palette Leafline did not render the current document outline');
  assert(items[0].textContent.includes('Document title'), 'Leafline omitted a standard H1 heading');
  assert(window.document.querySelector('.leafline-track') && window.document.querySelectorAll('.leafline-dot').length === 2, 'Leafline timeline structure is missing');
  assert(items[0].querySelector('.leafline-item-meta')?.textContent.includes('Primary heading'), 'Leafline hierarchy metadata is missing');
  assert(!window.document.getElementById('leavesDrawerContent').textContent.includes('Generated page heading'), 'Leafline included generated page chrome');
  assert(window.document.getElementById('leavesDrawerContent').textContent.includes('All Leaflines'), 'Leafline scope control is missing');
  window.setDrawerMode('leaves');
  assert(leavesRenders === 1, 'Leaves Palette could not switch back from Leafline');

  const core = read('js/core.js');
  const html = read('app.html');
  const coreCss = read('assets/css/core.css');
  assert(/state\.drawerMode === 'leafline'[\s\S]*?window\.renderLeafline\(contentEl\)/.test(core), 'Opening Leaves Palette does not preserve Leafline mode');
  assert(/id="listModeSelector" role="tablist"/.test(html), 'Notes, Leaves, and Leafline are not exposed as an accessible segmented view switch');
  assert(/\.mode-selector-wrap\{[\s\S]*?grid-template-columns:repeat\(3,minmax\(0,1fr\)\)/.test(coreCss), 'List view switch is not using the compact three-segment layout');
  assert(/btn\.setAttribute\('aria-selected'/.test(core), 'List view accessibility state is not synchronized');
  const leafline = read('js/leafline.js');
  assert(/leafGet\(leafId\)/.test(leafline) && /state\.currentId !== noteId/.test(leafline), 'All Leaflines is not restricted to the current Note');
  assert(/openLeaflineEntry/.test(leafline) && /switchLeafAction\(entry\.leafId\)/.test(leafline), 'All Leaflines cannot open the owning Leaf');
  dom.window.close();
}

function testEditorOwnedPrintSettings() {
  const html = read('app.html');
  const actions = read('js/actions.js');
  const editorUi = read('js/editor-ui.js');
  const featuresCss = read('assets/css/features.css');
  assert(/data-prop="preset" data-val="formal"/.test(html), 'Formal layout preset is missing from the editor');
  assert(/data-prop="preset" data-val="clean"/.test(html), 'Clean layout preset is missing from the editor');
  assert((html.match(/data-prop="style"/g) || []).length === 7, 'Document aesthetics are not fully available in editor page setup');
  assert(/data-prop="style" data-val="standard"/.test(html), 'Clear Aesthetic is missing from editor page setup');
  assert(/data-prop="margin" data-val="binding"/.test(html), 'Binding / Thesis margin is missing from editor page setup');
  assert(/data-cmd="removeFormat"/.test(html), 'Main document toolbar is missing normal/clear formatting');
  assert(/@page :right/.test(actions) && /@page :left/.test(actions), 'Binding margin does not mirror the inner gutter for printed pages');
  assert(!/\.pv-page-divider\s*\{|\.pv-page-label\s*\{/.test(featuresCss), 'Obsolete labeled pagination divider CSS is still present');
  assert(!/repeating-linear-gradient\(to bottom/.test(editorUi), 'The obsolete repeating page-break line is still painted through document content');
  assert(!/prompt\(['"]Rename leaf:/.test(actions), 'Leaf rename still uses the native browser prompt');
  assert(/requestLeafRename/.test(actions) && /leaf-rename-modal/.test(actions), 'Leaf rename app modal is missing');
  assert(/data-qstyle="clear"/.test(html), 'Quote menu is missing Clear Quote');
  assert(!/id="pmDocumentStyle"|id="pmPresetFormal"|id="pmPresetClean"|id="pmCustomTitle"|id="pmCustomSubtitle"/.test(actions), 'Editor-owned settings remain duplicated in the print modal');
  assert(/note\.documentStyle \|\| savedPrefs\.documentStyle/.test(actions), 'Print does not prefer the note aesthetic');
  assert(/note\.customHeaderContent/.test(actions), 'Print does not consume the editable document header');
  assert(/id="pmShowMetadata"/.test(actions) && /id="pmShowReference"/.test(actions), 'Generated print metadata and reference marks are not independently configurable');
  assert(/showHeader \|\| showMetadata/.test(actions), 'Print header cannot render metadata independently from the document header');
  assert(/showFooter \|\| showReference/.test(actions), 'Print footer cannot render reference marks independently from the document footer');
  assert(!/Header & Metadata|Footer & QR Reference Code/.test(actions), 'Print modal still bundles editor content with generated print elements');
  assert(/preservePreparedPrintSheetOnce\s*=\s*true;[\s\S]*?window\.print\(\)/.test(actions), 'Modal print options are not protected through the browser beforeprint event');
  assert(/beforeprint[\s\S]*?if \(preservePreparedPrintSheetOnce\)[\s\S]*?return;/.test(actions), 'beforeprint still overwrites the modal-configured print sheet');
  assert(/showReference:\s*typeof prefs\.showReference === 'boolean'/.test(actions), 'Native printing does not reuse the saved reference toggle');
  assert(/showMetadata:\s*typeof prefs\.showMetadata === 'boolean'/.test(actions), 'Native printing does not reuse the saved metadata toggle');
  assert(/class="ps-document-title"/.test(actions) && /class="ps-document-flow"/.test(actions), 'Print document hierarchy is missing its stable layout hooks');
  assert(!/#printSheet\[data-print-theme="[^"]+"\]\s*\*/.test(featuresCss), 'Print aesthetics still override fonts on every formatted descendant');
  assert(!/\[data-theme="dark"\] #printSheet \.ps-content \*/.test(featuresCss), 'Dark mode still overrides every printed text color');
  assert(/#printSheet \.ps-content thead\{display:table-header-group\}/.test(featuresCss), 'Printed tables do not repeat their header row across pages');
  assert(/#printSheet \.ps-content tr\{break-inside:avoid/.test(featuresCss), 'Printed table rows can split across pages');
}

function testPrintContentSanitization() {
  const source = read('js/actions.js');
  const dom = createDom('');
  const { window } = dom;
  window.eval(extractFunction(source, 'sanitizeContentForPrint'));
  const output = window.sanitizeContentForPrint(
    '<div class="pv-header-overlay" data-paperuss-page-ui="true">Leaked header</div>'
      + '<p data-pv-break-pushed="true" style="margin-top:240px;color:red">Body</p>'
      + '<div class="pv-footer-overlay">Leaked footer</div><div class="pv-page-gap">Gap</div>'
      + '<table><tbody><tr><th>Column</th></tr><tr><td>Value</td></tr></tbody></table>'
      + '<span class="productivity-ref-inline pref-delete-selected" style="outline:2px solid blue;box-shadow:0 0 8px blue">Reference</span>',
    'Document'
  );
  const wrapper = window.document.createElement('div');
  wrapper.innerHTML = output;
  assert(!wrapper.querySelector('.pv-header-overlay,.pv-footer-overlay,.pv-page-gap,[data-paperuss-page-ui]'), 'Editor page chrome leaked into print content');
  const body = wrapper.querySelector('p');
  assert(body && !body.hasAttribute('data-pv-break-pushed') && !body.style.marginTop, 'Editor pagination offset leaked into print content');
  assert(wrapper.querySelector('table > thead > tr > th'), 'Printed table header was not normalized into a repeatable thead');
  const ref = wrapper.querySelector('.productivity-ref-inline');
  assert(ref && !ref.classList.contains('pref-delete-selected') && !ref.style.outline && !ref.style.boxShadow, 'Active editor selection decoration leaked into print content');
  dom.window.close();
}

function testPageChromeSanitization() {
  const source = read('js/actions.js');
  const pageLayout = read('js/page-layout-engine.js');
  const dom = createDom('');
  dom.window.sanitizeNoteHTML = value => value;
  dom.window.eval(extractFunction(source, 'sanitizeForStorage'));
  const input = '<p data-pv-break-pushed="true" style="margin-top:120px;color:red">Body</p>'
    + '<div class="pv-header-overlay" data-paperuss-page-ui="true">Header</div>'
    + '<div class="pv-page-divider">PAGE 2</div><div class="pv-page-gap" data-paperuss-page-ui="true"></div><div class="pv-footer-overlay">Footer</div>';
  const output = dom.window.sanitizeForStorage(input);
  assert(!/pv-header|pv-footer|pv-page-divider|pv-page-gap|data-pv-break-pushed|margin-top/.test(output), 'Page-view UI leaked into stored content');
  assert(!/divider\.className\s*=\s*['"]pv-page-divider|pv-page-label/.test(pageLayout), 'Pagination engine still creates the visible PAGE divider');
  assert(/pageGap\.className\s*=\s*['"]pv-page-gap/.test(pageLayout), 'Word-style page gap is missing from the pagination engine');
  assert(/keepHeadingWithNext/.test(pageLayout), 'Heading keep-with-next pagination rule is missing');
  assert(/dataset\.pageCount/.test(pageLayout), 'Completed page count is not exposed by the pagination engine');
  assert(/const PAGE_GAP_HEIGHT = 42;/.test(pageLayout), 'Modern page-view spacing is not synchronized with the pagination engine');
  assert(/Body/.test(output), 'Real note content was removed');
}

function testModernPageSurface() {
  const css = read('assets/css/features.css');
  assert(/\.wysiwyg-paper\s*\{[\s\S]*?border-radius:\s*12px\s*!important;[\s\S]*?border:\s*0\s*!important;/.test(css), 'Paper surface still has the harsh square outline');
  assert(/\.pv-page-gap::before,[\s\S]*?\.pv-page-gap::after/.test(css), 'Curved page-edge caps are missing from the page gap');
  assert(/\.pv-header-overlay\s*\{[\s\S]*?padding:\s*14px 12px 8px\s*!important;/.test(css), 'Page headers do not have comfortable edge spacing');
  assert(/\.pv-footer-overlay\s*\{[\s\S]*?padding:\s*8px 12px 14px\s*!important;/.test(css), 'Page footers do not have comfortable edge spacing');
  assert(!/data-document-style="vintage"[^}]*\.pv-footer-overlay\s*\{[^}]*border-style:\s*double/.test(css), 'Vintage styling still creates a full footer outline');
}

function testCustomCursorAssets() {
  const css = read('assets/css/core.css');
  const serviceWorker = read('sw.js');
  assert(fs.existsSync('assets/cursors/paperuss-cursor.svg'), 'Original PapeRuss cursor asset was removed');
  assert(fs.existsSync('assets/cursors/paperuss-pointer.svg'), 'PapeRuss pointer asset was removed');
  assert(fs.existsSync('assets/cursors/paperuss-caret.svg'), 'Thin modern caret asset is missing');
  assert(fs.existsSync('assets/cursors/paperuss-text-caret.svg'), 'Thin text I-beam cursor asset is missing');
  assert(/paperuss-caret\.svg/.test(css), 'Thin modern caret is not the app default cursor');
  assert(/\[contenteditable="true"\][\s\S]*?paperuss-text-caret\.svg/.test(css), 'Editable text is not using the custom I-beam pointer');
  assert(/caret-color:var\(--accent/.test(css), 'Typing insertion caret does not use the app accent color');
  assert(/paperuss-caret\.svg/.test(serviceWorker), 'Thin modern caret is not available offline');
  assert(/paperuss-text-caret\.svg/.test(serviceWorker), 'Text I-beam cursor is not available offline');
}

function testBranchOrganizationWiring() {
  const core = read('js/core.js');
  const branches = read('js/branches.js');
  const bootstrap = read('js/bootstrap.js');
  assert(/window\.PaperussNoteStore\s*=/.test(core), 'Branch UI has no adapter to the canonical note store');
  assert(/noteBelongsToBranch/.test(core) && /activeBranchId\s*!==\s*['"]all/.test(core), 'Active branches do not filter the canonical note list');
  assert(/application\/x-paperuss-note-id/.test(bootstrap) && /draggable="true"/.test(core), 'Note cards are not wired for branch drag-and-drop');
  assert(/Move Current Note Here/.test(branches) && /assignNoteToBranch/.test(branches), 'Branch menu has no touch-friendly note assignment action');
  assert(/id="noteBranchSelect"/.test(read('app.html')) && /renderNoteBranchSelector/.test(branches), 'Editor branch selector is missing or unwired');
  assert(/data-branch-id="unassigned"/.test(branches) && /unassignNote/.test(branches), 'Unassigned branch organization is missing');
  assert(/removedIds\.has\(note\.branchId\)/.test(branches), 'Deleting a branch does not safely unassign its notes');
  assert(/migrateLegacyNoteBranches/.test(branches), 'Legacy note categories are not migrated to branch IDs');
}

function testHomepageAppWiring() {
  const homepage = read('index.html');
  const app = read('app.html');
  const serviceWorker = read('sw.js');
  const manifest = read('manifest.webmanifest');
  const coreCss = read('assets/css/core.css');
  const settingsCss = read('assets/css/settings.css');
  const cloudNotifications = read('js/cloud-notifications.js');
  const media = read('js/media.js');
  assert(/PapeRuss — Paper that grows/.test(homepage) && /app\.html/.test(homepage), 'Homepage is not wired to the editor app');
  assert(/id="noteBody"/.test(app) && /id="settingsView"/.test(app), 'app.html does not contain the editor application');
  assert(/\.\/app\.html/.test(serviceWorker) && /app\.html\?shared=1/.test(serviceWorker), 'PWA routes do not target app.html');
  assert(/"start_url": "\.\/app\.html"/.test(manifest), 'Installed PWA does not start in app.html');
  assert(/\[data-theme="paper"\]/.test(coreCss) && /['"]paper['"]/.test(media), 'Homepage-inspired Paper theme is missing');
  assert(/class="auth-pending"/.test(app) && /id="authHomeBtn"/.test(app), 'First-run auth gate or homepage return action is missing');
  assert(/\.auth-pending \.app/.test(settingsCss) && /\.auth-pending \.auth-landing\.hidden/.test(settingsCss), 'First-run auth gate can flash the editor before session detection');
  assert(/document\.documentElement\.classList\.remove\(['"]auth-pending['"]\)/.test(cloudNotifications) && /homeBtn\.onclick[\s\S]*index\.html/.test(cloudNotifications), 'Auth resolution or homepage return action is not wired');
}

testFormattingSelection();
testHeaderFooterEditing();
testLeaflinePalette();
testEditorOwnedPrintSettings();
testPrintContentSanitization();
testPageChromeSanitization();
testModernPageSurface();
testCustomCursorAssets();
testBranchOrganizationWiring();
testHomepageAppWiring();
console.log('Editor context regression checks passed');
process.exit(0);
