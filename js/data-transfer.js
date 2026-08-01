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
      content: mdToHtml(`# Welcome to PapeRuss 👋

A fast, **offline-first** document editor with a modern flat design.

## 🎨 Rich Text & Typography
Customize your writing with built-in font styles and sizes:
- **Sans**, *Serif*, \`Mono\`, and **Rounded** font families.
- <span style="font-size:13px">Small</span>, <span style="font-size:15px">Normal</span>, <span style="font-size:18px">Large</span>, and <span style="font-size:22px">Huge</span> text sizes.
- **Bold**, *Italic*, <u>Underline</u>, ~~Strikethrough~~, and <mark style="background:#fef08a;color:#0f172a">Highlighter colors</mark> (Yellow, Green, Blue, Pink, Orange, Red).

## 📊 Interactive Tables & Excel Formulas
Type **\`=\`** inside any table cell to trigger the Excel-style formula autocomplete!

<div class="table-wrapper" contenteditable="false"><table contenteditable="true">
  <tbody>
    <tr><th>Category</th><th>Budgeted</th><th>Actual</th><th>Variance</th></tr>
    <tr><td>Travel & Flights</td><td data-format="currency" data-currency="$">500.00</td><td data-format="currency" data-currency="$">420.00</td><td data-format="currency" data-currency="$" data-formula="=C2-B2">-$80.00</td></tr>
    <tr><td>Hotel & Lodging</td><td data-format="currency" data-currency="$">600.00</td><td data-format="currency" data-currency="$">550.00</td><td data-format="currency" data-currency="$" data-formula="=C3-B3">-$50.00</td></tr>
    <tr><td>Meals & Dining</td><td data-format="currency" data-currency="$">250.00</td><td data-format="currency" data-currency="$">290.00</td><td data-format="currency" data-currency="$" data-formula="=C4-B4">$40.00</td></tr>
    <tr style="border-top:2px solid currentColor; font-weight:bold;">
      <td>TOTAL EXPENSES</td><td data-format="currency" data-currency="$" data-formula="=SUM(B2:B4)">$1,350.00</td><td data-format="currency" data-currency="$" data-formula="=SUM(C2:C4)">$1,260.00</td><td data-format="currency" data-currency="$" data-formula="=C5-B5">-$90.00</td>
    </tr>
  </tbody>
</table></div>

<p><br></p>

## 📎 Media & Insert Toolbar
Use the toolbar to quickly insert:
- 🖼️ **Images** — paste or drag & drop directly onto the page
- 🎤 **Voice Recordings** & 🎬 **Inline Videos**
- 🔗 **Rich Link Cards** & 📎 **File Attachments**
- 📐 **Templates** — Expense Tracker, Budget Summary, and Variance Analysis

> Tip: Press \`/\` to search or Ctrl/Cmd + N to create a new note!`),
      createdAt:now-60000, updatedAt:now-30000
    },
    {
      id:uid(), title:'Toolbar & Formatting Cheatsheet', pinned:false, archived:false, tags:['reference','guide'],
      content: mdToHtml(`# Toolbar & Formatting Cheatsheet

## ✏️ Text Formatting
- **Keyboard Shortcuts**: Ctrl+B (Bold), Ctrl+I (Italic), Ctrl+U (Underline).
- **Inline Code**: Use \`code\` blocks for technical snippets.
- **Highlights**: Apply Yellow, Green, Blue, Pink, Orange, or Red mark highlights.

## 📝 Lists & Structures
- Bullet item 1
- Bullet item 2

1. First step
2. Second step

- [x] Completed task item
- [ ] Active task item

## 💬 Quotes & Dividers
> "Design is not just what it looks like — it's how it works." — Steve Jobs

<hr>

## 🖨️ Page Setup & Print Layout
Use **Page Setup** in the bottom bar to switch between:
- **Continuous Flow** vs **Print Layout** (A4, US Letter, US Legal)
- Portrait vs Landscape orientations & Custom Margins`),
      createdAt:now-120000, updatedAt:now-100000
    },
    {
      id:uid(), title:'Financial Budget & Project Plan', pinned:false, archived:false, tags:['finance','planning'],
      content: mdToHtml(`# Financial Budget & Project Plan

## 📈 Quarterly Project Budget
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

## 📌 Deliverables
- [x] Finalize spreadsheet formula calculations
- [ ] Review budget with finance team
- [ ] Deploy v2.0 update`),
      createdAt:now-200000, updatedAt:now-150000
    }
  ];
}
