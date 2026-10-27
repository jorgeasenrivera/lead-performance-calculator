// Pure: rebuilds the PR501 head manager-spacing.yml from the OLD file plus the three reviewed insertions. No file system, no Git.
//   1. insertion A replaces the guard step (anchorA) and carries the route step, the guard step with its `if`, the contract steps and fixed stage markers;
//   2. insertion B (a fixed stage marker) goes immediately before the legacy "Measure before and after" step (anchorB, kept);
//   3. insertion C (the fixed stage-outcome annotation step) is appended after the last legacy step.
// Pins are rendered only into insertion A. Any other byte in the head file is refused by the caller's equality check.
export const ANCHOR_A = "      - name: Verify frozen preview runtime\n        run: sha256sum --check scripts/search-runtime.sha256\n";
export const ANCHOR_B = "      - name: Measure before and after\n";
const once = (text, needle) => text.split(needle).length === 2;
export function composeWorkflow({ oldText, tplA, tplB, tplC, pins }) {
  const render = (t) => t.replace(/@@([A-Z0-9_]+)@@/g, (m, k) => (pins[k] ?? m));
  const [a, b, c] = [render(tplA), render(tplB), render(tplC)];
  if ([a, b, c].some((t) => /@@[A-Z0-9_]+@@/.test(t))) throw new Error("an insertion has an unfilled pin");
  if (!oldText.endsWith("\n")) throw new Error("the old file does not end with a newline");
  if (!once(oldText, ANCHOR_A)) throw new Error("the old file does not contain anchor A exactly once");
  if (!once(oldText, ANCHOR_B)) throw new Error("the old file does not contain anchor B exactly once");
  const [before, rest] = oldText.split(ANCHOR_A);
  if (before.includes(ANCHOR_B)) throw new Error("anchor B comes before anchor A");
  const [mid, tail] = rest.split(ANCHOR_B);
  return before + a + mid + b + ANCHOR_B + tail + c;
}
