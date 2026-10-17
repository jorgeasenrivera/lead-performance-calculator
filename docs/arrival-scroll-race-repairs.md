# Login and Home/Floor race repairs

The short login arrival can finish synchronously while receiving its destination.
That clears the receiver before the readiness notification. Capture the receiver
and send readiness only while that same receiver remains active. A replacement
receiver must not inherit the old sequence.

A Home/Floor settle timer queued before a bar selection can fire before the new
ramp's first frame. It used the old scroll position to reverse the selection and
cancel the ramp. Ignore that timer while the ramp or touch gesture is driving.
Idle settling and the existing duration, curves, pixels and timing bars are unchanged.

## Evidence

Eight tests execute the actual source slices: four failed on the original source,
and all eight pass with these two repairs. Coverage includes completion during
notification, timer/readiness ordering, receiver replacement, stale settling in
both directions, idle/manual settling and completed ramps. The repair tree passed
all 928 tests and the production build. Existing bundle size warnings remain.

The fictional loopback Chromium 151 and WebKit 26.6 probe passed full and reduced
login, animated Home/Floor navigation and idle manual settling with no page errors.
These are functional results, not a timing pass. Reduced return samples were
2,134 ms and 5,715 ms respectively, both above the unchanged 2,100 ms feel bar.
The unchanged Chromium feel harness failed five assertions: Floor to Phone
362 ms / 110 ms, Phone to Floor 387 ms / 110 ms, FlyBy 203 ms / 100 ms,
held press scale 1, and reduced return 2,577 ms / 2,100 ms. No thresholds were
changed. This local run does not clear the release gate. Raw results and screenshots are in
[evidence/arrival-scroll-races](evidence/arrival-scroll-races).

The combined scheduler tree uses approved preview head
`dc8e42e81e6054b16f5798a1098e7b2f5f4b953b` plus these exact core bytes. It passed
1,101 tests, a normal build and the isolated preview build. The old core hash pin
correctly rejected it. Only the expected core hash is updated to
`b117da4fe40732be8b534c8a8cd1be547cc150bf7673ef47409161e0b905afc0`;
the Manager hash and every isolation assertion stay intact. The combined pin
update is a separate integration patch, not part of this narrow runtime PR.
The approved scheduler branch and protected preview remain unchanged.

## Release and rollback

Jorge explicitly approved the live release consequence of these two runtime fixes
on 17 October 2026. Merge still requires independent review of the exact candidate
and successful required checks. No scheduler activation, database/access change,
real-account authentication or native release is included.

At preparation, production is READY deployment
`dpl_8cdjeGj9fKgJ3D7yTpuBCF572r93`, Git SHA
`d9320e253b603260f6a7355d4bc1c77a59fefa5b`, with `www.sageonline.io` and
`lead-performance-calculator-jorge-asencio-rivera-org.vercel.app` aliases.
Main is `15ea1a80db1c17e7f5d9b99db026f7fc09b30697`. Recheck both before release.

Immediately before merge, record the current main SHA and the currently aliased
READY production deployment. Main source changes may auto-deploy. After merge:

1. Confirm the new deployment's Git commit is the reviewed merge result, target
   is production, state is READY and expected production aliases point to it.
2. Verify the public sign-in loads without authenticating or writing real data.
   Check static bundle identity and absence of boot errors. Exercise authenticated
   login and navigation only against the fictional mock, with the deployed bundle
   if that can be done without production requests. Jorge verifies his real session.
3. Confirm the scheduler preview still has its approved SHA, protected URL and no
   production alias. Confirm no native release or database/access change occurred.
4. If these changes regress the app, revert the repair merge in a separate reviewed
   commit and verify the resulting production deployment and aliases. Do not force
   reset main or change environment settings. A Vercel deployment rollback requires
   explicitly coordinated execution and the recorded prior deployment identity.

Merge ordering: repair PR to main first, then incorporate the exact repair and
reviewed core-pin update into the scheduler stack, rerun the combined gates, merge
#478 into #476, then #476 into main. Do not merge a scheduler tree with the old pin.
Keep the approved static preview available as an independent review artifact.
