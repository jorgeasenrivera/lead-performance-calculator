/* PROPOSED test, not in the repository. The sign-in layer stays mounted while a legitimate arrival holds it, even when the real config has been cleared by an account change, and it then
   shows an INERT empty config. It never reuses a previous account's config, and every protection around it is still in the source. Source-level, node:test only, no browser. */
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const core = fs.readFileSync(new URL("../src/LeadPerformanceCalculator.jsx", import.meta.url), "utf8");
const line = (re) => { const m = core.match(re); assert.ok(m, "missing: " + re); return m[0]; };

test("loginConfigFor: the real config wins, null is inert only while held, null otherwise, and no earlier config is ever returned", () => {
  const src = line(/^const HELD_LOGIN_CONFIG = .*$/m) + "\n" + line(/^const loginConfigFor = .*$/m) + "\nreturn { HELD_LOGIN_CONFIG, loginConfigFor };";
  const { HELD_LOGIN_CONFIG, loginConfigFor } = new Function(src)();
  const real = { approvedDomains: ["example.test"], registrationOpen: true, stores: [{ id: "s1" }] }, other = { approvedDomains: ["other.test"], registrationOpen: true, stores: [] };
  assert.equal(loginConfigFor(real, false), real); assert.equal(loginConfigFor(real, true), real);
  assert.equal(loginConfigFor(null, true), HELD_LOGIN_CONFIG);
  assert.equal(loginConfigFor(null, false), null, "a non-held null config gets no form");
  assert.equal(loginConfigFor(undefined, false), null);
  loginConfigFor(other, true); assert.equal(loginConfigFor(null, true), HELD_LOGIN_CONFIG, "nothing remembered from the previous call");
  assert.equal(loginConfigFor.length, 2);
  assert.deepEqual(HELD_LOGIN_CONFIG, { approvedDomains: [], registrationOpen: false, stores: [] });
  assert.ok(Object.isFrozen(HELD_LOGIN_CONFIG) && Object.isFrozen(HELD_LOGIN_CONFIG.approvedDomains) && Object.isFrozen(HELD_LOGIN_CONFIG.stores));
  // Login's own derivation (copied from its source line) is false for the inert config: registration unavailable.
  const derived = new Function("config", line(/^  const domains = config\.approvedDomains \|\| \[\];$/m) + "\n" + line(/^  const canRegister = .*$/m) + "\nreturn canRegister;");
  assert.equal(!!derived(HELD_LOGIN_CONFIG), false); assert.equal(!!derived(real), true);
});

test("the layer uses it only through loginConfigFor(config, jumpHold); no copy of a config is kept anywhere", () => {
  assert.equal(core.split("loginConfigFor(config, jumpHold)").length - 1, 1);
  assert.ok(core.includes("const signInLayer = loginConfig && authReady && rec.status !== \"pending\" && (!session || jumpHold || recoveryLayer) ?"), "the pending exclusion and the three-way condition are kept");
  assert.ok(core.includes("<Login config={loginConfig} resetting={rec.status === \"ready\"}"));
  assert.ok(!/\b(prevConfig|lastConfig|heldConfig|configSnapshot|savedConfig)\b/.test(core), "no remembered config");
  assert.equal((core.match(/HELD_LOGIN_CONFIG/g) || []).length, 2, "the inert config is defined once and used once, by loginConfigFor");
});

test("every protection around the clear is untouched: caches, CAS resets, provisional flag, generation abort, readiness gates", () => {
  for (const must of [
    "sharedVersions.clear(); rowStamps.clear(); actCache.clear(); casCache.clear();",
    "cfgProvisional.current = true; setConfig(null); setStoreData(null); setAdminData({});",
    "viewPicked.current = false; viewPickInFlight.current = false; setInitialViewReady(false); setCfgWave(w => w + 1);",
    "const configSubject = JSON.stringify([session?.id || session?.email || null, session?.role, session?.active, session?.pending, session?.stores]);",
    "abortJump(); signInPressed = false; setBusy(false);",
    "if (!mine() || !isCurrent() || res?.stale) return;",
    "const landable = !!session && !!config && arrivalDestinationReady && !cfgProvisional.current",
    "if (!session || holdMount) return wrap(<Shell><Style /></Shell>);",
  ]) assert.ok(core.includes(must), must);
  assert.ok(!/recoveryFlow\.[a-zA-Z]+\([^)]*\)\s*;?\s*\/\/ held/.test(core));
});
