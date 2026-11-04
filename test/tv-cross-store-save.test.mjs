import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const src=fs.readFileSync(new URL('../src/leaderboard-template.mjs',import.meta.url),'utf8');
async function run(results) {
 const begin=src.indexOf("    document.getElementById('tsave').onclick = async function(){");
 const end=src.indexOf('\n    };\n  }',begin); assert.ok(begin>=0&&end>begin);
 const button={},msg={},calls=[];
 const ctx={document:{getElementById:id=>id==='tsave'?button:msg},DISP:{tscale:1.4,style:'bars'},DKEY:'fixture',localStorage:{setItem(){}},tsizeKeep(){},
  CFG:{storeId:'visiting'},HOME:{id:'home',key:'home-key'},LAST:{boardDisplay:{tscale:1}},
  window:{opener:{async __lpcSaveBoardDisplay(id,value){calls.push({id,value});const result=results[id];if(result==='throw')throw Error('failed');return result;}}},
  getStoreByKey:async()=>({boardDisplay:{tscale:1.2}}),setTimeout(){}};
 vm.runInNewContext(src.slice(begin,end)+'\n    };',ctx); await button.onclick();
 return {calls,msg:msg.textContent};
}
test('rotated gear save reports a partial publication when the home save fails or throws',async()=>{
 for(const home of [false,'throw']) { const {calls,msg}=await run({visiting:true,home});
  assert.deepEqual(calls.map(x=>x.id),['visiting','home']); assert.equal(calls[0].value.tscale,1.4);
  assert.equal(msg,'Saved for the current store. Home store not saved.'); }
});
test('failed visiting write stops before home and reports local-only',async()=>{
 const {calls,msg}=await run({visiting:false,home:true}); assert.deepEqual(calls.map(x=>x.id),['visiting']); assert.equal(msg,'Saved on this screen only.');
});
test('successful rotated writes report success',async()=>{
 const {calls,msg}=await run({visiting:true,home:true}); assert.deepEqual(calls.map(x=>x.id),['visiting','home']); assert.equal(msg,'Saved for this store, on every screen.');
});
