import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const manager=readFileSync(new URL('../src/Manager.jsx',import.meta.url),'utf8');
const core=readFileSync(new URL('../src/LeadPerformanceCalculator.jsx',import.meta.url),'utf8');
const hero=manager.slice(manager.indexOf('          {closing.map((c) => {',manager.indexOf('function BoardRoomPhone')),manager.indexOf('          <span className="bp-sep"',manager.indexOf('function BoardRoomPhone')));
const gradeExpression=hero.match(/const gradePct = (.*);/)[1];
const stateExpression=hero.match(/const state = (.*);/)[1];
const status=new Function('c','thr',`const target=thr[c.id].green;const gradePct=${gradeExpression};return ${stateExpression};`);
const asPoints=new Function('v',`return ${core.match(/const asPoints = \(v\) => (.*);/)[1]};`);
const gradeOf=new Function('c','stdOf',`return ${core.match(/const gradeOf = \(c\) => (.*);/)[1]};`);
const translate={g:'ok',y:'warn',r:'bad',null:'na'};
for(const [channel,green,yellow] of [['internet',20,10],['phone',25,12],['showroom',30,15],['custom-internet',38,27],['custom-phone',31,22],['custom-showroom',45,33]]){
 test(`${channel}: exact closing-sheet rounded boundaries and missing/zero/full rates`,()=>{
  const thresholds={[channel]:{green,yellow}};
  const points=[null,0,.1,yellow-.051,yellow-.05,yellow-.049,yellow-.04,yellow,yellow+.001,green-.051,green-.05,green-.049,green-.04,green,green+.001,green*1.2];
  for(const point of points){const value=point==null?null:point/100;
   assert.equal(status({id:channel,pct:value},thresholds),translate[gradeOf({k:channel,pct:asPoints(value)},k=>thresholds[k])],`raw points ${point}`);
  }
  assert.equal(status({id:channel,pct:(green-.04)/100},thresholds),'ok');
  assert.equal(status({id:channel,pct:(yellow-.04)/100},thresholds),'warn');
  assert.equal(status({id:channel,pct:(green-.051)/100},thresholds),'warn');
  assert.equal(status({id:channel,pct:(yellow-.051)/100},thresholds),'bad');
 });
}
test('hero palette matches the established main closing-sheet palette',()=>{
 const main=core.match(/const GRADE_INK = (\{[^;]+\});/)[1];
 const palette=new Function(`return (${main})`)();
 assert.deepEqual(palette,{g:'#8FD8AF',y:'#E4C98D',r:'#F08A80'});
 const hero=manager.slice(manager.indexOf('          {closing.map((c) => {',manager.indexOf('function BoardRoomPhone')),manager.indexOf('          <span className="bp-sep"',manager.indexOf('function BoardRoomPhone')));
 assert.ok(!hero.includes('bpDotState('));
 for(const color of Object.values(palette))assert.ok(hero.includes(color));
 assert.ok(!hero.includes('CHANNEL_HUE'));
});
