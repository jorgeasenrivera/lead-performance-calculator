import ActivityKit
import Foundation

/* What the server sends, exactly. The name of this struct is the
   "attributes-type" in every push-to-start payload (api/queue-changed.mjs,
   ACTIVITY_TYPE), and the content state's keys are the ones contentState() in
   api/_queue-notify.mjs writes. A copy of this file lives in
   modules/sage-live/ios so the app can start an activity itself; the two must
   stay identical, because ActivityKit matches them by name and shape. */
struct QueueAttributes: ActivityAttributes {
  /// One person on the rail: initials, the site's hue for their name, waiting
  /// or not, and whether it is you.
  public struct Pip: Codable, Hashable {
    var i: String
    var h: Int
    var s: String
    var me: Bool
  }

  public struct ContentState: Codable, Hashable {
    /// People waiting ahead of them. 0 with up=true means "you're up".
    var ahead: Int
    /// Waiting with nobody waiting in front.
    var up: Bool
    /// "waiting", "customer", "lunch", "away", "gone".
    var status: String
    /// The name the line shows for them.
    var label: String
    /// The line, in order, as the lock screen draws it. Optional so an older
    /// payload without it still decodes.
    var line: [Pip]?
    /// The desk asked for them by name.
    var nudge: Bool?
    /// Where they are sitting, when with a customer.
    var table: String?
    /// When the standing last changed, ISO 8601.
    var since: String?
  }

  /// The store the line belongs to (id on a server start, name on a local one).
  var store: String
  /// The day, YYYY-MM-DD.
  var date: String
  /// Which line: "floor" or "queue".
  var kind: String
}
