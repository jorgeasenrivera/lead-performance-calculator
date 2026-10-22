import {deliveryRoutes} from "./delivery-routing.mjs";
import {sharedCore,sharedManager,relativeTypography} from "./shared-transform.mjs";
import { readFile, writeFile, mkdir, cp } from "node:fs/promises";
import { createHash } from "node:crypto";
import { build } from "vite";
import react from "@vitejs/plugin-react";
import { finalizeHtml, MAIN_POLICY, PLANNER_POLICY } from "./html-finalize.mjs";
import { fixtures } from "../scheduler-proposal/model.mjs";
import { monthSales } from "./month-model.mjs";
import { buildDemo } from "../demo-seed.mjs";
export const MANAGER_SHA =
  "0b943da7c44e8dddd10818a7019ef06caf7e6fe653b5fd27f344b878683bb869";
// Every anchor below must appear exactly once. Zero means the source moved; two means one
// of them would be edited and the other left behind. Either way the build stops.
function once(source, text, name) {
  const first = source.indexOf(text);
  if (first < 0) throw Error(`${name} anchor not found. Re-review entry points before building.`);
  if (source.indexOf(text, first + text.length) >= 0) throw Error(`${name} anchor is duplicated. Re-review entry points before building.`);
  return first;
}
function replaceOnce(source, text, to, name) {
  const at = once(source, text, name);
  return source.slice(0, at) + to + source.slice(at + text.length);
}
// The live dashboard wraps each old phone button in `{!SCHEDULER_CALENDAR && ( ... )}`. The
// preview still drops the button, and leaves `null` in the wrapper so the JSX stays valid.
function nullWrappedButton(source, open, name) {
  const wrapper = "{!SCHEDULER_CALENDAR && (\n          ";
  const start = once(source, wrapper + open, name) + wrapper.length;
  const end = source.indexOf("</button>", start);
  const close = "\n          )}";
  if (end < 0 || source.slice(end + "</button>".length, end + "</button>".length + close.length) !== close)
    throw Error(`${name} boundary not found. Re-review entry points before building.`);
  return source.slice(0, start) + "null" + source.slice(end + "</button>".length);
}
export function patchPhoneLayout(source) {
  if (createHash("sha256").update(source).digest("hex") !== "16503b9ca5dac34569f133721f721f7564b6dc305874000e291263eafd853ed2") throw Error("Core layout boundary changed. Re-review preview transform.");
  source = replaceOnce(source, "import {MANUAL_SCHEDULER_ENABLED} from './scheduler-manual-client.mjs';", "const MANUAL_SCHEDULER_ENABLED = false;", "Manual reader flag");
  source = replaceOnce(source, "const OwnPublishedSchedule = React.lazy(() => import('./scheduler-manual.jsx').then(m=>({default:m.OwnPublishedSchedule})));", "const OwnPublishedSchedule = () => null;", "Manual reader import");
  const old = 'function usePhoneLayout() {\n  const q = "(max-width: 700px)";';
  if (!source.includes(old)) throw Error("Phone layout hook not found");
  return source.replace(old, 'function usePhoneLayout() {\n  const q = "(max-width: 700px) and (hover: none) and (pointer: coarse)";');
}
// The pin is a parameter only so a test can pin a deliberately damaged copy and reach the
// anchor checks behind the hash. The build itself only ever uses `patchManager`, pinned to
// the reviewed source.
export function patchManagerPinned(pin) {
  return function patchManager(source) {
  if (typeof pin !== "string" || !/^[0-9a-f]{64}$/.test(pin) || createHash("sha256").update(source).digest("hex") !== pin)
    throw Error(
      "Manager source changed. Re-review entry points before building.",
    );
  // The manual backend remains unreachable from this fictional preview.
  source = replaceOnce(source, "import {MANUAL_SCHEDULER_ENABLED} from './scheduler-manual-client.mjs';", "const MANUAL_SCHEDULER_ENABLED = false;", "Manual manager flag");
  source = replaceOnce(source, "const ManualManagerEntry = React.lazy(() => import('./scheduler-manual.jsx').then(m=>({default:m.ManualManagerEntry})));", "const ManualManagerEntry = () => null;", "Manual manager import");
  // The preview carries its own fictional calendar entry and never loads the live one: the
  // live flag is fixed off and the live entry becomes an empty component, so no live file is
  // imported and no second entry can render beside the preview's.
  source = replaceOnce(source, 'const SCHEDULER_CALENDAR = import.meta.env.VITE_SCHEDULER_CALENDAR === "1";', "const SCHEDULER_CALENDAR = false;", "Live calendar flag");
  source = replaceOnce(source, 'const SchedulerCalendarEntry = React.lazy(() => import("./scheduler-calendar.jsx").then((m) => ({ default: m.SchedulerCalendarEntry })));', "const SchedulerCalendarEntry = () => null;", "Live calendar import");
  const begin = source.indexOf("function SignalSchedule("),
    end = source.indexOf("function SignalPenaltyRank(", begin);
  if (begin < 0 || end < 0) throw Error("Schedule boundary not found");
  const desktop = `function PreviewScheduleEntry({className=""}) {
    const [today,setToday]=useState(previewStoreToday);
    useEffect(()=>{const timer=setInterval(()=>setToday(previewStoreToday()),1000);return()=>clearInterval(timer);},[]);
    const month=today.slice(0,7),cells=previewCalendarCells(month);
    const mobile=className.includes('bp-r1'),[expanded,setExpanded]=useState(()=>previewHeroState.expanded);
    useEffect(()=>{if(mobile&&expanded){const frame=requestAnimationFrame(()=>document.querySelector('.sp-mobile-calendar')?.scrollIntoView({block:'nearest',behavior:'instant'}));return()=>cancelAnimationFrame(frame);}},[mobile,expanded]);
    const historical=previewHistoricalCalendar(previewCalendarStore.history,month),byDay=new Map(historical.days.map(r=>[r.day,r]));
    const title=new Date(month+'-01T12:00:00Z').toLocaleDateString('en-US',{month:'long',year:'numeric',timeZone:'UTC'});
    const historyText='Recent weekday pattern · quieter to busier';
    const openCalendar=(e,day)=>window.dispatchEvent(new CustomEvent('scheduler-open',{detail:{opener:e.currentTarget,day,input:e.nativeEvent?.pointerType||(e.nativeEvent?.sourceCapabilities?.firesTouchEvents?'touch':e.detail===0?'keyboard':'mouse'),store:previewCalendarStore.id}}));
    const calendar=<button type="button" className={(mobile?'':className)+' sp-plan-entry sp-calendar-entry'} aria-label={title+", open Schedule. Historical weekday averages from before this month, darker green is busier. Unknown history is neutral. Open a day for samples."} onClick={e=>openCalendar(e)}>
      {!mobile && <strong className="sp-entry-month">{title}</strong>}
      <span className="sp-mini-grid" aria-hidden="true">{cells.map((day,i)=><i key={day||'blank'+i} className={!day?'blank':('history-'+(byDay.get(day).level??'unknown')+(day===today?' today':''))}>{day?Number(day.slice(-2)):''}</i>)}</span>
      <span className="sp-heat-note">{historyText}</span>
    </button>;
    return mobile?<div className={className+' sp-mobile-calendar'}><button type="button" className="sp-plan-entry sp-calendar-toggle sp-compact-entry" aria-label={title+', calendar'} aria-expanded={expanded} aria-controls="sp-mobile-calendar-panel" onClick={()=>setExpanded(value=>{previewHeroState.expanded=!value;return !value;})}><PixIcon glyph="calendar" size={20}/><strong className="sp-entry-month">{title}</strong></button><div id="sp-mobile-calendar-panel" hidden={!expanded}><div className="sp-mini-grid sp-date-buttons" aria-label={title}>{cells.map((day,i)=>day?<button type="button" key={day} className={'sp-hero-day history-'+(byDay.get(day).level??'unknown')+(day===today?' today':'')} data-hero-day={day} aria-label={new Date(day+'T12:00:00Z').toLocaleDateString('en-US',{weekday:'long',month:'long',day:'numeric',year:'numeric',timeZone:'UTC'})+(byDay.get(day).average===null?', weekday history unavailable':', recent weekday average '+byDay.get(day).average.toFixed(1)+' delivered')+', open day details'} aria-current={day===today?'date':undefined} onClick={e=>openCalendar(e,day)}>{Number(day.slice(-2))}</button>:<span key={'blank'+i} aria-hidden="true"/>)}</div></div></div>:calendar;
  }
  function SignalSchedule({children}) {
    const signal=useSignal();
    return signal?<PreviewScheduleEntry/>:children;
  }
  `;
  source = source.slice(0, begin) + desktop + source.slice(end);
  // Remove only the hero reminder; AppShell and other manual Import routes remain.
  const importBegin = source.indexOf('<button className={"s2-imp s2-lampbtn"');
  const importEnd = source.indexOf("</button>", importBegin);
  if (importBegin < 0 || importEnd < 0) throw Error("Hero import boundary not found");
  source = source.slice(0, importBegin) + source.slice(importEnd + "</button>".length);
  // The spread remains a metric, with its separate sales popover removed in this preview.
  const salesBegin = source.indexOf('<BloopWin cls="dn s2-salewin">');
  const salesEnd = source.indexOf("</BloopWin>", salesBegin);
  if (salesBegin < 0 || salesEnd < 0)
    throw Error("Sold by Day boundary not found");
  source =
    source.slice(0, salesBegin) +
    "null" +
    source.slice(salesEnd + "</BloopWin>".length);
  source = source.replace(
    '<div className="s2-splitwrap bloop-host" tabIndex={0}>',
    '<div className="s2-splitwrap">',
  );
  source = nullWrappedButton(source, '<button type="button" className="bp-r1" onClick={() => setPop({ k: "month" })}>', "Phone calendar");
  source = replaceOnce(source, "\n{MANUAL_SCHEDULER_ENABLED && <React.Suspense fallback={null}><ManualManagerEntry client={supabase} storeId={store.id} store={store} data={data} isOff={isOff}/></React.Suspense>}\n", "\n", "Manual desktop entry");
  // The live compact entry is the last row of the hero; the preview puts its own there instead.
  const heroBottom = '        </div>\n        {MANUAL_SCHEDULER_ENABLED && <React.Suspense fallback={null}><ManualManagerEntry client={supabase} storeId={store.id} store={store} data={data} isOff={isOff}/></React.Suspense>}\n        {SCHEDULER_CALENDAR && (\n          <React.Suspense fallback={null}><SchedulerCalendarEntry store={store} data={data} isOff={isOff} layout="compact" /></React.Suspense>\n        )}\n      </div>\n\n      {canSetGoal && !goalMonth.set';
  source = replaceOnce(source, heroBottom, '        </div>\n        <PreviewScheduleEntry className="bp-r1"/>\n      </div>\n\n      {canSetGoal && !goalMonth.set', "Phone hero bottom");
  source = nullWrappedButton(source, '<button type="button" className="bp-r3" onClick={() => setPop({ k: "onoff" })}>', "Phone staffing");
  source = deliveryRoutes(source);
  return (
    'import {storeToday as previewStoreToday,calendarCells as previewCalendarCells,monthSales as previewMonthSales,createPlanner as previewCreatePlanner} from "/scripts/scheduler-performance/month-model.mjs";\n' +
    'import {historicalCalendar as previewHistoricalCalendar} from "/scripts/scheduler-performance/demand-context.mjs";\n' +
    'import {fixtureAssignments as previewFixtureAssignments,assignmentSummary as previewAssignmentSummary} from "/scripts/scheduler-performance/assignment-view.mjs";\n' +
    'import {fixtures as previewFixtures} from "/scripts/scheduler-proposal/model.mjs"; const previewCalendarStore=previewFixtures()[0],previewHeroPlanner=previewCreatePlanner([previewCalendarStore],{assignmentForDay:previewFixtureAssignments}),previewHeroState={expanded:false,warnings:{}};\n' + source
  );
  };
}
export const patchManager = patchManagerPinned(MANAGER_SHA);
export async function buildPreview() {
  const seed = buildDemo(new Date("2026-10-14T16:00:00Z"));
  // One synthetic daily-sales source drives the hero roll-up and calendar.
  const total = monthSales(fixtures()[0], "2026-10", "2026-10-14").total;
  const stated = seed.storeData.months["2026-10"].stated;
  stated.deliveries = stated.sold = total;
  stated.vehicles = { new: Math.round(total * .46), used: total - Math.round(total * .46), other: 0 };
  seed.storeData.uploadedAt = "2026-10-14T16:00:00.000Z";
  seed.storeConfig.name = "Cedar Motors";
  seed.storeConfig.id = "fictional-0";
  seed.storeData.__storeId = "fictional-0";
  await writeFile(
    "scripts/scheduler-performance/fixture.json",
    JSON.stringify({ store: seed.storeConfig, data: seed.storeData }).replaceAll("Sam Demo","Sam Morgan").replaceAll("sam demo","sam morgan"),
  );
  const outDir = "dist-harness/scheduler-performance";
  await build({
    configFile: false,
    plugins: [
      {
        name: "scheduler-isolated-preview",
        enforce: "pre",
        transform(source, id) {
          if (id.endsWith("/src/main.jsx"))
            return 'import "/scripts/scheduler-performance/entry.jsx";';
          if (id.split('?')[0].endsWith('/src/manager-signal.css')) {if(createHash('sha256').update(source).digest('hex')!=='93fd31a911167c1313e63ae3c630f5d2173549935a730b5eeda307befe5d105d')throw Error('Manager CSS boundary changed. Re-review shared preview.');return relativeTypography(source.replace('.manager-signal .page button:active { transform:translateY(1px); }','').replaceAll('transform:translateY(1px)','transform:none').replaceAll('transform:translateY(-1px)','transform:none'));}
          if (id.endsWith("/src/Manager.jsx")) return sharedManager(patchManager(source));
          if (id.endsWith("/src/LeadPerformanceCalculator.jsx")) return sharedCore(patchPhoneLayout(source));
        },
      },
      react(),
    ],
    define: {
      __APP_VERSION__: JSON.stringify("fictional-preview"),
      "import.meta.env.VITE_SUPABASE_URL": '""',
      "import.meta.env.VITE_SUPABASE_ANON_KEY": '""',
    },
    build: { outDir, emptyOutDir: true },
    publicDir: "public",
  });
  const planner = outDir + "/planner";
  await mkdir(planner, { recursive: true });
  for (const name of ["model.mjs"])
    await cp("scripts/scheduler-proposal/" + name, planner + "/" + name);
  const editor = (await readFile("scripts/scheduler-performance/store-editor.mjs", "utf8"))
    .replace("../scheduler-proposal/model.mjs", "./model.mjs");
  await writeFile(planner + "/store-editor.mjs", editor);
  for (const name of ["calendar-key.mjs", "calendar-tokens.css", "off-day-ui.mjs", "off-day-command.mjs", "haptics.mjs", "day-edit-state.mjs", "day-motion.mjs", "mobile-roster.mjs", "generation-ui.mjs", "generation-worker.mjs", "name-key.mjs", "shift-intervals.mjs", "schedule-import.mjs", "import-compatibility.mjs", "import-ui.mjs", "team-model.mjs", "team-balance.mjs", "team-ui.mjs"]) await cp("scripts/scheduler-performance/" + name, planner + "/" + name);
  await writeFile(planner+"/generation.mjs",(await readFile("scripts/scheduler-performance/generation.mjs","utf8")).replace("../scheduler-proposal/model.mjs","./model.mjs"));
  await writeFile(planner+"/weekly-hours.mjs",(await readFile("scripts/scheduler-performance/weekly-hours.mjs","utf8")).replace("../scheduler-proposal/model.mjs","./model.mjs"));
  await cp("scripts/scheduler-performance/month-app.mjs", planner + "/app.mjs");
  await writeFile(planner + "/month-app-core.mjs", (await readFile("scripts/scheduler-performance/month-app-core.mjs", "utf8")).replace("../scheduler-proposal/model.mjs", "./model.mjs"));
  await cp("scripts/scheduler-performance/sage-icons.mjs", planner + "/sage-icons.mjs");
  await cp("scripts/scheduler-performance/assignment-view.mjs", planner + "/assignment-view.mjs");
  await writeFile(planner + "/demand-context.mjs", (await readFile("scripts/scheduler-performance/demand-context.mjs", "utf8")).replace("../scheduler-proposal/model.mjs", "./model.mjs"));
  let monthlyModel = await readFile(
    "scripts/scheduler-performance/month-model.mjs",
    "utf8",
  );
  monthlyModel = monthlyModel.replace(
    "../scheduler-proposal/model.mjs",
    "./model.mjs",
  );
  await writeFile(planner + "/month-model.mjs", monthlyModel);
  await cp("scripts/scheduler-performance/planner.css", planner + "/style.css");
  await cp("scripts/scheduler-performance/shared-system.css", planner + "/shared-system.css");
  await writeFile(
    planner + "/index.html",
    '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src \'self\'; connect-src \'none\'; style-src \'self\' \'unsafe-inline\'; object-src \'none\'; base-uri \'none\'"><title>Plan the month · Sage</title><link rel="stylesheet" href="style.css"><link rel="stylesheet" href="shared-system.css"></head><body><main id="app"></main><script type="module" src="app.mjs"></script></body></html>',
  );
  let html = await readFile(outDir + "/index.html", "utf8");
  html = html
    .replace(/, maximum-scale=1.0, user-scalable=no/, "")
    .replace(/<script>([\s\S]*?)<\/script>/g, "");
  html = finalizeHtml(html, MAIN_POLICY);
  const plannerHtml = await readFile(planner + "/index.html", "utf8");
  await writeFile(planner + "/index.html", finalizeHtml(plannerHtml, PLANNER_POLICY));
  await writeFile(outDir + "/index.html", html);
  console.log(
    "Isolated Performance preview built; no production source edited.",
  );
}
if (process.argv[1]?.endsWith("/build.mjs")) await buildPreview();
