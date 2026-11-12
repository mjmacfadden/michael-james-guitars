// Explicit static allowlist: never deploy the repository root.
import { cp, mkdir, rm, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dest=path.join(root,'public');
await rm(dest,{recursive:true,force:true});
await mkdir(dest,{recursive:true});
const names=(await readdir(root)).filter(n=>n.endsWith('.html'));
// fretboard-builder/: the builder page's scripts + vendored engine; docs, tests and the standalone page stay out of Hosting.
const skip=src=>{const b=path.basename(src);return b.startsWith('.')||b.endsWith('.md')||(src.includes(`${path.sep}fretboard-builder${path.sep}engine`)&&(b==='test.js'||b==='index.html'));};
for(const name of [...names,'robots.txt','assets','css','js','data','fretboard-builder']) {
 await cp(path.join(root,name),path.join(dest,name),{recursive:true,filter:src=>!skip(src)});
}
console.log('Static staging complete; no deployment performed.');
