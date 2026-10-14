# Phone spacing and compact tools

This correction is separate from motion PR #468. It starts from main's X25
claim and changes only phone layout in manager-signal.css. The later dock/search revision below supersedes the initial typography and raised-Import scope. No viewport scaling, data, auth, native or backend change is included.

The original screenshot was not accessible in this environment. Parent and
reviewer own comparison with its actual pixels. Independent fictional browser
geometry previously reproduced two role filters followed by a lone third pill
at 360 through 430 CSS pixels. At 320px Chromium used three rows and WebKit two.
That difference is recorded, not treated as cross-engine parity.

The correction uses a two-column filter grid with a full-width final odd item,
44px minimum touch height and wrapping labels. Header and roster rows share
12px side padding and shared subgrid columns. The Units track grows to its
unbroken label's intrinsic width, including when text is enlarged. No
typography is shrunk. Lead bars can shrink and lead count/status details wrap
instead of disappearing inside an overflow-hidden line. Rows can grow above
their unchanged 56px minimum, including when text is enlarged. Bottom content
space and scroll padding account for the
fixed help button's 122px extent plus a 14px gap and the safe-area inset.
This describes the first roster correction. The subsequent dock/search revision below replaces Import's raised treatment.

The manager-spacing workflow renders before/after in Chromium and WebKit using
the actual built app and fictional local data. Before swaps only the mounted
manager stylesheet for its immutable production version at
5bf65105003b3e01227c774ea82e08d5d595bb68. After restores the candidate stylesheet.
Application JSX, handlers and data are identical for the comparison.

The fictional admin fixture exposes two fictional dealerships, the actual dealer
selector and all five section tabs, including Targets. An ordinary manager has
four visible tabs because Import is in the dock; the first expanded fixture
correctly failed its five-tab assertion until this role mismatch was corrected.
No real permission changes are involved. Coverage includes 320/360/375/390/393/414/430,
640/641/700/701/760/761, landscape 844 by 390, 667px short viewports and 34px
safe-area cases at 390 and 700. It captures the scrolled roster bottom and filter
header, logs exact geometry, checks shared column centers, intentional wrapping,
touch height, final-row clearance and units hit testing. Long-name, final-row
Enter/Escape, search clearing and Summary return are also exercised.
Dealer switching and reaching People through the horizontal tab strip exercise
the real controls. A separate 150% text-only stress verifies readable lead
counts/status and row targets; it is not a whole-page scale or physical-device
accessibility claim. It derives every tested font size from that element's
computed baseline, verifies the actual 1.5 ratio, and records both sizes. The
Units label must remain on one line at normal and enlarged sizes. The People
screenshot waits for a populated row to be visible after navigation settles.

Artifacts manager-spacing-chromium and manager-spacing-webkit contain only
fictional screenshots and geometry.json. Browser-height changes and synthetic
safe-area inputs are not physical iOS browser-chrome or keyboard evidence.
Independent visual comparison and a real-phone trial remain release gates.

Reproduce npm test and npm run build, then follow
.github/workflows/manager-spacing.yml with the repository's local mock.
The probe performs no requests to a real data service. Local browser sandbox
limitations are unchanged; no security or permission setting is modified.

The first CI attempt failed before rendering: a git subprocess hit the
container's ownership check. The workflow now checks out the pinned baseline
separately and verifies the stylesheet SHA-256 before reading it. It does not
change Git's ownership checks. Locally SPACING_BEFORE_CSS can name that same
verified stylesheet file.

The first rendered run exposed a 4px horizontal overflow at 641 through 700px:
the phone card's negative margin continued beyond the outer page's 640px gutter
breakpoint. The correction carries those gutters through 700px. WebKit also
reported overlap while its smooth scroll was still approaching the bottom.
The probe now waits for and logs the actual scroll endpoint before applying
the unchanged clearance threshold; it does not infer a completed scroll from
two animation frames. A failed endpoint or clearance assertion still fails CI.
Filter screenshots are explicitly positioned below the sticky header and log
that position, avoiding partially hidden captures from scrollIntoView alone.

Independent visual review caught a gap in the initially green geometry checks:
the normal 12.5px Units header wrapped inside the old fixed 40px track. The
shared intrinsic track and explicit line-count assertions correct that issue.
The old stress used a hardcoded 12.75px header size, effectively leaving it
unenlarged; those samples are not full 150% evidence. Fresh measured-size
samples replace them. A selected People tab without populated visible content
is likewise insufficient screenshot evidence and now fails the capture gate.

Phone-preview feedback after 0f75c912 requires fixed pill navigation. The
section strip previously used horizontal overflow and fixed-width chips,
leaving People offscreen. It now uses deliberate rows: two columns below
360px, with a full final odd item; five destinations use three plus two at
360 through 760px. Labels wrap and touch targets remain at least 44px.
The selected button owns its green fill; the decorative measured pill is
hidden on phones because its old offsets did not track resize or font reflow.
Section handlers and Lightspeed remain unchanged. People's filter pills
also wrap inside their container instead of scrolling sideways.

The probe records each header and ancestor's scroll extent and both attempted
scroll directions, label rectangles, selected fill and touch dimensions.
It tests each section with keyboard Enter, responsive widths, 150% actual
computed text sizes and a horizontal wheel attempt. Before/after fictional
header screenshots and each selected tab are included. The previous approval
does not clear this new header change; affected review and phone trial remain.

The parent authorized bounded fixes for the measured shared-view overflow.
At320px admin Overview's340px grid minimum made the document368px wide;
combined overseer rows reached431px because names/counts/verdicts could not
wrap. Baseline CSS reproduces both. Phone-only CSS now caps the grid minimum
to its container and wraps these content rows without reducing text, hiding
content or changing handlers. Desktop rules are untouched. Before/after
320/390px content screenshots, bounds checks and actual150% content text
checks supplement the existing header tests.

Jorge's latest direction supersedes multiple rows of tabs: the top header
now uses exactly one fixed row of buttons. Horizontal padding and gaps are
reduced; full original labels and accessible names remain. At150% text the
labels may wrap vertically inside each button, while the buttons stay in
one aligned row and keep44px minimum height. Seven admin tabs use the edge
space and24px minimum width; five-tab and smaller contexts retain44px minimum
width. This narrower seven-tab target is an explicit tradeoff to review.
No global text reduction, hidden destination or sideways scrolling is used.
Card and roster corrections remain unchanged. The probe compares2024e009's
multiple-row header with the candidate at320/390px and measured100/150%
text, in addition to the shared-context and keyboard checks.


## Compact dock and search, 13 October phone feedback

Jorge requested a redesign of the lower selection and search because they take
up too much screen space. Parent's initial screenshot review suggested the persistent Tools dock. That
interpretation was provisional: Jorge confirmed the fixed Performance/Activity
navigation only in his subsequent clarification, after c4d5c03 was prepared.
The single-row top tabs and roster choices remain intact.

The phone stylesheet places Import inside the dock and retains its SVG progress
ring, ready state, action and Daily report variant. Help has a dedicated 44px
space at the right of the dock. Every dock destination remains visible, with
wrapping labels and a 44px minimum target. The Rooms menu anchors 8px above the
dock instead of leaving room for the former raised Import button. Search stays
visible, with a 44px field and clear target, 16px input text, and tighter wrapper
padding. No application handlers or data paths are changed.

The spacing probe pins the immediately preceding single-row candidate
4d050292aea1904d1b6dc35a07116dc9137e9f4f for this comparison. It captures
320x667, 390x667 and 667x320 at scrollY 0, safe-area insets 0 and 34, and actual
100%/150% text. It measures the topmost dock, Import/ring and help geometry,
search band height, and remaining content space. It verifies target overlap,
complete labels, keyboard search clearing, Rooms/Escape, More, help, partial
and completed import state, Daily report, and single/multiple-room layouts.
The existing full roster/header/navigation checks still run afterward.

The first run stopped because a runtime git command encountered the CI
container's repository ownership guard. The probe now reads a separate pinned
checkout and validates its stylesheet hash. No ownership, permission or browser
security setting was changed. Runtime-identical preview bf9f08b remains the
visual review surface when a later probe-only head skips deployment.

Independent screenshot review, Jorge's actual-phone production-build preview
trial, and the informed release decision remain mandatory. Browser emulation is
not physical-device evidence. Production remains held.


## Confirmed rail direction, subsequent 13 October clarification

Jorge confirmed Performance, Activity and the other fixed destinations, and
asked for a treatment distinctive to Sage. No example image of the other
selector was supplied, inspected or copied. This revision uses the existing
Signal cream, forest green and pixel glyphs: a flat edge-to-edge rail, crisp
corners, fixed selected marker, inset Import with its live progress ring, and
secondary help. The menu uses the same palette. No animation is introduced.

This pass is rail-only. Search remains exactly as c4d5c03; its 48px idle band
has not met the requested space saving. The proposed search/header patch remains
unapplied because C97 and other open core-file work conflict with the repository's
two-large-file writer rule. Parent is obtaining a bounded exception from Jorge.
No claims are renewed, transferred or modified. The proposed Escape action
preserves the query and returns focus to a trigger displaying the active query;
clearing is explicit and returns focus to the input.

The browser comparison now includes three pinned stylesheets: original dock
4d050292, compact trial c4d5c03, and this Signal rail. The same safe-area, label,
target, variant and full prior spacing/navigation checks remain. This is a
protected review candidate, not production or physical-phone approval.


## Composition revision after the flat-rail phone trial

Jorge accepted the flatness but found the rail basic and appended. The actual
320px and 390px fictional Chromium screenshots were inspected directly through
selected screenshot bytes in the existing CI log, because artifact ZIP fetching
is blocked by the workspace proxy. They showed a broken Performance label,
misaligned Import icon/label, and three competing box treatments.

The revision uses a shared 20px icon row and two-line label space, explicit 11px UI
labels, space allocated for Performance, and a consistent 19px glyph box.
Performance/Activity form the destination group; two hairline dividers bound
Import's compact progress/action area; Rooms/More/Help share utility geometry.
Import has no competing dark tile, Help has a matching label and no outline box,
and selection uses one fixed forest marker with stronger text. A restrained
inset edge finishes the cream surface without adding layout height or animation.
A shared two-line label allowance keeps Daily report and single-room labels
from changing the normal rail height; the type and allowance grow together
under enlarged text. The probe compares the exact prior flat rail 99644a52 as well as older baselines,
and asserts normal-size icon-center and label alignment in actual browser geometry.
Search and its unapplied integration proposal remain held.
