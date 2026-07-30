import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const repository=process.env.GITHUB_REPOSITORY||'jorzyrockz-crypto/Paperuss-2.0';
const apiUrl=`https://api.github.com/repos/${repository}/releases?per_page=100`;
const headers={Accept:'application/vnd.github+json','User-Agent':'paperuss-changelog-generator'};
if(process.env.GITHUB_TOKEN) headers.Authorization=`Bearer ${process.env.GITHUB_TOKEN}`;

const response=await fetch(apiUrl,{headers});
if(!response.ok) throw new Error(`GitHub Releases request failed: ${response.status} ${response.statusText}`);
const releases=await response.json();
if(!Array.isArray(releases)) throw new Error('GitHub Releases response was not an array');

const entries=releases.map(release=>({
  tagName:release.tag_name||'untagged',
  name:release.name||release.tag_name||'Release',
  title:release.name||'',
  publishedAt:release.published_at||release.created_at||null,
  body:release.body||'',
  url:release.html_url||`https://github.com/${repository}/releases`,
  prerelease:Boolean(release.prerelease)
}));
const payload={
  generatedAt:new Date().toISOString(),
  source:`https://github.com/${repository}/releases`,
  releases:entries
};
const markdown=['# Changelog','',`This file is generated from [GitHub Releases](${payload.source}).`,''];
if(!entries.length) markdown.push('_No published releases yet._','');
for(const release of entries){
  const date=release.publishedAt?new Date(release.publishedAt).toISOString().slice(0,10):'Unpublished';
  markdown.push(`## [${release.tagName}](${release.url}) — ${date}`,'');
  if(release.title&&release.title!==release.tagName) markdown.push(`**${release.title}**`,'');
  markdown.push(release.body||'_No release notes were provided for this version._','');
}
await fs.writeFile(path.join(root,'changelog.json'),`${JSON.stringify(payload,null,2)}\n`);
await fs.writeFile(path.join(root,'CHANGELOG.md'),`${markdown.join('\n')}\n`);
console.log(`Generated changelog for ${entries.length} release(s).`);
