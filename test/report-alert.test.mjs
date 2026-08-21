/**
 * Carrying "that number is wrong" to somebody while it is still wrong.
 * -------------------------------------------------------------------------
 * The report is already saved by the time any of this runs. Nothing here may
 * ever be able to lose one.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { alertText, alertBody, usableHook, sendAlert, worthSending } from "../api/_report-alert.mjs";

const ticket = {
  id: "t1", at: "2026-08-20T14:00:00Z", kind: "figures", status: "open",
  from: "Luis Vega", reach: "luis@holler.com", store: "classic-mazda",
  figure: "Units this month", shown: "84.5", expected: "85",
  basis: "DriveCentric shows 85", body: "It was right on Tuesday.",
  context: "My day, Luis Vega, 2026-08-20",
  snapshot: [{ label: "Units this month", value: "84.5" }, { label: "Calls today", value: "12" }],
};

test("the message leads with the comparison, because that is the whole report", () => {
  const lines = alertText(ticket).split("\n");
  assert.match(lines[0], /Luis Vega/);
  assert.match(lines[0], /classic-mazda/);
  assert.equal(lines[1], "Units this month: showing 84.5, should be 85");
});

test("everything worth chasing it with comes along", () => {
  const txt = alertText(ticket);
  for (const bit of ["DriveCentric shows 85", "right on Tuesday", "My day, Luis Vega", "luis@holler.com"]) {
    assert.ok(txt.includes(bit), `missing: ${bit}`);
  }
});

test("a half-filled report still says something useful", () => {
  const txt = alertText({ kind: "figures", figure: "My units", shown: "3" });
  assert.match(txt, /Somebody says a number is wrong/);
  assert.match(txt, /My units: showing 3/);
  assert.ok(!txt.includes("should be"), "no invented expectation");
});

test("'something else on this screen' does not reach anybody as __other", () => {
  const txt = alertText({ kind: "figures", figure: "__other", shown: "", body: "the whole board" });
  assert.ok(!txt.includes("__other"), txt);
  assert.match(txt, /A figure on their screen/);
});

test("an empty ticket does not throw", () => {
  assert.equal(alertText(null), "");
  assert.equal(typeof alertText({}), "string");
});

test("the body is the shape Slack and Teams both accept", () => {
  const b = alertBody(ticket);
  assert.equal(typeof b.text, "string");
  assert.ok(b.text.length > 0);
  assert.equal(b.ticket.id, "t1", "and the whole report rides along for anything richer");
});

test("only https, and only somewhere outside", () => {
  assert.ok(usableHook("https://hooks.slack.com/services/AAA/BBB/ccc"));
  assert.equal(usableHook("http://hooks.slack.com/x"), null, "plain http would send it in clear");
  assert.equal(usableHook(""), null);
  assert.equal(usableHook(null), null);
  assert.equal(usableHook("not a url"), null);
  assert.equal(usableHook("ftp://example.com/x"), null);
});

test("and never at the server's own doorstep", () => {
  /* Otherwise this endpoint becomes a way to make our server knock on doors
     inside its own network for whoever can set the field. */
  for (const bad of ["https://localhost/x", "https://127.0.0.1/x", "https://10.0.0.5/x",
                     "https://192.168.1.1/x", "https://172.16.0.1/x", "https://169.254.169.254/latest/meta-data/",
                     "https://thing.internal/x"]) {
    assert.equal(usableHook(bad), null, `should have refused ${bad}`);
  }
});

test("a hook that is not set is not an error", async () => {
  const r = await sendAlert("", ticket, () => { throw new Error("should not have been called"); });
  assert.equal(r.sent, false);
  assert.match(r.why, /no usable webhook/);
});

test("a destination that is down loses the notification and not the report", async () => {
  const r = await sendAlert("https://hooks.slack.com/x", ticket, async () => { throw new Error("ECONNRESET"); });
  assert.equal(r.sent, false, "reported, not thrown — the report itself is already saved");
  assert.match(r.why, /ECONNRESET/);
});

test("a destination that refuses says so rather than claiming success", async () => {
  const r = await sendAlert("https://hooks.slack.com/x", ticket, async () => ({ ok: false, status: 404 }));
  assert.equal(r.sent, false);
  assert.match(r.why, /404/);
});

test("and one that takes it reports it went", async () => {
  let seen = null;
  const r = await sendAlert("https://hooks.slack.com/x", ticket, async (url, opt) => {
    seen = { url, body: JSON.parse(opt.body), method: opt.method };
    return { ok: true, status: 200 };
  });
  assert.equal(r.sent, true);
  assert.equal(seen.method, "POST");
  assert.equal(seen.url, "https://hooks.slack.com/x");
  assert.match(seen.body.text, /should be 85/);
});

/* ---- and the other thing worth interrupting somebody for ----
   Somebody who kept missing the standard has written down what is stopping them.
   It goes out the same way for the same reason: a note nobody is prompted to read
   is a note written into a void, which is the whole risk this feature carries. */
const note = {
  id: "t2", at: "2026-08-19T20:00:00Z", kind: "standard", status: "open",
  from: "Luis Vega", store: "Holler Honda", who: "luis vega", forDay: "2026-08-18",
  missed: 3, of: 5, days: ["2026-08-18", "2026-08-17", "2026-08-15"],
  bar: "10 calls and 3 videos a day",
  body: "No inventory in my segment all week, and I covered the desk Tuesday.",
  context: "My day, Luis Vega, 2026-08-19",
};

test("a missed-standard note leads with who, and then with what they said", () => {
  const lines = alertText(note).split("\n");
  assert.match(lines[0], /Luis Vega at Holler Honda missed the standard on 3 of their last 5 days\./);
  assert.match(lines[1], /No inventory in my segment/,
    "what they said is the whole point and must not be below the housekeeping");
});

test("the days read as days, not as timestamps to decode", () => {
  const txt = alertText(note);
  assert.ok(txt.includes("18 Aug, 17 Aug, 15 Aug"), txt);
  assert.ok(!txt.includes("2026-08-18"), "raw dates in something read on a phone");
});

test("it says plainly that there is nothing to do about it", () => {
  /* It arrives beside reports that DO need chasing. Without this it reads as a
     task, and a manager either chases somebody who has already answered or
     learns to skim the channel. */
  assert.match(alertText(note), /Nothing to action here/);
});

test("a note with nothing in it still does not throw", () => {
  assert.equal(typeof alertText({ kind: "standard" }), "string");
});

test("the week rides along with the sentence about it", () => {
  const b = alertBody(note);
  assert.deepEqual(b.ticket.days, note.days);
  assert.equal(b.ticket.missed, 3);
});

test("only the two kinds that go stale are carried, and only while open", () => {
  assert.equal(worthSending(note), true);
  assert.equal(worthSending(ticket), true);
  assert.equal(worthSending({ kind: "problem", status: "open" }), false,
    "somebody stuck can be helped tomorrow; this is not the rail for it");
  assert.equal(worthSending({ ...note, status: "closed" }), false, "an edit is not a new report");
  assert.equal(worthSending(null), false);
});
