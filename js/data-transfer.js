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
function toast(msg, action){
  const c=document.getElementById('toast-container');
  const t=document.createElement('div');
  t.className='toast';
  t.innerHTML='<span>'+msg+'</span>'+(action?'<button class="toast-action">Undo</button>':'');
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
      id:uid(), title:'Welcome to PapeRuss 👋', pinned:true, archived:false, tags:['intro'],
      content: mdToHtml(`# Welcome to PapeRuss 👋

A fast, **offline-first** note-taking app with a sleek **modern flat** design.

## What you see is what you get
- Notes auto-save to your browser, with cross-device sync when you sign in
- Toggle between dark and light themes
- Organize with **tags**, pin important notes, and archive old ones
- Instant search across titles, content, and tags

## Rich media, right in your notes 📎
Use the toolbar buttons on the right to add:
- 🖼️ **Images** — click, or just **drag and drop** / **paste** them
- 🎤 **Voice recordings** — record directly from your microphone
- 🎬 **Videos** — attach a clip and play it inline
- 🔗 **Rich link cards** — paste a URL to embed a preview card
- 📎 **Attachments** — any file, downloadable later

Guest work stays **local**. Signed-in work is encrypted in transit and synced through your Firebase project.

## Try it out
1. Click **New** to create a note
2. Type normally — formatting appears as you apply it
3. Drop an image onto the editor, or click the picture button
4. Pin this note so it stays on top

> Tip: press \`/\` to jump to search, or Ctrl/Cmd+N for a new note.

Happy writing!`),
      createdAt:now-60000, updatedAt:now-30000
    },
    {
      id:uid(), title:'Formatting Cheatsheet', pinned:false, archived:false, tags:['reference'],
      content: mdToHtml(`# Formatting Cheatsheet

## Text styles
Use the toolbar for **bold**, *italic*, underline, and ~~strikethrough~~.

You can also:
- Ctrl/Cmd + B → bold
- Ctrl/Cmd + I → italic
- Ctrl/Cmd + U → underline

## Font size
Use the **Size** dropdown to change text size:
- **Sm** — Small / compact
- **N** — Normal (default)
- **Lg** — Large
- **Hg** — Huge
- **Mx** — Massive

## Highlighting
Pick a colour from the **highlighter** tool: Yellow, Green, Blue, Pink, Orange, Red. Click the same colour again to remove it.

## Lists
- Bullet item
- Another item

1. First
2. Second

- [x] Completed task
- [ ] Todo item

## Quote
> Design is not just what it looks like — it's how it works.

Select any text and click a toolbar button to format it instantly.`),
      createdAt:now-120000, updatedAt:now-100000
    },
    {
      id:uid(), title:'Project Roadmap', pinned:false, archived:false, tags:['work','planning'],
      content: mdToHtml(`# Project Roadmap

## This week
- [ ] Finalize the design system
- [ ] Ship the onboarding flow
- [x] Set up analytics

## Next sprint
- [ ] Mobile layout polish
- [ ] Keyboard shortcuts
- [ ] Export to PDF

> **Reminder:** review with the team before Friday.`),
      createdAt:now-200000, updatedAt:now-150000
    }
  ];
}
