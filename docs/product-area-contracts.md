# Sage product area contracts

Product contract record, 4 November 2026. The Online presence follow-up is a sanitized draft for non-production review; publication is approved, but merge and deployment are not. Decision summaries are paraphrased and dated; inspected repository sources, interpretations and open questions remain distinct. This document grants no application change, ownership transfer or release approval. Product requirements and implementation evidence remain separate; this record does not authorize integration activation or an application release.

Read this before proposing a fix. Preserve existing workflows unless an explicit decision below changes them. An implementation gap, a proposed improvement and an unresolved product decision are different things.

**Evidence:** D = explicit Jorge decision; R = inspected repository contract/code; I = interpretation or proposal, not a user decision; Q = unresolved. Requirements are not proof of implementation. Reference IDs resolve in the compact evidence ledger below.

## Area contracts

| Area | Must do | Must not do | Open decision or boundary |
|---|---|---|---|
| Product / Performance | Lead with metrics consolidated from DriveCentric. Preserve useful one-screen density and Live Floor, Phone Line and Online entries. D1 | Recast Sage as a schedule-first product or remove useful metrics to accommodate staffing. | Exact new responsive layouts need their own approval. |
| Performance / Summary / History | Preserve store, person, channel and period meanings; distinguish store vehicles from individual credit. I1 (proposed metric safeguards, not an approved semantic redesign) | Change a metric's meaning, population, goal month or enforcement policy under a display/copy fix. | Q1: canonical store sales source and missing/conflicting-source behavior. Q2: appointments created versus scheduled and Internet versus all-channel opportunities. |
| Daily Activity / RockEd | Store manager manually switches qualification on/off against the store's threshold. D2 | Derive RockEd from a report, calls, videos or absence of an import. | Legacy historical stars compatibility is separate; do not remove it incidentally. |
| Salesperson home / Live Activity | Preserve personal day/month and queue position (R3), and follow the Live Activity state-sheet gate (R5). Shared phone helpers publish goals, days off and RockEd qualification (R2). | Treat a field available to the phone as a requirement for the TV, or give staff manager permissions. | Phone publication and daily points remain separate from TV scope. |
| TV | Display the store sales total as whole units; exclude RockEd. D3,D4. Preserve showroom-distance readability with everyone fitting on one screen without scrolling. R1 | Sum displayed person credits and silently call that authoritative store vehicles; round a wrong total to disguise missing sales; make TV work depend on RockEd. | Q1 still governs authoritative source selection. The store-total decision does not independently settle individual split-credit presentation. |
| Live Floor | Preserve the walk-in rotation. Desired opening is one hour before store opening. All room features are independently toggleable per store. D5,R3 | Treat disabled as broken, activate globally, or change eligibility while fixing visuals or metrics. | Q3: missing/default hours and DST policy. Desired behavior is not approval to mutate live settings. |
| Phone Line | Preserve the separate phone opportunity queue and per-store toggle. D5,R3 | Apply Live Floor's one-hour-early policy to Phone automatically. | Q3: Phone-specific timing needs its own contract. |
| Online | Help BDC and managers choose the best fit for an unassigned Internet lead within seconds from associates who raise their hands separately for each lead. Consider leads taken so far that month, especially that day; performance; physical presence that day; vehicle; and lead source. Use scheduler context, but require associates to actively join the geofenced Online line, like Phone Line and Live Floor. Scheduling alone never joins someone. An associate physically present and joined remains eligible when not scheduled, including work on a day off. Preserve its entry and per-store toggle intent. D12-D16,D1,D5 | Pretend Sage already receives the necessary lead information; invent an integration/feed, automatic assignment, fixed rotation, numerical weights or availability of the required data; auto-join scheduled associates or exclude a physically present, joined associate solely for being unscheduled. | Wait for a lead-data connection; do not add a manual lead-entry stopgap. D16. The required lead-information integration/source is currently unavailable. The factors and presence/join boundary and per-lead hand raising are decided (D13-D15). Q4: weights, tie-breaks, metric definitions, remaining join/geofence details and data integration remain undecided. BDC/managers make the choice; no automatic assignment or fixed rotation is specified. R3 describes the existing placeholder, not the newly defined target. |
| Schedule viewer / calendar | Monthly view and months-ahead planning, entered from Performance. Day, teams on/off, then Units Delivered. Normal manager view is viewing; Make Schedule enters editing. Actual daily sales, best-day/heatmap and staffing warnings are requested behavior. D6,D7. Verify each visual proposal's approval separately before implementation or release (R5). | Replace actual daily sales with historical averages; infer On from absent Off; restore duplicate Who's on or sold-by-day popups as missing features. | Historical demand informs planning, not recorded sales. A scaffold is not a completed schedule viewer. |
| Schedule editor / generator | Aim for a usable schedule in about 30 seconds, with qualifying questions if useful and an editable result. Support teams, individuals, mixed schedules, holidays, historical demand and visible coverage/fairness. D8 | Silently replace manual choices with suggestions or present a forecast as an actual result. | Q5: optimization weights, fairness priorities and insufficient-history defaults require a contract before changing them. The 30-second aim is not a measured pass. |
| Schedule publication / access | Published manager schedules reach approved staff apps within seconds. Managers may schedule pending associates, but those associates cannot see schedules until account approval. Changes are audited; editing access can be granted/revoked. D9,D10 | Auto-approve an account by scheduling it; expose manager drafts to staff; claim end-to-end delivery from a backend/mock-only test. | Pending visibility is already settled. Native/browser delivery verification is an engineering gate, not a product question. |
| People / roles | Keep team/person identity, account approval and schedule editing permissions distinct. D9,D10 | Infer broader manager, admin or BDC rights from schedule assignment or visual work. | Resolve exact operation permissions with the existing security/access owner; this document changes none. |
| Imports / data | Reuse existing parser, daily-sales, authorization and transport ownership. Keep manual RockEd, actual sales and historical demand distinct. R4,D2; I1 supplies proposed metric safeguards. | Create competing data paths to fill a UI gap; infer report coverage from upload/render timestamps. | Q1/Q2 and correction/freshness contracts must be settled before semantic changes. |
| Copy / visual language / motion | Preserve Sage's retro palette, recognizable icons/font and useful density, with familiar usable controls. Improve verbiage throughout Sage. D11 | Change product behavior under a wording/style fix or treat a prototype as approved design. | Existing proposal, state-sheet, phone and release gates still apply. R5 |

## Questions, not automatic fix work

- **Q1:** Which business measure/report is authoritative for each store-sales surface, and what happens when it is missing or conflicts? Whole-unit TV store total is already decided; do not re-ask or round.
- **Q2:** Which appointment and opportunity meanings should Summary labels promise? Present exact current labels and source definitions when asking.
- **Q3:** What should each room do when store hours are missing and through daylight-saving changes? Live Floor's early-opening preference is not a complete all-room policy.
- **Q4:** How should the agreed factors (D13) be defined and presented, including any weights or tie-breaks, and which authorized sources can supply the required lead information? D14 settles active join, geofencing and unscheduled eligibility. D15 requires a separate hand raise for each lead, not standing interest in all available leads. Remaining join/geofence details, the precise role of scheduler context and integration remain undecided; do not infer shift rules, geofence radius, location source or exceptions. D12 preserves BDC/manager choice among interested associates, not automatic assignment or fixed rotation. Sage currently has no way to ingest the needed lead information. D16 requires waiting for a connection, not manual lead entry; the source remains undecided. Do not assume new API/feed access or activation.
- **Q5:** What are the scheduler's exact fairness, optimization and insufficient-history rules? Existing manual choices and approved constraints remain intact.
- Ask about legacy RockEd stars only if proposed work changes historical compatibility. Today's manual yes/no source is settled.

These questions do not block unrelated work. Ask only when a concrete implementation requires the answer.

## Fix admission and engineering gates

Process recommendation I2: before starting a fix, record: area, explicit violated requirement, observed behavior and exact build, impact, owner, smallest correction and acceptance test. If the behavior is merely unspecified, record a question or proposal instead.

Keep these separate from product decisions:

- Source review is not runtime verification; prototype behavior is not approved product intent.
- Applicable tests/build, synthetic integration checks, Chromium/WebKit and physical-device evidence remain required for the actual change. Do not report unrun checks as passed.
- A reviewed scheduler patch is reviewed within its scope, not an end-to-end delivery or product-design approval.
- Preserve existing owners and their exact file scopes. No second parser, parallel big-file writer, ownership transfer, live-data access or production release follows from this document.
- Follow current deployment guards and permissions. An old repository instruction to push a claim to main does not override a non-production/read-only boundary.

## Change ledger

| Change | Type | Effect |
|---|---|---|
| State metrics-first purpose and preserve room identities | Product contract, D1 | Reject schedule-first redesign assumptions; no automatic UI rewrite. |
| Separate manual RockEd from report/TV work | Product contract, D2,D4 | Remove RockEd from TV acceptance and dependency lists. Preserve relevant phone/manual work. |
| Whole-unit TV store total | Product contract, D3 | Supersedes older proposed November 2 acceptance of displayed-person credit sums as the TV total. Does not authorize rounding or settle Q1. |
| Record pending schedule visibility | Product contract, D9 | Hidden until approved; do not re-open as an unanswered question. |
| Preserve viewer/editor split and actual-versus-historical sales | Product contract, D6-D8 | Prevent redundant popups, forecast-as-actual displays and editor-first viewing. |
| Define Online best-fit selection and factors | Product contract, D12,D13; unresolved Q4 | BDC/managers choose among raised hands using monthly and especially daily leads taken, performance, physical presence, vehicle and lead source. Weights, tie-breaks and integration remain open; no automatic assignment or fixed rotation. |
| Define Online presence and joining | Product contract, D14 | Scheduler context participates, but active geofenced joining is required. Physically present, joined associates remain eligible even when unscheduled. No automatic joining, new shift rules or implementation approval. |
| Require a hand raise per lead | Product contract, D15 | Joining the Online line is distinct from expressing interest in a particular lead. No standing hand raise or automatic assignment is implied. |
| Wait for the Online lead-data connection | Product boundary, D16 | No manual lead-entry stopgap. Integration/source remains unresolved and unavailable; no connection or activation is claimed. |
| Mark timing/source choices undecided | Product boundary | Prevent invented requirements from generating unnecessary fixes. |
| Require area/requirement/evidence before a fix | Engineering process recommendation, I2 | Classify defect, proposal, unresolved decision and verification gap separately. |
| Keep source, review, runtime and release evidence distinct | Engineering gate, R5; classification recommendation I2 | No new permissions or release approval; current lane ownership stays intact. |

## Decision and source ledger

D entries are paraphrased product-owner decisions, dated below. They do not imply that a particular implementation or visual proposal has been approved. R entries cite inspected repository evidence; I entries remain interpretations/proposals.

- **D1, 2 November 2026:** Metrics are Sage's primary purpose. Preserve useful information density and the Live Floor, Phone Line and Online entry points while evolving the interface.
- **D2, 4 November 2026:** RockEd qualification is a manual manager yes/no against the store's threshold, not report-derived data.
- **D3, 3 November 2026:** The TV store sales total must represent whole units. A fractional displayed-person credit sum is not an acceptable substitute for that store total.
- **D4, 4 November 2026:** RockEd does not belong on the TV board.
- **D5, 17 October 2026:** Live Floor should open an hour before store opening. Live Floor, Phone Line and Online are toggleable per store.
- **D6, 14-15 October 2026:** Support monthly schedules and advance-month planning from Performance. Separate the normal viewing hierarchy from Make Schedule editing.
- **D7, 15 October 2026:** Consolidate duplicate staffing and sold-by-day popups into the calendar; show daily sales intensity and best-day information.
- **D8, 15-16 October 2026:** Aim for rapid, editable schedule generation that supports team and individual schedules, coverage, fairness and historical demand.
- **D9, 22 October 2026:** Published manager schedules should reach approved staff apps within seconds. Pending people may be scheduled, but their schedules remain hidden until account approval.
- **D10, 15 October 2026:** Audit schedule changes and allow editing permission to be granted or revoked for the relevant manager, sales and BDC workflows.
- **D11, 1-4 November 2026:** Preserve Sage's visual identity, palette, matching metrics/icons/font and familiar usable controls; improve verbiage throughout the product.

- **D12, 4 November 2026, clarified:** Online should help BDC and managers choose the best fit for an unassigned Internet lead within seconds from associates who raise their hands separately for each lead. No automatic assignment or fixed rotation is specified. The later D13 decision supplies the factors without numerical weights. Sage currently lacks a way to bring in the needed lead information; its source/integration remains unresolved. D14 later settles the active-join and presence boundary, not all workflow details.

- **D13, 4 November 2026:** Best fit considers how many leads an associate has taken so far that month, with particular emphasis on that day; performance; whether the associate is physically present that day; the vehicle; and the lead source. The decision supplies factors, not weights, a scoring formula, automatic assignment or confirmation that all needed data is available.

- **D14, 4 November 2026:** Online availability uses scheduler context together with associates actively joining the line. Joining is mandatory and geofenced like Phone Line and Live Floor; scheduling alone does not put an associate in the line. A physically present associate who has joined remains eligible even if not scheduled that day, including when working on a day off. This specifies eligibility, not shift rules, automated assignment, geofence parameters or an implementation/live-setting change.

- **D15, 4 November 2026:** Associates raise their hands separately for each lead. Being joined to the Online line does not create standing interest in every lead. BDC/managers still choose among the hands raised for that lead; this does not define automatic assignment, weights or new data availability.

- **D16, 4 November 2026:** Wait for a lead-data connection before proceeding with Online lead intake. Do not add manual lead entry as an interim solution. The connection/source is still unresolved; this is not confirmation that an integration exists or authorization to activate one.

Repository baseline inspected: `63515276f14b7d65ab5af2947f76845d8a07faef`; not a deployment assertion.

- **R1:** Inspected [TV template](https://github.com/jorgeasenrivera/lead-performance-calculator/blob/63515276f14b7d65ab5af2947f76845d8a07faef/src/leaderboard-template.mjs#L784-L795) sums displayed people's sold credits and explicitly requires everyone to fit on one screen without scrolling, with rows scaled for readability across the showroom floor.
- **R2:** [Shared phone fields and daily points](https://github.com/jorgeasenrivera/lead-performance-calculator/blob/63515276f14b7d65ab5af2947f76845d8a07faef/api/_phone-rows.mjs#L1-L82), including legacy stars fallback. Do not infer TV scope from this module.
- **R3:** [README room and audience definitions](https://github.com/jorgeasenrivera/lead-performance-calculator/blob/63515276f14b7d65ab5af2947f76845d8a07faef/README.md#L33-L57).
- **R4:** [Existing coordination and scheduler integration boundaries](https://github.com/jorgeasenrivera/lead-performance-calculator/blob/63515276f14b7d65ab5af2947f76845d8a07faef/docs/in-flight.md). Recheck current ownership before edits.
- **R5:** [Ownership, proposal and device/state-sheet gates](https://github.com/jorgeasenrivera/lead-performance-calculator/blob/63515276f14b7d65ab5af2947f76845d8a07faef/AGENTS.md).

Interpretation/proposal evidence, separate from inspected repository references:

- **I1:** Prior source-only metric analysis at `b8478e9f45654a03cc1f2212896a4eb59a491366` identifies possible source, population and label conflicts. Its suggested safeguards and semantics are hypotheses/proposals, not current runtime evidence or user-approved product decisions. Q1/Q2 require resolution before semantic changes.
- **I2:** Fix-admission checklist and docs-only integration workflow are process recommendations for reducing unnecessary work, not new product features or permissions.

## Draft review correction, 4 November 2026

Publication timing now refers only to published manager schedules reaching approved staff apps. Requested calendar behavior no longer implies blanket visual approval. Interpretations/proposals have their own I category, separate from inspected repository evidence. TV readability/no-scrolling and the missing salesperson/approval citations are restored. No product decision, source file, ownership or permission changed.
