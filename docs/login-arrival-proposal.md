# The arrival, every sign-in

X5. Approved by Jorge on 23 September 2026: "can you have that enabled to play every time?"

## Decision

Play the existing full arrival on every explicit sign-in, including another
sign-in on the same day. Keep the logo, tunnel, cover, landing, timing and
loading overlap. Do not change the animation to diagnose the manager flash.

- Reduce Motion keeps its short path.
- Refresh or reopen with a saved session stays unchanged, with no login tunnel.
- Failed sign-in still cancels the arrival and returns the form with its error.
- An old daily mark must not suppress the animation.

Repeat sign-ins now take the same several-second visual journey as the first
one. The daily shortcut is deliberately removed, not made slower by accident.

## Verification and release

Run two full sign-ins in the browser check, including with an old daily mark.
Keep the existing return-speed bar for Reduce Motion rather than timing the
deliberately longer animation against a shortcut budget. Leave all unrelated
motion bars alone. Run tests, build and Chromium/WebKit checks. Update the #414
preview for Jorge to record the manager flash. No production merge until review
and phone approval; this frequency change does not claim the flash is fixed.
