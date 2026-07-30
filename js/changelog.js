/* ============================================================
   GITHUB RELEASE CHANGELOG
   ============================================================ */
const CHANGELOG_CACHE_KEY='paperuss:changelogCache';
const CHANGELOG_URL='./changelog.json';

function changelogEscape(value){
  const node=document.createElement('div');
  node.textContent=String(value||'');
  return node.innerHTML;
}
function changelogInline(value){
  let html=changelogEscape(value);
  html=html.replace(/`([^`]+)`/g,'<code>$1</code>');
  html=html.replace(/\*\*([^*]+)\*\*/g,'<strong>$1</strong>');
  html=html.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g,'<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>');
  return html;
}
function changelogMarkdownToHtml(markdown){
  const lines=String(markdown||'').replace(/\r\n?/g,'\n').split('\n');
  let html='', listType=null;
  const closeList=()=>{ if(listType){ html+=`</${listType}>`; listType=null; } };
  for(const rawLine of lines){
    const line=rawLine.trim();
    const heading=line.match(/^(#{1,3})\s+(.+)$/);
    const bullet=line.match(/^[-*+]\s+(.+)$/);
    const ordered=line.match(/^\d+[.)]\s+(.+)$/);
    if(heading){ closeList(); html+=`<h5>${changelogInline(heading[2])}</h5>`; continue; }
    if(bullet){ if(listType!=='ul'){ closeList(); html+='<ul>'; listType='ul'; } html+=`<li>${changelogInline(bullet[1])}</li>`; continue; }
    if(ordered){ if(listType!=='ol'){ closeList(); html+='<ol>'; listType='ol'; } html+=`<li>${changelogInline(ordered[1])}</li>`; continue; }
    closeList();
    if(line) html+=`<p>${changelogInline(line)}</p>`;
  }
  closeList();
  return html||'<p>No release notes were provided for this version.</p>';
}
function changelogDate(value){
  const date=new Date(value);
  return Number.isNaN(date.getTime())?'':date.toLocaleDateString(undefined,{month:'short',day:'numeric',year:'numeric'});
}
function renderChangelog(root,data,notice){
  const releases=Array.isArray(data?.releases)?data.releases:[];
  if(!releases.length){
    root.innerHTML='<div class="changelog-state">No published releases yet.</div>';
    return;
  }
  root.innerHTML=(notice?`<div class="changelog-state" style="padding:0 0 16px">${changelogEscape(notice)}</div>`:'')+releases.map(release=>{
    const name=changelogEscape(release.name||release.tagName||'Release');
    const title=release.title&&release.title!==release.tagName?` · ${changelogEscape(release.title)}`:'';
    const date=changelogDate(release.publishedAt);
    return `<article class="changelog-release"><div class="changelog-release-head"><h4>${name}${title}</h4>${date?`<time>${date}</time>`:''}</div>${changelogMarkdownToHtml(release.body)}</article>`;
  }).join('');
}
function readCachedChangelog(){
  try{ return JSON.parse(localStorage.getItem(CHANGELOG_CACHE_KEY)||'null'); }catch(_){ return null; }
}
function cacheChangelog(data){
  try{ localStorage.setItem(CHANGELOG_CACHE_KEY,JSON.stringify(data)); }catch(_){}
}
async function loadChangelog(){
  const response=await fetch(CHANGELOG_URL,{cache:'no-store'});
  if(!response.ok) throw new Error(`Changelog request failed (${response.status})`);
  const data=await response.json();
  if(!Array.isArray(data?.releases)) throw new Error('Changelog document is invalid');
  cacheChangelog(data);
  return data;
}
function openChangelogModal(){
  const root=document.getElementById('modalRoot');
  if(!root) return;
  root.innerHTML=`<div class="modal-overlay"><section class="modal changelog-modal" role="dialog" aria-modal="true" aria-labelledby="changelogTitle"><div class="changelog-head"><h3 id="changelogTitle">What's new</h3><button class="changelog-close" type="button" aria-label="Close What's new" data-changelog-close><i data-lucide="x"></i></button></div><div class="changelog-body" id="changelogBody"><div class="changelog-state">Loading release notes…</div></div></section></div>`;
  const close=()=>{ root.innerHTML=''; };
  root.querySelector('[data-changelog-close]').onclick=close;
  root.querySelector('.modal-overlay').onclick=event=>{ if(event.target===event.currentTarget) close(); };
  refreshIcons();
  const body=document.getElementById('changelogBody');
  loadChangelog().then(data=>renderChangelog(body,data)).catch(()=>{
    const cached=readCachedChangelog();
    if(cached){ renderChangelog(body,cached,'Showing saved release notes while offline.'); return; }
    body.innerHTML='<div class="changelog-state">Could not load release notes.<br><button class="btn" type="button" data-changelog-retry>Retry</button></div>';
    body.querySelector('[data-changelog-retry]').onclick=()=>openChangelogModal();
  });
}
