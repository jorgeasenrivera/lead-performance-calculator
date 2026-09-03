/**
 * Sage, the phone app.
 * -------------------------------------------------------------------------
 * The whole product already lives on the site: the corner, the line, the floor,
 * the ticket. This shell gives it the two things a browser tab cannot be: an
 * icon on the phone that opens straight into it, and a way to be reached when
 * the screen is off. Everything else is the site, loaded full screen.
 *
 * What the shell does, and nothing more:
 *   - loads the site in a WebView that keeps its own storage, so signing in
 *     happens once and the account door does the rest every morning after;
 *   - asks for notification permission, fetches the device's own push token
 *     (APNs on iOS, FCM on Android) and hands it to the page, which registers
 *     it against the signed-in account through /api/register-device. The
 *     shell never sees the session; the page never sees anything it did not
 *     already have;
 *   - turns the page's "buzz" into a real haptic, which WebViews swallow;
 *   - opens outside links in the phone's browser rather than inside itself.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { BackHandler, Linking, Platform, StyleSheet, View } from "react-native";
import { WebView } from "react-native-webview";
import { StatusBar } from "expo-status-bar";
import * as SplashScreen from "expo-splash-screen";
import * as Notifications from "expo-notifications";
import * as Device from "expo-device";
import * as Application from "expo-application";
import * as Haptics from "expo-haptics";
import Constants from "expo-constants";

SplashScreen.preventAutoHideAsync().catch(() => {});

const SITE = (Constants.expoConfig && Constants.expoConfig.extra && Constants.expoConfig.extra.siteUrl) || "https://www.sageonline.io";
/* The site's own name, with or without www: sageonline.io redirects to
   www.sageonline.io and both are inside. Anything else is outside. */
const SITE_HOST = (() => { try { return new URL(SITE).hostname.replace(/^www\./, ""); } catch (e) { return ""; } })();
const isOurs = (url) => {
  try {
    const h = new URL(url).hostname.replace(/^www\./, "");
    return h === SITE_HOST || h.endsWith("." + SITE_HOST);
  } catch (e) { return false; }
};
const INK = "#15211B";

/* A notification that arrives while the app is open still shows: a salesperson
   with the corner up and the phone face-up on the desk is exactly who "you're
   up" is for. */
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true, shouldShowList: true, shouldPlaySound: true, shouldSetBadge: false,
  }),
});

/* The phone's own push token, the kind the API already speaks: raw APNs on iOS
   and raw FCM on Android. Null on a simulator, or when the person said no. */
async function readPushToken() {
  if (!Device.isDevice) return null;
  const { status: had } = await Notifications.getPermissionsAsync();
  let status = had;
  if (status !== "granted") ({ status } = await Notifications.requestPermissionsAsync());
  if (status !== "granted") return null;
  if (Platform.OS === "android") {
    await Notifications.setNotificationChannelAsync("floor", {
      name: "The floor", importance: Notifications.AndroidImportance.MAX,
      vibrationPattern: [0, 250, 250, 250], lightColor: "#E9CE96",
    });
  }
  const t = await Notifications.getDevicePushTokenAsync();
  return t && t.data ? String(t.data) : null;
}

async function readDeviceId() {
  try {
    if (Platform.OS === "android") return Application.getAndroidId() || "android";
    const id = await Application.getIosIdForVendorAsync();
    return id || "ios";
  } catch (e) { return Platform.OS; }
}

export default function App() {
  const web = useRef(null);
  const [ready, setReady] = useState(false);
  const [native, setNative] = useState({ platform: Platform.OS, deviceId: null, pushToken: null });

  useEffect(() => {
    let dead = false;
    (async () => {
      const deviceId = await readDeviceId();
      let pushToken = null;
      try { pushToken = await readPushToken(); } catch (e) { pushToken = null; }
      if (!dead) setNative({ platform: Platform.OS, deviceId, pushToken });
    })();
    return () => { dead = true; };
  }, []);

  /* Handed to the page as a plain object plus an event, so a page that loaded
     before the token arrived still hears about it. The page does the
     registering, with its own session. */
  const handoff = useMemo(() => `
    (function(){
      try {
        window.__lpcNative = ${JSON.stringify(native)};
        window.dispatchEvent(new CustomEvent("lpc:native", { detail: window.__lpcNative }));
      } catch (e) {}
    })(); true;`, [native]);
  useEffect(() => { if (ready && web.current) web.current.injectJavaScript(handoff); }, [handoff, ready]);

  /* Android's back button walks the site's history rather than leaving. */
  useEffect(() => {
    if (Platform.OS !== "android") return;
    const sub = BackHandler.addEventListener("hardwareBackPress", () => {
      if (web.current) { web.current.goBack(); return true; }
      return false;
    });
    return () => sub.remove();
  }, []);

  const onMessage = useCallback((e) => {
    let msg = null;
    try { msg = JSON.parse(e.nativeEvent.data); } catch (err) { return; }
    if (!msg || typeof msg !== "object") return;
    if (msg.type === "buzz") {
      const p = msg.payload;
      const heavy = Array.isArray(p) ? p.length > 1 : Number(p) >= 20;
      Haptics.impactAsync(heavy ? Haptics.ImpactFeedbackStyle.Heavy : Haptics.ImpactFeedbackStyle.Light).catch(() => {});
      return;
    }
    /* "queue" carries the person's standing: position, ahead, status. Nothing
       is done with it here yet; it is the feed a Live Activity or widget will
       read when those are built. */
  }, []);

  /* The site stays inside; everything else goes to the phone's browser or
     dialler. */
  const onShouldStart = useCallback((req) => {
    const url = req.url || "";
    if (isOurs(url) || url.startsWith("about:")) return true;
    Linking.openURL(url).catch(() => {});
    return false;
  }, []);

  return (
    <View style={styles.root}>
      <StatusBar style="light" backgroundColor={INK} />
      <WebView
        ref={web}
        source={{ uri: SITE }}
        style={styles.web}
        onLoadEnd={() => { setReady(true); SplashScreen.hideAsync().catch(() => {}); }}
        onMessage={onMessage}
        onShouldStartLoadWithRequest={onShouldStart}
        injectedJavaScriptBeforeContentLoaded={handoff}
        /* Sign in once. The page's own storage is what keeps the session. */
        domStorageEnabled
        sharedCookiesEnabled
        thirdPartyCookiesEnabled
        cacheEnabled
        /* No second window, no zoom, no bounce: it is an app. */
        setSupportMultipleWindows={false}
        allowsBackForwardNavigationGestures
        bounces={false}
        overScrollMode="never"
        scalesPageToFit={false}
        allowsInlineMediaPlayback
        mediaPlaybackRequiresUserAction={false}
        geolocationEnabled
        contentInsetAdjustmentBehavior="never"
        automaticallyAdjustContentInsets={false}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: INK },
  web: { flex: 1, backgroundColor: INK },
});
