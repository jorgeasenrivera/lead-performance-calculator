/* Readings from the feel harness, turned into sentences. Kept apart from
   feel.mjs because that file runs the harness the moment it is imported, and
   these want testing without a browser. */

/* The readings behind a follow spread, as a sentence: where the page was
   furthest behind the thumb, where it was closest, and how far behind it was
   on the reading after the widest one, which is what says whether a gap was a
   blip that recovered or a lag that stayed. `at` is [frame, thumb, page, ms]
   per reading. Empty when there is no spread to explain (C86). */
export function followDetail(at) {
  if (!at || at.length < 2) return "";
  const gaps = at.map(([, th, pg]) => th - pg);
  const top = Math.max(...gaps), bottom = Math.min(...gaps);
  if (top === bottom) return "";
  const hi = gaps.indexOf(top), lo = gaps.indexOf(bottom);
  const show = (k) => { const [f, th, pg, fm] = at[k]; return `frame ${f} (thumb ${th}, page ${pg}, ${th - pg} px behind, ${Math.round(fm)} ms)`; };
  const after = hi + 1 < gaps.length ? `, then ${gaps[hi + 1]} px behind on the reading after` : ", the last reading";
  return `widest ${show(hi)}${after}; narrowest ${show(lo)}`;
}

/* C86. The blank native scroller showed one isolated 10 px bookkeeping gap.
   Excuse only one interior reading, no more than one 10 px thumb step plus
   2 px measurement tolerance. A new offset that stays is not a blip. The
   first larger reading may be gesture takeover; the final reading belongs
   to the snap and dropped-frame rows. Fail closed without a stable baseline. */
export function followAssessment(at) {
  if (!at || at.length < 2) return { spread: 999, reason: "too few readings" };
  const gaps = at.map(([, thumb, page]) => thumb - page);
  const raw = Math.max(...gaps) - Math.min(...gaps);
  const stable = [];
  const runs = [];
  let start = 0;
  for (let i = 1; i <= gaps.length; i++) {
    if (i < gaps.length && Math.abs(gaps[i] - gaps[start]) <= 2) continue;
    runs.push({ start, end: i, gap: gaps[start] });
    if (i - start >= 2) stable.push(...gaps.slice(start, i));
    start = i;
  }
  if (stable.length < 2) return { spread: 999, reason: "no stable follow baseline" };
  const baselineSpread = Math.max(...stable) - Math.min(...stable);
  const lone = runs.filter(({ start, end }) => end - start === 1);
  const interior = lone.filter(({ start, end }) => start > 0 && end < gaps.length);
  const first = lone.find(({ start }) => start === 0);
  if (first && runs.length > 1 && first.gap < runs[1].gap - 2) {
    return { spread: Math.max(raw, 3), reason: "offset gained on reading two and held" };
  }
  const excursions = interior.filter(({ gap }) => stable.every((level) => Math.abs(gap - level) > 2));
  if (excursions.length > 1) return { spread: Math.max(raw, 3), reason: `${excursions.length} one-reading gaps in one swipe` };
  for (const run of interior) {
    const before = runs.find(({ end }) => end === run.start);
    const after = runs.find(({ start }) => start === run.end);
    if (!before || !after || before.end - before.start < 2 || after.end - after.start < 2 || Math.abs(before.gap - after.gap) > 2) {
      return { spread: Math.max(raw, 3), reason: "one-reading gap did not return to a stable level" };
    }
    if (Math.abs(run.gap - before.gap) > 12 || Math.abs(run.gap - after.gap) > 12) {
      return { spread: Math.max(raw, 3), reason: "one-reading gap exceeds one thumb step plus tolerance" };
    }
  }
  return { spread: baselineSpread, reason: excursions.length ? "one bounded, recovered compositor reading" : "stable readings" };
}

export function sustainedFollowSpread(at) {
  return followAssessment(at).spread;
}
