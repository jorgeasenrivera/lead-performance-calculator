import React from "react";
/* One deviation from the handoff's "ships as-is": the React import below.
   The file is JSX with no import, which works under the automatic JSX runtime
   this app's Vite build uses and throws "React is not defined" under a classic
   transform — which is what the harness the screens are checked in uses, and
   what any other toolchain this file is dropped into may use. Costs nothing
   under the automatic runtime, so it is imported rather than assumed.

   Sage mark and wordmark, drawn on the same 9x9 grid as PixIcon.
   One drawing, no punctuation: `word` renders the lockup, otherwise the S alone.
   Two colours run up the rows; `flat` collapses them to one for print.
   Dot size is 0.86 of the cell; the reversed wordmark alone drops to 0.82.
   Weight rises up the rows (1 / 0.75 / 0.5) above 48px; below that every dot
   is drawn at one size or the lightest row disappears. */

const ICON_S = ["..ooooo..", ".oo...oo.", ".oo......", "..ooooo..", "......oo.", ".oo...oo.", "..ooooo..", ".........", "........."];
const LOWER = {
  a: [".....", ".....", ".ooo.", "....o", ".oooo", "o...o", ".oooo", ".....", "....."],
  g: [".....", ".....", ".oooo", "o...o", "o...o", ".oooo", "....o", "o...o", ".ooo."],
  e: [".....", ".....", ".ooo.", "o...o", "ooooo", "o....", ".ooo.", ".....", "....."],
};
const WORDMARK = (() => {
  /* The S is drawn on its own 9-wide grid with a blank column down each side.
     That is right when it stands alone and wrong in a word: joined as-is it
     leaves two blank columns after the S and one between every other pair, so
     the word reads as "S age", and the leading column pads the box on one side
     only, so centring the box leaves the word sitting to the right of centre by
     half a column. Both margins come off here; the mark alone keeps them. */
  const S_JOINED = ICON_S.map((r) => r.slice(1, 8));
  const blocks = [S_JOINED, LOWER.a, LOWER.g, LOWER.e];
  const rows = [];
  for (let r = 0; r < 9; r++) rows.push(blocks.map(b => b[r]).join("."));
  return rows;
})();

const WEIGHT = [1, 1, 1, 0.75, 0.75, 0.75, 0.5, 0.5, 0.5];
/* B5 geometry: a 9-unit cell with a 1.2 gap, dots at 0.86 of the cell. */
const CELL = 9;
const PITCH = CELL + 1.2;
/* Dots fill 0.86 of the cell. The one exception is the reversed wordmark on the
   ink plate, at 0.82: light dots on dark bloom outward, so at 0.86 the word reads
   as touching. The app icon and the mark alone stay at 0.86 everywhere. */
const FILL = 0.86;
const FILL_REVERSED = 0.82;

const mix = (a, b, t) => {
  const q = h => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16));
  const [r1, g1, b1] = q(a), [r2, g2, b2] = q(b);
  const c = (x, y) => Math.round(x + (y - x) * t).toString(16).padStart(2, "0");
  return "#" + c(r1, r2) + c(g1, g2) + c(b1, b2);
};

/* Two colours, running up the rows. */
export const SAGE_BASE = "#2F7F72";      // baseline, on light
export const SAGE_CAP = "#5C8149";       // cap height, on light
export const SAGE_BASE_REVERSED = "#8FBDB2";
export const SAGE_CAP_REVERSED = "#AEC79E";
export const SAGE_PLATE = "#2E3A32";
export const SAGE_PRINT = "#2E3A32";     // one flat colour, print and PDF only

/* The artwork as geometry, in viewBox units, for anything that has to move the
   dots individually rather than draw them — the arrival turns every one of them
   into a streak. Exported so the mark stays the only place the pattern lives:
   a second copy of it in the transition would drift the first time the S is
   touched. */
export function sageDots({ word = false, rise = true, fill, base = SAGE_BASE, cap = SAGE_CAP, flat } = {}) {
  const pattern = word ? WORDMARK : ICON_S;
  const cols = pattern[0].length, rows = pattern.length;
  const fillOn = fill === undefined ? FILL : fill;
  const out = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (pattern[r][c] !== "o") continue;
      out.push({
        x: (c + 0.5) * PITCH,
        y: (r + 0.5) * PITCH,
        r: ((rise ? WEIGHT[r] : 1) * CELL * fillOn) / 2,
        fill: flat || mix(base, cap, rows > 1 ? 1 - r / (rows - 1) : 0),
      });
    }
  }
  out.sort((a, b) => a.x - b.x || a.y - b.y);
  return { dots: out, w: cols * PITCH, h: rows * PITCH };
}

export default function SageMark({
  word = false,
  size = 32,
  /* How many dots to draw, left to right, for the build on the sign-in screen.
     Left out of the handoff's file because the mark itself does not know about
     the form; it is here rather than in the screen because the ORDER has to be
     the mark's own (sorted by x, then y) and nothing outside should have to know
     that. Undefined draws the whole mark, which is every other call site. */
  revealed,
  base = SAGE_BASE,
  cap = SAGE_CAP,
  flat,          // one colour: pass SAGE_PRINT for print and PDF
  fill,          // defaults to 0.82 for the reversed wordmark, 0.86 otherwise
  rise,          // defaults on above 48px
  plate,         // pass SAGE_PLATE for the app-icon form
  radius = 24,   // plate corner radius, % of the plate
  pad = 0,       // plate padding, % of the plate
  title = "Sage",
  ...rest
}) {
  const pattern = word ? WORDMARK : ICON_S;
  const cols = pattern[0].length;
  const rows = pattern.length;
  const padPx = (pad / 100) * rows * PITCH;
  const w = cols * PITCH + padPx * 2;
  const h = rows * PITCH + padPx * 2;
  const riseOn = rise === undefined ? size > 48 : rise;
  /* The exception is the reversed WORDMARK only. The app icon and the mark alone
     keep 0.86 on every plate. */
  const reversed = word && (base === SAGE_BASE_REVERSED || cap === SAGE_CAP_REVERSED || plate === SAGE_PLATE);
  const fillOn = fill === undefined ? (reversed ? FILL_REVERSED : FILL) : fill;

  const cells = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (pattern[r][c] !== "o") continue;
      cells.push({ r, c });
    }
  }
  /* Left to right, then down: the order the mark builds in. */
  const order = [...cells].sort((a, b) => a.c - b.c || a.r - b.r);
  const shown = revealed === undefined ? null : new Set(order.slice(0, Math.max(0, revealed)).map((d) => d.r + "-" + d.c));
  /* Each dot's place in that same left-to-right order, published as a custom
     property so a stylesheet can stagger anything across the mark without
     needing to know how the pattern is laid out. Second addition to the
     handoff's file, for the same reason as `revealed`: the order belongs to
     the mark. */
  const rank = new Map(order.map((d, i) => [d.r + "-" + d.c, i]));
  /* And where each dot sits relative to the middle of the mark: the angle out of
     the centre and the distance from it, in viewBox units. The sign-in arrival
     turns every dot of the REAL mark into a streak flying along its own radius,
     and it does that in CSS, on the mark as drawn, rather than over a second copy
     of it somewhere else. That only works if the geometry travels with the dots. */
  const midX = (cols * PITCH) / 2, midY = (rows * PITCH) / 2;

  const dots = cells.map(({ r, c }) => (
    <circle
      key={r + "-" + c}
      cx={(c + 0.5) * PITCH + padPx}
      cy={(r + 0.5) * PITCH + padPx}
      r={((riseOn ? WEIGHT[r] : 1) * CELL * fillOn) / 2}
      fill={flat || mix(base, cap, rows > 1 ? 1 - r / (rows - 1) : 0)}
      data-dot={r + "-" + c}
      style={(() => {
        const dx = (c + 0.5) * PITCH - midX, dy = (r + 0.5) * PITCH - midY;
        return {
          /* Drawn but transparent rather than absent, so the mark never reflows
             as it fills and the streaks later have every dot to start from. In
             the style rather than as an attribute so a stylesheet can put a
             transition on it: the handoff fades each dot up over 240ms as the
             form reaches it, and a presentation attribute would snap. */
          opacity: shown && !shown.has(r + "-" + c) ? 0 : undefined,
          "--i": rank.get(r + "-" + c),
          "--n": order.length,
          "--a": ((Math.atan2(dy, dx) * 180) / Math.PI).toFixed(2) + "deg",
          "--d": Math.hypot(dx, dy).toFixed(2),
          "--dr": (((riseOn ? WEIGHT[r] : 1) * CELL * fillOn) / 2).toFixed(3),
        };
      })()}
    />
  ));

  return (
    <svg
      viewBox={`0 0 ${w} ${h}`}
      height={size}
      width={(size * w) / h}
      role="img"
      aria-label={title}
      {...rest}
    >
      {plate ? <rect width={w} height={h} rx={(radius / 100) * w} fill={plate} /> : null}
      {dots}
    </svg>
  );
}
