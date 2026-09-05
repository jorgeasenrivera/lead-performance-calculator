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
Back on the floor from lunch or away. Each is an App Intent (`QueueIntents.swift`,
also compiled into both targets) that runs in the app's process. It changes the
card at once, then acts through `/api/queue-action` with the session the page
handed the shell (`session` message), so a press works with the app in the
background or closed; the row's webhook then settles the card. Only without a
usable session does it hand the page one word to do with its own session.

If the app goes to the background while the person is in line and no activity
is running, a local note fifteen minutes later asks them to open Sage.

The Swift struct `QueueAttributes` exists twice on purpose (the app and the
extension each compile their own copy) and must match the server's payload
exactly: the struct name is the push's `attributes-type`, the content state's
keys are what `contentState()` writes.

## How push reaches a person

The shell fetches the phone's own APNs or FCM token and hands it to the page.
The page, which holds the signed-in session, posts it to `/api/register-device`
along with the store it is at. That endpoint files the token under the roster
id the account is linked to, and the queue notifier does the rest.
