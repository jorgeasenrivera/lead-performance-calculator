# Lightspeed comparison QA

Date: 23 September 2026. Scope: local proposal, not production approval.

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
