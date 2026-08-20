/**
 * A removal that does not survive the merge is not a removal.
 * -------------------------------------------------------------------------
 * Classic Mazda was cleared of another dealership's people and they were still
 * there afterwards. The tool filtered them out of the roster and wrote nothing
 * down — and the roster merge is a union, so the next save from any other
 * manager's open tab put every one of them straight back.
 *
 * The ignore list hit this. The plate log hit this. People were the last thing
 * still doing it the old way. These checks are the merge itself, run against a
 * removal, so it cannot quietly go back to filtering.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { norm } from "../api/_report-parsers.mjs";

const ROOT = new URL("..", import.meta.url).pathname;
const src = fs.readFileSync(path.join(ROOT, "src/LeadPerformanceCalculator.jsx"), "utf8");

/* The roster half of mergeAgainstServer, lifted from the app so this tests the
   real union rather than a description of it. If the shape below stops matching
   the source, that is a signal in itself and the check fails loudly. */
const cut = (from, to) => {
  const a = src.indexOf(from);
  const b = src.indexOf(to, a);
  assert.ok(a >= 0 && b > a, `the merge has moved; update this check (${from})`);
  return src.slice(a, b);
};
function rosterMerge(next, serverCopy) {
  /* Both halves as they stand in the app: the tombstone merge that settles which
     decision is newer, then the roster union it protects. */
  const tomb = cut("const TOMB_DAYS", "\n/*", ) + "\n" + cut("function mergeTombstones(mine, theirs) {", "\n/*");
  const block = cut("next.ignoredAt = mergeTombstones(", "next.roster = roster.filter")
    + src.slice(src.indexOf("next.roster = roster.filter"),
                src.indexOf("\n", src.indexOf("next.roster = roster.filter")));
  assert.ok(block.includes("const onList"), "the ignore-stamp comparison has moved; update this check");
  const fn = new Function("next", "serverCopy", "norm", `
    ${tomb}
    const gone = new Set(((next.departed) || []).map((x) => norm(x.name)));
    ${block}
    return next;`);
  return fn(JSON.parse(JSON.stringify(next)), serverCopy, norm);
}

const store = (names, extra = {}) => ({
  roster: names.map((n, i) => ({ id: "a" + i, name: n, roleId: "sales" })),
  excluded: [], departed: [], ignoredAt: {}, unignored: {}, ...extra,
});

test("filtering a name out of the roster does not remove them", () => {
  /* The failure as it actually happened, so the fix has something to beat. */
  const server = store(["Fin Smith", "Angel Perez"]);
  const mine = store(["Fin Smith"]);                    // the tool's old removal
  const out = rosterMerge(mine, server);
  assert.deepEqual(out.roster.map((a) => a.name), ["Fin Smith", "Angel Perez"],
    "the union puts them back, which is exactly what a manager saw");
});

test("a removal recorded as an ignore sticks", () => {
  const server = store(["Fin Smith", "Angel Perez"]);
  const mine = store(["Fin Smith"], {
    excluded: ["Angel Perez"],
    ignoredAt: { "angel perez": "2026-08-20T18:00:00.000Z" },
  });
  const out = rosterMerge(mine, server);
  assert.deepEqual(out.roster.map((a) => a.name), ["Fin Smith"]);
});

test("and sticks even when the other tab is the one that saves next", () => {
  /* The direction that matters: the removal was made here, and a manager who
     has never heard of it saves over the top. */
  const removed = store(["Fin Smith"], {
    excluded: ["Angel Perez"], ignoredAt: { "angel perez": "2026-08-20T18:00:00.000Z" },
  });
  const stale = store(["Fin Smith", "Angel Perez"]);
  const out = rosterMerge(stale, removed);
  assert.ok(!out.roster.some((a) => norm(a.name) === "angel perez"),
    "a tab that still holds them must not undo the removal by saving");
});

test("an old note that they were let back in does not resurrect them", () => {
  /* The stamps are compared, so a stale unignored from before the removal has to
     lose. The tool clears it for exactly this reason. */
  const server = store(["Fin Smith", "Angel Perez"], {
    unignored: { "angel perez": "2026-08-01T10:00:00.000Z" },
  });
  const mine = store(["Fin Smith"], {
    excluded: ["Angel Perez"], ignoredAt: { "angel perez": "2026-08-20T18:00:00.000Z" },
  });
  const out = rosterMerge(mine, server);
  assert.ok(!out.roster.some((a) => norm(a.name) === "angel perez"));
});

test("somebody genuinely let back in later is still let back in", () => {
  /* The stamp comparison has to work in both directions, or un-ignoring a real
     person becomes impossible. */
  const server = store([], { excluded: ["Angel Perez"], ignoredAt: { "angel perez": "2026-08-20T18:00:00.000Z" } });
  const mine = store(["Angel Perez"], { unignored: { "angel perez": "2026-08-21T09:00:00.000Z" } });
  const out = rosterMerge(mine, server);
  assert.ok(out.roster.some((a) => norm(a.name) === "angel perez"));
});

test("the tool writes the stamp, not just the filter", () => {
  /* Reads the apply step itself. The behaviour above cannot be exercised without
     a browser, so this holds the one line that connects them. */
  const apply = src.slice(src.indexOf("const apply = async () => {"),
                          src.indexOf("const groups = [[\"roster\""));
  assert.ok(apply.includes("out.ignoredAt[k] = t"), "removals must be stamped");
  assert.ok(apply.includes("out.excluded.push"), "and recorded on the ignore list");
  assert.ok(apply.includes("delete out.unignored[k]"), "and any older note clearing them removed");
  assert.ok(/goneNames\.has\(k\)/.test(apply), "and their figures must go with them");
});

test("the importer will not put an ignored name back", () => {
  /* The other half of staying gone. A daily import naming them would undo the
     whole repair by tomorrow morning otherwise. */
  const imp = src.slice(src.indexOf("const rosterKeys = new Set(next.roster.map"),
                        src.indexOf("setImportLog(log);"));
  assert.ok(imp.includes("if (excluded.has(key)) continue;"), "ignored names are skipped on import");
  const excl = src.slice(src.indexOf("const excluded = new Set(["), src.indexOf("\n", src.indexOf("const excluded = new Set([")));
  assert.ok(excl.includes("departedNames"), "and so are people marked departed");
});
