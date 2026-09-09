import ActivityKit
import AppIntents
import Foundation
#if canImport(AudioToolbox)
import AudioToolbox
#endif

/* A button on the Live Activity.
   -------------------------------------------------------------------------
   Pressing one runs this in the APP's process (that is what LiveActivityIntent
   means). Three things happen, in this order:

   1. The card changes at once. The status the press implies is written into
      the running activity, so the button answers under the thumb rather than
      after a round trip. The server's own update follows and settles it.
   2. The word goes to /api/queue-action with the session the page handed the
      shell, and the server applies it to the floor row exactly as the page's
      own buttons would. This is what makes a press work with the app closed.
   3. Only if there is no session to act with, or the call fails, the word is
      handed to the page (SageLive module, "onAction") to do with its own
      session when it is next up.

   This file is compiled into both the app (put there by plugins/withQueueIntent.js
   at prebuild, beside a copy of QueueAttributes) and the widget extension, which
   is how the extension can name the intent and the app can perform it. It has
   to be a source of the app target itself: App Intents are found by the
   metadata the app's own sources produce, not by what a library links in. */
@available(iOS 17.0, *)
struct QueueActionIntent: LiveActivityIntent {
  static var title: LocalizedStringResource = "Sage floor action"
  static var description = IntentDescription("Acts on your place in the line.")

  @Parameter(title: "Action")
  var action: String

  init() { self.action = "" }
  init(action: String) { self.action = action }

  private func impliedStatus() -> String? {
    switch action {
    case "lunch", "away": return action
    case "back", "done", "pass": return "waiting"
    case "take": return "customer"
    default: return nil
    }
  }

  /* Everything the press implies, written before the server hears about it.
     Two of these never used to change anything at all: FlyBy and T.O. worked
     out no status, so the card sat on "With a customer" and the ask vanished
     into the floor. They have a face of their own now and this is what puts
     the card on it. */
  private func apply(_ s: inout QueueAttributes.ContentState) {
    let now = ISO8601DateFormatter().string(from: Date())
    switch action {
    case "fly", "to":
      s.ask = action == "to" ? "to" : "fly"
      s.askAt = now
      s.askBy = nil
      s.confirm = nil
    case "cancel":
      s.ask = nil; s.askAt = nil; s.askBy = nil
    case "ask-done":
      s.confirm = true
    case "keep":
      s.confirm = nil
    case "done":
      // Ending the visit clears the guest and anything asked about them.
      s.confirm = nil; s.ask = nil; s.askAt = nil; s.askBy = nil
      s.table = nil
      s.status = "waiting"; s.up = false; s.since = now
    case "take":
      s.status = "customer"; s.up = false; s.since = now
      s.ask = nil; s.askAt = nil; s.askBy = nil; s.confirm = nil
    case "ack", "with-guest":
      s.nudge = false; s.askedBy = nil; s.place = nil
    case "pass":
      s.ahead = max(s.ahead, (s.line?.count ?? 1) - 1)
      s.status = "waiting"; s.up = false; s.since = now
    default:
      if let st = impliedStatus() { s.status = st; s.up = false; s.since = now }
    }
  }

  /* The card answers under the thumb: the new face, and one beat of the
     pressed button's colour ringing the card. The ring is a field on the state
     rather than a gesture, because a widget cannot run its own animation on a
     tap; the second update, a third of a second later, takes it off. */
  private func nudgeNow() async {
    guard let a = Activity<QueueAttributes>.activities.first else { return }
    var s = a.content.state
    apply(&s)
    s.pressed = action
    await a.update(ActivityContent(state: s, staleDate: nil))
    try? await Task.sleep(nanoseconds: 340_000_000)
    s.pressed = nil
    await a.update(ActivityContent(state: s, staleDate: nil))
  }

  private func viaServer() async -> Bool {
    let d = UserDefaults.standard
    guard let token = d.string(forKey: "sageLive.token"), !token.isEmpty,
          let base = d.string(forKey: "sageLive.apiBase"), !base.isEmpty,
          let store = d.string(forKey: "sageLive.store"), !store.isEmpty,
          let date = d.string(forKey: "sageLive.date"), !date.isEmpty,
          let url = URL(string: base + "/api/queue-action") else { return false }
    if let exp = d.object(forKey: "sageLive.exp") as? Double, exp > 0, Date().timeIntervalSince1970 > exp { return false }
    var req = URLRequest(url: url)
    req.httpMethod = "POST"
    req.timeoutInterval = 12
    req.setValue("Bearer " + token, forHTTPHeaderField: "Authorization")
    req.setValue("application/json", forHTTPHeaderField: "Content-Type")
    req.httpBody = try? JSONSerialization.data(withJSONObject: ["store": store, "date": date, "action": action])
    do {
      let (_, resp) = try await URLSession.shared.data(for: req)
      if let http = resp as? HTTPURLResponse { return (200..<300).contains(http.statusCode) }
      return false
    } catch { return false }
  }

  /* Whether iOS will let a background process buzz is not documented either
     way, and the honest answer is that it probably will not: haptics are a
     foreground privilege and a Live Activity button runs with the app behind
     the lock screen. It costs one call to find out, and the visual answer above
     is built not to need it. */
  private func buzz() {
    #if canImport(AudioToolbox)
    AudioServicesPlaySystemSound(1519)   // a peek: the lightest of the three
    #endif
  }

  /* Two of the buttons only change the face of the card: asking whether the
     guest has gone, and taking the question back. There is nothing for the
     floor to hear about either, so they never leave the phone. */
  private var isLocalOnly: Bool { action == "ask-done" || action == "keep" }

  func perform() async throws -> some IntentResult {
    let a = action
    buzz()
    /* The server hears about the press at the same moment the card answers,
       not after. nudgeNow holds the ring on for a third of a second so a thumb
       can see which target it found, and awaiting that before opening the
       connection put that third of a second in front of every round trip —
       which is exactly what "FlyBy is a bit slow" was. The ring and the
       request now run together, and the request is still awaited, so a failed
       one still falls back to the app. */
    let server: Task<Bool, Never>? = isLocalOnly ? nil : Task { await viaServer() }
    await nudgeNow()
    guard let server = server else { return .result() }
    if await server.value { return .result() }
    UserDefaults.standard.set(a, forKey: "sageLive.pendingAction")
    NotificationCenter.default.post(name: Notification.Name("SageLiveAction"), object: nil, userInfo: ["action": a])
    return .result()
  }
}
