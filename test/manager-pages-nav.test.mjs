import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFile } from "node:fs/promises";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { build } from "esbuild";
import { managerNavGlyphs } from "../src/manager-nav-glyphs.mjs";

const url = new URL("../src/ManagerPagesNav.jsx", import.meta.url);
const module = { exports: {} };
const output = await build({ entryPoints: [url.pathname], bundle: true, write: false, platform: "node",
  format: "cjs", packages: "external", loader: { ".css": "empty" } });
new Function("require", "module", "exports", output.outputFiles[0].text)(createRequire(url), module, module.exports);
const Nav = module.exports.default;
const shape = {
  board: "1110111/1010111/1110111/0000000/1110111/1110101/1110111",
  gm: "0111100/0100100/0101100/0100100/0101100/1100100/0111110",
  history: "0011110/0010010/1111010/1001010/1011010/1001000/1111000",
  standards: "0111110/0101010/0111110/0100000/0100000/0111000/1111100",
  roster: "0110000/0110011/0000011/0110000/1110011/1110111/1110111",
  pages: "1001111/0000000/1001110/0000000/1001111/0000000/0000000",
  chevron: "0000000/0000000/1000001/0100010/0010100/0001000/0000000",
  "import-ticket": "0011100/0010100/0011100/0000000/0000000/0000000/0000000",
  "import-slot": "0000000/0000000/0000000/0000000/0111110/1000001/1111111",
  "import-laser": "0000000/0000000/0000000/0000000/0000000/0011100/0000000",
};
test("approved navigation bitmaps are exact and share the product PixIcon renderer", async () => {
  assert.deepEqual(Object.fromEntries(Object.entries(shape).map(([id, rows]) => ["manager-nav-" + id, rows.split("/")])), managerNavGlyphs);
  const core = await readFile(new URL("../src/LeadPerformanceCalculator.jsx",import.meta.url),"utf8");
  assert.match(core,/const PIX = \{\s*\.\.\.managerNavGlyphs/);
  assert.match(core,/onChange=\{navOnChange\} Icon=\{PixIcon\} importBadge=\{<ImportBadge storeData=\{storeData\} \/>\}/);
});

test("the disclosure only exposes parent-permitted pages and uses the supplied live badge", () => {
  const items=[["board","Dashboard"],["import","Import"],["gm","Summary"],["history","History"],["roster","People"]];
  const html=renderToStaticMarkup(React.createElement(Nav,{items,value:"gm",onChange:()=>{},
    Icon:({glyph})=>React.createElement("i",{"data-glyph":glyph}),
    importBadge:React.createElement("b",null,"fixture count")}));
  assert.match(html,/aria-label="Store pages"/);
  assert.match(html,/sage-page-pinned" aria-current="page"[^>]*>[^<]*<i[^>]+><\/i>Summary/);
  assert.match(html,/aria-controls="([^"]+)" aria-expanded="false".*sage-pages-panel" id="\1" hidden/);
  assert.doesNotMatch(html,/>Targets<\//);
  assert.equal((html.match(/>Import /g)||[]).length,1);
  assert.match(html,/fixture count/);
});
