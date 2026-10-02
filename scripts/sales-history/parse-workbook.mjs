/* Jorge's sales workbook (C111) to one reading per store per day.
   The book has a sheet per month. A sheet is a column of week blocks (and
   blocks side by side), a block being "<year> Sales" on its first row, the
   day numbers on the row above, Mon to Sun across, then a row per store. The
   same week shows up on the sheets of later years, as a comparison, so most
   days are written two to five times and have to be reconciled.

   Three layouts are read that a first pass got wrong:
   - the year label sits on the row above the header row in some sheets, and the
     header row then says only "Sales" (reading the sheet's own year there
     dates last year's block as this year's);
   - the day-number row has a typo now and then ("3 4 5 9 7 8 9"); the Monday
     that fits most of the numbers wins;
   - a week that spans two months is on both sheets, so a block's month is
     found by testing the neighbouring months, not assumed. */
import { storeIdFor, WORKBOOK_STORES } from "./stores.mjs";

const MONTHS = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };
const DAY = 86400000;
const iso = (t) => new Date(t).toISOString().slice(0, 10);
const utc = (y, m, d) => Date.UTC(y, m - 1, d);
const addMonth = (y, m, k) => { const t = new Date(utc(y, m + k, 1)); return [t.getUTCFullYear(), t.getUTCMonth() + 1]; };

export function sheetMonth(name) {
  const m = /^\s*([A-Za-z]+)\.?\s+(\d{4})\s*$/.exec(String(name));
  const mo = m && MONTHS[m[1].slice(0, 3).toLowerCase()];
  return mo ? { year: +m[2], month: mo } : null;
}

/* The Monday (as a time value) whose seven day-numbers best fit `nums`. */
export function resolveMonday(nums, year, month) {
  const known = nums.map((n, i) => [i, n]).filter(([, n]) => n);
  if (!known.length) return { why: "no day numbers" };
  const need = known.length <= 3 ? known.length : known.length - 1;
  const [y0, m0] = addMonth(year, month, -1), [y1, m1] = addMonth(year, month, 2);
  let t = utc(y0, m0, 1);
  while (new Date(t).getUTCDay() !== 1) t += DAY;
  const end = utc(y1, m1, 1), found = [];
  for (; t < end; t += 7 * DAY) {
    const match = known.filter(([i, n]) => new Date(t + i * DAY).getUTCDate() === n).length;
    if (match < need) continue;
    let inMonth = 0;
    for (let i = 0; i < 7; i++) { const d = new Date(t + i * DAY); if (d.getUTCFullYear() === year && d.getUTCMonth() + 1 === month) inMonth++; }
    found.push([match, inMonth, t]);
  }
  if (!found.length) return { why: "no Monday fits" };
  found.sort((a, b) => b[0] - a[0] || b[1] - a[1] || b[2] - a[2]);
  const ambiguous = found.length > 1 && found[0][0] === found[1][0] && found[0][1] === found[1][1];
  return { monday: found[0][2], quality: found[0][0] === known.length ? "ok" : "repaired", ambiguous };
}

const dayNumber = (v) => {
  const n = typeof v === "number" ? v : /^\d+(\.0+)?$/.test(String(v ?? "").trim()) ? Number(v) : NaN;
  return Number.isInteger(n) && n >= 1 && n <= 31 ? n : null;
};
const cellValue = (v) => {
  if (v == null || v === "") return { skip: true };
  if (typeof v === "number") return { value: v };
  const s = String(v).trim();
  if (/^n\/?a$/i.test(s)) return { value: "NA" };
  if (/^-?\d+(\.\d+)?$/.test(s)) return { value: Number(s) };
  return { odd: s };
};

/* sheets: [{ name, rows }] as read by xlsx-lite. */
export function parseSheets(sheets) {
  const readings = [], skipped = [], odd = [], stats = { blocks: 0, ok: 0, repaired: 0, ambiguous: 0, sheetsSkipped: [] };
  for (const sheet of sheets) {
    const sm = sheetMonth(sheet.name);
    if (!sm) { stats.sheetsSkipped.push(sheet.name); continue; }
    const rows = sheet.rows;
    for (let ri = 1; ri < rows.length; ri++) {
      const row = rows[ri];
      for (let ci = 0; ci < row.length; ci++) {
        const label = row[ci];
        if (typeof label !== "string" || !/^\s*(20\d\d)?\s*sales\s*$/i.test(label)) continue;
        const head = [1, 2, 3].map((k) => String(row[ci + k] ?? "").trim().slice(0, 3).toLowerCase());
        if (head.join() !== "mon,tue,wed") continue;
        let year = (/20\d\d/.exec(label) || [])[0];
        if (!year) year = (/(20\d\d)\s*sales/i.exec(String(rows[ri - 1][ci] ?? "")) || [])[1];
        year = year ? +year : sm.year;
        const nums = [1, 2, 3, 4, 5, 6, 7].map((k) => dayNumber(rows[ri - 1][ci + k]));
        const r = resolveMonday(nums, year, sm.month);
        stats.blocks++;
        if (!r.monday) { skipped.push({ sheet: sheet.name, row: ri + 1, col: ci + 1, why: r.why, nums }); continue; }
        stats[r.quality]++; if (r.ambiguous) stats.ambiguous++;
        for (let r2 = ri + 1; r2 < rows.length; r2++) {
          const name = rows[r2][ci];
          if (name == null || String(name).trim() === "") break;
          const store = String(name).replace(/\s+/g, " ").trim();
          if (/^total$/i.test(store) || /^(20\d\d)?\s*sales$/i.test(store)) break;
          for (let k = 0; k < 7; k++) {
            const c = cellValue(rows[r2][ci + 1 + k]);
            if (c.skip) continue;
            if (c.odd !== undefined) { odd.push({ sheet: sheet.name, store, text: c.odd.slice(0, 20) }); continue; }
            readings.push({ sheet: sheet.name, store, date: iso(r.monday + k * DAY), value: c.value });
          }
        }
      }
    }
  }
  return { readings, skipped, odd, stats };
}

/* One value per store per day: the one most sheets agree on. A tie, or a
   count that is not a whole number, is left out as unknown and listed. */
export function reconcile(readings, map = WORKBOOK_STORES) {
  const groups = new Map(), unmapped = new Map();
  for (const r of readings) {
    const id = storeIdFor(r.store, map);
    if (!id) { unmapped.set(r.store, (unmapped.get(r.store) || 0) + 1); continue; }
    const key = id + "\t" + r.date;
    (groups.get(key) || groups.set(key, []).get(key)).push(r);
  }
  const days = [], ties = [], fractional = [];
  for (const [key, rs] of groups) {
    const [store, day] = key.split("\t");
    const votes = new Map();
    for (const r of rs) votes.set(r.value, (votes.get(r.value) || 0) + 1);
    const ranked = [...votes].sort((a, b) => b[1] - a[1]);
    if (ranked.length > 1 && ranked[0][1] === ranked[1][1]) { ties.push({ store, day, sheets: rs.map((r) => `${r.sheet}=${r.value}`) }); continue; }
    const v = ranked[0][0];
    if (v === "NA") days.push({ store, day, closed: true, units: null, sheets: rs.length });
    else if (Number.isInteger(v) && v >= 0 && v <= 1000) days.push({ store, day, closed: false, units: v, sheets: rs.length });
    else fractional.push({ store, day, value: v });
  }
  days.sort((a, b) => a.store.localeCompare(b.store) || a.day.localeCompare(b.day));
  ties.sort((a, b) => a.day.localeCompare(b.day) || a.store.localeCompare(b.store));
  const disagreeing = [...groups.values()].filter((rs) => new Set(rs.map((r) => r.value)).size > 1).length;
  return { days, ties, fractional, unmapped, disagreeing };
}

/* Days a store has nothing for between its first and last known day. */
export function missingDays(days, ties = []) {
  const byStore = new Map();
  for (const d of days) (byStore.get(d.store) || byStore.set(d.store, new Set()).get(d.store)).add(d.day);
  const tied = new Set(ties.map((t) => t.store + "\t" + t.day));
  const out = new Map();
  for (const [store, set] of byStore) {
    const all = [...set].sort();
    for (let t = Date.parse(all[0]); t <= Date.parse(all.at(-1)); t += DAY) {
      const d = iso(t);
      if (set.has(d) || tied.has(store + "\t" + d)) continue;
      (out.get(d) || out.set(d, []).get(d)).push(store);
    }
  }
  return [...out].sort((a, b) => a[0].localeCompare(b[0])).map(([day, stores]) =>
    ({ day, weekday: new Date(day + "T12:00:00Z").toLocaleDateString("en-US", { weekday: "short", timeZone: "UTC" }), stores }));
}

/* The load, as SQL: only integers, dates and a validated source label ever
   reach the text, and a workbook row never overwrites a row from the daily
   report (source 'workbook-...' only). */
export function salesDailySql(days, source, chunk = 1000) {
  if (!/^workbook-\d{4}-\d{2}$/.test(source)) throw new Error("the source label looks like workbook-2026-10");
  const files = [];
  for (let i = 0; i < days.length; i += chunk) {
    const rows = days.slice(i, i + chunk).map((d) => {
      if (!/^[a-z0-9][a-z0-9_-]{0,63}$/.test(d.store) || !/^\d{4}-\d{2}-\d{2}$/.test(d.day)) throw new Error("a row that is not a store and a day");
      if (d.closed ? d.units !== null : !(Number.isInteger(d.units) && d.units >= 0 && d.units <= 1000)) throw new Error("a row that is neither closed nor a count");
      return `('${d.store}','${d.day}',${d.closed ? "null" : d.units},${d.closed ? "true" : "false"},'${source}')`;
    });
    files.push(`insert into public.sales_daily (store, day, units, closed, source) values\n${rows.join(",\n")}\n` +
      `on conflict (store, day) do update set units = excluded.units, closed = excluded.closed, source = excluded.source, loaded_at = now()\n` +
      `where public.sales_daily.source like 'workbook-%';\n`);
  }
  return files;
}
