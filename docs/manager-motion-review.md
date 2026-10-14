# Manager motion correction

## Released status, 14 October 2026

This note supersedes the pending-release wording below for X24 / #468.
PR #468 was merged and released on 13 October at
`2a11f4d447babac3fe05d3ec78eeb10398113e38`; production readiness and main CI
were verified at that release. The later #469 release at
`d9320e253b603260f6a7355d4bc1c77a59fefa5b` preserves this quieter motion.
The original proposal, scope and evidence below remain historical context.
See H-X50 in [handoff.md](handoff.md) for the current release record and limits.
This status correction does not assert a physical Android WebView/keyboard pass.

## Historical proposal and verification notes

Jorge requested substantially quieter post-load and dropdown-icon movement on
13 October 2026 at 19:55 UTC, explicitly excluding lightspeed. This request
authorizes the bounded draft correction. Independent review and a phone trial
of the exact preview still precede a production decision.

The source baseline is 5bf65105003b3e01227c774ea82e08d5d595bb68.
The runtime diff is confined to manager-signal.css:

- Manager assembly keeps its existing animation names and completion events,
  but suppresses radial translation, scale and overshoot, shortens duration to
  180ms and removes stagger. It suppresses the accompanying page breath,
  cloud drop and reload flash. The inherited opacity curve stays in place;
  this is not a newly authored 180ms fade curve.
- The queue menu previously entered at scale .86 over 420ms with a spring.
  The drawer previously translated its full width over 280ms. Both now fade
  together in place over 180ms, so their contained icons do not travel.
- Reduced motion has no menu animation. Changing the preference during an
  assembly makes its content visible immediately, preserving cleanup ownership.

Lightspeed engine, field, cover, destination, scan, readiness and recovery code
are unchanged. Manager navigation, associate-card motion, data paths, focus
handlers and keyboard listeners are unchanged. No core-file or Manager.jsx edit.
No conclusions from the desktop performance diagnostic were used here.

The exact dropdown Jorge meant still needs confirmation against the preview.
Source inspection establishes the two menu containers' existing travel, not a
claim that the inaccessible original screenshot depicts either menu.

## Reproduce

Run npm test and npm run build. The manager-motion GitHub workflow builds the
actual application with the repository's fictional local fixture and runs
scripts/manager-motion.mjs in Chromium and WebKit. It samples actual computed
landing and menu styles, checks stationary icons, keyboard opening and Escape,
scroll-lock release, repeated/interrupted menus and reduced motion. The existing
checks workflow independently runs both full feel suites.

Artifacts manager-motion-chromium and manager-motion-webkit contain JSON and
fictional screenshots, including widths 320, 360, 375, 390, 393, 414, 430, 700,
760 and landscape 844 by 390. The spacing screenshots are diagnostic, not proof
of a spacing repair. Safe-area variants and physical-device inspection remain
open. No original customer screenshot or real business data is committed.

Local Chromium cannot start with its sandbox in this saved environment. No
security or permission setting was changed. Browser verification uses existing
CI access and remains pending until the actual jobs finish.
