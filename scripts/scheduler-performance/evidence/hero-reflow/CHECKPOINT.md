# Enlarged desktop hero reflow

Independent pixel review of f8fbf934 found that the enlarged desktop hero still interleaved the pace sentence and let Engaged Video extend into the calendar. The previous computed-size checks were valid, but page overflow and the chosen text-fit representatives did not detect these internal defects. The rejected image and failing regression check are retained here.

The pace sentence now uses one inline formatting context instead of independent flex fragments around the emphasized number. A font-relative container query stacks the hero's internal summary and charts when their available width becomes insufficient. Chart labels wrap within equal-width tracks. The calendar remains a separate area; normal-size desktop retains its existing two-column summary/chart layout. No font size is reduced to make the content fit.

The targeted probe checks each visible chart label against both its own column and chart group, rejects overlap with the calendar, and checks the rendered word coordinates of the pace sentence in DOM reading order. In the rejected image, the word `for` appeared below the following number `134`; the corrected sentence reads sequentially. Chart bars must retain at least 20px height. Scoped accessibility, page overflow and page-error checks remain enabled. Cases are desktop normal/enlarged and narrow mouse in Chromium and WebKit.

The earlier 36 shared and ten embedded computed-size assertions remain valid; this change does not alter typography sizing. Phone Coaching and scheduler behavior are unchanged. This is CSS enlarged-text reflow, not browser-menu zoom or physical-device verification. Full accessibility conformance is not claimed.

One WebKit normal-size case again timed out closing the initial recap, before reaching the tested hero. The prior frame-availability diagnostic and uncertainty remain recorded in the text-scaling checkpoint. Only the two incomplete configurations were continued after the build process finished, with unchanged assertions and timeouts. This is not evidence that the original cause has been conclusively fixed.

No production source/deployment, persistence, database, credentials, permissions, merge or writer-claim changes. The PR remains draft and the preview remains subject to independent visual review.

All six targeted configurations passed, including scoped hero accessibility scans. All 1,071 tests and both production and isolated builds passed. The corrected enlarged Chromium sentence has every word on the same visual line, while the earlier image placed `134` above the preceding `for`. Exact deployment identity and CI are reported on the draft PR.
