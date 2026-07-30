const fs=require('node:fs');
const path=require('node:path');

const root=path.resolve(__dirname,'..');
const output=path.join(root,'.worker-assets');
const files=['index.html','manifest.webmanifest','sw.js','changelog.json'];
const directories=['assets','js'];

fs.rmSync(output,{recursive:true,force:true});
fs.mkdirSync(output,{recursive:true});
for(const file of files){
  const src=path.join(root,file);
  if(fs.existsSync(src)){
    fs.copyFileSync(src,path.join(output,file));
  }
}
for(const directory of directories){
  const src=path.join(root,directory);
  if(fs.existsSync(src)){
    fs.cpSync(src,path.join(output,directory),{recursive:true});
  }
}
console.log(`Staged root files and asset directories in ${output}`);

