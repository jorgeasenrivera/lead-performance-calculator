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
  const desktop =
    "{React.cloneElement(calendar[1], {onClickCapture:()=>setPinned(true)})}{calendar[2]}";
  const phone =
    '<button type="button" className="bp-r3" onClick={() => setPop({ k: "onoff" })}>';
  for (const needle of [desktop, phone])
    if (source.split(needle).length !== 2)
      throw Error("Entry patch is not unique");
  source = source.replace(
    desktop,
    desktop +
      `<button type="button" className="sp-plan-entry" onClick={e=>{e.stopPropagation();window.dispatchEvent(new CustomEvent('scheduler-open',{detail:{opener:e.currentTarget}}));}}><span>Plan next week</span><small>Set hours and review coverage</small></button>`,
  );
  source = source.replace(
    phone,
    `<div className="bp-r3 sp-phone-schedule"><button type="button" className="sp-today" onClick={() => setPop({ k: "onoff" })}>`,
  );
  const end =
    '<span className="bp-onoff">{onToday.length} on{offToday.length ? <> · <em>{offToday.length} off</em></> : null}</span>\n          </button>';
  if (source.split(end).length !== 2)
    throw Error("Phone schedule closing patch is not unique");
  return source.replace(
    end,
    end +
      `<button type="button" className="sp-plan-entry" onClick={e=>window.dispatchEvent(new CustomEvent('scheduler-open',{detail:{opener:e.currentTarget}}))}>Plan next week</button></div>`,
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
  let app = await readFile("scripts/scheduler-proposal/app.mjs", "utf8");
  app = app
    .replace("SAGE / SCHEDULE / ISOLATED PROPOSAL", "SCHEDULE / WEEKLY PLAN")
    .replace(
      "Use the existing Schedule area (represented here only)",
      "Open from the Performance hero’s Schedule area",
    )
    .replace("Build next week together.", "Plan the week")
    .replace(
      "Plan coverage first. Use delivered-car ranges as context, then review each person’s hours.",
      "Set availability, check coverage, then make the call.",
    );
  app = app
    .replace(
      '<section class="panel review">',
      '<details class="panel review"><summary>Proposed choices for review</summary>',
    )
    .replace(
      '</section>\n <p class="footer">',
      '</details>\n <p class="footer">',
    );
  // Keep provenance available without pushing the week's first day off the phone.
  const history = app.match(/<p class="history">[^<]*<\/p>/)?.[0];
  if (!history)
    throw Error("Scheduler history note changed. Review the layout transform.");
  app = app
    .replace(history, "")
    .replace(
      "<summary>Proposed choices for review</summary>",
      "<summary>Proposed choices for review</summary>" + history,
    );
  app = app.replace(
    "<strong>Fictional data only. Proposed defaults for review.</strong><br>No schedule is published. Changes last only in this page. The manager makes the final decision.",
    "<strong>Fictional draft. Proposed defaults for review.</strong><br>The manager decides. Edits stay in this page; nothing is published.",
  );
  app += `\nwindow.addEventListener('keydown',e=>{if(e.key==='Escape'&&!e.defaultPrevented){e.preventDefault();window.parent.dispatchEvent(new Event('scheduler-close'));}});`;
  await writeFile(planner + "/app.mjs", app);
  await cp("scripts/scheduler-performance/planner.css", planner + "/style.css");
  await writeFile(
    planner + "/index.html",
    '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src \'self\'; connect-src \'none\'; style-src \'self\' \'unsafe-inline\'; object-src \'none\'; base-uri \'none\'"><title>Plan the week · Sage</title><link rel="stylesheet" href="style.css"></head><body><main id="app"></main><script type="module" src="app.mjs"></script></body></html>',
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
