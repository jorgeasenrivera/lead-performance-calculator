/**
 * Somebody's standing at a store, and changing it.
 * -------------------------------------------------------------------------
 * A store's people were three separate lists — the roster, the departed list and
 * the ignore list — and changing somebody's standing meant editing whichever
 * ones applied, by hand, at whichever screen you happened to be on. There were
 * three places that did it and all three did it differently. Two of them were
 * quietly broken in the same way, which is how a dealership's people survived
 * being removed from a store they had never worked at.
 *
 * ---- why a removal has to be WRITTEN DOWN ----
 * The store document is merged, not overwritten: every manager with the store
 * open holds a copy, and the roster merge is a union so that a stale tab cannot
 * delete somebody by simply not knowing about them. The same union means an
 * absence proves nothing. Take a name out and the next save from any other tab
 * puts it back, and the screen agrees with you for about five seconds.
 *
 * So every change here leaves a stamp, and the stamps are compared by time. That
 * is the only form of removal this system has ever been able to keep.
 *
 * ---- the three standings ----
 *   active     on the floor and counted
 *   departed   left. Their cars stay in the month they sold them, because the
 *              store did sell them — a month that loses a leaver's deliveries
 *              reads as 84.5 where 85 were delivered
 *   ignored    not one of this store's people at all: a duplicate, a heading a
 *              parser mistook for a person, or somebody another dealership's
 *              report brought in. Their figures go, because the store never
 *              earned them and they are inflating its totals
 *
 * The difference between the last two is the whole point of having both. One is
 * a person; the other is a mistake.
 */

export const STATUSES = ["active", "departed", "ignored"];

const nm = (s) => (s || "").trim().toLowerCase().replace(/\s+/g, " ");

/** What a store currently says about somebody. */
export function statusOf(data, name) {
  const k = nm(name);
  if ((data.excluded || []).some((x) => nm(x) === k)) return "ignored";
  if ((data.departed || []).some((d) => d && nm(d.name) === k)) return "departed";
  if ((data.roster || []).some((a) => nm(a.name) === k)) return "active";
  return "unknown";
}

/** Everyone the store has any record of, whatever their standing. */
export function everyone(data) {
  const out = new Map();
  const put = (name, extra) => {
    const k = nm(name);
    if (!k) return;
    out.set(k, { key: k, name, ...(out.get(k) || {}), ...extra });
  };
  for (const a of data.roster || []) put(a.name, { id: a.id, roleId: a.roleId, hiredAt: a.hiredAt || null, aka: a.aka || [] });
  for (const d of data.departed || []) if (d && d.name) put(d.name, { departedAt: d.at || null, roleId: d.roleId ?? undefined });
  for (const x of data.excluded || []) put(x, {});
  for (const [k, v] of out) v.status = statusOf(data, v.name), out.set(k, v);
  return [...out.values()].sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Move people to a standing. Returns a changed copy; the caller saves it.
 *
 * Every list and every stamp that the change implies, in one place, so that the
 * screens cannot disagree about what "departed" does.
 */
export function setStatus(data, names, status, opts = {}) {
  if (!STATUSES.includes(status)) return data;
  const at = opts.at || new Date().toISOString();
  const by = opts.by || "";
  const next = JSON.parse(JSON.stringify(data || {}));
  next.roster = next.roster || [];
  next.departed = next.departed || [];
  next.excluded = next.excluded || [];
  next.ignoredAt = next.ignoredAt || {};
  next.unignored = next.unignored || {};
  next.returned = next.returned || {};
  next.peopleLog = next.peopleLog || [];

  const wanted = (Array.isArray(names) ? names : [names]).map((n) => (typeof n === "string" ? n : n && n.name)).filter(Boolean);
  const keys = new Set(wanted.map(nm));
  if (!keys.size) return next;

  /* Whoever they were before, recorded before anything moves, so the log says
     what actually changed rather than restating where they ended up. */
  const before = {};
  for (const n of wanted) before[nm(n)] = statusOf(next, n);

  const display = {};
  for (const n of wanted) display[nm(n)] = n;
  for (const a of next.roster) if (keys.has(nm(a.name))) display[nm(a.name)] = a.name;

  const known = new Map((next.roster || []).map((a) => [nm(a.name), a]));
  const wasDeparted = new Map((next.departed || []).map((d) => [nm(d && d.name), d]));

  if (status === "ignored") {
    for (const k of keys) {
      if (!next.excluded.some((x) => nm(x) === k)) next.excluded.push(display[k]);
      next.ignoredAt[k] = at;
      /* Any older note saying they were let back in has to go, or the stamp
         comparison that protects this would immediately undo it. */
      delete next.unignored[k];
    }
    next.roster = next.roster.filter((a) => !keys.has(nm(a.name)));
    next.departed = next.departed.filter((d) => !keys.has(nm(d && d.name)));
    /* Their figures were never this store's to count. */
    for (const m of Object.values(next.months || {})) {
      if (!m || !m.stats) continue;
      for (const k of Object.keys(m.stats)) if (keys.has(k)) delete m.stats[k];
    }
    for (const day of Object.keys(next.activity || {})) {
      for (const k of Object.keys(next.activity[day] || {})) if (keys.has(k)) delete next.activity[day][k];
    }
  }

  if (status === "departed") {
    for (const k of keys) {
      const was = known.get(k);
      next.departed = next.departed.filter((d) => nm(d && d.name) !== k);
      next.departed.push({ id: (was && was.id) || (wasDeparted.get(k) || {}).id || null,
        name: display[k], roleId: was ? (was.roleId ?? null) : ((wasDeparted.get(k) || {}).roleId ?? null),
        at, by });
      delete next.returned[k];
      /* Leaving is not the same as never having been here, so an old ignore is
         lifted rather than left to fight with this. */
      if (next.ignoredAt[k]) next.unignored[k] = at;
    }
    next.roster = next.roster.filter((a) => !keys.has(nm(a.name)));
    next.excluded = next.excluded.filter((x) => !keys.has(nm(x)));
    // Figures stay: the store did sell those cars.
  }

  if (status === "active") {
    for (const k of keys) {
      if (next.ignoredAt[k]) next.unignored[k] = at;
      if (wasDeparted.has(k)) next.returned[k] = at;
      if (!next.roster.some((a) => nm(a.name) === k)) {
        const prev = wasDeparted.get(k) || {};
        next.roster.push({ id: prev.id || opts.newId || undefined, name: display[k],
          roleId: prev.roleId ?? opts.roleId ?? null, hiredAt: opts.hiredAt || prev.hiredAt || null,
          order: next.roster.length });
      }
    }
    next.excluded = next.excluded.filter((x) => !keys.has(nm(x)));
    next.departed = next.departed.filter((d) => !keys.has(nm(d && d.name)));
  }

  for (const k of keys) {
    if (before[k] === status) continue;
    next.peopleLog.unshift({ at, by, name: display[k], from: before[k], to: status, note: opts.note || "" });
  }
  next.peopleLog = next.peopleLog.slice(0, 500);
  return next;
}

/**
 * Names this store has figures for that it does not claim as people.
 *
 * This is the shape every cross-store mix-up takes, and the reason to keep a
 * list of people at all: a store whose books credit somebody it has never
 * employed is a store whose totals are somebody else's. It is also how a parser
 * mistake shows up, since a heading read as a person arrives exactly this way.
 */
export function unclaimed(data) {
  const claimed = new Set(everyone(data).map((p) => p.key));
  const found = new Map();
  for (const [mk, m] of Object.entries(data.months || {})) {
    for (const [k, st] of Object.entries((m && m.stats) || {})) {
      if (claimed.has(k)) continue;
      const units = (st?.internetUnits ?? 0) + (st?.phoneUnits ?? 0) + (st?.showroomUnits ?? 0) + (st?.campaignUnits ?? 0);
      const cur = found.get(k) || { key: k, name: st?.displayName || k, months: [], units: 0, days: 0 };
      cur.months.push(mk); cur.units += units;
      found.set(k, cur);
    }
  }
  for (const day of Object.values(data.activity || {})) {
    for (const [k, r] of Object.entries(day || {})) {
      if (claimed.has(k)) continue;
      const worked = r && ((r.calls || 0) > 0 || (r.video || 0) > 0 || (r.tasks || 0) > 0);
      if (!worked) continue;
      const cur = found.get(k) || { key: k, name: r?.displayName || k, months: [], units: 0, days: 0 };
      cur.days += 1;
      found.set(k, cur);
    }
  }
  return [...found.values()].sort((a, b) => b.units - a.units || a.name.localeCompare(b.name));
}

/* =========================================================================
   Names a report brings that the store has never claimed.

   The importer used to add them. That is how a store fills itself in from its
   first report, and it is also how one misfiled file put a whole dealership onto
   somebody else's floor with its cars attached.

   So they are HELD instead. Held, not dropped: the figures are parked exactly as
   they arrived, and folded in the moment somebody says the person works here.
   Dropping them would punish the ordinary case — a new hire whose first report
   lands before anybody adds them — and a tool that loses a real salesperson's
   first week to protect against a rare mistake has made a bad trade.

   A store with nobody on it yet is the exception, and has to be: that is a new
   store's first import, and holding all of it would leave a manager staring at
   an empty screen with forty names in a queue.
   ========================================================================= */

/** Should this report's names be trusted straight in? Only for an empty store. */
export function admitsEveryone(data) {
  return !((data && data.roster) || []).length;
}

/**
 * Park one person's figures until somebody claims them.
 * `rec` is the month row, `dayRow`/`day` the activity row, either may be absent.
 */
export function holdPerson(data, name, { monthKey, rec, day, dayRow, at, file } = {}) {
  const k = nm(name);
  if (!k) return data;
  const next = data;
  next.pendingPeople = next.pendingPeople || {};
  const cur = next.pendingPeople[k] || { name, firstSeen: at || new Date().toISOString(), files: [], months: {}, days: {} };
  cur.name = cur.name || name;
  if (file && !cur.files.includes(file)) cur.files.push(file);
  if (monthKey && rec) cur.months[monthKey] = { ...(cur.months[monthKey] || {}), ...rec };
  if (day && dayRow) cur.days[day] = { ...(cur.days[day] || {}), ...dayRow };
  next.pendingPeople[k] = cur;
  return next;
}

/** What is waiting, in the order a manager should look at it. */
export function pendingList(data) {
  const out = [];
  for (const [k, v] of Object.entries((data && data.pendingPeople) || {})) {
    let units = 0;
    for (const m of Object.values(v.months || {})) {
      units += (m?.internetUnits ?? 0) + (m?.phoneUnits ?? 0) + (m?.showroomUnits ?? 0) + (m?.campaignUnits ?? 0);
    }
    out.push({ key: k, name: v.name || k, firstSeen: v.firstSeen, files: v.files || [],
      months: Object.keys(v.months || {}), days: Object.keys(v.days || {}).length, units });
  }
  return out.sort((a, b) => b.units - a.units || a.name.localeCompare(b.name));
}

/**
 * They do work here. Their parked figures join the store's, and they go on the
 * floor — which is the only path by which a report's numbers ever reach a
 * store's totals now.
 */
export function claimPending(data, names, opts = {}) {
  const list = (Array.isArray(names) ? names : [names]).filter(Boolean);
  const next = setStatus(data, list, "active", { ...opts, note: opts.note || "claimed from a report" });
  next.months = next.months || {};
  next.activity = next.activity || {};
  for (const n of list) {
    const k = nm(n);
    const held = (next.pendingPeople || {})[k];
    if (!held) continue;
    for (const [mk, rec] of Object.entries(held.months || {})) {
      next.months[mk] = next.months[mk] || { stats: {}, names: {}, imports: {} };
      next.months[mk].stats = next.months[mk].stats || {};
      next.months[mk].stats[k] = { ...(next.months[mk].stats[k] || {}), ...rec };
    }
    for (const [day, row] of Object.entries(held.days || {})) {
      next.activity[day] = next.activity[day] || {};
      next.activity[day][k] = { ...(next.activity[day][k] || {}), ...row };
    }
    delete next.pendingPeople[k];
  }
  return next;
}

/** They do not. The parked figures go with the decision. */
export function dropPending(data, names, opts = {}) {
  const list = (Array.isArray(names) ? names : [names]).filter(Boolean);
  const next = setStatus(data, list, "ignored", { ...opts, note: opts.note || "not this store's people" });
  for (const n of list) delete (next.pendingPeople || {})[nm(n)];
  return next;
}

/* =========================================================================
   Moving somebody between stores.

   Rare, and worth getting right when it happens: a manager wants to see how
   somebody has been doing, and half their year is at the store they came from.

   The history is COPIED to the new store, not moved. The old store sold those
   cars and its months have to keep saying so — a store whose past totals shrink
   because somebody transferred out is a store whose figures cannot be trusted.

   And it is copied into a place of its own rather than into the new store's
   months, for the same reason from the other side: cars sold at another
   dealership must never be summed into this one's totals. That is the exact
   fault this whole area exists to prevent, and doing it deliberately for
   transfers would be no better than doing it by accident. Their prior record is
   there to be read on their own screens, and nowhere else.
   ========================================================================= */

/** Everything one store knows about a person, ready to be carried. */
export function packUp(data, name, fromStoreId, fromStoreName) {
  const k = nm(name);
  const months = {};
  for (const [mk, m] of Object.entries((data && data.months) || {})) {
    const st = (m && m.stats && m.stats[k]) || null;
    if (st) months[mk] = JSON.parse(JSON.stringify(st));
  }
  const days = {};
  for (const [d, row] of Object.entries((data && data.activity) || {})) {
    if (row && row[k]) days[d] = JSON.parse(JSON.stringify(row[k]));
  }
  const person = ((data && data.roster) || []).find((a) => nm(a.name) === k)
    || ((data && data.departed) || []).find((x) => nm(x && x.name) === k) || null;
  return { key: k, name: (person && person.name) || name, roleId: (person && person.roleId) ?? null,
    hiredAt: (person && person.hiredAt) || null,
    from: fromStoreId || "", fromName: fromStoreName || fromStoreId || "", months, days };
}

/** Put them on the new store's floor, with their old record kept apart from it. */
export function transferIn(data, packed, opts = {}) {
  if (!packed || !packed.key) return data;
  const at = opts.at || new Date().toISOString();
  const next = setStatus(data, [packed.name], "active", {
    ...opts, at, roleId: opts.roleId ?? packed.roleId, hiredAt: opts.startedAt || at.slice(0, 10),
    newId: opts.newId, note: `transferred from ${packed.fromName}`,
  });
  next.priorHistory = next.priorHistory || {};
  /* Kept whole and kept separate. Read on their own screens; never summed into
     this store's month. */
  next.priorHistory[packed.key] = {
    ...(next.priorHistory[packed.key] || {}),
    [packed.from || packed.fromName || "elsewhere"]: {
      storeName: packed.fromName, at, months: packed.months, days: packed.days,
    },
  };
  return next;
}

/** And take them off the old one, which keeps every car they sold there. */
export function transferOut(data, name, toStoreName, opts = {}) {
  return setStatus(data, [name], "departed", { ...opts, note: `transferred to ${toStoreName}` });
}

/** Their record before this store, flattened for a screen that wants to show it. */
export function priorFor(data, name) {
  const k = nm(name);
  const all = ((data && data.priorHistory) || {})[k] || {};
  const out = [];
  for (const [id, rec] of Object.entries(all)) {
    let units = 0;
    for (const m of Object.values(rec.months || {})) {
      units += (m?.internetUnits ?? 0) + (m?.phoneUnits ?? 0) + (m?.showroomUnits ?? 0) + (m?.campaignUnits ?? 0);
    }
    out.push({ store: id, storeName: rec.storeName || id, months: Object.keys(rec.months || {}).sort(),
      days: Object.keys(rec.days || {}).length, units });
  }
  return out;
}

/* =========================================================================
   The same person, spelled two ways.

   "Juan Ruiz lopez" and "Juan Ruiz Lopez" are one salesperson and two rows, and
   the tool had no way to be told so short of a schedule upload. Left alone they
   split a month in half: two half-records, two sets of averages, and a manager
   wondering why somebody's numbers halved.

   The alias map already existed and both importers already honour it. What was
   missing was any way to teach it from the place the problem actually shows up —
   a held name that is obviously somebody you already have.
   ========================================================================= */

/** How far apart two names are. Small numbers mean a likely misspelling. */
function editDistance(a, b) {
  if (a === b) return 0;
  const m = a.length, n = b.length;
  if (!m || !n) return m || n;
  let prev = Array.from({ length: n + 1 }, (_, i) => i);
  for (let i = 1; i <= m; i++) {
    const cur = [i];
    for (let j = 1; j <= n; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[n];
}

/**
 * Who a stray name most likely already is.
 *
 * Ranked, and deliberately not decided: a suggestion a manager confirms is
 * useful, and an automatic match is how two different people called Chris end up
 * as one. Returns the best few, closest first, with the confident one flagged.
 */
export function likelyMatches(data, name, limit = 4) {
  const k = nm(name);
  if (!k) return [];
  const tokens = (x) => new Set(x.split(" ").filter(Boolean));
  const mine = tokens(k);
  const out = [];
  for (const p of everyone(data)) {
    if (p.status === "ignored" || p.key === k) continue;
    const theirs = tokens(p.key);
    let shared = 0;
    for (const t of mine) if (theirs.has(t)) shared++;
    const d = editDistance(k, p.key);
    /* Two signals, because either alone gets it wrong. Edit distance alone calls
       "Toni Thomas" and "Toni Law" a match; shared words alone calls every
       Rodriguez the same person. Together they only agree on a real near-miss. */
    const close = d <= Math.max(2, Math.round(k.length * 0.2));
    const mostlySame = shared >= Math.max(2, Math.min(mine.size, theirs.size));
    if (!close && !mostlySame) continue;
    out.push({ key: p.key, name: p.name, status: p.status, distance: d, shared,
      /* Same words, different capitals or spacing — the case this exists for,
         and the only one worth pre-selecting. */
      confident: (mostlySame && d <= 3) || d <= 1 });
  }
  return out.sort((a, b) => (b.confident - a.confident) || (a.distance - b.distance) || (b.shared - a.shared)).slice(0, limit);
}

/**
 * Say that a held name is somebody the store already has.
 *
 * Three things at once, and all three are needed: the spelling is remembered so
 * every future report folds itself in, the figures already held are added to the
 * person they belong to, and the queue entry goes.
 */
export function sameAs(data, heldName, personName, opts = {}) {
  const from = nm(heldName), to = nm(personName);
  if (!from || !to || from === to) return data;
  const next = JSON.parse(JSON.stringify(data || {}));
  next.aliases = next.aliases || {};
  next.months = next.months || {};
  next.activity = next.activity || {};
  next.peopleLog = next.peopleLog || [];
  next.aliases[from] = to;

  const holdRec = (next.pendingPeople || {})[from];
  if (holdRec) {
    for (const [mk, rec] of Object.entries(holdRec.months || {})) {
      next.months[mk] = next.months[mk] || { stats: {}, names: {}, imports: {} };
      next.months[mk].stats = next.months[mk].stats || {};
      /* Added to what is already there rather than replacing it. Half a month
         under each spelling is exactly how this goes wrong, and overwriting
         would throw away the half that was filed correctly. */
      const into = next.months[mk].stats[to] || {};
      for (const [f, v] of Object.entries(rec)) {
        if (typeof v === "number" && typeof into[f] === "number") into[f] = into[f] + v;
        else if (into[f] === undefined) into[f] = v;
      }
      next.months[mk].stats[to] = into;
    }
    for (const [day, row] of Object.entries(holdRec.days || {})) {
      next.activity[day] = next.activity[day] || {};
      next.activity[day][to] = { ...(next.activity[day][to] || {}), ...row };
    }
    delete next.pendingPeople[from];
  }

  /* And any figures already filed under the wrong spelling, from before anybody
     said they were the same person. */
  for (const m of Object.values(next.months)) {
    if (!m || !m.stats || !m.stats[from]) continue;
    const into = m.stats[to] || {};
    for (const [f, v] of Object.entries(m.stats[from])) {
      if (typeof v === "number" && typeof into[f] === "number") into[f] = into[f] + v;
      else if (into[f] === undefined) into[f] = v;
    }
    m.stats[to] = into;
    delete m.stats[from];
  }
  for (const day of Object.keys(next.activity)) {
    const row = next.activity[day];
    if (!row || !row[from]) continue;
    row[to] = { ...(row[to] || {}), ...row[from] };
    delete row[from];
  }

  /* The misspelling must not be left on any list, or the next report matches it
     before the alias is ever consulted. */
  next.roster = (next.roster || []).filter((a) => nm(a.name) !== from);
  next.departed = (next.departed || []).filter((d) => nm(d && d.name) !== from);
  next.excluded = (next.excluded || []).filter((x) => nm(x) !== from);

  next.peopleLog.unshift({ at: opts.at || new Date().toISOString(), by: opts.by || "",
    name: heldName, from: "unknown", to: "same person", note: `same as ${personName}` });
  next.peopleLog = next.peopleLog.slice(0, 500);
  return next;
}

/**
 * Was this person on the payroll on this day?
 *
 * The bound under every average they are judged by. A day before somebody
 * started is not a day they failed to work: a hire on the 18th used to be
 * measured against the whole month, so their first week read as three weeks of
 * doing nothing — to the one person on the floor least able to argue with a
 * screen. The other end matters as much: a leaver is not still missing calls in
 * the fortnight after they went.
 *
 * Both bounds include the day itself, because you worked the day you started.
 * No start date means the whole month, which is what it has always meant, so
 * nothing changes for anybody already on the roster.
 */
export function servedOn(person, ds, departedAt) {
  if (person && person.hiredAt && ds < String(person.hiredAt).slice(0, 10)) return false;
  if (departedAt && ds > String(departedAt).slice(0, 10)) return false;
  return true;
}
