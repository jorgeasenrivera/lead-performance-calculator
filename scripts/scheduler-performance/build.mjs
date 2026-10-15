import { readFile, writeFile, mkdir, cp } from "node:fs/promises";
import { createHash } from "node:crypto";
import { build } from "vite";
import react from "@vitejs/plugin-react";
import { finalizeHtml, MAIN_POLICY, PLANNER_POLICY } from "./html-finalize.mjs";
import { fixtures } from "../scheduler-proposal/model.mjs";
import { monthSales } from "./month-model.mjs";
import { buildDemo } from "../demo-seed.mjs";
export const MANAGER_SHA =
  "c18d9641aa4807a58deb969808071f73240d80b80da4b261dc857b56c454d501";
export function patchManager(source) {
  if (createHash("sha256").update(source).digest("hex") !== MANAGER_SHA)
    throw Error(
      "Manager source changed. Re-review entry points before building.",
    );
  const begin = source.indexOf("function SignalSchedule("),
    end = source.indexOf("function SignalPenaltyRank(", begin);
  if (begin < 0 || end < 0) throw Error("Schedule boundary not found");
  const desktop = `function PreviewScheduleEntry({className=""}) {
    const today=previewStoreToday(),month=today.slice(0,7),cells=previewCalendarCells(month);
    const mobile=className.includes('bp-r1'),[expanded,setExpanded]=useState(false);
    const initial=previewHeroPlanner.rows(0,month).map(r=>previewAssignmentSummary(previewCalendarStore.people,[],previewFixtureAssignments(r.day),r));
    const [warnings,setWarnings]=useState({month,needs:initial.filter(r=>r.status==='Needs schedule').length,low:initial.filter(r=>r.status==='Low staff').length});
    useEffect(()=>{const update=e=>{if(e.detail.store==='fictional-0' && e.detail.month===month)setWarnings(e.detail);};window.addEventListener('scheduler-summary',update);return()=>window.removeEventListener('scheduler-summary',update);},[month]);
    const heat=previewSalesHeat(previewCalendarStore,month,today),byDay=new Map(heat.map(r=>[r.day,r]));
    const title=new Date(month+'-01T12:00:00Z').toLocaleDateString('en-US',{month:'long',year:'numeric',timeZone:'UTC'});
    const total=previewMonthSales(previewCalendarStore,month,today).total;
    const compact='Today '+Number(today.slice(-2))+' · Units Delivered: '+(total??'Unknown');
    const bestText=heat.some(r=>r.best)?'Best'+(heat.filter(r=>r.best).length>1?' (tied)':'')+': '+heat.filter(r=>r.best).map(r=>Number(r.day.slice(-2))).join(', '):'No recorded best day';
    const calendar=<button type="button" className={(mobile?'':className)+' sp-plan-entry sp-calendar-entry'} aria-label={mobile?undefined:title+", open Schedule for staffing and daily sales. Recorded sales only; lighter days have more sales. Best recorded dates: "+(heat.filter(r=>r.best).map(r=>Number(r.day.slice(-2))).join(", ")||"none") } onClick={e=>window.dispatchEvent(new CustomEvent('scheduler-open',{detail:{opener:e.currentTarget}}))}>
      <strong className="sp-entry-month">{title}</strong>
      {mobile && <span className="sp-mobile-summary">{compact}</span>}
      {mobile && <span className="sp-mobile-warnings">{warnings.needs>0 && <span className="sp-needs"><PixIcon glyph="warn" size={14}/>Needs schedule: {warnings.needs}</span>}{warnings.low>0 && <span className="sp-low"><PixIcon glyph="warn" size={14}/>Low staff: {warnings.low}</span>}</span>}
      <span id={mobile?'sp-hero-days':undefined} className="sp-mini-grid" aria-hidden="true" hidden={mobile&&!expanded}>{cells.map((day,i)=><i key={day||'blank'+i} className={!day?'blank':('sales-'+byDay.get(day).state+' '+(byDay.get(day).level===null?'':'heat-'+byDay.get(day).level)+(day===today?' today':'')+(byDay.get(day).best?' best':''))} title={day?(byDay.get(day).state==='known'?byDay.get(day).units+' recorded sales'+(byDay.get(day).best?' · '+byDay.get(day).bestLabel:''):'Sales: '+byDay.get(day).state):undefined}>{day?Number(day.slice(-2)):''}</i>)}</span>
      <span className="sp-heat-note" hidden={mobile&&!expanded}>{bestText}</span>
      {mobile && <span className="sp-sr-only">Open Schedule for staffing and daily sales.</span>}
    </button>;
    return mobile?<div className={className+' sp-mobile-calendar'}>{calendar}<button type="button" className="sp-calendar-toggle" aria-expanded={expanded} aria-controls="sp-hero-days" onClick={()=>setExpanded(value=>!value)}>{expanded?'Hide calendar':'Show calendar'}</button></div>:calendar;
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
  const phoneBegin = source.indexOf(
    '<button type="button" className="bp-r1" onClick={() => setPop({ k: "month" })}>',
  );
  const phoneEnd = source.indexOf("</button>", phoneBegin);
  if (phoneBegin < 0 || phoneEnd < 0)
    throw Error("Phone calendar boundary not found");
  source =
    source.slice(0, phoneBegin) +
    '<PreviewScheduleEntry className="bp-r1"/>' +
    source.slice(phoneEnd + "</button>".length);
  const onoffBegin = source.indexOf(
    '<button type="button" className="bp-r3" onClick={() => setPop({ k: "onoff" })}>',
  );
  const onoffEnd = source.indexOf("</button>", onoffBegin);
  if (onoffBegin < 0 || onoffEnd < 0)
    throw Error("Phone staffing boundary not found");
  source =
    source.slice(0, onoffBegin) + source.slice(onoffEnd + "</button>".length);
  return (
    'import {storeToday as previewStoreToday,calendarCells as previewCalendarCells,salesHeat as previewSalesHeat,monthSales as previewMonthSales,createPlanner as previewCreatePlanner} from "/scripts/scheduler-performance/month-model.mjs";\n' +
    'import {fixtureAssignments as previewFixtureAssignments,assignmentSummary as previewAssignmentSummary} from "/scripts/scheduler-performance/assignment-view.mjs";\n' +
    'import {fixtures as previewFixtures} from "/scripts/scheduler-proposal/model.mjs"; const previewCalendarStore=previewFixtures()[0],previewHeroPlanner=previewCreatePlanner([previewCalendarStore]);\n' + source
  );
}
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
    JSON.stringify({ store: seed.storeConfig, data: seed.storeData }),
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
          if (id.endsWith("/src/Manager.jsx")) return patchManager(source);
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
  await cp("scripts/scheduler-performance/month-app.mjs", planner + "/app.mjs");
  await cp("scripts/scheduler-performance/sage-icons.mjs", planner + "/sage-icons.mjs");
  await cp("scripts/scheduler-performance/assignment-view.mjs", planner + "/assignment-view.mjs");
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
  await writeFile(
    planner + "/index.html",
    '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src \'self\'; connect-src \'none\'; style-src \'self\' \'unsafe-inline\'; object-src \'none\'; base-uri \'none\'"><title>Plan the month · Sage</title><link rel="stylesheet" href="style.css"></head><body><main id="app"></main><script type="module" src="app.mjs"></script></body></html>',
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
