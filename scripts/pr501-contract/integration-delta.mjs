// PR501 integration delta: the exact old to new transitions of the few existing files the final fixture packet changes (tests, CI),
// plus the exact new paths. Pure functions: no file system, no Git, no network. The runner feeds them Maps read from Git objects.
//
// Nothing here widens trust. There are no wildcards, no prefixes and no "any other change". A path is in the map or it is
// unchanged. The map is hash-bound by DELTA.sha256 (checked before anything runs and again by the runner), and its bytes are
// reviewed independently of the candidate; the candidate cannot approve itself.
//
// Entries:
//   existing: { path, oldGitMode, oldGitBlob, newGitMode, newSha256 }   old identity is the composed (final3) tree's Git entry
//   new:      { path, mode, sha256 }                                    must be absent from the composed tree
export const SCHEMA = "pr501-integration-delta-v1";
const HEX40 = /^[0-9a-f]{40}$/, HEX64 = /^[0-9a-f]{64}$/, MODES = new Set(["100644", "100755"]);
const SAFE = /^(?!\/)(?!.*(?:^|\/)\.{1,2}(?:\/|$))(?!.*\/\/)[A-Za-z0-9._@+-][A-Za-z0-9._@+\/-]*$/;
const exact = (o, keys) => o && typeof o === "object" && !Array.isArray(o) && Object.keys(o).sort().join() === [...keys].sort().join();

export function parseIntegrationDelta(text) {
  const errors = [];
  let d;
  try { d = JSON.parse(text); } catch (e) { return { errors: [`not JSON: ${e.message}`], pending: false, delta: null }; }
  if (!exact(d, ["schema", "status", "existing", "new"])) return { errors: ["keys must be exactly schema, status, existing, new"], pending: false, delta: null };
  if (d.schema !== SCHEMA) errors.push(`schema must be ${SCHEMA}`);
  if (d.status !== "FINAL" && d.status !== "PENDING") errors.push(`status must be FINAL or PENDING`);
  const pending = d.status === "PENDING";
  if (!Array.isArray(d.existing) || !Array.isArray(d.new)) return { errors: [...errors, "existing and new must be arrays"], pending, delta: null };
  const seen = new Set();
  const path = (p, where) => {
    if (typeof p !== "string" || !SAFE.test(p) || /[*?\[\]{}]/.test(p) || p.endsWith("/")) { errors.push(`${where}: unsafe or wildcard path ${JSON.stringify(p)}`); return; }
    if (seen.has(p)) errors.push(`${where}: duplicate path ${p}`);
    seen.add(p);
  };
  const sha = (v, where) => { if (!(HEX64.test(v) || (pending && v === "PENDING"))) errors.push(`${where}: sha256 must be 64 lowercase hex${pending ? " or PENDING" : ""}`); };
  d.existing.forEach((e, i) => {
    const w = `existing[${i}]`;
    if (!exact(e, ["path", "oldGitMode", "oldGitBlob", "newGitMode", "newSha256"])) { errors.push(`${w}: keys must be exactly path, oldGitMode, oldGitBlob, newGitMode, newSha256`); return; }
    path(e.path, w);
    if (!MODES.has(e.oldGitMode) || !MODES.has(e.newGitMode)) errors.push(`${w}: modes must be 100644 or 100755`);
    if (!HEX40.test(e.oldGitBlob)) errors.push(`${w}: oldGitBlob must be 40 lowercase hex`);
    sha(e.newSha256, w);
  });
  d.new.forEach((e, i) => {
    const w = `new[${i}]`;
    if (!exact(e, ["path", "mode", "sha256"])) { errors.push(`${w}: keys must be exactly path, mode, sha256`); return; }
    path(e.path, w);
    if (!MODES.has(e.mode)) errors.push(`${w}: mode must be 100644 or 100755`);
    sha(e.sha256, w);
  });
  return { errors, pending, delta: errors.length ? null : d };
}

// composed, head: Map path -> { mode, blob }.  declared: Set of paths the DELTA declaration owns (tooling files).
// special: Set of composed paths handled by their own reviewed check (the workflow). forbidden: { paths: Set, prefixes: string[] }.
// headSha256: (path) => hex sha256 of the head blob, or null.
export function evaluateIntegrationDelta({ delta, pending, composed, head, declared, special, forbidden, headSha256 }) {
  const v = [];
  if (!delta) return { ok: false, violations: ["integration delta did not parse"] };
  if (pending) return { ok: false, violations: ["integration delta is PENDING: real hashes are not bound yet"] };
  const bar = (p) => forbidden.paths.has(p) || special.has(p) || forbidden.prefixes.some((x) => p.startsWith(x));
  const listed = new Set();
  for (const e of delta.existing) {
    const { path: p } = e; listed.add(p);
    if (bar(p)) v.push(`${p}: a forbidden path cannot be a transition (contract row, pin, vercel, workflow or contract tooling)`);
    const c = composed.get(p), h = head.get(p);
    if (!c) { v.push(`${p}: not in the composed tree (declared as an existing transition)`); continue; }
    if (c.mode !== e.oldGitMode || c.blob !== e.oldGitBlob) v.push(`${p}: composed entry ${c.mode} ${c.blob} is not the declared old ${e.oldGitMode} ${e.oldGitBlob}`);
    if (declared.has(p)) v.push(`${p}: also owned by the tooling declaration`);
    if (!h) { v.push(`${p}: missing in head`); continue; }
    if (h.mode !== e.newGitMode) v.push(`${p}: head mode ${h.mode} is not the declared ${e.newGitMode}`);
    if (headSha256(p) !== e.newSha256) v.push(`${p}: head bytes are not the declared new sha256`);
    if (c.mode === h.mode && c.blob === h.blob) v.push(`${p}: no-op transition (head equals the composed entry)`);
  }
  const added = new Set();
  for (const e of delta.new) {
    const { path: p } = e; added.add(p);
    if (bar(p)) v.push(`${p}: a forbidden path cannot be added by the map`);
    if (composed.has(p)) v.push(`${p}: new path already exists in the composed tree`);
    if (declared.has(p)) v.push(`${p}: also owned by the tooling declaration`);
    const h = head.get(p);
    if (!h) { v.push(`${p}: new path missing in head`); continue; }
    if (h.mode !== e.mode) v.push(`${p}: head mode ${h.mode} is not the declared ${e.mode}`);
    if (headSha256(p) !== e.sha256) v.push(`${p}: head bytes are not the declared sha256`);
  }
  for (const [p, c] of composed) {
    if (listed.has(p) || special.has(p)) continue;
    const h = head.get(p);
    if (!h) v.push(`composed path missing in head: ${p}`);
    else if (h.mode !== c.mode || h.blob !== c.blob) v.push(`unlisted composed path differs in head: ${p}`);
  }
  for (const p of head.keys()) if (!composed.has(p) && !declared.has(p) && !added.has(p)) v.push(`undeclared addition: ${p}`);
  for (const p of declared) {
    if (!head.has(p)) v.push(`declared tooling path missing in head: ${p}`);
    else if (head.get(p).mode !== "100644") v.push(`declared tooling path has mode ${head.get(p).mode}: ${p}`);
    if (composed.has(p)) v.push(`declared tooling path shadows a composed path: ${p}`);
    if (forbidden.paths.has(p)) v.push(`declared tooling path is a contract row or pin: ${p}`);
  }
  return { ok: v.length === 0, violations: v, counts: { transitions: delta.existing.length, added: delta.new.length } };
}
