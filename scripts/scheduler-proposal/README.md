# Schedule creator, isolated proposal

Fictional data only. This is a reviewable local prototype, not an application integration or an approved design. Open it through a local static server:

```sh
python3 -m http.server 5189 --bind 127.0.0.1 --directory scripts/scheduler-proposal
# Open http://127.0.0.1:5189/
node --test scripts/scheduler-proposal/*.test.mjs
PLAYWRIGHT_MODULE=/path/to/playwright node scripts/scheduler-proposal/probe.mjs
```

The browser probe accepts `BROWSER=webkit`, `CHROMIUM_PATH`, and `EVIDENCE_DIR`. Its default environment paths describe the implementation workspace, not a new dependency. No package or lockfile changed.

## Source and ownership

- Repository: `jorgeasenrivera/lead-performance-calculator`.
- Original base: `2fba7db0d12879578bf02679d08fa020e06391a8`. Refreshed onto main `15ea1a80db1c17e7f5d9b99db026f7fc09b30697` on 14 October 2026. The upstream change is the separate mock-CORS test fix; no proposal paths overlap.
- Prototype branch: `codex/scheduler-fictional-proposal`.
- Read `AGENTS.md`, `README.md`, `docs/in-flight.md`, and the relevant C111 / H-C31 / H-X50 handoffs before editing. `/workspace/.agents` contained no skills.
- [C111 draft #464](https://github.com/jorgeasenrivera/lead-performance-calculator/pull/464) read at `9dba9a622ceae39a52d83bde2d43519ce0e46263`, including review closure. No code or data from that branch is imported. Its pending loader, tables, real-data reconciliation and X15 integration remain separate gates.
- Existing Manager/UI and C111 ownership would conflict with production integration or loader edits. All changes here are new files beneath this directory. No shared source, board, handoff, claim, dependency, workflow, security setting or project deployment configuration is edited. The optional static preview uses its own deployment-local preview-config.json, with no install/build command or application functions. The user's explicit isolated-prototype instruction governs this work; no claim is renewed or transferred.
- [The original five-option artifact](https://claude.ai/artifact/9SLVwjUu3LtVyecMvt6ToU) was unavailable. Nothing here claims to reproduce or implement its approved choices. The page includes five review decisions marked Not reviewed.

## What is implemented

The Schedule area is represented by a standalone proposal, not wired into the owned Manager shell. It defaults to the next full Monday-to-Sunday week using the UTC date; the reproducible review clock is 14 October 2026 and the selected week is 19 to 25 October. Week and store selectors are functional.

Six invented stores have deterministic synthetic daily delivery readings from January 2014 to October 2026. No names, counts or workbook cells come from the real stores. Explicit NA is Closed, missing is Unknown and a numeric zero is known zero. Forecast cards show the min/max of the last eight known matching weekdays and explain it. This is an illustrative range, not C111's forecast implementation or a calibrated prediction interval. Weather, market and appointments are excluded.

Person and store sheets are separate. Person edits cover days off, available hours and a weekly cap. Store edits create effective-dated rules for open hours, minimum coverage, optional entered delivery capacity, regular closure days and holiday exceptions. The sheet loads the rule applicable to its effective date, and changing that date reloads its settings and discards unsaved sheet edits. Dates before the first rule start with blank required fields. Special-day editing is optional and explicit: unchecked saves preserve exceptions, and selecting an exception date displays its existing status. Versions apply per date, including midweek changes; saving the same effective date replaces the local draft at that date. Holiday Open explicitly overrides a regular closure. Historical deliveries never infer staffing rules.

The proposal assigns full store-hour shifts using availability and weekly caps, rotating toward people with fewer assigned hours. It always uses entered minimum coverage. Optional capacity can raise the requirement, but delivered-car counts alone never determine it. Manager overrides retain selected people and surface day-off, hour, weekly-cap and coverage conflicts. Unknown store status produces no assignments. Mark reviewed locally is blocked while conflicts remain. Nothing publishes or writes outside page memory. Reload discards edits.

## Verification

- `npm test`: 936 passed, including 16 proposal behavioral tests (five cover the store editor corrections).
- `npm run build`: passed; existing large-chunk warning remains.
- Chromium and WebKit: the full editing/review flow at 1440, 390 and 320 pixels, at both 100% and 200% root text (12 complete scenarios), including repeated coverage saves, optional exception editing, October 26 then October 19 edits, switching effective dates, earlier-save isolation and focus returning to each sheet’s actual opener. No horizontal overflow at baseline or 200% root text. No page errors or external requests. The CSP also prohibits connections.
- Initial browser run exposed malformed holiday options. Fixed the markup, then reran the complete browser flow successfully. No failed assertion was removed or weakened.
- WebKit now passes the scheduler-specific flow. Debian libraries were downloaded and extracted beneath `/tmp/scheduler-libs`, then linked into the temporary WebKit bundle’s `sys/lib`; no system packages were installed. Playwright’s final GLES preflight reads `/sbin/ldconfig -p` and cannot see that temporary library. After verifying `ctypes.CDLL('libGLESv2.so.2')` loads successfully, `PLAYWRIGHT_SKIP_VALIDATE_HOST_REQUIREMENTS=1` bypassed that cache-only preflight. The actual WebKit browser and every application assertion ran; no test was skipped. This launch setup is environment-specific, not a required application dependency.
- No physical phone, native WebView, native keyboard, screen-reader, production UI integration, legal staffing policy, real forecasting accuracy or backend verification. 200% root text is a layout stress check, not full browser zoom or OS accessibility certification.
- The existing salesperson/rooms/motion feel harness was not run locally: those surfaces and their harness are unchanged. This proposal has its own browser checks.

Selected screenshots are committed under `evidence/`; the complete local set and machine-readable results are in `/workspace/scheduler-evidence`. The evidence manifest hashes the exact UI/model/probe files used for capture. Screenshots are fictional. The repository's existing deployment ignore rule excludes scripts-only changes. A separately requested static preview uses the existing Sage project, whose preview SSO protection was confirmed enabled. Only index.html, app.mjs, model.mjs, store-editor.mjs, style.css and the deployment-local preview configuration are eligible for upload. No project settings, access rules or credentials are changed. The exact preview URL and remote verification outcome are reported on the PR; local browser evidence does not claim authenticated remote browser coverage.

## Independent-review corrections

The original single-save browser probe missed three real defects: ordinary coverage saves overwrote a confirmed Open exception with Unknown, a future rule seeded earlier edits, and closing Store sheet focused Person sheet. Corrected within this directory only. Five new editor regressions and the expanded browser flow exercise repeated saves, optional exception edits, date-based initialization and both focus return paths. The first correction browser attempt received an empty response from the stale local static server; restarting that server restored access, then the full probe passed. This was a local serving failure, not an assertion failure or a browser pass.

## Extended browser verification

Both engines execute repeated coverage saves, date switches, explicit Closed / Unknown / Open transitions, blocked and successful manager review, overrides, person edits, store/week isolation, and both normal and enlarged-text flows. Phone widths use mobile/touch emulation, not a physical device. Close and Escape discard unsaved edits and restore the correct opener; cancelling exception editing also restores the displayed saved status. The latter two small interaction fixes are covered by the browser flow. Root-text enlargement is not OS font scaling or physical Android verification.

To repeat WebKit in this workspace after the temporary library setup:

```sh
PLAYWRIGHT_BROWSERS_PATH=/tmp/scheduler-browsers \
PLAYWRIGHT_SKIP_VALIDATE_HOST_REQUIREMENTS=1 BROWSER=webkit \
node scripts/scheduler-proposal/probe.mjs
```

On a normally provisioned Playwright host, use `BROWSER=webkit` without the temporary setup or preflight override. Browser versions and each scenario’s viewport, text scale and checks are recorded in the JSON results.

## Review images

[Desktop week](evidence/desktop-week.png) · [Phone week](evidence/phone-week.png) · [Phone person sheet](evidence/phone-person.png) · [Phone store sheet](evidence/phone-store.png) · [Phone override conflict](evidence/phone-override.png) · [Repeated save](evidence/phone-repeat-save.png) · [Earlier rule after future-rule edit](evidence/phone-dated-rule.png)

Remaining implementation limits: no partial shifts, breaks, cross-store staffing, store-local timezone configuration, durable saves, history top-up, forecast validation, manager authentication, salespeople's app hours or production wiring. These require later scoped work and ownership coordination. User review of the five proposed defaults remains outstanding.

[WebKit desktop](evidence/webkit-desktop-week.png) · [WebKit phone](evidence/webkit-phone-week.png) · [WebKit 320px enlarged store sheet](evidence/webkit-320-text200-store.png) · [Chromium 320px enlarged store sheet](evidence/chromium-320-text200-store.png)
