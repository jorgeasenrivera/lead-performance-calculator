import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { LEADERBOARD_HTML } from "../src/leaderboard-template.mjs";

/* Every store and person here is fictional. A person who leaves mid-month keeps
   their credits in the store's data, but nothing of theirs shows on the TV: no
   row, no name, no line for leavers, and no share of "Displayed associate
   credits", which counts only what the wall shows. */
const STORE = { id: "fictional-demo", name: "Fictional Demo Motors" };
const STAYING = ["Alex Example", "Bailey Example", "Casey Example", "Erin Example"];
const ym = new Date().toLocaleDateString("en-CA", { timeZone: "America/New_York" }).slice(0, 7);

async function publisherModule(path, name) {
  const url = new URL(path, import.meta.url);
  const output = await build({ stdin: { contents: fs.readFileSync(url, "utf8") + `\nexport { ${name} };\n`,
    resolveDir: fileURLToPath(new URL(".", url)), sourcefile: fileURLToPath(url), loader: path.endsWith("jsx") ? "jsx" : "js" },
    bundle: true, write: false, platform: "node", format: "cjs", packages: "external", logLevel: "silent", loader: { ".css": "text" },
    define: { "import.meta.env": "{}", "import.meta.url": JSON.stringify(url.href) } });
  const module = { exports: {} };
  new Function("require", "module", "exports", output.outputFiles[0].text)(createRequire(url), module, module.exports);
  return module.exports;
}
const clientModule = publisherModule("../src/LeadPerformanceCalculator.jsx", "buildBoardPayload");

const units = (n) => ({ internetUnits: n, phoneUnits: 0, showroomUnits: 0, campaignUnits: 0, serviceUnits: 0 });
// Alex 5, Bailey 4, Casey 3, Erin 2; Drew left this month with 3.5 still credited.
function storeData(drew = 3.5) {
  const stats = Object.fromEntries(STAYING.map((name, i) => [name.toLowerCase(), units(5 - i)]));
  stats["drew example"] = { ...units(2), serviceUnits: drew - 2 };
  return {
    roster: STAYING.map((name, i) => ({ id: "p" + i, name, roleId: "sales" })),
    departed: [{ id: "p8", name: "Drew Example", roleId: "sales", at: "2026-11-05" }],
    months: { [ym]: { stats } },
  };
}
async function board(data) {
  const config = { stores: [{ id: STORE.id, name: STORE.name }], roles: [{ id: "sales", onBoard: true }] };
  return (await clientModule).buildBoardPayload(config, STORE.id, data);
}
async function render(first, style) {
  const elements = new Map(), intervals = [], added = [];
  const element = () => ({ innerHTML: "", textContent: "", className: "", style: { setProperty() {} },
    classList: { add() {}, remove() {}, contains: () => false }, querySelectorAll: () => [], addEventListener() {},
    getAttribute: () => null, appendChild(child) { added.push(child); }, remove() {} });
  const at = `${ym}-16T16:00:00Z`;
  class Clock extends Date { constructor(...args) { super(...(args.length ? args : [at])); } static now() { return new Date(at).getTime(); } }
  const window = { innerHeight: 1080, innerWidth: 1920, addEventListener() {}, matchMedia: () => ({ matches: true }) };
  window.parent = window;
  if (style) first = { ...first, boardDisplay: { ...(first.boardDisplay || {}), style } };
  let payload = first;
  const context = vm.createContext({ window, Date: Clock, Intl, Number, console, URL, Math,
    document: { getElementById(id) { if (!elements.has(id)) elements.set(id, element()); return elements.get(id); },
      body: element(), createElement: element, querySelector: () => null, querySelectorAll: () => [], addEventListener() {} },
    localStorage: { getItem: () => null, setItem() {} }, requestAnimationFrame: () => 1, cancelAnimationFrame() {},
    setTimeout: () => 1, clearTimeout() {}, setInterval(fn, ms) { intervals.push({ fn, ms }); return 1; }, clearInterval() {},
    fetch: async () => ({ ok: true, status: 200, json: async () => [{ value: payload }] }),
  });
  const html = LEADERBOARD_HTML({ ...first, storeKey: "fictional-board", db: { url: "http://127.0.0.1:5433", anonKey: "fictional" } }, (await clientModule).PIX);
  vm.runInContext([...html.matchAll(/<script>([\s\S]*?)<\/script>/g)][0][1], context);
  const settle = async () => { for (let i = 0; i < 40; i++) await Promise.resolve(); };
  await settle();
  return {
    root: elements.get("root"),
    congrats: () => added.filter((n) => /cg-card/.test(n.innerHTML)).map((n) => n.innerHTML).join(""),
    async refresh(next) { payload = next; intervals.find((t) => t.ms === 15 * 60 * 1000).fn(); await settle(); },
  };
}

test("the app's own save sends the wall nothing of a person who left", async () => {
  const row = await board(storeData());
  // The row still lists who left under `departed`, which is how the board knows
  // to leave them off; nothing it draws from carries them.
  assert.doesNotMatch(JSON.stringify({ roster: row.roster, people: row.people, stats: row.months[ym].stats, ticker: row.ticker }), /drew/i);
  assert.equal(row.months[ym].leavers, undefined, "no leavers' figure travels to the wall");
});

for (const style of [undefined, "bars"]) {
  const label = style ? "the bars board" : "the classic board";
  test(`${label} shows no row, name, line or count for a person who left`, async () => {
    const html = (await render(await board(storeData()), style)).root.innerHTML;
    assert.doesNotMatch(html, /Drew|Former|leaver/i);
    assert.equal((html.match(/<tr class="row/g) || []).length, STAYING.length);
    // The credit line counts only the people the wall shows: 5 + 4 + 3 + 2.
    assert.match(html, /Displayed associate credits: 14</);
  });
}

test("a credit that lands for a person who left is never celebrated or shown", async () => {
  const view = await render(await board(storeData()));
  await view.refresh(await board(storeData(4.5)));
  assert.equal(view.congrats(), "");
  assert.doesNotMatch(view.root.innerHTML, /Drew/);
  assert.match(view.root.innerHTML, /Displayed associate credits: 14</);
});
