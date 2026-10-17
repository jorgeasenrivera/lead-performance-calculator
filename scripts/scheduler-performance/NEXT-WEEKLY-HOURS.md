# Weekly-hours warning contract

Recorded from Jorge's clarification on 17 October 2026. The subsequent weekly-hours checkpoint implements a read-only scheduled-interval audit in import review, selected-week review and People. See evidence/weekly-hours/CHECKPOINT.md for results and limits. Break adjustments remain unavailable; these totals are not paid working hours.

## Required behavior

- Usual weekly hours are 40–50. Hours below 40 are not automatically a problem or a minimum requirement.
- Show an operational warning only above 3,000 exact, deduplicated known minutes for the full Monday–Sunday calendar interval, including dates across month boundaries. Exactly 50:00 does not warn. At 50:01 show the total and the 00:01 excess.
- Keep explicitly confirmed person-specific hard caps separate. Do not raise those caps or treat the fixture's default 40 hours as user policy.
- A soft 50-hour warning alone must not erase assignments, block an import, lower coverage, or alter team-comparison inclusion.
- Unknown adjacent-week data and unknown durations remain incomplete. If known minutes already exceed 50 hours, a warning may say “at least,” with the known total/excess. Otherwise do not claim the person is within range.
- Do not infer legal overtime or legal compliance from this operational threshold.

## Proposed implementation and verification

1. Inspect the existing full-week interval accounting, dated assignments, import review and confirmed-cap provenance. Reuse one canonical Monday–Sunday aggregation across months and deduplicate overlapping or repeated intervals before summing exact minutes.
2. Represent the soft warning independently from confirmed hard-cap validation and separately retain completeness/unknown-duration information. Do not change assignment, import, coverage or audit eligibility decisions merely because this warning is present.
3. Show total and excess in review/day/week context using precise minute values. Keep under-40 and incomplete-week language neutral. Keep strength and fairness claims unchanged.
4. Test 50:00/50:01 boundaries, duplicate and overlapping intervals, cross-month weeks, known versus unknown durations, missing adjacent-month evidence, known totals already above 50, confirmed individual hard caps, and fixture defaults without confirmed policy provenance.
5. Assert that adding only the soft warning leaves assignments, atomic import behavior, coverage counts and team comparisons unchanged. Obtain targeted browser evidence for the warning and incomplete states before publishing the subsequent preview.

The real workbook sample, live persistence and real People integration remain outside this plan. No production, database, credential, permission or formal writer-claim change is authorized by this note.
