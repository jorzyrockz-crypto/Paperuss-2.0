import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const repository=process.env.GITHUB_REPOSITORY||'jorzyrockz-crypto/Paperuss-2.0';
const apiUrl=`https://api.github.com/repos/${repository}/releases?per_page=100`;
const headers={Accept:'application/vnd.github+json','User-Agent':'paperuss-changelog-generator'};
if(process.env.GITHUB_TOKEN) headers.Authorization=`Bearer ${process.env.GITHUB_TOKEN}`;

let entries=[];
try{
  const response=await fetch(apiUrl,{headers});
  if(response.ok){
    const releases=await response.json();
    if(Array.isArray(releases)){
      entries=releases.map(release=>({
        tagName:release.tag_name||'untagged',
        name:release.name||release.tag_name||'Release',
        title:release.name||'',
        publishedAt:release.published_at||release.created_at||null,
        body:release.body||'',
        url:release.html_url||`https://github.com/${repository}/releases`,
        prerelease:Boolean(release.prerelease)
      }));
    }
  }
}catch(e){
  console.warn('Could not fetch releases from GitHub API, using fallback notes:', e.message);
}

if(!entries.length){
  entries=[
    {
      tagName:'v2.0.0',
      name:'PapeRuss 2.0 Official Release',
      title:'Major Feature Release & Improvements',
      publishedAt:new Date().toISOString(),
      body:`### What's New in PapeRuss 2.0
- **Block & Rich Text Editor**: Enhanced formatting, table insertion, drag-and-drop media, slash commands, and block handles.
- **Cloud Sync & Firebase Auth**: Cross-device synchronization with complete offline fallback and local IndexedDB media storage.
- **Attachment & Scroll Fixes**: Smooth note navigation, auto-scroll containment, and resilient offline attachment caching.
- **Task & Activity Hub**: Centralized notifications, due-task alert banners, completion chimes, and reminder scheduling.
- **Theme & Accent Customization**: Vibrant dark/light modes and customizable accent themes.
- **Data Backup & Clearing**: Portability tools to export/import backups and clear local offline cache safely.`,
      url:`https://github.com/${repository}/releases`,
      prerelease:false
    }
  ];
}

const payload={
  generatedAt:new Date().toISOString(),
  source:`https://github.com/${repository}/releases`,
  releases:entries
};

const markdown=['# Changelog','',`This file is generated from [GitHub Releases](${payload.source}).`,''];
for(const release of entries){
  const date=release.publishedAt?new Date(release.publishedAt).toISOString().slice(0,10):'Unpublished';
  markdown.push(`## [${release.tagName}](${release.url}) — ${date}`,'');
  if(release.title&&release.title!==release.tagName) markdown.push(`**${release.title}**`,'');
  markdown.push(release.body||'_No release notes were provided for this version._','');
}

await fs.writeFile(path.join(root,'changelog.json'),`${JSON.stringify(payload,null,2)}\n`);
await fs.writeFile(path.join(root,'CHANGELOG.md'),`${markdown.join('\n')}\n`);
console.log(`Generated changelog for ${entries.length} release(s).`);
