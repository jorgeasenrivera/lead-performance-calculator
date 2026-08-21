/**
 * Folding this browser's copy of a store into whatever the server now holds.
 * -------------------------------------------------------------------------
 * Every manager with a store open holds a copy of the whole document, and every
 * save is a read-change-write against a row that somebody else may have moved in
 * between. This is what settles the two copies, and it runs on every save
 * attempt including the retries, so a save that loses a race is re-applied
 * against the winner rather than overwriting it.
 *
 * ---- why this file exists at all ----
 * It lived in the middle of the app file, which meant it could not be imported,
 * which meant it could not be tested. The one test that covered any of it read
 * the app's source as text, cut the function body out with indexOf and rebuilt
 * it with `new Function`. That worked, and it is also why five separate bugs of
 * the same kind reached production here: a merge nobody can call is a merge
 * nobody checks.
 *
 * ---- the rule the bugs all broke ----
 * Several fields below are UNIONS, so that a stale tab cannot delete somebody by
 * simply not knowing about them. The cost of that is exact: an absence proves
 * nothing, so a plain removal is undone by the next save from any other tab and
 * the screen agrees with you for about five seconds.
 *
 * Every removal that has to survive is therefore written down as a stamped
 * decision — { key: when } — and the merge compares the stamps. Five things have
 * been caught by this: the ignore list, the plate log, the roster, the repair
 * tool, and most recently the figures themselves, where a name folded into its
 * real owner came back because the server's month was handed over whole.
 *
 * If you add a field here, decide which it is before you write the code. A field
 * with no rule does not fail loudly; it silently keeps whichever copy saved last.
 */
import { norm } from "./_report-parsers.mjs";
import { foldAliases } from "./_people-status.mjs";

/* A plate tag, compared the way a person would compare two of them: case and
   punctuation are not part of the tag. It lives here because the registry merge
   below is what needs it to tell one plate from another, and the app imports it
   from here rather than keeping its own copy — the last four times something in
   this system existed in two copies, the two copies disagreed. */
export const normTag = (t) => String(t || "").toUpperCase().replace(/[^A-Z0-9]/g, "");

/* ---- Merging the plate log ----
   The plate log is the most contended thing in the document: several managers work
   one shared day at once, and unlike the month figures there is no import to arrive
   later and put it right. These four helpers are what let two people log a plate in
   the same minute without either one disappearing.

   Deletions are tombstones — { id: when } — for the same reason a departure is a
   record rather than a gap. A browser that never knew about a plate and a browser
   that deleted it look identical if all you compare is presence, and the merge has
   to be able to tell them apart or every delete comes back. They are pruned at
   ninety days, by which point no tab is old enough to re-add anything. */
export const TOMB_DAYS = 90;
export function mergeTombstones(mine, theirs) {
  const out = { ...(mine || {}) };
  for (const [id, t] of Object.entries(theirs || {})) if (!out[id] || t > out[id]) out[id] = t;
  const cutoff = new Date(Date.now() - TOMB_DAYS * 864e5).toISOString();
  for (const id of Object.keys(out)) if (!out[id] || out[id] < cutoff) delete out[id];
  return out;
}
// The last thing that happened to this plate. History is append-only, so the copy
// with more events has seen everything the other one has, and then some.
function plateTouch(p) {
  let t = (p && p.takenAt) || "";
  for (const e of (p && p.history) || []) if (e && e.t && e.t > t) t = e.t;
  return t;
}
function newerPlate(a, b) {
  const ha = ((a && a.history) || []).length, hb = ((b && b.history) || []).length;
  if (ha !== hb) return ha > hb ? a : b;
  return plateTouch(b) > plateTouch(a) ? b : a;
}
export function mergePlateDays(next, serverCopy) {
  const mine = next.plates || {}, srv = serverCopy.plates || {};
  const dead = mergeTombstones(next.plateGone, serverCopy.plateGone);
  const out = {};
  for (const day of new Set([...Object.keys(mine), ...Object.keys(srv)])) {
    const byId = new Map();
    for (const p of mine[day] || []) if (p && p.id) byId.set(p.id, p);
    for (const p of srv[day] || []) {
      if (!p || !p.id) continue;
      const have = byId.get(p.id);
      byId.set(p.id, have ? newerPlate(have, p) : p);
    }
    const list = [...byId.values()].filter((p) => !dead[p.id]);
    if (list.length) out[day] = list;
  }
  return out;
}
/* The master list was not merged at all: the client's array replaced the server's
   outright, so a manager adding the plate drawer in one store while another manager
   saved anything at all in the same store lost the lot. Union by id, and settle a
   collision the same way — whoever touched it last. */
export function mergePlateRegistry(next, serverCopy) {
  const dead = mergeTombstones(next.plateRegGone, serverCopy.plateRegGone);
  const at = (r) => (r && (r.updatedAt || r.addedAt)) || "";
  const byId = new Map();
  for (const r of next.plateRegistry || []) if (r && r.id) byId.set(r.id, r);
  for (const r of serverCopy.plateRegistry || []) {
    if (!r || !r.id) continue;
    const have = byId.get(r.id);
    byId.set(r.id, have ? (at(r) > at(have) ? r : have) : r);
  }
  const all = [...byId.values()].filter((r) => !dead[r.id])
    .sort((a, b) => String(a.addedAt || "").localeCompare(String(b.addedAt || "")));
  /* Two managers adding the same plate in the same minute made two entries with two
     ids. One plate, one row: keep the older, because its id is the one any records
     already written point at. */
  const out = [], tags = new Set();
  for (const r of all) {
    const T = normTag(r.tag);
    if (T && tags.has(T)) continue;
    if (T) tags.add(T);
    out.push(r);
  }
  return out;
}

/* Fold this browser's pending document into whatever the server currently holds.
   Run on every save attempt, including retries, so a save that loses a race is
   re-applied against the winner's copy rather than overwriting it. */
export function mergeAgainstServer(next, serverCopy) {
  if (!serverCopy || typeof serverCopy !== "object") return next;
  /* If these two documents are not the same store, merging them would blend two
     rosters into one, which is exactly the damage this is meant to prevent. Return
     the client copy untouched and let the caller's guard reject the save. */
  if (next.__storeId && serverCopy.__storeId && next.__storeId !== serverCopy.__storeId) {
    console.error("refused cross-store merge", next.__storeId, serverCopy.__storeId);
    return next;
  }
        const mergeField = (field) => {
          const out = { ...(next[field] || {}) };
          const srv = serverCopy[field] || {};
          for (const k of Object.keys(srv)) if (!(k in out)) out[k] = srv[k];
          return out;
        };
        next.months = mergeField("months");
        next.activity = mergeField("activity");

        /* ---- The stale-tab problem ----
           mergeField only fills in keys the client is missing. For months that is
           useless: a browser opened this morning already HAS "2026-08", so its
           hours-old copy of the month wins and every auto-import since is wiped.
           This is why one store's uploads kept vanishing while quieter stores were
           fine, and it fires hardest right after a deploy, when tabs are still
           running older code that never polled at all.

           The import log settles it. If the server has an import this browser has
           never seen, then this browser's month and activity are definitionally
           behind, and the server's copy is the one to keep. If OUR change is the
           import, ours is the newest entry and ours wins. */
        const newestImport = (d) => {
          const log = (d && d.importLog) || [];
          let t = "";
          for (const e of log) if (e && e.t && e.t > t) t = e.t;
          return t;
        };
        if (newestImport(serverCopy) > newestImport(next)) {
          next.months = serverCopy.months || next.months;
          next.activity = serverCopy.activity || next.activity;
          next.activitySnaps = serverCopy.activitySnaps || next.activitySnaps;
        }
        /* ---- names somebody has already folded away ----
           Both branches above hand back figures this browser did not write, and
           the server's copy still has every mangled spelling in it: "Alejandro
           Diaz Visit" beside Alejandro Diaz. Merging the name was undone within
           seconds, over and over, because the fold lived only in the copy that
           had just been replaced.

           Who somebody is, is a decision, and it survives the same way every
           other decision here does: it is written down and re-applied, rather
           than being a deletion and hoping nothing hands the name back. The
           aliases are a union first, so a tab that has never heard of the fold
           cannot drop it either. */
        next.aliases = { ...(serverCopy.aliases || {}), ...(next.aliases || {}) };
        foldAliases(next);
        // The log itself is a union: no entry from either side should disappear.
        {
          const seen = new Set();
          const all = [...(next.importLog || []), ...(serverCopy.importLog || [])]
            .filter((e) => e && e.id && !seen.has(e.id) && seen.add(e.id))
            .sort((a, b) => String(b.t || "").localeCompare(String(a.t || "")))
            .slice(0, 200);
          next.importLog = all;
        }

        /* ---- People ----
           Roster and departed were never merged at all, which is why someone marked
           as gone kept coming back: any older tab still held a roster with them on
           it and a departed list without them, and its next save undid the change.
           Departed is a union, and it always wins over the roster: being taken off
           is a decision somebody made, and no stale copy should be able to reverse
           it by simply not knowing about it. */
        {
          /* Bringing somebody back was the same trap as un-ignoring a name: the
             union re-added them from the server copy, they came off the roster
             again on the next merge, and no amount of clicking could reverse it.
             A return to the floor is a decision with a time on it. */
          next.returned = mergeTombstones(next.returned, serverCopy.returned);
          const byName = new Map();
          for (const d of [...(serverCopy.departed || []), ...(next.departed || [])]) {
            // Same rule, and the departure record already carries its own time: they
            // are gone unless they were brought back after they left.
            if (d && d.name && !((next.returned[norm(d.name)] || "") > (d.at || ""))) byName.set(norm(d.name), d);
          }
          next.departed = [...byName.values()];
          const gone = new Set(byName.keys());

          /* Ignored names are a decision too, and they are a union for the same
             reason departures are: an older tab that has never heard of the
             decision must not be able to reverse it by simply not knowing.

             But a union alone can only ever ADD, which made taking a name back off
             the ignore list impossible: the save arrived without the name, the
             server copy still had it, and the union put it straight back — every
             time, on every browser. Undoing is a decision as well, so it is
             recorded as one and the union subtracts it. Re-ignoring the same name
             lifts the mark, which is what makes the pair work in both directions
             however many times somebody changes their mind. */
          next.ignoredAt = mergeTombstones(next.ignoredAt, serverCopy.ignoredAt);
          next.unignored = mergeTombstones(next.unignored, serverCopy.unignored);
          /* Which of the two decisions was made last. Deleting the other one instead
             would not survive its own merge — the other browser still holds it and
             the union puts it back, which is the same trap one level up. A name with
             no stamps at all predates this and stays ignored, which is what it has
             always done. */
          const onList = (n) => !((next.unignored[norm(n)] || "") > (next.ignoredAt[norm(n)] || ""));
          next.excluded = [...(next.excluded || []), ...(serverCopy.excluded || [])]
            .filter((x, i, arr) => arr.findIndex((y) => norm(y) === norm(x)) === i)
            .filter(onList);
          const ignored = new Set(next.excluded.map(norm));

          const roster = [...(next.roster || [])];
          const have = new Set(roster.map((a) => norm(a.name)));
          for (const a of serverCopy.roster || []) {
            if (a && a.name && !have.has(norm(a.name))) { roster.push(a); have.add(norm(a.name)); }
          }
          // Anyone gone or ignored comes out, whichever copy they arrived from.
          next.roster = roster.filter((a) => !gone.has(norm(a.name)) && !ignored.has(norm(a.name)));

          /* ---- names a report brought that nobody has claimed yet ----
             The email import writes these on the server. A browser opened before
             that has never heard of them, and without this its copy wins and the
             held figures are gone — which is the one thing this feature promised
             not to do.

             A union, then: both copies' held people, and their figures added
             together per month and per day rather than one overwriting the other,
             because two reports can each hold a piece of the same person.

             The removal needs no tombstone of its own. Claiming or rejecting
             somebody puts them on the roster or the ignore list, and both of
             those already survive a merge — so "still waiting" is simply
             "in neither", worked out after those are settled. A decision made in
             one tab cannot be undone by another that never saw it. */
          const heldOut = { ...(next.pendingPeople || {}) };
          for (const [k, v] of Object.entries(serverCopy.pendingPeople || {})) {
            const mine = heldOut[k];
            if (!mine) { heldOut[k] = v; continue; }
            heldOut[k] = {
              ...v, ...mine,
              files: [...new Set([...(mine.files || []), ...(v.files || [])])],
              months: { ...(v.months || {}), ...(mine.months || {}) },
              days: { ...(v.days || {}), ...(mine.days || {}) },
            };
          }
          const settled = new Set([
            ...next.roster.map((a) => norm(a.name)),
            ...next.excluded.map(norm),
            ...(next.departed || []).map((d) => norm(d && d.name)),
          ]);
          for (const k of Object.keys(heldOut)) if (settled.has(k)) delete heldOut[k];
          next.pendingPeople = heldOut;
        }
        /* ---- The plate log ----
           This used to be mergeField("plates"), which fills in whole DAYS the client
           is missing. That is no protection at all for the way the log is actually
           worked: every manager on the floor is writing to the same day — today —
           so their day keys always collide, the client's array wins whole, and the
           plate somebody logged out thirty seconds ago is gone. Retrying does not
           help either, because the retry re-runs the same merge.

           So merge the ENTRIES, and settle a collision with the entry's own history:
           it is append-only, so more events means later. Removals are recorded as
           tombstones rather than as an absence, because an absence is exactly what
           a browser that has never heard of the plate also looks like. */
        next.plates = mergePlateDays(next, serverCopy);
        next.plateRegistry = mergePlateRegistry(next, serverCopy);
        next.plateGone = mergeTombstones(next.plateGone, serverCopy.plateGone);
        next.plateRegGone = mergeTombstones(next.plateRegGone, serverCopy.plateRegGone);
        /* How the store runs plates is one setting for the whole floor, so it is the
           one thing here that cannot be merged — somebody has to win. Whoever set it
           last does, which means a tab that has been open since before the change
           cannot quietly put the store back on the old footing. */
        if ((serverCopy.plateModeAt || "") > (next.plateModeAt || "")) {
          next.plateMode = serverCopy.plateMode;
          next.plateModeAt = serverCopy.plateModeAt;
        }
        // The schedule was the worst case of this. A browser that had been open since
        // before an upload carried an empty daysOff, and saving anything at all wiped
        // the month for everybody. Each person now carries the time their off-days
        // were last written, and whichever side wrote last is the one kept.
        {
          const mine = { ...(next.daysOff || {}) };
          const mineAt = { ...(next.daysOffAt || {}) };
          const srv = serverCopy.daysOff || {};
          const srvAt = serverCopy.daysOffAt || {};
          for (const id of Object.keys(srv)) {
            const theirs = srvAt[id] || "";
            const ours = mineAt[id] || "";
            if (!(id in mine) || theirs > ours) { mine[id] = srv[id]; mineAt[id] = theirs || ours; }
          }
          next.daysOff = mine;
          next.daysOffAt = mineAt;
        }
  return next;
}
