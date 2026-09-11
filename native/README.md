# Sage, the phone app

The site is the product; this is its shell. See the comment at the top of
`App.js` for what it does and, more importantly, what it does not.

## Before the first build

1. **Site address.** `app.json` points at https://www.sageonline.io. If the
   site ever moves, `extra.siteUrl` is the only value in this folder to change.
2. **Apple.** An Apple Developer account. Create the App ID `com.sageonline` with the
   Push Notifications capability, and an APNs key (.p8). The API's push env
   (`APNS_KEY_ID`, `APNS_TEAM_ID`, `APNS_BUNDLE_ID=com.sageonline`, `APNS_KEY_P8`)
   comes from that key.
3. **Google.** A Firebase project with an Android app whose package is
   `com.sageonline`. Download `google-services.json` into this folder. The API's FCM
   env comes from the same project.
4. **Expo.** `npm i -g eas-cli`, `eas login`, then `eas init` here, which fills
   `extra.eas.projectId`.

## Building, from a browser

Nothing needs installing anywhere. GitHub → Actions → **Sage app** → Run
workflow, pick the platform, leave "upload" ticked. Expo compiles the app and
uploads it to TestFlight or Google Play. The secrets the workflow needs are
listed at the top of `.github/workflows/sage-app.yml`; every one of them is
made on a website and pasted into the repo's Settings → Secrets.

Apple is spoken to with an App Store Connect API key, so no Apple ID login or
two-factor code is ever needed. The signing certificate and provisioning
profile are made once in the browser (Expo uses them unattended but will not
create the first ones) and kept as secrets: `IOS_DIST_P12_BASE64`,
`IOS_DIST_P12_PASSWORD`, `IOS_PROFILE_BASE64`. Build numbers are tracked by
Expo (`appVersionSource: remote`) so every upload is new to TestFlight. That key is different from the push key the
server uses: one lets Expo sign and upload builds, the other lets the server
send notifications.

## Running on a computer, if one is available

```
cd native
npm install
npx expo run:ios        # a simulator (no push tokens there)
npx expo run:android
```

## The line on the lock screen (Live Activity)

The page sends one message per person (contract v2, `api/_live-standing.mjs`):
the floor lane, the phone lane, or both, and which leads. The card draws the
lane that leads big and the other small, both small when neither is urgent, and
the phone lane wears the room's cord. A shell from before v2 reads only the
top-level fields, which are the leading lane's, and draws the card it always
did. Android's Live Update reads those same fields and is not yet lane-aware.

`targets/queue` is a widget extension that draws the person's place in the line
on the lock screen and in the Dynamic Island; `modules/sage-live` is the small
native module that hands the page the activity tokens and starts the activity
the moment the page knows where they stand. Both are generated into the Xcode
project by `@bacons/apple-targets` at build time. What it needs, once:

1. A second App ID, `com.sageonline.queue`, on developer.apple.com (no
   capabilities needed), and an App Store provisioning profile for it made with
   the same distribution certificate. Base64 it into the repo secret
   `IOS_QUEUE_PROFILE_BASE64`.
2. The main App ID needs nothing new: Live Activities ride on the existing Push
   Notifications capability, and `NSSupportsLiveActivities` is already in
   `app.json`.
3. The server side was already built: `api/queue-changed.mjs` starts, moves and
   ends the activity with the tokens `/api/register-device` files
   (`apns_pts_token`, `activity_token`). Push-to-start needs iOS 17.2; on 16.2
   and 17.0 the activity appears when the app is open on the line, and the
   server keeps it moving from there.

The card has buttons (iOS 17 and up): Lunch and Away while waiting, Got them and
Pass when up, FlyBy, T.O. and Done with a customer, On my way when the desk asks,
Back on the floor from lunch or away. The phone lane has its own: Lunch and Away
on the cord, Take it when a desk is offered, Lunch and Leave the desk at a desk,
Back in line from lunch or away (`take-desk`, `leave-desk`, `lunch-desk`,
`lunch-line`, `away-line`, `back-line`; `pass-desk` exists on the server but is
not on the card, because a pass wants a reason). Each is an App Intent (`QueueIntents.swift`,
also compiled into both targets) that runs in the app's process. It changes the
card at once, then acts through `/api/queue-action` with the session the page
handed the shell (`session` message), so a press works with the app in the
background or closed; the row's webhook then settles the card. Only without a
usable session does it hand the page one word to do with its own session.

If the app goes to the background while the person is in line and no activity
is running, a local note fifteen minutes later asks them to open Sage.

The Swift struct `QueueAttributes` exists three times on purpose (the module,
the app target via `plugins/withQueueIntent.js`, and the extension each compile
their own copy) and must match the server's payload
exactly: the struct name is the push's `attributes-type`, the content state's
keys are what `contentState()` writes.

## Android without a Google Play account

Nothing about building for Android needs a Play developer account. Go to
Actions → Sage app → Run workflow, pick android, and **untick Upload**. The
build then makes an APK rather than a Play bundle, and when it finishes the
run's summary carries a link. Open that link on the phone itself; Android asks
once for permission to install from the browser, and the app is there.

Two things are worth knowing about that build:

- **Push will not work without Firebase.** The `GOOGLE_SERVICES_JSON` secret is
  Firebase's `google-services.json`, which is free and has nothing to do with
  Play. Without it the app builds, the line still shows on the lock screen
  (the app posts that itself) and the buttons still work; only notifications
  sent by the server do not arrive. The run says so rather than failing.
- **Ticking Upload needs the account.** That path submits to Play's internal
  track and needs `GOOGLE_PLAY_SERVICE_JSON`, a service account key made in the
  Play Console, which needs the developer account.

## The line on an Android lock screen (Live Update)

Android 16 calls it a Live Update: an ongoing notification that asks to be
promoted, which the system then draws as a chip in the status bar and a card on
the lock screen. It is the same idea as the iOS Live Activity and a different
shape, so the module has one set of function names and two implementations.

A promoted notification may not carry custom views, so the pixel rail cannot be
drawn. What it may carry is `ProgressStyle`, a segmented bar with a tracker,
which a queue happens to fit exactly: one segment per person in their own
colour, the door at the right hand end, the tracker standing on you. The
buttons are the same ones the Live Activity has, phase for phase, and a press
goes through `/api/queue-action` from a receiver that runs with the app closed.

Two things follow from the platform rather than from choice. There is no
push-to-start token, because the card is posted by the app; the server instead
sends the data-only message it already sends on every change, now carrying the
same content state, and a background task redraws the card from it whether or
not the app is running. And below Android 16 there is no promotion and no chip:
the same notification is posted, with the same buttons, in the shade.

It needs `POST_PROMOTED_NOTIFICATIONS` in the manifest, which is not a runtime
permission, and a notification channel above `IMPORTANCE_MIN`. Manufacturers
may add their own rules about what gets promoted.

## Leaving the lot

While somebody is on the floor, the page hands the shell the store's lot as one
circle (the fence drawn in Sage, with a margin), and iOS watches that region
itself with the app closed. When the phone leaves it, a note asks "Done for the
day?" with two buttons that work from the lock screen: "Done for the day" takes
them off the floor through `/api/queue-action` and ends the Live Activity;
"I'm coming back" does nothing. Tapping the note opens the app on the same
question. Nothing is decided without an answer.

This needs the "Always" location permission, which iOS asks for in two steps
(while using, then always). If the person says no to the second step, nothing
breaks: the page keeps its own check, which runs whenever the app is open or
brought back to the front. No fence drawn for the store means nothing is
watched.

## How push reaches a person

The shell fetches the phone's own APNs or FCM token and hands it to the page.
The page, which holds the signed-in session, posts it to `/api/register-device`
along with the store it is at. That endpoint files the token under the roster
id the account is linked to, and the queue notifier does the rest.
