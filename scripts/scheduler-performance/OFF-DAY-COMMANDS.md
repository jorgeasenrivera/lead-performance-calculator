# Off-day Move / Copy preview

Stacked on the reviewed import branch at 8748d12d2a0eb983e3dc8aea1ef90f265a372e94. PR #481 is unchanged and remains unmerged. This increment changes only isolated preview scripts, tests and documentation.

A manager enters Make Schedule, chooses Move / copy off-day from the toolbar or an applied off-day row, selects the same person's destination date, reviews both dates and confirms. Move removes only that person's explicit off fact and leaves a protected Unknown at the source. Copy leaves the source untouched. Other people, work intervals and recorded sales remain unchanged. There is no persistence, publishing, live People integration or scheduler activation.

Only explicit scheduled off and legacy off are eligible. Legacy unknown reason remains unknown. Vacation, recurring unavailability, unknown recurring availability and conflicting source work reject. Destination work, absences and protected manual Unknown choices reject rather than being replaced. Date-only operations may retain known off on closed or unknown-hours dates; the review labels store status and invents no duration or coverage. Dates remain within 2014 through 2100 and America/New_York; the existing DST-change restriction is retained. Source and destination may cross month/year boundaries.

The destination uses its own dated membership. Unknown source membership remains unknown until explicitly reviewed; source teams are not blindly copied. Original absence metadata remains intact alongside transfer mode, original date and source, and any displaced non-protected unknown note. The source Unknown retains the moved fact's provenance and a generation lock. Original source file/line and the transfer date are visible in applied day details.

## Atomic command and undo

`reviewOffDay`, `applyOffDay` and `undoOffDay` belong to createPlanner. The pure plan validates both dates before any mutation. Private, single-use WeakMap tokens prevent caller-authored or changed payloads from being applied. Apply stages both override maps before publishing them synchronously and advances revision once. It never uses whole-roster dayEditRecord for a one-person operation.

Undo restores original override values or removes overrides that did not originally exist, reinstating fixture fallback. It is deliberately conservative: only the latest UI operation in the same store can be undone, and any intervening planner edit invalidates it. Monotonic revision plus record/settings snapshots reject stale reviews and ABA changes. An undo itself advances revision; old tokens cannot become valid again.

People and Store hours submissions now call settingsChanged through their existing markChanged path. Assignment edits, imports, generation, resets, team and membership edits already advance revision. Future writers must use these planner APIs or notify settingsChanged; raw external mutation of exposed objects is not a supported transaction API. No new generic transaction framework or live concurrency contract is claimed.

## Input and motion

Tap and keyboard commands are primary. Desktop mouse dragging only chooses a nearby destination and focuses Review change; the same validation and explicit Apply step follows. External drops do not become commands. Touch dragging is disabled and remains deferred pending device tests. Escape cancels without mutation; per-person cancellation returns focus to its invoking control.

The existing paper/forest controls, spacing variables and native form fields are reused. A 160ms opacity/position cue identifies the selected destination/review, and an opacity cue identifies the changed person after apply/undo. Reduced motion skips those animations and preserves the same data, focus and announcements. Normal manager viewing remains separate from editing.

## Verification and limits

Deterministic command tests cover cross-month/year/leap dates, peers, provenance, unknown membership, occupied/protected destinations, vacation/recurring exclusions, unknown hours/closure, invalid dates/DST, stale/replayed/forged tokens, settings and assignment ABA, override-presence restoration and staged map publication.

The browser probe covers desktop keyboard plus actual desktop drag, 390/320px touch buttons at 200% text, Move, Copy, cancel, undo, stale undo after a People edit, same-store undo visibility, normal/reduced motion, viewport overflow and scoped axe. It retains a bounded import Apply diagnostic recording input dispatch, click-handler completion, resulting state and focus. Historical intermittent WebKit Apply timeouts from the import increment remain unresolved; a fresh pass is not a harness-defect classification or full operational verification.

Physical devices, touch dragging, screen readers, browser-menu zoom and hosted browser execution remain unverified. Root text scaling is emulation; scoped axe is not a conformance claim. Exact final SHA, CI, preview identity and matrix results are recorded on the stacked draft PR and in the accompanying evidence.
