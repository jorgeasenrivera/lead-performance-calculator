# Generation return and absence recovery

This preview-only increment is stacked on PR #482 at `7cd34f0d1e2fdc3298997513f8c35a2a8303ce40`. It addresses two observed expert-walkthrough findings. It does not change generation choices, coverage rules, assignment validation, occupied-date transfer restrictions or undo scope.

## Generation settings detours

Before: choose Individuals, set sales minimum to 0, uncheck Alex's Sales role, then open Review hours & closures or Review time off & limits. Cancel settings and reopen generation. The form returned to Mixed, minimum 1 and Alex's role checked.

After: a settings detour retains raw generation answers for that store/month, including incomplete inputs, shift times, eligibility, roles, demand choices and expanded sections. Settings show Apply and return to generation and Cancel settings and return to generation. Escape also cancels the current settings and returns. The generation heading receives focus, answers are restored, and the confirmation checkbox is cleared. A settings change is never treated as already confirmed for a new generation run.

This is UI state in memory, not a saved generation policy or cross-store/month persistence. Applied policies are still collected and validated only when generating. Apply/discard/reset clears the corresponding retained answers. Changing month does not copy retained answers into another month. Existing pending day/settings edits continue to block generation; if another settings form has pending changes, resolve it first. A Resume generation label provides a route back to retained answers after that interruption.

## Absence recovery guidance

Before: changing a recorded Off to On failed only after Apply day. Native validation instructed the manager to clear the absence through Unknown first. Recurring unavailability required People settings.

After: the affected person's status control describes the same protective sequence in persistent adjacent text before failure: Unknown → Apply day, then On → Apply day if available. After the explicit clearing step, a revision-bound notice says the absence was cleared and the person remains Unknown. Clearing does not automatically assign work. Recurring weekday guidance points to Setup → People and states that clearing a date does not change recurring availability. `aria-describedby` connects the instruction to the status control.

The existing rejection, imported-time removal confirmation, availability checks, pending-choice rules and explicit Apply actions remain. This change does not add replacement, swapping, general undo, persistence or live People integration. The cleared-state notice is transient and expires after another planner revision. Existing source, membership and unknown-hours semantics are unchanged.

## Verification

`probe-guided-recovery.mjs` runs Individuals, Teams, Mixed and CSV-off import followed by Mixed at desktop and phone widths. Each route must reach Reviewed, and import must retain the original Off and source. Targeted trials repeat both settings detours with Apply, Cancel and Escape, check raw invalid-input retention, confirmation reset, focus, month isolation and discard. Recovery trials require guidance before rejection, explicit Unknown clearing, subsequent On application and continued recurring-unavailability protection. Scoped axe scans cover settings, generation and day guidance. Final engine/results, exact SHA and protected deployment identity are recorded on the draft PR and in external evidence.

Physical devices and screen readers remain untested. These are deterministic browser interactions, not human learnability research. General settings/day undo and occupied-destination off-day swaps remain unavailable. The separate draft/publication-status finding is not changed here. No new fictional-data disclaimer or production publication control is added.
