import AppIntents
import Foundation

/* A button on the Live Activity.
   -------------------------------------------------------------------------
   Pressing one runs this in the APP's process (that is what LiveActivityIntent
   means), where the SageLive module is listening. It hands over one word and
   the page does the thing with its own session, exactly as its own buttons do.
   If nobody is listening yet (the app was not running), the word is kept and
   handed over the moment the module starts observing.

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

  func perform() async throws -> some IntentResult {
    let a = action
    UserDefaults.standard.set(a, forKey: "sageLive.pendingAction")
    NotificationCenter.default.post(name: Notification.Name("SageLiveAction"), object: nil, userInfo: ["action": a])
    return .result()
  }
}
