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
