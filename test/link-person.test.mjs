/**
 * Joining an account to the person it is on the floor.
 * -------------------------------------------------------------------------
 * This link decides whose pocket buzzes when a customer walks in, so the server
 * reads the caller's own role rather than believing a browser, and a device is
 * filed under the roster id the line actually uses.
 *
 * Supabase is stubbed at the network layer rather than by replacing the client,
 * so the real query builder runs and a wrong filter still shows up here.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
// Linking an account to a person on the floor, and the device fix that depends on it.
process.env.SUPABASE_URL="https://stub.local"; process.env.SUPABASE_SERVICE_ROLE_KEY="svc"; process.env.SUPABASE_ANON_KEY="anon";
const API = new URL("../api", import.meta.url).pathname;

let DEVICES=[];
let LINKS=[], PROFILE={ role:"manager", stores:["honda"] }, SESSION="mgr-1", sessionOk=true;
let upserts=[], deletes=[];
const j = (o,s=200)=>new Response(JSON.stringify(o),{status:s,headers:{"content-type":"application/json"}});
globalThis.fetch = async (url, opt={}) => {
  const u=String(url), m=(opt.method||"GET").toUpperCase();
  if (u.includes("/auth/v1/user")) return sessionOk ? j({ id: SESSION }) : j({ msg:"bad" }, 401);
  if (u.includes("/rest/v1/profiles")) return j(PROFILE ? [PROFILE] : []);
  if (u.includes("/rest/v1/floor_people")) {
    if (m==="DELETE") { deletes.push({t:"floor_people",u:decodeURIComponent(u)}); return j([]); }
    if (m==="POST" || m==="PATCH") { upserts.push(JSON.parse(opt.body)); return j([]); }
    const dec = decodeURIComponent(u);
    let rows = LINKS.filter(l => dec.includes(`store=eq.${l.store}`) || !dec.includes("store=eq."));
    if (/user_id=eq\.([^&]+)/.test(dec)) { const uid = dec.match(/user_id=eq\.([^&]+)/)[1]; rows = rows.filter(r=>r.user_id===uid); }
    return j(rows);
  }
  if (u.includes("/rest/v1/device_tokens")) {
    if (m==="DELETE") { deletes.push({t:"device_tokens",u:decodeURIComponent(u)}); return j([]); }
    if (m==="POST" || m==="PATCH") { upserts.push(JSON.parse(opt.body)); return j([]); }
    return j(DEVICES);
  }
  return j({});
};
const { default: link } = await import(API+"/link-person.mjs");
const { default: reg }  = await import(API+"/register-device.mjs");
const mkRes = () => { const r={code:200}; r.status=(c)=>{r.code=c;return r;}; r.json=(x)=>{r.body=x;return r;}; return r; };
const call = (fn, body, jwt="jwt") => { const res=mkRes(); return fn({method:"POST",headers:jwt?{authorization:`Bearer ${jwt}`}:{},body},res).then(()=>res); };
const get = (fn, query, jwt="jwt") => { const res=mkRes(); return fn({method:"GET",headers:jwt?{authorization:`Bearer ${jwt}`}:{},query},res).then(()=>res); };

// ---- the defect this round exists to fix ----
test("the defect this round exists to fix", async () => {
    LINKS = []; upserts = [];
    const res = await call(reg, { store:"honda", platform:"ios", device_id:"phone-1", apns_token:"T" });
    assert.ok(
      res.code === 403, res.body);
    assert.ok(
      /manager/i.test(res.body.message||""), res.body);
});
test("a linked account registers", async () => {
    LINKS = [{ id:"honda:user-luis", user_id:"user-luis", store:"honda", person_id:"roster-luis" }];
    SESSION = "user-luis"; upserts = [];
    const res = await call(reg, { store:"honda", platform:"ios", device_id:"phone-1", apns_token:"T" });
    const row = Array.isArray(upserts[0])?upserts[0][0]:upserts[0];
    assert.ok(
      res.code === 200, res.body);
    assert.ok(
      row.person_id === "roster-luis", row);
    assert.ok(
      row.person_id !== "user-luis", row);
});

// ---- who may link ----
test("who may link", async () => {
    SESSION="mgr-1"; PROFILE={ role:"manager", stores:["honda"] }; LINKS=[];
    assert.ok(
      (await call(link,{store:"honda",user_id:"user-luis",person_id:"roster-luis"})).code === 200);
    PROFILE={ role:"manager", stores:["other"] };
    assert.ok(
      (await call(link,{store:"honda",user_id:"user-luis",person_id:"roster-luis"})).code === 403);
    PROFILE={ role:"admin", stores:[] };
    assert.ok(
      (await call(link,{store:"honda",user_id:"user-luis",person_id:"roster-luis"})).code === 200);
    PROFILE=null;
    assert.ok(
      (await call(link,{store:"honda",user_id:"user-luis",person_id:"roster-luis"})).code === 403);
    PROFILE={ role:"manager", stores:["honda"] };
    assert.ok(
      (await call(link,{store:"honda",user_id:"u",person_id:"p"}, null)).code === 401);
});

// ---- the two ways a link can be wrong ----
test("the two ways a link can be wrong", async () => {
    LINKS = [{ id:"honda:user-jason", user_id:"user-jason", store:"honda", person_id:"roster-luis" }];
    const res = await call(link, { store:"honda", user_id:"user-luis", person_id:"roster-luis" });
    assert.ok(
      res.code === 409, res.body);
    assert.ok(
      /unlink/i.test(res.body.error||""), res.body);
});
test("one account cannot be two people at one store", async () => {
    LINKS = [{ id:"honda:user-luis", user_id:"user-luis", store:"honda", person_id:"roster-jason" }];
    const res = await call(link, { store:"honda", user_id:"user-luis", person_id:"roster-luis" });
    assert.ok(
      res.code === 409, res.body);
});
test("but the same person may work at two stores", async () => {
    LINKS = [{ id:"other:user-luis", user_id:"user-luis", store:"other", person_id:"roster-luis" }];
    const res = await call(link, { store:"honda", user_id:"user-luis", person_id:"roster-luis" });
    assert.ok(
      res.code === 200, res.body);
});

// ---- unlinking takes the devices with it ----
test("unlinking takes the devices with it", async () => {
    LINKS = [{ id:"honda:user-luis", user_id:"user-luis", store:"honda", person_id:"roster-luis" }];
    deletes = [];
    const res = await call(link, { store:"honda", user_id:"user-luis", unlink:true });
    assert.ok(
      res.code === 200 && res.body.unlinked === true, res.body);
    assert.ok(
      deletes.some(d=>d.t==="floor_people"), deletes);
    assert.ok(
      deletes.some(d=>d.t==="device_tokens" && d.u.includes("person_id=eq.roster-luis")), deletes);
});

// ---- reading the links back, which is what the manager's screen does ----
test("reading the links back, which is what the manager's screen does", async () => {
    SESSION="mgr-1"; PROFILE={ role:"manager", stores:["honda"] };
    LINKS = [{ id:"honda:user-luis", user_id:"user-luis", store:"honda", person_id:"roster-luis" },
             { id:"honda:user-jason", user_id:"user-jason", store:"honda", person_id:"roster-jason" }];
    DEVICES = [{ person_id:"roster-luis", platform:"ios", updated_at:"2026-08-18T10:00:00Z" },
               { person_id:"roster-luis", platform:"android", updated_at:"2026-08-19T10:00:00Z" }];
    const res = await get(link, { store:"honda" });
    assert.ok(
      res.code === 200, res.body);
    const luis = (res.body.links||[]).find(l=>l.person_id==="roster-luis");
    const jason = (res.body.links||[]).find(l=>l.person_id==="roster-jason");
    assert.ok(
      (res.body.links||[]).length === 2, res.body);
    assert.ok(
      luis && luis.devices === 2, luis);
    assert.ok(
      luis && luis.platforms.sort().join()==="android,ios", luis);
    assert.ok(
      luis && luis.lastSeen === "2026-08-19T10:00:00Z", luis);
    assert.ok(
      jason && jason.devices === 0, jason);
    assert.ok(
      !JSON.stringify(res.body).match(/apns|fcm|activity_token/i), res.body);
});
test("a manager of another store cannot read them", async () => {
    PROFILE={ role:"manager", stores:["other"] };
    assert.ok(
      (await get(link,{store:"honda"})).code === 403);
    PROFILE={ role:"manager", stores:["honda"] };
    assert.ok(
      (await get(link,{store:"honda"}, null)).code === 401);
    assert.ok(
      (await get(link,{})).code === 400);
});
test("reading writes nothing", async () => {
    // The GET must not be mistaken for a link attempt just because the body is empty.
    PROFILE={ role:"manager", stores:["honda"] }; LINKS=[]; upserts=[];
    await get(link, { store:"honda" });
    assert.ok(
      upserts.length === 0, upserts);
});

