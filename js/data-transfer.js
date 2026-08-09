/* ============================================================
   IMPORT / EXPORT
   ============================================================ */
async function exportNotes(){
  if(!notes.length){ toast('No notes to export'); return; }
  toast('Preparing export…');
  const used=referencedMediaIds();
  const media={};
  for(const id of used){
    const rec=await mediaGet(id);
    if(rec){
      media[id]={ name:rec.name, type:rec.type, kind:rec.kind, size:rec.size, dataURL:await blobToDataURL(rec.blob) };
    }
  }

  // v3: also export all Leaf records from IndexedDB
  let leavesExport = {};
  if (window.paperussLeaves) {
    try {
      for (const n of notes) {
        if (window.paperussLeaves.isNoteMigratedToLeaves(n)) {
          const noteLeaves = await window.paperussLeaves.leafGetByNoteId(n.id);
          if (noteLeaves && noteLeaves.length > 0) {
            leavesExport[n.id] = noteLeaves;
          }
        }
      }
    } catch (e) {
      console.warn('exportNotes: leaf export partial failure', e);
    }
  }

  const payload={ version:3, exportedAt:Date.now(), notes, leaves:leavesExport, media };
  const blob=new Blob([JSON.stringify(payload)],{type:'application/json'});
  const a=document.createElement('a');
  a.href=URL.createObjectURL(blob);
  a.download='paperuss-'+new Date().toISOString().slice(0,10)+'.json';
  a.click(); URL.revokeObjectURL(a.href);
  const leafNoteCount = Object.keys(leavesExport).length;
  toast('Exported '+notes.length+' notes'+(Object.keys(media).length?` + ${Object.keys(media).length} media`:'')+(leafNoteCount?` + leaves for ${leafNoteCount} notes`:''));
}

async function importSelectedFile(file) {
  if (!file) return;
  const name = (file.name || '').toLowerCase();
  const type = file.type || '';
  
  if (name.endsWith('.json') || type === 'application/json') {
    return importNotes(file);
  }
  
  if (name.endsWith('.docx') || type === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') {
    if (typeof window.importDocxFile === 'function') {
      return window.importDocxFile(file);
    }
  }
  
  try {
    const headerBuffer = await file.slice(0, 4).arrayBuffer();
    const headerBytes = new Uint8Array(headerBuffer);
    if (headerBytes[0] === 0x50 && headerBytes[1] === 0x4B && headerBytes[2] === 0x03 && headerBytes[3] === 0x04) {
      if (typeof window.importDocxFile === 'function') {
        return window.importDocxFile(file);
      }
    }
  } catch (e) {
    // Ignore read errors
  }
  
  if (typeof window.toast === 'function') {
    window.toast('Unsupported file type');
  } else if (typeof global !== 'undefined' && typeof global.toast === 'function') {
    global.toast('Unsupported file type');
  }
}

function importNotes(file){
  const r=new FileReader();
  r.onload=async ()=>{
    try{
      if(file.size>100*1024*1024) throw new Error('Import file is larger than 100 MB');
      const data=JSON.parse(r.result);
      // Support v1 (array), v2 ({notes, media}), and v3 ({version:3, notes, leaves, media})
      const importedNotes = Array.isArray(data) ? data : (data.notes||[]);
      const importedMedia = (!Array.isArray(data) && data.media) ? data.media : {};
      const importedLeaves = (data.version === 3 && data.leaves && typeof data.leaves === 'object') ? data.leaves : {};
      if(!Array.isArray(importedNotes)) throw 0;

      // Import media first, mapping old->new IDs to avoid collisions
      const idMap={};
      for(const [oldId, m] of Object.entries(importedMedia)){
        try{
          const blob=dataURLToBlob(m.dataURL);
          const newId=await saveMediaBlob(blob, m.name||'file', m.kind||'file');
          idMap[oldId]=newId;
        }catch(e){}
      }

      let added=0;
      // Map of old note ID -> new note ID for leaf remapping
      const noteIdMap = {};
      for (const n of importedNotes) {
        if(n && typeof n==='object'){
          let content=String(n.content||'');
          if(content && !looksLikeHtml(content)) content=mdToHtml(content);
          content=typeof sanitizeNoteHTML==='function'?sanitizeNoteHTML(content):content;
          // Remap media IDs referenced in the note HTML
          content=content.replace(/data-media-id="([^"]+)"/g,(m,id)=>idMap[id]?`data-media-id="${idMap[id]}"`:m);
          const newNoteId = uid();
          noteIdMap[n.id] = newNoteId;

          // Determine if this note had leaves in the export
          const noteLeafExport = importedLeaves[n.id];
          const hadLeaves = Array.isArray(noteLeafExport) && noteLeafExport.length > 0;

          // Remap leafOrder and defaultLeafId
          let leafIdRemap = {};
          let newLeafOrder = undefined;
          let newDefaultLeafId = undefined;
          let newLeafCount = undefined;

          if (hadLeaves) {
            noteLeafExport.forEach(lf => {
              const newLeafId = 'leaf_' + Date.now() + '_' + Math.random().toString(36).substr(2,6);
              leafIdRemap[lf.id] = newLeafId;
            });
            newLeafOrder = Array.isArray(n.leafOrder) ? n.leafOrder.map(id => leafIdRemap[id] || id) : noteLeafExport.map(lf => leafIdRemap[lf.id]);
            newDefaultLeafId = n.defaultLeafId ? (leafIdRemap[n.defaultLeafId] || newLeafOrder[0]) : newLeafOrder[0];
            newLeafCount = newLeafOrder.length;
          }

          const newNote = {
            id: newNoteId,
            title: n.title || 'Untitled',
            content: content,
            pinned: !!n.pinned,
            archived: !!n.archived,
            tags: Array.isArray(n.tags) ? n.tags : [],
            createdAt: n.createdAt || Date.now(),
            updatedAt: n.updatedAt || Date.now(),
            deletedAt: n.deletedAt || null,
            ...(hadLeaves ? { leafOrder: newLeafOrder, defaultLeafId: newDefaultLeafId, leafCount: newLeafCount } : {})
          };
          notes.push(newNote);

          // Import Leaf records into IDB if v3 and paperussLeaves is available
          if (hadLeaves && window.paperussLeaves) {
            for (const lf of noteLeafExport) {
              try {
                const newLeafId = leafIdRemap[lf.id];
                if (!newLeafId) continue;
                const newOrder = newLeafOrder.indexOf(newLeafId);
                // Remap media IDs in leaf content
                let leafContent = String(lf.content || '');
                leafContent = leafContent.replace(/data-media-id="([^"]+)"/g,(m,id)=>idMap[id]?`data-media-id="${idMap[id]}"`:m);
                const leafObj = {
                  id: newLeafId,
                  noteId: newNoteId,
                  title: lf.title || 'Leaf',
                  content: leafContent,
                  color: lf.color || 'slate',
                  order: newOrder >= 0 ? newOrder : (lf.order || 0),
                  createdAt: lf.createdAt || Date.now(),
                  updatedAt: lf.updatedAt || Date.now()
                };
                await window.paperussLeaves.leafPut(leafObj);
                await window.paperussLeaves.leafQueuePut({
                  id: 'mut_imp_' + Date.now() + '_' + Math.random().toString(36).substr(2,6),
                  noteId: newNoteId,
                  action: 'put',
                  data: Object.assign({}, leafObj),
                  timestamp: Date.now()
                });
              } catch(e) {
                console.warn('importNotes: leaf IDB import error', e);
              }
            }
          }

        }
      }

      if(typeof sanitizeNoteCollection==='function') notes=sanitizeNoteCollection(notes);
      save(); renderAll();
      const mediaCount=Object.keys(idMap).length;
      const leafNoteCount = Object.keys(importedLeaves).length;
      toast('Imported '+added+' note'+(added!==1?'s':'')+(mediaCount?` + ${mediaCount} media`:'')+(leafNoteCount?` + leaves for ${leafNoteCount} notes`:''));
    }catch(e){ toast(e?.message||'Invalid file — need a PapeRuss JSON export'); }
  };
  r.readAsText(file);
}

/* ============================================================
   MODAL + TOAST
   ============================================================ */
function confirmDialog(title,text,okLabel,onOk){
  const root=document.getElementById('modalRoot');
  root.innerHTML=`<div class="modal-overlay"><div class="modal">
    <h3>${esc(title)}</h3><p>${esc(text)}</p>
    <div class="modal-actions">
      <button class="btn" id="mCancel">Cancel</button>
      <button class="btn btn-danger" id="mOk">${esc(okLabel)}</button>
    </div></div></div>`;
  const close=()=>root.innerHTML='';
  document.getElementById('mCancel').onclick=close;
  document.getElementById('mOk').onclick=()=>{ close(); onOk(); };
  root.querySelector('.modal-overlay').onclick=e=>{ if(e.target===e.currentTarget) close(); };
}
function openImageLightbox(src){
  const root=document.getElementById('modalRoot');
  if(!root) return;
  if(typeof paperussSafeUrl==='function' && !paperussSafeUrl(src,'src','IMG')){
    toast('This image source is not allowed'); return;
  }
  root.replaceChildren();
  const overlay=document.createElement('div');
  overlay.className='modal-overlay';
  overlay.style.cursor='zoom-out';
  overlay.setAttribute('role','dialog');
  overlay.setAttribute('aria-label','Image preview');
  const image=document.createElement('img');
  image.src=String(src||'');
  image.alt='Image preview';
  image.style.cssText='max-width:92vw;max-height:92vh;border-radius:10px;box-shadow:0 12px 40px rgba(0,0,0,.6)';
  overlay.appendChild(image);
  overlay.addEventListener('click',()=>root.replaceChildren());
  root.appendChild(overlay);
}
function toast(msg, action, label='Undo', options={}){
  if(!options.force && typeof appSettings==='object' && appSettings.notifToasts===false) return null;
  const c=document.getElementById('toast-container');
  if(!c) return null;
  const t=document.createElement('div');
  t.className='toast';
  const span=document.createElement('span');
  span.textContent=String(msg||'');
  t.appendChild(span);
  if(action){
    const button=document.createElement('button');
    button.className='toast-action';
    button.type='button';
    button.textContent=String(label||'Undo');
    t.appendChild(button);
  }
  c.appendChild(t);
  const remove=()=>{ t.style.transition='opacity .2s'; t.style.opacity='0'; setTimeout(()=>t.remove(),200); };
  if(action) t.querySelector('.toast-action').onclick=()=>{ remove(); action(); };
  setTimeout(remove, 4500);
  return t;
}

/* ============================================================
   SEED DATA
   ============================================================ */
function seedNotes(){
  const now = Date.now();
  const noteId = 'seed_note_welcome';
  const leaf1Id = 'seed_leaf_welcome';
  const leaf2Id = 'seed_leaf_formatting';
  const leaf3Id = 'seed_leaf_spreadsheet';
  const leaf4Id = 'seed_leaf_print';
  const leaf5Id = 'seed_leaf_media';
  const leaf6Id = 'seed_leaf_leafline';

  const leaf1Content = `<p><img src="assets/images/paperuss-banner-light.png" alt="PapeRuss 2.0 Primary Documentation" style="width:100%;border-radius:12px;margin-bottom:16px;box-shadow:0 4px 16px rgba(0,0,0,0.15);"></p>
<h1>Welcome to PapeRuss 👋 — System Documentation</h1>
<p>PapeRuss 2.0 is an editorial-grade, <strong>offline-first</strong> document editor and knowledge suite designed for focused writing, structured notes, and rich interactive media.</p>

<h2>🌱 Botanical Document Architecture</h2>
<p>PapeRuss organizes knowledge using an intuitive botanical hierarchy:</p>
<ul>
  <li>🌲 <strong>Branch (Notebook / Category)</strong> — Top-level workspace container for organizing projects.</li>
  <li>🌿 <strong>Stem (Sub-Category)</strong> — Nested organizational branch structure.</li>
  <li>🍃 <strong>Leafline (Timeline Outline)</strong> — Interactive document heading outline and timeline navigation.</li>
  <li>📑 <strong>Leaves (Multi-Tab Pages)</strong> — Multi-tab pages residing inside a single Note container.</li>
  <li>📝 <strong>Leaf (Single Document)</strong> — Individual rich-text editing page with full formatting.</li>
</ul>

<h2>🔒 Offline-First &amp; Data Security Philosophy</h2>
<p>Your data stays under your control at all times:</p>
<ul>
  <li><strong>Local-First Storage</strong> — Notes, attachments, voice recordings, and leaves are stored directly in browser IndexedDB (<code>paperuss_leaves_db</code>) and LocalStorage.</li>
  <li><strong>Cloud Synchronization</strong> — Optional Firebase Cloud Sync with silent offline queueing (<code>cloud-notifications.js</code>).</li>
  <li><strong>Data Portability</strong> — 1-click JSON backup export/import and high-fidelity Word (<code>.docx</code>) compilation.</li>
</ul>

<h2>📚 Feature Documentation Suite Index</h2>
<p>Explore the succeeding Leaf tabs at the top of the window to see live interactive demonstrations of each subsystem:</p>
<ol>
  <li><strong>Cheatsheet &amp; Formatting Suite</strong> — Typography, 5 Creative Headings, Quote Themes, lists &amp; task checkboxes.</li>
  <li><strong>Spreadsheet &amp; Budget Plan</strong> — Multi-column tables, live Excel formulas (<code>=SUM()</code>), currency formatting &amp; templates.</li>
  <li><strong>Print Layout &amp; Page Setup</strong> — Page View, Formal/Clean presets, binding margins, header/footer overlays &amp; PDF export.</li>
  <li><strong>Music Hub &amp; Media Studio</strong> — Background audio player widget, Spotify/YouTube embeds, voice cards &amp; 3:1 cover headers.</li>
  <li><strong>Leafline &amp; Branch Tree</strong> — Timeline outline palette, 3-segment view switch, and drag-and-drop branch tree.</li>
</ol>`;

  const leaf2Content = `<p><img src="assets/images/paperuss-botanical-blue.png" alt="Formatting Suite" style="width:100%;border-radius:12px;margin-bottom:16px;box-shadow:0 4px 16px rgba(0,0,0,0.15);"></p>
<h1>Cheatsheet &amp; Formatting Suite</h1>
<p>PapeRuss 2.0 provides an editorial-grade formatting engine for technical documents, journals, and reports.</p>

<h1 data-heading-style="banner">Creative Banner Heading (H1)</h1>
<h2 data-heading-style="ribbon">Creative Ribbon Heading (H2)</h2>
<h3 data-heading-style="accent-left">Creative Accent-Left Heading (H3)</h3>
<h4 data-heading-style="underlined">Creative Underlined Heading (H4)</h4>

<h2>🎨 Native Typography &amp; Font Families</h2>
<p>Apply font styles strictly to highlighted text selections:</p>
<ul>
  <li><strong>Sans</strong> (<code>Segoe UI</code>), <em>Serif</em> (<code>Georgia</code>), <code>Mono</code> (<code>Consolas</code>), and <strong>Rounded</strong> (<code>Trebuchet MS</code>).</li>
  <li><span style="font-size:13px">Small (13px)</span>, <span style="font-size:15px">Normal (15px)</span>, <span style="font-size:18px">Large (18px)</span>, and <span style="font-size:22px">Huge (22px)</span>.</li>
  <li><mark style="background:#fef08a;color:#0f172a">Yellow</mark>, <mark style="background:#bbf7d0;color:#0f172a">Green</mark>, <mark style="background:#bfdbfe;color:#0f172a">Blue</mark>, <mark style="background:#fbcfe8;color:#0f172a">Pink</mark>, <mark style="background:#ffedd5;color:#0f172a">Orange</mark>, and <mark style="background:#fecaca;color:#0f172a">Red</mark> highlights.</li>
</ul>

<h2>💬 Quote Context Themes</h2>
<blockquote data-quote-style="literary"><p>"Design is not just what it looks like — it's how it works." — Steve Jobs</p></blockquote>
<blockquote data-quote-style="tech"><p>"Offline-first architecture empowers speed, privacy, and reliability."</p></blockquote>
<blockquote data-quote-style="modern"><p>"Simplicity is the ultimate sophistication."</p></blockquote>

<h2>📝 Interactive Checklists &amp; Shortcuts</h2>
<ul>
  <li data-task="1"><input type="checkbox" checked> Press <code>Ctrl + B</code> for Bold, <code>Ctrl + I</code> for Italic, <code>Ctrl + U</code> for Underline</li>
  <li data-task="1"><input type="checkbox" checked> Use line spacing picker for 1.0x to 3.0x line height</li>
  <li data-task="1"><input type="checkbox"> Press <code>Ctrl + F</code> to open Find and Replace bar</li>
</ul>`;

  const leaf3Content = `<p><img src="assets/images/paperuss-blueprint-leaves.png" alt="Spreadsheet & Planning" style="width:100%;border-radius:12px;margin-bottom:16px;box-shadow:0 4px 16px rgba(0,0,0,0.15);"></p>
<h1>Spreadsheet, Formulas &amp; Financial Planning</h1>
<p>PapeRuss 2.0 embeds live Excel formula calculation and currency formatting directly inside document tables. Type <strong><code>=</code></strong> inside any cell to trigger autocomplete!</p>

<h2>📈 Quarterly Project Budget</h2>
<div class="table-wrapper" contenteditable="false"><table contenteditable="true">
  <tbody>
    <tr><th>Category</th><th>Budgeted</th><th>Actual</th><th>Variance</th></tr>
    <tr><td>Travel &amp; Flights</td><td data-format="currency" data-currency="$">500.00</td><td data-format="currency" data-currency="$">420.00</td><td data-format="currency" data-currency="$" data-formula="=C2-B2">-$80.00</td></tr>
    <tr><td>Hotel &amp; Lodging</td><td data-format="currency" data-currency="$">600.00</td><td data-format="currency" data-currency="$">550.00</td><td data-format="currency" data-currency="$" data-formula="=C3-B3">-$50.00</td></tr>
    <tr><td>Meals &amp; Dining</td><td data-format="currency" data-currency="$">250.00</td><td data-format="currency" data-currency="$">290.00</td><td data-format="currency" data-currency="$" data-formula="=C4-B4">$40.00</td></tr>
    <tr style="border-top:2px solid currentColor; font-weight:bold;">
      <td>TOTAL EXPENSES</td><td data-format="currency" data-currency="$" data-formula="=SUM(B2:B4)">$1,350.00</td><td data-format="currency" data-currency="$" data-formula="=SUM(C2:C4)">$1,260.00</td><td data-format="currency" data-currency="$" data-formula="=C5-B5">-$90.00</td>
    </tr>
  </tbody>
</table></div>

<p><br></p>

<h2>💻 Hardware &amp; Software Equipment Cost</h2>
<div class="table-wrapper" contenteditable="false"><table contenteditable="true">
  <tbody>
    <tr><th>Item</th><th>Qty</th><th>Unit Cost</th><th>Total Cost</th></tr>
    <tr><td>Software Licenses</td><td>5</td><td data-format="currency" data-currency="$">120.00</td><td data-format="currency" data-currency="$" data-formula="=B2*C2">$600.00</td></tr>
    <tr><td>Hardware Upgrade</td><td>2</td><td data-format="currency" data-currency="$">850.00</td><td data-format="currency" data-currency="$" data-formula="=B3*C3">$1,700.00</td></tr>
    <tr><td>Cloud Infrastructure</td><td>1</td><td data-format="currency" data-currency="$">450.00</td><td data-format="currency" data-currency="$" data-formula="=B4*C4">$450.00</td></tr>
    <tr style="border-top:2px solid currentColor; font-weight:bold;">
      <td colspan="3">TOTAL ESTIMATED COST</td><td data-format="currency" data-currency="$" data-formula="=SUM(D2:D4)">$2,750.00</td>
    </tr>
  </tbody>
</table></div>`;

  const leaf4Content = `<p><img src="assets/images/paperuss-branch-tree.png" alt="Print Layout & Aesthetics" style="width:100%;border-radius:12px;margin-bottom:16px;box-shadow:0 4px 16px rgba(0,0,0,0.15);"></p>
<h1>Print Layout, Aesthetics &amp; PDF Engine</h1>
<p>PapeRuss 2.0 incorporates a publication-grade page layout engine for live page editing, PDF export, and physical printing.</p>

<h2>📄 Page Surfaces &amp; Document Aesthetics</h2>
<p>Use the <strong>Page Setup</strong> tool in the bottom bar to customize your document surface:</p>
<ul>
  <li><strong>Continuous Flow</strong> vs <strong>Print Layout</strong> (A4, US Letter, US Legal).</li>
  <li><strong>Binding Margins</strong> — Mirrored inner gutter spacing (<code>@page :left</code> &amp; <code>@page :right</code>) for thesis and book binding.</li>
  <li><strong>5 Aesthetics</strong> — <em>Executive</em>, <em>Serif</em>, <em>Clean</em>, <em>Vintage</em>, and <em>Paper</em> themes.</li>
</ul>

<h2>🏷️ Unified Editable Header &amp; Footer Overlays</h2>
<p>Click directly into page header and footer areas to edit document metadata, titles, and reference codes. Header/footer toolbars float below the active zone for quick font and alignment changes.</p>

<h2>🖨️ Multi-Page Table Printing</h2>
<p>Tables automatically repeat their header row (<code>thead</code>) across page breaks and enforce row split prevention (<code>break-inside: avoid</code>) when exported to PDF or sent to a physical printer.</p>`;

  const leaf5Content = `<p><img src="assets/images/paperuss-botanical-dark.png" alt="Media Studio" style="width:100%;border-radius:12px;margin-bottom:16px;box-shadow:0 4px 16px rgba(0,0,0,0.15);"></p>
<h1>Music Hub, Voice Cards &amp; Media Studio</h1>
<p>PapeRuss 2.0 integrates audio playback, video embeds, and rich media cards directly into your workflow.</p>

<h2>🎵 System Music Player Hub</h2>
<p>Click <strong><code>[ 🎵 Music Player ]</code></strong> in the bottom bar or navigation menu to launch the background media player widget. Enjoy uninterrupted background audio while writing!</p>
<ul>
  <li>🎧 <strong>Lofi Beats</strong> — Chill focus beats for coding &amp; reading.</li>
  <li>🎸 <strong>Chill Acoustic</strong> — Warm acoustic strings for brainstorming.</li>
  <li>⚡ <strong>Synthwave Focus</strong> — Energetic ambient synths for deep work sessions.</li>
</ul>

<h2>🎤 Audio Recordings &amp; Embedded Media</h2>
<p>Insert voice recordings, Spotify playlists, and YouTube video embeds anywhere on the page:</p>

<div class="paperuss-card paperuss-card-audio embed-mode-standard card-width-medium" data-media-id="sample_audio_1" data-display-mode="standard">
  <div class="embed-media-preview">
    <div class="audio-card-visual">
      <div class="audio-wave-anim"><span></span><span></span><span></span><span></span><span></span></div>
      <div class="audio-card-info">
        <strong class="card-title-text">PapeRuss Voice Note &amp; Audio Guide</strong>
        <span class="card-meta-text">Sample Audio • 0:42</span>
      </div>
    </div>
    <audio controls class="audio-native-player" src="assets/audio/sample-ambient.mp3"></audio>
  </div>
</div>

<p><br></p>

<h2>🖼️ Floating Image Toolbar &amp; 3:1 Covers</h2>
<p>Click or hover any image to access the floating toolbar for sizing, float alignment (Left, Center, Right), image replacement, and <strong>3:1 Panoramic Notebook Covers</strong> with vertical drag positioning.</p>`;

  const leaf6Content = `<p><img src="assets/images/paperuss-blueprint-leaves.png" alt="Leafline Navigation" style="width:100%;border-radius:12px;margin-bottom:16px;box-shadow:0 4px 16px rgba(0,0,0,0.15);"></p>
<h1>Leafline Outline &amp; Botanical Branch Tree</h1>
<p>PapeRuss 2.0 offers powerful navigation tools to jump across document headings and organize notebooks into branch hierarchies.</p>

<h2>🌿 Leafline Timeline Document Outline</h2>
<p>Open the Leaves drawer to view the interactive <strong>Leafline Timeline Outline</strong>. Headings (H1, H2, H3) automatically build a live timeline index with single-click jump navigation.</p>

<h2>🗂️ 3-Segment List View Switcher</h2>
<p>Toggle between the three viewing modes inside the drawer:</p>
<ul>
  <li><strong>Notes View</strong> — List of all notes in your library.</li>
  <li><strong>Leaves View</strong> — Multi-leaf tab management for the active note.</li>
  <li><strong>Leafline View</strong> — Interactive heading outline timeline.</li>
</ul>

<h2>🌲 Sidebar Branch Category Tree</h2>
<p>Organize notes into collapsible branch categories (<em>Personal, Work, Archive</em>). Drag and drop notes directly into branch folders in the sidebar to keep your knowledge tree structured.</p>`;

  const note = {
    id: noteId,
    title: 'Welcome to PapeRuss 👋',
    pinned: true,
    archived: false,
    tags: ['intro', 'documentation', 'guide', 'features'],
    coverImage: { src: 'assets/images/paperuss-banner-light.png', positionY: 50 },
    defaultLeafId: leaf1Id,
    leafOrder: [leaf1Id, leaf2Id, leaf3Id, leaf4Id, leaf5Id, leaf6Id],
    leafCount: 6,
    content: leaf1Content,
    createdAt: now - 60000,
    updatedAt: now - 30000,
    seedLeaves: [
      { id: leaf1Id, noteId: noteId, title: 'Welcome & Overview', content: leaf1Content, order: 0, createdAt: now - 60000, updatedAt: now - 30000 },
      { id: leaf2Id, noteId: noteId, title: 'Cheatsheet & Formatting', content: leaf2Content, order: 1, createdAt: now - 50000, updatedAt: now - 30000 },
      { id: leaf3Id, noteId: noteId, title: 'Spreadsheet & Budget Plan', content: leaf3Content, order: 2, createdAt: now - 40000, updatedAt: now - 30000 },
      { id: leaf4Id, noteId: noteId, title: 'Print Layout & Page Setup', content: leaf4Content, order: 3, createdAt: now - 30000, updatedAt: now - 30000 },
      { id: leaf5Id, noteId: noteId, title: 'Music Hub & Media Studio', content: leaf5Content, order: 4, createdAt: now - 20000, updatedAt: now - 30000 },
      { id: leaf6Id, noteId: noteId, title: 'Leafline & Branch Tree', content: leaf6Content, order: 5, createdAt: now - 10000, updatedAt: now - 30000 }
    ]
  };

  return [note];
}

/* ============================================================
   INCOMING SHARE TARGET & FILE HANDLING API
   ============================================================ */
async function checkIncomingSharedData(){
  try {
    const params = new URLSearchParams(window.location.search);
    const title = params.get('title');
    const text = params.get('text');
    const url = params.get('url');
    const isShared = params.get('shared');

    // 1. Direct GET share parameters
    if (title || text || url) {
      window.history.replaceState({}, document.title, window.location.pathname);
      openIncomingShareModal({ title, text, url, files: [] });
      return;
    }

    // 2. POST share payload cached by Service Worker
    if (isShared === '1' && 'caches' in window) {
      window.history.replaceState({}, document.title, window.location.pathname);
      const cacheName = window.PAPERUSS_BUILD?.cacheName || 'paperuss-shell-v35';
      const cache = await caches.open(cacheName);
      const match = await cache.match('./__pending_shared_payload__');
      if (match) {
        const data = await match.json();
        await cache.delete('./__pending_shared_payload__');
        openIncomingShareModal(data);
      }
    }
  } catch (err) {
    console.error('Error handling incoming shared data:', err);
  }
}

function buildSharedContentHtml(payload) {
  let body = '';
  if (payload.text) {
    body += `<p>${esc(payload.text)}</p>`;
  }
  if (payload.url) {
    body += `<p><a href="${esc(payload.url)}" target="_blank" rel="noopener noreferrer" style="display:inline-block;padding:8px 12px;background:var(--hover);border-radius:8px;text-decoration:none;color:var(--accent);margin-top:6px;">🔗 ${esc(payload.url)}</a></p>`;
  }
  if (payload.files && payload.files.length > 0) {
    payload.files.forEach(f => {
      try {
        const u8 = new Uint8Array(f.buffer);
        const blob = new Blob([u8], { type: f.type || 'application/octet-stream' });
        const blobUrl = URL.createObjectURL(blob);
        if (f.type && f.type.startsWith('image/')) {
          body += `<p><img src="${blobUrl}" alt="${esc(f.name)}" style="max-width:100%;border-radius:8px;margin-top:8px;"></p>`;
        } else {
          body += `<p><a href="${blobUrl}" download="${esc(f.name)}" style="display:inline-flex;align-items:center;gap:6px;padding:6px 10px;background:var(--hover);border-radius:6px;margin-top:6px;">📎 ${esc(f.name)}</a></p>`;
        }
      } catch (e) {
        console.error('Error parsing shared file:', e);
      }
    });
  }
  return body;
}

function createNoteFromSharedData(payload, branchTag){
  if (!payload) return;
  const now = Date.now();
  let noteTitle = payload.title || (payload.text ? payload.text.substring(0, 30) : 'Shared Bookmark');
  const body = buildSharedContentHtml(payload);

  const tags = ['bookmarks', 'shared'];
  if (branchTag && !tags.includes(branchTag)) {
    tags.push(branchTag);
  }

  const newNote = {
    id: uid(),
    title: noteTitle,
    content: body || '<p></p>',
    pinned: false,
    archived: false,
    tags: tags,
    createdAt: now,
    updatedAt: now
  };

  notes.unshift(newNote);
  saveNotesLocally();
  renderNotesList();
  selectNote(newNote.id);
  if (typeof showToast === 'function') {
    showToast('Saved to 📌 Bookmarks Branch!');
  }
}

function openIncomingShareModal(payload) {
  if (!payload) return;
  window.__pendingShareData = payload;

  const overlay = document.getElementById('incomingShareOverlay');
  if (!overlay) {
    createNoteFromSharedData(payload);
    return;
  }

  // Populate preview
  const titleEl = overlay.querySelector('#sharePreviewTitle');
  const textEl = overlay.querySelector('#sharePreviewText');
  const domainEl = overlay.querySelector('#sharePreviewDomain');
  const urlBarEl = overlay.querySelector('#sharePreviewUrlBar');
  const faviconEl = overlay.querySelector('#sharePreviewFavicon');
  const imagesEl = overlay.querySelector('#sharePreviewImages');

  if (titleEl) titleEl.textContent = payload.title || 'Shared Content';
  if (textEl) {
    textEl.textContent = payload.text || '';
    textEl.style.display = payload.text ? '' : 'none';
  }

  if (payload.url && urlBarEl) {
    urlBarEl.style.display = '';
    try {
      const u = new URL(payload.url);
      if (domainEl) domainEl.textContent = u.hostname.replace('www.', '');
      if (faviconEl) {
        faviconEl.src = `https://www.google.com/s2/favicons?sz=32&domain=${u.hostname}`;
        faviconEl.onerror = () => { faviconEl.style.display='none'; };
      }
    } catch(_) {
      if (domainEl) domainEl.textContent = payload.url.slice(0, 40);
    }
  } else if (urlBarEl) {
    urlBarEl.style.display = 'none';
  }

  if (imagesEl) {
    imagesEl.innerHTML = '';
    const imgs = (payload.files || []).filter(f => f.type && f.type.startsWith('image/')).slice(0, 4);
    imgs.forEach(f => {
      try {
        const u8 = new Uint8Array(f.buffer);
        const blob = new Blob([u8], { type: f.type });
        const blobUrl = URL.createObjectURL(blob);
        const img = document.createElement('img');
        img.src = blobUrl;
        img.className = 'share-preview-thumb';
        img.alt = f.name;
        imagesEl.appendChild(img);
      } catch(_) {}
    });
    const otherFiles = (payload.files || []).filter(f => !f.type?.startsWith('image/')).slice(0, 4);
    otherFiles.forEach(f => {
      const chip = document.createElement('span');
      chip.className = 'share-preview-file-chip';
      chip.textContent = `📎 ${f.name}`;
      imagesEl.appendChild(chip);
    });
    imagesEl.style.display = (imgs.length || otherFiles.length) ? '' : 'none';
  }

  // Populate Note dropdown
  const noteSelect = overlay.querySelector('#shareNoteSelect');
  if (noteSelect) {
    let html = `<option value="">+ Create new note (📌 Bookmarks Branch)</option>`;
    if (typeof notes !== 'undefined' && Array.isArray(notes)) {
      notes.forEach(n => {
        const title = n.title || 'Untitled Note';
        html += `<option value="${esc(n.id)}">${esc(title)}</option>`;
      });
    }
    noteSelect.innerHTML = html;
    noteSelect.value = "";
  }

  // Reset Leaf picker
  const leafRow = overlay.querySelector('#shareLeafPickerRow');
  if (leafRow) leafRow.style.display = 'none';

  updateShareSaveHint();

  if (window.WorkspaceAudio && typeof window.WorkspaceAudio.playModalSlide === 'function') {
    window.WorkspaceAudio.playModalSlide();
  }

  overlay.classList.add('show');
  document.body.style.overflow = 'hidden';
}

async function onShareNotePickerChange() {
  const noteSelect = document.getElementById('shareNoteSelect');
  const leafRow = document.getElementById('shareLeafPickerRow');
  const leafSelect = document.getElementById('shareLeafSelect');

  if (!noteSelect || !leafRow || !leafSelect) return;

  const noteId = noteSelect.value;
  if (!noteId) {
    leafRow.style.display = 'none';
    leafSelect.innerHTML = `<option value="">+ Add as new leaf</option>`;
    updateShareSaveHint();
    return;
  }

  // Populate leaves for selected note
  let leafList = [];
  if (window.paperussLeaves && typeof window.paperussLeaves.leafGetByNote === 'function') {
    try {
      leafList = await window.paperussLeaves.leafGetByNote(noteId);
    } catch(e) { console.error(e); }
  }

  let html = `<option value="">+ Add as new leaf</option>`;
  if (Array.isArray(leafList) && leafList.length > 0) {
    leafList.forEach(l => {
      html += `<option value="${esc(l.id)}">${esc(l.title || 'Untitled Leaf')}</option>`;
    });
  } else {
    // Check if target note has seedLeaves
    const targetNote = typeof notes !== 'undefined' ? notes.find(n => n.id === noteId) : null;
    if (targetNote && Array.isArray(targetNote.seedLeaves)) {
      targetNote.seedLeaves.forEach(l => {
        html += `<option value="${esc(l.id)}">${esc(l.title || 'Untitled Leaf')}</option>`;
      });
    }
  }

  leafSelect.innerHTML = html;
  leafSelect.value = "";
  leafSelect.onchange = updateShareSaveHint;
  leafRow.style.display = '';

  updateShareSaveHint();
}

function updateShareSaveHint() {
  const noteSelect = document.getElementById('shareNoteSelect');
  const leafSelect = document.getElementById('shareLeafSelect');
  const hintEl = document.getElementById('shareSaveHint');
  if (!hintEl) return;

  const noteId = noteSelect ? noteSelect.value : "";
  const leafId = leafSelect ? leafSelect.value : "";

  if (!noteId) {
    hintEl.textContent = "Saves to 📌 Bookmarks Branch as a new note.";
  } else {
    const selectedNoteOption = noteSelect.options[noteSelect.selectedIndex];
    const noteTitle = selectedNoteOption ? selectedNoteOption.text : 'selected note';

    if (!leafId) {
      hintEl.textContent = `Appends a new Leaf tab to "${noteTitle}".`;
    } else {
      const selectedLeafOption = leafSelect.options[leafSelect.selectedIndex];
      const leafTitle = selectedLeafOption ? selectedLeafOption.text : 'selected leaf';
      hintEl.textContent = `Appends shared content directly into "${leafTitle}" in "${noteTitle}".`;
    }
  }
}


function closeIncomingShareModal() {
  const overlay = document.getElementById('incomingShareOverlay');
  if (overlay) overlay.classList.remove('show');
  document.body.style.overflow = '';
  window.__pendingShareData = null;
}

async function executeIncomingShareAction() {
  const payload = window.__pendingShareData;
  if (!payload) return;

  const noteSelect = document.getElementById('shareNoteSelect');
  const leafSelect = document.getElementById('shareLeafSelect');

  const selectedNoteId = noteSelect ? noteSelect.value : "";
  const selectedLeafId = leafSelect ? leafSelect.value : "";

  closeIncomingShareModal();

  const sharedHtml = buildSharedContentHtml(payload);
  const now = Date.now();

  // Case 1: No note selected -> Create new note
  if (!selectedNoteId) {
    createNoteFromSharedData(payload);
    return;
  }

  // Find target note
  const targetNote = typeof notes !== 'undefined' ? notes.find(n => n.id === selectedNoteId) : null;
  if (!targetNote) {
    createNoteFromSharedData(payload);
    return;
  }

  // Select target note first
  if (typeof selectNote === 'function') {
    selectNote(targetNote.id);
  }

  // Case 2: Note selected, Leaf left blank -> Add as new Leaf tab to this note
  if (!selectedLeafId) {
    const newLeafId = uid();
    const leafTitle = payload.title || (payload.text ? payload.text.substring(0, 30) : 'Shared Content');
    const newLeaf = {
      id: newLeafId,
      noteId: targetNote.id,
      title: leafTitle,
      content: sharedHtml || '<p></p>',
      order: (targetNote.leafCount || 1),
      createdAt: now,
      updatedAt: now
    };

    if (window.paperussLeaves && typeof window.paperussLeaves.leafPut === 'function') {
      await window.paperussLeaves.leafPut(newLeaf);
    }
    if (!Array.isArray(targetNote.leafOrder)) targetNote.leafOrder = [targetNote.defaultLeafId || ('virtual_main_' + targetNote.id)];
    targetNote.leafOrder.push(newLeafId);
    targetNote.leafCount = targetNote.leafOrder.length;
    if (!targetNote.defaultLeafId) targetNote.defaultLeafId = targetNote.leafOrder[0];
    targetNote.updatedAt = now;

    if (typeof saveNotesLocally === 'function') saveNotesLocally();
    if (typeof renderLeafTabs === 'function') renderLeafTabs();
    if (typeof switchToLeaf === 'function') switchToLeaf(newLeafId);
    if (typeof showToast === 'function') showToast(`Added new Leaf to "${targetNote.title}"!`);
    return;
  }

  // Case 3: Existing Leaf selected -> Append content to existing Leaf
  let targetLeaf = null;
  if (window.paperussLeaves && typeof window.paperussLeaves.leafGet === 'function') {
    targetLeaf = await window.paperussLeaves.leafGet(selectedLeafId);
  }

  if (targetLeaf) {
    targetLeaf.content = (targetLeaf.content || '') + sharedHtml;
    targetLeaf.updatedAt = now;
    await window.paperussLeaves.leafPut(targetLeaf);
  } else if (targetNote.seedLeaves) {
    const sl = targetNote.seedLeaves.find(l => l.id === selectedLeafId);
    if (sl) {
      sl.content = (sl.content || '') + sharedHtml;
      sl.updatedAt = now;
      if (window.paperussLeaves && typeof window.paperussLeaves.leafPut === 'function') {
        await window.paperussLeaves.leafPut(sl);
      }
    }
  }

  targetNote.updatedAt = now;
  if (typeof saveNotesLocally === 'function') saveNotesLocally();
  if (typeof switchToLeaf === 'function') switchToLeaf(selectedLeafId);
  if (typeof showToast === 'function') showToast(`Updated Leaf in "${targetNote.title}"!`);
}


