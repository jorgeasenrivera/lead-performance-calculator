// Pure: rebuilds the PR501 head manager-spacing.yml from the OLD file plus the three reviewed insertions. No file system, no Git.
//   1. insertion A replaces the guard step (anchorA) and carries the route step, the guard step with its `if`, the contract steps and fixed stage markers;
//   2. insertion B (a fixed stage marker) goes immediately before the legacy "Measure before and after" step (anchorB, kept);
//   3. insertion C (the fixed stage-outcome annotation step) is appended after the last legacy step.
//   4. insertion P (the two path-filter lines for the fixture helper and its test) goes immediately after the last entry of the old pull_request.paths list (anchorP).
//      It is explicit and non-empty. Only the historical v1 control may pass allowEmptyP === true; the production runner never does.
// Pins are rendered only into insertion A. Any other byte in the head file is refused by the caller's equality check.
export const ANCHOR_A = "      - name: Verify frozen preview runtime\n        run: sha256sum --check scripts/search-runtime.sha256\n";
export const ANCHOR_B = "      - name: Measure before and after\n";
export const ANCHOR_P = "      - .github/workflows/manager-spacing.yml\n";
const once = (text, needle) => text.split(needle).length === 2;
export function composeWorkflow({ oldText: oldRaw, tplA, tplB, tplC, tplP, allowEmptyP, pins }) {
  if (typeof tplP !== "string") throw new Error("insertion P template is missing");
  if (tplP === "" && allowEmptyP !== true) throw new Error("insertion P template is empty");
  const render = (t) => t.replace(/@@([A-Z0-9_]+)@@/g, (m, k) => (pins[k] ?? m));
  const [a, b, c, p] = [render(tplA), render(tplB), render(tplC), render(tplP)];
  if ([a, b, c, p].some((t) => /@@[A-Z0-9_]+@@/.test(t))) throw new Error("an insertion has an unfilled pin");
  if (!oldRaw.endsWith("\n")) throw new Error("the old file does not end with a newline");
  if (!once(oldRaw, ANCHOR_P)) throw new Error("the old file does not contain anchor P exactly once");
  const [pre, post] = oldRaw.split(ANCHOR_P);
  if (pre.includes(ANCHOR_A) || pre.includes(ANCHOR_B)) throw new Error("anchor P comes after a step anchor");
  const oldText = pre + ANCHOR_P + p + post;
  if (!oldText.endsWith("\n")) throw new Error("the old file does not end with a newline");
  if (!once(oldText, ANCHOR_A)) throw new Error("the old file does not contain anchor A exactly once");
  if (!once(oldText, ANCHOR_B)) throw new Error("the old file does not contain anchor B exactly once");
  const [before, rest] = oldText.split(ANCHOR_A);
  if (before.includes(ANCHOR_B)) throw new Error("anchor B comes before anchor A");
  const [mid, tail] = rest.split(ANCHOR_B);
  return before + a + mid + b + ANCHOR_B + tail + c;
}
