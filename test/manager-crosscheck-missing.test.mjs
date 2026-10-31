/* The store roll-up in the cross-check reads a blank cell as "not said", never as zero.
 *
 * What this protects. The cross-check read its roll-up cells with Number(cell || 0). A blank cell, a cell of spaces and a short row all became 0, and a dash
 * became NaN, so a report that did not give a store total was shown as a store total of nothing. Now a blank, whitespace or lone dash cell is null (the screen
 * already shows null as a dash and skips the comparison), and every other cell keeps exactly Number()'s reading: an explicit 0 and 0.5 are numbers, and text that is
 * not a number stays NaN. The people units column already behaved this way. No API, core or shared parser is involved: this is the manager's own inline CSV path.
 *
 * How it tests. The helper and the call sites are cut out of src/Manager.jsx by anchor (each must occur exactly once) and run. Mutation controls rebuild the old
 * expression and two tempting "fixes" (a permissive prefix parse, and a comma and currency strip) from the real text by one replacement; the same checks fail them.
 * Limits. This is the expression and the source shape. What the person sees (which tile, which comparison) is checked in the mounted browser cases, not here, and
 * nothing here claims those passed. Dependency-free: node:test only.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const src = fs.readFileSync(new URL("../src/Manager.jsx", import.meta.url), "utf8").replace(/\r\n/g, "\n");
const once = (a, what) => { assert.equal(src.split(a).length - 1, 1, what + " anchor must occur exactly once"); return src.indexOf(a); };
const cut = (start, end, what) => { const a = once(start, what); const b = src.indexOf(end, a); assert.ok(b > a, what + " end"); return src.slice(a, b + end.length); };
const HELPER = cut("const csvCell = (v) => {", "};\nfunction CrossCheck", "csvCell").replace(/\nfunction CrossCheck$/, "");
const CROSSCHECK = cut("function CrossCheck({ store, data, config, onClose }) {", "\nfunction XcList", "CrossCheck").replace(/\nfunction XcList$/, "");
const fnOf = (code = HELPER) => new Function(code + "\nreturn csvCell;")();
const cell = fnOf();

test("blank, whitespace-only, a lone dash and a missing cell are not said, so they are null", () => {
  for (const v of ["", " ", "   ", "\t", "\u00a0 ", "-", " - ", undefined, null]) assert.equal(cell(v), null, JSON.stringify(v));   // String.trim() also strips a non-breaking space
});
test("an explicit zero and a fractional half are numbers and are kept as written", () => {
  assert.equal(cell("0"), 0); assert.equal(Object.is(cell("0"), 0), true);
  assert.equal(cell("0.0"), 0); assert.equal(cell(" 0 "), 0);
  assert.equal(cell("0.5"), 0.5); assert.equal(cell("12.5"), 12.5); assert.equal(cell(".5"), 0.5);
  assert.equal(cell("7"), 7); assert.equal(cell("-3"), -3); assert.equal(cell("1e2"), 100);
});
test("every other nonblank cell keeps exactly the reading Number() gave it, so nothing is guessed", () => {
  for (const v of ["12abc", "1,234", "$12", "abc", "--", "- 1", "12 3", "NaN", "Infinity", "0x10", "1_000", "–", "—"]) {
    const want = Number(v), got = cell(v);
    assert.ok(Object.is(got, want), `${v}: ${got} vs Number ${want}`);
  }
  assert.ok(Number.isNaN(cell("12abc")) && Number.isNaN(cell("1,234")) && Number.isNaN(cell("$12")), "text that is not a number stays NaN");
});
test("baseline characterization of the expression this replaced: blank and spaces became zero, a dash became NaN", () => {
  const old = (v) => Number(v || 0);
  assert.equal(old(""), 0); assert.equal(old(" "), 0); assert.equal(old(undefined), 0); assert.ok(Number.isNaN(old("-")));
  assert.equal(old("0.5"), 0.5); assert.equal(old("0"), 0);   // what it already got right, and must still
});

/* ---- the call sites ---- */
test("the three roll-up reads and the display use the helper, and no Number(x || 0) remains in the cross-check", () => {
  assert.ok(CROSSCHECK.includes("return j < 0 ? null : csvCell(r[j]); };"), "sold and net opportunities");
  assert.ok(CROSSCHECK.includes("deals: csvCell(r[sDeal]),"), "deals delivered");
  assert.ok(CROSSCHECK.includes("opps: oppAt >= 0 ? csvCell(r[oppAt]) : null,"), "person opportunities");
  assert.equal(/Number\([^)]*\|\|\s*0\)/.test(CROSSCHECK), false, "no Number(cell || 0) is left");
  assert.ok(CROSSCHECK.includes('<span className="xc-n">{shownRoll.deals == null ? "\\u2013" : shownRoll.deals}</span>'), "an unknown store total is shown as a dash, not as an empty number");
});
test("the people units column is untouched: blank and dash were already unknown", () => {
  assert.ok(CROSSCHECK.includes('flatUnits: raw === "" || raw === "-" ? null : Number(raw),'));
});
test("an unknown store total is not turned back into a number further down", () => {
  assert.ok(CROSSCHECK.includes("const auth = res.roll ? res.roll.deals : res.stated ? res.stated.total : null;\n                if (auth == null || res.fileTotal == null) return null;"), "no comparison without a figure");
  assert.ok(CROSSCHECK.includes('{res.roll ? n(res.roll.deals) :'), "the tile goes through n(), which shows a dash for null");
  assert.ok(CROSSCHECK.includes("fileOpps: rows.some((r) => r.opps != null) ?"), "all-unknown opportunities stay unknown");
  assert.ok(CROSSCHECK.includes('const n = (v) => (v == null ? "–"'), "n() shows a dash for null");
});

/* ---- the people's total: unknown when no person gave a figure, as before when any did ---- */
const SUM = cut("const sum = (list, f) =>", ";\n", "sum").replace(/;\n$/, ";");
const FILE_TOTAL = cut("fileTotal: rows.some((r) => r.fu != null)", ",\n", "fileTotal").replace(/,\n$/, "");
const totalOf = (rows, expr = FILE_TOTAL) => new Function("rows", SUM + "\nreturn { " + expr + " }.fileTotal;")(rows);
test("no person gave a figure: the people add to unknown (null), not zero", () => {
  assert.equal(totalOf([]), null);
  assert.equal(totalOf([{ fu: null }, { fu: null }]), null);
  assert.equal(totalOf([{ fu: null, hu: 4 }]), null, "held figures do not make a file figure");
});
test("any known figure keeps the existing sum, an explicit zero and half units included, and unknown rows count as nothing in a mixed file", () => {
  assert.equal(totalOf([{ fu: 0 }, { fu: 0 }]), 0);
  assert.equal(totalOf([{ fu: 0.5 }, { fu: 0.5 }, { fu: null }]), 1);
  assert.equal(totalOf([{ fu: 3 }, { fu: null }, { fu: 2.25 }]), 5.25);
  assert.ok(Number.isNaN(totalOf([{ fu: NaN }, { fu: 2 }])), "a figure that is not a number is still a known cell and behaves as it did");
});
test("the board and held totals and sum() itself are unchanged, so nothing else about the screen moved", () => {
  assert.ok(CROSSCHECK.includes("boardTotal: +sum(boardRows, (r) => r.hu).toFixed(2),"));
  assert.ok(CROSSCHECK.includes("heldTotal: +sum(rows, (r) => r.hu).toFixed(2),"));
  assert.ok(CROSSCHECK.includes("const sum = (list, f) => list.reduce((n, r) => n + (f(r) ?? 0), 0);"));
  assert.ok(CROSSCHECK.includes("fileOpps: rows.some((r) => r.opps != null) ? +sum(rows, (r) => r.opps).toFixed(0) : null,"));
});
test("the comparison runs only when the people gave a figure: an unknown total is never subtracted as if it were zero", () => {
  assert.ok(CROSSCHECK.includes("if (auth == null || res.fileTotal == null) return null;"));
  const guard = CROSSCHECK.indexOf("if (auth == null || res.fileTotal == null) return null;"), over = CROSSCHECK.indexOf("const over = res.fileTotal - auth;");
  assert.ok(guard > 0 && over > guard, "the guard comes before the subtraction");
  // what the old code did: null - 12 is -12, which reads as "runs low by 12"
  assert.equal(null - 12, -12);
});
test("the tile and the odd-half marker take an unknown people total without throwing", () => {
  assert.ok(CROSSCHECK.includes('const n = (v) => (v == null ? "–"'));
  assert.ok(CROSSCHECK.includes("const half = (v) => v != null && Math.abs(v - Math.round(v)) > 0.001;"));
  assert.ok(CROSSCHECK.includes('{n(res.fileTotal)}'));
});

/* ---- mutation controls: each wrong version is rebuilt from the real text and must be caught ---- */
const mutants = {
  "the old expression": HELPER.replace('const raw = String(v ?? "").trim(); return raw === "" || raw === "-" ? null : Number(raw);', "return Number(v || 0);"),
  "a permissive prefix parse": HELPER.replace("Number(raw)", "parseFloat(raw)"),
  "a comma and currency strip": HELPER.replace("Number(raw)", 'Number(raw.replace(/[$,]/g, ""))'),
  "blank only (the dash left as NaN)": HELPER.replace('raw === "" || raw === "-"', 'raw === ""'),
  "zero treated as absent": HELPER.replace('raw === "" || raw === "-"', 'raw === "" || raw === "-" || Number(raw) === 0'),
};
const verdict = (fn) => {
  const fails = [];
  const chk = (name, ok) => { if (!ok) fails.push(name); };
  chk("blank", fn("") === null); chk("spaces", fn("  ") === null); chk("dash", fn("-") === null); chk("missing", fn(undefined) === null);
  chk("zero", Object.is(fn("0"), 0)); chk("half", fn("0.5") === 0.5);
  chk("12abc", Number.isNaN(fn("12abc"))); chk("1,234", Number.isNaN(fn("1,234"))); chk("$12", Number.isNaN(fn("$12")));
  return fails;
};
test("the real helper passes every check", () => { assert.deepEqual(verdict(cell), []); });
test("MUTATION: the old people total (always a sum) is caught", () => {
  const old = "fileTotal: +sum(rows, (r) => r.fu).toFixed(2)";
  assert.notEqual(old, FILE_TOTAL);
  assert.equal(totalOf([{ fu: null }, { fu: null }], old), 0, "the old expression made unknown into zero");
});
for (const [name, code] of Object.entries(mutants)) {
  test("MUTATION: " + name + " is caught", () => {
    assert.notEqual(code, HELPER, "the replacement applied");
    assert.ok(verdict(fnOf(code)).length > 0, "at least one check fails for " + name);
  });
}
