# Measured shared text scaling

Independent review of d12d333 found that the previous shared probe changed only the root font size. Fixed-pixel typography remained unchanged. Reproduction at 320px measured 12px selectors, 13px section headings and 14px person names both before and after the old 200% setting. The prior claim of 200% text coverage was incorrect and was withdrawn on the draft PR. Earlier evidence remains available.

The isolated build now converts font sizes and fixed line heights in the pinned Manager/core stylesheet copies and manager stylesheet copy from px to rem, preserving the normal 16px-root sizes. Production source remains unchanged. Non-text geometry is not globally scaled. Enlarged Coaching cards and controls use intrinsic columns and wrapping; the selected person's name no longer truncates. Bottom navigation wraps to two columns when its text needs the space, and a ResizeObserver reserves its actual height so it does not obscure the final content.

The probe measures controls, body text and headings separately on Performance, Coaching list and opened detail. Each enlarged-text representative must compute to 1.99 through 2.01 times its normal font size. It also checks representative text bounds for clipping and checks page overflow on each surface. The embedded scheduler probe independently measures its outer heading/control and planner heading/body/control growth. These are CSS text-scaling checks, not browser-menu zoom, OS accessibility scaling or physical-device verification.

The first genuinely enlarged screenshots exposed clipped hero metadata, cramped tiles and truncated person names. They are retained as rejected evidence. The initial probe also selected a month-label element that the preview intentionally replaces with its calendar entry; the representative selectors were corrected to existing heading/body/control text, without relaxing the growth or fit assertions.

A transient execution transport disconnect occurred during validation. Fresh shell commands and completed new browser runs established recovery. No test was restarted based only on a stale in-progress status. Results are collected from disjoint configurations against the same frozen build.

All prior preview boundaries remain: no merge, production source/deployment, database, credentials, permissions or writer-claim changes. The draft remains in memory with fictional People and bounded same-day America/New_York CSV import. Team balance is an audit, not fair generation; strength stays unavailable. The real workbook sample remains pending.

## Results and retained limitations

All 1,071 local tests passed, including the typography conversion guard. Production and isolated builds passed. All twelve shared Chromium/WebKit configurations passed, with 36 surface accessibility scans reporting no violations. Four enlarged-text configurations independently measured 2x growth across Performance, Coaching list and detail. Examples: phone selectors 12→24px, section headings 13→26px, names 14→28px, detail heading 20→40px, body 12→24px and action text 11→22px; desktop selectors 13→26px and headings 25→50px.

Two initial WebKit runs timed out closing the recap before reaching their target screens. A read-only diagnostic at 390px and 1440px observed zero animation-frame callbacks in the initial 1.5-second window, finished recap animations, no page errors, and successful ordinary close actions afterward. This does not prove the original cause. Only incomplete configurations were run again, sequentially, with the original assertions and timeouts. Final success does not erase those failures.

The unchanged production runtime's earlier local feel failures remain in the shared-system checkpoint. This typography-only increment does not claim to fix them. Exact-head CI is reported separately on the draft PR. No physical-device, screen-reader, browser-menu zoom or complete accessibility conformance claim is made.

All six embedded scheduler configurations passed, including ten additional computed-size comparisons for the outer modal and planner at enlarged text. No nested dialogs, focus restoration and the original desktop geometry tolerance remain asserted. The standalone day-motion implementation is unchanged from its six passing configurations recorded in the shared-system checkpoint.
