// Read-only preflight for the GitHub Ubuntu host package; never installs or starts services.
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {realpath} from 'node:fs/promises';
import path from 'node:path';
const execute=promisify(execFile);
export function versionNumber(output){
 const match=/\(PostgreSQL\) (16)\.(\d+)(?:\s|$)/.exec(output);
 if(!match)throw Error('postgres-16-required');
 return 160000+Number(match[2]);
}
export async function postgresPreflight({run=execute,canonical=realpath,uid=process.getuid()}={}){
 if(!Number.isInteger(uid)||uid===0)throw Error('non-root-required');
 const {stdout}=await run('/usr/bin/dpkg-query',['-L','postgresql-16'],{timeout:5000});
 const candidates=stdout.split('\n').filter(p=>/^\/usr\/lib\/postgresql\/16\/bin\/postgres$/.test(p));
 if(candidates.length!==1)throw Error('postgres-server-package-required');
 const postgres=await canonical(candidates[0]);if(postgres!==candidates[0])throw Error('unexpected-binary-location');
 const bin=path.dirname(postgres);let version;
 for(const name of ['postgres','initdb','pg_ctl','psql']){
  const binary=path.join(bin,name);if(await canonical(binary)!==binary)throw Error('unexpected-binary-location');
  const result=await run(binary,['--version'],{timeout:5000});const current=versionNumber(result.stdout);
  if(version!==undefined&&current!==version)throw Error('postgres-tools-version-mismatch');version=current;
 }
 return {bin,version,uid};
}
if(process.argv[1]===new URL(import.meta.url).pathname)console.log(JSON.stringify(await postgresPreflight()));
