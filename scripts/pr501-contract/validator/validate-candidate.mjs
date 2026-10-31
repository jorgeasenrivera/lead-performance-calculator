// PR501 candidate fingerprint contract: LOCAL validator prototype, v2.
// Fail-closed. A missing input is a failure, never a skipped check. The
// prototype cannot approve its own contract: a PASS needs a contract digest
// that the CALLER supplies from outside, and even then the status stays
// "pending independent approval".
import { createHash } from "node:crypto";
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

export const PASS = "PASS_CONDITIONAL_PENDING_INDEPENDENT_APPROVAL";
export const PASS_COMPOSED = "PASS_COMPOSED_CONDITIONAL_PENDING_INDEPENDENT_APPROVAL";
const sha = (buf) => createHash("sha256").update(buf).digest("hex");
const LINE = /^([0-9a-f]{64}) {2}(\S.*)$/;
const VALIDATOR_FILE = fileURLToPath(import.meta.url);

// ---------------------------------------------------------------- readers
// A reader never leaves its root. Every path component from the root down is
// checked with lstat, so a symlink in ANY ancestor directory, or as the final
// entry, is refused; so is a path that climbs out with "..". Limit: the check
// and the read are separate calls, so this is for a quiet local checkout, not a
// tree another process can rewrite concurrently.
const safeRel = (p) => {
  if (typeof p !== "string" || p.includes("\0") || p.includes("\\") || path.posix.isAbsolute(p)) return null;
  const n = path.posix.normalize(p);
  return n === ".." || n.startsWith("../") ? null : n === "." ? "" : n;
};
export function treeReader(root, overlay = null) {
  let base = null;
  try { base = fs.realpathSync(root); } catch { /* every read and list then returns nothing */ }
  const walk = (rel) => {
    if (base === null) return null;
    let cur = base;
    for (const seg of rel.split("/").filter(Boolean)) {
      cur = path.join(cur, seg);
      try { if (fs.lstatSync(cur).isSymbolicLink()) return null; } catch { return null; }
    }
    return cur;
  };
  const read = (p) => {
    const rel = safeRel(p);
    if (rel === null || rel === "") return null;
    if (overlay?.has(rel)) return overlay.get(rel) === null ? null : Buffer.from(overlay.get(rel));
    const abs = walk(rel);
    try { return abs && fs.lstatSync(abs).isFile() ? fs.readFileSync(abs) : null; } catch { return null; }
  };
  // Classifies a path without following any symlink: "file", "dir", "other", "missing" (nothing there, or an
  // ancestor is absent) or "blocked" (a symlink in any ancestor or as the final entry, an unsafe path, no root).
  const stat = (p) => {
    const rel = safeRel(p);
    if (rel === null || rel === "" || base === null) return { type: "blocked" };
    if (overlay?.has(rel)) return { type: overlay.get(rel) === null ? "missing" : "file" };
    const segs = rel.split("/").filter(Boolean);
    let cur = base;
    for (let i = 0; i < segs.length; i++) {
      cur = path.join(cur, segs[i]);
      let st; try { st = fs.lstatSync(cur); } catch { return { type: "missing" }; }
      if (st.isSymbolicLink()) return { type: "blocked" };
      if (i === segs.length - 1) return { type: st.isFile() ? "file" : st.isDirectory() ? "dir" : "other" };
      if (!st.isDirectory()) return { type: "blocked" };
    }
    return { type: "missing" };
  };
  return {
    root, overlaid: Boolean(overlay), read, stat,
    list(dir) {
      const rel = safeRel(dir);
      if (rel === null) return [];
      const abs = walk(rel);
      let names = [];
      try { if (abs && fs.lstatSync(abs).isDirectory()) names = fs.readdirSync(abs); } catch { names = []; }
      const set = new Set(names);
      if (overlay) for (const k of overlay.keys()) if (path.posix.dirname(k) === (rel || ".")) set.add(path.posix.basename(k));
      return [...set].filter((n) => read(rel ? `${rel}/${n}` : n) !== null);
    },
  };
}

// ----------------------------------------------- Git-bound source snapshots
// The Git tree id of a directory, computed the way Git does, so a directory
// can be proven to be exactly what a commit contains.
const gitHash = (type, body) => createHash("sha1").update(Buffer.concat([Buffer.from(`${type} ${body.length}\0`), body])).digest();
export function gitTreeSha(dir) {
  const ents = [];
  for (const n of fs.readdirSync(dir)) {
    const p = path.join(dir, n), st = fs.lstatSync(p);
    if (st.isSymbolicLink()) ents.push({ n, k: n, mode: "120000", raw: gitHash("blob", Buffer.from(fs.readlinkSync(p))) });
    else if (st.isDirectory()) { const t = gitTreeSha(p); if (t) ents.push({ n, k: `${n}/`, mode: "40000", raw: Buffer.from(t, "hex") }); }
    else ents.push({ n, k: n, mode: st.mode & 0o111 ? "100755" : "100644", raw: gitHash("blob", fs.readFileSync(p)) });
  }
  if (!ents.length) return null;
  ents.sort((a, b) => Buffer.compare(Buffer.from(a.k), Buffer.from(b.k)));
  return gitHash("tree", Buffer.concat(ents.map((e) => Buffer.concat([Buffer.from(`${e.mode} ${e.n}\0`), e.raw])))).toString("hex");
}
// specs: { head|base|frozen: { commit, dir } }. Returns proof objects.
// Only proofs made here are trusted by validate(); a hand-built object that
// looks the same is refused.
const issued = new WeakSet();
export function verifySnapshots(repo, specs) {
  const out = {}, errors = [];
  for (const [label, { commit, dir }] of Object.entries(specs)) {
    let want = null;
    try { want = execFileSync("git", ["-C", repo, "rev-parse", "--verify", "--quiet", `${commit}^{tree}`], { encoding: "utf8" }).trim(); }
    catch { errors.push(`${label}: commit ${commit} not found in ${repo}`); continue; }
    let got = null;
    try { got = gitTreeSha(dir); } catch { errors.push(`${label}: cannot read ${dir}`); continue; }
    if (got !== want) errors.push(`${label}: checkout at ${dir} is not commit ${commit} (tree ${got} != ${want})`);
    const proof = Object.freeze({ kind: "commit", commit, root: dir, tree: got, verified: got === want });
    issued.add(proof);
    out[label] = proof;
  }
  return { proofs: out, errors };
}

// ------------------------------------------------ composed provenance
// A composed tree = a clean, authenticated base tree + externally approved patches applied in order. It is a
// separate proof kind from a commit: it never stands in for one, and a later real commit must be tree-equal to it.
// Everything that approves it (base commit and tree id, the ordered-list digest, the cumulative patch-bytes sha256,
// per-patch sha256, final tree id, touched paths, reviewed file hashes) is supplied by the caller.
// Append-only: nothing in this module deletes anything. A failed composition leaves its work tree where it is and
// reports the path in `retained`, so the failing state stays available as evidence.
const HEX40 = /^[0-9a-f]{40}$/, HEX64 = /^[0-9a-f]{64}$/;
const SAFE_PATH = /^[A-Za-z0-9._@+-]+(\/[A-Za-z0-9._@+-]+)*$/;
const safeRelPath = (v) => typeof v === "string" && SAFE_PATH.test(v) && !v.split("/").some((s) => s === "." || s === "..");
// Two different things, kept apart. The ordered-list digest covers each patch's name and sha256 in order (it fixes the
// set and the order). The cumulative digest is the sha256 of the patch bytes themselves, concatenated in order.
export const orderedListSha256 = (patches) => sha(Buffer.from(patches.map((p) => `${p.sha256}  ${p.name}\n`).join("")));
export const cumulativeBytesSha256 = (patches) => sha(Buffer.concat(patches.map((p) => p.bytes)));

// Every path a patch names. Anything unparsable, quoted, absolute or climbing is returned as bad.
function patchPaths(text) {
  const paths = new Set(), bad = [];
  const add = (v) => { if (v === "/dev/null") return; if (!safeRelPath(v)) bad.push(v); else paths.add(v); };
  for (const line of text.split("\n")) {
    let m;
    if ((m = /^diff --git (.+)$/.exec(line))) { const mm = /^a\/(\S+) b\/(\S+)$/.exec(m[1]); if (mm) { add(mm[1]); add(mm[2]); } else bad.push(m[1]); }
    else if ((m = /^(?:---|\+\+\+) (.+)$/.exec(line))) { if (m[1] === "/dev/null") continue; const mm = /^[ab]\/(\S+)$/.exec(m[1]); if (mm) add(mm[1]); else bad.push(m[1]); }
    else if ((m = /^(?:rename|copy) (?:from|to) (.+)$/.exec(line))) add(m[1]);
  }
  return { paths, bad };
}
function gitApply(cwd, input, extra) {
  return spawnSync("git", ["apply", "--verbose", "--whitespace=nowarn", ...extra, "-"], {
    cwd, input, encoding: "utf8", env: { ...process.env, GIT_CEILING_DIRECTORIES: path.dirname(cwd) } });
}
const inexact = (out) => /\(offset -?\d+ lines?\)|fuzz/i.test(out);
// Returns { proof, errors, retained }. `repo` and `baseCommit` are mandatory: the base tree must be that commit's
// tree. `syntheticNoRepo: true` exists only for tests with an invented base; such a proof is marked synthetic and
// validate() refuses to qualify a contract with it.
export function verifyComposed(o) {
  const errors = [];
  const need = (c, m) => { if (!c) errors.push(m); };
  const { baseDir, baseCommit, baseTreeId, repo, syntheticNoRepo, patches, orderedListSha256: wantList, cumulativeBytesSha256: wantBytes,
    approvedTreeId, approvedPaths, approvedFileHashes, workRoot } = o ?? {};
  need(o && typeof o === "object", "composed inputs missing");
  need(HEX40.test(baseCommit || ""), "approved base commit missing");
  need(HEX40.test(baseTreeId || ""), "approved base tree id missing");
  need((typeof repo === "string" && repo.length > 0) || syntheticNoRepo === true, "repository for the base commit missing: real composed mode binds the base to a commit");
  need(HEX64.test(wantList || ""), "approved ordered-list sha256 missing");
  need(HEX64.test(wantBytes || ""), "approved cumulative patch-bytes sha256 missing");
  need(HEX40.test(approvedTreeId || ""), "approved composed tree id missing");
  need(Array.isArray(patches) && patches.length > 0, "approved patch list missing");
  need(Array.isArray(approvedPaths) && approvedPaths.length > 0, "approved path list missing");
  if (Array.isArray(approvedPaths)) approvedPaths.forEach((x) => need(safeRelPath(x), `unsafe approved path ${JSON.stringify(x)}`));
  need(approvedFileHashes && typeof approvedFileHashes === "object" && !Array.isArray(approvedFileHashes), "reviewed file hashes missing");
  if (approvedFileHashes && typeof approvedFileHashes === "object") for (const [k, v] of Object.entries(approvedFileHashes)) {
    need(safeRelPath(k), `unsafe reviewed file path ${JSON.stringify(k)}`);
    need(v === null || HEX64.test(v || ""), `reviewed file hash for ${k} must be a sha256 or null`);
  }
  need(typeof baseDir === "string" && typeof workRoot === "string", "baseDir and workRoot required");
  if (Array.isArray(patches)) {
    const names = new Set();
    patches.forEach((x, i) => {
      need(x && /^[A-Za-z0-9._-]+$/.test(x.name || "") && HEX64.test(x.sha256 || "") && Buffer.isBuffer(x.bytes), `patch ${i}: needs name, approved sha256 and bytes`);
      if (x?.name) { need(!names.has(x.name), `duplicate patch name: ${x.name}`); names.add(x.name); }
    });
  }
  if (errors.length) return { proof: null, errors, retained: null };

  // 1. The clean base is the approved tree and that commit's tree.
  if (repo) {
    try { const w = execFileSync("git", ["-C", repo, "rev-parse", "--verify", "--quiet", `${baseCommit}^{tree}`], { encoding: "utf8" }).trim(); if (w !== baseTreeId) errors.push(`approved base tree id differs from commit ${baseCommit}`); }
    catch { errors.push(`base commit ${baseCommit} not found in ${repo}`); }
  }
  let baseGot = null;
  try { baseGot = gitTreeSha(baseDir); } catch { errors.push(`cannot read ${baseDir}`); }
  if (baseGot !== baseTreeId) errors.push(`clean base is not the approved tree (${baseGot} != ${baseTreeId})`);
  // 2. Patches are the approved bytes, in the approved order, touching only approved paths.
  patches.forEach((x) => { if (sha(x.bytes) !== x.sha256) errors.push(`patch ${x.name} bytes differ from the approved sha256`); });
  if (orderedListSha256(patches) !== wantList) errors.push("patch order or set differs from the approved ordered-list sha256");
  if (cumulativeBytesSha256(patches) !== wantBytes) errors.push("concatenated patch bytes differ from the approved cumulative sha256");
  const allowed = new Set(approvedPaths);
  for (const x of patches) {
    const { paths, bad } = patchPaths(x.bytes.toString("utf8"));
    bad.forEach((b) => errors.push(`patch ${x.name}: unsafe or unparsable path ${JSON.stringify(b)}`));
    for (const pth of paths) if (!allowed.has(pth)) errors.push(`patch ${x.name}: touches a path outside the approved list: ${pth}`);
  }
  if (errors.length) return { proof: null, errors, retained: null };

  // 3. Exact apply in a new, unique work tree. Offsets and fuzz are refused, not tolerated. Nothing is removed afterwards.
  const owned = fs.mkdtempSync(path.join(workRoot, "composed-"));
  const work = path.join(owned, "tree");
  try {
    fs.cpSync(baseDir, work, { recursive: true, verbatimSymlinks: true, errorOnExist: true, force: false });
    if (gitTreeSha(work) !== baseTreeId) errors.push("work copy is not identical to the clean base");
    for (const x of patches) {
      if (errors.length) break;
      const chk = gitApply(work, x.bytes, ["--check"]);
      if (chk.status !== 0) { errors.push(`patch ${x.name} does not apply exactly: ${(chk.stderr || "").trim().split("\n").pop()}`); break; }
      const app = gitApply(work, x.bytes, []);
      if (app.status !== 0) { errors.push(`patch ${x.name} failed to apply: ${(app.stderr || "").trim().split("\n").pop()}`); break; }
      if (inexact(`${chk.stderr}\n${app.stderr}`)) errors.push(`patch ${x.name} applied only with an offset or fuzz`);
    }
    // 4. Final tree, including modes, new, deleted and symlink entries, then the reviewed file hashes, each read
    //    only after its path is classified by the hardened reader (no symlink in any ancestor or as the entry).
    const treeId = errors.length ? null : gitTreeSha(work);
    if (treeId !== null && treeId !== approvedTreeId) errors.push(`composed tree id ${treeId} differs from the approved ${approvedTreeId}`);
    if (!errors.length) {
      const rd = treeReader(work);
      for (const [rel, want] of Object.entries(approvedFileHashes)) {
        const st = rd.stat(rel).type;
        if (want === null) { if (st !== "missing") errors.push(`reviewed absent path exists: ${rel} (${st})`); }
        else if (st !== "file") errors.push(`reviewed file is not a regular file: ${rel} (${st})`);
        else if (sha(rd.read(rel)) !== want) errors.push(`reviewed file hash differs: ${rel}`);
      }
    }
    if (errors.length) return { proof: null, errors, retained: owned };
    const sortedHashes = Object.fromEntries(Object.keys(approvedFileHashes).sort().map((k) => [k, approvedFileHashes[k]]));
    const composed = Object.freeze({ baseCommit, baseTreeId, orderedListSha256: wantList, cumulativeBytesSha256: wantBytes, treeId,
      synthetic: syntheticNoRepo === true, approvedPaths: Object.freeze([...approvedPaths].sort()), reviewedFileHashes: Object.freeze(sortedHashes),
      patches: Object.freeze(patches.map((x) => Object.freeze({ name: x.name, sha256: x.sha256 }))) });
    const proof = Object.freeze({ kind: "composed", verified: true, commit: null, baseCommit, tree: treeId, root: work, composed });
    issued.add(proof);
    return { proof, errors: [], retained: owned };
  } catch (e) { return { proof: null, errors: [...errors, `composed verification failed: ${e.message}`], retained: owned }; }
}
// A later real commit counts as this candidate only if its tree is identical.
export function treeEqualsCommit(repo, commit, treeId) {
  try { return execFileSync("git", ["-C", repo, "rev-parse", "--verify", "--quiet", `${commit}^{tree}`], { encoding: "utf8" }).trim() === treeId; } catch { return false; }
}
// A merge checkout is a different tree and must requalify unless it is identical.
export function requalificationNeeded(proof, mergeDir) {
  try { return !issued.has(proof) || gitTreeSha(mergeDir) !== proof.tree; } catch { return true; }
}

// ------------------------------------------------------------- manifest
export function parseManifest(text) {
  const rows = [], errors = [];
  const lines = text.split("\n");
  if (lines.at(-1) === "") lines.pop();
  lines.forEach((line, i) => {
    const m = LINE.exec(line);
    if (!m) { errors.push(`line ${i + 1}: not "<sha256>  <path>"`); return; }
    const p = m[2];
    if (p.startsWith("/") || p.includes("\\") || p.split("/").some((s) => s === ".." || s === "." || s === "")) { errors.push(`line ${i + 1}: unsafe path ${p}`); return; }
    rows.push([m[1], p]);
  });
  return { rows, errors };
}

// ------------------------------------------------------- closure scanning
const EDGE = /(?:import|export)\s[^'"`;]*?from\s*['"]([^'"]+)['"]|import\s*['"]([^'"]+)['"]|import\(\s*['"]([^'"]+)['"]\s*\)|new URL\(\s*['"](\.[^'"]+)['"]\s*,\s*import\.meta\.url/g;
const EXTS = ["", ".js", ".mjs", ".jsx", ".cjs", ".css", ".json"];
// Non-relative local specs and specs that climb out of the tree are blind
// spots to be failed, not skipped. Bare packages are covered by package-lock.
function resolveSpec(rd, from, spec) {
  if (spec.startsWith("/") || /^file:/i.test(spec)) return `ESCAPE:${from} -> ${spec}`;
  if (!spec.startsWith(".")) return null;
  const base = path.posix.normalize(path.posix.join(path.posix.dirname(from), spec.split("?")[0]));
  if (base.startsWith("..") || path.posix.isAbsolute(base)) return `ESCAPE:${from} -> ${spec}`;
  for (const e of EXTS) for (const c of [base + e, `${base}/index${e}`]) if (rd.read(c) !== null) return c;
  return `UNRESOLVED:${base}`;
}
export function regexEdges(rd, file) {
  if (!/\.(m?js|jsx|cjs)$/.test(file)) return [];
  const src = rd.read(file)?.toString("utf8") ?? "";
  const out = new Set();
  for (const m of src.matchAll(EDGE)) { const r = resolveSpec(rd, file, m[1] || m[2] || m[3] || m[4]); if (r) out.add(r); }
  return [...out].sort();
}
export function reachable(rd, roots) {
  const seen = new Set(), q = [...roots];
  while (q.length) {
    const f = q.pop();
    if (seen.has(f)) continue;
    seen.add(f);
    if (!/^(UNRESOLVED|ESCAPE):/.test(f)) q.push(...regexEdges(rd, f));
  }
  return [...seen].sort();
}
export function closureRoots(rd, meta) {
  const html = rd.read(meta.closureRoots.html)?.toString("utf8") ?? "";
  const entry = [...html.matchAll(/src="\/([^"]+\.(?:jsx?|mjs))"/g)].map((m) => m[1]);
  const api = rd.list(meta.closureRoots.apiDir).filter((n) => !n.startsWith("_")).map((n) => `${meta.closureRoots.apiDir}/${n}`);
  return [...entry, ...api, ...meta.closureRoots.extra.filter((p) => rd.read(p) !== null)];
}
// AST cross-check with a TypeScript already on the machine. Unavailable is
// reported to the caller, which turns it into a failure.
export function astSanity(rd, files, tsPath = process.env.PR501_TS_PATH || "/opt/node-tools/node_modules/typescript") {
  let ts;
  try { ts = createRequire(import.meta.url)(tsPath); } catch { return { available: false, missedByRegex: [], computed: [] }; }
  const missedByRegex = [], computed = [];
  for (const f of files) {
    if (!/\.(m?js|jsx|cjs)$/.test(f) || /^(UNRESOLVED|ESCAPE):/.test(f)) continue;
    const text = rd.read(f)?.toString("utf8") ?? "";
    const sf = ts.createSourceFile(f, text, ts.ScriptTarget.Latest, true, f.endsWith(".jsx") ? ts.ScriptKind.JSX : ts.ScriptKind.JS);
    const ast = new Set();
    const visit = (n) => {
      if ((ts.isImportDeclaration(n) || ts.isExportDeclaration(n)) && n.moduleSpecifier && ts.isStringLiteral(n.moduleSpecifier)) {
        const r = resolveSpec(rd, f, n.moduleSpecifier.text); if (r) ast.add(r);
      } else if (ts.isCallExpression(n) && (n.expression.kind === ts.SyntaxKind.ImportKeyword || (ts.isIdentifier(n.expression) && n.expression.text === "require"))) {
        const a = n.arguments[0];
        if (a && ts.isStringLiteralLike(a)) { const r = resolveSpec(rd, f, a.text); if (r) ast.add(r); }
        else computed.push(`${f}:${sf.getLineAndCharacterOfPosition(n.getStart()).line + 1}`);
      }
      ts.forEachChild(n, visit);
    };
    visit(sf);
    const rx = new Set(regexEdges(rd, f));
    for (const e of ast) if (!rx.has(e)) missedByRegex.push(`${f} -> ${e}`);
  }
  return { available: true, missedByRegex, computed };
}

const literalsOf = (src) => ({
  manager: /export const MANAGER_SHA =\s*"([0-9a-f]{64})"/.exec(src)?.[1],
  core: /function patchPhoneLayout[\s\S]*?!== "([0-9a-f]{64})"/.exec(src)?.[1],
});
const canon = (v) => JSON.stringify(sortKeys(v));
const sortKeys = (v) => Array.isArray(v) ? v.map(sortKeys)
  : v && typeof v === "object" ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, sortKeys(v[k])])) : v;

// The digest an independent reviewer approves. It binds the contract's meta,
// both manifests, the approved guarded file, the three Git tree ids and this
// validator's own source, so editing any one of them changes it.
export function contractDigest({ meta, originalText, candidateText, approvedVercel, trees, composed }) {
  return sha(Buffer.from(canon({
    meta: sha(Buffer.from(canon(meta))), original: sha(Buffer.from(originalText)), candidate: sha(Buffer.from(candidateText)),
    approvedVercel: approvedVercel ? sha(approvedVercel) : null, trees, validator: sha(fs.readFileSync(VALIDATOR_FILE)),
    ...(composed ? { composed } : {}),
  })));
}

// ------------------------------------------------------------- validation
// Returns { status, errors, unqualified, warnings, info, digest }.
// status is FAIL, UNQUALIFIED, or PASS (conditional, pending independent approval).
export function validate({ meta, originalText, candidateText, approvedVercel, head, orig, snapshots, expectedDigest, allowOverlayForTests = false }) {
  const errors = [], unqualified = [], warnings = [], info = {};
  const fail = (m) => errors.push(m);

  // 0. Required inputs. Nothing downstream is skipped for want of them.
  if (!meta || typeof meta !== "object") fail("meta missing");
  if (typeof originalText !== "string") fail("original manifest text missing");
  if (typeof candidateText !== "string") fail("candidate manifest text missing");
  if (!Buffer.isBuffer(approvedVercel)) fail("approved guarded vercel.json bytes missing");
  if (!head?.read) fail("PR tree reader missing");
  if (!orig?.read) fail("frozen baseline tree reader missing: baseline and guard cannot be checked");
  if (!snapshots?.head || !snapshots?.base || !snapshots?.frozen) fail("Git-bound snapshot proofs (head, base, frozen) missing");
  if (!/^[0-9a-f]{64}$/.test(expectedDigest || "")) fail("no external expected contract digest supplied: the prototype cannot approve itself");
  if (errors.length) return { status: "FAIL", errors, unqualified, warnings, info, digest: null };

  // 1. Snapshots are the commits the meta names, and the readers read them.
  const want = { head: meta.head, base: meta.base, frozen: meta.frozenBaseline };
  const headKind = meta.headProofKind ?? "commit";
  if (headKind !== "commit" && headKind !== "composed") fail(`unknown head proof kind ${headKind}`);
  for (const [label, commit] of Object.entries(want)) {
    const s = snapshots[label];
    if (!issued.has(s)) { fail(`${label} snapshot proof was not issued by verifySnapshots or verifyComposed`); continue; }
    const kind = label === "head" ? headKind : "commit";
    if (s.kind !== kind) { fail(`${label} snapshot proof kind ${s.kind} is not the required ${kind}`); continue; }
    if (!s.verified) fail(`${label} snapshot is not verified`);
    if (kind === "composed") { if (s.baseCommit !== commit) fail(`head composed base ${s.baseCommit} differs from the contract's ${commit}`); }
    else if (s.commit !== commit) fail(`${label} snapshot commit ${s.commit} differs from the contract's ${commit}`);
  }
  if (headKind === "composed" && issued.has(snapshots.head) && snapshots.head.kind === "composed") {
    if (snapshots.head.composed?.synthetic) fail("a synthetic composed proof (no repository binding) cannot qualify a contract");
    let now = null; try { now = gitTreeSha(snapshots.head.root); } catch { /* handled below */ }
    if (now !== snapshots.head.tree) fail("composed tree changed after verification");
  }
  if (!issued.has(snapshots.head) || !issued.has(snapshots.frozen) || !issued.has(snapshots.base)) return { status: "FAIL", errors, unqualified, warnings, info, digest: null };
  if (snapshots.head.root !== head.root) fail("PR tree reader is not the verified head snapshot");
  if (snapshots.frozen.root !== orig.root) fail("baseline reader is not the verified frozen snapshot");
  if ((head.overlaid || orig.overlaid) && !allowOverlayForTests) fail("overlaid readers are refused outside tests");

  // 2. Original manifest: pinned, equal to the file at the frozen commit, true there.
  if (sha(Buffer.from(originalText)) !== meta.originalManifestSha256) fail("original manifest bytes differ from the pinned original");
  const frozenFile = orig.read("scripts/search-runtime.sha256");
  if (!frozenFile || frozenFile.toString("utf8") !== originalText) fail("original manifest is not the file at the frozen commit");
  const o = parseManifest(originalText);
  o.errors.forEach(fail);
  if (o.rows.length !== meta.originalCount) fail(`original has ${o.rows.length} rows, expected ${meta.originalCount}`);
  for (const [e, p] of o.rows) { const b = orig.read(p); if (!b || sha(b) !== e) fail(`original row fails on frozen tree: ${p}`); }

  // 3. Candidate shape: fixed lists, no duplicates, no unknown path.
  const c = parseManifest(candidateText);
  c.errors.forEach(fail);
  const seen = new Set();
  for (const [, p] of c.rows) { if (seen.has(p)) fail(`duplicate path: ${p}`); seen.add(p); }
  if (c.rows.length !== meta.candidateCount) fail(`candidate has ${c.rows.length} rows, expected ${meta.candidateCount}`);
  const origPaths = new Set(o.rows.map((r) => r[1])), addPaths = new Set(meta.additions), changed = new Set(meta.changedRows);
  if (new Set([...origPaths, ...addPaths]).size !== meta.candidateCount) fail("meta lists are inconsistent");
  for (const p of origPaths) if (!seen.has(p)) fail(`original path missing from candidate: ${p}`);
  for (const p of addPaths) if (!seen.has(p)) fail(`named addition missing: ${p}`);
  for (const p of seen) if (!origPaths.has(p) && !addPaths.has(p)) fail(`unknown path (not original, not a named addition): ${p}`);
  for (const [h, p] of c.rows) if (/^0+$/.test(h)) fail(`placeholder hash: ${p}`);

  // 4. Unchanged rows equal the original; only the fixed rehash rows may differ.
  const oMap = new Map(o.rows.map(([h, p]) => [p, h])), cMap = new Map(c.rows.map(([h, p]) => [p, h]));
  let unchanged = 0;
  for (const p of changed) if (!origPaths.has(p)) fail(`meta changed row not original: ${p}`);
  for (const [p, h] of oMap) {
    if (!cMap.has(p)) continue;
    if (cMap.get(p) === h) unchanged++;
    else if (!changed.has(p)) fail(`unauthorized rehash of original row: ${p}`);
  }
  info.unchangedRows = unchanged;
  info.rehashedRows = [...changed].filter((p) => cMap.get(p) !== oMap.get(p)).length;

  // 5. Every candidate row is true on the PR tree.
  for (const [h, p] of c.rows) { const b = head.read(p); if (!b) fail(`file missing on PR tree: ${p}`); else if (sha(b) !== h) fail(`hash mismatch on PR tree: ${p}`); }

  // 6. Pin alignment with build.mjs literals.
  const bs = head.read(meta.pins.buildFile)?.toString("utf8");
  if (!bs) fail("build.mjs missing");
  else {
    const { manager, core } = literalsOf(bs);
    if (!manager || !core) fail("could not read the pin literals in build.mjs");
    if (manager && manager !== cMap.get(meta.pins.managerRow)) fail("Manager pin in build.mjs differs from the candidate row");
    if (core && core !== cMap.get(meta.pins.coreRow)) fail("core pin in build.mjs differs from the candidate row");
  }

  // 7. Hosting guard. The PR tree must hold the approved guarded file byte for
  //    byte, it must be an object, and it must be the frozen file plus only the
  //    branch suppression (set to false). Normalized JSON is not enough.
  const g = meta.hostingGuard.file;
  const headVercel = head.read(g), frozenVercel = orig.read(g);
  if (!headVercel) fail("vercel.json missing on PR tree");
  if (!frozenVercel) fail("vercel.json missing on frozen tree");
  const parseObj = (buf, what) => {
    try { const v = JSON.parse(buf.toString("utf8")); if (v && typeof v === "object" && !Array.isArray(v)) return v; } catch { /* fall through */ }
    fail(`${what} is not a JSON object`); return null;
  };
  const headObj = headVercel && parseObj(headVercel, "vercel.json on PR tree");
  const apprObj = parseObj(approvedVercel, "approved guarded vercel.json");
  const frozenObj = frozenVercel && parseObj(frozenVercel, "vercel.json on frozen tree");
  if (headVercel && !headVercel.equals(approvedVercel)) fail("vercel.json is not byte-identical to the approved guarded file");
  if (apprObj && frozenObj) {
    const wantObj = { ...frozenObj, git: { deploymentEnabled: { [meta.hostingGuard.branch]: false } } };
    if (canon(wantObj) !== canon(apprObj)) fail("approved guarded file is not the frozen vercel.json plus exactly the branch suppression");
  }
  if (cMap.get(g) !== sha(approvedVercel)) fail("candidate vercel.json row is not the approved guarded file's hash");

  // 8. Closure. Anything reachable must be a candidate row; escapes and
  //    unresolved edges fail. A missing AST check fails the qualification.
  const roots = closureRoots(head, meta);
  const reach = reachable(head, roots);
  info.reachableCount = reach.length;
  for (const f of reach) {
    if (f.startsWith("ESCAPE:")) fail(`import escapes the tree or is non-relative local: ${f.slice(7)}`);
    else if (f.startsWith("UNRESOLVED:")) fail(`unresolved import: ${f.slice(11)}`);
    else if (!seen.has(f)) fail(`reachable file not in candidate: ${f}`);
  }
  const a = astSanity(head, reach);
  info.astAvailable = a.available;
  if (!a.available) fail("AST closure check unavailable: closure qualification cannot be completed");
  a.missedByRegex.forEach((m) => fail(`AST sees an edge the regex scan missed: ${m}`));
  a.computed.forEach((m) => unqualified.push(`computed import, closure cannot be qualified: ${m}`));

  // 9. External digest: the contract the caller approved is the contract checked.
  const trees = { head: snapshots.head.tree, base: snapshots.base.tree, frozen: snapshots.frozen.tree };
  const composedBinding = headKind === "composed" && issued.has(snapshots.head) ? snapshots.head.composed : undefined;
  const digest = contractDigest({ meta, originalText, candidateText, approvedVercel, trees, composed: composedBinding });
  info.proofKind = headKind;
  if (headKind === "composed") info.remoteTreeEqualityRequired = true;
  info.contractDigest = digest;
  if (digest !== expectedDigest) fail(`contract digest ${digest} differs from the caller's expected ${expectedDigest}`);

  const status = errors.length ? "FAIL" : unqualified.length ? "UNQUALIFIED" : headKind === "composed" ? PASS_COMPOSED : PASS;
  return { status, errors, unqualified, warnings, info, digest };
}

// Negative control: how a candidate fares against another tree (for example main).
export function controlAgainst(candidateText, other) {
  const mismatched = [], missing = [];
  for (const [h, p] of parseManifest(candidateText).rows) { const b = other.read(p); if (!b) missing.push(p); else if (sha(b) !== h) mismatched.push(p); }
  return { mismatched, missing };
}

// ------------------------------------------------------------------- CLI
if (process.argv[1] && path.resolve(process.argv[1]) === VALIDATOR_FILE) {
  const args = Object.fromEntries(process.argv.slice(2).reduce((acc, v, i, all) => (v.startsWith("--") ? [...acc, [v.slice(2), all[i + 1]]] : acc), []));
  const need = ["candidate-dir", "head", "frozen", "base", "repo"];
  if (need.some((k) => !args[k])) { console.error(`usage: validate-candidate.mjs ${need.map((k) => `--${k} <x>`).join(" ")} [--expected-digest <sha256> | --print-digest 1]`); process.exit(2); }
  const dir = args["candidate-dir"];
  const meta = JSON.parse(fs.readFileSync(path.join(dir, "candidate.meta.json"), "utf8"));
  const snap = verifySnapshots(args.repo, {
    head: { commit: meta.head, dir: args.head }, base: { commit: meta.base, dir: args.base }, frozen: { commit: meta.frozenBaseline, dir: args.frozen } });
  const originalText = fs.readFileSync(path.join(dir, "original-search-runtime.sha256.reference"), "utf8");
  const candidateText = fs.readFileSync(path.join(dir, "search-runtime.pr501-conditional-47757af.sha256"), "utf8");
  const approvedVercel = fs.readFileSync(path.join(dir, "..", "approved", "vercel.guarded.json"));
  if (args["print-digest"] !== undefined) {
    // Compute only: no verdict. For a reviewer to recompute and compare independently.
    if (snap.errors.length) { snap.errors.forEach((e) => console.log(`snapshot: ${e}`)); process.exit(1); }
    const trees = Object.fromEntries(Object.entries(snap.proofs).map(([k, v]) => [k, v.tree]));
    console.log(`contractDigest (compute only, no verdict, not an approval): ${contractDigest({ meta, originalText, candidateText, approvedVercel, trees })}`);
    process.exit(0);
  }
  const r = validate({
    meta,
    originalText,
    candidateText, approvedVercel,
    head: treeReader(args.head), orig: treeReader(args.frozen),
    snapshots: snap.proofs, expectedDigest: args["expected-digest"],
  });
  snap.errors.forEach((e) => r.errors.push(`snapshot: ${e}`));
  if (snap.errors.length) r.status = "FAIL";
  console.log(`# ${meta.label}`);
  console.log("# PENDING INDEPENDENT APPROVAL: this prototype does not approve its own contract");
  console.log(`status: ${r.status}`);
  console.log(`contractDigest: ${r.info.contractDigest ?? r.digest}`);
  console.log(JSON.stringify(r.info));
  r.unqualified.forEach((u) => console.log(`unqualified: ${u}`));
  r.errors.forEach((e) => console.log(`FAIL: ${e}`));
  process.exit(r.status === PASS || r.status === PASS_COMPOSED ? 0 : r.status === "UNQUALIFIED" ? 3 : 1);
}
