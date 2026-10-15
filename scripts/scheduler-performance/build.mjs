import { readFile, writeFile, mkdir, cp } from "node:fs/promises";
import { createHash } from "node:crypto";
import { build } from "vite";
import react from "@vitejs/plugin-react";
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
    const title=new Date(month+'-01T12:00:00Z').toLocaleDateString('en-US',{month:'long',year:'numeric',timeZone:'UTC'});
    return <button type="button" className={className+' sp-plan-entry sp-calendar-entry'} aria-label={"Open Schedule for "+title+", staffing and daily sales"} onClick={e=>window.dispatchEvent(new CustomEvent('scheduler-open',{detail:{opener:e.currentTarget}}))}>
      <strong className="sp-entry-month">{title}</strong>
      <span className="sp-mini-grid" aria-hidden="true">{cells.map((day,i)=><i key={day||'blank'+i} className={!day?'blank':day===today?'today':''}>{day?Number(day.slice(-2)):''}</i>)}</span>
    </button>;
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
    'import {storeToday as previewStoreToday,calendarCells as previewCalendarCells} from "/scripts/scheduler-performance/month-model.mjs";\n' +
    source
  );
}
export async function buildPreview() {
  const seed = buildDemo(new Date("2026-10-14T16:00:00Z"));
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
  for (const name of ["model.mjs", "store-editor.mjs"])
    await cp("scripts/scheduler-proposal/" + name, planner + "/" + name);
  await cp("scripts/scheduler-performance/month-app.mjs", planner + "/app.mjs");
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
  html = html.replace(
    "<head>",
    "<head><meta http-equiv=\"Content-Security-Policy\" content=\"default-src 'self'; connect-src 'none'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; object-src 'none'; base-uri 'none'\">",
  );
  await writeFile(outDir + "/index.html", html);
  console.log(
    "Isolated Performance preview built; no production source edited.",
  );
}
if (process.argv[1]?.endsWith("/build.mjs")) await buildPreview();
