/* C105: Jorge's pass on the salesperson screens as Sam Demo, 29 September,
   decided on https://claude.ai/artifact/H9rWzzUTz1utpm5vWe3ora. Each guard is
   one decision, so a later change that undoes one says which. */
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { buildDemo } from "../scripts/demo-seed.mjs";

const app = fs.readFileSync(new URL("../src/LeadPerformanceCalculator.jsx", import.meta.url), "utf8").replace(/\r\n/g, "\n");

test("A1: the front circle is centred in the rounded end of both lines", () => {
  assert.match(app, /\n\.mc-rail\{ --edge:17px; \}/, "Home: 34 px line, 30 px circle, centred at the end's 17 px radius");
  assert.match(app, /\n\.mcf-track\{ --edge:20px; \}/, "Live Floor: 40 px line, 34 px circle, centred at 20 px");
});

test("A2: somebody joining runs in on Home and on the Live Floor, and only a newcomer moves", () => {
  const hook = app.slice(app.indexOf("function useLineArrivals("), app.indexOf("function SfCord("));
  assert.match(hook, /if \(!el \|\| !prev \|\| !prev\.size\) return;/, "the first sight of a line places everybody");
  assert.match(hook, /prefers-reduced-motion: reduce/, "and reduced motion places them too");
  assert.match(hook, /if \(prev\.has\(id\)\) return;/);
  assert.match(hook, /\{ duration: 1400 \}/, "the cord's own timing");
  assert.match(app, /useLineArrivals\(ref, waiting\.map\(\(p2\) => p2\.id\), "\.mcf-pip, \.mcf-you"\);/, "the Live Floor");
  assert.match(app, /useLineArrivals\(railRef, me \? \(line \|\| \[\]\)\.slice\(0, 8\)\.map\(\(p\) => p\.id\) : \[\], "\.mc-pip"\);/, "Home");
  assert.match(app, /<i key=\{p\.id \|\| i\} data-id=\{p\.id\} className=\{"mc-pip"/);
});

test("B: the words Jorge took out stay out", () => {
  for (const gone of ["DAY MADE", "MADE IT", ">made it<", "ticked by hand", "mc-boardsub\">", "Nothing the phone can still read",
    "Scheduled off. Your stats stay open.", "Ahead of you. On the floor, RockEd by ten.", "NO REPORT"]) {
    assert.ok(!app.includes(gone), `${gone} is gone`);
  }
  assert.match(app, /<span>COMPLETED<\/span>/, "Completed, on the green bar");
  assert.match(app, /if \(!r\) return <div className="mc-scr"><span>\{lbl\}<\/span><i \/><span>OFF<\/span><\/div>;/, "a day with no report says Off");
});

test("B6: the day's figures print the dot, not its code", () => {
  assert.match(app, /<span>\{"CALLS \\u00b7 VIDEOS"\}<\/span><i \/><span>\{`\$\{r\.calls \|\| 0\} \\u00b7 \$\{r\.video \|\| 0\}`\}<\/span>/);
  /* An escape written as bare JSX text is printed as the escape. None left in
     the salesperson file. */
  for (const line of app.split("\n")) {
    const at = line.indexOf("\\u00b7");
    if (at < 0) continue;
    const before = line.slice(0, at);
    const inside = (before.split('"').length - 1) % 2 === 1 || (before.split("'").length - 1) % 2 === 1 || (before.split("`").length - 1) % 2 === 1;
    assert.ok(inside, `a bare escape in: ${line.trim().slice(0, 90)}`);
  }
});

test("C1: dark, always, and the Look row is gone", () => {
  assert.match(app, /const lightMode = false;/);
  assert.ok(!app.includes('aria-label="Look"') && !app.includes("lpcf:pref:theme"), "no Look row, nothing reads the old choice");
});

test("C2 b: the This phone rows have no descriptions; Reach and The day keep theirs", () => {
  const you = app.slice(app.indexOf('<div className="mc-cap">THIS PHONE</div>'), app.indexOf('<div className="mc-cap">REACH</div>'));
  assert.ok(you.length > 500 && !/className="hint"/.test(you), "no description on any This phone row");
  const reach = app.slice(app.indexOf('<div className="mc-cap">REACH</div>'), app.indexOf('<div className="mc-cap">THE DAY</div>'));
  assert.match(reach, /Send a number or a ticket back with a note/);
  /* Jorge, after the preview: the Message row names him and has no line under
     it. A store whose settings carry no support contact said "Message the". */
  assert.match(reach, /<span>Message \{\(\(cfg && cfg\.support && cfg\.support\.name\) \|\| "Jorge"\)\.split\(" "\)\[0\]\}<\/span>/);
  assert.ok(!reach.includes("Straight to the top"));
});

test("the demo store has both rooms, so the reviewer sees the Phone Line", () => {
  assert.deepEqual(buildDemo(new Date("2026-09-29T17:00:00Z")).storeConfig.rooms, { floor: true, line: true });
});
