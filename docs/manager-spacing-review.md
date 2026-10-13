# Phone roster spacing

This correction is separate from motion PR #468. It starts from main's X25
claim and changes only phone layout in manager-signal.css. No motion, font-size,
viewport, zoom, data, auth, native or backend change is included.

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
Import's raised treatment and all controls remain unchanged.

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
