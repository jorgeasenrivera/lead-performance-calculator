import {test} from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {LEADERBOARD_HTML} from '../src/leaderboard-template.mjs';
test('generated board confines payload to JSON and escapes title text',()=>{
 const html=LEADERBOARD_HTML({storeName:'</title><img src=x onerror=alert(1)>',roster:[{name:'</script><script>throw 1</script>'}]},{dot:['1']});
 assert.ok(html.includes('&lt;/title&gt;&lt;img'));
 assert.equal((html.match(/<script>/g)||[]).length,1);
 const code=html.slice(html.indexOf('<script>')+8,html.lastIndexOf('</script>'));
 assert.doesNotThrow(()=>new vm.Script(code));
 assert.ok(code.includes('\\u003c/script>'));
 const start=code.indexOf('  function esc('),end=code.indexOf('  // The same',start);
 const ctx=vm.createContext({});vm.runInContext(code.slice(start,end),ctx);
 assert.equal(vm.runInContext('esc("<img onerror=x>")',ctx),'&lt;img onerror=x&gt;');
 assert.equal(vm.runInContext('imageURL("javascript:alert(1)")',ctx),'');
 assert.equal(vm.runInContext('imageURL("https://example.invalid/a\\\" onerror=\\\"x")',ctx),'https://example.invalid/a&quot; onerror=&quot;x');
});
