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
  const desktop = `function SignalSchedule({children}) {
    const signal=useSignal();
    const [open,setOpen]=React.useState(false);
    const parts=React.Children.toArray(children).filter(React.isValidElement);
    if(!signal)return children;
    const calendar=React.Children.toArray(parts[1].props.children);
    return <div className="sg-schedule">
      <div className="sp-month-context" onBlur={e=>{if(!e.currentTarget.contains(e.relatedTarget))setOpen(false);}} onKeyDown={e=>{if(e.key==='Escape')setOpen(false);}}>
        <button className="sp-month-trigger" aria-label="Month at a glance" aria-expanded={open} onClick={()=>setOpen(v=>!v)}>{calendar[0]}</button>
        {React.cloneElement(calendar[1],{onClickCapture:()=>setOpen(true)})}{calendar[2]}
        {open&&<div className="sg-schedule-details"><div className="sg-schedule-month">{calendar[3].props.children}</div></div>}
      </div>
      <button type="button" className="sg-schedule-trigger sp-plan-entry" aria-label="Open Schedule" onClick={e=>{setOpen(false);window.dispatchEvent(new CustomEvent('scheduler-open',{detail:{opener:e.currentTarget}}));}}><span>Schedule</span><small>View today · Plan months</small></button>
    </div>;
  }
  `;
  source = source.slice(0, begin) + desktop + source.slice(end);
  const phone =
    '<button type="button" className="bp-r3" onClick={() => setPop({ k: "onoff" })}>\n            <span className="bp-onoff">{onToday.length} on{offToday.length ? <> · <em>{offToday.length} off</em></> : null}</span>\n          </button>';
  if (source.split(phone).length !== 2)
    throw Error("Phone Schedule boundary not unique");
  return source.replace(
    phone,
    `<button type="button" className="bp-r3 sp-plan-entry" aria-label="Open Schedule" onClick={e=>window.dispatchEvent(new CustomEvent('scheduler-open',{detail:{opener:e.currentTarget}}))}><span>Schedule</span><small>View today · Plan months</small></button>`,
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
