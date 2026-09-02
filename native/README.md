# Sage, the phone app

The site is the product; this is its shell. See the comment at the top of
`App.js` for what it does and, more importantly, what it does not.

## Before the first build

1. **Site address.** In `app.json`, set `extra.siteUrl` to the deployed site.
   That is the only value in this folder that has to change.
2. **Apple.** An Apple Developer account. Create the App ID `com.sage` with the
   Push Notifications capability, and an APNs key (.p8). The API's push env
   (`APNS_KEY_ID`, `APNS_TEAM_ID`, `APNS_BUNDLE_ID=com.sage`, `APNS_KEY_P8`)
   comes from that key.
3. **Google.** A Firebase project with an Android app whose package is
   `com.sage`. Download `google-services.json` into this folder. The API's FCM
   env comes from the same project.
4. **Expo.** `npm i -g eas-cli`, `eas login`, then `eas init` here, which fills
   `extra.eas.projectId`.

## Running

```
cd native
npm install
npx expo run:ios        # a simulator (no push tokens there)
npx expo run:android
```

## Building for the stores

```
npm run build:ios
npm run build:android
eas submit --platform ios
eas submit --platform android
```

## How push reaches a person

The shell fetches the phone's own APNs or FCM token and hands it to the page.
The page, which holds the signed-in session, posts it to `/api/register-device`
along with the store it is at. That endpoint files the token under the roster
id the account is linked to, and the queue notifier does the rest.
