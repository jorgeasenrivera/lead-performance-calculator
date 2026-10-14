# Schedule creator, isolated proposal

Fictional data only. This is a reviewable local prototype, not an application integration or an approved design. Open it through a local static server:

```sh
python3 -m http.server 5189 --bind 127.0.0.1 --directory scripts/scheduler-proposal
# Open http://127.0.0.1:5189/
node --test scripts/scheduler-proposal/model.test.mjs
PLAYWRIGHT_MODULE=/path/to/playwright node scripts/scheduler-proposal/probe.mjs
```

The browser probe accepts `BROWSER=webkit`, `CHROMIUM_PATH`, and `EVIDENCE_DIR`. Its default environment paths describe the implementation workspace, not a new dependency. No package or lockfile changed.

## Source and ownership

- Repository: `jorgeasenrivera/lead-performance-calculator`.
- Base: `2fba7db0d12879578bf02679d08fa020e06391a8`, origin/main verified 14 October 2026.
- Prototype branch: `codex/scheduler-fictional-proposal`.
- Read `AGENTS.md`, `README.md`, `docs/in-flight.md`, and the relevant C111 / H-C31 / H-X50 handoffs before editing. `/workspace/.agents` contained no skills.
- [C111 draft #464](https://github.com/jorgeasenrivera/lead-performance-calculator/pull/464) read at `9dba9a622ceae39a52d83bde2d43519ce0e46263`, including review closure. No code or data from that branch is imported. Its pending loader, tables, real-data reconciliation and X15 integration remain separate gates.
- Existing Manager/UI and C111 ownership would conflict with production integration or loader edits. All changes here are new files beneath this directory. No shared source, board, handoff, claim, dependency, workflow, security setting or deployment configuration is edited. The user's explicit isolated-prototype instruction governs this work; no claim is renewed or transferred.
- [The original five-option artifact](https://claude.ai/artifact/9SLVwjUu3LtVyecMvt6ToU) was unavailable. Nothing here claims to reproduce or implement its approved choices. The page includes five review decisions marked Not reviewed.

## What is implemented

The Schedule area is represented by a standalone proposal, not wired into the owned Manager shell. It defaults to the next full Monday-to-Sunday week using the UTC date; the reproducible review clock is 14 October 2026 and the selected week is 19 to 25 October. Week and store selectors are functional.

Six invented stores have deterministic synthetic daily delivery readings from January 2014 to October 2026. No names, counts or workbook cells come from the real stores. Explicit NA is Closed, missing is Unknown and a numeric zero is known zero. Forecast cards show the min/max of the last eight known matching weekdays and explain it. This is an illustrative range, not C111's forecast implementation or a calibrated prediction interval. Weather, market and appointments are excluded.

Person and store sheets are separate. Person edits cover days off, available hours and a weekly cap. Store edits create effective-dated rules for open hours, minimum coverage, optional entered delivery capacity, regular closure days and holiday exceptions. Versions apply per date, including midweek changes; saving the same effective date replaces the local draft at that date. Holiday Open explicitly overrides a regular closure. Historical deliveries never infer staffing rules.

The proposal assigns full store-hour shifts using availability and weekly caps, rotating toward people with fewer assigned hours. It always uses entered minimum coverage. Optional capacity can raise the requirement, but delivered-car counts alone never determine it. Manager overrides retain selected people and surface day-off, hour, weekly-cap and coverage conflicts. Unknown store status produces no assignments. Mark reviewed locally is blocked while conflicts remain. Nothing publishes or writes outside page memory. Reload discards edits.

## Verification

- `npm test`: 927 passed, including 11 new behavioral tests.
- `npm run build`: passed; existing large-chunk warning remains.
- Chromium: full editing/review flow at 1440, 390 and 320 pixels. No horizontal overflow at baseline or 200% root text. No page errors or external requests. The CSP also prohibits connections.
- Initial browser run exposed malformed holiday options. Fixed the markup, then reran the complete browser flow successfully. No failed assertion was removed or weakened.
- WebKit: attempted, but launch blocked by missing GTK4, Graphene, HarfBuzz ICU, Manette, Hyphen and GLES system libraries. This is not a WebKit pass.
- No physical phone, native WebView, native keyboard, screen-reader, production UI integration, legal staffing policy, real forecasting accuracy or backend verification. 200% root text is a layout stress check, not full browser zoom or OS accessibility certification.
- The existing salesperson/rooms/motion feel harness was not run: those surfaces and their harness are unchanged. This proposal has its own browser checks.

Selected screenshots are committed under `evidence/`; the complete local set and machine-readable results are in `/workspace/scheduler-evidence`. The evidence manifest hashes the exact UI/model/probe files used for capture. Screenshots are fictional. No protected hosted preview is provisioned; the local page and draft source are the review deliverables. The repository's existing deployment ignore rule excludes scripts-only changes.

## Review images

[Desktop week](evidence/desktop-week.png) · [Phone week](evidence/phone-week.png) · [Phone person sheet](evidence/phone-person.png) · [Phone store sheet](evidence/phone-store.png) · [Phone override conflict](evidence/phone-override.png)

Remaining implementation limits: no partial shifts, breaks, cross-store staffing, store-local timezone configuration, durable saves, history top-up, forecast validation, manager authentication, salespeople's app hours or production wiring. These require later scoped work and ownership coordination. User review of the five proposed defaults remains outstanding.
