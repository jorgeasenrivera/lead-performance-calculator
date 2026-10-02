/* Read explicitly supplied local PDFs and print a private review ledger.
   There is no network client, output-file writer, replay, or --write mode. */
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { mapDailyActivityGrid } from "../api/_report-parsers.mjs";
import { buildDailyDeliveryEvidence, deliveryLedger, DAILY_DELIVERY_METRIC } from "../api/_daily-deliveries.mjs";

const readPdfLines = async (bytes) => (await import("../api/ingest.mjs")).extractPdfLines(bytes);

export async function runDeliveryDryRun(manifest, { baseDir = process.cwd(), extractLines = readPdfLines } = {}) {
  if (manifest?.schemaVersion !== 1 || !Array.isArray(manifest.stores) || !Array.isArray(manifest.sources))
    throw new Error("invalid_manifest");
  deliveryLedger({ storeId: manifest.storeId, month: manifest.month });
  const root = await fs.realpath(baseDir), candidates = [];
  for (const source of manifest.sources) {
    const failed = (reason) => ({ storeId: manifest.storeId, businessDate: null, status: "incomplete",
      reason, count: null, metric: DAILY_DELIVERY_METRIC, publicationEligible: false,
      filename: String(source?.filename || "") });
    try {
      if (typeof source?.path !== "string" || /:\/\//.test(source.path)) throw new Error("invalid_local_source_path");
      const file = await fs.realpath(path.resolve(root, source.path));
      if (!file.startsWith(root + path.sep)) throw new Error("source_path_outside_manifest_directory");
      const bytes = await fs.readFile(file);
      if (!bytes.subarray(0, 5).equals(Buffer.from("%PDF-"))) throw new Error("raw_pdf_required");
      const lines = await extractLines(bytes);
      const metadata = { reportType: source.reportType, filename: source.filename || path.basename(file),
        receivedAt: source.receivedAt, sentAt: source.sentAt ?? null, printedDay: source.printedDay ?? null };
      const candidate = buildDailyDeliveryEvidence({ lines, bytes, metadata, stores: manifest.stores, storeId: manifest.storeId });
      const mapped = mapDailyActivityGrid(lines);
      const unitsColumn = mapped?.rows[1]?.indexOf("Units Delivered") ?? -1;
      const units = unitsColumn >= 0 ? mapped.rows.slice(2).map((r) => r[unitsColumn]) : [];
      const employeeCredits = units.length && units.every((u) => Number.isFinite(u)) ? units.reduce((a,b) => a+b,0) : null;
      candidate.reconciliation = { employeeCredits, printedStoreTotal: candidate.count,
        difference: employeeCredits !== null && candidate.count !== null ? employeeCredits - candidate.count : null,
        changesPrimaryCount: false };
      candidates.push(candidate);
    } catch (error) {
      const known = new Set(["invalid_local_source_path", "source_path_outside_manifest_directory", "raw_pdf_required"]);
      candidates.push(failed(known.has(error.message) ? error.message : "source_read_or_parse_failed"));
    }
  }
  return deliveryLedger({ storeId: manifest.storeId, month: manifest.month, candidates });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  if (args.length !== 2 || args[0] !== "--manifest") {
    process.stderr.write("Usage: node scripts/delivery-reconstruction-dry-run.mjs --manifest local-manifest.json\nNo network or write mode is supported.\n");
    process.exitCode = 2;
  } else {
    try {
      const file = path.resolve(args[1]);
      const manifest = JSON.parse(await fs.readFile(file, "utf8"));
      // PDF.js may report an optional rendering dependency even though this
      // tool only reads text. Keep diagnostics visible on stderr, not in JSON.
      const log = console.log, warn = console.warn;
      const diagnostic = (...args) => process.stderr.write(args.map(String).join(" ") + "\n");
      let ledger;
      try {
        console.log = diagnostic; console.warn = diagnostic;
        ledger = await runDeliveryDryRun(manifest, { baseDir: path.dirname(file) });
      } finally { console.log = log; console.warn = warn; }
      process.stdout.write(JSON.stringify(ledger, null, 2) + "\n");
      if (ledger.rejected.length || ledger.days.some((d) => d.status === "conflict" || d.status === "incomplete")) process.exitCode = 1;
    } catch { process.stderr.write("Could not read a valid local reconstruction manifest.\n"); process.exitCode = 2; }
  }
}
