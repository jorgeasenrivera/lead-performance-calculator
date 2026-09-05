import ActivityKit
import AppIntents
import Foundation

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

   This file is compiled into both the app and the widget extension, which is
   how the extension can name the intent and the app can perform it. */
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

  private func nudgeNow() async {
    guard let a = Activity<QueueAttributes>.activities.first else { return }
    var s = a.content.state
    if let st = impliedStatus() { s.status = st; s.up = false }
    if action == "ack" { s.nudge = false }
    if action == "pass" { s.ahead = max(s.ahead, (s.line?.count ?? 1) - 1) }
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

  func perform() async throws -> some IntentResult {
    let a = action
    await nudgeNow()
    if await viaServer() { return .result() }
    UserDefaults.standard.set(a, forKey: "sageLive.pendingAction")
    NotificationCenter.default.post(name: Notification.Name("SageLiveAction"), object: nil, userInfo: ["action": a])
    return .result()
  }
}
