/* A fixed-shape record of which stages of the feel-strict job ran and how they ended, for runs whose logs cannot be read. Only closed values leave this file:
   an event name from a short list, two full 40-hex git ids, outcomes from the runner's four words, one mapped exit code of the fixture start-up, and the feel exit code
   as a small integer. Nothing from a log, a body, a header or the environment is copied, so nothing can be injected into the summary, an output file or a workflow command.
   It writes no step output and no comment; it prints one line (for the job's own summary) and writes one file next to the other fixture receipts. */
import fs from "node:fs";
import path from "node:path";

const OUTCOMES = new Set(["success", "failure", "cancelled", "skipped"]);
const EVENTS = new Set(["push", "pull_request"]);
const GIT_ID = /^[0-9a-f]{40}$/;
/* ci-fixture.sh up exits: 0 ok; 1 start-up failed (its fixed reason word went to stderr); 2 usage; 5 refused (engine, uid, adapter, kit or pins); 6 a port was not CONFIRMED free:
   taken, but also a timeout or a permission error, which say nothing about the port. */
const UP = { 0: "ok", 1: "startup-failed", 2: "usage", 5: "refused", 6: "port-unconfirmed" };
/* The verdict's own receipt, as this step found it: absent (no readable file), invalid (not a plain small JSON file with a problems list), or valid. */
const RECEIPT_STATES = new Set(["absent", "invalid", "valid"]);
/* The verdict's own problem strings, mapped to a closed list. A string that matches none, or is not a plain string, becomes "other"; its text is never copied. */
const PROBLEMS = [
  [/^unexpected requests: \d{1,9}$/, "unexpected-requests"], [/^fixture start line missing$/, "start-line-missing"],
  [/^(room API was not on|fixture mode was not compatible|manager actor was not on|seed identity was not normalised|report mode was not compatible|report clock unknown|report seed was not the shared seed)$/, "fixture-config"],
  [/^(actor manifest hash|seed hash|seed rows hash) missing$/, "hash-missing"], [/^start\.dist missing or malformed$/, "dist-missing"],
  [/^fixture report missing or invalid$/, "report-invalid"], [/^the report dropped counts$/, "report-dropped"],
  [/^dist pin differs between start and report$/, "dist-mismatch"],
  [/^outside (seed|dist|actor manifest|seed rows) pin missing$/, "pin-missing"], [/^(seed hash|dist hash|actor manifest|seed rows hash) differs from the outside pin$/, "pin-mismatch"],
  [/^(expected counters missing or unknown|the 503 rows and the expected counter disagree)$/, "expected-counter"],
  [/^strict adapter is not the reviewed bytes$/, "adapter-bytes"], [/^adapter: [\x20-\x7e]{1,120}$/, "adapter-evidence"],
];
export const PROBLEM_CODES = [...new Set([...PROBLEMS.map((p) => p[1]), "other"])];
export function mapProblems(list) {
  if (!Array.isArray(list)) return [];
  const out = new Set();
  for (const p of list.slice(0, 64)) out.add(typeof p === "string" && p.length <= 200 ? ((PROBLEMS.find(([re]) => re.test(p)) || [])[1] || "other") : "other");
  return [...out].sort();
}
export const STAGES = ["checkout", "preflight", "dependencies", "driver", "toolchain", "build", "up", "feel", "verdict", "stop"];

const outcome = (v) => (typeof v === "string" && OUTCOMES.has(v) ? v : "unknown");
const gitId = (v) => (typeof v === "string" && GIT_ID.test(v) ? v : "invalid");
const code = (v) => { if (typeof v !== "string" || !/^\d{1,3}$/.test(v)) return null; const n = Number(v); return n <= 255 ? n : null; };
/* undefined or empty: the start-up step never ran; a number outside 0-255 or anything else: not a code. */
function upStage(v) {
  if (v === undefined || v === "") return "not-reached";
  if (typeof v !== "string" || !/^\d{1,3}$/.test(v)) return "invalid";
  const n = Number(v);
  if (n > 255) return "invalid";
  return Object.hasOwn(UP, n) ? UP[n] : "other";
}

export function buildStageReceipt({ event, sha, tree, outcomes = {}, upRc, feelCode, receiptState, problems } = {}) {
  /* Missing or unreadable is never rendered as "no problems": only a valid receipt gives a problems list, otherwise it is null (unknown). */
  let state = typeof receiptState === "string" && RECEIPT_STATES.has(receiptState) ? receiptState : "invalid";
  if (state === "valid" && !Array.isArray(problems)) state = "invalid";
  const stages = {};
  for (const s of STAGES) stages[s] = s === "up" ? upStage(upRc) : outcome(outcomes[s]);
  return Object.freeze({ schema: 1, kind: "stage-receipt", event: typeof event === "string" && EVENTS.has(event) ? event : "other", sha: gitId(sha), tree: gitId(tree), stages: Object.freeze(stages), feelCode: code(feelCode), receiptState: state, problems: state === "valid" ? Object.freeze(mapProblems(problems)) : null });
}

/* One printable-ASCII line built only from the closed values above. */
export function summaryLine(r) {
  const parts = [`stage-receipt event=${r.event} sha=${r.sha} tree=${r.tree}`, ...STAGES.map((s) => `${s}=${r.stages[s]}`), `feel_code=${r.feelCode === null ? "none" : r.feelCode}`, `receipt=${r.receiptState}`, `problems=${r.problems === null ? "unknown" : r.problems.length ? r.problems.join(",") : "none"}`];
  const line = parts.join(" ");
  if (!/^[\x20-\x7e]{1,600}$/.test(line)) throw new Error("stage receipt line is not plain");
  return line;
}

if (process.argv[1] && import.meta.url === new URL(`file://${path.resolve(process.argv[1])}`).href) {
  const dir = process.argv[2];
  if (!dir) { console.error("usage: ci-stage-receipt.mjs DIR"); process.exit(2); }
  const e = process.env, o = {};
  for (const [stage, key] of [["checkout", "O_CHECKOUT"], ["preflight", "O_PREFLIGHT"], ["dependencies", "O_DEPENDENCIES"], ["driver", "O_DRIVER"], ["toolchain", "O_TOOLCHAIN"], ["build", "O_BUILD"], ["feel", "O_FEEL"], ["verdict", "O_VERDICT"], ["stop", "O_STOP"]]) o[stage] = e[key];
  let upRc;
  try { const f = path.join(dir, "up-rc.txt"), st = fs.statSync(f); upRc = st.isFile() && st.size <= 8 ? fs.readFileSync(f, "utf8").trim() : "invalid"; } catch (err) { upRc = undefined; }
  /* absent: nothing readable at that path; invalid: not a plain file, over 64 KB, not JSON, or no problems list; valid: a plain small JSON file with a problems list. */
  let receiptState = "absent", problems;
  try {
    const f = path.join(dir, "fixture-receipt.json"), st = fs.statSync(f);
    if (!st.isFile() || st.size > 65536) receiptState = "invalid";
    else { const doc = JSON.parse(fs.readFileSync(f, "utf8")); if (doc && Array.isArray(doc.problems)) { receiptState = "valid"; problems = doc.problems; } else receiptState = "invalid"; }
  } catch (err) { receiptState = err && err.code === "ENOENT" ? "absent" : "invalid"; }
  const r = buildStageReceipt({ event: e.EVENT, sha: e.SHA, tree: e.TREE_SHA, outcomes: o, upRc, feelCode: e.FEEL_CODE, receiptState, problems });
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "stage-receipt.json"), JSON.stringify(r, null, 2) + "\n", { flag: "wx" });
  process.stdout.write(summaryLine(r) + "\n");
}
