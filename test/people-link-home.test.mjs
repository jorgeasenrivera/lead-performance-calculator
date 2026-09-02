/**
 * Which link is home when a salesperson opens the app.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { homeLinkFor } from "../api/_people-link.mjs";

test("no links means no door", () => {
  assert.equal(homeLinkFor([]), null);
  assert.equal(homeLinkFor(null), null);
  assert.equal(homeLinkFor([{ store: "honda", person_id: null }]), null);
});

test("one link is home", () => {
  assert.deepEqual(homeLinkFor([{ store: "honda", person_id: "a2" }]), { store: "honda", person_id: "a2" });
});

test("the store they were on last wins when it is still linked", () => {
  const links = [{ store: "honda", person_id: "a2" }, { store: "kia", person_id: "k9" }];
  assert.equal(homeLinkFor(links, "kia").store, "kia");
  assert.equal(homeLinkFor(links, "honda").store, "honda");
  // A remembered store that has since been unlinked falls back to the first.
  assert.equal(homeLinkFor(links, "ford").store, "honda");
});

import { claimsFor } from "../api/_people-link.mjs";

const USERS = [
  { id: "u-casey", email: "casey@x.com", created_at: "2026-09-01T09:00:00Z",
    user_metadata: { name: "Casey Newbie", wants: "associate", claim_store: "honda", claim_person: "a7", claim_name: "Casey N.", claim_at: "2026-09-01T09:01:00Z" } },
  { id: "u-luis", email: "luis@x.com", user_metadata: { claim_store: "honda", claim_person: "a2" } },
  { id: "u-kia", email: "kia@x.com", user_metadata: { claim_store: "kia", claim_person: "k1" } },
  { id: "u-none", email: "none@x.com", user_metadata: { name: "No Claim" } },
  { id: "u-store-only", email: "so@x.com", created_at: "2026-08-30T09:00:00Z", user_metadata: { claim_store: "honda" } },
];

test("claims are the store's own, minus the ones already linked", () => {
  const links = [{ store: "honda", user_id: "u-luis", person_id: "a2" }];
  const c = claimsFor(USERS, links, "honda");
  assert.deepEqual(c.map((x) => x.user_id), ["u-store-only", "u-casey"]);
  assert.equal(c[1].person_id, "a7");
  assert.equal(c[1].claim_name, "Casey N.");
  assert.equal(c[1].name, "Casey Newbie");
  // A claim with only a store still surfaces: the manager picks the name.
  assert.equal(c[0].person_id, null);
});

test("a link at another store does not clear the claim here", () => {
  const links = [{ store: "kia", user_id: "u-casey", person_id: "k9" }];
  assert.ok(claimsFor(USERS, links, "honda").some((x) => x.user_id === "u-casey"));
});

test("no store, no claims", () => {
  assert.deepEqual(claimsFor(USERS, [], ""), []);
});
