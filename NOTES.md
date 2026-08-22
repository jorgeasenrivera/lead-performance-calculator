# Notes — asked for, not built yet

Things Jorge has asked for that are not in the app, and the decisions behind them.
Separate from the HANDOFF files on purpose: those describe a session, this outlives one.

---

## Sage — the identity, and the arrival (a Claude Design handoff)

Jorge brought a full design package: the Lead Performance Calculator becomes **Sage**, with
a new mark, a rebuilt sign-in screen, a 2.7-second arrival into the dashboard, and five
smaller transitions. The handoff is exact — every colour, timing and easing measured — and it
ships one file meant to be used as-is, `SageMark.jsx`.

### Part 1 — the identity — BUILT 2026-08-22

The mark is one drawing on a 9x9 grid, which is **the same grid `PixIcon` already uses**, so
the identity and the app's own iconography come off one ruler rather than merely sitting next
to each other. The assets are all generated from that single pattern, so any size can be
regenerated rather than redrawn.

- `public/` carries the SVGs and PNGs; `index.html` declares the favicon, the 32px raster and
  the Apple touch icon; the title is Sage.
- The old `useFavicon` painted an icon in at runtime from an inline copy of the old logo. It
  would now overwrite the real favicon with a second-best version of it a moment after load,
  so it is gone; only the title-setting is kept.
- `Logo` is kept as the name every call site uses and now renders the mark. Its two states
  survive: `animated` is the float, and `loading` is the identity's **seven dots lighting one
  at a time** rather than the old spinner — which is Part 4's loading pattern, brought
  forward because it is what the old spinner was standing in for.
- The old mark's arc, needle and spinner CSS is deleted rather than left orphaned, including
  its reduced-motion overrides.

**One deviation from "ships as-is":** `SageMark.jsx` is JSX with no React import, which works
under the automatic JSX runtime this app's Vite build uses and throws under a classic
transform — including the harness every screen here is checked in. Imported rather than
assumed; costs nothing either way.

**One thing deliberately not renamed:** the *Lead Performance Summary* report, and its CSV
filename `Lead-Performance-Summary_YYYY-MM.csv`. That is the name of a document managers have
folders of, and renaming it silently breaks their filing. Worth deciding on purpose.

### Part 2 — the sign-in screen — BUILT 2026-08-22

No card. The form on the ground, the time-of-day eyebrow shared with the dashboard hero, and
the mark building as it is filled — 73 dots against 34 characters, driven off the input
**values** rather than keystrokes so a password manager lands where a person lands.

The ground is a **fixed layer behind both screens**, not something the sign-in owns. That is
the whole trick of the arrival: the same blobs and dots continue through the join instead of
one backdrop being swapped for another.

The dot count differs from the handoff and the pitch does not. At a 44px pitch, 1440x900 gives
660 dots rather than the ~925 quoted; the two numbers cannot both hold. Pitch is the one that
sets the visual rhythm, so pitch won.

### Part 3 — the arrival — BUILT 2026-08-22

Hold, gather, stretch, flash, assemble. Measured in the browser against the handoff's table:
gather at 487ms (spec 420), stretch 919 (940), flash 1840 (1820), assemble 1993 (1960).

Each dot of the mark becomes a streak: rotated to its own angle out of the centre, origin at
the near end, scaled along X only. **No translate**, so the near end stays pinned exactly
where the dot was and nothing detaches. Each streak keeps its own dot's colour, so the teal
rows fly teal and the sage rows fly sage.

Two things the beat table does not say out loud, found by building it:

- The flash and the assemble **overlap by 140ms**, so a `.beat-flash`-only rule cuts the flash
  short. Both beats carry the identical animation shorthand, which keeps the running animation
  rather than restarting it.
- The overlay's own fade has to be **held until the flash has peaked**, or it takes the white
  with it and the snap shows through.

The assemble beat reaches the dashboard as a class on the document root, because the dashboard
is above the overlay in the tree and threading a prop through six components that have no
other reason to know about it would be worse.

**The old cinematic is gone**, along with 200 lines of CSS for the stand-in dashboard it drew.
The day key is `lpc:arrival` rather than `lpc:intro-played`, so everybody sees the new arrival
once even if they had already seen the old one today.

### After the preview — 2026-08-22

Two things Jorge saw on the preview build that the handoff could not have told me.

**"It's loading first then playing the animation — it's supposed to just start."** Exactly
right, and there were two pauses stacked in front of it: the sign-in card's own 760ms
deconstruction before it handed over, and a 240ms wait inherited from the cinematic that used
to follow that handover. So the app painted, the store began loading, and a quarter-second
later a full-screen animation dropped over the top of it. **The arrival now starts on the
press**, from inside the sign-in, and the auth round-trip and the mount both happen behind it.
The card's deconstruction is deleted: the arrival's own first beats are that.

**Every time, not once a day.** No stored key and nothing to reset. It therefore plays on a
page reload too, because a reload restores the session and that is an arrival as far as this
app is concerned — the honest reading of "every time", and noted in the code in case a refresh
at the desk should one day go straight in.

**And the tool switch became three beats, not one.** Jorge: *"the old page should transition
away element by element, then transition, then the next page would hit ... when the movement
is side by side, elements should move side to side and pages should move side to side."* The
first version fired the streaks over a page that was already changing underneath them, which
reads as a flash on top of a cut. Now the page leaves a block at a time in the direction of
travel, the streaks cross, and only then does the new tool mount and come in from the other
side. Anything that says "loading" is hidden for the length of it: a spinner between the
streaks and the page arriving is the join made visible, which is the one thing the sequence
exists to hide.

One trap worth keeping: the whole-page slide had to be an **animation**, not a transition.
`.page` carries its own mount animation, and an animation wins over a transition on the same
property — so a transition was being silently ignored on exactly the pages it was written for.

### Second pass on the preview — 2026-08-22

**The app opened on All Stores.** For an admin that is the one view that is nobody's actual
job: the numbers a manager acts on are a store's. It now opens on the store this browser last
worked in, and the overview is one click away rather than the front door. Only stores are
remembered — "admin" and "combined" are not — so an admin who wants the overview asks for it
each time rather than being parked there for ever after one visit. The initial state reads the
remembered store rather than starting on "admin" and correcting itself, which would have shown
the overview for a frame on every load.

**Pacing: out fast, in with weight.** The exit is a flick at 190ms — it is the part nobody
needs to watch — and the arrival carries the inertia Jorge asked for: each block comes in from
the side, overshoots the resting point, squashes very slightly along the direction of travel
at the moment of impact, and is pulled back. Thrown and stopped, rather than placed. The
stagger tightened from 40ms to 22ms so the blocks land in sequence without the last one
arriving late.

**Section tabs move sideways now.** They were reusing the page's mount animation, so stepping
one place along a strip made the whole page jump up from the bottom. A tab travels the way its
strip does, shorter and quicker than a tool switch because it is a smaller move. The direction
comes from the strip's own item order rather than from a list somebody has to keep in step
with it.

### Part 4 — the smaller transitions — BUILT 2026-08-22

- **Tool switching**: 34 streaks in the destination tool's hue, travelling the way the eye
  just moved. Written against the DOM rather than through React on purpose — a tool switch
  already unmounts and remounts a large tree, and putting 34 streaks through state at the same
  moment would put the animation in the same frame budget as the mount it exists to hide.
- **Section tabs**: already a measured pill rather than hardcoded widths — the mistake the
  prototype made and had to fix, which this app had already avoided. Only the timing changed,
  to the handoff's 340ms spring.
- **Metric card**: blooms from `scale(0.24)`. **Person detail**: the sheet rises from the row
  with its inner blocks at 60/120/180/240ms. **Saving**: one dot pulsing, replacing a pulsing
  word.

**Coming out of lightspeed, not stopping at it.** Three rounds of Jorge's feedback shaped
the end of the arrival, and each was the same note from a different angle. First: the elements
rose from below, which is this app's ordinary page mount and therefore reads as a page loading
*after* an animation rather than as the end of one. They scale up out of the middle now, and
the page itself resolves from beyond the frame, blurred and oversized, decelerating into place.
Second: it flickered at the very end. The ground was mounted *inside* the arrival overlay, so
it was destroyed at the same instant the dashboard needed it — it lives at the root now, mounted
once, and the arrival publishes its beat as a class on the document element so the ground can
follow along without being owned by it. Third: the peak felt "empty and segmented". The field
used to fade to nothing halfway through the stretch, which meant the one moment that should be
full of travelling light was seventy-odd streaks on a bare page. The field and the blobs now
fly *with* the mark — stretched, still bright — and decelerate back to rest over the same window
the dashboard lands in, so the last beat is one continuous move instead of a stop followed by
a start. One streak in three is bright rather than one in eight.

**The stutter at the join was a second of nothing, and it was a `requestAnimationFrame`
that never came.** The blocks were held invisible while the landing waited a frame
to measure them — but the frame it was waiting for is the one the browser spends
mounting the dashboard, and under that load it did not come back for a second.
Measured in the built app: the page arrived at 2134ms and the blocks were still at
opacity 0 at 3180ms. The screen recording is 1.2 seconds of a byte-identical frame,
long after the white had cleared. Measuring in a LAYOUT effect instead removes the
wait entirely: layout is already computed when it runs, and it runs before the
browser paints, so the animation is on the blocks the first time they are drawn.
Nothing to hide, nothing to wait for, and once a CSS animation has started it
belongs to the compositor and runs however busy the main thread gets.

**And the white now lasts as long as what it is covering.** It was a fixed 420ms
from the flash beat, and the thing it hides is not fixed at all — the mount took
680ms, so the white rose, fell, and was gone before the page arrived. What you saw
was the streaks stop, a flash, the flash clear to reveal the same stopped streaks,
and then the page. It rises and holds now, and only begins to clear when
`.sage-assemble` says the dashboard is actually there.

**A note on measuring this.** Two rounds were spent chasing a freeze that was not
real: a headless browser stops producing compositor frames, so a screen recording
repeats the last one and every frame reads as identical. The trace of what the page
was actually doing said the opposite. Frames from a screencast prove what was
*painted* only when something is painting; for anything else, instrument the page.
The self-labelling colour patch — a fixed div tinted by the current beat, sampled
out of each captured frame — is what finally made the recording trustworthy.

**The dashboard is mounted under the streaks now, and the pause is gone.** Four
things were in the way, and each was measured on the built app as the worst
main-thread block in the 2.5s after the flash beat. It started at 1205ms.

1. **The stylesheet was being re-parsed on every branch change.** Every branch of
   the root rendered its own `<Style />`, so signing in tore down 353KB of CSS and
   mounted 353KB of identical CSS — not one interpolation in any of it. It is
   appended to the head once on load now and never touched. **1205ms → ~470ms**,
   and the same saving applies to any branch change, including tool switches.
2. **The sign-in screen became a layer rather than a branch.** The app underneath
   did not exist until the handover, so the dashboard mounted after the streaks
   had gone. It renders as soon as the session arrives, about 250ms into the hold,
   with the sign-in screen over the top: measured, the shell is up at ~100ms and
   the hero at ~400ms, against a flash at ~1780ms. The layer has to sit at a fixed
   index in every branch's output, because React reconciles by index — index 0
   changes type as the app comes up and remounts, index 1 does not, so the jump
   running inside the sign-in screen is never interrupted.
3. **The handover does no React work.** Changing state on the root re-renders the
   whole tree, and this tree is very large: a 490ms task for a dashboard that was
   not changing. The handover is four class names and the geometry of six blocks
   now; the state settles a second and a half later, when a render costs nothing
   anyone can see.
4. **The mark stops being painted at the flash.** 73 streaks, each larger than the
   screen, are expensive to rasterise and were still costing that for the whole
   flash — under a white overlay, with their far ends long gone. **505ms with the
   mark painting against 28-61ms without it.** That single number was most of what
   remained.

Worst block after the flash, three runs: **36ms, 48ms, 81ms.** From 1205ms.

One thing this exposed: the session now lands in the middle of the jump, so the
effect that used to start the arrival when a session appeared was mounting the
whole landing on a dashboard nobody could see, a second before the streaks had
finished. The jump hands over on its own clock.

**The streaks are drawn on a canvas now, because a real streak could not be
afforded as DOM.** The handoff draws every one as a pill — `border-radius:50%`
with the origin on its left edge — so a dot scaled along its own axis becomes a
spindle that tapers to nothing. Square corners made them blunt dashes instead, and
that was not a free choice: 660 large tapered elements cannot be composited at
frame rate. Measured in the built app, three configurations:

| streak shape | frames a jump | worst gap | stalls over 200ms |
|---|---|---|---|
| gradient taper | 23-38 | 700-1017ms | 2-5 |
| pill, border-radius 50% | 44-47 | 633-917ms | 2-3 |
| flat rectangle | 64-65 | 150-167ms | 0 |
| **canvas** | **69-74** | **117-167ms** | **0** |

The taper was never the problem, the element count was. So for the one beat that
needs them the streaks stop being elements: one canvas, one texture upload a frame,
each streak drawn as a spike that is full dot width at the near end and tapers to a
point at the far one. Paths are batched by colour, so a frame is five fills rather
than six hundred and sixty. It beats even the flat rectangles it replaced. Only for
the stretch — at rest the dots stay ordinary elements with a CSS twinkle, which
costs nothing.

The canvas has to pick up where the gather left off, pulled in toward the origin by
the field layer's own scale, or the whole field snaps outward on the frame the
streaks begin.

**And one stray brace hid all of it.** Removing the old `fieldStretch` keyframes
left their closing `}` behind, and the rule that followed — the one making the
canvas `position:fixed` — never applied. So the canvas was laid out as a flex item
inside the sign-in screen and shoved the card 720px to the right: the mark was
measured at x=1341 on a 1440px screen, and the two sets of streaks appeared to fly
from different vanishing points. The lesson is the cheap one: check the computed
value, not the source.

**The landing spring is the handoff's own.** `cubic-bezier(.34,1.6,.64,1)`, the
curve it uses for every dot that lands. 1.6 overshoots, so each block flies past
where it belongs and is pulled back. The curve it replaced had no overshoot at all,
which is why the landing read as soft. The gather was deepened to match: the mark
to 0.84, its dots to 0.70, the field to 0.86, the blobs to 0.85.

**The mark's build got the beat it was always missing.** The handoff opens its
table with "Hurry | 0 | 320ms | Only if the form is not finished" and this file
had never implemented it. A saved password fills both fields in one go, so the
mark is barely started when the button is pressed — and the streaks have to leave a
whole word, not half of one. So the build is now rushed to the end first and every
beat after it is pushed back by exactly that 320ms, which is the handoff's own
instruction: "add 320ms to every figure when the hurry runs first". The mark also
keeps honouring `revealed` through the press, because the hurry is what finishes
the drawing; dropping it on press would snap the rest of the word in and leave
nothing to hurry.

Each dot fades up over 240ms as the form reaches it, per the prototype's
`opacity 240ms ease`, rather than appearing on the keystroke. That meant moving
opacity out of the SVG presentation attribute and into the style, because an
attribute cannot be transitioned.

**The whole lockup condenses as one.** The gather used to draw each dot in along
its own radius scaled by how far it sat from the middle of the lockup, and that
middle falls inside the "a" — so the S was always the thing furthest out and always
the thing pulled hardest. Capping the distance helped and did not fix it: any
per-dot pull distorts the word, because the letters are not equidistant from its
centre. There is no per-dot pull now. The mark condenses at one rate, as a single
piece, toward the point the streaks come out of, which is its own centre and which
is what the layer's scale already does. Each dot still squashes along its own axis
by the same amount, priming the streak it is about to become, and being uniform it
cannot distort anything.

**Why the gather's pull was capped (superseded).** It draws every dot in along its own radius
from the middle of the lockup, and that middle falls inside the "a" — so the S, a
compact block sitting furthest out, was pulled hardest and across the widest
spread, and collapsed into itself while "age" barely moved. Capping the distance
term means everything past about two thirds of the way out travels the same amount:
the S moves as one piece and the lockup contracts evenly. The uniform part of the
contraction was always the layer's own scale(.90).

**And the two sets of streaks now fly on the same lines.** They already shared a
vanishing point, but not a trajectory: the mark's dots pin their near end and grow
outward, while the field's grew out of their own middle in both directions, and the
field layer scaled about the centre of the viewport while the mark scaled about the
logo. Both fixed — the field's origin is `--jx/--jy` like everything else, and its
dots pin their near end too.

**The landing now comes out of the point the streaks left from.** Jorge's
description: the streaks go, a little dot is left in the distance, and the store's
elements grow out of it and land radially, like coming out of lightspeed. That is
not a fade and not a scale in place, and it cannot be written in CSS: each block's
direction and distance depend on where it sits relative to a point that moves with
the sign-in mark. So every block is measured once, on the frame the dashboard
mounts, and handed its own `--rx`/`--ry`/`--rd` — the vector back to the vanishing
point and its turn in the sweep, nearest first. After that it is an ordinary
composited transform. One read pass before any write, so it costs a single forced
reflow rather than one per element.

The dot itself is a static element in index.html, placed from `--jx`/`--jy` that
the sign-in screen measures off its own mark, for the same reason the flash is
static: it has to outlive the swap between the signed-out and signed-in trees.

Three things had to be taken out of its way. The page's own `pageIn` mount was
running underneath the landing, so the whole layout drifted upward while every
block inside it travelled outward — two movements in different directions, which
is the choppiness; `saStill` now pins it, sitting after `pageIn` in the animation
list so dropping the class at the end cannot restart it. The section strip is
`display:none` above phone width, so its rect was all zeros: it was handed a vector
to the corner of the screen and, being the "furthest" element, set the scale every
other block's delay was measured against — one invisible element was compressing
the whole stagger. And the blocks are held invisible until they have been measured,
by a class armed for exactly one frame, which is its own class rather than part of
`.sage-assemble` so that neither reduced motion nor an empty selector can strand
the dashboard at opacity 0.

Landing frames, three runs: median 33ms, worst 100-150ms, no stall over 150ms.

**The landing was segmented because the app has an entrance of its own.**
`.lpc.is-entering` — the bar dropping in from `translateY(-100%)`, the hero and
every card rising from below on their own staggered delays — is keyed off the
session appearing, which now happens in the middle of the jump. So both entrances
ran, with different origins and unrelated timings. That is what "segmented" meant,
and it is also why nothing came from the centre: `appBar` comes from the top edge
and `appRise` from the bottom, whatever the page underneath them is doing.

Out-ranking it in CSS is a losing game — `.lpc.is-entering .hero` is three classes,
and `html.sage-assemble .hero` is two classes and a type, which loses. So the app's
own entrance simply does not start when the arrival owns the screen.

**And the dot field belongs to the sign-in screen, not to the app.** The handoff
builds it under "The sign-in screen" and its prototype keys the whole thing off
whether that screen is visible — `signinVisible ? ... : "off"` — while saying of the
BLOBS, and only the blobs, that they "live behind both the sign-in screen and the
dashboard, the same layer continuing through the transition rather than being
swapped". Two different lifetimes, and this file had given both of them the longer
one. Jorge saw it as a drift on the dashboard that should not have been there.

It cost more than tidiness. 660 dots left on the dashboard meant 660 dots
decelerating out of full streak while React mounted it: measured in the built app,
stalls of 467-983ms with the field there and none at all without it. The choppy
landing and the drift on the dashboard were the same mistake seen from two sides.
The field is rendered by the sign-in screen now, so it is held for the whole jump
and goes with that screen at the handover, underneath the white — and it fades on
the handoff's own schedule, `opacity 240ms ease-in` delayed 820ms of the 900ms
stretch, rather than trying to land. The sideways drift itself is exactly as
specified: `translate3d(-26px,-16px,0)` over 28s, alternating.

Landing frames after both fixes, three runs: median 33ms, worst 100ms, no stall
over 150ms. Before: worst 983ms with three.

**And it still did not run, because the field was too expensive to draw.** Three
attempts to fix this were verified against a harness of extracted components, and
all three were wrong about the app. So the app itself was built, served, and driven
with the network faked at the browser: the real root, the real branches, the real
CSS, a real sign-in. That is what finally showed it.

Frame gaps during the jump, measured there, three runs of each:

| | frames | worst gap | stalls over 200ms |
|---|---|---|---|
| as shipped | 39-47 | 667-883ms | 3-4 |
| field dots with square corners | 59-61 | 150-167ms | 0 |
| no field at all | 82-85 | 117-150ms | 0 |

A field dot is a 2.6px circle, and a circle is `border-radius:50%` — so a dot
stretched eighty times along its own axis is a long thin ELLIPSE, and 660 large
ellipses have to be rasterised every frame. Every stall came from the corners. The
whole jump was two or three painted frames: the form vanished, one still of streaks
appeared, the dashboard was there. Nothing to see, which is exactly what was
reported. Dropping the radius for the length of the jump costs nothing visible at
2.6px and buys the animation back.

Two more things that measurement caught and nothing else would have. The flash was
being asked for and then never painted, because the white was set on one line and
the dashboard mount was started on the next, and the mount blocks the main thread:
the handover now waits for two animation frames, so the second only runs once the
white has actually been painted. And the profile was being fetched AT the handover,
so the swap waited on a round trip that started too late to be covered — it is
fetched as soon as the password check passes now, while the screen is still held,
and the handover is a state flip with the session already in hand.

**Then it stopped again, and this time the sign-in screen was being pulled out
from under its own arrival.** The sign-in call is not the only thing that brings
the session in: the auth client fires SIGNED_IN the moment the password check
passes, the app's own listener refreshes the profile off that, and the session
lands about 300ms after the press — a quarter of the way into the hold. The root
then swapped to the dashboard, the sign-in screen unmounted, and the jump's cleanup
took every beat class with it. Measured: beats gone at 255ms, dashboard already up.
The whole animation was over before the gather, which is why it looked like nothing
happened, or like it went by too fast.

The jump now says when it is running and the root keeps the sign-in screen on until
it says otherwise. The session can arrive whenever it likes; the hold is released on
the frame the white is covering, which is the only frame where swapping one screen
for the other cannot be seen.

The harness never caught this because the stub client did not fire SIGNED_IN. It
does now, and the harness root holds the same way the real one does — without both,
a press test proves nothing about the thing that actually breaks.

**And the flash is a static div in index.html, not a component.** The moment it
exists to cover is the moment the signed-out tree is replaced by the signed-in one,
and those two have different root components, so React tears the whole subtree down
between them: anything mounted inside either one is destroyed by the very swap it
was drawn to hide. Measured, it restarted at opacity 0 on the frame the dashboard
appeared. Outside React it cannot be unmounted, and it needs nothing from React
anyway — the beats drive it entirely through classes on the document element. The
jump origin moved to module scope for the same reason: a ground rebuilt by that
teardown would land its streaks on different lines from the ones they left on.

**Then the arrival stopped happening at all, and the cause was a cascade loss.**
Pressing Sign in sets `.login-busy`, which runs the mark's working wave.
`.login-busy .login-logo circle` and `.sage-beat-stretch .login-logo circle` have
identical specificity and the login block sits further down the sheet, so the wave
won. That is not a cosmetic loss: a RUNNING ANIMATION beats a declared transform
outright, whatever the specificity, so every streak rule was silently ignored and
the mark sat there pulsing while the layer around it scaled. The jump had no mark
in it. The breathe rule's `transform-origin: center` beat the streak's `left
center` the same way, which would have grown each streak out of both ends.

It only appears on the real press path. Setting the beat classes by hand never sets
`.login-busy`, so every harness run of the jump looked perfect — which is exactly
why it shipped. The harness now presses the button.

**And the flash was being stripped off the frame it was drawn for.** The handover
unmounts the sign-in screen, and the jump's cleanup ran on that unmount and cleared
every beat class, including the flash set microseconds earlier. Measured: the swap
happened at opacity 0 and the white went off 270ms later, over a dashboard already
standing there. The cleanup is now a no-op once the flash is up, the flash belongs
to the far side, and the handover is 140ms INTO it, per the handoff's table (flash
+1820, assemble +1960).

**The middle of the jump had gone empty again.** The field layer scaled 3.2, which
carried every dot past the edge before the beat was over, and the blobs left the
frame entirely at 0.14 opacity: the last fifth of the jump was a blank page waiting
for the flash. The layer moves 2.0 now and the per-dot streaks do the travelling;
the dots are staggered by distance so the field empties outward from the mark
rather than all at once; and the blobs thin rather than vanish. Cloud that has been
pushed aside is still cloud.

**One origin for everything.** Jorge's note: the field starts at the logo too. The
ground now takes a jump origin from the sign-in screen, which measures its own mark
on the press, and every dot's angle and distance is rebuilt from that point — so
the field and the mark fly along the same lines out of the same place instead of
giving the eye two vanishing points 250px apart. And every dot goes, not the bright
third: the handoff's "only the bright minority needs its own streak" was a cost
note written against `will-change` promoting each one into a layer, and measured
here the whole field costs the same as a third of it, because the expensive part is
the stretch and not the count.

**The arrival ran OVER the sign-in screen, not on it.** The first build was a
fixed opaque panel at z-index 9000 with its own 360px copy of the wordmark at dead
viewport centre. It painted over the sign-in screen the instant the button was
pressed, so the form never faded, the dot field and the blobs never gathered, and
the streaks fired from the middle of the frame off a mark that was neither the size
nor in the place of the one the eye was on. Nothing of the sign-in screen ever
left, because nothing of it was ever in the animation — it was only hidden. The
handoff says the opposite on every count: Hold is "form fades out", Gather pulls in
the mark *and* the field *and* the blobs, and the blobs "live behind both the
sign-in screen and the dashboard, the same layer continuing through the transition
rather than being swapped".

So the overlay is gone. The beats are classes on the document and every rule they
carry points at something that was already on the screen. The streaks are the real
mark's own dots: SageMark publishes each dot's angle out of the centre, its
distance from it and its radius, and the stylesheet rotates each one to its own
radius, pins the origin at the near end and scales along X. Jorge's call was that
they fire from exactly where the logo sits, at the size it is, so they start 64px
tall above centre and still clear the frame from there.

The jump also starts on the PRESS now, with the network running underneath it, so
the 420ms hold and 520ms gather are spent while the request is in flight. Two
things had to be true and are: a failed sign-in cancels the jump and brings the
form back (a thrown error too, not only a returned one, or the held flash leaves a
white screen with nothing behind it), and a slow one holds the flash white rather
than handing over to a dashboard that is not ready.

**Not on a reload.** A session appearing is not the same event as somebody pressing
Sign in: a refresh restores one with no sign-in screen anywhere, so there is no mark
to streak and no form to fade, and the arrival would have to invent both. Jorge's
call is that a refresh at the desk goes straight in, so the trigger is the press.

**The dashboard assembles outward from the middle of the FRAME.** The first version
lifted every element from below, which is the app's ordinary mount and reads as a
page loading after an animation rather than as the end of one. The second oversized
the page and shrank it back, which pulls everything *inward* — the opposite of
building out of a centre — and, anchored at the page's own middle rather than the
viewport's, dragged the top of the layout off the screen. That is the clipped nav in
Jorge's screenshot. It now starts contracted and expands away from `50% 50vh`, which
at scroll 0 is the middle of what the eye is looking at whatever the page's height
turns out to be.

**And the dot field was sitting the jump out.** Its 28s drift is an *animation* on
transform, and an animation beats a declared transform and a transition alike, so
the gather and stretch rules on it did nothing at all — the field held still while
the mark flew apart around it. Same trap as the page mount animation, same way out:
keep the drift at index 0 of the animation list so it is never cancelled, and put
the beat's animation after it, where it wins.

**And then the side-to-side move flickered again, from the fix for the first one.**
Re-listing `pageIn` at index 0 keeps a running animation from being cancelled and
restarted — but only on an element that already carries it. `.page` does;
`.board-page` and `.tab-page` do not. Naming them in those rules did not preserve
anything, it INTRODUCED pageIn, which starts from opacity 0: the board faded up
from transparent every time a tab was pressed, for the whole length of the move.

`.page` had the same problem from the other end. It is keyed on the tab, so React
gives it a new element on every switch and pageIn starts fresh on that whatever the
list says. Re-listing cannot preserve what was never running.

Both are settled by the page-level move animations pinning `opacity:1`. They sit
after pageIn in the list, so they win on opacity as well as transform for as long
as they run, and pageIn is finished before they are: the container never fades, the
blocks still do their own, and when the move classes come off pageIn is at index 0,
already over, and does not restart. Measured in the built app, a tab switch now
holds the page at opacity 1 throughout while the block runs 1 → 0.92 → 0.64 out,
swaps, and comes back 0 → 0.88 → 1.

The exit was also being cut: the last block starts 48ms in and runs 140, so a swap
at 130ms took it away mid-flight. TAB_EXIT is 190 now, the same arithmetic as
TOOL_EXIT.

**The flicker going side to side had a cause, and it was not the transition.**
`.page` carries its own mount animation. Replacing the animation on it for the
length of a move *cancels* that one, and putting it back when the move ends starts
it again from zero: the instant a slide finished, the page dropped to opacity 0 and
lifted ten pixels off the bottom a second time. Measured frame by frame, that
second unasked-for mount begins on the exact frame the move classes come off. An
animation is matched to the one it replaces by name and position in the list, so
every move rule now re-lists `pageIn` first and puts its own animation after it:
`pageIn` is never cancelled, never restarted, long finished by then, and the move's
animation sits later in the list and wins on the properties they share.

**Section tabs move in two beats now, like tools.** They had one: the new tab's
blocks slid in from the side while the old ones were simply gone, because the
content was swapped in the same click that started the animation. Half a move is
what a flicker *is* — what the eye wants is the thing it was looking at leaving. So
the swap waits 130ms for the exit. The strip itself does not wait: the thumb and
the active label follow the tab that was *pressed*, so the control answers the
finger while the page underneath is still on its way out. The phone's section chips
got the same treatment; they were a hard cut with nothing travelling at all.

**And the reveal could still blink at the end.** Cards fade up as they scroll into
view, and until the observer has marked one it sits at opacity 0 — so a block
animated into place could drop straight back out on the frame after the move ended.
Anything on screen when a move finishes is by definition in view, so the move says
so before letting go of it.

**Waiting screens are held, not flashed.** A loading screen that appears for 80ms and vanishes
is a flicker, not information: the eye catches a flash of something it cannot read, which is
worse than a beat of nothing. `useHeld` applies two rules that are opposites on purpose — do
not show it at all until the wait has lasted long enough to be a wait (170ms), and once shown
keep it long enough to be read. The three call sites render *while waiting or while held*, so
the hold survives the condition clearing.

The delay is deliberately most of a second, because Jorge's rule for waiting is that motion
beats a panel: if something is taking a moment, slow the move down and let it settle rather
than dropping a loading screen over it. So the screen is the last resort, for a wait long
enough that showing nothing would look broken, and every ordinary wait finishes underneath it
unseen. Nothing that says "loading" is allowed to appear inside a move at all, tool or tab.

**The sign-in screen lost its spinner too.** Signing in used to swap the wordmark for a loading
indicator, which is a different object appearing in the place of the thing you were looking at.
The mark stays and goes to work instead: the same 73 dots, running a wave left to right, and
breathing gently the rest of the time. Each dot now carries its place in the mark's own
left-to-right order as a custom property, so a stylesheet can send a wave across the wordmark
without knowing anything about how the letters are drawn. Scale, never opacity — a dot the form
has not reached yet is drawn transparent, and animating opacity would light up the part of the
word that is meant to still be dark.

**One deliberate deviation.** The handoff gives tool hues and calls them "the existing pill
colours"; they are close to, but not the same as, the values in this file (`#0E9F6E` against
`#10B981`, `#2563EB` against `#5566F0`, `#7C3AED` against `#8B5CF6`). The pill the finger just
left is what the eye is carrying, so the app's own value is the one that matches it. Same rule
the handoff sets for the dashboard: the real component is the truth.

---

## Goal accountability, with a hard stop — BUILT 2026-08-21

**Asked for 2026-08-21, in Jorge's words:**

> if someone in the store keeps not getting to their goal I want it to flag it and make it
> obvious for them and they can't do anything in the app until they write down why they're
> not able to fix everything.

The intent: missing a goal repeatedly should not be something a person can keep scrolling
past. The app notices, says so plainly to the person it is about, and then stops being
useful to them until they have written down what is in their way.

Where the goals live, per Jorge:

- the **store's** monthly goal is set by a manager, under Stores
- an **individual's** goal is written in the **daily tracker, under coaching** — not in the
  store document's `goals` field

So the flag is driven off the coaching entries, not off store goals.

### What was decided, and what it does now

The rule and everything that follows from it are in `api/_goal-standing.mjs`, checked by
`test/goal-standing.test.mjs`. The screen is My Day, in the app.

1. **What counts as "keeps not getting to".** Jorge chose **three of the last five**, and
   the store can change both numbers (`repeatDays`, `repeatWindow` under Standards). Days
   off and days with no report are **skipped**, not counted either way — a day nobody
   worked is not a day somebody failed. Somebody who signed in and did nothing HAS worked,
   which the figures alone cannot tell apart, so the sign-in record decides it.
2. **What counts as a bad day: calls and videos**, against the store's own minimums.
   Deliberately NOT the RockEd mark, which is the third leg of the daily points system:
   the mark is not published with the floor figures, so a phone cannot read it, and a flag
   defined partly on something one side cannot see is two definitions of a bad day wearing
   one name — the shape of the last six faults in this system. If the mark is ever wanted
   in the rule, publish it first and change `dayBelow` in one place.
3. **Who it applies to.** Salespeople. Still open: whether a manager should be held to the
   store goal the same way.
4. **Where the written reason goes.** On the **day's floor row**, and that is forced rather
   than chosen: the store document is readable only by somebody signed in with that store
   (`lpc:store:%` is gated on `has_store`) and the person who owes the note is holding a
   phone that never signs in at all. The floor row is the one record both sides can read
   and write. There is deliberately **no field for it on the store document** — that would
   have been a field nothing ever wrote, which is exactly what `repeatFlags` turned out to
   be.
5. **A manager can lift it**, with a reason and their name against it, recorded next to the
   notes. A lift covers days up to the day it was lifted for, so a later bad day raises it
   again rather than the lift standing for ever. Still open: whether a lift should also go
   into the audit log.

The flag itself is never stored. It is derived from the days every time, so there is no
piece of state for a merge to settle or a stale tab to resurrect.

### The manager's side — BUILT 2026-08-21

Asked for the same day: *"start on my side, I want the notes to go to me."* Two things,
because "go to me" means both of them:

- **It arrives.** A note raises a ticket as well as writing the floor row, so it rides the
  one rail in this app that already reaches a person: it lands in Tickets under **Behind**,
  and Supabase carries it out to whatever webhook the store has set — the same route a
  wrong-number report takes. Which kinds are worth interrupting somebody for is decided in
  one place, `worthSending` in `api/_report-alert.mjs`. The alert says plainly that there is
  nothing to action, because it arrives beside reports that do need chasing.
- **It can be reviewed.** *Behind the standard* on the Live Floor, next to the off-lot
  backlog, because they are the same job at the same moment: who is flagged, the days and
  figures behind it, what they wrote, and who has not answered yet. Lifting is there, with a
  reason and a name against it.

The ticket is a delivery, not the record. The floor row is the record — it is what clears
the flag and what the panel reads back — and a ticket that fails to save can never cost
somebody their day back.

Both sides read the fortnight of floor rows through the same two functions, `readFloorDays`
and `standingFor`, for the reason this repository has learned six times: one record with two
readers written separately ends up as two answers about the same week.

Still open: whether a manager should be held to the store goal the same way, and whether a
lift should also go into the audit log. The settings screen now describes the rule correctly;
it described a "repeat offender" flag that never existed for as long as the app has run.

### What the block covers — DECIDED 2026-08-21

A hard block that caught the morning **QR sign-in to the line** would stop someone taking an
up. Locking a salesperson off the floor is the most expensive thing this app could do to a
store, and it would land on whoever is already having the worst month — which is the
opposite of what the flag is for.

Jorge agreed the split. **The block stops them reviewing, never working.**

| stays open | blocked until they write |
|---|---|
| sign in to the line, by QR or otherwise | their numbers, their trend, their standing |
| take an up | the board, the summary, anything ranking them |
| log a delivery, and anything else the floor needs | |

The test of a candidate screen: if being locked out of it costs the store a sale, it stays
open. Everything a salesperson does that puts money on the board keeps working; the part
that tells them how they are doing is what waits on the note.

Worth building the block as a list of screens it applies to rather than a list of exceptions,
so that a screen added later is open by default. A new screen that silently joins the blocked
set is how this ends up costing a sale a year from now.

---

## The Line went white — 2026-08-22

A toolbar button added to the wrong one of two components that draw an almost identical
toolbar. It read `behindCount`, which is a `useState` in the Live Floor board and does not
exist in the phone line, so **the whole tab threw on render and the screen went blank.**

Nothing caught it. The build is happy — the name is valid syntax — and every static check in
the suite reads the `api/` files, while the app is 26,000 lines of one file with dozens of
components that look like each other on purpose. The fault before this one (`squash is not
defined`) was the same shape one layer down.

**The guard**: every `const [x, setX] = useState(...)` belongs to exactly one component. If
another component mentions that name and has no local binding for it, it is reaching into a
scope it does not have. Deliberately narrow — a general undefined-name check over JSX is a
research project and a noisy one — and it catches the exact shape that reached production.

Three things went wrong while writing the check, all worth keeping:

- It stripped comments before slicing components, and the scanner does not preserve line
  structure, so `^function` matched 99 of ~200 components. **QueueTab was not one of them: the
  check passed on the bug it was written for by never looking at it.** It slices raw and
  strips per body now, with a vacuity guard asserting it sees 150+ components including
  QueueTab by name.
- "Any name after an open brace" counted as a declaration, so `{behindCount` in the JSX
  declared behindCount. A usage is not a binding.
- A JSX prop (`storeId={...}`) and an object key (`storeId: st.id`) are not variable reads.
  Names used that way anywhere in the file are skipped rather than guessed at.

---

## Fewer words, more picture — STARTED 2026-08-22

> reducing the "wordiness" of the page … I want more visuals throughout the website instead of
> words

This app explains itself, and that is deliberate: half of what it does is a judgement about a
person's month, and a screen that makes one without saying why is a screen nobody should
trust. The cost crept up on it — **3,905 words of prose permanently on the manager's screens**,
so the page read every morning is mostly sentences somebody read once, in March.

### The rule

- If the sentence tells you something **the screen already shows**, it goes entirely.
- If it carries **a decision somebody would otherwise get wrong** — a leaver keeps their cars,
  a fold cannot be split back apart — it goes behind `<Explain>`: one line always visible, the
  paragraph one click away.
- **Empty states stay.** "Nothing on the list yet, paste the drawer of dealer plates above" is
  the only thing on the screen at that moment; deleting it leaves a blank rectangle.
- **Rarely-used destructive screens keep their prose.** Backup, Repair and the store wizard are
  where a wrong click costs a store its records, and they are read by somebody who has not been
  there in six months. Explanation earns its place there and nowhere is it more expensive to
  have folded away.

`<Explain>` is a native `<details>`: keyboard-accessible and findable by in-page search for
free, and no state for a screen full of them to hold.

### Done so far

| screen | permanent prose |
|---|---|
| People | 566 → 69 words |
| Plates | 193 → 81 |
| Import | 175 → 131 |
| Coaching | 109 → 76 |

3,905 → 3,071 across the app. Still to do: Floor Config (203), Baseline Import (126), Tickets
(111), Missed Standards (104, mine — written last week and already too long), Help (91).

### Own Your Outcome: drawn, not folded away

The plan on a person's card is the one thing in the app somebody is asked to ACT on — go and
find 34 leads — and whether they do it turns entirely on whether they believe the 34. The
app's answer to that was a sixty-word paragraph explaining the arithmetic, which is right and
which nobody reads twice.

Folding that into an `<Explain>` would have been **worse than leaving it**: the reasoning IS
the persuasion here, so hiding it hides the only reason to trust the number. So it is drawn:
four blocks and three arrows — the gap, their own sales mix (as a stacked bar), their own
closing rates, the leads that follow — each figure carrying a dot in its channel's colour so
three percentages say WHICH three without a legend. Same chain, same numbers, read in a second,
and it stacks into a downward flow on a phone.

Two more sentences became evidence rather than reassurance. "Built from this person's own
conversion history, not a number anybody made up" is a *claim*; **Their own record · 33 cars
across 71 working days** is the thing that makes it true, and it is shorter. The coaching
bar's "drawn from your own floor rather than a number someone made up" got the same treatment:
**Your own floor · 6 of 18, by units delivered**.

The rule this adds to the sweep: **where the words are the reason to believe a number, draw
them — do not fold them away.**

---

## History and Summary — REWORKED 2026-08-21

> I feel like we haven't given any recent love to the history and summary tabs

### History showed no history

It listed one month's figures in a table and let you change which month with a dropdown, so
every month looked exactly like every other one. The one question a history tab is for — is
this getting better? — was the one thing it could not answer, and the only way to find out
was to write the numbers down and change the dropdown.

- **Every figure now carries its move** since the month before, in points, with a 0.5-point
  deadband so a rounding wobble is never dressed up as a trend. Points rather than percent of
  a percent, because "up four points" is what a manager says out loud.
- **The month it compares against is the previous month ON RECORD**, not last month by the
  calendar. A store that imported nothing in July should be read against June rather than
  against nothing.
- **The verdict trail**: how each person was judged in each of the last eight months, oldest
  on the left, each month under the standards that were in force at the time. A run of reds
  turning green is a coaching story, and it was in the data all along with nothing drawing it.
- The first month on record says so and draws no arrows, rather than comparing against zero.

### Summary led with a caption

The four numbers the page is read for were a run-on sentence under the title — "4 restricted ·
2 in grace period · 9 cleared". They are tiles now, the site's own, already used on the
Dashboard. **Paused right now** is deliberately its own number rather than folded into
"below standard": it is the only one where somebody is not being handed leads this minute.

### Nothing to judge is not the same as judged and found wanting — FIXED

Somebody with NO figures at all in a month was judged **Restrict**, because a missing value
counted as a failed requirement: a new hire in their first week, somebody on leave, a store
whose report had not landed. Jorge asked for it fixed on both screens, so it is fixed in
`evaluateAssociate` where both read it — a new `no-data` status, shown as **No figures yet**.

The bar is deliberately EVERY required figure absent. One missing number out of four is a
real shortfall against that requirement and still counts.

### The board row, restructured — same day

> Remove the words on the bar underneath. The speedometers are not lined up with each other.
> I want the lead bar to take up a longer length within the tile.

- **The dials never lined up** because the row was a flex line with TWO auto margins in it —
  one before the dials, one before the lead count — so free space split between them and the
  dials landed wherever the verdict's wording left them. "Nearing the limit" and "Below
  standard, room left" are different widths, so no two rows agreed. It is a grid of fixed
  tracks now: column four is under column four on every row.
- **The bar is in the row** and takes whatever is left, which is most of it. It used to sit
  under the row capped at 520px — the smallest object on a line with room for it to be the
  largest — with a sentence beneath restating what it and the verdict already said.
- **The sentences are gone**, kept as the bar's own `title`. A manager who wants the wording
  has it on hover; the page is not nine paragraphs long. What is left under a row is the one
  thing that was never a restatement: the Confirm-removed-from-leads action.
- Below 1200px the row wraps instead, bar on its own line, so nothing is pushed off the edge.
- **The lead count is two sub-columns**, not one right-aligned string: "74 / 80" and "82 / 100"
  are different widths, so aligning the whole thing put the slash somewhere different on every
  row. The number ends where every number ends; the cap starts where every cap starts.
- **Every verdict pill is one width**, so they read as a column rather than a ragged edge.
- **Everything that identifies a person is one grid cell.** The rank badge, the crushing-it
  badge and the incomplete flag come and go, and each used to be a child of the row's grid —
  so a row with a badge pushed everything after it into the next track and the dials fell out
  of line the moment somebody had a good month.

### Crushing it, in gold

Forty per cent over every requirement is not a good month, it is a different league, and it
had the same small green line down the card that everybody clearing standard gets. It is gold
now, and the whole row wears it: the edge, the badge, their lead bar, and their verdict pill.
Nothing moves and nothing changes size — the same row, wearing something. It costs nothing to
say well done properly.

### Next: more pictures, fewer words, everywhere else

Jorge's follow-up, not yet started: the same pass over the rest of the site.

---

## Positions, told apart — BUILT 2026-08-21

> I'd like there to be a visual difference between job types like BDC and sales and so on
> and group them accordingly, keep it fun.

The People list was one grey run of names, and a manager reading it is almost always after
one group of them: the BDC's numbers, or who is actually on the floor selling. The position
was there in small grey type, doing none of the work of telling them apart.

- **The colour is the position's own**, set under Settings and already drawn on the standards
  table. The same identity turning up in a second place, not a new one invented for this
  screen. The settings table now draws the same badge, so a colour picked there is visibly
  the colour it becomes on People.
- **Warm, because the site is.** The seeded role colours were an iOS-ish blue, purple, teal
  and slate that had never matched the amber, lime and clay this site's cards are tinted
  with. Nobody had noticed because they were never seen together until this screen put four
  of them on one page. They are now amber, olive, brick and warm stone, migrated on load —
  and ONLY where the colour is one nobody chose (a seeded default or the old ramp), so a
  store that picked its own keeps it.
- **The colour stays in the heading.** A bar down the left of each row and a ring around each
  face were both tried and both removed: the bar was a louder second copy of what the heading
  already says and a hard vertical edge is a shape this site does not use, and the ring put a
  warm outline around a face whose fill is a hue off the person's own name — two palettes
  arguing on one 30-pixel object.
- **The glyph comes off the position's NAME**, not its id, because the ids are whatever
  somebody typed. Every store invents its own titles — "Internet Sales", "Product
  Specialist", "Client Advisor" — so a new position gets something that fits on the day it
  is added, with a stable fallback off the id for a title nothing recognises. Nobody is
  asked to choose an icon they did not ask for.
- **Groups follow the order positions are listed under Settings**, never alphabetically by
  job title, which would put the BDC above the floor at every store in the group for no
  reason anybody chose. Empty groups are not drawn: a heading with nobody under it reads as
  a position with nobody in it, which is a different and alarming thing.
- **Select these N** per group, because that is the batch a manager actually arrives with.
  Quiet but never hidden until hover: half the people on this screen are on an iPad, where
  a control that only appears for a mouse does not exist at all.

### The row's own buttons, and room at the edges — same day

Every row carried four solid blue pills, so a list of people read as a wall of buttons with
some names in it. They are all ordinary, occasional actions — somebody leaves, somebody
moves store — and none of them is what a manager came to the screen to do; the list itself
is. They are outlined and quiet now, turn solid under the pointer, and only **Not ours**
takes a colour, because it is the only one that removes a person's figures from the store's
books.

The buttons on the ALERT cards stayed solid on purpose. Those cards are a decision somebody
came to make; the list is something they came to read.

On a phone the labels stay and the row wraps. Dropping them to icons fits the row and turns
four unlabelled marks into a guessing game, one of which is destructive.

And the tab had no gutter at all: the Dashboard sits in `.board-page` (32px sides, 1440
ceiling) and every other tab in this module was rendered bare into `.page`, which carries no
padding, so on a wide monitor a card ran from one edge of the glass to the other. Import,
Summary, History, Standards and People now share one `.tab-page` gutter.

Deliberately per tab rather than on `.page` itself: the activity module's tracker is a dense
table that has always had the full width, and a 1440 ceiling would change a screen nobody
asked about. The admin tabs are still bare for the same reason — nobody has complained, and
guessing is how a screen somebody relies on gets narrowed overnight.

"No position yet" is a real state and a common one — every name a report brings in arrives
without one — so it gets its own grey identity rather than being lumped in with the first
position on the list.

---

## Picking the person yourself — BUILT 2026-08-21

> the merging names selector only pops up if the site notices that it has a name that's
> similar, I want to also have the ability to pick it as well

True, and the wrong way round. The app offered the fold only where it had already worked out
the answer — the mangled-name list and the holding pen — and said nothing on the two lists
where a person is most likely to know something the measure never will. A nickname, a maiden
name, a first name spelled the way a family spells it: no edit distance finds those, and a
manager recognises them at a glance.

One picker now, in four places: the holding pen, the strangers-in-the-figures list, beside
the app's guess on a misread name (so a wrong guess can be redirected instead of merged
wrongly or left alone for ever), and inside a person's own Details — which is the case none
of the others could reach, two entries the store claims BOTH of. The suggestion still sorts
to the top; the whole roster is always under it. The measure sorts, the person decides.

Folding a person the store claims asks first, because they come off the roster. Folding a
name in the figures does not, because nothing is lost either way.

---

## The removal bug, instance seven — FIXED 2026-08-21

Reported as *"trying to merge and it's still clicking and then reverting back"*, twenty-four
names at Holler Honda, all of them a column heading welded onto a real person's name.

Instance five fixed the FIGURES: a folded name's numbers came back with the server's month.
Instance seven was the same fold and the same trap one layer over, in the LISTS. `sameAs`
takes the misspelling off the roster and out of the holding pen by deleting it, and both of
those are unions in the merge — the roster so a stale tab cannot drop somebody, the holding
pen so two reports can each hold half of one unclaimed person. So the server handed the name
straight back and the screen offered it again seconds later.

Found by running the fold through the real merge with the misspelling seeded on each list in
turn: roster and pendingPeople came back, excluded and departed did not (they carry stamps
already). Both are now carried out again by `foldAliases`, over whatever the lists say after
a merge, with no new stamp: **the alias is the record**, it is already a union, and it
already survives every merge. A seventh stamp would have been a seventh way of saying the
same thing.

The check now seeds the name on **every list a store keeps**, not the two that were reported.
"We fixed the two in the report" is what produced instances two through six.

One consequence worth knowing: while a name is an alias it cannot be on any list. Somebody
genuinely called that would need the alias removed first — which is right, and there is now a
screen for it: **Spellings folded into people**, under the People list.

**Undoing a fold is a stamp, not a deletion** — instance eight, pre-empted. `aliases` is a
union so that a tab which has never heard of a fold cannot drop it, which means deleting a
key would be undone by the first save from any other tab. So `aliasesAt` and `aliasesGone` are
a stamped pair, settled by time in both directions, and an alias with no stamp predates
anybody's decision to undo it, so the undo wins.

What an undo can and cannot give back: the spelling is free from the next report onwards and
can be claimed or ignored like any other name. The FIGURES do not come apart — five and three
became eight when the fold was made and nothing records which of the eight came from where.
The screen says so rather than guessing at somebody's month.

---

## Merge policy decisions — BUILT 2026-08-21

Answers given 2026-08-21, in response to the scope of the "one guard" merge work.
All of it is in now: the merge is `api/_store-merge.mjs`, every field declares its
rule in `FIELD_POLICY`, the seven that had no rule have one, and `applyDecisions`
runs every recorded decision over whatever a merge produces. Kept here because the
reasoning is worth more than the outcome.

| Field | Decision |
|---|---|
| `goals` | Store-level, set by a manager. Individual goals are not here — they live in the daily tracker under coaching. Last writer wins, with a stamp. |
| `restrictions` | Needs a per-person stamp (`restrictionsAt`), like `daysOff`/`daysOffAt`. Reason given: many managers across many stores and many reps working the same system at once, so two managers editing different people must both survive. |

### The four fields Jorge asked about, and what they actually do

Established by reading every reference, 2026-08-21:

- **`qualified` — live, keep.** The RockEd training mark: per day, per person, a manager
  taps whether they qualified in RockEd that day. Feeds the standards scoring.
- **`stars` — legacy, read-only.** The old form of the same mark: a star count against a
  bar of 40 instead of a yes/no. **Nothing writes it any more** — tapping the new control
  deletes the old star value so the two cannot disagree. It is only still read so that old
  months keep scoring. It can shrink, never grow.
- **`repeatFlags` — dead, and now deleted.** Every reference in the app and the pipeline was
  copy-through: snapshot lists and an undo-restore list. Nothing read a value out of it and
  nothing wrote one in; it was carried from document to document for no reason. Jorge chose
  deletion over a merge rule. It is in `DEAD_FIELDS` and drains on the next save of each
  store, so there is no job to run. An old snapshot restored through undo can bring one
  back; the next save takes it out again.
- **`statsExcluded` — live, keep.** People left out of the store's *benchmark averages*, so
  one outlier does not drag the store's comparison numbers around. Toggled per person on
  the coaching screen, where it shows as an "out of stats" badge.

**`statsExcluded` got its stamps.** It was an array removed with a plain `filter`, which
would have become the sixth instance of the removal-does-not-survive bug the moment anybody
made it a union. It is a union now, with a stamped *pair* behind it — the first attempt used
a single removal stamp and re-excluding somebody after putting them back could never win,
because the other tab's removal stamp was unioned back every time.

**The sixth instance turned up anyway, somewhere else.** Marking a roll-up row as ignored
strips its figures, but the merge hands back the server's month whole, so the units walked
back into the store's total while the name correctly stayed off every list. Found by writing
the tests rather than by anybody noticing a wrong total. That is what `applyDecisions` is
for: every decision is carried out again at the end of every merge, so a branch that hands
data back cannot quietly undo one.
