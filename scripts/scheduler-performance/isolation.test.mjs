import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { patchManager, patchPhoneLayout } from "./build.mjs";
import postcss from "postcss";
import {historicalManagerFixture,CURRENT_MANAGER_SHA,HISTORICAL_MANAGER_SHA} from "./historical-manager-fixture.mjs";
import {createHash} from "node:crypto";
import { peoplePreviewInput } from "./people-preview-input.mjs";
import { roomHintPreviewInput } from "./room-hint-preview-input.mjs";

test("scheduler styles require a scheduler root or an explicit standalone/ghost marker", async () => {
 for (const name of ["planner.css", "calendar-tokens.css"]) {
  const source=await readFile(new URL(name, import.meta.url), "utf8"), sheet=postcss.parse(source);
  sheet.walkRules(rule=>{
   for(let parent=rule.parent;parent;parent=parent.parent)if(parent.type==="atrule"&&/keyframes/i.test(parent.name))return;
   for(const selector of postcss.list.comma(rule.selector))assert.match(selector,/scheduler-mounted|scheduler-standalone|scheduler-ghost/,`${name}: ${selector}`);
  });
 }
});
test("preview refuses to patch a changed Manager ownership boundary", async () => {
  const current = await readFile(
    new URL("../../src/Manager.jsx", import.meta.url),
    "utf8",
  );
  // Historical approval is still tested against its exact bytes. The current
  // app is checked separately and remains refused by this transform.
  const source = historicalManagerFixture(peoplePreviewInput(roomHintPreviewInput(current)));
  assert.throws(() => patchManager(current), /Re-review entry points/);
  assert.throws(() => patchManager(source + "\n"), /Re-review entry points/);
  const patched = patchManager(source);
  // The calendar and the monthly-context handoff share the same scheduler.
  assert.equal((patched.match(/scheduler-open/g) || []).length, 2);
  assert.equal((patched.match(/data-delivered-route onClick={openDelivered}/g) || []).length, 2);
  assert.ok(!patched.includes('className="bp-swg"'));
  assert.ok(!patched.includes('hd("Sold by day"'));
  assert.ok(!patched.includes('onClick={() => setPop({ k: "onoff" })}'));
  assert.ok(!patched.includes('<BloopWin cls="dn s2-salewin">'));
  assert.ok(patched.includes("sp-mini-grid"));
  assert.ok(!patched.includes('<button className={"s2-imp s2-lampbtn"'));
  for (const route of ['function ManagerContextAction(', 'function ImportPanel(', 'onClick={() => { onClose(); onImport(); }}>Import</button>']) {
    assert.ok(source.includes(route) && patched.includes(route), "manual Import route preserved");
  }
  assert.equal(
    await readFile(new URL("../../src/Manager.jsx", import.meta.url), "utf8"),
    current,
  );
});

test("preview input-aware layout transform refuses changed core source", async()=>{
 const source=await readFile(new URL("../../src/LeadPerformanceCalculator.jsx",import.meta.url),"utf8");
 assert.throws(()=>patchPhoneLayout(source+"\n"),/Core layout boundary changed/);
 assert.ok(patchPhoneLayout(source).includes('(max-width: 700px) and (hover: none) and (pointer: coarse)'));
 assert.equal(await readFile(new URL("../../src/LeadPerformanceCalculator.jsx",import.meta.url),"utf8"),source);
});

test("historical Manager fixture preserves exact source approval and rejects drift",async()=>{
 const sha=value=>createHash("sha256").update(value).digest("hex");
 const current=await readFile(new URL("../../src/Manager.jsx",import.meta.url),"utf8");
 const qualified = peoplePreviewInput(roomHintPreviewInput(current));
 assert.equal(sha(qualified),CURRENT_MANAGER_SHA);
 assert.equal(sha(historicalManagerFixture(qualified)),HISTORICAL_MANAGER_SHA);
 assert.throws(()=>historicalManagerFixture(qualified+"\n"),/fixture input changed/);
 assert.throws(()=>historicalManagerFixture(qualified.replace('layout="panel"','layout="compact"')),/fixture input changed/);
 const builder=await readFile(new URL("build.mjs",import.meta.url),"utf8"),start=builder.indexOf("export function patchManager("),end=builder.indexOf("export async function buildPreview()",start);
 assert.equal(sha(builder.slice(start,end)),"29503dece524a14f6f1ebca2ecad0e9363dffc45a80279cc3d3e820572b6b654","historical transform and source guard remain byte-identical");
});

test("People preview qualification is exact and leaves the historical fixture gate unchanged", async () => {
 const current = await readFile(new URL("../../src/Manager.jsx", import.meta.url), "utf8");
 const peopleSource = roomHintPreviewInput(current);
 const approved = peoplePreviewInput(peopleSource);
 assert.notEqual(peopleSource, approved, "exercise the separate People input");
 assert.equal(peoplePreviewInput(approved), approved);
 assert.throws(() => historicalManagerFixture(peopleSource), /fixture input changed/);
 for (const drift of [peopleSource + "\n", peopleSource.replace("out[k] = deliveredUnits(st);", "out[k] = 0;")]) {
  assert.notEqual(drift, peopleSource);
  assert.equal(peoplePreviewInput(drift), drift);
  assert.throws(() => historicalManagerFixture(peoplePreviewInput(drift)), /fixture input changed/);
 }
});

test("the frozen preview restores only the exact Rooms copy change", async () => {
 const current = await readFile(new URL("../../src/Manager.jsx", import.meta.url), "utf8");
 const prior = roomHintPreviewInput(current);
 assert.notEqual(current, prior);
 const sha = (source) => createHash("sha256").update(source).digest("hex");
 assert.equal(sha(current),"a1158563cb3b8901012a61e39ce44ab49a006a44c15b19f04b27028fda73c1d8");
 assert.equal(sha(prior),"1c39e25917dc225649429f206ae8a7bc9a78d92eb739e09eac8e03e8922d4250");
 assert.match(current, /k === "floor" \? "Leave blank to open Live Floor 1 hour before the store opens, or at 8:00 AM if store hours aren’t set\. A time you set for a weekday takes priority\. Store time\." : "Blank means the desk opens it, as before\. Store time\."/);
 const altered = current + "\n";
 assert.equal(roomHintPreviewInput(altered), altered);
 assert.throws(() => historicalManagerFixture(peoplePreviewInput(roomHintPreviewInput(altered))), /fixture input changed/);
});
