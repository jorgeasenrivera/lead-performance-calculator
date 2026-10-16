# Dated teams, absences and scheduling opportunity

This is a fictional, in-memory preview under `scripts/scheduler-performance`. Production source, account handlers, persistence, permissions and writer claims are unchanged. The input is CSV; a real schedule/workbook sample is still pending. No private attachments are included.

## Membership and import contract

Membership is store-scoped and keyed by person identity, with inclusive from/through dates and source metadata. Newer explicit dated entries overlay earlier ones. Display modes never edit membership. A person can belong to several teams. Known no-team and unknown membership are different states.

Applied assignments retain their membership snapshot. A later dated team edit flags a mismatch rather than moving the assignment silently. Day details require an explicit review action to use current membership. People grouping and each person's team label read the same dated ledger. Imported shifts retain original team/file/line provenance even after an explicit snapshot review.

The optional CSV Team column accepts team names separated by `|`, or `none`. A mismatch requires an explicit keep-current or confirm-for-this-date decision. Unknown teams must first be added, kept unchanged, or skipped. Cancel has no import effect. Stale drafts are rejected. Existing different assignment snapshots must be reviewed before importing a replacement membership.

Work uses exact integer-minute intervals. Scheduled off, vacation, dated unavailable, recurring unavailable and unknown assignments remain distinct. Manual edits preserve unchanged absence sources. Bulk team actions preserve off-days and leave; a new work assignment cannot silently overwrite an existing absence. Clear and apply the absence first to explicitly resolve it. Existing cross-month weekly-cap validation remains conservative.

## Comparison method

The visible calendar month is the comparison period. Store and person totals count each identity once; each team deduplicates its members. Shared members can appear in multiple teams, so team totals are not additive. Cards expose unique people, open-date membership days and individual denominators.

Available minutes are personal availability intersected with open store hours. Recurring unavailability, dated unavailability and vacation are excluded. Scheduled off remains available time because it is a scheduling decision. Unknown availability is excluded and counted; unknown assignments are not classified as off. Available windows are not a weekly-cap budget. Eligibility still observes weekly caps, including adjacent months.

Numerators use eligible applied intervals. Entered conflicting time is reported separately. Opening and closing bands are the first and last 60 minutes of store hours and may overlap on short days. Unresolved membership mismatches and unknown membership are excluded from team comparisons, with counts shown.

Higher-history days use the midpoint of the existing comparable-day sales range, with at least four prior known same-weekday observations, up to eight. Dates strictly above the visible-period median form this comparison. Missing/closed observations are excluded; zero remains valid. This is daily fictional store-sales opportunity, never inferred hourly demand or salesperson ability.

A fixed 20-percentage-point rate gap produces a review prompt, not a favoritism finding. No reliable role, experience or individual-performance inputs are connected to this preview. Team strength is explicitly unavailable; no ratings or worker rankings are invented.

## Production People boundary and integration plan

The actual People surfaces are `PeoplePhone` at `src/Manager.jsx:20459` and `StorePeoplePanel` at `src/Manager.jsx:20817`. They consume real config/data, store identity, account/role handlers and `onChange`. They have not been edited or connected to this preview. Existing production fields are not validated ability inputs for this comparison.

A future approved integration should first expose a read adapter for dated store/person membership and absence provenance, render a fictional protected replica of those People groups, and verify shared identity/date semantics. Live integration then needs an approved persistence contract, authenticated store authorization, revision/conflict handling and migration policy. Reuse the read model, not production account or transfer handlers, for the replica. No production work is admitted by this preview.

## Verification limits

Browser tests use local Chromium and WebKit at 1440, 390 and 320 CSS pixels, with 100% and 200% root text. This is text scaling, not physical-device testing or actual browser-menu zoom. Scoped axe checks are not a full accessibility audit or screen-reader test. The browser flows assert no network requests after initial assets and no storage/IndexedDB calls during team/import interactions.

Hosted authentication cannot be exercised through this environment's CONNECT proxy (previous protected previews returned 403). Protection is verified through Vercel metadata and deployed artifact hashes without bypassing access. No production deploy or merge is performed. Report automation remains deferred.
