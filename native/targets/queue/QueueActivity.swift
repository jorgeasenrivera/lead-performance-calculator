import ActivityKit
import AppIntents
import SwiftUI
import WidgetKit

/* The line, on the lock screen.
   -------------------------------------------------------------------------
   Ink card, sand number, the rail from the floor tab with you lit, and the
   buttons that matter in each phase. No store name, no line name: the number
   and the glyph are the whole message, the words say why.

   Phases, in the order the server produces them:
     waiting        sand you on the rail            Lunch · Away
     next           0 ahead, sand edge              Lunch · Away
     up             mint, pulsing                   Got them · Pass
     with customer  amber dot, since, table         FlyBy · T.O. · They left
     desk asking    red, quicker                    On my way
     lunch / away   dimmed, rail without you        Back on the floor
     off the line   the final frame before dismiss

   Buttons need iOS 17 (they are App Intents); on 16.2 the card is the same
   without them. */

// MARK: - palette

private let ink = Color(red: 0x15 / 255, green: 0x21 / 255, blue: 0x1B / 255)
private let sand = Color(red: 0xE4 / 255, green: 0xC9 / 255, blue: 0x8D / 255)
private let mint = Color(red: 0x8F / 255, green: 0xD8 / 255, blue: 0xAF / 255)
private let fly = Color(red: 0xE8 / 255, green: 0xA9 / 255, blue: 0x3C / 255)
private let red = Color(red: 0xF0 / 255, green: 0x8A / 255, blue: 0x80 / 255)
private let mist = Color.white.opacity(0.62)
private let inkDeep = Color(red: 0x12 / 255, green: 0x25 / 255, blue: 0x1B / 255)
/* The ground the card sits on. Nearly off rather than merely dark: on an OLED
   lock screen these pixels draw no light at all, which is what lets the sand
   and the mint read as emitting rather than as paint. */
private let ground = Color(red: 0x05 / 255, green: 0x08 / 255, blue: 0x06 / 255)

// MARK: - PixIcon: the site's 5x5 glyphs, as dots

private let PIX: [String: [String]] = [
  "check":   ["00000","00001","00010","10100","01000"],
  "warn":    ["00100","00100","01110","01110","11111"],
  "arrowup": ["00100","01110","11111","00100","00100"],
  "arrow":   ["00100","00110","11111","00110","00100"],
  "door":    ["11111","10001","10011","10001","10001"],
  "user":    ["01110","01110","00100","11111","11111"],
  "lunch":   ["10101","10101","01001","01001","01001"],
  "away":    ["00000","01110","10001","01110","00000"],
  "fly":     ["00100","01110","11111","01110","00100"],
  "to":      ["00100","01110","00100","01110","00100"],
]

struct PixGlyph: View {
  let name: String
  var size: CGFloat = 14
  var color: Color = .white
  var body: some View {
    let rows = PIX[name] ?? PIX["arrow"]!
    let dot = size / 6.2
    let gap = (size - dot * 5) / 4
    VStack(spacing: gap) {
      ForEach(0..<5, id: \.self) { r in
        HStack(spacing: gap) {
          ForEach(0..<5, id: \.self) { c in
            Circle().fill(rows[r][rows[r].index(rows[r].startIndex, offsetBy: c)] == "1" ? color : Color.clear)
              .frame(width: dot, height: dot)
          }
        }
      }
    }
    .frame(width: size, height: size)
  }
}

// MARK: - phases

enum Phase { case waiting, next, up, customer, asking, claimed, confirm, desk, off, gone }

func phaseOf(_ s: QueueAttributes.ContentState) -> Phase {
  if s.nudge == true { return .desk }
  switch s.status {
  case "customer":
    /* Three faces of being with a guest, and the order matters: a claimed ask
       outranks an open one, and a question about ending the visit outranks
       both, because it is the thing the person is being asked right now. */
    if s.confirm == true { return .confirm }
    if s.ask != nil { return s.askBy != nil ? .claimed : .asking }
    return .customer
  case "lunch", "away": return .off
  case "gone": return .gone
  default:
    if s.up { return .up }
    return s.ahead == 0 ? .next : .waiting
  }
}

/* The rail is about a place in a line. It shows while they are standing in one,
   and while they are away, because away means on the floor and not taking a
   turn. It does not show at lunch, with a guest, or when the desk is calling. */
func showsRail(_ s: QueueAttributes.ContentState, _ ph: Phase) -> Bool {
  switch ph {
  case .waiting, .next, .up: return true
  case .off: return s.status == "away"
  default: return false
  }
}

/* Our timestamps carry milliseconds and ISO8601DateFormatter refuses them
   unless it is told to expect them, which is why the visit clock never
   appeared. Both shapes are tried. */
func parseISO(_ v: String?) -> Date? {
  guard let v = v, !v.isEmpty else { return nil }
  let f = ISO8601DateFormatter()
  f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
  if let d = f.date(from: v) { return d }
  f.formatOptions = [.withInternetDateTime]
  return f.date(from: v)
}

/* The ring a press leaves for one beat, in the colour of the button pressed:
   on a card with three targets side by side, the colour is what says which one
   your thumb actually found. */
func pressTint(_ p: String?) -> Color {
  switch p {
  case "fly": return fly
  case "to": return red
  case "lunch", "away": return mist
  default: return mint
  }
}

private func headline(_ s: QueueAttributes.ContentState, _ ph: Phase) -> String {
  switch ph {
  case .up: return "You're up"
  case .next: return "You're next"
  case .desk: return s.place != nil ? "Meeting, now" : "The desk wants you"
  case .customer: return "With a customer"
  case .asking: return "Requesting"          // the kind is coloured, see HeadlineText
  case .claimed: return (s.askBy.map { "\($0) is on the way" }) ?? "Manager on the way"
  case .confirm: return "Has your guest left?"
  case .off: return s.status == "lunch" ? "At lunch" : "Out of the line"
  case .gone: return "Off the line"
  case .waiting: return "\(s.ahead) ahead of you"
  }
}

/* Said once. A headline that already carries the fact does not get a caption
   repeating it underneath, which is what "In the line" and "Head to the door"
   were doing. */
private func caption(_ s: QueueAttributes.ContentState, _ ph: Phase) -> String? {
  switch ph {
  case .customer, .asking, .confirm:
    guard let t = s.table, !t.isEmpty else { return nil }
    return t.hasPrefix("O") ? "Office \(t.dropFirst())" : "Table \(t)"
  case .desk: return s.place ?? s.askedBy
  case .off: return s.status == "lunch"
    ? "You'll be passed until you tap back in"
    : "On the floor, not taking a turn"
  case .gone: return "Signed out for the day"
  default: return nil
  }
}

private func accent(_ ph: Phase) -> Color {
  switch ph {
  case .up, .claimed: return mint
  case .desk: return red
  case .customer, .asking, .confirm: return fly
  case .off, .gone: return mist
  default: return sand
  }
}

/* "Requesting FlyBy" with the kind in the kind's own colour, which is the only
   place on the card where two colours share a line. */
private struct HeadlineText: View {
  let s: QueueAttributes.ContentState
  let ph: Phase
  let size: CGFloat
  var body: some View {
    if ph == .asking {
      (Text("Requesting ").foregroundColor(.white)
        + Text(s.ask == "to" ? "T.O." : "FlyBy").foregroundColor(s.ask == "to" ? red : fly))
        .font(.system(size: size, weight: .bold, design: .rounded))
        .lineLimit(1)
    } else {
      Text(headline(s, ph))
        .font(.system(size: size, weight: .bold, design: .rounded))
        .foregroundStyle(ph == .up || ph == .desk || ph == .claimed ? accent(ph) : .white)
        .lineLimit(1)
    }
  }
}

/* The floor tab's clock, on the card: a live count that needs no push to move,
   with the word for what it is counting under it. */
private struct Clock: View {
  let from: Date
  let label: String
  var tint: Color = .white
  var body: some View {
    VStack(alignment: .trailing, spacing: 3) {
      /* Text(_, style: .timer) is WidgetKit's ticking clock, and it is the one
         thing on this card that never rendered on a phone: every phase that
         showed a clock — with a customer, at lunch, away — came up as a black
         card with nothing in it, and the one phase without a clock, "you're
         up", drew fine. ActivityKit has its own timer instead, and it is what
         Apple's own Live Activity samples use.

         The range is bounded rather than run to distantFuture. A visit is
         hours at the outside, and an unbounded interval is the other thing in
         this API that is documented to misbehave. */
      Text(timerInterval: from...from.addingTimeInterval(24 * 3600), countsDown: false)
        .font(.system(size: 16, weight: .bold, design: .monospaced))
        .monospacedDigit()
        .foregroundStyle(tint)
        .lineLimit(1)
        /* A ticking timer reserves the width of its WIDEST value so the digits
           do not jitter as they change, and then draws the current value
           inside that box. At three seconds into a visit that box is sized for
           hours and "0:03" sat in the middle of it, which is why the clock
           read as centred on the card rather than sitting at the right edge
           with everything else. Pushed to the trailing edge of its own box,
           and allowed to shrink rather than clip once a visit does run past an
           hour and the hours digit arrives. */
        .minimumScaleFactor(0.7)
        .frame(maxWidth: .infinity, alignment: .trailing)
      Text(label)
        .font(.system(size: 7.5, weight: .bold, design: .monospaced))
        .tracking(1.1)
        .foregroundStyle(.white.opacity(0.42))
        .lineLimit(1)
        /* Allowed to give way. It is a label on a number, and the headline
           beside it is a sentence somebody has to read. */
        .layoutPriority(-1)
    }
    /* Wide enough for a visit's minutes and seconds, which is what this shows
       for all but the longest of them. */
    .frame(width: 64, alignment: .trailing)
  }
}

/* Which clock a phase shows, if any. */
private func clockFor(_ s: QueueAttributes.ContentState, _ ph: Phase) -> (Date, String, Color)? {
  switch ph {
  case .customer, .confirm:
    return parseISO(s.since).map { ($0, "with them", Color.white) }
  case .asking:
    return parseISO(s.askAt ?? s.since).map { ($0, "since asked", s.ask == "to" ? red : fly) }
  case .claimed:
    return parseISO(s.askAt).map { ($0, "since claimed", mint) }
  case .desk:
    return parseISO(s.since).map { ($0, "since asked", red) }
  case .off:
    return parseISO(s.since).map { ($0, "since you left", Color.white) }
  case .waiting, .next:
    return parseISO(s.since).map { ($0, "waiting", Color.white) }
  default: return nil
  }
}

// MARK: - pieces

private struct BigGlyph: View {
  let s: QueueAttributes.ContentState
  let ph: Phase
  var body: some View {
    Group {
      switch ph {
      case .up: PixGlyph(name: "arrowup", size: 30, color: mint)
      case .desk: PixGlyph(name: "warn", size: 30, color: red)
      case .customer: PixGlyph(name: "user", size: 30, color: fly)
      case .off: PixGlyph(name: s.status == "lunch" ? "lunch" : "away", size: 30, color: mist)
      case .gone: PixGlyph(name: "door", size: 30, color: mist)
      default:
        Text("\(s.ahead)")
          .font(.system(size: 32, weight: .heavy, design: .rounded))
          .monospacedDigit()
          .foregroundStyle(sand)
      }
    }
    .frame(width: 48)
  }
}

/// The rail: from the left edge toward the door on the right, everybody in
/// their colour, you lit sand (mint when up).
private struct Rail: View {
  let line: [QueueAttributes.Pip]
  let up: Bool
  var body: some View {
    GeometryReader { geo in
      let w = geo.size.width
      ZStack(alignment: .leading) {
        RoundedRectangle(cornerRadius: 15).fill(Color.white.opacity(up ? 0.1 : 0.07))
        ForEach(Array(line.enumerated()), id: \.offset) { (i, p) in
          // The door is the right-hand end of the rail and the front of the line
          // sits on it; everyone behind steps left in fixed strides. You are the
          // big one, wherever you stand, so the glance finds you first.
          let x = max(14, w - 17 - Double(i) * 25)
          let you = p.me
          let size: CGFloat = you ? 30 : (i == 0 ? 24 : 20)
          ZStack {
            Circle().fill(you ? (up ? mint : sand) : Color(hue: Double(p.h) / 360, saturation: 0.62, brightness: 0.62))
            if i == 0 { Circle().stroke(Color.white.opacity(0.35), lineWidth: 2) }
            Text(p.i)
              .font(.system(size: you ? 10 : (i == 0 ? 8 : 7), weight: .bold, design: .monospaced))
              .foregroundStyle(you ? inkDeep : .white)
          }
          .frame(width: size, height: size)
          .opacity(p.s == "w" || you ? 1 : 0.45)
          .shadow(color: you ? (up ? mint : sand).opacity(0.9) : .clear, radius: you ? 6 : 0)
          .position(x: x, y: geo.size.height / 2)
        }
      }
    }
    .frame(height: 34)
  }
}

private struct ActionButton: View {
  let label: String
  let glyph: String
  let action: String
  var tint: Color = .white
  var fill: Color = Color.white.opacity(0.10)
  var stroke: Color = Color.white.opacity(0.14)
  var body: some View {
    if #available(iOS 17.0, *) {
      Button(intent: QueueActionIntent(action: action)) { inner }
        .buttonStyle(.plain)
    } else {
      inner
    }
  }
  private var inner: some View {
    HStack(spacing: 6) {
      PixGlyph(name: glyph, size: 12, color: tint)
      Text(label).font(.system(size: 12.5, weight: .bold)).foregroundStyle(tint)
    }
    .frame(maxWidth: .infinity, minHeight: 36)
    .background(RoundedRectangle(cornerRadius: 12).fill(fill))
    .overlay(RoundedRectangle(cornerRadius: 12).stroke(stroke, lineWidth: 1))
  }
}

private struct Buttons: View {
  let ph: Phase
  let s: QueueAttributes.ContentState
  var body: some View {
    HStack(spacing: 8) {
      switch ph {
      case .waiting, .next:
        ActionButton(label: "Lunch", glyph: "lunch", action: "lunch")
        ActionButton(label: "Away", glyph: "away", action: "away")
      case .up:
        ActionButton(label: "Got them", glyph: "check", action: "take", tint: inkDeep, fill: mint, stroke: mint)
        ActionButton(label: "Pass", glyph: "arrow", action: "pass", tint: Color.white.opacity(0.7)).frame(width: 84)
      case .customer:
        ActionButton(label: "FlyBy", glyph: "fly", action: "fly", tint: fly, fill: fly.opacity(0.2), stroke: fly)
        ActionButton(label: "T.O.", glyph: "to", action: "to", tint: red, fill: Color(red: 216/255, green: 72/255, blue: 60/255).opacity(0.22), stroke: red)
        /* Ending the visit sits beside the two help buttons, so it asks first
           rather than acting on a thumb that landed one target over. */
        ActionButton(label: "They left", glyph: "check", action: "ask-done", tint: Color.white.opacity(0.7)).frame(width: 92)
      case .asking:
        ActionButton(label: "Never mind", glyph: "arrow", action: "cancel", tint: Color.white.opacity(0.7))
        ActionButton(label: "They left", glyph: "check", action: "ask-done", tint: Color.white.opacity(0.7))
      case .claimed:
        ActionButton(label: "They left", glyph: "check", action: "ask-done", tint: Color.white.opacity(0.7))
      case .confirm:
        ActionButton(label: "Yes, they left", glyph: "check", action: "done", tint: inkDeep, fill: mint, stroke: mint)
        ActionButton(label: "Not yet", glyph: "arrow", action: "keep", tint: Color.white.opacity(0.7)).frame(width: 84)
      case .desk:
        ActionButton(label: "On my way", glyph: "arrowup", action: "ack", tint: .white,
                     fill: Color(red: 216/255, green: 72/255, blue: 60/255), stroke: Color(red: 216/255, green: 72/255, blue: 60/255))
        /* The honest second answer. The desk would rather send somebody else
           than stand there wondering. */
        ActionButton(label: "With a guest", glyph: "user", action: "with-guest", tint: Color.white.opacity(0.7)).frame(width: 104)
      case .off:
        // Away now means on the floor without taking a turn, so the way back is
        // back into the LINE; lunch is the one you come back to the floor from.
        ActionButton(label: s.status == "lunch" ? "Back on the floor" : "Back in line", glyph: "door", action: "back", tint: inkDeep, fill: mint, stroke: mint)
      case .gone:
        EmptyView()
      }
    }
  }
}

/* The pill has room for one fact, so each phase says the one that matters. */
private func compactWord(_ s: QueueAttributes.ContentState, _ ph: Phase) -> String {
  switch ph {
  case .up: return "Up"
  case .desk: return "Desk"
  case .asking: return s.ask == "to" ? "T.O." : "FlyBy"
  case .claimed: return "Coming"
  case .customer, .confirm: return "Guest"
  case .next: return "Next"
  case .off: return s.status == "lunch" ? "Lunch" : "Out"
  case .gone: return "·"
  case .waiting: return "\(s.ahead)"
  }
}
private func minimalWord(_ s: QueueAttributes.ContentState, _ ph: Phase) -> String {
  switch ph {
  case .up: return "↑"
  case .desk: return "!"
  case .asking, .claimed: return "?"
  case .customer, .confirm: return "●"
  case .waiting, .next: return "\(s.ahead)"
  default: return "·"
  }
}

// MARK: - the card

private struct LockScreen: View {
  let context: ActivityViewContext<QueueAttributes>
  var body: some View {
    let s = context.state
    let ph = phaseOf(s)
    let ac = accent(ph)
    /* The card is as tall as what is on it and no taller. It used to be laid
       out to fill the system's 160 points, which put a hole between the words
       and the buttons on every phase that did not need the room.

       A rail is 26 of those points, though, so the phases that have one came
       out comfortably taller than the phases that do not and the short ones
       read as squeezed. The answer is not to go back to pinning every card to
       160 — that is the hole again — it is to let the rows that ARE there sit
       further apart. */
    VStack(alignment: .leading, spacing: showsRail(s, ph) ? 10 : 13) {
      HStack(alignment: .center, spacing: 12) {
        BigGlyph(s: s, ph: ph)
        VStack(alignment: .leading, spacing: 3) {
          /* The headline is the sentence; the clock is a number beside it.
             Without a priority the two negotiated as equals and the sentence
             lost — the card read "With a custo…" and "Requesting Fl…", which
             is the one thing on here that has to be readable at a glance. */
          HeadlineText(s: s, ph: ph, size: ph == .up ? 22 : 17)
            .layoutPriority(2)
          if let cap = caption(s, ph) {
            Text(cap)
              .font(.system(size: 11.5, weight: ph == .customer || ph == .asking || ph == .confirm || ph == .desk ? .bold : .medium))
              .foregroundStyle(ph == .customer || ph == .asking || ph == .confirm ? fly : (ph == .desk ? red : mist))
              .lineLimit(1)
          }
        }
        Spacer(minLength: 6)
        if let (from, label, tint) = clockFor(s, ph) {
          Clock(from: from, label: label, tint: tint)
        }
      }
      if showsRail(s, ph), let line = s.line, !line.isEmpty {
        Rail(line: line, up: ph == .up)
      }
      if #available(iOS 17.0, *), ph != .gone {
        Buttons(ph: ph, s: s)
      }
    }
    .padding(.horizontal, 14)
    .padding(.vertical, showsRail(s, ph) ? 14 : 16)
    .opacity(ph == .gone ? 0.75 : 1)
    /* The accent bloom, over a ground that is nearly off. On an OLED lock
       screen those pixels are not lit at all, so the card stops being a grey
       rectangle laid on the screen and the sand, mint and amber emit.

       The ground is painted here rather than left to activityBackgroundTint
       alone. That modifier IS honoured — on a phone the card came up clearly
       darker than the notification beneath it — but the system composites the
       tint rather than filling with it, so a near-black asked for as a tint
       arrives as a dark grey-green and the palette loses the ground it was
       chosen against. A colour drawn inside the view is composited with
       nothing. The tint modifier stays, because it also paints the container's
       rounded edge, and dropping it would leave a lighter rim around a dark
       card. */
    .background(
      ZStack {
        ground
        RadialGradient(gradient: Gradient(colors: [ac.opacity(0.22), .clear]),
                       center: UnitPoint(x: 0.9, y: -0.12), startRadius: 4, endRadius: 300)
      }
    )
    /* One beat of the pressed button's colour, and the give underneath it.
       Both are driven by the state the intent writes before it calls the
       server, so they land under the thumb rather than after a round trip. */
    .overlay(
      RoundedRectangle(cornerRadius: 22, style: .continuous)
        .strokeBorder(pressTint(s.pressed), lineWidth: 3)
        .opacity(s.pressed == nil ? 0 : 1)
        .allowsHitTesting(false)
    )
    .scaleEffect(s.pressed == nil ? 1 : 0.985)
    .animation(.spring(response: 0.3, dampingFraction: 0.68), value: s.pressed)
    .activityBackgroundTint(ground)
    .activitySystemActionForegroundColor(sand)
  }
}

struct QueueLiveActivity: Widget {
  var body: some WidgetConfiguration {
    ActivityConfiguration(for: QueueAttributes.self) { context in
      LockScreen(context: context)
    } dynamicIsland: { context in
      let s = context.state
      let ph = phaseOf(s)
      let ac = accent(ph)
      return DynamicIsland {
        DynamicIslandExpandedRegion(.leading) {
          BigGlyph(s: s, ph: ph).padding(.leading, 6)
        }
        DynamicIslandExpandedRegion(.center) {
          VStack(alignment: .leading, spacing: 2) {
            HeadlineText(s: s, ph: ph, size: 16)
            if let cap = caption(s, ph) {
              Text(cap).font(.system(size: 11, weight: .medium)).foregroundStyle(mist).lineLimit(1)
            }
          }
        }
        DynamicIslandExpandedRegion(.bottom) {
          VStack(spacing: 8) {
            if showsRail(s, ph), let line = s.line, !line.isEmpty {
              Rail(line: line, up: ph == .up)
            }
            if #available(iOS 17.0, *), ph != .gone {
              Buttons(ph: ph, s: s)
            }
          }
        }
      } compactLeading: {
        switch ph {
        case .up: PixGlyph(name: "arrowup", size: 12, color: mint)
        case .desk: PixGlyph(name: "warn", size: 12, color: red)
        case .claimed: PixGlyph(name: "arrowup", size: 12, color: mint)
        case .asking: PixGlyph(name: "fly", size: 12, color: s.ask == "to" ? red : fly)
        case .customer, .confirm: PixGlyph(name: "user", size: 12, color: fly)
        default: Text("⋯").foregroundStyle(sand)
        }
      } compactTrailing: {
        Text(compactWord(s, ph))
          .font(.system(size: 12, weight: .bold, design: .rounded))
          .monospacedDigit()
          .foregroundStyle(ac)
      } minimal: {
        Text(minimalWord(s, ph))
          .font(.system(size: 12, weight: .bold, design: .rounded))
          .foregroundStyle(ac)
      }
      .keylineTint(ac)
    }
  }
}

@main
struct SageQueueBundle: WidgetBundle {
  var body: some Widget {
    QueueLiveActivity()
  }
}
