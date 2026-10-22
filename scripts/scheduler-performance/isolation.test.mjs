import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { transformSync } from "esbuild";
import { patchManager, patchManagerPinned, patchPhoneLayout, MANAGER_SHA } from "./build.mjs";
test("preview refuses to patch a changed Manager ownership boundary", async () => {
  const source = await readFile(
    new URL("../../src/Manager.jsx", import.meta.url),
    "utf8",
  );
  assert.throws(() => patchManager(source + "\n"), /Re-review entry points/);
  const patched = patchManager(source);
  assert.ok(!patched.includes("scheduler-manual"), "manual live code absent from preview");
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
    source,
  );
});

test("preview input-aware layout transform refuses changed core source", async()=>{
 const source=await readFile(new URL("../../src/LeadPerformanceCalculator.jsx",import.meta.url),"utf8");
 assert.throws(()=>patchPhoneLayout(source+"\n"),/Core layout boundary changed/);
 assert.ok(!patchPhoneLayout(source).includes('scheduler-manual'));
 assert.ok(patchPhoneLayout(source).includes('(max-width: 700px) and (hover: none) and (pointer: coarse)'));
 assert.equal(await readFile(new URL("../../src/LeadPerformanceCalculator.jsx",import.meta.url),"utf8"),source);
});

/* ---- The Manager pin and entry anchors (H-X54) --------------------------------------------
   The preview rewrites Manager.jsx in memory, and it must refuse anything it was not
   reviewed against. These checks damage the source on purpose and expect a stop. */
const managerSource = () => readFile(new URL("../../src/Manager.jsx", import.meta.url), "utf8");
const sha = (text) => createHash("sha256").update(text).digest("hex");
// A damaged copy, pinned to its own hash so the guard passes and the anchor check behind it is the one under test.
const reach = (damaged) => patchManagerPinned(sha(damaged))(damaged);

const FLAG = 'const SCHEDULER_CALENDAR = import.meta.env.VITE_SCHEDULER_CALENDAR === "1";';
const LAZY = 'const SchedulerCalendarEntry = React.lazy(() => import("./scheduler-calendar.jsx").then((m) => ({ default: m.SchedulerCalendarEntry })));';
const R1 = '{!SCHEDULER_CALENDAR && (\n          <button type="button" className="bp-r1" onClick={() => setPop({ k: "month" })}>';
const R3 = '{!SCHEDULER_CALENDAR && (\n          <button type="button" className="bp-r3" onClick={() => setPop({ k: "onoff" })}>';
const HERO = '        </div>\n        {MANUAL_SCHEDULER_ENABLED && <React.Suspense fallback={null}><ManualManagerEntry client={supabase} storeId={store.id} store={store} data={data} isOff={isOff}/></React.Suspense>}\n        {SCHEDULER_CALENDAR && (\n          <React.Suspense fallback={null}><SchedulerCalendarEntry store={store} data={data} isOff={isOff} layout="compact" /></React.Suspense>\n        )}\n      </div>\n\n      {canSetGoal && !goalMonth.set';

test("the exact Manager source is the only one the preview accepts", async () => {
  const source = await managerSource();
  assert.equal(sha(source), MANAGER_SHA, "the pin is the reviewed Manager");
  assert.doesNotThrow(() => patchManager(source));
  const edited = source.replace("function SignalSchedule(", "function SignalSchedule2(");
  assert.notEqual(edited, source);
  assert.throws(() => patchManager(edited), /Manager source changed/, "one renamed function");
  assert.throws(() => patchManager(source.slice(0, -1)), /Manager source changed/, "one character short");
  assert.throws(() => patchManager(source.replace(FLAG, FLAG.replace('"1"', '"2"'))), /Manager source changed/, "the flag value");
  // A wrong, missing or placeholder pin never passes, even on the right source.
  for (const pin of ["0".repeat(64), "pending", "", undefined, null, MANAGER_SHA.toUpperCase(), MANAGER_SHA.slice(0, 63)])
    assert.throws(() => patchManagerPinned(pin)(source), /Manager source changed/, String(pin));
});

test("a missing entry anchor stops the preview", async () => {
  const source = await managerSource();
  const cases = {
    "the live flag line": source.replace(FLAG, ""),
    "the live lazy import": source.replace(LAZY, ""),
    "the phone calendar button": source.replace(R1, "{!SCHEDULER_CALENDAR && (\n          <button type=\"button\" className=\"bp-r1\" onClick={() => setPop({ k: \"months\" })}>"),
    "the phone staffing button": source.replace(R3, "{!SCHEDULER_CALENDAR && (\n          <button type=\"button\" className=\"bp-r3\" onClick={() => setPop({ k: \"onoffs\" })}>"),
    "the phone hero bottom": source.replace(HERO, HERO.replace('layout="compact"', 'layout="roomy"')),
    "the unwrapped phone calendar button (the pre-reconciliation shape)": source.replace(R1, R1.replace("{!SCHEDULER_CALENDAR && (\n          ", "")),
  };
  for (const [name, damaged] of Object.entries(cases)) {
    assert.notEqual(damaged, source, name);
    assert.throws(() => reach(damaged), /anchor not found|boundary not found|Re-review entry points/, name);
  }
});

test("a duplicated entry anchor stops the preview", async () => {
  const source = await managerSource();
  const cases = {
    "the live flag line": source.replace(FLAG, FLAG + "\n" + FLAG),
    "the live lazy import": source.replace(LAZY, LAZY + "\n" + LAZY),
    "the phone calendar button": source + "\n" + R1 + "\n",
    "the phone staffing button": source + "\n" + R3 + "\n",
    "the phone hero bottom": source + "\n" + HERO + "\n",
  };
  for (const [name, damaged] of Object.entries(cases)) {
    assert.notEqual(damaged, source, name);
    assert.throws(() => reach(damaged), /anchor is duplicated/, name);
  }
});

test("the transformed Manager parses and carries exactly one entry on each surface", async () => {
  const source = await managerSource();
  const patched = patchManager(source);
  assert.ok(!patched.includes("scheduler-manual"), "manual live code absent from preview");
  // It is real JSX: the parser accepts it, so no wrapper was left empty or half removed.
  assert.doesNotThrow(() => transformSync(patched, { loader: "jsx", logLevel: "silent" }));
  // The preview's own entry, once on the desktop and once on the phone.
  assert.equal((patched.match(/<PreviewScheduleEntry/g) || []).length, 2);
  assert.equal((patched.match(/<PreviewScheduleEntry className="bp-r1"\/>/g) || []).length, 1);
  assert.equal((patched.match(/return signal\?<PreviewScheduleEntry\/>:children;/g) || []).length, 1);
  // The live entry never reaches the preview: nothing imports it, the flag is fixed off,
  // and the phone placement is replaced by the preview's rather than added beside it.
  assert.ok(!patched.includes("scheduler-calendar.jsx"), "no live file is imported");
  assert.ok(!patched.includes("VITE_SCHEDULER_CALENDAR"), "no build flag is read");
  assert.ok(patched.includes("const SCHEDULER_CALENDAR = false;"));
  assert.ok(patched.includes("const SchedulerCalendarEntry = () => null;"));
  assert.ok(!patched.includes('layout="compact"'), "the live phone entry is gone");
  assert.equal((patched.match(/<SchedulerCalendarEntry/g) || []).length, 1, "only the dead desktop branch names it");
  // The legacy buttons are gone, and what is left in their wrappers is a valid empty slot.
  assert.ok(!patched.includes('className="bp-r1" onClick'));
  assert.ok(!patched.includes('className="bp-r3" onClick'));
  assert.equal((patched.match(/\{!SCHEDULER_CALENDAR && \(\n          null\n          \)\}/g) || []).length, 2);
  // The unchanged Manager is still what is on disk.
  assert.equal(await managerSource(), source);
});

test("with the flag off the live dashboard keeps every legacy element", async () => {
  const source = await managerSource();
  // The flag appears in its declaration, the build variable it reads, and the four places it gates.
  assert.equal((source.match(/SCHEDULER_CALENDAR/g) || []).length, 6);
  assert.equal((source.match(/<SchedulerCalendarEntry/g) || []).length, 2, "two entries, both behind the flag");
  for (const legacy of ['<SignalSchedule onCount={onCount} offCount={offToday.length}>',
    'className="bp-r1" onClick={() => setPop({ k: "month" })}', 'className="bp-r3" onClick={() => setPop({ k: "onoff" })}'])
    assert.equal((source.match(new RegExp(legacy.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g")) || []).length, 1, legacy);
});
