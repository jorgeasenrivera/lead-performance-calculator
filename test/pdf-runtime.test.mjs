import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";
import { build } from "esbuild";

const root = fileURLToPath(new URL("../", import.meta.url));
const ingest = path.join(root, "api/ingest.mjs");
const marker = "Fictional PDF runtime check";
function syntheticPdf() {
  const stream = `BT /F1 12 Tf 12 760 Td (${marker}) Tj ET`;
  const objects = ["<< /Type /Catalog /Pages 2 0 R >>", "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>", `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`];
  let pdf = "%PDF-1.4\n"; const offsets = [0];
  for (const [index, value] of objects.entries()) {
    offsets.push(Buffer.byteLength(pdf)); pdf += `${index + 1} 0 obj\n${value}\nendobj\n`;
  }
  const xref = Buffer.byteLength(pdf);
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`
    + offsets.slice(1).map((n) => `${String(n).padStart(10, "0")} 00000 n \n`).join("");
  return Buffer.from(pdf + `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`);
}

async function runRuntime(mode) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "sage-pdf-runtime-"));
  try {
    const pdf = path.join(dir, "fictional.pdf");
    await fs.writeFile(pdf, syntheticPdf());
    let load = `import(${JSON.stringify(pathToFileURL(ingest).href)})`;
    if (mode !== "native") {
      const source = (await fs.readFile(ingest, "utf8")).replaceAll('from "./', 'from "' + path.join(root, "api/").replaceAll("\\", "/"));
      const output = path.join(dir, "ingest.cjs");
      // Generic .js and explicit .mjs select different esbuild __toESM modes.
      // Keep real package bundling, worker loading and the actual extractor.
      // Bind import.meta.url to the source's location because CJS has no native
      // import.meta. This models interop, not Vercel's unverified build recipe.
      await build({ stdin: { contents: source, resolveDir: dir, sourcefile: "ingest." + mode, loader: "js" },
        nodePaths: [path.join(root, "node_modules")], bundle: true, platform: "node", format: "cjs",
        outfile: output, external: ["canvas"], logLevel: "silent",
        define: { "import.meta.url": JSON.stringify(pathToFileURL(ingest).href) } });
      load = `Promise.resolve(require(${JSON.stringify(output)}))`;
    }
    const code = `globalThis.fetch=()=>{throw new Error("Network forbidden in PDF regression")};
      ${load}.then(async ({extractPdfLines})=>{
        const lines=await extractPdfLines(require("node:fs").readFileSync(${JSON.stringify(pdf)}));
        if(!lines.flatMap(l=>l.parts).some(p=>p.str.includes(${JSON.stringify(marker)})))throw new Error("missing fixture text");
        console.log("SYNTHETIC_PDF_EXTRACTED");
      }).catch(e=>{console.error(e.stack);process.exitCode=1});`;
    const result = spawnSync(process.execPath, ["-e", code], { encoding: "utf8", timeout: 20000 });
    assert.equal(result.status, 0, `${mode}: ${result.error || ""}\n${result.stdout}\n${result.stderr}`);
    assert.match(result.stdout, /SYNTHETIC_PDF_EXTRACTED/);
  } finally { await fs.rm(dir, { recursive: true, force: true }); }
}
for (const mode of ["native", "js", "mjs"]) {
  test(`actual PDF extraction in ${mode === "native" ? "native ESM" : "bundled CommonJS from ." + mode}`, () => runRuntime(mode));
}
