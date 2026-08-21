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
/* The merge itself, imported. This used to read the app's source as text, cut the
   roster half out with indexOf and rebuild it with `new Function`, because the
   merge lived in the middle of a 26k-line component and there was no other way to
   reach it. That hack is gone: the merge is a module now, and these run against
   the real thing rather than a slice of it that could go stale without saying so. */
import fs from "node:fs";
import path from "node:path";
import { norm } from "../api/_report-parsers.mjs";
import { mergeAgainstServer } from "../api/_store-merge.mjs";

const ROOT = new URL("..", import.meta.url).pathname;
/* Still read as text, and rightly so: the three checks at the bottom are about
   the repair tool and the importer, which do live in the app file. Only the
   merge moved out. */
const src = fs.readFileSync(path.join(ROOT, "src/LeadPerformanceCalculator.jsx"), "utf8");

const rosterMerge = (next, serverCopy) =>
  mergeAgainstServer(JSON.parse(JSON.stringify(next)), serverCopy);

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
  const excl = src.slice(src.indexOf("const excluded = new Set(["), src.indexOf("\n", src.indexOf("const excluded = new Set([")));
  assert.ok(excl.includes("next.excluded"), "ignored names are dropped before anything is written");
  assert.ok(excl.includes("departedNames"), "and so are people marked departed");
});

test("and it will not add an unrecognised one either", () => {
  /* The gate. Both paths, because the emailed one is the path reports actually
     arrive by and nobody re-imports by hand — and because the last four times
     one of these existed in two copies, the two copies disagreed. */
  const server = fs.readFileSync(path.join(ROOT, "api/ingest.mjs"), "utf8");
  for (const [where, text] of [["the app", src], ["the pipeline", server]]) {
    assert.ok(/const openDoor = admitsEveryone\(next\)/.test(text), `${where} does not check the people list`);
    assert.ok(/holdPerson\(next,/.test(text), `${where} does not hold an unknown name`);
    assert.ok(/if \(openDoor\) \{/.test(text), `${where} adds names outside the empty-store case`);
  }
});

// ---- names a report brought that nobody has claimed yet ----
const withHeld = (roster, held, extra = {}) => ({
  roster: roster.map((n, i) => ({ id: "a" + i, name: n, roleId: "sales" })),
  excluded: [], departed: [], ignoredAt: {}, unignored: {}, returned: {},
  pendingPeople: held, ...extra,
});

test("held names survive a save from a tab that never saw them", () => {
  /* The email import writes these on the server. A browser opened before that
     has never heard of them, and without the merge its copy wins and the held
     figures are gone — the one thing this feature promised not to do. */
  const server = withHeld(["Fin Smith"], {
    "vernon johnson": { name: "Vernon Johnson", files: ["r1.pdf"], months: { "2026-08": { internetUnits: 5 } }, days: {} },
  });
  const stale = withHeld(["Fin Smith"], {});
  const out = rosterMerge(stale, server);
  assert.ok(out.pendingPeople["vernon johnson"], "the held person is still held");
  assert.equal(out.pendingPeople["vernon johnson"].months["2026-08"].internetUnits, 5);
});

test("two reports each holding a piece of the same person add up", () => {
  const server = withHeld(["Fin Smith"], {
    "vernon johnson": { name: "Vernon Johnson", files: ["r1.pdf"], months: { "2026-07": { internetUnits: 2 } }, days: { "2026-07-30": { calls: 4 } } },
  });
  const mine = withHeld(["Fin Smith"], {
    "vernon johnson": { name: "Vernon Johnson", files: ["r2.pdf"], months: { "2026-08": { internetUnits: 5 } }, days: { "2026-08-19": { calls: 9 } } },
  });
  const out = rosterMerge(mine, server);
  const v = out.pendingPeople["vernon johnson"];
  assert.deepEqual(Object.keys(v.months).sort(), ["2026-07", "2026-08"], "neither month overwrites the other");
  assert.equal(Object.keys(v.days).length, 2);
  assert.deepEqual(v.files.sort(), ["r1.pdf", "r2.pdf"]);
});

test("claiming somebody in one tab is not undone by another that never saw it", () => {
  /* The removal needs no tombstone of its own: being on the roster is the record,
     and that already survives. */
  const stale = withHeld(["Fin Smith"], {
    "vernon johnson": { name: "Vernon Johnson", files: [], months: {}, days: {} },
  });
  const claimed = withHeld(["Fin Smith", "Vernon Johnson"], {});
  assert.equal(rosterMerge(claimed, stale).pendingPeople["vernon johnson"], undefined,
    "claimed here, and a stale server copy does not put them back in the queue");
  assert.equal(rosterMerge(stale, claimed).pendingPeople["vernon johnson"], undefined,
    "and not the other way round either");
});

test("rejecting somebody is not undone either", () => {
  const stale = withHeld(["Fin Smith"], {
    "vernon johnson": { name: "Vernon Johnson", files: [], months: {}, days: {} },
  });
  const rejected = withHeld(["Fin Smith"], {}, {
    excluded: ["Vernon Johnson"], ignoredAt: { "vernon johnson": "2026-08-20T18:00:00.000Z" },
  });
  assert.equal(rosterMerge(rejected, stale).pendingPeople["vernon johnson"], undefined);
  assert.equal(rosterMerge(stale, rejected).pendingPeople["vernon johnson"], undefined);
});

// ---- a merged misspelling that would not stay merged ----
import { sameAs } from "../api/_people-status.mjs";

test("folding a misspelling away survives the merge", () => {
  /* Reported from a live floor: "Angel Perez Angel Perez → Angel Perez", merge,
     and the card is back a few seconds later. The ignore list is a union across
     every open tab, so removing the misspelling with a plain filter was undone
     by the first save from anywhere else.

     Same trap as the repair tool, the roster editor and the import screen. It got
     in here because sameAs was written as a fold rather than as a change of
     standing, and a fold does not think about other people's tabs. */
  const server = {
    roster: [{ id: "a1", name: "Angel Perez", roleId: "sales" }],
    excluded: ["Angel Perez Angel Perez"],
    ignoredAt: { "angel perez angel perez": "2026-08-01T00:00:00.000Z" },
    unignored: {}, returned: {}, departed: [], months: {}, activity: {},
  };
  const merged = sameAs(server, "Angel Perez Angel Perez", "Angel Perez",
    { at: "2026-08-21T12:00:00.000Z" });
  assert.ok(!merged.excluded.some((x) => /angel perez angel/i.test(x)), "gone from the list");

  const out = rosterMerge(merged, server);
  assert.ok(!out.excluded.some((x) => /angel perez angel/i.test(x)),
    "and still gone after a tab that never saw the merge saves over the top");
});

test("and the same, whichever tab saves last", () => {
  const stale = {
    roster: [{ id: "a1", name: "Angel Perez", roleId: "sales" }],
    excluded: ["Angel Perez Angel Perez"],
    ignoredAt: { "angel perez angel perez": "2026-08-01T00:00:00.000Z" },
    unignored: {}, returned: {}, departed: [], months: {}, activity: {},
  };
  const merged = sameAs(stale, "Angel Perez Angel Perez", "Angel Perez",
    { at: "2026-08-21T12:00:00.000Z" });
  assert.ok(!rosterMerge(stale, merged).excluded.some((x) => /angel perez angel/i.test(x)),
    "a stale tab saving must not resurrect it either");
});

test("a misspelling on the departed list goes the same way", () => {
  const server = {
    roster: [{ id: "a1", name: "Angel Perez", roleId: "sales" }],
    departed: [{ id: "a9", name: "Angel Perez Angel Perez", at: "2026-08-01T00:00:00.000Z" }],
    excluded: [], ignoredAt: {}, unignored: {}, returned: {}, months: {}, activity: {},
  };
  const merged = sameAs(server, "Angel Perez Angel Perez", "Angel Perez",
    { at: "2026-08-21T12:00:00.000Z" });
  const out = rosterMerge(merged, server);
  assert.ok(!out.departed.some((d) => /angel perez angel/i.test(d.name)));
  assert.ok(!out.roster.some((a) => /angel perez angel/i.test(a.name)));
});

test("somebody genuinely ignored is still ignored afterwards", () => {
  /* The stamps must not become a way to quietly un-ignore the rest of the list. */
  const server = {
    roster: [{ id: "a1", name: "Angel Perez", roleId: "sales" }],
    excluded: ["Angel Perez Angel Perez", "Round Robin"],
    ignoredAt: { "angel perez angel perez": "2026-08-01T00:00:00.000Z",
                 "round robin": "2026-06-01T00:00:00.000Z" },
    unignored: {}, returned: {}, departed: [], months: {}, activity: {},
  };
  const out = rosterMerge(sameAs(server, "Angel Perez Angel Perez", "Angel Perez", {}), server);
  assert.ok(out.excluded.some((x) => x === "Round Robin"), "Round Robin is untouched");
});
