# Preview touch feedback checkpoint

The isolated manager and planner preview share one semantic dispatcher. It reads
`lpcf:pref:buzz` once, respects Off and Quiet, and exposes a page-only Touch feedback
selector under About this preview, reachable from account Help. It never writes
preferences. Reduced motion remains separate.

Changed touch selections and committed day/month swipe landings use named `tick`.
Successful explicit Apply and Mark reviewed actions use `taken`. A new incomplete
generation/import review uses `asked`; explicit validation failures use `refused`.
Visible messages and focus remain the primary feedback. Generating a proposal alone
never emits success. Mouse, keyboard, unchanged choices, disabled/inert controls,
scroll/drag cancellation and stale tokens stay quiet.

The dispatcher chooses native postMessage when present, otherwise supported browser
vibration. Native errors do not retry through the browser. No cancellation buzz is
sent. The native named tick is selection feedback, not the Light impact produced by
a numeric buzz. No native source changed. Preview transforms suppress the legacy
buzz entry point while preserving the visual press effect. Production source and
the salesperson feel harness remain unchanged.

The embedded planner has no separate transport owner. The parent attaches only to
the current connected same-origin planner document inside the open dialog. It uses
bounded semantic names through a document-local event, not a window message or
network bridge. Opaque touch tokens survive async work and are canceled on new
input, close, hide and teardown; old or used tokens cannot replay.

## Checks and evidence

- 1,093 tests passed. Production and isolated preview builds passed; existing bundle
  size warnings remain. No production source was edited.
- All eight engine/transport combinations passed: Chromium and WebKit, each with
  native, browser fallback, native error, and absent APIs. Includes changed-only
  selections, preferences, successful day and generation Apply, refused review and
  incomplete-proposal Apply, async generation warning, outer/frame deduplication,
  canceled contacts, stale completion after close and no preference writes.
- WebKit error transport initially timed out before the first Coaching tap, with
  no haptic assertion failure. After inspection, the two unfinished cases passed
  serially at unchanged limits. Both attempts are retained. Load causation is not
  established.
- Both engines passed synthetic committed swipe, canceled swipe, vertical scroll
  gesture and day-navigation counts. WebKit cannot construct Touch; the final
  probe supplies touch lists on synthetic DOM events. This is not physical input.
- Four preference configurations passed: Chromium/WebKit at 390 px and 320 px with
  actual 200% text. Saved Quiet/Off initialization, page-only override, no storage
  mutation, no control overflow and scoped WCAG A/AA axe scans passed. The normal
  preference image is included. The oversized whole-details screenshot at 200%
  captured the wrong scrolled area, so it is not offered as visual evidence.
  Final scoped control captures and repeated axe checks passed in both engines;
  the corrected 200% control image is included.
- Controls regression: 11 of 12 configurations passed, including both 320 px/200%
  cases. WebKit 1440 px timed out dismissing the existing recap at the unchanged
  15-second limit. Its cause remains unresolved, consistent with the retained
  desktop host limitation. Do not call the complete matrix green.
- Initial implementation checks exposed a selection read before React commit and
  a swipe-end handler canceling ordinary taps. Both were corrected before the
  final semantic checks. No assertion or timeout was weakened.

The frozen static artifact has 56 files. Its manifest SHA-256 is
`b42789a824c8ad7f152d5889348e8f23d25d7a32aeb935cd394b7c3ac0a29fb3`.
Deployment identity and CI results are recorded in the draft PR after publishing.

## Retained limits

The prior local Chromium reduced-motion return failed at 3,182/2,100 ms; the prior
CI sample passed at 1,895/2,100 ms. Local Chromium 151 differs from CI revision 153,
whose download was blocked by network policy. No version-causation claim is made.
The original FlyBy timeout, original CI screenshot crash and desktop WebKit host
failures remain historical evidence. A new pass does not erase them.

Browser vibration is unavailable in Safari. Native bridge calls and browser APIs
are mocked here; physical iPhone/Android vibration and WebView behavior are not
certified. Whole-app accessibility, screen readers and native keyboard remain
untested. Hosted interaction has been blocked by the executor CONNECT proxy;
API identity verification does not establish a hosted browser pass.

This remains fictional, in-memory, same-day America/New_York bounded CSV. Real
workbook sample pending. No live People integration, persistence, database,
credentials, permissions, production deployment, alias, merge or writer-claim
change. Unknown duration stays unknown; balance is an audit, not fair generation,
and strength is unavailable without valid data. The desktop side panel, larger
calendar, single-row Delivered areas and responsive editor remain in scope as
preserved behavior. Stop here for independent review.

## Current salesperson regression

The serial Chromium run passed all action, swipe, FlyBy, press and exactly-one-tick
checks, but failed reduced-motion return at **2,665/2,100 ms**. Zero OOM kills;
peak reported use 0.97 GB. The earlier 3,182 ms failure remains separate evidence.
No threshold, production source or feel-harness change was made.

WebKit passed FlyBy, visual press, exactly one tick and reduced-motion return
(**1,625/2,100 ms**), but failed four latency bars: Lunch **95/60 ms**, Here
**83/60 ms**, Floor to Phone **197/140 ms**, Phone to Floor **150/140 ms**.
The blend was unmeasurable with one observed frame, and real swipe input is not
available to this WebKit harness. Zero OOM kills; 1.41 GB peak use. No second
browser check ran alongside it; a unit-test run overlapped part of it. These
results do not establish a regression cause or a physical-device outcome.

The final review extended the changed-value guard to native date/month inputs.
The existing month selector is text, so its keyboard changes remain quiet. The
probe exercises date-input change through a synthetic fixture. One WebKit gesture
measurement included a preceding tap tick that had not settled; the final probe
waits for and asserts that separate tap before beginning swipe measurement.

The final picker and gesture check passed in both engines. Final source tests
again passed all 1,093 cases, and the final isolated build passed. The 56-file
manifest was rechecked against every frozen file before commit.
