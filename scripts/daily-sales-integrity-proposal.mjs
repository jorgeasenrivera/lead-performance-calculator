/* Approved daily-sales protection: test the shipped Manager source directly.
   Only the before fixture uses an immutable historical Manager blob. */
import fs from "node:fs/promises";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildDemo } from "./demo-seed.mjs";

export const BEFORE_COMMIT = "8d2befb7db44fb8ab8dcd855a5d09ccd62005906";
export const BEFORE_MANAGER_BLOB = "e306078d145c3cb7816a14543147367580e76b89";
export function verifyBeforeManager(source) {
  const sha = createHash("sha1").update(`blob ${Buffer.byteLength(source)}\0`).update(source).digest("hex");
  if (sha !== BEFORE_MANAGER_BLOB) throw new Error("Before Manager does not match the immutable reviewed blob");
  return source;
}
export function readBeforeManager() {
  // A pinned second checkout avoids changing Git trust settings in CI's
  // container. The hash must match whether read from that checkout or Git.
  const source = process.env.DAILY_BEFORE_SOURCE
    ? readFileSync(process.env.DAILY_BEFORE_SOURCE, "utf8")
    : execFileSync("git", ["show", BEFORE_COMMIT + ":src/Manager.jsx"],
      { encoding: "utf8", maxBuffer: 5 * 1024 * 1024 });
  return verifyBeforeManager(source);
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
  const beforeManager = before ? readBeforeManager() : null;
  await build({ build: { outDir }, plugins: [{
    name: "daily-integrity-proposal", enforce: "pre",
    transform(source, id) {
      const file = id.replace(/\\/g, "/");
      if (before && file.endsWith("/src/Manager.jsx")) return beforeManager;
      // The after bundle consumes the production Manager exactly as checked in.
      if (file.endsWith("/src/main.jsx")) return fixtureEntry();
    },
  }] });
  await fs.writeFile(outDir + "/proposal.html", proposalPage());
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await buildDailyIntegrityProposal({ before: true });
  await buildDailyIntegrityProposal();
}
