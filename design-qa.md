# Lightspeed comparison QA

Date: 23 September 2026. Scope: local proposal, not production approval.

## Creative follow-up, C

Source: the current B render at http://127.0.0.1:49210/. Implementation: C at
the same URL. The revised page exposes A, B and C, plus a separate scan
decision. Captured B and C at 778 x 698 CSS px and matching 778 x 698 image
pixels, same demo store, theme and settled dashboard. Both images were emitted
together for comparison in this task. The hero type, dotted units, header,
store selector and navigation are readable without enlargement. Their
fonts, geometry, colors, real assets and application copy remain the same.

P2 found in the first C landing: scaling .lpc also shrank the full-screen
backdrop and exposed pale borders. Removed that parent animation. C now uses
one shared foreground clock, and the full-size ground stays behind it. The
revised full login and landing-only replay were captured again; the finished
dashboard matches B, the content width remains 763.200 px through release,
and no sampled landing frame unlocks scrolling. Existing A/B are preserved.

Browser logs include local mock floor-row poll timeouts at 23:46:59 and
23:52:35 UTC. They did not prevent login, landing, or the populated dashboard.
Their cause is not established here. They are a local data-harness limitation,
not evidence about live store reliability, and the current run is not claimed
to have a clean console. No application backend or polling code was changed.

C adds one translucent scan layer, only during arrival, with no loops or blur.
Reduced-motion CSS disables it and removes C's spatial travel. Physical phone
and reduced-motion browser verification remain prerequisites for production,
not a claim made by this desktop-only proposal.

## Source and implementation

- Source visual truth: actual Sage manager render from the login-handoff
  branch, using fictional Sage Demo Motors data. Version A at
  http://127.0.0.1:49210/ preserves the existing radial keyframes and final
  layout. The live preview was also inspected, but its Holler Honda data and
  778 px viewport are not treated as pixel-identical demo references.
- Implementation: version B at the same URL. Its only app visual differences
  are the proposed transition overrides, plus the repair shared with A.
- Screenshots: captured in the connected browser in this task, including A
  and B together in one comparison output. No screenshot files were persisted;
  these are browser-rendered evidence, not inferred images from source code.
- Full-view comparison: 1280 x 720 capture pixels, 1280 x 720 CSS viewport,
  equal screenshot density. Both settled on the same dashboard, same data,
  same theme and same proposal controls height. No density resizing used.
- Additional views: 778 x 685 manager preview and 390 x 844 narrow view.
- Focused comparison: hero type, dotted units, channel bars, rings and header
  labels were readable in the full-size combined output. Separate enlargement
  was not needed. Captured intermediate B frames checked the reduced rebound.

## Findings and iteration history

1. P1, initial demo round-up obscured the comparison after arrival. Fixed by
   marking only the fictional store's round-up read before app boot. Subsequent
   A/B captures show the dashboard, not a modal. The page discloses this setup.
2. P1, Landing only could not find the brand button because it has an accessible
   image name rather than aria-label. Fixed by selecting the actual brand
   button. The later B replay ran and reached Ready to replay after 1690 ms.
3. Measurement correction, not a visual defect: root clientWidth included the
   unused gutter during hidden overflow. Actual body width remained constant
   through A/B playback and release. Evidence now records that layout width.

## Fidelity surfaces

- Fonts and typography: actual application fonts and dotted glyphs preserved.
  No substitute logo, type hierarchy or card copy. Proposal controls use their
  own plain system UI font outside the app.
- Spacing and layout rhythm: the same header, hero, rails, navigation and card
  proportions after landing. Reserving the gutter prevents content-width change.
  The wrapper reduces viewport height; this is a disclosed comparison frame,
  not an imitation of a full-screen browser.
- Colors and tokens: unchanged Sage fields, green tube, white cover and semantic
  colors. Background drift and time labels can differ between captures because
  the real app remains live; those are expected, not redesign drift.
- Image quality and asset fidelity: actual app assets and rendering, including
  the Sage mark. No replacement illustration, rasterized dashboard or custom
  approximation of a supplied asset.
- Copy and content: fictional demo store and associates throughout. Live store
  data was not copied into the harness. A/B explanations and separate decisions
  are outside the app and explicitly say nothing has been applied.

## Interaction and accessibility checks

Full sign-in A/B, repeated login, landing-only replay, compact controls and
narrow layout checked in browser. No console warnings or errors returned.
One version runs at a time, controls have accessible names and keyboard focus
styles, and motion preference is not overridden. Scrolling unlocks on completion;
a bounded timeout and pagehide cleanup exist. The live Reduce Motion setting
was off, so that path still needs a device-level browser run before shipping.

## Remaining limits

No iPhone Safari, native app or FPS certification. No production merge. The
existing local feel runner has no browser executable. The phone-width check is
a desktop responsive check, not a phone approval. Approval choices remain local
to the page and must be communicated in chat.

## Implementation checklist

- Jorge chooses the shared repair and A or B motion separately.
- Implement only approved changes in application-owned lifecycle code.
- Run regression, build and both browser-engine checks, request Claude review,
  and obtain the phone preview approval before merging.

final result: passed
# Full arrival proposal, 23 September local time

Source visual truth: existing C preview at http://127.0.0.1:49210/.
Implementation: http://127.0.0.1:49211/. Both opened and captured in the connected
browser, not inferred from source code. Screenshots are inline in this task;
no disk screenshot path was produced by the browser tool.

Viewport: 1280 x 720 CSS px. Source and implementation captures were emitted
together, each 1280 x 580 image pixels, using a matching 1280 x 580 CSS crop
starting at its actual iframe top. Same browser, density and fictional seed.
The two proposal toolbars differ by 2 CSS px and were excluded from the crops.
The screenshot tool scales page content within clipped output on this host;
therefore this is a visual fidelity comparison, not a pixel-difference score.

State: settled manager dashboard. The existing backdrop moves and the lower
coaching card rotates, so different backdrop positions and coaching-card text
between captures are expected. The hero data, logo, controls, hierarchy, spacing
and final dashboard structure are preserved. No source image was replaced.

Required fidelity surfaces:

- Fonts and typography: existing application fonts and weights preserved.
  Header, store title, dot numerals and compact labels remain legible.
- Spacing and layout: same app layout, hero proportions and navigation. No
  foreground geometry override survives the landing. Width stable during runs.
- Colors and tokens: existing greens, channel colors, dot treatments and ground.
  Animated backdrop phase differs between captures, an expected temporal change.
- Image quality: actual Sage mark and glyph assets retained, not approximated.
- Copy/content: actual fictional dashboard data retained. New waiting copy and
  explicit simulated-retry copy are proposal items, not changes to the live app.

Full-view comparison evidence: paired source and implementation crops in this
task. Focused pass: title, units, channels and video rings were readable in the
paired crops; no extra enlarged crop was needed for these unchanged elements.

Comparison and verification history:

1. Slow simulation triggered a delayed data-protection warning by delaying each
   sequential read. Fixed to one initial four-second connection window.
2. Post-fix Slow browser evidence: prepared 4983 ms, landing 5352 ms, finish
   6902 ms. No new data-protection warning or console error in that check.
3. Interrupted recovery captured: no prepared or landing timestamp, honest
   error screen, retry and cancel available. Retry successfully landed.
4. Reduced-motion preview landed with scan display none. Cancel unloaded iframe.

Findings: no actionable P0/P1/P2 visual mismatch in the checked desktop states.
P3: the recovery heading's programmatic focus outline is visually strong; refine
the focus treatment with the recovery design before production implementation.

Residual gaps: not a physical iPhone or low-end-device approval, not a 60/120 fps
measurement, and not the unavailable local Chromium/WebKit feel harness.
Auth failures, all asset failures and offline-cache recovery are outside this
prototype's tested scenarios. The waiting engine stops drawing but its scheduler
still ticks; production implementation must fully bound resource cleanup.

final result: passed

---
