/* The app asks for what it uses and nothing else (C93, B2, 24 September).
   The camera permission sat in app.json with no camera code anywhere: the
   floor's QR is read by the phone's own Camera app, which then opens Sage. A
   reviewer who finds a permission the app never asks for can ask why, and the
   store listing would declare something Sage does not do. */
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const app = JSON.parse(fs.readFileSync(new URL("../native/app.json", import.meta.url), "utf8")).expo;
const pkg = JSON.parse(fs.readFileSync(new URL("../native/package.json", import.meta.url), "utf8"));

test("no camera permission without a camera to use it", () => {
  const usesCamera = Object.keys(pkg.dependencies || {}).some((d) => /camera|barcode/i.test(d));
  if (usesCamera) return;   // a real camera feature brings its own permission back
  assert.equal(app.ios.infoPlist.NSCameraUsageDescription, undefined, "iOS declares a camera it never opens");
  assert.ok(!(app.android.permissions || []).includes("CAMERA"), "Android declares a camera it never opens");
});
