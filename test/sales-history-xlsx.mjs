/* Builds a small .xlsx for the sales-history tests: a zip written by hand
   (stored and deflated entries, a central directory), so the reader is tested
   against a file the test controls and nothing from the real workbook. */
import { deflateRawSync } from "node:zlib";

const crcTable = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
const crc32 = (b) => { let c = 0xffffffff; for (const x of b) c = crcTable[(c ^ x) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const colName = (i) => { let s = ""; for (let n = i + 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s; return s; };

export function zip(entries) {
  const parts = [], central = [];
  let offset = 0;
  for (const [name, text, stored] of entries) {
    const raw = Buffer.from(text, "utf8"), data = stored ? raw : deflateRawSync(raw), nm = Buffer.from(name);
    const head = Buffer.alloc(30);
    head.writeUInt32LE(0x04034b50, 0); head.writeUInt16LE(20, 4); head.writeUInt16LE(stored ? 0 : 8, 8);
    head.writeUInt32LE(crc32(raw), 14); head.writeUInt32LE(data.length, 18); head.writeUInt32LE(raw.length, 22); head.writeUInt16LE(nm.length, 26);
    const dir = Buffer.alloc(46);
    dir.writeUInt32LE(0x02014b50, 0); dir.writeUInt16LE(20, 4); dir.writeUInt16LE(20, 6); dir.writeUInt16LE(stored ? 0 : 8, 10);
    dir.writeUInt32LE(crc32(raw), 16); dir.writeUInt32LE(data.length, 20); dir.writeUInt32LE(raw.length, 24); dir.writeUInt16LE(nm.length, 28); dir.writeUInt32LE(offset, 42);
    parts.push(head, nm, data); central.push(Buffer.concat([dir, nm]));
    offset += head.length + nm.length + data.length;
  }
  const cd = Buffer.concat(central), end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(entries.length, 8); end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...parts, cd, end]);
}

/* sheets: [{ name, rows: [[cell, ...], ...] }]; strings go through the shared
   string table, numbers are numbers, null/undefined leave the cell out, and
   { xml: '<v></v>' } writes the cell's inner XML as given (an empty cache, say). */
export function buildXlsx(sheets) {
  const shared = [], idx = new Map();
  const sst = (s) => { if (!idx.has(s)) { idx.set(s, shared.length); shared.push(s); } return idx.get(s); };
  const sheetXml = sheets.map((sh) => `<?xml version="1.0"?><worksheet><sheetData>${sh.rows.map((row, r) =>
    `<row r="${r + 1}">${row.map((c, i) => c == null ? "" : typeof c === "number"
      ? `<c r="${colName(i)}${r + 1}"><v>${c}</v></c>` : typeof c === "object" ? `<c r="${colName(i)}${r + 1}">${c.xml}</c>`
        : `<c r="${colName(i)}${r + 1}" t="s"><v>${sst(c)}</v></c>`).join("")}</row>`).join("")}</sheetData></worksheet>`);
  return zip([
    ["[Content_Types].xml", `<?xml version="1.0"?><Types/>`],
    ["xl/workbook.xml", `<?xml version="1.0"?><workbook><sheets>${sheets.map((s, i) => `<sheet name="${esc(s.name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join("")}</sheets></workbook>`],
    ["xl/_rels/workbook.xml.rels", `<?xml version="1.0"?><Relationships>${sheets.map((s, i) => `<Relationship Id="rId${i + 1}" Target="worksheets/sheet${i + 1}.xml"/>`).join("")}</Relationships>`],
    ["xl/sharedStrings.xml", `<?xml version="1.0"?><sst>${shared.map((s) => `<si><t>${esc(s)}</t></si>`).join("")}</sst>`, true],
    ...sheetXml.map((x, i) => [`xl/worksheets/sheet${i + 1}.xml`, x]),
  ]);
}

/* One month sheet in the workbook's layout. blocks: [{ label, labelAbove,
   nums: [Mon..Sun day numbers or null], stores: { name: [Mon..Sun values] } }]
   stacked down the sheet, one block under the next, columns A to I. */
export function monthSheet(name, blocks) {
  const rows = [];
  for (const b of blocks) {
    rows.push([b.labelAbove ?? null, ...b.nums.map((n) => n ?? null)]);
    rows.push([b.label ?? "2026 Sales", "Mon", "Tues", "Wed", "Thur", "Fri", "Sat", "Sun", "Total"]);
    for (const [store, vals] of Object.entries(b.stores)) rows.push([store, ...vals]);
    rows.push(["Total", 0, 0, 0, 0, 0, 0, 0, 0]);
    rows.push([], []);
  }
  return { name, rows };
}
