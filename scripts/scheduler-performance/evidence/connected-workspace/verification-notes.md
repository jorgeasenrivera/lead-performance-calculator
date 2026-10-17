# Connected workspace verification notes

The final matrix uses the corrected build. Earlier candidates exposed a date-width problem at enlarged text on a laptop viewport and a save-message flex overflow at 390px/200%. Both were corrected without changing scheduling logic. Final screenshot review also led to stacked coverage metrics at enlarged text, so labels remain whole instead of breaking into fragments. The reported matrix was rerun against that final build. Historical probe assumptions about hiding the month, closing day details and discarding settings were updated to the approved connected workflow.

The first demand browser assertion incorrectly expected an October 14 upper range of 14; the actual eight-sample fixture range is 0 to 12. The assertion was corrected, and the capacity example explicitly enters 4 to exercise a history-linked target of 3 while leaving the hard minimum at 2. October 15 has its own 0 to 14 range; no range was changed to satisfy the test.

One WebKit run timed out waiting for the unchanged recap close control to stabilize. A focused inspection found no active animation on it or its ancestors and closed it successfully. The monthly harness now awaits font readiness before interacting; the complete subsequent run is reported separately. The failed startup is not counted as a pass and no broader WebKit stability guarantee is claimed.

Full-page test screenshots can place sticky panes at the current scroll offset. The selected review screenshots were captured after scrolling to the top, using capture-connected.mjs. Viewport screenshots distinguish content requiring scrolling from clipped content. Browser viewport and text emulation are not physical device, assistive technology or real browser-menu zoom execution.

Protected deployment state and artifact hashes are separate from authenticated hosted rendering. This environment previously rejected preview-host CONNECT requests; no protection bypass or access change is permitted. The PR records the fresh deployment and hosted-access result.
