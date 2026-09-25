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

/* C86. scrollLeft is read on the main thread, but the finger and the pixels
   travel through Chromium's compositor. A blank native scroller, with no Sage
   code, produced one-sample 10 px gaps under the same CDP gesture. A single
   reading cannot tell that bookkeeping delay from a visual hitch. Two
   consecutive readings can establish that the page stayed behind. Keep the
   original 2 px bar on those sustained gaps, and fail closed if none were
   measured. The raw one-sample readings are still printed by followDetail. */
export function sustainedFollowSpread(at) {
  if (!at || at.length < 2) return 999;
  const gaps = at.map(([, thumb, page]) => thumb - page);
  const stable = [];
  let start = 0;
  for (let i = 1; i <= gaps.length; i++) {
    if (i < gaps.length && Math.abs(gaps[i] - gaps[start]) <= 2) continue;
    if (i - start >= 2) stable.push(...gaps.slice(start, i));
    start = i;
  }
  return stable.length >= 2 ? Math.max(...stable) - Math.min(...stable) : 999;
}
