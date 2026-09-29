/* C103: a salesperson's screens open only in the app (Jorge, 29 September).
   A1 a, the card; A2 a, switched on with the App Store release; A3, phone
   browsers too. Built now with the switch off, so nothing changes until the
   release turns it on in the same change that fills the store link. */
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const app = fs.readFileSync(new URL("../src/LeadPerformanceCalculator.jsx", import.meta.url), "utf8").replace(/\r\n/g, "\n");

test("off until the App Store release, and on together with its link", () => {
  const on = /^const SALESPERSON_APP_ONLY = (true|false);$/m.exec(app);
  assert.ok(on, "one switch, a plain constant");
  const link = /^const APP_STORE_LINKS = \{ ios: "([^"]*)"/m.exec(app)[1];
  assert.equal(on[1] === "true", link !== "", "the switch goes on in the same change that gives the card somewhere to send people");
});

test("the app is told from a browser by the phone bridge, and every browser counts (A3)", () => {
  assert.match(app, /const inSageApp = \(\) => typeof window !== "undefined" && !!window\.ReactNativeWebView;/);
  assert.ok(!/SALESPERSON_APP_ONLY[^\n]*(innerWidth|matchMedia|usePhoneLayout)/.test(app), "no width test: a phone browser is a website too");
});

test("the gate sits in front of the rooms and nothing else", () => {
  assert.match(app, /if \(home && SALESPERSON_APP_ONLY && !inSageApp\(\)\) \{\n\s*return wrap\(<Shell><AppOnlyCard name=\{session\.name\} onSignOut=\{signOut\} \/><Style \/><\/Shell>\);\n\s*\}\n\s*if \(home\) \{/);
  assert.equal((app.match(/SALESPERSON_APP_ONLY/g) || []).length, 2, "defined once, read once: managers, admins and the TV boards never pass it");
});

test("the card: where to go, a way there, and the account (A1 a)", () => {
  const card = app.slice(app.indexOf("function AppOnlyCard("), app.indexOf("function AppOnlyCard(") + 1600);
  assert.match(card, /Sage for salespeople is in the app/);
  assert.match(card, /Get the Sage app/);
  assert.match(card, /<AccountSheet desk /, "Delete my account stays reachable from a browser");
  assert.match(card, /onClick=\{onSignOut\}>Sign out</);
});
