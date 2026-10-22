import assert from 'node:assert/strict';
import {readFileSync,readdirSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
export const PIN = 'c86db1d32a4fdfe6f0905db641860e73f9e9f01c590245be986e7126545d1794';
export const hash = bytes => createHash('sha256').update(bytes).digest('hex');
export function protectedPaths(root) {
 const result=[];
 const walk=path=>{for(const entry of readdirSync(new URL(path+'/',root),{withFileTypes:true})){
  const name=path+'/'+entry.name;assert(!entry.isSymbolicLink(),'symlink not allowed in carrier sources');
  if(entry.isDirectory())walk(name);else{assert(entry.isFile());result.push(name);}
 }};
 walk('src');walk('api');return result.sort();
}
export function verifyCarrier(bytes, read, paths) {
 assert.equal(hash(bytes),PIN,'carrier manifest requires independent re-review');
 const m=JSON.parse(bytes);assert.equal(m.version,'scheduler-carrier/1');
 assert.equal(m.base,'2861377737f2e04a1d7d462793010f2f2e6085c1');
 assert.equal(m.branch,'codex/scheduler-published-delivery-local');
 assert.deepEqual([...paths].sort(),Object.keys(m.files).filter(p=>p.startsWith('src/')||p.startsWith('api/')).sort(),'unlisted or missing application source');
 for(const [path,digest] of Object.entries(m.files)){
  assert(!path.startsWith('/')&&!path.split('/').includes('..'));
  assert.equal(hash(read(path)),digest,'unreviewed or missing carrier source: '+path);
 }
 const config=JSON.parse(read('vercel.json'));
 for(const branch of ['claude/scheduler-live-integration','claude/scheduler-editor-runtime',m.branch])assert.equal(config.git.deploymentEnabled[branch],false);
 assert.match(read('src/scheduler-manual-client.mjs').toString(),/MANUAL_SCHEDULER_ENABLED\s*=\s*false/);
 return Object.keys(m.files).length;
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const root=new URL('../../',import.meta.url);
 console.log('Verified exact carrier files: '+verifyCarrier(readFileSync(new URL('./runtime.json',import.meta.url)),p=>readFileSync(new URL(p,root)),protectedPaths(root)));
}
