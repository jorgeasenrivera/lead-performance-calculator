# Manager polish: evidence before changes

28 September 2026. X11, Codex. The five-item isolated study is approved for
implementation, not merged. The login-to-dashboard join is now included in
the investigation after Jorge reported flashing in both the study and live site.
The salesperson app and native app are outside scope.

## 28 September: within-tab motion, first bounded pass

Jorge approves the updated Proposed navigation and asks to refine motion inside
the manager tabs. Keep that navigation and the approved login choreography.
Items 1 through 5 remain approved. Two new study decisions, 6 and 7, are pending.

The associate card's original return starts from `transform: none` even if its
entry is unfinished, and the opening/closing effects and timers have no shared
owner. Its counter also computes every changed target from zero. These are code
findings, not a claim that a screenshot measures a hitch.

The in-memory Proposed copy now gives an associate card one motion owner:
320ms entry, content revealed within 240ms, and 200ms return from its actual
painted matrix and child opacity. Close requests are idempotent; completed or
interrupted effects are cancelled, old completions ignored and unmount cleans
up effects, watchdog, preference observer and listeners. No new layout, art or
data action. Reduce page motion and system Reduce Motion settle immediately;
a hidden document settles an opening or finishes a requested close. The first
test run caught an unhandled cancellation rejection in my helper. Every owned
effect now handles cancellation, including the children, not just the lead.

Podium and recap counts keep the initial roll-up, capped at 640ms with up to
160ms delay. Subsequent targets move from the displayed value over up to 320ms,
including decreases to zero. A class observer waits for the lightspeed cover
to clear without an 80ms polling interval. Completed counts remove their RAF,
observer and preference/visibility listeners. No new library or GSAP dependency.
The performance and timeline skills informed transform/opacity-only card
movement, batched pose reads and a single cancellation/completion owner.

Connected desktop, 390px phone and 768px tablet checks reach an open card at
opacity 1 and transform none, and remove it after close. The settled card is
396px on desktop/tablet and 335.2px on phone; document client/scroll widths match
at 375px phone and 753px tablet. Phone reduced entry has no travel, and Escape
closes it. Summary's Calls/90 days controls update populated figures while page
and nested tab-page stay opaque with animation none. This does not establish
frame rate, low-end performance, or a physical-iPhone pass. Interrupted pose,
duplicate close, stale completion, disposal and count retargeting have behavioral
unit coverage, not continuous browser-frame capture.

Local screenshots: `within-tab-card-before.png`, `within-tab-card-desktop.png`,
`within-tab-card-phone.png`, `within-tab-card-tablet.png` in the existing ignored
shots folder. The first phone capture showed the underlying board before the
overlay appeared and was replaced only after the card's settled state was
confirmed. The settled phone capture also shows an existing hover tooltip
clipped at the left edge; tooltip placement is not fixed in this pass.

This is not an all-tabs completion. Drawers, tooltip placement, chart choreography
and remaining controls still need a focused pass. The unattributed observer error
is still in the connected console. The earlier feel failure remains undiagnosed,
not blindly retried or waived. Keep #436 draft, with no production source edits.
Rebased onto `378c689` (#437 doorbell migration): 785 tests and the normal and
isolated builds pass. Build warnings about chunk size and pdf.js eval remain.

## 28 September: flashing after tool and section transitions

Jorge now confirms the full proposed sign-in has no flashing. He reports a flash
after Current/Proposed and after ordinary manager navigation. Those paths are
separate, and this pass remains an isolated study, not a live repair.

The connected Current Summary recording found a cleanup restart: at 831ms,
after `tab-enter` cleared, the new page was on `pageIn` at opacity 0 and its
Summary block was on `cardIn` at opacity 0. The nested block had been on
`tabIn`. That is a confirmed return to the mount fade, not a slow data read.
The first proposed trace exposed my own error too: its WAAPI slide started on
the outgoing board before the actual 210ms tab swap. The new page arrived
without that effect. The old override also missed nested `.tab-page` children.

Proposed now follows the app's real tool/tab phase classes. It does not infer
navigation from button names or start another entrance after two RAFs. One
outer foreground container exits and lands; nested sections stay still.
Mount effects remain disabled after the first navigation, including nested
board/tab children, so cleanup cannot reinstate them. This is not a rule on
every descendant: charts and other functional content retain their own effects.
The full login document has no navigation latch until a tool/tab move occurs.
Login artwork, clocks, cover and destination boundary repair stay unchanged.
The existing background/streak switch still belongs to Sage. This pass does
not claim it removes every visual interruption under a slow destination load.

Desktop Summary and Daily Activity, 390px phone Summary and 768px tablet Summary
recordings keep the destination page at opacity 1 with animation `none` after
cleanup. No second mount fade appears in those samples. Phone and tablet settled
document widths are 375/375 and 753/753 client/scroll pixels. The 15px gutters
are included in those measurements. Reduced page motion keeps the foreground
animation `none` during a tool switch. A subsequent full desktop sign-in reaches
the populated store and clears its flight classes without a navigation latch.
These are bounded DOM diagnostics, not a frame-rate or real-iPhone verdict.

Current/Proposed previously replaced the visible iframe immediately, exposing
its blank first paint and restored-session arrival. The comparison now keeps
the painted frame while one hidden, inert replacement prepares. It swaps only
after that app reports a destination, no arrival phase/cover, no running finite
foreground animation, and two quiet RAF opportunities. Current's actual app
animations remain unchanged. A reversal discards the pending frame; a 30-second
timeout retains the usable frame and says the comparison did not load. This
temporarily costs two demo documents, bounded to one pending replacement. It
is a study-only comparison mechanism, not proposed production navigation.

Regression tests cover readiness message origin/source, stale messages, reversal
and timeout. Local trace JSON and the before/after Targets comparison are under
ignored `shots/manager-proposal-20260928/`. Rebased onto `c47c931` after #435:
779 tests and both builds pass, and a new Summary trace keeps page and block
opaque at cleanup. C97 still owns an application-file branch; no source edits.
The earlier feel failure and unattributed observer console error remain open.
The subsequent full desktop arrival also warned that the cover-opacity and
finishing-scan windows expired. It reached the store, but that is not a clean
timing pass or proof of why those windows expired.
Do not retry the failed feel run blindly, waive its bar or merge this draft.

## Jorge's decisions and the connected arrival

28 September: 1 Approve, 2 Approve, 3 Approve, 4 Approve, 5 Approve.
Jorge also said the two animation examples were too similar, and the dashboard
must continue the initial login arrival rather than look like another entrance.
This is approval of the five published items, not proof that the flash is fixed.

The original Replay landing button exercised only the page-motion study. That
was insufficient evidence of the connected sign-in. The controls now distinguish
Replay page motion from Replay full sign-in. Full replay resets only `lpc-auth`
on the disposable loopback origin, reloads the mock app, and presses the ordinary
fictional sign-in. It does not sign anyone out of Sage's real preview or live site.
The extra page-motion checkbox does not claim to change the arrival's system
Reduce Motion setting.

Record transition is off by default. When enabled, a bounded 12-second DOM
probe records root phases, cover/page/hero opacity, widths and animation events.
It does not drive the arrival. Its geometry/style reads can affect the main
thread, so these recordings are diagnostic evidence, not FPS benchmarks.
The probe stops on a hidden page or disposal and records at most 300 states
and 300 animation events. Local recordings remain in ignored `shots/`.

Two Current full sign-ins were captured. At the desktop frame, the page and
hero's mount entrances finished while hidden, followed by one radial landing.
No second `pageIn` or `cardIn` start was recorded at cleanup. The cover was
recorded rising, holding, then clearing once. This did not reproduce the
reported repeated flashing. A 15px gutter returned at unlock, but the page and
settled hero widths stayed 1374px and 1310px on both sides of that release.
The initial suspicion that the gutter widened the landing was not supported.
Do not remove compensation or call it a fix on that basis.

The cold-load check confirmed an interruption: the Suspense boundary in `wrap`
contains both the lazy manager destination and the sign-in layer. With a local
3.5-second manager download delay, Current's login layer went to `display:none`
at 3184ms and came back at 6217ms, before the covered handoff. The background
also cancelled and restarted its drift. This is a confirmed loading-boundary
interruption, not proof that it explains every flash on Jorge's live device.

Proposed now keeps the same sign-in layer outside the destination's Suspense
boundary, through a fail-closed in-memory core transform. No actual source file
is edited. Under the same delay at desktop and 390px phone widths, neither
recording found a hidden login layer before the legitimate `signin-gone`
handoff. Both reached the populated store and released the flight classes.
The destination background still remounts; no claim of solving that or of a
fully flash-free live site is made. Existing artwork, tunnel, cover, scan and
arrival timing stay unchanged. No second entrance is added to the login landing.

The first delay experiment was wrong: a query on the entry module caused it to
evaluate again when Manager imported its shared exports. That run's final state
is rejected. The corrected experiment retains the canonical entry URL, delays
only the one Manager import and fails if that import anchor is missing or
ambiguous. `/?slow=1` labels the test; the normal study has no download delay.
The corrected Current trace is `arrival-current-canonical-slow-trace.json`, not
`arrival-current-slow-manager-trace.json`.

C92 and C97 still own both application files. This pass changes only the
isolated proposal, tests and documentation. Source integration and any connected
arrival repair wait for the shared file claim to be released or reassigned.

Latest checks: 769 tests, normal build and isolated build pass. Seven study
guards include source-boundary anchoring and the canonical-entry delay guard.
The previous feel failure and console attribution gap remain open. The bounded
trace can end before cleanup on a heavily delayed frame, so final flight release
was checked separately in the DOM. These are browser checks, not phone approval.

## Direction

Keep the dashboard recognisably Sage: dense, readable, dot-matrix, coloured by
meaning, with the existing CRT character. Do not replace it with a sparse
marketing dashboard. The opportunity is to remove friction between the views,
not remove information from them.

Use one motion language for a manager's repeated work: a clear press response,
a brief directional change, and a stable landing. The lightspeed arrival is the
special entrance, not an effect repeated on every tab or data refresh.

## What was inspected

Live, authenticated preview at build `2026.09.28.02c9125`, one populated store,
administrator account. Desktop 1440 x 900, phone 390 x 844, narrow phone
375 x 812, tablet 768 x 1024. Phone sizes are browser viewport tests, not a
physical iPhone or Safari test. Administrator visibility can differ from a
store-manager account, so the role-specific surface still needs verification.

Screenshots were saved locally and inspected. They contain real employee
figures and must not be committed or published to the public repository.
Evidence lives under `shots/manager-audit-20260928/`, which is ignored.
Any published proposal will use fictional people and figures.

No report was uploaded, no person was added or restricted, no plate assigned,
no queue changed, no target changed, no board published, and no printing was
sent to a printer. The page returned to sign-in near the end of the audit. No
Sign out action was taken, and the reason is not established. Temporary viewport
overrides were reset. Do not treat the session ending as a diagnosed app defect.

### Capture register

Health is limited to the observed screen, not a full functional certification.
"Polish" means a design opportunity. "Fix" means confirmed evidence below.
Repeated stale frames after navigation were rejected and overwritten. There
are 33 accepted captures, with the overview captured first and the lower roster
and account menu later.

| Step | Screenshot prefix and observed screen | Health |
|---|---|---|
| 1 | 01 desktop dashboard, hero and first cards | Strong identity; polish reading hierarchy |
| 2 | 02 desktop month round-up | Readable grouping; modal/focus follow-up needed |
| 3 | 03 desktop Summary | Polish metric provenance and secondary labels |
| 4 | 04 desktop History | Clear named columns; lower-row context needs checking |
| 5 | 05 desktop Targets | Fix input names; small controls |
| 6 | 06 desktop People | Clear store context; long alert copy |
| 7 | 07 desktop expanded person fields | Useful detail; secondary labels need polish |
| 8 | 08 desktop Imports | Fix status-context ambiguity before decorative changes |
| 9 | 09 desktop Daily Activity | Strong overview; compact row labels |
| 10 | 10 desktop Coaching list | Clear entry; substantial introductory block |
| 11 | 11 desktop Coaching detail | Good density; long tables and secondary type |
| 12 | 12 desktop License Plates, empty day | Useful empty-state instruction; populated state untested |
| 13 | 13 desktop Daily Standards | Clear groups; repeated plus/minus names lack context |
| 14 | 14 desktop Live Floor, empty room | Strong identity; populated actions untested |
| 15 | 15 desktop Phone Line, empty room | Consistent room colour; populated state untested |
| 16 | 16 desktop Online | Placeholder, not an operational queue |
| 17 | 17 desktop TV launcher | Clear store cards; repeated action names need context |
| 18 | 18 phone dashboard | Strong compact summary; small secondary type and tabs |
| 19 | 19 phone performance detail | Fix horizontal overflow and action area |
| 20 | 20 phone Summary | Preserves density; metric-source context needs polish |
| 21 | 21 phone History | Fix colour-only column key |
| 22 | 22 phone Targets | Fix misleading grace explanation and improve fields |
| 23 | 23 phone People | Clear grouping; redundant one-person bulk actions |
| 24 | 24 phone Daily Activity | Fix cross-screen language; compact labels |
| 25 | 25 phone Coaching list | Good compact comparison; labels and meaning need care |
| 26 | 26 phone Coaching detail | Useful hierarchy; long content and focus follow-up |
| 27 | 27 phone More drawer | Clear named tools; better model for touch targets |
| 28 | 28 phone Live Floor | Fits; dense map labels need physical-phone test |
| 29 | 29 phone Imports | Preserves status; context ambiguity remains |
| 30 | 30 narrow-phone dashboard | Fits; trailing People tab is clipped |
| 31 | 31 tablet dashboard | Fits; tall hero and concealed trailing navigation |
| 32 | 32 desktop lower associate roster | Dense and useful; charts repeat tiny labels |
| 33 | 33 desktop account menu | Straightforward; current preview lacks new account controls |

Full filename is the prefix plus the screen name and `.png`. The earlier
stale captures under prefixes 01, 20 and 21 were overwritten, not counted as
separate evidence. Captured images show some softness across the page. That
alone does not establish a production blur or a font-rendering defect; final
type and contrast decisions need fresh high-fidelity capture and computed styles.

## Findings and recommended batches

### P1. Phone performance sheet overflows horizontally

Confirmed in step 19. At 390 pixels, the named dialog's client width was 335
pixels and its scroll width was 363. A horizontal scrollbar was visible. The
action group protruded to the right. The primary restriction action was not
legible in the captured settled frame, while Coach was visible. Do not assume
it was disabled or unavailable without inspecting its exact styles.

The source uses `fr-acts ac-acts` for these actions at Manager.jsx:17578.
`ac-acts` is also the accounts-table action class: fixed desktop width at
25616, 100% at the 960-pixel breakpoint, and another padding rule at 26039.
This is a plausible selector collision, not yet a proven complete root cause.

Proposal: give this sheet its own scoped action layout, keep both actions
visible, retain the restriction meaning and confirmation behaviour, and fit the
content without hiding overflow. Do not "fix" it with overflow-x:hidden.
Test long names, 320/375/390/430 widths, large text, restricted and unrestricted
states, and keyboard focus. No lead or restriction logic change.

### P1. Targets use ambiguous input names

Confirmed in steps 5 and 22. Desktop accessibility exposes ten percentage
fields named only `%`. Phone exposes `Green at %` and `Yellow at %` but not the
metric. DOM measurements: 26-pixel-high fields, 11.5-pixel text, width 52 on
desktop and 64 on phone. The grace field is named only `days`.

Source at Manager.jsx:20255 uses wrapping labels containing the percent sign,
not a metric-specific name. Values save on blur, so clarity matters before a
manager accidentally edits the wrong row. No field was focused or edited here.

Proposal: names such as `Internet delivered, green threshold, percent`, visible
green/yellow labels in both layouts, a labelled grace field, larger phone
controls and readable numeric text. Keep row density on desktop. A 44-pixel
phone-control target is a product design goal, not a claim that 26 pixels fails
WCAG: the AA target-size criterion generally specifies 24 CSS pixels, subject
to exceptions and spacing.

### P1. Phone grace explanation contradicts the actual rule

Confirmed in step 22 and source. The phone hero says grace is how long a new
hire is judged on effort before results count. Desktop says colours are held
while the month is thin. Existing checks use day-of-month against graceDays,
for example Manager.jsx:17605 and :19592. It is a monthly grace window, not a
new-hire probation period.

Proposal: use the same concise monthly explanation on desktop and phone.
Example for approval: `First 10 days of each month: coach before restricting.`
Keep the separate new-associate/history provisions untouched. Copy needs visual
approval too; this audit does not authorise shipping it.

### P1. Phone History needs a textual column key

Confirmed in step 21 and source Manager.jsx:19554. The table header is five
coloured marks without names. Rows show five coloured percentages and mini
bars. The earlier hero has named metrics, but it scrolls out of view. The
button's accessible name lists percentages without identifying their metrics.

Proposal: retain the five compact columns and their colours; add readable short
names, for example `Int`, `Phone`, `Show`, `Appt`, `Eng`, plus accessible
metric/value names. Test a long roster after the hero leaves the screen. Sticky
labels may help, but must not cover rows or compete with the bottom navigation.

### P2. Import counters answer different questions without explaining it

Confirmed in steps 8 and 29. Navigation says `Import 0/2`, the hero says
`1 of 3 in`, and the checklist shows four report names, including Campaign
Delivery Summary. The delivery row is marked landed today. This is not evidence
that a report is missing or incorrectly stored; counts can refer to different
required sets. A manager should not have to infer those sets.

Proposal: trace each counter's definition, then label its scope consistently.
Keep per-report states and clear month/day context. Do not alter import routing,
daily-date handling, report replacement or save semantics as a polish task.

### P2. Navigation and small labels need a density-aware touch pass

Steps 18, 21, 30 and 31. Phone top tabs measured 25.2 pixels high, with
12-pixel text. People is clipped at 375 width. On tablet the secondary bar
conceals its last item while the hero consumes most of the first viewport.
These are discoverability and comfort findings, not proof navigation is broken.

Proposal: keep the tabs and bottom tool bar, improve touch area and the cue
that more tabs exist, retain the selected tab in view, and give important
secondary labels a readable floor. Do not enlarge every label equally or reduce
the dashboard to fewer metrics. Start with thresholds, chart keys, dates and
action labels. Native device keyboard, text zoom and Safari toolbar behaviour
remain untested.

### P2. Daily Activity wording and visual signals diverge

Step 9 uses `Most penalty points this month`; step 24 uses `Biggest Loser`.
The underlying source still uses that label in other views too. This is a
language decision for Jorge, not a newly inferred calculation error.

The mobile updated timestamp uses a red dot; source at Manager.jsx:26054 gives
it an infinite 1.6-second blink. A recent report and a connection error should
not share an alarming signal. The site already has purposeful VHS noise for
lost connection, which must be retained.

Proposal: align the manager-facing label and distinguish fresh report time from
an actual connection state. Consider a brief update acknowledgement, then a
stationary timestamp. Do not remove the room's meaningful live-state signalling.

### P2. Repeated controls need context, not a new visual style

Steps 6, 13 and 17 expose repeated `Card`, `Change standing`, `+`, `-`,
`Publish` and `Open the board` controls. The visible row gives context to a
sighted user; the accessible name often does not. Some heroes also render
counters as buttons without handlers, visible in the Targets source.

Proposal: name controls for their person/store/metric, preserve their visible
brevity, and use non-interactive semantics for informational counters unless a
real detail view exists. Verify keyboard focus, focus return, Escape, body
scroll locking and close controls consistently across sheet types. Do not
invent a confirmation or change a save workflow without a separate review.

## Motion and performance pass, after the first repairs

Source inspection, not measured FPS, supports the next investigation:

- Hero entry uses a 400 ms spring animation. Several other controls use
  `transition:all`. Audit what actually moves before narrowing those rules.
- Desktop hero content uses `filter:url(#lpc-bulge)`; some responsive rules
  remove it. Keep the CRT appearance, but measure its paint cost with the
  current charts before deciding it is expensive or removing it.
- The phone update indicator has a perpetual animation. Prefer motion tied to
  actual events for report-based data, not perpetual activity for its own sake.
- Keep the existing directional room state sheet authoritative. Do not rebuild
  room transitions as part of a dashboard style pass.

Recommended prototype motion: short press response, directional foreground
movement for adjacent tabs, restrained colour/background handoff, and one
settle without a second bounce. Data updates should keep names and controls
stationary, with a brief local signal. Initial content may rise into place;
returning to a previous tab should not replay a full entrance.

These are proposals, not approved timings or performance promises. Before
implementation, capture current and proposed versions with identical fictional
data, normal and reduced motion. Measure navigation latency, long tasks,
layout shifts, paint/composite behaviour and frame intervals on Chromium and
WebKit, then an older office computer and Jorge's real iPhone. Browser sizes do
not establish device performance. A 60 Hz display cannot show more than 60
distinct frames a second; the target is consistent delivery within its frame
budget, and 120 Hz behaviour where supported, not a universal "above 60 FPS"
claim.

## Evidence-based references

Apple recommends purposeful, brief feedback that follows the interaction and
does not repeatedly delay frequent actions. That supports preserving the big
arrival and making everyday movement smaller and more precise, not adding
another cinematic effect to each control. [Apple: Motion](https://developer.apple.com/design/human-interface-guidelines/motion)

W3C recommends text or another cue alongside colour to convey meaning. That
supports named phone-history columns while retaining their colours.
[W3C: Use of Color](https://www.w3.org/WAI/WCAG22/Understanding/use-of-color.html)

The WCAG AA target-size rule generally uses 24 x 24 CSS pixels, with exceptions.
Larger touch targets here are a deliberate usability choice, not an unsupported
compliance finding. [W3C: Target Size](https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum.html)

Google's animation guidance favours transform and opacity when possible, calls
for checking rendering costs, and warns against indiscriminate will-change.
That supports profiling the existing effects before choosing a library or
rewriting motion. [web.dev: High-performance CSS animations](https://web.dev/articles/animations-guide)

## Not yet tested

This is a broad screen audit, not "every state passed". Still outstanding:
store-manager-only permissions and navigation, all-store view, actual iPhone
Safari, Android, landscape phones, browser text zoom, contrast measurements,
screen-reader operation, complete keyboard paths, printed output, schedule
overlays, populated plate logs, populated rooms, restriction confirmations,
save/import errors, offline recovery and performance traces on slower hardware.
The preview was already authenticated. No new login flight was replayed here.

## Next deliverable

An isolated first-batch proposal on the existing Sage screens, with fictional
data and one Keep / Approve / Adjust decision for each of P1 sheet fit, Targets,
grace copy and History labels. No new component framework or motion package is
needed to correct these findings. Show phone and desktop side by side, and
explicitly prove the same information remains. Then obtain Jorge's decisions,
coordinate the single Manager.jsx writer with Claude, implement a small batch,
run test/build plus motion harnesses if motion changes, and get the real-phone
check and second read before merge.

## Branch verification

752 tests and the production build pass after this docs-only audit. The first
attempt could not spawn test/build workers under the filesystem sandbox;
running those same checks with worker permission passed. Existing PDF eval and
large-chunk warnings remain. No feel run was required for these documentation
changes, and no new motion or device performance result is claimed.

## 28 September: first interactive approval study

Jorge asked for more dashboard character while keeping the established language
and density. The isolated study is at http://localhost:49214/ while its two
local servers are running. It uses the actual Sage components and the existing
fictional Demo Motors seed. No application file is edited, and no production
backend is used. Current and Proposed switch between the same data; switching
modes returns to Dashboard, then use Sage's navigation to compare another view.

Five decisions are collected locally, not sent to a server:

1. Dashboard character and flow: stronger store typography and separators,
   flatter text instead of the desktop displacement filter, quieter shadows,
   no repeating update blink, and a brief directional foreground entrance.
   The phone names the store inside the performance hero. Existing colours,
   dot numbers, chart shapes and metrics remain. This is a proposal to change
   those pixels, not a measured claim that removing the filter solves jank.
2. Associate actions: replace the shared account-action class in the performance
   sheet with a scoped, border-box action group. The original fictional-data
   sheet reproduces clientWidth 335 / scrollWidth 363; the proposal measures
   335 / 335. Geometry alone was not enough: the first screenshot comparison
   caught white text over a white action because the portalled card had no
   `--frgap` value. Explicit scoped colours now make both 48px actions visible,
   verified in the screenshot and computed colours. No overflow is hidden.
3. Targets: ten threshold inputs measured at 44px tall on the phone, with
   metric-specific names. The monthly grace input is named as well.
4. Grace copy: the phone explains the start of each month, not new-hire tenure.
5. History: dark textual metric labels over each role's phone rows. The column
   header measured 354 / 354 with all five labels, replacing the colour-only key.

Motion moves at most six visible top-level groups, never a hundred person rows.
Reads are batched before writes. Transform and opacity carry the 340ms entrance,
with at most 96ms of stagger. New navigation cancels existing study animations;
hidden pages and page disposal cancel them too. System Reduce Motion is never
overridden. The extra study toggle can only further reduce movement. The
approved arrival engine and its timing are unchanged, and its classes are
excluded from the study's page-animation override. No new dependency is added.
This follows the [compositing guidance](https://web.dev/articles/animations-guide)
and keeps the History key aligned with [text beyond colour](https://www.w3.org/WAI/WCAG22/Understanding/use-of-color.html).

Run the disposable manager mock with `SALESPERSON=0`, then:

```
node scripts/manager-polish-proposal.mjs --build
```

The build targets `dist-harness/manager-polish`, an ignored directory. The server
refuses a bundle without the loopback mock URL, listens on loopback, rejects
nonlocal hosts and writes, disables service-worker installation, and limits
connections to itself and the mock. The localhost address is intentional:
previous 127.0.0.1 preview origins served stale cached bundles. Those blank
loads are excluded from this study's evidence.

### Verification and limits

766 tests pass after rebasing onto C92's server half, including four proposal
guards. The normal app and isolated
proposal build pass, with the pre-existing PDF eval and chunk-size warnings.
Browser-size checks cover desktop, 390px phone and 768px tablet. These are not
physical-phone approval or a low-end-device FPS benchmark. The rest of the
33-screen audit is still a backlog, not implemented by this first study.

The required Chromium feel run was attempted once against the original mode
with the disposable associate mock and 400ms data delay. Both full sign-ins
completed (6814ms and 6697ms). Taps, room switches, swipe, blend, double tap,
FlyBy and press checks were under their unchanged bars. The final reduced-motion
return sign-in timed out waiting 40000ms for `.ar-bar`, before recording a time.
Exit 1, not green. The run was not retried and no bar was weakened. The study
installer returns immediately when not framed, and Current does not apply its
CSS or JSX changes; that isolates the proposed manager motion from this failure
but does not establish its cause. There was no captured final page state or
trace, so the cause remains open. WebKit has not been run locally for this study.

Approval, Claude's second read, a clean full motion check and a real iPhone
preview are required before any production visual batch merges.

The connected browser also logs an unattributed MutationObserver target error.
An early page error listener in the study has not captured it, in either the
page DOM or the reported iframe error register. Its source is not established.
Do not label the console clean or infer an application defect from it. This and
the incomplete feel run keep the study's verification status at needs iteration.
