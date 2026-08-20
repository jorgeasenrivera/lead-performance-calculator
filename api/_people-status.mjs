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
