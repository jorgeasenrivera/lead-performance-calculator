/* A small reader for .xlsx, with nothing but Node's own zip support (zlib).
   The sales-history load runs once from a workbook Jorge keeps, and adding a
   spreadsheet library to the app's dependencies for that is a worse trade than
   a hundred lines here, tested against a workbook the test builds itself.

   It reads what a person typed or a formula last computed: the cell's cached
   value, as a string, a number or nothing. It does not do dates, styles,
   merged cells or anything a delivery count does not need. */
import { inflateRawSync } from "node:zlib";

const u16 = (b, o) => b.readUInt16LE(o);
const u32 = (b, o) => b.readUInt32LE(o);

export function unzip(buf) {
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--) {
    if (u32(buf, i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error("not a zip file");
  const count = u16(buf, eocd + 10);
  let p = u32(buf, eocd + 16);
  const files = new Map();
  for (let n = 0; n < count; n++) {
    if (u32(buf, p) !== 0x02014b50) throw new Error("bad zip directory");
    const method = u16(buf, p + 10), csize = u32(buf, p + 20);
    const nameLen = u16(buf, p + 28), extraLen = u16(buf, p + 30), commentLen = u16(buf, p + 32);
    const local = u32(buf, p + 42);
    const name = buf.toString("utf8", p + 46, p + 46 + nameLen);
    if (u32(buf, local) !== 0x04034b50) throw new Error("bad zip entry");
    const start = local + 30 + u16(buf, local + 26) + u16(buf, local + 28);
    const raw = buf.subarray(start, start + csize);
    files.set(name, () => (method === 0 ? raw : method === 8 ? inflateRawSync(raw) : (() => { throw new Error("zip method " + method); })()));
    p += 46 + nameLen + extraLen + commentLen;
  }
  return files;
}

const ENT = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };
const decode = (s) => s.replace(/&(#x?[0-9a-fA-F]+|[a-z]+);/g, (m, e) =>
  e[0] === "#" ? String.fromCodePoint(e[1] === "x" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10)) : (ENT[e] ?? m));

const colIndex = (ref) => {
  let n = 0;
  for (const ch of ref.replace(/[0-9]/g, "")) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
};
const textOf = (xml) => [...xml.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)].map((m) => decode(m[1])).join("");

/* Every sheet as { name, rows }: rows[r][c], null where the cell is empty. */
export function readXlsx(buf) {
  const files = unzip(buf);
  const get = (name) => { const f = files.get(name); return f ? f().toString("utf8") : null; };
  const wb = get("xl/workbook.xml");
  if (!wb) throw new Error("no workbook in this file");
  const rels = new Map([...(get("xl/_rels/workbook.xml.rels") || "").matchAll(/<Relationship\b[^>]*>/g)].map((m) => {
    const id = /\bId="([^"]*)"/.exec(m[0]), target = /\bTarget="([^"]*)"/.exec(m[0]);
    return [id && id[1], target && target[1]];
  }));
  const strings = [...(get("xl/sharedStrings.xml") || "").matchAll(/<si\b[^>]*>([\s\S]*?)<\/si>/g)].map((m) => textOf(m[1]));
  const sheets = [];
  for (const m of wb.matchAll(/<sheet\b[^>]*>/g)) {
    const name = /\bname="([^"]*)"/.exec(m[0]), rid = /\br:id="([^"]*)"/.exec(m[0]);
    if (!name || !rid) continue;
    let target = rels.get(rid[1]) || "";
    target = target.startsWith("/") ? target.slice(1) : "xl/" + target;
    const xml = get(target);
    if (xml == null) continue;
    const rows = [];
    for (const rm of xml.matchAll(/<row\b([^>]*?)(?:\/>|>([\s\S]*?)<\/row>)/g)) {
      const rnum = /\br="(\d+)"/.exec(rm[1]);
      const r = rnum ? parseInt(rnum[1], 10) - 1 : rows.length;
      const row = rows[r] || (rows[r] = []);
      for (const cm of (rm[2] || "").matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
        const ref = /\br="([A-Z]+)\d+"/.exec(cm[1]);
        if (!ref) continue;
        const type = (/\bt="([^"]*)"/.exec(cm[1]) || [])[1];
        const body = cm[2] || "";
        const v = /<v>([\s\S]*?)<\/v>/.exec(body);
        let val = null;
        if (type === "inlineStr") val = textOf(body);
        else if (v) {
          const raw = decode(v[1]);
          if (type === "s") val = strings[parseInt(raw, 10)] ?? null;
          else if (type === "str" || type === "e") val = raw;
          else if (type === "b") val = raw === "1" ? "TRUE" : "FALSE";
          else {
            // an empty or blank cache is a missing value, not a zero (Number("") is 0)
            const t = raw.trim(), n = t === "" ? NaN : Number(t);
            val = t === "" ? null : Number.isFinite(n) ? n : raw;
          }
        }
        if (val !== null && val !== "") row[colIndex(ref[1])] = val;
      }
    }
    for (let i = 0; i < rows.length; i++) if (!rows[i]) rows[i] = [];
    sheets.push({ name: decode(name[1]), rows: rows.map((row) => Array.from(row, (c) => c ?? null)) });
  }
  return sheets;
}
