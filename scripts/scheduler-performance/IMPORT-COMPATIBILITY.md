> Historical preview evidence references below are not included in this carrier; archived screenshots/diagnostics were excluded. They are not acceptance evidence for manual publication.

# Preview import compatibility

This increment starts from merged main `7b64b7f330ada8c22e982fb5391d32a187121056`. It changes only the isolated scheduler preview. No production source, database, access rules, credentials, People connection or scheduler activation changes. No formal writer claim is renewed or transferred.

## Manager flow

Select the store and month, open Make Schedule, then Import schedule. Choose explicit person/date CSV, legacy saved off-days JSON, or date-row team grid CSV. The two compatibility formats require explicit store/month confirmation. Review exact identities, dates, known times, provenance, unapplied notes and membership decisions. Resolve or explicitly skip blocked rows before applying the complete batch to the in-memory draft. Cancel changes nothing. Changing stores invalidates review; an edited draft requires rereading the file.

Apply files one at a time. Existing assignments and source attribution stay in place. Blank grid cells over known assignments are exact no-ops and are counted separately as unchanged. Review reports matched person/date plus ready, duplicate, unchanged, blocked and skipped totals. Identical rows are no-ops; conflicting statuses, intervals or membership snapshots block rather than overwrite. A manager-cleared Unknown marked by the existing manual-edit lock blocks re-uploaded known facts until the day is deliberately edited or the source row skipped. This is a bounded in-memory guard, not a durable import history or undo service. Full batch selection is deferred. Reloading clears this fictional preview's imported data.

## Supported shapes

Legacy JSON accepts either `{off: {personId: ["YYYY-MM-DD"]}}` or `{daysOff: {personId: ["YYYY-MM-DD"]}}`, with optional `storeId`, `month`, `file`, `at`, `kind` and `unmatched` names. Conflicting store/month declarations reject the source. Dates outside the explicitly selected month remain blocked; split the source deliberately. Saved unmatched names lack dates and require correction or explicit skip. Person IDs match exactly within the selected synthetic roster; manual identity decisions are explicit. Saved absence has its own `legacy-off` reason. Neither missing days nor merged OFF/VAC imply working or vacation. No current membership is attached to legacy history. Because the off reason is unknown, that date does not establish a known availability denominator in the balance audit. Valid off-days do not require store or shift hours; incomplete working data keeps weekly totals incomplete.

Team-grid CSV supports Date, optional Day / Store hours, unique Team A style schedule columns, and one vertical legend to their right. A legend heading can include a lead name, with one further exact name per row in the heading's column or to its right. Side-by-side legends, repeated headings and multiple names in a legend row reject the source. Dates use ISO, US dates with four-digit years, or explicit English month/day/year. Time ranges require two explicit 24-hour times or am/pm times. A bare `9-5` is ambiguous. Blank team cells retain unknown assignment and hours; OFF and VAC are distinguished only when explicitly present in the grid. Store-hours and notes do not manufacture assignments. Notes are retained and displayed as unapplied. Missing legends and unknown identities remain blocked.

Grid team membership is a dated source declaration, not evidence about other dates. The manager may confirm a known team for each date or retain unknown historical membership. No teams or people are created implicitly. Existing same-day, America/New_York interval validation and weekly hard-limit checks remain authoritative. Overnight, DST-change-day, break and unsupported work-hour policies remain outside this parser.

Both adapters are bounded to 100 KB and 500 expanded person/date rows. JSON source line labels are review ordinals; `source.path` identifies the saved key. Grid provenance includes physical line, column, legend line, original date/cell, store hours and note. Original workbook bytes and live roster records are never embedded. The new fixtures are synthetic equivalents, not copied staff lists or schedules.

## Boundaries and review gaps

This is compatibility scaffolding for the retained shapes, not validation against original workbooks. Original files remain pending. XLS/XLSX/PDF, arbitrary spreadsheet layouts, merged cells, historical membership recovery and full multi-file batch review are deferred. A known legacy off-day has unknown reason; unlisted working assignments remain unknown. Team balance is an audit, not fair generation; strength remains unavailable.

The existing review control classes, palette and spacing are reused from `planner.css` (built as `style.css`) and `shared-system.css`; no new visual tokens or production UI edits. Manager next-month review/apply/cancel is tested. Staff published-shift lookup is not applicable to this unpublished in-memory preview. No live role or store authorization is claimed. The data-integrity review consulted [OWASP ASVS 5.0.0](https://owasp.org/projects/asvs/) as a reference, without claiming a full ASVS assessment.

See `evidence/import-compatibility/` for final results, screenshots and release identity. Browser emulation and scoped axe scans do not establish physical-device, native keyboard, screen-reader or full accessibility conformance. Hosted browser results are reported separately from local results.
