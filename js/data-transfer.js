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
  const payload={ version:2, exportedAt:Date.now(), notes, media };
  const blob=new Blob([JSON.stringify(payload)],{type:'application/json'});
  const a=document.createElement('a');
  a.href=URL.createObjectURL(blob);
  a.download='paperuss-'+new Date().toISOString().slice(0,10)+'.json';
  a.click(); URL.revokeObjectURL(a.href);
  toast('Exported '+notes.length+' notes'+(Object.keys(media).length?` + ${Object.keys(media).length} media`:''));
}
function importNotes(file){
  const r=new FileReader();
  r.onload=async ()=>{
    try{
      const data=JSON.parse(r.result);
      // Support both legacy (array) and v2 ({notes, media}) formats
      const importedNotes = Array.isArray(data) ? data : (data.notes||[]);
      const importedMedia = (!Array.isArray(data) && data.media) ? data.media : {};
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
      importedNotes.forEach(n=>{
        if(n && typeof n==='object'){
          let content=String(n.content||'');
          if(content && !looksLikeHtml(content)) content=mdToHtml(content);
          // Remap media IDs referenced in the note HTML
          content=content.replace(/data-media-id="([^"]+)"/g,(m,id)=> idMap[id]?`data-media-id="${idMap[id]}"`:m);
          notes.push({
            id:uid(), title:String(n.title||''), content,
            tags:Array.isArray(n.tags)?n.tags.filter(t=>typeof t==='string'):[],
            pinned:!!n.pinned, archived:!!n.archived,
            fontStyle:n.fontStyle||'sans',
            pageViewEnabled:!!n.pageViewEnabled,
            pageSize:n.pageSize||'a4',
            pageOrientation:n.pageOrientation||'portrait',
            pageMargins:n.pageMargins||'normal',
            createdAt:n.createdAt||Date.now(), updatedAt:n.updatedAt||Date.now()
          });
          added++;
        }
      });
      save(); renderAll();
      const mediaCount=Object.keys(idMap).length;
      toast('Imported '+added+' note'+(added!==1?'s':'')+(mediaCount?` + ${mediaCount} media`:''));
    }catch(e){ toast('Invalid file — need a JSON export'); }
  };
  r.readAsText(file);
}

/* ============================================================
   MODAL + TOAST
   ============================================================ */
function confirmDialog(title,text,okLabel,onOk){
  const root=document.getElementById('modalRoot');
  root.innerHTML=`<div class="modal-overlay"><div class="modal">
    <h3>${title}</h3><p>${text}</p>
    <div class="modal-actions">
      <button class="btn" id="mCancel">Cancel</button>
      <button class="btn btn-danger" id="mOk">${okLabel}</button>
    </div></div></div>`;
  const close=()=>root.innerHTML='';
  document.getElementById('mCancel').onclick=close;
  document.getElementById('mOk').onclick=()=>{ close(); onOk(); };
  root.querySelector('.modal-overlay').onclick=e=>{ if(e.target===e.currentTarget) close(); };
}
function openImageLightbox(src){
  const root=document.getElementById('modalRoot');
  root.innerHTML=`<div class="modal-overlay" style="cursor:zoom-out">
    <img src="${src}" style="max-width:92vw;max-height:92vh;border-radius:10px;box-shadow:0 12px 40px rgba(0,0,0,.6)">
  </div>`;
  root.querySelector('.modal-overlay').onclick=()=>root.innerHTML='';
}
function toast(msg, action, label='Undo'){
  const c=document.getElementById('toast-container');
  const t=document.createElement('div');
  t.className='toast';
  t.innerHTML='<span>'+msg+'</span>'+(action?`<button class="toast-action">${label}</button>`:'');
  c.appendChild(t);
  const remove=()=>{ t.style.transition='opacity .2s'; t.style.opacity='0'; setTimeout(()=>t.remove(),200); };
  if(action) t.querySelector('.toast-action').onclick=()=>{ remove(); action(); };
  setTimeout(remove, 4500);
}

/* ============================================================
   SEED DATA
   ============================================================ */
function seedNotes(){
  const now=Date.now();
  return [
    {
      id:uid(), title:'Welcome to PapeRuss 👋', pinned:true, archived:false, tags:['intro','overview'],
      content: `<h1>Welcome to PapeRuss 👋</h1>
<p>A fast, <strong>offline-first</strong> document editor with a modern flat design.</p>
<h2>🎨 Rich Text &amp; Typography</h2>
<p>Customize your writing with built-in font styles and sizes:</p>
<ul>
<li><strong>Sans</strong>, <em>Serif</em>, <code>Mono</code>, and <strong>Rounded</strong> font families.</li>
<li><span style="font-size:13px">Small</span>, <span style="font-size:15px">Normal</span>, <span style="font-size:18px">Large</span>, and <span style="font-size:22px">Huge</span> text sizes.</li>
<li><strong>Bold</strong>, <em>Italic</em>, <u>Underline</u>, <s>Strikethrough</s>, and <mark style="background:#fef08a;color:#0f172a">Highlighter colors</mark> (Yellow, Green, Blue, Pink, Orange, Red).</li>
</ul>
<h2>📊 Interactive Tables &amp; Excel Formulas</h2>
<p>Type <strong><code>=</code></strong> inside any table cell to trigger the Excel-style formula autocomplete!</p>

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

<h2>📎 Media &amp; Insert Toolbar</h2>
<p>Use the toolbar to quickly insert:</p>
<ul>
<li>🖼️ <strong>Images</strong> — paste or drag &amp; drop directly onto the page</li>
<li>🎤 <strong>Voice Recordings</strong> &amp; 🎬 <strong>Inline Videos</strong></li>
<li>🔗 <strong>Rich Link Cards</strong> &amp; 📎 <strong>File Attachments</strong></li>
<li>📐 <strong>Templates</strong> — Expense Tracker, Budget Summary, and Variance Analysis</li>
</ul>
<blockquote><p>Tip: Press <code>/</code> to search or Ctrl/Cmd + N to create a new note!</p></blockquote>`,
      createdAt:now-60000, updatedAt:now-30000
    },
    {
      id:uid(), title:'Toolbar & Formatting Cheatsheet', pinned:false, archived:false, tags:['reference','guide'],
      content: `<h1>Toolbar &amp; Formatting Cheatsheet</h1>
<h2>✏️ Text Formatting</h2>
<ul>
<li><strong>Keyboard Shortcuts</strong>: Ctrl+B (Bold), Ctrl+I (Italic), Ctrl+U (Underline).</li>
<li><strong>Inline Code</strong>: Use <code>code</code> blocks for technical snippets.</li>
<li><strong>Highlights</strong>: Apply Yellow, Green, Blue, Pink, Orange, or Red mark highlights.</li>
</ul>
<h2>📝 Lists &amp; Structures</h2>
<ul>
<li>Bullet item 1</li>
<li>Bullet item 2</li>
</ul>
<ol>
<li>First step</li>
<li>Second step</li>
</ol>
<ul>
<li data-task="1"><input type="checkbox" checked> Completed task item</li>
<li data-task="1"><input type="checkbox"> Active task item</li>
</ul>
<h2>💬 Quotes &amp; Dividers</h2>
<blockquote><p>"Design is not just what it looks like — it's how it works." — Steve Jobs</p></blockquote>
<hr>
<h2>🖨️ Page Setup &amp; Print Layout</h2>
<p>Use <strong>Page Setup</strong> in the bottom bar to switch between:</p>
<ul>
<li><strong>Continuous Flow</strong> vs <strong>Print Layout</strong> (A4, US Letter, US Legal)</li>
<li>Portrait vs Landscape orientations &amp; Custom Margins</li>
</ul>`,
      createdAt:now-120000, updatedAt:now-100000
    },
    {
      id:uid(), title:'Financial Budget & Project Plan', pinned:false, archived:false, tags:['finance','planning'],
      content: `<h1>Financial Budget &amp; Project Plan</h1>
<h2>📈 Quarterly Project Budget</h2>
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
</table></div>
<p><br></p>
<h2>📌 Deliverables</h2>
<ul>
<li data-task="1"><input type="checkbox" checked> Finalize spreadsheet formula calculations</li>
<li data-task="1"><input type="checkbox"> Review budget with finance team</li>
</ul>`,
      createdAt:now-180000, updatedAt:now-150000
    }
  ];
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
      createNoteFromSharedData({ title, text, url });
      return;
    }

    // 2. POST share payload cached by Service Worker
    if (isShared === '1' && 'caches' in window) {
      window.history.replaceState({}, document.title, window.location.pathname);
      const cacheName = typeof CACHE_NAME !== 'undefined' ? CACHE_NAME : "paperuss-shell-v20";
      const cache = await caches.open(cacheName);
      const match = await cache.match('./__pending_shared_payload__');
      if (match) {
        const data = await match.json();
        await cache.delete('./__pending_shared_payload__');
        createNoteFromSharedData(data);
      }
    }
  } catch (err) {
    console.error('Error handling incoming shared data:', err);
  }
}

function createNoteFromSharedData(payload){
  if (!payload) return;
  const now = Date.now();
  let noteTitle = payload.title || (payload.text ? payload.text.substring(0, 30) : 'Shared Content');
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

  const newNote = {
    id: uid(),
    title: noteTitle,
    content: body || '<p></p>',
    pinned: false,
    archived: false,
    tags: ['shared'],
    createdAt: now,
    updatedAt: now
  };

  notes.unshift(newNote);
  saveNotesLocally();
  renderNotesList();
  selectNote(newNote.id);
  if (typeof showToast === 'function') {
    showToast('Saved shared content to new note!');
  }
}
