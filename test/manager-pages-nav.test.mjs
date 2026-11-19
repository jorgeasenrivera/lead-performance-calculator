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

test("a committed Pages selection recovers detached focus without taking focus from another control", () => {
  const originalDocument = globalThis.document;
  const body = {}, other = {}, menuItem = {};
  const document = { body, activeElement: body };
  globalThis.document = document;
  try {
    const refs = [], state = [], layout = [];
    let refIndex, stateIndex, requested;
    const trigger = { focus: () => { document.activeElement = trigger; } };
    const hooks = {
      ...React,
      useState: (initial) => {
        const index = stateIndex++;
        if (!(index in state)) state[index] = initial;
        return [state[index], next => { state[index] = next; }];
      },
      useId: () => "fixture-pages",
      useRef: initial => refs[refIndex++] ??= {current: initial},
      useEffect: () => {},
      useLayoutEffect: effect => layout.push(effect),
    };
    const mod = {exports: {}};
    new Function("require", "module", "exports", output.outputFiles[0].text)(
      name => name === "react" ? hooks : createRequire(url)(name), mod, mod.exports);
    const render = value => {
      refIndex = stateIndex = 0;
      layout.length = 0;
      const tree = mod.exports.default({items: [["board", "Dashboard"], ["history", "History"], ["gm", "Summary"]],
        value, onChange: key => { requested = key; }, Icon: () => null});
      const [rail, panel] = tree.props.children;
      const toggle = rail.props.children[2];
      toggle.ref.current = trigger;
      tree.ref.current = {getBoundingClientRect: () => ({left: 0}), style: {setProperty() {}}};
      trigger.getBoundingClientRect = () => ({left: 0, width: 44});
      panel.ref.current = {contains: node => node === menuItem};
      return {toggle, panel};
    };
    const commit = () => { for (const effect of layout) effect(); };
    const select = (from, index) => {
      render(from).toggle.props.onClick();
      const {panel} = render(from);
      document.activeElement = menuItem;
      panel.props.children[index].props.onClick();
      assert.equal(document.activeElement, trigger, "selection immediately returns focus");
    };

    render("board"); commit();
    select("board", 0); render("board"); commit();
    assert.equal(document.activeElement, trigger, "same-page activation preserves focus");
    select("board", 1);
    assert.equal(requested, "history");
    // The hidden shell lost its active control before the lazy page committed.
    document.activeElement = body;
    render("history"); commit();
    assert.equal(document.activeElement, trigger, "new destination recovers document focus");
    select("history", 2);
    document.activeElement = other;
    render("gm"); commit();
    assert.equal(document.activeElement, other, "a control that owns focus keeps it");
    select("gm", 1);
    render("gm"); commit(); // a guard prevented this selection from committing
    document.activeElement = body;
    render("history"); commit();
    assert.equal(document.activeElement, body, "a later unrelated change does not reuse the rejected request");
  } finally {
    if (originalDocument === undefined) delete globalThis.document;
    else globalThis.document = originalDocument;
  }
});
