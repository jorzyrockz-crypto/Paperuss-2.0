const fs=require('node:fs');
const path=require('node:path');

const root=path.resolve(__dirname,'..');
const output=path.join(root,'.worker-assets');
const files=['index.html','manifest.webmanifest','sw.js','changelog.json'];
const directories=['assets','js'];

fs.rmSync(output,{recursive:true,force:true});
fs.mkdirSync(output,{recursive:true});
for(const file of files) fs.copyFileSync(path.join(root,file),path.join(output,file));
for(const directory of directories){
  fs.cpSync(path.join(root,directory),path.join(output,directory),{recursive:true});
}
console.log(`Staged ${files.length} root files and ${directories.length} asset directories in ${output}`);
