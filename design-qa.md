# Lightspeed comparison QA

## 24 September follow-up: visible logo departure

The fixed near-depth cutoff recycled small central logo dots before their rays
left the view. The store-name backing also obscured that part of the flight.
The repair keeps each logo ray until its tail has left, clips its head to finite
offscreen geometry, and only reveals the store name after the logo has passed.
No extra canvas, particle pool, blur layer or production source change.

Captured the actual S opening into radial rays without the store title covering
it. Browser metrics confirm all 73 logo dots departed. Fast landed at 5383 ms
and finished at 6868 ms, with stable 762.4 px body width and no unlocked landing
frames. The title now appears later, deliberately, instead of hiding the logo.
689 tests and both builds pass. Feel remains blocked on its mock preflight.
This is a local draft for Jorge's review, not physical-device or FPS approval.

## 24 September follow-up: scrollbar rail

The earlier scroll-lock assertion was insufficient. The visible pale strip was
reserved by scrollbar-gutter:stable even while overflow was hidden. Removed that
gutter only in the locked study, keeping body content width separately and using
a full-viewport flight canvas. The original saved draft remains untouched.

Before screenshot: interrupted recovery had a pale right rail. After screenshots:
the flight and recovery paint to the edge. Fast and Reduced Motion retain the
same 762.4000244140625 px body width on both sides of unlock. Native scrolling
returns after completion; a scrolled dashboard screenshot confirms it works.
The first iteration's 0.4 px rounding error was found and corrected before this
handoff. Two iframe style probes timed out, so no results from those are claimed.

688 tests and both builds pass. Feel is blocked at its salesperson-mock preflight,
not passed. Existing physical-device and performance gaps remain. This is a local
draft repair requested by Jorge, not a production visual approval.

## 24 September follow-up: downward form exit

Scoped to Jorge's request: replace outward login enlargement with a straight
downward slide and slight bottom-anchored compression. No horizontal translation
or layout animation. The actual transform expression is regression-tested;
the saved draft retains its previous motion. Browser Fast completed the full
flight, name reveal and dashboard landing at the current desktop viewport.
Captured flight and settled dashboard; no isolated intermediate form screenshot
was captured. Body width held at 762.4 px and landing remained scroll-locked.
687 tests and both builds pass. Still draft-only, with the existing device and
frame-rate verification gaps, and awaiting Jorge's judgment in motion.

## 24 September follow-up: destination name

Added the requested store-name beat to the study only. Actual config supplies
the name. Captured its reveal at the existing desktop viewport and 390 x 844:
Space Grotesk, warm light text, central vanishing point, restrained scale-in,
and a static green readability backing. The name is readable at both sizes.
No slogan, pill or new navigation control. The fixed overlay leaves dashboard
geometry untouched; the saved draft does not receive it.

Narrow Fast held the name from 2267 ms until the burst at 3667 ms, then landed
at 4385 ms. Slow held while data prepared and completed successfully. Interrupted
hid the title and never revealed a dashboard. Reduced Motion completed in
1249 ms without a destination event; its later computed-style probe timed out.
686 tests and both builds passed. Width stayed stable with zero unlocked landing
frames. Desktop still had long frame intervals, so this is approved for draft
review only, not a sustained-FPS claim or physical-phone verification.

## 24 September follow-up: remove recycled cohorts

The preceding radial fix was incomplete: reset depths were still narrowly
grouped. Jorge saw the waves that the geometric check did not measure. The
study now randomizes each expired point's next lifetime and fixed radial ray,
fading it in without sideways travel. An aligned offscreen grid continues past
the crop and supplies dots during the inward pull. The original opening and
saved draft are retained. New deterministic checks cover recycle distribution
and an offscreen point entering the visible field.

Captured the opening and later Interrupted frame at the existing 1075 x 910
viewport. The later frame is scattered across the view rather than bounded by
the earlier rectangular cohort. Recovery copy, controls, green palette and
centred perspective remain. Slow reached the prepared dashboard with stable
width. 684 tests and both builds pass. Drawing averaged 1.78 ms with three
intervals over 25 ms; no sustained frame-rate or real-phone claim is made.
This is still a proposal for Jorge to judge in motion, not a production approval.

## 24 September follow-up: radial correction

User-directed refinement of the existing study, not a new design. Browser
evidence confirmed a 7.5 px rightward offset from including the scrollbar
gutter. The revised canvas and visible page both measure 1060 px, with centre
530 px and no CSS translation. A mid-flight capture shows the original green
palette and Sage mark with streaks radiating around that centre. The settled
dashboard and interrupted recovery were captured again at the same default
1075 x 910 viewport. Layout, fonts, controls and recovery wording are unchanged.

The repeating index-based star speeds were replaced by common forward travel
through varied depths. Geometry tests verify radial alignment and mirrored
balance; this establishes the motion model, not subjective approval of every
frame. The saved draft remains separate. 682 tests and both builds pass.
The first revised Fast sample recorded no intervals above 25 ms, but physical
device and feel verification remain open. Ready for Jorge's draft review only.

## 24 September: isolated lightspeed study

Local proposal QA passes for review, not production approval. The saved draft is
http://127.0.0.1:49211/ and the study is http://127.0.0.1:49211/study. Product
Design's screenshot comparison was used to keep the destination faithful while
allowing a deliberately different approach. No production source was edited.

Source and study settled dashboards were captured together at 778 x 696 CSS px
and matching screenshot pixels, same mock store, theme and wrapper height.
Header, hero metrics, dotted glyphs, rails, navigation, fonts and geometry match.
Live background phase and time labels can differ. Both use actual application
assets, not substitute artwork or rasterized dashboard imitations. Full-size
captures were readable without an additional crop. No screenshot files were
persisted; evidence was displayed directly in the task.

Motion differences are intentional: outward login departure, perspective-driven
streaks from the existing dots, and a stronger shared radial dashboard approach.
The extra recovery label was removed as requested. No new UI pattern is applied
to the settled dashboard. The original draft's motion is preserved separately.

P2 found: narrow recovery buttons touched when they wrapped. Added 5 px vertical
margins in the study only. Restarted the server and recaptured Interrupted at
390 x 844; controls are now visibly separated, legible and unobscured over the
retained flight. Failed data never revealed a dashboard. Retry, Slow, Fast,
Reduced Motion and Cancel were exercised; the viewport override was reset.
Reduced Motion had no scan or spatial flight. Body width stayed stable and the
sampled landing frames remained scroll-locked.

Full tests and both builds passed. The dedicated feel harness did not run past
its salesperson-fixture preflight, so its performance bars are not claimed.
Desktop drawing samples still include intervals above 25 ms. Browser screenshots
and draw-submission timings cannot establish sustained frame rate. Physical
iPhone, WebKit, office-PC measurements, production readiness/cleanup integration,
and Jorge's visual approval are required before shipping. Full scenario numbers
and research references are in docs/arrival-prototype.md.

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
# Revision 2: smoother opening and connected recovery

User decisions read from the open page: launch Adjust, recovery Adjust, scan
Approve. Recovery direction clarified in chat: too plain and disconnected.
Source target remains the actual Sage login, logo, field and manager dashboard.
Motion and waiting states are intentionally revised; settled layout is unchanged.

Captured in the connected browser at 778 x 696 CSS px. Current flight,
cover, dashboard and interrupted states are inline in this task. The recovery
capture was repeated after cleanup was corrected. No disk paths were generated.

Findings and fixes:

- [P2, fixed] Original mark was hidden before the canvas's first drawing during
  its hurry lead. Keep the original until the engine posts its first paint.
  Added a test proving no paint notification during the lead and only one after.
- [P2, fixed] Longer burst trails became centre-crossing spokes. Trail length
  now preserves the inner quarter of each particle's radius.
- [P2, fixed] Failed-login cleanup removed the stopped canvas, exposing the app
  error page beneath translucent recovery. Retain that single frame during
  recovery. Post-fix screenshot shows streaks, no error-page bleed, and readable
  heading and controls. Retry/Cancel own its lifetime through the iframe.
- [P3, fixed] Strong recovery heading outline removed from this noninteractive
  programmatic focus target. Interactive buttons retain focus-visible outlines.

Typography and copy: actual dashboard unchanged; recovery headline and supporting
copy legible. Layout and spacing: unchanged settled app, centred recovery controls.
Colors: deliberate in-flight move to Sage's deep green with brighter original dots;
not an app-wide palette change. Assets: original mark geometry and dot field, no
replacement logo or raster artwork. No new particles, canvas or animation library.
CRT scan preserved as approved. Test and build results: 678 green, both builds pass.

Final settled comparison: the previously open first-revision preview and the new
revision were resized to the same 778 x 696 CSS viewport, both with compact
toolbars and equal 643.2 px iframe height. Full screenshots, 778 x 696 pixels,
were emitted together in one comparison input. Logo, title, dot numerals, hero,
navigation and channel typography align. No focused enlargement was needed:
those surfaces are readable at this size. The data-age label differs because
the source preview was opened earlier. Animated ground position differs as
expected. The viewport override was reset afterward.

Final Interrupted: 4707 ms to recovery, no ready data or landing timestamp, one
retained stopped canvas. Retry landed on the actual dashboard at 4069 ms and
completed at 5626 ms, with constant 763.2 px body width and zero unlocked landing
frames. Timing is a single observation, not a speed comparison.

Device and performance gaps from the original report remain. These captures are
not a physical iPhone or sustained frame-rate verification.

final result: passed

---

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
