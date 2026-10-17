import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {glyphs,icon} from "./sage-icons.mjs";
test("planner icons reuse the actual Sage PIX glyphs and stay decorative",()=>{
 const source=readFileSync(new URL('../../src/LeadPerformanceCalculator.jsx',import.meta.url),'utf8');
 for(const [name,rows] of Object.entries(glyphs)) {
  const match=source.match(new RegExp('^  '+name+':\\s*(\\[[^\\n]+\\])','m'));
  assert.deepEqual(rows,JSON.parse(match[1]));
  assert.match(icon(name),/aria-hidden="true"/);
 }
});
