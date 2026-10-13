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
12px side padding and identical columns, with 40px reserved for Units. No
typography is shrunk. Bottom content space and scroll padding account for the
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
