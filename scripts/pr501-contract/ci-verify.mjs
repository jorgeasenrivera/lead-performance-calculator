// PR501 versioned-contract verification for CI. Read-only against the repository; every output is a NEW file (flag wx) in a
// NEW directory; nothing is removed, renamed or chmod'ed. It does not change the original 106-row guard, vercel.json or any app file.
//
// What it proves, in order:
//  1. BINDING. The head checkout's commit is exactly the event head (github.event.pull_request.head.sha). The merge checkout's
//     commit is exactly GITHUB_SHA; if it is a synthetic merge commit, its second parent is the event head. Everything else is
//     read from Git objects of those revisions, never from working-tree state.
//  2. PINS. The delta declaration, the validator and the TypeScript used for the AST check match values pinned by the caller.
//  3. DEFAULT GUARD UNCHANGED. scripts/search-runtime.sha256 and vercel.json in the head commit equal the frozen / approved bytes.
//  4. CONTRACT. The composed tree (clean 47757af + the approved canonical patch, applied exactly) is rebuilt in an isolated
//     directory and validated by the unchanged validator against the caller's EXTERNAL contract digest.
//  5. DELTA. The head commit's tracked tree is exactly the composed tree plus the declared tooling files plus the reviewed integration-delta map
//     (integration-delta.json: exact old git entry to exact new sha256 for a few existing paths, exact new paths; no wildcard; never a contract row,
//     pin, vercel.json or contract tooling). No removal, no other mode or blob change, no undeclared addition. The workflow keeps its own old-blob
//     plus template-render check. It never claims the whole tree equals the composed tree.
//  0. BASELINES. Hosted checkouts contain .git, which the validator's tree hash would count. Each baseline checkout is therefore turned
//     into a NEW tracked-only export (git archive of the exact commit) and only the exports are passed to the validator. The checkouts and
//     their history are kept; the tree hash is not weakened; nothing is deleted.
//  6. MERGE. The synthetic merge checkout's tracked tree equals the head's, or the run stops with REQUALIFICATION_REQUIRED.
// Exit codes: 0 pass, 1 fail, 3 requalification required.
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { execFileSync, spawnSync } from "node:child_process";
import { pathToFileURL, fileURLToPath } from "node:url";
import * as ID from "./integration-delta.mjs";
import * as WC from "./workflow-compose.mjs";

const env = process.env;
const sha256 = (b) => createHash("sha256").update(b).digest("hex");
const blobSha1 = (b) => createHash("sha1").update(Buffer.concat([Buffer.from(`blob ${b.length}\0`), b])).digest("hex");
const CONTRACT = "scripts/pr501-contract";
const WORKFLOW_MODIFIED = ".github/workflows/manager-spacing.yml";   // the EXISTING job, edited in place for this branch only
// The workflow supplies the pins, so it is the ONE bootstrap exception: it is covered by independent diff review and cannot be hash-pinned from inside the repository
// without a cycle. The runner therefore does not trust it; it RECOMPUTES it: the exact old blob below, with the three reviewed insertions (workflow-insert*.yml, themselves
// hash-bound by the delta declaration; see workflow-compose.mjs) rendered with the pins it was given, must equal the head file byte for byte. Any other byte, step or condition is refused.
const OLD_WORKFLOW_BLOB = "6d3044a40378082789b0f9ba05b0a6e418a36853";   // git blob of manager-spacing.yml at 47757af and in the composed tree
const req = (k) => { if (!env[k]) { console.error(`missing ${k}`); process.exit(2); } return env[k]; };
const OUT = path.resolve(req("OUT_DIR"));
fs.mkdirSync(OUT);                                          // throws if it exists: never reuse an output directory
const result = { checks: [], failures: [], binding: {} };
const wx = (name, data) => fs.writeFileSync(path.join(OUT, name), typeof data === "string" ? data : JSON.stringify(data, null, 1) + "\n", { flag: "wx" });
const ok = (name, detail) => result.checks.push({ name, ok: true, detail });
const bad = (name, detail) => { result.checks.push({ name, ok: false, detail }); result.failures.push(`${name}: ${typeof detail === "string" ? detail : JSON.stringify(detail)}`); };
function finish(code) {
  result.status = code === 0 ? "PASS_CONDITIONAL_PENDING_INDEPENDENT_APPROVAL" : code === 3 ? "REQUALIFICATION_REQUIRED" : "FAIL";
  wx("result.json", result);
  console.log(JSON.stringify({ status: result.status, failures: result.failures, binding: result.binding }, null, 1));
  process.exit(code);
}
const git = (dir, args, buf = false) => execFileSync("git", ["-C", dir, ...args], { encoding: buf ? null : "utf8", maxBuffer: 1 << 28 });
const blobAt = (dir, rev, p) => { try { return git(dir, ["cat-file", "blob", `${rev}:${p}`], true); } catch { return null; } };
function listCommit(dir, rev) {
  const out = git(dir, ["ls-tree", "-r", "-z", rev], true).toString("utf8").split("\0").filter(Boolean);
  return new Map(out.map((l) => { const m = /^(\d+) (\w+) ([0-9a-f]{40})\t(.+)$/s.exec(l); return [m[4], { mode: m[1], blob: m[3] }]; }));
}
function listDir(root, rel = "") {            // same notion of a tracked entry as Git: modes, symlinks as blobs of their target, empty dirs skipped
  const m = new Map();
  for (const n of fs.readdirSync(path.join(root, rel))) {
    const r = rel ? `${rel}/${n}` : n, abs = path.join(root, r), st = fs.lstatSync(abs);
    if (st.isSymbolicLink()) m.set(r, { mode: "120000", blob: blobSha1(Buffer.from(fs.readlinkSync(abs))) });
    else if (st.isDirectory()) for (const [k, v] of listDir(root, r)) m.set(k, v);
    else m.set(r, { mode: st.mode & 0o111 ? "100755" : "100644", blob: blobSha1(fs.readFileSync(abs)) });
  }
  return m;
}
const same = (a, b) => a && b && a.mode === b.mode && a.blob === b.blob;

try {
  const HEAD_DIR = req("CHECKOUT_HEAD"), MERGE_DIR = req("CHECKOUT_MERGE");
  const HEAD_REV = env.HEAD_REV || "HEAD", MERGE_REV = env.MERGE_REV || "HEAD";
  const EVENT_HEAD = req("EVENT_HEAD_SHA"), GH_SHA = req("GITHUB_SHA");
  // No shared "history" repository. A separate actions/checkout does NOT add objects to the head checkout's object database, so each baseline is authenticated against the
  // object database of ITS OWN dedicated checkout (frozen against FROZEN_469_DIR, main against BASE_MAIN_DIR, the composed base against BASE_477_DIR).
  const FROZEN = req("FROZEN_469_DIR"), BASE_MAIN = req("BASE_MAIN_DIR"), BASE_477 = req("BASE_477_DIR");
  const EXPECTED_DIGEST = req("EXPECTED_CONTRACT_DIGEST"), EXPECTED_DELTA = req("EXPECTED_DELTA_SHA256"), EXPECTED_VALIDATOR = req("EXPECTED_VALIDATOR_SHA256");
  req("EXPECTED_TS_VERSION"); req("EXPECTED_TS_LIB_SHA256");

  // 1. BINDING --------------------------------------------------------------------------------------------------------------
  const headSha = git(HEAD_DIR, ["rev-parse", "--verify", `${HEAD_REV}^{commit}`]).trim();
  const mergeSha = git(MERGE_DIR, ["rev-parse", "--verify", `${MERGE_REV}^{commit}`]).trim();
  const mergeParents = git(MERGE_DIR, ["rev-list", "--parents", "-n", "1", mergeSha]).trim().split(" ").slice(1);
  result.binding = { eventHeadSha: EVENT_HEAD, githubSha: GH_SHA, headCheckoutCommit: headSha, mergeCheckoutCommit: mergeSha, mergeParents,
    headTree: git(HEAD_DIR, ["rev-parse", `${headSha}^{tree}`]).trim(), mergeTree: git(MERGE_DIR, ["rev-parse", `${mergeSha}^{tree}`]).trim() };
  headSha === EVENT_HEAD ? ok("head checkout is the event head", headSha) : bad("head checkout is the event head", `checkout ${headSha} != event head ${EVENT_HEAD}`);
  mergeSha === GH_SHA ? ok("merge checkout is GITHUB_SHA", mergeSha) : bad("merge checkout is GITHUB_SHA", `checkout ${mergeSha} != GITHUB_SHA ${GH_SHA}`);
  if (mergeSha === headSha) ok("merge checkout form", "the head commit itself (no synthetic merge commit)");
  else if (mergeParents.length === 2 && mergeParents[1] === EVENT_HEAD) ok("merge checkout form", `synthetic merge of base ${mergeParents[0]} and the event head`);
  else bad("merge checkout form", `parents ${JSON.stringify(mergeParents)}: second parent must be the event head`);
  if (result.failures.length) finish(1);

  // 2. PINS: everything below is read from the head COMMIT, not the working tree --------------------------------------------
  const cb = (p) => blobAt(HEAD_DIR, headSha, `${CONTRACT}/${p}`);
  const deltaBlob = cb("DELTA.sha256");
  if (!deltaBlob) { bad("delta declaration", "scripts/pr501-contract/DELTA.sha256 missing in the head commit"); finish(1); }
  sha256(deltaBlob) === EXPECTED_DELTA ? ok("delta declaration pinned", EXPECTED_DELTA) : bad("delta declaration pinned", `${sha256(deltaBlob)} != ${EXPECTED_DELTA}`);
  const declared = new Map();                 // path -> sha256 (or null for the workflow, which cannot hash itself)
  for (const l of deltaBlob.toString("utf8").trim().split("\n")) { const m = /^([0-9a-f]{64})  (.+)$/.exec(l); if (!m) { bad("delta declaration syntax", l); continue; } declared.set(m[2], m[1]); }
  declared.set(`${CONTRACT}/DELTA.sha256`, EXPECTED_DELTA);
  // Every file the runner executes or reads is hash-bound by DELTA.sha256, whose own sha256 is pinned above; the workflow step also checks them BEFORE any code runs.
  for (const [p, h] of declared) {
    if (h === null) continue;
    const b = blobAt(HEAD_DIR, headSha, p);
    if (!b) bad("declared delta file present", `${p} missing`); else if (sha256(b) !== h) bad("declared delta file bytes", `${p} differs from the declaration`);
  }
  if (!result.failures.length) ok("declared delta files match their declared sha256", `${declared.size} paths`);
  const valPath = env.VALIDATOR_PATH || path.join(HEAD_DIR, CONTRACT, "validator/validate-candidate.mjs");
  const valBytes = fs.readFileSync(valPath), valBlob = cb("validator/validate-candidate.mjs");
  if (sha256(valBytes) !== EXPECTED_VALIDATOR) bad("validator pinned", `${sha256(valBytes)} != ${EXPECTED_VALIDATOR}`);
  else if (!valBlob || sha256(valBlob) !== EXPECTED_VALIDATOR) bad("validator equals the committed copy", "working file and head commit differ");
  else ok("validator pinned and equals the committed copy", EXPECTED_VALIDATOR);
  const tsDir = env.PR501_TS_PATH;
  {
    try {
      const tsVer = JSON.parse(fs.readFileSync(path.join(tsDir, "package.json"), "utf8")).version, tsLib = sha256(fs.readFileSync(path.join(tsDir, "lib/typescript.js")));
      tsVer === env.EXPECTED_TS_VERSION && tsLib === env.EXPECTED_TS_LIB_SHA256 ? ok("TypeScript for the AST check pinned", `${tsVer} ${tsLib}`) : bad("TypeScript for the AST check pinned", { tsVer, tsLib });
    } catch (e) { bad("TypeScript for the AST check pinned", `unreadable: ${e.message}`); }
  }
  if (result.failures.length) finish(1);

  // 0. BASELINE EXPORTS: tracked-only, from the exact commits, into NEW directories under OUT_DIR ----------------------------------
  const meta = JSON.parse(cb("contract/candidate.meta.json").toString("utf8"));
  const sc = JSON.parse(cb("contract/composed-scalars.json").toString("utf8"));
  const EXP = path.join(OUT, "exports"); fs.mkdirSync(EXP);
  const exportAt = (dir, sha, label) => {
    if (!fs.existsSync(path.join(dir, ".git"))) return { dir, exported: false };   // already a plain tracked-only directory: the validator still proves its tree id equals the commit's
    const at = git(dir, ["rev-parse", "--verify", "HEAD^{commit}"]).trim();
    if (at !== sha) throw new Error(`${label}: checkout is at ${at}, expected ${sha}`);
    const dest = path.join(EXP, label); fs.mkdirSync(dest);
    const r = spawnSync("bash", ["-o", "pipefail", "-c", 'git -C "$1" archive --format=tar "$2" | tar -x -C "$3"', "bash", dir, sha, dest], { encoding: "utf8", maxBuffer: 1 << 26 });
    if (r.status !== 0) throw new Error(`${label}: git archive export failed: ${r.stderr}`);
    return { dir: dest, exported: true };
  };
  const eFrozen = exportAt(FROZEN, meta.frozenBaseline, "frozen-469"), eMain = exportAt(BASE_MAIN, meta.base, "base-main"), e477 = exportAt(BASE_477, sc.baseCommit, "base-477");
  result.binding.baselines = { frozen: { commit: meta.frozenBaseline, exported: eFrozen.exported }, main: { commit: meta.base, exported: eMain.exported }, base477: { commit: sc.baseCommit, exported: e477.exported } };
  ok("baseline checkouts exported tracked-only", result.binding.baselines);

  // 3. DEFAULT GUARD AND VERCEL UNCHANGED ------------------------------------------------------------------------------------
  const originalRef = cb("contract/original-search-runtime.sha256.reference"), approvedVercel = cb("contract/vercel.guarded.json");
  const headOriginal = blobAt(HEAD_DIR, headSha, "scripts/search-runtime.sha256"), headVercel = blobAt(HEAD_DIR, headSha, "vercel.json");
  headOriginal && originalRef && headOriginal.equals(originalRef) && sha256(headOriginal) === meta.originalManifestSha256 && fs.readFileSync(path.join(eFrozen.dir, "scripts/search-runtime.sha256")).equals(headOriginal)
    ? ok("default guard scripts/search-runtime.sha256 is the frozen original, byte for byte", meta.originalManifestSha256) : bad("default guard", "scripts/search-runtime.sha256 differs from the frozen original");
  headVercel && approvedVercel && headVercel.equals(approvedVercel) ? ok("vercel.json is the approved guarded file, byte for byte", sha256(headVercel)) : bad("vercel.json", "differs from the approved guarded file");
  if (result.failures.length) finish(1);

  // 4. CONTRACT: rebuild the composed tree in an isolated directory, validate with the unchanged validator --------------------
  const V = await import(pathToFileURL(path.resolve(valPath)).href);
  const patch = cb("contract/composed.canonical.git.patch");
  const snapFrozen = V.verifySnapshots(FROZEN, { frozen: { commit: meta.frozenBaseline, dir: eFrozen.dir } });
  const snapMain = V.verifySnapshots(BASE_MAIN, { base: { commit: meta.base, dir: eMain.dir } });
  const snap = { proofs: { frozen: snapFrozen.proofs.frozen, base: snapMain.proofs.base }, errors: [...snapFrozen.errors, ...snapMain.errors] };   // both proofs are issued by the validator
  const work = path.join(OUT, "work"); fs.mkdirSync(work);
  const comp = V.verifyComposed({ baseDir: e477.dir, baseCommit: sc.baseCommit, baseTreeId: sc.baseTreeId, repo: BASE_477,
    patches: [{ name: sc.patchName, sha256: sc.patchSha256, bytes: patch }], orderedListSha256: sc.orderedListSha256, cumulativeBytesSha256: sc.cumulativeBytesSha256,
    approvedTreeId: sc.approvedTreeId, approvedPaths: sc.approvedPaths, approvedFileHashes: sc.approvedFileHashes, workRoot: work });
  if (!comp.proof || snap.errors.length) { bad("composed proof", [...comp.errors, ...snap.errors]); finish(1); }
  ok("composed proof", `tree ${comp.proof.tree}`);
  const v = V.validate({ meta, originalText: originalRef.toString("utf8"), candidateText: cb("contract/search-runtime.pr501-final3-v1.sha256").toString("utf8"), approvedVercel,
    head: V.treeReader(comp.proof.root), orig: V.treeReader(eFrozen.dir), snapshots: { head: comp.proof, base: snap.proofs.base, frozen: snap.proofs.frozen }, expectedDigest: EXPECTED_DIGEST });
  wx("validator-result.json", v);
  v.status === V.PASS_COMPOSED ? ok("validator against the external contract digest", `${v.status} digest ${v.digest}`) : bad("validator against the external contract digest", { status: v.status, errors: v.errors.slice(0, 10), unqualified: v.unqualified });
  if (result.failures.length) finish(1);

  // 5. DELTA: head tracked tree = composed tree + the declared tooling files + the reviewed integration-delta map, exactly ------
  const headList = listCommit(HEAD_DIR, headSha), compList = listDir(comp.proof.root);
  const rowPaths = V.parseManifest(cb("contract/search-runtime.pr501-final3-v1.sha256").toString("utf8")).rows.map((r) => r[1]);
  const origPaths = V.parseManifest(originalRef.toString("utf8")).rows.map((r) => r[1]);
  const viol = [];
  // The one reviewed exception, kept separate and unchanged: the workflow is the old blob plus the template rendered with the supplied pins.
  { const e = compList.get(WORKFLOW_MODIFIED), h = headList.get(WORKFLOW_MODIFIED);
    if (!e || !h) viol.push(`${WORKFLOW_MODIFIED}: missing in the composed tree or in head`);
    else {
      const p = WORKFLOW_MODIFIED;
      const oldText = fs.readFileSync(path.join(comp.proof.root, p), "utf8"), headText = (blobAt(HEAD_DIR, headSha, p) || Buffer.alloc(0)).toString("utf8");
      const tpl = (n) => (cb(n) || Buffer.alloc(0)).toString("utf8");
      const pinsNow = { EXPECTED_CONTRACT_DIGEST: EXPECTED_DIGEST, EXPECTED_DELTA_SHA256: EXPECTED_DELTA, EXPECTED_VALIDATOR_SHA256: EXPECTED_VALIDATOR, EXPECTED_TS_VERSION: env.EXPECTED_TS_VERSION, EXPECTED_TS_LIB_SHA256: env.EXPECTED_TS_LIB_SHA256 };
      let rebuilt = null, why = null;
      try { rebuilt = WC.composeWorkflow({ oldText, tplA: tpl("workflow-insert.template.yml"), tplB: tpl("workflow-insert-measure.yml"), tplC: tpl("workflow-insert-final.yml"), pins: pinsNow }); } catch (e) { why = e.message; }
      if (e.blob !== OLD_WORKFLOW_BLOB) viol.push(`${p}: the composed (old) blob ${e.blob} is not the reviewed ${OLD_WORKFLOW_BLOB}`);
      else if (why) viol.push(`${p}: ${why}`);
      else if (h.mode !== e.mode) viol.push(`${p}: mode changed`);
      else if (headText !== rebuilt) viol.push(`${p}: differs from the old blob plus the three reviewed insertions rendered with the supplied pins`);
      else result.binding.workflow = { oldBlob: e.blob, headSha256: sha256(Buffer.from(headText)), matchesReviewedRender: true };
    } }
  // Every other composed path is identical in head unless the reviewed map lists its exact old and new entry. No wildcard, no allowlist of kinds of change.
  const idBlob = cb("integration-delta.json");
  if (!idBlob) viol.push("integration-delta.json missing in the head commit");
  else {
    const parsed = ID.parseIntegrationDelta(idBlob.toString("utf8"));
    if (parsed.errors.length) viol.push(...parsed.errors.map((x) => `integration delta: ${x}`));
    else {
      const pinPaths = Object.values(meta.pins || {});
      const r = ID.evaluateIntegrationDelta({ delta: parsed.delta, pending: parsed.pending, composed: compList, head: headList, declared: new Set(declared.keys()), special: new Set([WORKFLOW_MODIFIED]),
        forbidden: { paths: new Set([...rowPaths, ...origPaths, ...pinPaths, "scripts/search-runtime.sha256", "vercel.json"]), prefixes: [`${CONTRACT}/`] },
        headSha256: (p) => { const b = blobAt(HEAD_DIR, headSha, p); return b ? sha256(b) : null; } });
      viol.push(...r.violations);
      result.binding.integrationDelta = { status: parsed.delta ? parsed.delta.status : "PENDING", mapSha256: sha256(idBlob), ...(r.counts || {}) };
    }
  }
  viol.length ? bad("head tree = composed tree + declared tooling + reviewed integration delta", viol.slice(0, 40)) : ok("head tree = composed tree + declared tooling + reviewed integration delta", { composedPaths: compList.size, declaredToolingPaths: declared.size, headPaths: headList.size, integrationDelta: result.binding.integrationDelta });
  result.binding.delta = { composed: compList.size, declared: declared.size, head: headList.size, violations: viol.length };
  if (result.failures.length) finish(1);

  // 6. MERGE CHECKOUT ----------------------------------------------------------------------------------------------------------
  if (mergeSha === headSha || result.binding.mergeTree === result.binding.headTree) ok("merge checkout tree equals the head tree", result.binding.mergeTree);
  else {
    const ml = listCommit(MERGE_DIR, mergeSha), diffs = [];
    for (const [p, e] of headList) if (!same(ml.get(p), e)) diffs.push(`differs or missing in merge: ${p}`);
    for (const p of ml.keys()) if (!headList.has(p)) diffs.push(`only in merge: ${p}`);
    result.binding.mergeDifferences = { count: diffs.length, first: diffs.slice(0, 25) };
    bad("merge checkout tree equals the head tree", `REQUALIFICATION REQUIRED: base moved or tree differs (${diffs.length} paths)`);
    finish(3);
  }
  finish(result.failures.length ? 1 : 0);
} catch (e) { bad("runner error", String(e && e.stack ? e.stack : e).split("\n").slice(0, 6).join(" | ")); finish(1); }
