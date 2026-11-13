import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import https from "node:https";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const ingestUrl = new URL("../api/ingest.mjs", import.meta.url);
const text = "Fictional PDF interoperability";
function fictionalPdf() {
  const stream = `BT /F1 12 Tf 30 90 Td (${text}) Tj ET`;
  const objects = ["<< /Type /Catalog /Pages 2 0 R >>", "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 400 140] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>", `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`];
  let body = "%PDF-1.4\n"; const offsets = [];
  for (const [i, value] of objects.entries()) { offsets.push(Buffer.byteLength(body)); body += `${i + 1} 0 obj\n${value}\nendobj\n`; }
  const xref = Buffer.byteLength(body);
  body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  body += offsets.map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`).join("");
  return Buffer.from(body + `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`);
}

async function withoutNetwork(run) {
  const savedFetch = globalThis.fetch;
  const saved = [http, https].map((module) => ({ module, request: module.request, get: module.get }));
  let calls = 0;
  const refuse = () => { calls++; throw new Error("PDF module loading and byte extraction must stay local"); };
  globalThis.fetch = refuse;
  for (const { module } of saved) { module.request = refuse; module.get = refuse; }
  try { await run(); assert.equal(calls, 0, "no remote fallback may hide a module or worker failure"); }
  finally {
    globalThis.fetch = savedFetch;
    for (const { module, request, get } of saved) { module.request = request; module.get = get; }
  }
}

async function bundledReader(extension, unsupportedShape = false) {
  // Compile the complete real ingest source. Changing the virtual entry's
  // extension exercises esbuild's two CommonJS import-interop conventions.
  const output = await build({ stdin: { contents: fs.readFileSync(ingestUrl, "utf8"),
    resolveDir: fileURLToPath(new URL(".", ingestUrl)), sourcefile: `ingest-entry.${extension}`, loader: "js" },
    bundle: true, write: false, platform: "node", format: "cjs", packages: "external", logLevel: "silent",
    define: { "import.meta.url": JSON.stringify(ingestUrl.href) },
    plugins: unsupportedShape ? [{ name: "unsupported-pdf-module", setup(builder) {
      builder.onResolve({ filter: /^pdfjs-dist\/legacy\/build\/pdf\.js$/ }, () => ({ path: "unsupported", namespace: "unsupported" }));
      builder.onLoad({ filter: /.*/, namespace: "unsupported" }, () => ({ contents: 'export const getDocument = "not a reader"; export default {};', loader: "js" }));
    } }] : [],
  });
  const module = { exports: {} };
  new Function("require", "module", "exports", output.outputFiles[0].text)(createRequire(ingestUrl), module, module.exports);
  return module.exports.extractPdfLines;
}

function assertExtracted(lines) {
  assert.equal(lines.length, 1);
  assert.equal(lines[0].pg, 1);
  assert.equal(lines[0].parts.map((part) => part.str).join(" "), text);
  assert.ok(Number.isFinite(lines[0].y));
}

test("native ingest module loads and extracts an actual fictional PDF without network", async () => {
  await withoutNetwork(async () => {
    const { extractPdfLines } = await import(ingestUrl.href);
    assertExtracted(await extractPdfLines(fictionalPdf()));
  });
});

for (const extension of ["js", "mjs"]) {
  test(`real PDF extraction survives bundled ${extension} CommonJS interop without network`, async () => {
    await withoutNetwork(async () => assertExtracted(await (await bundledReader(extension))(fictionalPdf())));
  });
}

test("an unsupported module shape is rejected, never replaced by a remote reader or empty success", async () => {
  await withoutNetwork(async () => {
    // This negative case replaces only the module's exports. All positive cases
    // above and the unchanged intake suite execute the actual locked PDF.js.
    const reader = await bundledReader("mjs", true);
    await assert.rejects(reader(fictionalPdf()), /getDocument is not a function/);
  });
});

test("the native real reader rejects invalid PDF bytes without a network fallback", async () => {
  await withoutNetwork(async () => {
    const { extractPdfLines } = await import(ingestUrl.href);
    await assert.rejects(extractPdfLines(Buffer.from("This is not a PDF")), /Invalid PDF/);
  });
});
