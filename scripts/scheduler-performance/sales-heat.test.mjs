import test from "node:test";
import assert from "node:assert/strict";
import { salesHeat, monthSales } from "./month-model.mjs";
test("sales heat uses known observations only, preserves zero and marks every best-day tie", () => {
  const store = {history:[
    {day:"2026-10-01",state:"known",units:0},
    {day:"2026-10-02",state:"known",units:4},
    {day:"2026-10-03",state:"known",units:8},
    {day:"2026-10-04",state:"known",units:8},
    {day:"2026-10-05",state:"closed",units:null},
    {day:"2026-10-31",state:"known",units:99},
  ]};
  const heat = salesHeat(store,"2026-10","2026-10-14");
  assert.deepEqual(heat.slice(0,4).map(r=>r.level),[0,2,4,4]);
  assert.deepEqual(heat.filter(r=>r.best).map(r=>r.day),["2026-10-03","2026-10-04"]);
  assert.ok(heat.filter(r=>r.best).every(r=>r.bestLabel.includes("tied")));
  assert.equal(heat[0].units,0);
  assert.equal(heat[4].state,"closed");
  assert.equal(heat[5].state,"unknown");
  assert.equal(heat[30].state,"future");
  assert.ok([heat[4],heat[5],heat[30]].every(r=>r.level===null && !r.best));
  assert.equal(monthSales(store,"2026-10","2026-10-14").total,20);
});
test("all-zero recorded months tie honestly; no observed sales means no best day",()=>{
 const s={history:[{day:"2026-10-01",state:"known",units:0},{day:"2026-10-02",state:"known",units:0}]};
 assert.equal(salesHeat(s,"2026-10","2026-10-14").filter(r=>r.best&&r.level===0&&r.bestLabel.includes('tied')).length,2);
 assert.ok(salesHeat(s,"2026-11","2026-10-14").every(r=>!r.best&&r.level===null));
});
