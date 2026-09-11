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
 *   - on iOS, hands the page the Live Activity tokens too (push-to-start, and
 *     each running activity's own), and puts the line on the lock screen the
 *     moment the page says where the person stands, so the server only has to
 *     keep it moving;
 *   - turns the page's "buzz" into a real haptic, which WebViews swallow;
 *   - opens outside links in the phone's browser rather than inside itself.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AppState, BackHandler, Linking, Platform, StyleSheet, View } from "react-native";
import { WebView } from "react-native-webview";
import { StatusBar } from "expo-status-bar";
import * as SplashScreen from "expo-splash-screen";
import * as Notifications from "expo-notifications";
import * as Device from "expo-device";
import * as Application from "expo-application";
import * as Haptics from "expo-haptics";
import * as Location from "expo-location";
import * as TaskManager from "expo-task-manager";
import Constants from "expo-constants";
import { SafeAreaProvider, useSafeAreaInsets } from "react-native-safe-area-context";
import * as SageLive from "./modules/sage-live";

SplashScreen.preventAutoHideAsync().catch(() => {});

/* ---- a push that redraws the card ----
   Android's Live Update is posted by the app, not by the server, so a phone
   whose app the system has since killed would otherwise keep showing whatever
   the line looked like when it was last awake. The server already sends a
   data-only message on every change for exactly this reason; it now carries the
   same content state the iOS activity is sent, and this task, which the system
   starts whether or not the app is running, redraws the card from it. iOS does
   not come through here: ActivityKit moves its own card.

   A registration that fails is not worth a crash. The card then goes stale
   while the app is gone and is right again the moment it is opened. */
const PUSH_TASK = "sage-push";
TaskManager.defineTask(PUSH_TASK, async ({ data, error }) => {
  try {
    if (error || Platform.OS !== "android" || !SageLive.available) return;
    const d = (data && (data.data || data)) || {};
    const body = d.notification && d.notification.data ? d.notification.data : d;
    const kind = String(body.kind || "");
    if (kind === "end") { await SageLive.end(); return; }
    if (!body.state) return;
    let state = null;
    try { state = JSON.parse(String(body.state)); } catch (e) { return; }
    if (!state || typeof state !== "object") return;
    // start rather than update: the card may have been ended, or never posted
    // on this launch, and start is the call that copes with both.
    await SageLive.start({ store: String(body.store || ""), date: "", kind: String(body.kind || "floor") }, state);
  } catch (e) { /* a card that did not redraw is not worth a crash */ }
});

/* ---- the lot ----
   The page tells the shell the lot as one circle while somebody is on the
   floor. iOS watches that region itself, app closed or not, and wakes this
   task when the phone leaves it. The task asks, on the lock screen, whether
   they are done for the day; the answer buttons act without opening the app
   (see the response listener in the shell), and a tap on the note opens the
   app to the same question. Nothing is decided here: a phone driving past a
   window is not a person going home, so the question is asked, never assumed. */
const LOT_TASK = "sage-lot";
const LOT_CATEGORY = "sage-lot";
TaskManager.defineTask(LOT_TASK, async ({ data, error }) => {
  try {
    if (error || !data || data.eventType !== Location.GeofencingEventType.Exit) return;
    await Notifications.scheduleNotificationAsync({
      content: { title: "Looks like you've left the lot", body: "Done for the day? Say so here, or open Sage.",
        categoryIdentifier: LOT_CATEGORY, data: { lot: true }, sound: false },
      trigger: null,
    });
  } catch (e) { /* a missed question is not worth a crash */ }
});
async function watchLot(circle) {
  try {
    if (!circle || !circle.on) {
      if (await Location.hasStartedGeofencingAsync(LOT_TASK)) await Location.stopGeofencingAsync(LOT_TASK);
      return;
    }
    const fg = await Location.requestForegroundPermissionsAsync();
    if (!fg.granted) return;
    const bg = await Location.requestBackgroundPermissionsAsync();
    if (!bg.granted) return;                         // the page's own check still runs in front
    await Location.startGeofencingAsync(LOT_TASK, [{
      identifier: "lot", latitude: Number(circle.lat), longitude: Number(circle.lng),
      radius: Math.max(150, Number(circle.radius) || 0), notifyOnEnter: false, notifyOnExit: true,
    }]);
  } catch (e) { /* no location, no watch; the page asks when it is opened */ }
}

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
  return (
    <SafeAreaProvider>
      <Shell />
    </SafeAreaProvider>
  );
}

function Shell() {
  const web = useRef(null);
  /* The phone's own insets: the notch or island, the home bar, and on Android
     the three-button bar, measured natively and handed to the page as CSS
     variables. iOS pages can read these through env() as well; Android's
     WebView cannot, so this is how edge to edge stays tappable there. */
  const insets = useSafeAreaInsets();
  const [ready, setReady] = useState(false);
  /* The build number travels with the rest of the handoff. iOS Settings shows
     only the marketing version, which is 1.0.0 for every build ever made, so
     "which build is this?" has cost this project several hours and one whole
     afternoon of chasing a bug that was simply an old binary. The page stamps
     it in the corner beside its own version; a screenshot of any screen now
     answers the question. */
  const [native, setNative] = useState({ platform: Platform.OS, deviceId: null, pushToken: null, ptsToken: null, activityToken: null,
    build: Application.nativeBuildVersion || null });
  /* ---- the safe areas belong to the page ----
     The page runs under the clock and the home bar, the way it does in Safari
     with the toolbars hidden, and pads itself with env(safe-area-inset-*):
     the ground stays continuous instead of meeting a flat strip of a nearly
     matching colour, and the header is pushed below the strip iOS keeps for
     itself so it can still be tapped. The colour the page reports (its
     theme-color meta) decides only whether the clock is drawn light or dark. */
  const [chrome, setChrome] = useState(INK);
  const lightChrome = (() => {
    const m = /^#([0-9a-f]{6})$/i.exec(chrome);
    if (!m) return false;
    const v = parseInt(m[1], 16);
    const lum = 0.299 * (v >> 16) + 0.587 * ((v >> 8) & 255) + 0.114 * (v & 255);
    return lum > 140;
  })();

  useEffect(() => {
    let dead = false;
    (async () => {
      const deviceId = await readDeviceId();
      let pushToken = null;
      try { pushToken = await readPushToken(); } catch (e) { pushToken = null; }
      if (!dead) setNative((n) => ({ ...n, platform: Platform.OS, deviceId, pushToken }));
    })();
    return () => { dead = true; };
  }, []);

  /* ---- the prompt to come back ----
     The line lives on the lock screen whether the app is open or not, as long
     as an activity is running. If the app goes to the background while the
     person is in line and no activity is up (an older iOS, or they dismissed
     it), a note fifteen minutes later asks them to open Sage so the line comes
     back. Coming back to the foreground cancels it. */
  const inLine = useRef(false);
  useEffect(() => {
    if (!SageLive.available) return;
    let noteId = null;
    const sub = AppState.addEventListener("change", async (st) => {
      try {
        if (st === "active") {
          if (noteId) { await Notifications.cancelScheduledNotificationAsync(noteId); noteId = null; }
          return;
        }
        if (st !== "background" || !inLine.current) return;
        if (await SageLive.isRunning()) return;
        noteId = await Notifications.scheduleNotificationAsync({
          content: { title: "You're still in line", body: "Open Sage so the line stays on your lock screen.", sound: false },
          trigger: { seconds: 15 * 60 },
        });
      } catch (e) { /* a note that fails to schedule is not worth a crash */ }
    });
    return () => sub.remove();
  }, []);

  /* The page's session, for answering the lot question from the lock screen
     without opening the app. The same handoff the Live Activity's buttons use. */
  const sessionRef = useRef(null);

  useEffect(() => {
    if (Platform.OS !== "android" || !SageLive.available) return;
    Notifications.registerTaskAsync(PUSH_TASK).catch(() => {});
  }, []);

  /* ---- buttons pressed on the lock screen ----
     The activity's buttons run as App Intents in this process. With a session
     in hand they act through /api/queue-action themselves; only when that is
     not possible do they hand the page one word to do it with its own session,
     which is what arrives here. A press before the page is up waits for it. */
  const pendingAct = useRef([]);
  const relayAct = useCallback((action) => {
    if (!action) return;
    if (!ready || !web.current) { pendingAct.current.push(action); return; }
    web.current.injectJavaScript(`(function(){ try { window.dispatchEvent(new CustomEvent("lpc:action", { detail: { action: ${JSON.stringify(String(action))} } })); } catch (e) {} })(); true;`);
  }, [ready]);
  useEffect(() => {
    if (!SageLive.available) return;
    const sub = SageLive.addActionListener((e) => relayAct(e && e.action));
    SageLive.pendingAction().then((a) => { if (a) relayAct(a); });
    return () => sub.remove();
  }, [relayAct]);
  /* ---- the lot question, answered ----
     "Done for the day" leaves the floor through the API with the session in
     hand, and the page is told too so it agrees the moment it is next opened.
     "I'm coming back" is nothing to do. A plain tap opens the app on the same
     question. Both buttons work from the lock screen with the app closed. */
  const lotSeen = useRef(null);
  const answerLot = useCallback(async (r) => {
    try {
      const req = r && r.notification && r.notification.request;
      if (!req || !req.content || !req.content.data || !req.content.data.lot) return;
      if (lotSeen.current === req.identifier) return;
      lotSeen.current = req.identifier;
      const which = r.actionIdentifier;
      if (which === "done") {
        const s = sessionRef.current;
        if (s && s.token && s.apiBase && s.store && s.date) {
          await fetch(String(s.apiBase).replace(/\/$/, "") + "/api/queue-action", {
            method: "POST", headers: { "content-type": "application/json", authorization: "Bearer " + s.token },
            body: JSON.stringify({ store: s.store, date: s.date, action: "leave" }),
          }).catch(() => {});
        }
        if (SageLive.available) SageLive.end();
        await watchLot(null);
        relayAct("leave");
      } else if (which === Notifications.DEFAULT_ACTION_IDENTIFIER) {
        if (!ready || !web.current) { pendingLot.current = true; return; }
        web.current.injectJavaScript(`(function(){ try { window.dispatchEvent(new CustomEvent("lpc:lot")); } catch (e) {} })(); true;`);
      }
    } catch (e) { /* the page asks again when it is opened */ }
  }, [ready, relayAct]);
  const pendingLot = useRef(false);
  useEffect(() => {
    Notifications.setNotificationCategoryAsync(LOT_CATEGORY, [
      { identifier: "done", buttonTitle: "Done for the day", options: { opensAppToForeground: false } },
      { identifier: "back", buttonTitle: "I'm coming back", options: { opensAppToForeground: false } },
    ]).catch(() => {});
  }, []);
  useEffect(() => {
    const sub = Notifications.addNotificationResponseReceivedListener(answerLot);
    Notifications.getLastNotificationResponseAsync().then((r) => { if (r) answerLot(r); }).catch(() => {});
    return () => sub.remove();
  }, [answerLot]);
  useEffect(() => {
    if (!ready || !web.current || !pendingLot.current) return;
    pendingLot.current = false;
    web.current.injectJavaScript(`(function(){ try { window.dispatchEvent(new CustomEvent("lpc:lot")); } catch (e) {} })(); true;`);
  }, [ready]);

  useEffect(() => {
    if (!ready || !web.current) return;
    const q = pendingAct.current; pendingAct.current = [];
    for (const a of q) relayAct(a);
  }, [ready, relayAct]);

  /* ---- the Live Activity's tokens ----
     Two more ways to reach this phone, both from ActivityKit and both handed to
     the page like the device token: the push-to-start token lets the server put
     the line on the lock screen unasked (iOS 17.2+); a running activity's own
     token lets it move that one. Either arriving re-sends the handoff, and the
     page registers whatever is new. */
  useEffect(() => {
    if (Platform.OS !== "ios" || !SageLive.available) return;
    const sub = SageLive.addTokenListener((e) => {
      if (!e || !e.token) return;
      setNative((n) => (e.kind === "pts" ? { ...n, ptsToken: e.token } : { ...n, activityToken: e.token }));
    });
    return () => sub.remove();
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
  const insetJs = useMemo(() => `
    (function(){
      try {
        var r = document.documentElement.style;
        r.setProperty("--shell-inset-top", "${Math.round(insets.top)}px");
        r.setProperty("--shell-inset-bottom", "${Math.round(insets.bottom)}px");
        r.setProperty("--shell-inset-left", "${Math.round(insets.left)}px");
        r.setProperty("--shell-inset-right", "${Math.round(insets.right)}px");
      } catch (e) {}
    })(); true;`, [insets.top, insets.bottom, insets.left, insets.right]);
  useEffect(() => { if (ready && web.current) web.current.injectJavaScript(insetJs); }, [insetJs, ready]);

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
    if (msg.type === "theme" && typeof msg.payload === "string" && /^#[0-9a-f]{6}$/i.test(msg.payload)) {
      setChrome(msg.payload);
      return;
    }
    /* The page's session, kept for the Live Activity's buttons: they act
       through the site's API with it, so a press works with the app closed. */
    if (msg.type === "session" && msg.payload && typeof msg.payload === "object") {
      sessionRef.current = msg.payload;
      if (SageLive.available) SageLive.setSession(msg.payload);
      return;
    }
    /* Where the lot is, while they are on the floor; off when they are not. */
    if (msg.type === "fence") { watchLot(msg.payload || null); return; }
    if (msg.type === "buzz") {
      const p = msg.payload;
      const heavy = Array.isArray(p) ? p.length > 1 : Number(p) >= 20;
      Haptics.impactAsync(heavy ? Haptics.ImpactFeedbackStyle.Heavy : Haptics.ImpactFeedbackStyle.Light).catch(() => {});
      return;
    }
    /* "queue" carries the person's standing: which line, how many ahead, and
       whether they are up. The page sends it whenever it changes while they are
       on the line, so this is the fastest way onto the lock screen: the server's
       push follows a moment later and finds the activity already there. Off the
       line (with a customer, lunch, away) takes it down; the server does the same
       for a phone that was not open. */
    if (msg.type === "queue" && SageLive.available) {
      const q = msg.payload || {};
      inLine.current = ["waiting", "up", "customer", "lunch", "away"].includes(String(q.status || ""));
      /* Standing with a customer keeps the card up now: that is where the FlyBy
         and T.O. buttons live. Lunch and away stay too, with the way back. */
      const waiting = ["waiting", "up", "customer", "lunch", "away"].includes(String(q.status || ""));
      const state = { ahead: Number(q.ahead) || 0, up: q.status === "up", status: q.status === "up" ? "waiting" : String(q.status || "waiting"), label: String(q.rep || ""),
        line: Array.isArray(q.line) ? q.line : [], nudge: !!q.nudge, table: q.table == null ? null : String(q.table), since: q.since || null,
        ask: q.ask || null, askAt: q.askAt || null, askBy: q.askBy || null };
      /* Contract v2 (api/_live-standing.mjs): the two lanes and which leads,
         carried whole. The card draws the phone line and the blended card
         from these; the fields above are the leading lane's for the rest. */
      if (Number(q.v) === 2) {
        state.v = 2; state.hot = q.hot || null;
        if (q.floor && typeof q.floor === "object") state.floor = q.floor;
        if (q.phone && typeof q.phone === "object") state.phone = q.phone;
      }
      if (waiting) {
        const d = new Date(), date = d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
        const kind = Number(q.v) === 2 ? (q.hot === "phone" || (!q.floor && q.phone) ? "queue" : "floor")
          : /up next|queue/i.test(String(q.queue || "")) ? "queue" : "floor";
        SageLive.start({ store: String(q.store || ""), date, kind }, state);
      } else {
        SageLive.end();
        /* Gone for the day: nothing left to reopen the app for either, and no
           lot to watch. The only notes this shell schedules are its own. */
        if (q.status === "gone") { Notifications.cancelAllScheduledNotificationsAsync().catch(() => {}); watchLot(null); }
      }
    }
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
    <View style={[styles.root, { backgroundColor: chrome }]}>
      <StatusBar style={lightChrome ? "dark" : "light"} translucent backgroundColor="transparent" />
      <WebView
        ref={web}
        source={{ uri: SITE }}
        style={styles.web}
        onLoadEnd={() => { setReady(true); SplashScreen.hideAsync().catch(() => {}); }}
        onMessage={onMessage}
        onShouldStartLoadWithRequest={onShouldStart}
        injectedJavaScriptBeforeContentLoaded={handoff + insetJs}
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
  web: { flex: 1, backgroundColor: "transparent" },
});
