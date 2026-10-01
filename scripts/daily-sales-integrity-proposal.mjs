/* Isolated approval build. The exact Manager changes are made in memory, so
   this branch cannot change production pixels before the proposal is approved. */
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildDemo } from "./demo-seed.mjs";

const replaceOne = (source, before, after) => {
  if (source.split(before).length !== 2) throw new Error("Daily protection anchor changed: " + before.slice(0, 70));
  return source.replace(before, after);
};
const replaceRange = (source, start, end, after) => {
  const a = source.indexOf(start), b = source.indexOf(end, a + start.length);
  if (a < 0 || b < 0 || source.indexOf(start, a + 1) >= 0) throw new Error("Daily protection range changed: " + start);
  return source.slice(0, a) + after + source.slice(b);
};

export function dailyIntegrityTransform(source) {
  let next = replaceOne(source, 'import { renderLeaderboard } from "./board-loader.mjs";',
    'import { renderLeaderboard } from "./board-loader.mjs";\nimport { DAILY_TOTALS_UNAVAILABLE, DIGEST_RETRY_MS, createDigestReader, createDigestSelection, digestIdentity, digestState } from "../api/_digest-integrity.mjs";');
  next = replaceRange(next, '/* ---- the daily digest,', '\nasync function loadPlatesOnly', `/* ---- the daily digest, held as unverified audit evidence ----
   Visit-time month snapshots cannot establish a business day's sales. Keep
   them in storage, but only a verified report source may supply daily values. */
const digestReader = createDigestReader(async (storeId) => {
  if (!supabase) throw new Error("Digest source unavailable");
  const prefix = \`lpc:store:\${storeId}:digest:\`;
  const { data, error } = await supabase.from("app_data")
    .select("key,value").like("key", prefix + "%");
  if (error) throw error;
  return data;
});

function useDigestIntegrity(storeId, dataStoreId) {
  const day = today();
  const [state, setState] = useState(() => digestState(storeId, day, "loading", "reading_legacy_rows"));
  const selection = useMemo(() => createDigestSelection(digestReader, setState), []);
  useEffect(() => {
    let live = true, retry = null, retryUsed = false;
    const read = async (force = false) => {
      const result = await selection.select(storeId, dataStoreId, today(), { force });
      if (!live) return;
      if (result.status === "error" && !retryUsed) {
        retryUsed = true;
        retry = setTimeout(() => read(true), DIGEST_RETRY_MS);
      }
    };
    const focus = () => { retryUsed = false; clearTimeout(retry); read(true); };
    read();
    window.addEventListener("focus", focus);
    return () => { live = false; clearTimeout(retry); selection.cancel(); window.removeEventListener("focus", focus); };
  }, [storeId, dataStoreId, day, selection]);
  /* Effects run after paint. The render itself must reject old-store state. */
  return digestIdentity(storeId, dataStoreId, day)
    || (state.storeId === storeId && state.day === day ? state
      : digestState(storeId, day, "loading", "reading_legacy_rows"));
}
`);
  next = replaceOne(next, '  const [digests, setDigests] = useState(null);',
    '  const digestIntegrity = useDigestIntegrity(store.id, data.__storeId);\n  const digests = digestIntegrity.history;');
  next = replaceRange(next, '  // Read what\'s on file, then write today\'s row', '\n  useEffect(() => {\n    if (!full) return;',
    '  // A browser visit cannot certify a report day. There is deliberately no\n  // digest writer here, including when an import or store selection changes.\n');
  next = replaceOne(next, 'const ruWritten = new Set();\n\n// one write per store per day per session',
    '// Existing digest rows remain available for audit, but are no longer written by the browser.');
  next = replaceRange(next, '// Counts only. Nothing here is not already on a wall',
    '/* The digest closest to', '');
  const sharedReader = '  const digests = useDigests(store.id);';
  if (next.split(sharedReader).length !== 3) throw new Error("Both boards must use the same integrity reader");
  next = next.replaceAll(sharedReader,
    '  const digestIntegrity = useDigestIntegrity(store.id, data.__storeId);\n  const digests = digestIntegrity.history;');
  next = replaceRange(next, '  else if (!was)\n    aware.push({', '\n\n  return { improved, worsened, work, aware',
    '  else if (!was)\n    aware.push({ t: DAILY_TOTALS_UNAVAILABLE, d: "" });');
  next = replaceOne(next,
    '                      Through {new Date(Date.now() - 86400000).toLocaleDateString([], { weekday: "long", month: "long", day: "numeric" })}',
    '                      {new Date().toLocaleDateString([], { weekday: "long", month: "long", day: "numeric" })}');
  next = replaceOne(next, '              {/* ---- yesterday\'s business: plain numbers ---- */}',
    '              <div className="ru2-pace" data-daily-unavailable="recap">{DAILY_TOTALS_UNAVAILABLE}</div>\n\n              {/* ---- yesterday\'s business: plain numbers ---- */}');
  next = replaceOne(next, '        <div className="bp-swg">',
    '        <p className="fr-empty" data-daily-unavailable="phone-calendar">{DAILY_TOTALS_UNAVAILABLE}</p>\n        <div className="bp-swg">');
  next = replaceOne(next, '        <div className="bp-cw">',
    '        <div className="bp-cw">\n          <div data-daily-unavailable="phone-best-day">{DAILY_TOTALS_UNAVAILABLE}</div>');
  next = replaceOne(next, '                {Object.keys(dayUnits).length > 0 && (\n                  <BloopWin cls="dn s2-salewin">',
    '                {(\n                  <BloopWin cls="dn s2-salewin">');
  next = replaceOne(next, '                      : "Click a day to see it"}</div>',
    '                      : DAILY_TOTALS_UNAVAILABLE}</div>');
  next = replaceOne(next, '                {mcal.best && (\n                  <div className="s2-cw">',
    '                <div className="s2-cw" data-daily-unavailable="desktop-best-day">{DAILY_TOTALS_UNAVAILABLE}</div>\n                {mcal.best && (\n                  <div className="s2-cw">');
  next = replaceOne(next, ' · no day record</>)', ' · {DAILY_TOTALS_UNAVAILABLE}</>)');
  next = replaceOne(next, ': "Click a day dot to see it"}</div>', ': DAILY_TOTALS_UNAVAILABLE}</div>');
  next = replaceOne(next, '`${fmtPct(c.pct)} so far. The line draws once two days are on file.`',
    '`${fmtPct(c.pct)} this month. Daily history unavailable.`');
  next = replaceOne(next, "The month's line starts once three days have figures.",
    'Monthly history starts once three months have figures.');
  next = replaceOne(next, 'Month over month until two daily readings are on file · click a month to see it',
    'Month over month · click a month to see it');
  next = replaceOne(next, 'month documents, dashed, until two daily readings are on file.',
    'month documents. Unverified daily readings are not used.');
  return next;
}

export const decisions = [
  ["Calendar and day detail", "Keep the calendar, monthly total and stock mix. Show Daily totals unavailable in the daily detail, with no invented zero or best-day claim."],
  ["Morning recap", "Keep the month and recorded activity. Replace the unsupported yesterday sales cards with Daily totals unavailable. Remove the unverified snapshot line and comparisons."],
  ["Historical comparisons", "Keep report-backed monthly history. Hold day-based closing and standing comparisons until a verified daily source is available."],
  ["Stop browser snapshots", "Opening or switching stores no longer writes a sales snapshot. Existing rows remain stored for audit. A report-backed daily pipeline is separate work."],
];

export function proposalPage() {
  return `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Sage daily-sales protection</title>
<style>*{box-sizing:border-box}body{margin:0;padding:24px;background:#edf0e9;color:#183725;font:16px system-ui}main{max-width:1000px;margin:auto}h1{font-size:28px}section{padding:20px;margin:16px 0;background:white;border-radius:14px}label{display:block;margin:12px 0}select,button{font:inherit;padding:10px;border:1px solid #b5c8bb;border-radius:8px}p{line-height:1.5}iframe{width:100%;height:850px;border:0;background:white;border-radius:14px}pre{white-space:pre-wrap}.note{color:#536057}</style>
<main><h1>Daily-sales protection</h1><p>Approval study with fictional figures. The existing Daily Activity screens and monthly totals stay as they are.</p>
<p class="note">This holds unverified daily claims. It does not erase business data. Detailed findings stay in our private conversation.</p>
${decisions.map(([title, body], i) => `<section><h2>${i + 1}. ${title}</h2><p>${body}</p><label>Decision <select data-choice="${i + 1}" aria-label="Decision for ${title}"><option>Not decided</option><option>Approve</option><option>Adjust</option><option>No</option></select></label></section>`).join("")}
<button id="copy">Show my decisions</button><pre id="choices" aria-live="polite"></pre>
<section><h2>Review the real screens</h2><p>The isolated browser check mounts Sage's actual Manager components with fictional stores and a fixed September 22 clock. Review the before and after screenshots with the four choices above. No sign-in or live account is used.</p></section></main>
<script>document.querySelector('#copy').onclick=()=>document.querySelector('#choices').textContent=[...document.querySelectorAll('[data-choice]')].map(x=>x.dataset.choice+': '+x.value).join('\\n');</script></html>`;
}

export function fixtureEntry() {
  const demo = buildDemo(new Date("2026-09-22T16:00:00Z"));
  return `import React, {useState} from "react";
import {createRoot} from "react-dom/client";
import {BoardRoomPhone, StoreHero, Board, CheckOutTracker} from "./Manager.jsx";
import {Style, DEFAULT_TIERS, usePhoneLayout} from "./LeadPerformanceCalculator.jsx";
const seed = ${JSON.stringify({ data: demo.storeData, store: demo.storeConfig })};
const stores = [0,1].map(i=>({...seed.store,id:i?'store-b':'store-a',name:i?'Fictional Store B':'Fictional Store A'}));
const data = stores.map((store,i)=>{const d=structuredClone(seed.data);d.__storeId=store.id;
  d.months['2026-09'].stated={deliveries:i?83:61,vehicles:{new:i?41:37,used:i?42:24},at:'2026-09-22T16:00:00Z'};return d});
const config={stores,roles:[{id:'sales',name:'Sales Associate',onBoard:true,coaching:true},{id:'service',name:'Service to Sales',onBoard:true},{id:'manager',name:'Manager',onBoard:false},{id:'bdc',name:'BDC',onBoard:false}],
  standards:Object.fromEntries(stores.map(s=>[s.id,{sales:{tiers:DEFAULT_TIERS},service:{tiers:DEFAULT_TIERS}}])),holidays:[]};
const noop=()=>{};
function Fixture(){const [selected,setSelected]=useState(0),[loaded,setLoaded]=useState(0),[activity,setActivity]=useState(false),[role,setRole]=useState('manager');const phone=usePhoneLayout();
  const props={config,store:stores[selected],data:data[loaded],session:{role,name:'Fictional Tester'},canSetGoal:false,onSaveConfig:noop,onSetRestriction:noop,onCoach:noop,onGoTab:noop,onFilter:noop,onMove:noop,onChange:noop,readOnly:true};
  return <><Style/><header style={{padding:12,background:'#fff',display:'flex',gap:12,flexWrap:'wrap'}}><b>Fictional approval study</b>
    <button id="store-a" onClick={()=>{setSelected(0);setLoaded(0)}}>Store A</button><button id="store-b" onClick={()=>{setSelected(1);setLoaded(1)}}>Store B</button>
    <button id="mismatch" onClick={()=>{setSelected(1);setLoaded(0)}}>B waiting on data</button><button id="resolve" onClick={()=>setLoaded(selected)}>Resolve data</button>
    <button id="activity" onClick={()=>setActivity(x=>!x)}>{activity?'Performance':'Daily Activity'}</button>
    <select aria-label="Fictional viewer role" value={role} onChange={e=>setRole(e.target.value)}><option>manager</option><option>admin</option></select>
  </header><main className="page" style={{padding:20}} data-fixture-store={stores[selected].id}>
    {activity?<CheckOutTracker {...props}/>:phone?<BoardRoomPhone {...props}/>:<><StoreHero {...props}/><Board {...props}/></>}
  </main></>;
}
createRoot(document.getElementById('root')).render(<Fixture/>);`;
}

export async function buildDailyIntegrityProposal({ before = false } = {}) {
  process.env.VITE_SUPABASE_URL = "http://127.0.0.1:5433";
  process.env.VITE_SUPABASE_ANON_KEY = "mock-anon-key";
  const { build } = await import("vite");
  const outDir = "dist-harness/daily-integrity" + (before ? "-before" : "");
  await build({ build: { outDir }, plugins: [{
    name: "daily-integrity-proposal", enforce: "pre",
    transform(source, id) {
      const file = id.replace(/\\/g, "/");
      if (!before && file.endsWith("/src/Manager.jsx")) return dailyIntegrityTransform(source);
      if (file.endsWith("/src/main.jsx")) return fixtureEntry();
    },
  }] });
  await fs.writeFile(outDir + "/proposal.html", proposalPage());
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await buildDailyIntegrityProposal({ before: true });
  await buildDailyIntegrityProposal();
}
