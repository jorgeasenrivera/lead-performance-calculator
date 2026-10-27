/* Fixed-vocabulary workflow annotations for scripts/browser-security-cases.mjs. Diagnostic only.
 *
 * Why this exists. When the cases job fails, the check carries no per-case information, and the log and the artifact may not be readable by whoever is reviewing it.
 * GitHub workflow commands (::error, ::warning, ::notice) become check annotations. This module is the ONLY place the harness is allowed to write them.
 *
 * What it can say. A closed set of classes, each with one static sentence; case ids, group names and phase names from closed sets copied out of the harness source
 * (test/safe-annotations.test.mjs compares them with the harness text, so a drift fails loudly); and Y/N flags. It cannot say anything else: there is no parameter that
 * carries text, an error, a message, a detail, a request, a path, a URL, a number, a duration or a payload, so none of those can reach the output.
 *
 * What it never does. It never throws, never awaits, never reads or writes a file, never changes an exit code, never decides a verdict (the harness's own exit
 * expression stays the only one), and when its writer fails it stops and does not try a second write. A request that is not exactly one of the closed shapes is refused;
 * the refusal is a fixed sentence that does not repeat the request.
 *
 * Budget. GitHub shows a limited number of annotations per level per step. Each category has its own share, and the terminal summary has a share that earlier notices
 * cannot use up.
 */

const freezeSet = (list) => new Set(list);
const LEVELS = freezeSet(["error", "warning", "notice"]);
const SCOPES = freezeSet(["corrected", "baseline"]);
const STATUSES = freezeSet(["PASS", "FAIL", "NOT RUN"]);

/* The ids the harness expects, in its own order: "A1", the XC ids, the three XC- ids, then A2 to A12. Copied from EXPECTED_IDS at head 3738544; the test checks this list against the harness text. */
export const EXPECTED_IDS = Object.freeze([
  "A1",
  "B-roll-blank", "B-roll-spaces", "B-roll-dash", "B-roll-sold-blank", "B-roll-sold-dash", "C12-roll-zero", "C13-roll-half", "B-roll-malformed",
  "C11-people-unknown", "C11-people-unknown-vs-roll", "C11-people-unknown-vs-unknown", "C12-people-zero", "C12-people-zero-vs-store-zero", "C13-people-half",
  "B-people-mixed", "B-people-opps-unknown", "CHAR-clean-unknown-offboard", "CHAR-clean-matching-plus-unknown", "CHAR-clean-unknown-onboard", "B-people-nan",
  "XC-reopen", "XC-session", "XC-renderers",
  "A2", "A3", "A4", "A5", "A6", "A7", "A8", "A9", "A10", "A11", "A12",
]);
/* Ids the harness records that are not in EXPECTED_IDS: the cross-check suite's own failure record and the runner's. They can be named in a failure line, never counted as coverage. */
export const INTERNAL_IDS = Object.freeze(["RUNNER", "XC-suite"]);
export const GROUPS = Object.freeze(["login", "cross-check", "recovery", "backup", "schedule"]);
export const PHASES = Object.freeze(["KIT_LAUNCHED", "DIAGNOSTICS_OK", "CASES_END"]);

const EXPECTED_SET = freezeSet(EXPECTED_IDS);
const NAMEABLE_SET = freezeSet([...EXPECTED_IDS, ...INTERNAL_IDS]);
const GROUP_SET = freezeSet(GROUPS);
const PHASE_SET = freezeSet(PHASES);

/* class -> category and one static sentence. A Map, so no inherited key can ever be a class. Sentences use letters, spaces, commas and full stops only. */
const CLASSES = new Map([
  ["PHASE", { cat: "phase", text: "Phase reached." }],
  ["CASE_FAILED", { cat: "case", text: "A case did not pass." }],
  ["CASE_EXCEPTION", { cat: "case", text: "A case ended with a caught exception." }],
  ["CASE_NOT_RUN", { cat: "case", text: "A case did not run." }],
  ["GROUP_DEADLINE", { cat: "event", text: "A case group reached its internal deadline." }],
  ["RUN_DEADLINE", { cat: "event", text: "The run reached its internal deadline." }],
  ["RUNNER_EXCEPTION", { cat: "event", text: "The run ended with a caught exception." }],
  ["COVERAGE", { cat: "terminal", text: "Case coverage is incomplete." }],
  ["AUDIT_MISSING", { cat: "terminal", text: "No renderer sandbox audit ran." }],
  ["RUN_SUMMARY", { cat: "terminal", text: "Run summary." }],
  ["REJECTED", { cat: "reject", text: "An annotation request was refused." }],
]);
/* How many of each category may be written at each level. Error and notice totals are 10 each, warning 3, under GitHub's per-step display limit. The terminal share is reserved: no other category can take it. */
const CAPS = {
  error: new Map([["case", 5], ["event", 2], ["terminal", 3]]),
  notice: new Map([["phase", 8], ["case", 1], ["terminal", 1]]),
  warning: new Map([["reject", 3]]),
};
/* A baseline run never writes an error (everything is a notice, labelled characterization), so its notices carry what the corrected run's errors carry: a few case notices, the events, and the terminal share (coverage, audit, summary). Ten notices in all, the same display limit. */
const BASELINE_CAPS = {
  error: new Map(),
  notice: new Map([["phase", 4], ["case", 1], ["event", 2], ["terminal", 3]]),
  warning: CAPS.warning,
};
export const MAX_IDS_IN_LINE = 12;

const TOKEN = /^[A-Za-z0-9-]{1,48}$/;
const isPlainObject = (o) => { if (o === null || typeof o !== "object") return false; const p = Object.getPrototypeOf(o); return p === Object.prototype || p === null; };
/* Own, enumerable, DATA properties only: an inherited value, an accessor or a symbol is a refusal, never read. */
function dataFields(obj, allowedKeys) {
  if (!isPlainObject(obj)) throw 0;
  const out = {};
  for (const key of Reflect.ownKeys(obj)) {
    if (typeof key !== "string" || !allowedKeys.has(key)) throw 0;
    const d = Object.getOwnPropertyDescriptor(obj, key);
    if (!d || !("value" in d) || !d.enumerable) throw 0;
    out[key] = d.value;
  }
  return out;
}
const asIdList = (value, max) => {
  if (!Array.isArray(value) || value.length < 1 || value.length > max) throw 0;
  const seen = new Set(), out = [];
  for (let i = 0; i < value.length; i++) {
    if (!Object.prototype.hasOwnProperty.call(value, i)) throw 0;   // a hole
    const d = Object.getOwnPropertyDescriptor(value, i);
    if (!d || !("value" in d)) throw 0;
    const v = d.value;
    if (typeof v !== "string" || !TOKEN.test(v) || !NAMEABLE_SET.has(v) || seen.has(v)) throw 0;
    seen.add(v); out.push(v);
  }
  return out;
};

/* Coverage is the trusted list minus what was actually observed, by unique id with an exact status. Nothing the results object claims about itself (an expectedIds field, a count) is read. */
export function coverageOf(results) {
  const out = { missing: [], duplicate: false, unknownStatus: false, unknownId: false, invalid: false };
  try {
    if (!Array.isArray(results)) { out.invalid = true; out.missing = EXPECTED_IDS.slice(); return out; }
    const seen = new Set();
    for (let i = 0; i < results.length; i++) {
      const d = Object.getOwnPropertyDescriptor(results, i);
      const r = d && "value" in d ? d.value : undefined;
      if (!isPlainObject(r)) { out.invalid = true; continue; }
      const id = Object.getOwnPropertyDescriptor(r, "id"), st = Object.getOwnPropertyDescriptor(r, "status");
      const idv = id && "value" in id ? id.value : undefined, stv = st && "value" in st ? st.value : undefined;
      if (typeof stv !== "string" || !STATUSES.has(stv)) { out.unknownStatus = true; continue; }
      if (typeof idv !== "string" || !NAMEABLE_SET.has(idv)) { out.unknownId = true; continue; }
      if (!EXPECTED_SET.has(idv)) continue;   // an internal id: never coverage
      if (seen.has(idv)) { out.duplicate = true; continue; }
      seen.add(idv);
    }
    out.missing = EXPECTED_IDS.filter((id) => !seen.has(id));
  } catch { out.invalid = true; out.missing = EXPECTED_IDS.slice(); }
  return out;
}

/* A writer that cannot throw into the caller. The default is the process's own stdout, as console.log already uses. */
const defaultWrite = (line) => { process.stdout.write(line); };

export function createAnnotator(options) {
  let scope = null, write = defaultWrite, broken = false, groupDeadlineFired = false, lastPhase = null;
  const used = { error: new Map(), notice: new Map(), warning: new Map() };
  const reported = new Set();
  try {
    const o = dataFields(options, freezeSet(["scope", "write"]));
    if (typeof o.scope === "string" && SCOPES.has(o.scope)) scope = o.scope;
    if (o.write !== undefined) { if (typeof o.write !== "function") throw 0; write = o.write; }
  } catch { scope = null; }

  /* The one place a line is produced. Everything about a request is validated here; the caller's strings are never copied, only chosen from the closed sets. */
  function emit(cls, fields) {
    try {
      if (broken || scope === null) return false;
      const def = typeof cls === "string" ? CLASSES.get(cls) : undefined;
      if (!def) throw 0;
      const f = dataFields(fields === undefined ? {} : fields, freezeSet(["phase", "group", "ids", "more", "flags", "level"]));
      let level = def.cat === "reject" ? "warning" : "error";
      if (f.level !== undefined) { if (typeof f.level !== "string" || !LEVELS.has(f.level) || f.level === "warning") throw 0; level = f.level; }
      if (def.cat === "phase") level = "notice";
      if (scope === "baseline" && level === "error") level = "notice";   // a baseline run is characterization: it can never be an error
      const tail = [];
      if (f.phase !== undefined) { if (typeof f.phase !== "string" || !PHASE_SET.has(f.phase)) throw 0; tail.push("phase=" + f.phase); }
      if (f.group !== undefined) { if (typeof f.group !== "string" || !GROUP_SET.has(f.group)) throw 0; tail.push("group=" + f.group); }
      let ids = null;
      if (f.ids !== undefined) { ids = asIdList(f.ids, 64); tail.push("ids=" + ids.slice(0, MAX_IDS_IN_LINE).join(",")); if (ids.length > MAX_IDS_IN_LINE) tail.push("more=Y"); }
      if (f.more !== undefined) { if (f.more !== true) throw 0; }
      if (f.flags !== undefined) {
        const fl = dataFields(f.flags, freezeSet(["failed", "skipped", "missing", "audit", "deadline", "exception", "probe", "only", "dup", "unknownstatus", "unknownid", "invalid"]));
        for (const key of Object.keys(fl)) { if (typeof fl[key] !== "boolean") throw 0; tail.push(key + "=" + (fl[key] ? "Y" : "N")); }
      }
      const share = (scope === "baseline" ? BASELINE_CAPS : CAPS)[level].get(def.cat);
      if (!share) throw 0;
      const have = used[level].get(def.cat) || 0;
      const key = cls + "|" + tail.join(" ");
      if (reported.has(key)) return false;       // the same line is never written twice
      if (have >= share) return false;           // this category's share is spent; the others are untouched
      used[level].set(def.cat, have + 1); reported.add(key);
      const body = (scope === "baseline" ? "Characterization only. " : "") + def.text + (tail.length ? " " + tail.join(" ") : "");
      try { write(`::${level} title=${cls}::${body}\n`); } catch { broken = true; }   // best effort: no second write, no fallback, nothing thrown
      return true;
    } catch {
      refuse();
      return false;
    }
  }
  /* A refused request is reported once per category share, with a fixed sentence that does not repeat the request. It cannot recurse: it does not validate anything. */
  function refuse() {
    try {
      if (broken || scope === null) return;
      const have = used.warning.get("reject") || 0;
      if (have >= CAPS.warning.get("reject")) return;
      used.warning.set("reject", have + 1);
      write(`::warning title=REJECTED::${scope === "baseline" ? "Characterization only. " : ""}${CLASSES.get("REJECTED").text}\n`);
    } catch { broken = true; }
  }

  return Object.freeze({
    /* ---- hooks the harness calls; each returns nothing and cannot throw ---- */
    phase(name) { try { if (typeof name === "string" && PHASE_SET.has(name)) { lastPhase = name; emit("PHASE", { phase: name }); } else refuse(); } catch { /* nothing */ } },
    group(name) { try { if (typeof name === "string" && GROUP_SET.has(name)) emit("PHASE", { group: name }); else refuse(); } catch { /* nothing */ } },
    /* One finished case record. FAIL is CASE_FAILED unless the record carries caught === true, which only a catch block sets. */
    caseRecord(record) {
      try {
        const r = dataFields(record, freezeSet(["id", "title", "status", "detail", "evidence", "caught"]));   // title, detail and evidence are allowed to exist; they are never read
        const id = r.id, status = r.status;
        if (typeof status !== "string" || !STATUSES.has(status)) { refuse(); return; }
        if (status === "PASS") return;
        if (typeof id !== "string" || !NAMEABLE_SET.has(id)) { refuse(); return; }
        const cls = status === "NOT RUN" ? "CASE_NOT_RUN" : r.caught === true ? "CASE_EXCEPTION" : "CASE_FAILED";
        emit(cls, { ids: [id] });
      } catch { refuse(); }
    },
    /* The harness's own group timer fired. The group name is one of the five in the run loop. */
    groupDeadline(name) { try { groupDeadlineFired = true; if (typeof name === "string" && GROUP_SET.has(name)) emit("GROUP_DEADLINE", { group: name }); else emit("GROUP_DEADLINE", {}); } catch { /* nothing */ } },
    /* The harness's own run timer fired. */
    runDeadline() { try { emit("RUN_DEADLINE", lastPhase ? { phase: lastPhase } : {}); } catch { /* nothing */ } },
    /* The outer catch. A group deadline that already fired is not also reported as an exception. */
    runnerException() { try { if (!groupDeadlineFired) emit("RUNNER_EXCEPTION", {}); } catch { /* nothing */ } },
    groupDeadlineFired() { return groupDeadlineFired === true; },
    /* The end of the run. Reads the same facts the harness's exit expression reads, as booleans, and the results for coverage; it decides nothing. */
    terminal(facts) {
      try {
        const t = dataFields(facts, freezeSet(["failed", "skipped", "missing", "audit", "deadline", "exception", "probe", "only", "results"]));
        for (const key of ["failed", "skipped", "missing", "audit", "deadline", "exception", "probe", "only"]) if (typeof t[key] !== "boolean") throw 0;
        if (!t.only) {
          const cov = coverageOf(t.results);
          if (cov.missing.length || cov.duplicate || cov.unknownStatus || cov.unknownId || cov.invalid) {
            const f = { dup: cov.duplicate, unknownstatus: cov.unknownStatus, unknownid: cov.unknownId, invalid: cov.invalid };
            emit("COVERAGE", cov.missing.length ? { ids: cov.missing, flags: f } : { flags: f });
          }
        }
        if (!t.audit) emit("AUDIT_MISSING", {});
        const bad = t.failed || t.skipped || t.missing || !t.audit || t.deadline || t.exception || t.probe;
        emit("RUN_SUMMARY", { level: bad ? "error" : "notice", flags: { failed: t.failed, skipped: t.skipped, missing: t.missing, audit: t.audit, deadline: t.deadline, exception: t.exception, probe: t.probe, only: t.only } });
      } catch { refuse(); }
    },
  });
}
