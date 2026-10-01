import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { resolveDailyBusinessDate, filenameBusinessDays, resolvePrintedStore,
  buildDailyDeliveryEvidence, deliveryLedger } from "../api/_daily-deliveries.mjs";
import { runDeliveryDryRun } from "../scripts/delivery-reconstruction-dry-run.mjs";
const stores=[{id:"fictional-a",name:"Fictional Store Alpha"},{id:"fictional-b",name:"Fictional Store Beta"}];
const line = (str) => ({ pg:1, parts:[{str}] });
const heading = (name) => [line(name+" Net Leads Showroom Phone Ups ILM leads Campaign App Created App Scheduled"),
  line("App Confirmed App Show Calls Made Connects Texts Emails Videos Video % Visit"),
  line("Open Tasks Completed Tasks Total Delivered Total Closing %")];
const row=(tag,total)=>line(`${tag} 14 1 3 6 4 5 4 ? 0 71 11 164 33 8 29% 730 79 ${total} 0% 4`);
const lines=(total=7,name=stores[0].name)=>[line("Daily Activity"),...heading(name),row("New",total),row("Used",0),row("All",total),
  ...["Riley Example","Alex Sample","Jamie Fiction"].flatMap(n=>[...heading(n),row("All",3)])];
const metadata={reportType:"activity",filename:"scheduled-report-9-30-2026.pdf",sentAt:"2026-10-01T00:01:00Z",receivedAt:"2026-10-01T00:02:00Z"};
const candidate=(total=7,meta={})=>buildDailyDeliveryEvidence({lines:lines(total),bytes:Buffer.from("%PDF-fictional "+total),
  metadata:{...metadata,...meta},stores,storeId:"fictional-a"});

test("day sent, not UTC receipt day, is the Daily Activity business date",()=>{
  const d=resolveDailyBusinessDate(metadata); assert.equal(d.status,"supported");assert.equal(d.businessDate,"2026-09-30");
  const cross=resolveDailyBusinessDate({...metadata,sentAt:"2026-10-01T03:59:00Z",receivedAt:"2026-10-01T04:02:00Z"});
  assert.equal(cross.businessDate,"2026-09-30");assert.equal(cross.receivedOnDifferentDay,true);
  for (const sentAt of ["2026-03-08T06:59:00Z","2026-11-01T06:01:00Z"]) {
    const receivedAt=new Date(Date.parse(sentAt)+120000).toISOString();
    assert.equal(resolveDailyBusinessDate({sentAt,receivedAt,filename:"report.pdf"}).businessDate,sentAt.slice(0,10));
  }
});
test("contradictory or missing dates do not silently become the receipt date",()=>{
  assert.equal(resolveDailyBusinessDate({...metadata,filename:"report-10-1-2026.pdf"}).status,"conflict");
  assert.equal(resolveDailyBusinessDate({...metadata,printedDay:"2026-09-29"}).status,"conflict");
  assert.equal(resolveDailyBusinessDate({...metadata,sentAt:null}).status,"supported");
  assert.equal(resolveDailyBusinessDate({...metadata,sentAt:null,receivedAt:"2026-10-01T04:02:00Z"}).status,"incomplete");
  assert.equal(resolveDailyBusinessDate({...metadata,sentAt:null,filename:"report.pdf"}).status,"missing");
  assert.equal(resolveDailyBusinessDate({...metadata,filename:"report-2026-02-30.pdf"}).status,"rejected");
  assert.deepEqual(filenameBusinessDays("report-2026-09-29-to-2026-09-30.pdf"),["2026-09-29","2026-09-30"]);
  assert.equal(resolveDailyBusinessDate({...metadata,filename:"report-2026-09-29-to-2026-09-30.pdf"}).status,"conflict");
});
test("printed store must resolve uniquely and agree with the selected store",()=>{
  assert.equal(resolvePrintedStore(stores,"Fictional Store Alpha","fictional-a").status,"supported");
  assert.equal(resolvePrintedStore(stores,"Fictional Store Beta","fictional-a").reason,"printed_store_mismatch");
  assert.equal(resolvePrintedStore(stores,"Fictional Store","fictional-a").status,"rejected");
  assert.equal(resolvePrintedStore([...stores,{id:"third",name:stores[0].name}],stores[0].name,"fictional-a").reason,"ambiguous_printed_store");
});
test("exact printed totals, including zero, are provisional evidence with raw provenance",()=>{
  const c=candidate();assert.equal(c.status,"provisional");assert.equal(c.count,7);assert.equal(c.isFinal,false);
  assert.equal(c.publicationEligible,false);assert.equal(c.source.sha256.length,64);
  assert.equal(candidate(0).count,0);assert.equal(candidate(7.5).count,7.5);
  const without=buildDailyDeliveryEvidence({lines:lines(),metadata,stores,storeId:"fictional-a"});
  assert.equal(without.count,null);assert.equal(without.reason,"raw_source_bytes_required");
  assert.equal(candidate(7,{reportType:"delivery-summary"}).reason,"not_daily_activity");
  const mismatch=buildDailyDeliveryEvidence({lines:lines(7,stores[1].name),bytes:Buffer.from("raw"),metadata,stores,storeId:"fictional-a"});
  assert.equal(mismatch.count,null);assert.equal(mismatch.reason,"printed_store_mismatch");
});
test("ledger keeps gaps unknown and deduplicates resends without summing employee or report credits",()=>{
  const a=candidate(), repeat=candidate(7,{receivedAt:"2026-10-01T00:03:00Z"});
  const l=deliveryLedger({storeId:"fictional-a",month:"2026-09",candidates:[a,repeat]});
  assert.equal(l.days.length,30);assert.equal(l.days[29].count,7);assert.equal(l.days[29].sourceVersions.length,1);
  assert.equal(l.days[12].status,"missing");assert.equal(l.days[13].count,null);
  assert.equal(l.writes,0);assert.ok(l.days.every(d=>d.publicationEligible===false));
  assert.equal(deliveryLedger({storeId:"fictional-a",month:"2024-02"}).days.length,29);
});
test("latest sent version is explicit and lower corrections never become negative daily sales",()=>{
  const before=candidate(7), after=candidate(5,{sentAt:"2026-10-01T01:01:00Z",receivedAt:"2026-10-01T01:02:00Z"});
  const day=deliveryLedger({storeId:"fictional-a",month:"2026-09",candidates:[after,before]}).days[29];
  assert.equal(day.count,5);assert.equal(day.revision,true);assert.equal(day.isFinal,false);
  assert.equal(day.selectionBasis,"latest_sent_report");assert.equal(day.sourceVersions.length,2);
  const tie=deliveryLedger({storeId:"fictional-a",month:"2026-09",candidates:[before,candidate(6)]}).days[29];
  assert.equal(tie.status,"conflict");assert.equal(tie.count,null);
  const unsequenced=deliveryLedger({storeId:"fictional-a",month:"2026-09",candidates:[before,candidate(6,{sentAt:null})]}).days[29];
  assert.equal(unsequenced.status,"conflict");assert.equal(unsequenced.reason,"source_order_unconfirmed");
});
test("dry run reads local raw inputs only, reports failures and exposes employee disagreement without changing the primary count",async()=>{
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),"delivery-dry-"));
  try {
    await fs.writeFile(path.join(dir,"report.pdf"),"%PDF-fictional original");
    const manifest={schemaVersion:1,storeId:"fictional-a",month:"2026-09",stores,sources:[{path:"report.pdf",...metadata}]};
    const originalFetch=globalThis.fetch;globalThis.fetch=()=>{throw new Error("Network forbidden in the dry run")};
    let ledger;
    try { ledger=await runDeliveryDryRun(manifest,{baseDir:dir,extractLines:async()=>lines()}); }
    finally { globalThis.fetch=originalFetch; }
    const d=ledger.days[29];assert.equal(d.count,7);assert.equal(d.candidates[0].reconciliation.employeeCredits,9);
    assert.equal(d.candidates[0].reconciliation.changesPrimaryCount,false);assert.equal(ledger.writes,0);
    assert.deepEqual(await fs.readdir(dir),["report.pdf"],"the runner created no file");
    const failed=await runDeliveryDryRun({...manifest,sources:[{...metadata,path:"missing.pdf"}]},{baseDir:dir});
    assert.equal(failed.rejected[0].reason,"source_read_or_parse_failed");assert.equal(failed.days[29].count,null);
    const remote=await runDeliveryDryRun({...manifest,sources:[{...metadata,path:"https://example.invalid/report.pdf"}]},{baseDir:dir});
    assert.equal(remote.rejected[0].reason,"invalid_local_source_path");
  } finally { await fs.rm(dir,{recursive:true,force:true}); }
});
test("the command has no write mode and aggregate candidate JSON is not a raw-input manifest",async()=>{
  const r=spawnSync(process.execPath,["scripts/delivery-reconstruction-dry-run.mjs","--write"],{encoding:"utf8"});
  assert.equal(r.status,2);assert.match(r.stderr,/No network or write mode/);
  await assert.rejects(()=>runDeliveryDryRun({direct_daily_candidate:{printed_store_total_delivered:7}}),/invalid_manifest/);
});

test("a count with incomplete source provenance cannot enter the review ledger",()=>{
  const forged={...candidate(),source:{sourceId:"aggregate-only"}};
  const d=deliveryLedger({storeId:"fictional-a",month:"2026-09",candidates:[forged]}).days[29];
  assert.equal(d.count,null);assert.equal(d.reason,"raw_source_provenance_required");
});

function pdfFromLines(input) {
  const escape = (s) => s.replaceAll("\\", "\\\\").replaceAll("(", "\\(").replaceAll(")", "\\)");
  const stream = "BT /F1 5 Tf\n" + input.map((l,i) =>
    `1 0 0 1 12 ${760-i*14} Tm (${escape(l.parts.map(p=>p.str).join(" "))}) Tj`).join("\n") + "\nET";
  const objs=["<< /Type /Catalog /Pages 2 0 R >>","<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",`<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`];
  let pdf="%PDF-1.4\n";const offsets=[0];
  for (const [i,obj] of objs.entries()) { offsets.push(Buffer.byteLength(pdf));pdf+=`${i+1} 0 obj\n${obj}\nendobj\n`; }
  const xref=Buffer.byteLength(pdf);
  pdf+=`xref\n0 ${objs.length+1}\n0000000000 65535 f \n`+offsets.slice(1).map(n=>`${String(n).padStart(10,"0")} 00000 n \n`).join("");
  return Buffer.from(pdf+`trailer\n<< /Size ${objs.length+1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`);
}

test("the actual CLI reads a synthetic raw PDF and emits clean JSON with traceable source provenance",async()=>{
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),"delivery-pdf-"));
  try {
    const bytes=pdfFromLines(lines());
    // Exercise the shared extractor directly as well, so a runtime-specific
    // dependency failure is visible before the CLI returns its safe reason code.
    const { extractPdfLines } = await import("../api/ingest.mjs");
    assert.ok((await extractPdfLines(bytes)).length > 0);
    await fs.writeFile(path.join(dir,"report.pdf"),bytes);
    const manifest={schemaVersion:1,storeId:"fictional-a",month:"2026-09",stores,sources:[{path:"report.pdf",...metadata}]};
    const file=path.join(dir,"manifest.json");await fs.writeFile(file,JSON.stringify(manifest));
    const r=spawnSync(process.execPath,["scripts/delivery-reconstruction-dry-run.mjs","--manifest",file],{encoding:"utf8"});
    const ledger=JSON.parse(r.stdout), day=ledger.days[29];
    assert.equal(r.status,0,JSON.stringify({day,rejected:ledger.rejected})+r.stderr);
    assert.equal(day.count,7);assert.equal(day.sourceVersions[0].sha256.length,64);
    assert.equal(day.candidates[0].reconciliation.employeeCredits,9);
    assert.deepEqual((await fs.readdir(dir)).sort(),["manifest.json","report.pdf"]);
  } finally { await fs.rm(dir,{recursive:true,force:true}); }
});

test("a missing or ambiguous printed store remains a parser hold, not guessed identity",()=>{
  const missing=buildDailyDeliveryEvidence({lines:[],bytes:Buffer.from("raw"),metadata,stores,storeId:"fictional-a"});
  assert.equal(missing.status,"missing");assert.equal(missing.count,null);assert.equal(missing.reason,"not-daily-activity");
});

test("incomplete source evidence remains distinct from a contradictory report",()=>{
  const c={...candidate(),status:"incomplete",reason:"unsupported-activity-header",count:null};
  const d=deliveryLedger({storeId:"fictional-a",month:"2026-09",candidates:[c]}).days[29];
  assert.equal(d.status,"incomplete");assert.equal(d.reason,"unsupported-activity-header");
  const malformedDate={...candidate(),businessDate:"2026-09-99"};
  assert.equal(deliveryLedger({storeId:"fictional-a",month:"2026-09",candidates:[malformedDate]}).rejected.length,1);
});

test("a manifest cannot read a file outside its directory through a symlink",async()=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),"delivery-root-"));
  const outside=await fs.mkdtemp(path.join(os.tmpdir(),"delivery-outside-"));
  try {
    await fs.writeFile(path.join(outside,"external.pdf"),pdfFromLines(lines()));
    await fs.symlink(path.join(outside,"external.pdf"),path.join(root,"linked.pdf"));
    const ledger=await runDeliveryDryRun({schemaVersion:1,storeId:"fictional-a",month:"2026-09",stores,
      sources:[{path:"linked.pdf",...metadata}]},{baseDir:root});
    assert.equal(ledger.rejected[0].reason,"source_path_outside_manifest_directory");
  } finally { await fs.rm(root,{recursive:true,force:true}); await fs.rm(outside,{recursive:true,force:true}); }
});

test("a late duplicate cannot make an older distinct report win the daily selection",()=>{
  const recent=candidate(7,{sentAt:"2026-10-01T02:00:00Z",receivedAt:"2026-10-01T02:01:00Z"});
  const middle=candidate(6,{sentAt:"2026-10-01T01:00:00Z",receivedAt:"2026-10-01T01:01:00Z"});
  const lateDuplicate=candidate(7,{sentAt:"2026-10-01T00:00:00Z",receivedAt:"2026-10-01T03:00:00Z"});
  const d=deliveryLedger({storeId:"fictional-a",month:"2026-09",candidates:[recent,middle,lateDuplicate]}).days[29];
  assert.equal(d.count,7);assert.equal(d.asOf.timestamp,"2026-10-01T02:00:00.000Z");assert.equal(d.candidates.length,3);
});

test("one raw source claiming two business dates is held across days and month boundaries",()=>{
  const first=candidate(7,{filename:"report.pdf",sentAt:"2026-09-29T20:00:00Z",receivedAt:"2026-09-29T20:01:00Z"});
  const resend=candidate(7,{filename:"report.pdf",sentAt:"2026-09-30T20:00:00Z",receivedAt:"2026-09-30T20:01:00Z"});
  const l=deliveryLedger({storeId:"fictional-a",month:"2026-09",candidates:[first,resend]});
  assert.equal(l.days[28].count,null);assert.equal(l.days[29].count,null);
  assert.equal(l.days[29].reason,"same_raw_source_claims_multiple_dates");
  const nextMonth=candidate(7,{filename:"report.pdf",sentAt:"2026-10-01T20:00:00Z",receivedAt:"2026-10-01T20:01:00Z"});
  assert.equal(deliveryLedger({storeId:"fictional-a",month:"2026-09",candidates:[resend,nextMonth]}).days[29].status,"conflict");
});
test("partial serialized receipts are held, never accepted or dereferenced blindly",()=>{
  for (const receipt of [undefined,{}, {receivedAt:null,sentAt:null}, {receivedAt:"not-a-time",sentAt:null},
    {receivedAt:"2026-10-01T00:02:00.000Z",sentAt:"2026-10-02T00:02:00.000Z"}]) {
    const c=candidate();c.source={...c.source,receipt};
    const d=deliveryLedger({storeId:"fictional-a",month:"2026-09",candidates:[c]}).days[29];
    assert.equal(d.count,null);assert.equal(d.reason,"raw_source_provenance_required");
  }
});
