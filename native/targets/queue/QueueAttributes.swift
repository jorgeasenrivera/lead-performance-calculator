import ActivityKit
import Foundation

/* What the server sends, exactly. The name of this struct is the
   "attributes-type" in every push-to-start payload (api/queue-changed.mjs,
   ACTIVITY_TYPE), and the content state's keys are the ones contentState() in
   api/_queue-notify.mjs writes, plus the v2 lanes api/_live-standing.mjs
   adds. Copies of this file live in intents/ and modules/sage-live/ios so the
   app can start an activity itself; all three must stay identical, because
   ActivityKit matches them by name and shape. */
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
    /// An open FlyBy or T.O.: which, when it went out, and who picked it up.
    /// All three optional so a payload from an older server still decodes.
    var ask: String?          // "fly" | "to"
    var askAt: String?        // ISO 8601, for the clock on the asking card
    var askBy: String?        // the manager who claimed it, if one has
    /// The desk's own ask: who asked, and where to go when it is a meeting
    /// rather than a call to the desk.
    var askedBy: String?
    var place: String?
    /// The card is asking whether the guest has gone, before it ends the visit.
    var confirm: Bool?
    /// The button just pressed, held for one beat so the card can ring in that
    /// button's colour. Cleared by the update that follows.
    var pressed: String?      // "fly" | "to" | "done" | "take" | "pass" | ...

    /// ---- contract v2 (api/_live-standing.mjs) ----
    /// Present when the sender is v2. The fields above are then the leading
    /// lane's, kept so a card built for v1 still reads. `floor` and `phone`
    /// are the two lanes, each absent when they are not on that line today;
    /// `hot` is which lane leads, "floor" | "phone", or nil when neither is
    /// urgent and both are shown small.
    var v: Int?
    var hot: String?
    var floor: FloorLane?
    var phone: PhoneLane?
  }

  /// The floor, as its own lane: what the top level said before v2.
  public struct FloorLane: Codable, Hashable {
    var position: Int
    var ahead: Int
    var status: String            // "waiting" | "up" | "customer" | "lunch" | "away"
    var line: [Pip]?
    var table: String?
    var since: String?
    var nudge: Bool?
    var ask: String?
    var askAt: String?
    var askBy: String?
  }

  /// One desk in the phone room's row.
  public struct Desk: Codable, Hashable {
    var n: String
    var who: String
    var mine: Bool
    var open: Bool
  }

  /// The phone line: the room's four lives, and off.
  public struct PhoneLane: Codable, Hashable {
    var state: String             // "cord" | "offer" | "desk" | "free" | "off"
    var status: String            // "waiting" | "lunch" | "away"
    var position: Int?            // on the cord: desk order, not line order
    var ahead: Int?
    var line: [Pip]?              // the cord's pips, front first
    var desk: String?             // offer and desk
    var until: String?            // offer: when it runs out, ISO 8601
    var since: String?            // desk: since they sat; otherwise the status stamp
    var free: [String]?           // free: which desks are open
    var desks: [Desk]?            // the row, for the card
  }

  /// The store the line belongs to (id on a server start, name on a local one).
  var store: String
  /// The day, YYYY-MM-DD.
  var date: String
  /// Which line: "floor" or "queue".
  var kind: String
}
