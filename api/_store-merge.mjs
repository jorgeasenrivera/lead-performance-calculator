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

/* =========================================================================
   Settling a keyed field by stamps.

   The seven fields that had no rule are all shaped the same way: a map keyed by
   associate, or by day and associate, that one manager edits while another
   manager edits a different entry in it. Replacing the whole map — which is what
   not merging it amounts to — means the second save silently drops the first
   manager's work.

   A stamp per key fixes both directions at once. The later write wins, and an
   absence with a newer stamp is a deletion rather than ignorance, which is the
   distinction this system has failed to draw five times.
   ========================================================================= */

/** One level: { key: value } settled against { key: when }. */
export function mergeStampedMap(mine, mineAt, theirs, theirsAt) {
  const vals = {}, at = {};
  const mv = mine || {}, tv = theirs || {}, ma = mineAt || {}, ta = theirsAt || {};
  for (const k of new Set([...Object.keys(mv), ...Object.keys(tv), ...Object.keys(ma), ...Object.keys(ta)])) {
    const mt = ma[k] || "", tt = ta[k] || "";
    let take;
    if (mt > tt) take = "mine";
    else if (tt > mt) take = "theirs";
    /* Neither side has said when, so neither is claiming to have changed it and
       an absence proves nothing. Keep whatever exists — this is data written
       before stamps, and it must not be deleted by the arrival of them. */
    else take = (k in mv) ? "mine" : "theirs";
    const src = take === "mine" ? mv : tv;
    if (k in src) vals[k] = src[k];
    const stamp = mt > tt ? mt : tt;
    if (stamp) at[k] = stamp;
  }
  return { vals, at };
}

/** Two levels: { day: { key: value } } against { day: { key: when } }. */
export function mergeStampedDayMap(mine, mineAt, theirs, theirsAt, cutoff = "") {
  const vals = {}, at = {};
  const mv = mine || {}, tv = theirs || {}, ma = mineAt || {}, ta = theirsAt || {};
  for (const day of new Set([...Object.keys(mv), ...Object.keys(tv), ...Object.keys(ma), ...Object.keys(ta)])) {
    const one = mergeStampedMap(mv[day], ma[day], tv[day], ta[day]);
    if (Object.keys(one.vals).length) vals[day] = one.vals;
    // Days older than the window keep their marks and drop their stamps: no tab
    // is old enough to argue about them, and the stamps are the part that grows.
    if (Object.keys(one.at).length && (!cutoff || day >= cutoff)) at[day] = one.at;
  }
  return { vals, at };
}

/** Two levels, fill only: nothing is overwritten and nothing is removed. */
export function mergeFillTwoLevel(mine, theirs) {
  const out = {};
  for (const [day, row] of Object.entries(theirs || {})) out[day] = { ...(row || {}) };
  for (const [day, row] of Object.entries(mine || {})) out[day] = { ...(out[day] || {}), ...(row || {}) };
  return out;
}

/* =========================================================================
   What happens to each field when two copies of a store meet.

   The register of rules, one row per field. It exists because the thing that
   went wrong five times was never a hard question badly answered — it was a
   field whose rule nobody had decided, behaving the way the code happened to
   fall out. A field with no rule does not fail loudly. It silently keeps
   whichever copy saved last, and you find out weeks later when a manager says
   the name came back.

   This is a register, not the engine: the merge below is still written out
   longhand, because rewriting it as a loop over this table would risk the one
   function in the system that corrupts data rather than throwing when it is
   wrong. A table that only describes code is exactly the kind of second copy
   this codebase keeps being bitten by, so it is tied to the code instead of
   trusted:

     test/merge-policy.test.mjs reads the merge's own source, and every field it
     assigns must appear here, every field here must be one the merge assigns or
     one the importer counts as part of a store, and anything marked clientWins
     must be a field the merge genuinely does not touch.

   So a wrong row fails the build rather than misleading the next person.
   ========================================================================= */

/** The rules a field is allowed to have. Adding one means teaching the guard. */
export const STRATEGIES = {
  newestImportWins: "The import log settles it. A browser holding an hours-old month must not overwrite the imports since, so if the server has an import this copy has never seen, the server's is kept whole.",
  tombstones: "A stamped decision, { key: when }, newest wins, pruned at ninety days. The only form of removal this system has ever been able to keep.",
  stampedUnion: "A union, so a stale tab cannot delete somebody by not knowing about them, minus whatever the stamps say has since been undone.",
  perEntryNewest: "Merged entry by entry rather than wholesale, because several managers write the same day at once. A collision is settled by the entry's own history.",
  perKeyNewest: "Each key carries the time it was last written, and the later write wins. Whole-object replacement wiped the month for everybody.",
  newestStampWins: "One setting for the whole floor, so somebody has to win: whoever set it last.",
  unionById: "Nothing from either side disappears; entries are deduplicated by id.",
  heldUnion: "Union, with each side's pieces of the same held person added together, minus anyone since settled.",
  aliasesThenFold: "Union first so no tab can drop a fold, then the fold is carried out again over whatever the figures now say.",
  stampedMap: "A map keyed by person, settled key by key against a stamp. An absence with a newer stamp is a removal rather than ignorance, which is the distinction this system has failed to draw five times.",
  stampedDayMap: "The same, one level deeper: day, then person. Stamps outside the ninety-day window are dropped, since no tab is old enough to argue about them.",
  fillOnly: "Gaps filled, nothing overwritten and nothing removed. For a field nothing writes any more.",
  deadField: "Nothing reads it and nothing writes it. Not merged on purpose, and the data is left alone rather than deleted, because deleting it would gain nothing and cannot be undone.",
  clientWins: "NOT MERGED. This copy is written over the server's whole. A concurrent change by another manager is silently lost. Every one of these is a gap, not a decision.",
};

export const FIELD_POLICY = {
  // ---- the figures ----
  months:        { how: "newestImportWins", why: "Reports arrive hourly and a stale tab must not undo them." },
  activity:      { how: "newestImportWins", why: "Travels with months; the same import writes both." },
  activitySnaps: { how: "newestImportWins", why: "Travels with months." },
  aliases:       { how: "aliasesThenFold", why: "Who somebody is, is a decision. It survived being deleted but not being handed back with the server's month." },

  // ---- who the store's people are ----
  roster:        { how: "stampedUnion", why: "Union minus the departed and the ignored, so a removal needs a stamp behind it." },
  departed:      { how: "stampedUnion", why: "Leaving is a decision with a time on it; being brought back is another." },
  excluded:      { how: "stampedUnion", why: "The ignore list, settled against ignoredAt and unignored." },
  ignoredAt:     { how: "tombstones", why: "When a name was marked as not one of this store's people." },
  unignored:     { how: "tombstones", why: "And when that was lifted. The pair is what lets somebody change their mind twice." },
  returned:      { how: "tombstones", why: "When a leaver came back, so the departed union cannot bury it." },
  pendingPeople: { how: "heldUnion", why: "Two reports can each hold half of the same unclaimed person." },

  // ---- the plate log, the most contended thing in the document ----
  plates:        { how: "perEntryNewest", why: "Every manager on the floor writes today's day key at once." },
  plateRegistry: { how: "perEntryNewest", why: "Same, and two managers adding one plate made two entries." },
  plateGone:     { how: "tombstones", why: "A browser that never knew a plate and one that deleted it look identical." },
  plateRegGone:  { how: "tombstones", why: "Same, for the registry." },
  plateMode:     { how: "newestStampWins", why: "How the store runs plates is one setting for the whole floor." },
  plateModeAt:   { how: "newestStampWins", why: "The stamp plateMode is judged by." },

  // ---- the rest ----
  importLog:     { how: "unionById", why: "It is the evidence months and activity are judged by, so it must lose nothing." },
  daysOff:       { how: "perKeyNewest", why: "An empty schedule from an old tab used to wipe the month for everybody." },
  daysOffAt:     { how: "perKeyNewest", why: "The per-person stamp that made that possible." },

  /* ---- the seven that used to have no rule ----
     Each is a map or a list that one manager edits while another edits a
     different entry in it, and until now the whole thing was replaced wholesale.
     Jorge asked for these specifically: many managers across many stores and
     many reps, all on one system at once. */
  restrictions:  { how: "stampedMap", why: "Per associate, and liftable, so an absence with a newer stamp has to read as taken off rather than never heard of." },
  restrictionsAt:{ how: "stampedMap", why: "The stamps restrictions is settled by." },
  goals:         { how: "stampedMap", why: "An individual's monthly goal, keyed by associate and set under coaching. The STORE's goal is not here: it lives on the store in config." },
  goalsAt:       { how: "stampedMap", why: "The stamps goals is settled by." },
  baselines:     { how: "stampedMap", why: "Per person, seeded from history, and every coaching target is built from it. Re-seeding is warned about; losing a seed to another tab would be the same damage without the warning." },
  baselinesAt:   { how: "stampedMap", why: "The stamps baselines is settled by." },
  qualified:     { how: "stampedDayMap", why: "The RockEd mark, per day per person. Two managers marking two different people on the same morning is the ordinary case." },
  qualifiedAt:   { how: "stampedDayMap", why: "The stamps qualified is settled by, pruned outside the ninety-day window." },
  stars:         { how: "fillOnly", why: "The old form of the RockEd mark. Nothing writes it any more — tapping the new control deletes the old value — and it is only read so old months keep scoring. So it may shrink and never grow." },
  statsExcluded: { how: "stampedUnion", why: "Who is out of the store's benchmark averages. A list, so a union like the ignore list, and putting somebody back into the averages is stamped rather than filtered." },
  statsExcludedAt: { how: "tombstones", why: "When somebody was taken out of the averages. Half of a pair: one stamp alone could only ever say it once, so re-excluding after a re-inclusion could never win." },
  statsExcludedGone: { how: "tombstones", why: "And when they were put back in. The two are compared by time, so the decision can be changed as often as somebody changes their mind." },
  repeatFlags:   { how: "deadField", why: "Every reference in the app and the pipeline is copy-through: nothing reads a value out of it and nothing writes one in. Left alone rather than merged or deleted." },
};

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

        /* ---- the seven that had no rule at all ----
           Until now the client's whole copy of each of these won, so two
           managers changing different entries at the same moment meant one of
           them lost their work with no error and nothing written down. With many
           managers across many stores on one system, that is not a rare race. */
        {
          const cutoff = new Date(Date.now() - TOMB_DAYS * 864e5).toISOString().slice(0, 10);
          /* Per associate, written out one at a time rather than looped over a list
             of field names. The loop was shorter, and the check that reads this
             file could not see through it: a computed next[field] is not a field
             as far as anything reading the source can tell, so three fields
             silently stopped being covered by the very guard meant to cover them.
             Explicit is what makes that guard work. */
          // A restriction can be lifted, so an absence with a newer stamp has to
          // read as "taken off" rather than "never heard of".
          {
            const r = mergeStampedMap(next.restrictions, next.restrictionsAt,
                                      serverCopy.restrictions, serverCopy.restrictionsAt);
            next.restrictions = r.vals;
            next.restrictionsAt = r.at;
          }
          {
            const r = mergeStampedMap(next.goals, next.goalsAt, serverCopy.goals, serverCopy.goalsAt);
            next.goals = r.vals;
            next.goalsAt = r.at;
          }
          {
            const r = mergeStampedMap(next.baselines, next.baselinesAt,
                                      serverCopy.baselines, serverCopy.baselinesAt);
            next.baselines = r.vals;
            next.baselinesAt = r.at;
          }
          /* The RockEd mark, per day per person. Two managers marking two
             different people on the same morning is the ordinary case. */
          const q = mergeStampedDayMap(next.qualified, next.qualifiedAt,
                                       serverCopy.qualified, serverCopy.qualifiedAt, cutoff);
          next.qualified = q.vals;
          next.qualifiedAt = q.at;
          /* The star counts are the old form of that mark and nothing writes them
             any more — tapping the new control deletes the old value. They are
             only still read so that old months keep scoring, so this fills gaps
             and never overwrites: the field can shrink, never grow. */
          next.stars = mergeFillTwoLevel(next.stars, serverCopy.stars);
          /* Who is out of the store's benchmark averages. A list, so it is a
             union like the ignore list, and for the same reason: an absence is
             also what a browser that never heard of the name looks like.
             Taking somebody back into the averages is therefore stamped. */
          /* A stamped PAIR, exactly like the ignore list above, and for a reason
             worth writing down: the first version of this kept only the removal
             stamp. Taking somebody back into the averages stuck, and putting them
             out again afterwards could never win — the removal stamp was unioned
             back from the other tab every time. One-sided tombstones can only say
             a thing once. Two stamps compared by time can be changed as often as
             somebody changes their mind. */
          next.statsExcludedAt = mergeTombstones(next.statsExcludedAt, serverCopy.statsExcludedAt);
          next.statsExcludedGone = mergeTombstones(next.statsExcludedGone, serverCopy.statsExcludedGone);
          const stillOut = (n) =>
            !((next.statsExcludedGone[norm(n)] || "") > (next.statsExcludedAt[norm(n)] || ""));
          const seen = new Set();
          next.statsExcluded = [...(next.statsExcluded || []), ...(serverCopy.statsExcluded || [])]
            .filter((n) => {
              const k = norm(n);
              if (!k || seen.has(k)) return false;
              seen.add(k);
              return stillOut(n);
            });
        }
        /* repeatFlags is deliberately absent: it is dead. Every reference in the
           app and the pipeline is copy-through, nothing reads a value out of it
           and nothing writes one in. Merging it would be inventing a rule for
           something with no behaviour to protect. */
  return next;
}
