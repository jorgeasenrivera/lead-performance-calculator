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
/* The phone line's blue: the LED the room lights, and the two ends of the
   gradient you wear on the cord. */
private let led = Color(red: 0x9D / 255, green: 0xC3 / 255, blue: 0xFF / 255)
private let blue1 = Color(red: 0x55 / 255, green: 0x66 / 255, blue: 0xF0 / 255)
private let blue2 = Color(red: 0x37 / 255, green: 0xB6 / 255, blue: 0xF0 / 255)

// MARK: - PixIcon: the site's 7x7 glyphs, as dots

private let PIX: [String: [String]] = [
  "check": ["0000000", "0000001", "0000011", "1000110", "1101100", "0111000", "0010000"],
  "warn": ["0001000", "0001000", "0011100", "0011100", "0111110", "0111110", "1111111"],
  "arrowup": ["0001000", "0011100", "0101010", "1001001", "0001000", "0001000", "0001000"],
  "arrow": ["0001000", "0000100", "0000010", "1111111", "0000010", "0000100", "0001000"],
  "door": ["1111111", "1000001", "1000001", "1000011", "1000011", "1000001", "1000001"],
  "user": ["0011100", "0011100", "0001000", "0111110", "1111111", "1111111", "1111111"],
  "lunch": ["1010011", "1010011", "1110011", "0100011", "0100010", "0100010", "0100010"],
  "away": ["1111100", "1000000", "1000100", "1000110", "1011111", "1000110", "1000100"],
  "fly": ["0001110", "0011100", "0111000", "1111111", "0001110", "0011100", "0111000"],
  "to": ["0001000", "0011100", "0111110", "0000000", "0111110", "0011100", "0001000"],
  "phone": ["0111110", "0100010", "0100010", "0100010", "0100010", "0100010", "0111110"],
]

struct PixGlyph: View {
  let name: String
  var size: CGFloat = 14
  var color: Color = .white
  var body: some View {
    let rows = PIX[name] ?? PIX["arrow"]!
    /* 7 by 7 now, the app's grid; dots 0.48 of a cell, as the site draws them */
    let n = rows.count
    let dot = size / Double(n) * 0.96
    let gap = (size - dot * Double(n)) / Double(n - 1)
    VStack(spacing: gap) {
      ForEach(0..<n, id: \.self) { r in
        HStack(spacing: gap) {
          ForEach(0..<n, id: \.self) { c in
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
  case "lunch", "away", "lunch-line", "away-line", "lunch-desk", "leave-desk": return mist
  case "take-desk", "pass-desk", "back-line": return blue2
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
        /* The light along the line, as the app runs it: dots in from the left
           edge as far as you. A Live Activity cannot loop them, so they rest
           where the app's light stops longest. */
        if let mine = line.firstIndex(where: { $0.me }) {
          let reach = max(14, w - Double(mine) * 25 - 17) - 20
          ForEach(Array(stride(from: 6.0, to: reach, by: 11.0)), id: \.self) { x in
            Circle()
              .fill((up ? mint : sand).opacity(0.55))
              .frame(width: 4, height: 4)
              .position(x: x, y: geo.size.height / 2)
          }
        }
        ForEach(Array(line.enumerated()), id: \.offset) { (i, p) in
          // The door is the right-hand end of the rail and the front of the line
          // sits on it; everyone behind steps left in fixed strides. You are the
          // big one, wherever you stand, so the glance finds you first.
          let you = p.me
          let size: CGFloat = you ? 30 : (i == 0 ? 24 : 20)
          // The head of the line sits at the end of the rail: its edge two points
          // short of the rounded cap, whatever size it is drawn at.
          let x = max(14, w - Double(size) / 2 - 2 - Double(i) * 25)
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
    if s.v == 2 {
      V2Card(s: s)
        .activityBackgroundTint(ground)
        .activitySystemActionForegroundColor(sand)
    } else {
      V1Card(s: s)
    }
  }
}

private struct V1Card: View {
  let s: QueueAttributes.ContentState
  var body: some View {
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
      /* v2: the island shows the lane that leads. The phone lane when it is
         hot, or when it is the only lane; the floor otherwise, drawn from the
         floor lane's own numbers as the v1 island always was. */
      let v2phone = s.v == 2 && s.phone != nil && (s.hot == "phone" || s.floor == nil)
      let fs = (s.v == 2 && s.floor != nil) ? floorState(s.floor!, from: s) : s
      let ph = phaseOf(fs)
      let ac = v2phone ? led : accent(ph)
      return DynamicIsland {
        DynamicIslandExpandedRegion(.leading) {
          if v2phone { PixGlyph(name: "phone", size: 22, color: led).padding(.leading, 6) }
          else if s.v == 2 { PixGlyph(name: "door", size: 22, color: accent(ph)).padding(.leading, 6) }
          else { BigGlyph(s: fs, ph: ph).padding(.leading, 6) }
        }
        DynamicIslandExpandedRegion(.center) {
          VStack(alignment: .leading, spacing: 2) {
            if v2phone, let p = s.phone {
              Text(phoneHeadline(p)).font(.system(size: 16, weight: .bold, design: .rounded)).foregroundStyle(p.state == "offer" ? led : .white).lineLimit(1)
              if let cap = phoneCaption(p) { Text(cap).font(.system(size: 11, weight: .medium)).foregroundStyle(mist).lineLimit(1) }
            } else {
              HeadlineText(s: fs, ph: ph, size: 16)
              if let cap = caption(fs, ph) {
                Text(cap).font(.system(size: 11, weight: .medium)).foregroundStyle(mist).lineLimit(1)
              }
            }
          }
        }
        DynamicIslandExpandedRegion(.bottom) {
          VStack(spacing: 8) {
            if v2phone, let p = s.phone {
              if let line = p.line, !line.isEmpty, p.state == "cord" || p.state == "free" { Cord(line: line, lit: false, mini: false) }
              if #available(iOS 17.0, *) { PhoneButtons(p: p) }
            } else {
              if showsRail(fs, ph), let line = fs.line, !line.isEmpty {
                Rail(line: line, up: ph == .up)
              }
              if #available(iOS 17.0, *), ph != .gone {
                Buttons(ph: ph, s: fs)
              }
            }
          }
        }
      } compactLeading: {
        if v2phone {
          PixGlyph(name: "phone", size: 12, color: led)
        } else {
          switch ph {
          case .up: PixGlyph(name: "arrowup", size: 12, color: mint)
          case .desk: PixGlyph(name: "warn", size: 12, color: red)
          case .claimed: PixGlyph(name: "arrowup", size: 12, color: mint)
          case .asking: PixGlyph(name: "fly", size: 12, color: fs.ask == "to" ? red : fly)
          case .customer, .confirm: PixGlyph(name: "user", size: 12, color: fly)
          default: Text("⋯").foregroundStyle(sand)
          }
        }
      } compactTrailing: {
        if v2phone, let p = s.phone {
          if p.state == "offer", let until = parseISO(p.until) {
            Text(timerInterval: Date()...max(Date(), until), countsDown: true)
              .font(.system(size: 12, weight: .bold, design: .monospaced)).monospacedDigit().foregroundStyle(led).frame(width: 40)
          } else {
            Text(phoneCompact(p)).font(.system(size: 12, weight: .bold, design: .rounded)).monospacedDigit().foregroundStyle(led)
          }
        } else {
          Text(compactWord(fs, ph))
            .font(.system(size: 12, weight: .bold, design: .rounded))
            .monospacedDigit()
            .foregroundStyle(ac)
        }
      } minimal: {
        Text(v2phone ? phoneMinimal(s.phone!) : minimalWord(fs, ph))
          .font(.system(size: 12, weight: .bold, design: .rounded))
          .foregroundStyle(ac)
      }
      .keylineTint(ac)
    }
  }
}

// MARK: - contract v2: the two lanes on one card

/* The floor lane as the v1 pieces read it: the same phases, headline, caption,
   clock and buttons, fed from the lane rather than the top level. The
   question before a visit ends and the pressed ring are card-local, so they
   come from the top level still. */
func floorState(_ f: QueueAttributes.FloorLane, from s: QueueAttributes.ContentState) -> QueueAttributes.ContentState {
  QueueAttributes.ContentState(
    ahead: f.ahead, up: f.status == "up", status: f.status == "up" ? "waiting" : f.status, label: s.label,
    line: f.line, nudge: f.nudge, table: f.table, since: f.since,
    ask: f.ask, askAt: f.askAt, askBy: f.askBy, askedBy: s.askedBy, place: s.place,
    confirm: s.confirm, pressed: s.pressed, v: nil, hot: nil, floor: nil, phone: nil)
}

/* What the phone lane says, in the words the room screen uses. */
func phoneHeadline(_ p: QueueAttributes.PhoneLane) -> String {
  switch p.state {
  case "offer": return "Desk \(p.desk ?? "") is yours"
  case "desk": return "At desk \(p.desk ?? "")"
  case "free":
    let f = p.free ?? []
    return f.isEmpty ? "A desk is free" : "Desk \(f[0]) is free"
  case "off": return p.status == "lunch" ? "At lunch" : "Out of the line"
  default:
    let n = p.ahead ?? 0
    return n == 0 ? "You're next for a desk" : "\(n) ahead for a desk"
  }
}
func phoneCaption(_ p: QueueAttributes.PhoneLane) -> String? {
  switch p.state {
  case "free":
    let f = p.free ?? []
    return f.count > 1 ? "\(f.joined(separator: " and ")) are open" : nil
  case "off": return "Back in line when you're ready"
  case "cord": return (p.ahead ?? 0) == 0 ? "The first desk to free is yours" : nil
  default: return nil
  }
}
func phoneCompact(_ p: QueueAttributes.PhoneLane) -> String {
  switch p.state {
  case "desk": return "desk \(p.desk ?? "")"
  case "free": return "\((p.free ?? []).count) free"
  case "off": return p.status == "lunch" ? "Lunch" : "Out"
  default: return (p.ahead ?? 0) == 0 ? "next" : "\(p.ahead ?? 0)"
  }
}
func phoneMinimal(_ p: QueueAttributes.PhoneLane) -> String {
  switch p.state {
  case "offer": return "!"
  case "desk": return p.desk ?? "●"
  case "free": return "○"
  case "off": return "·"
  default: return "\(p.ahead ?? 0)"
  }
}

/* The phone lane's clock: the offer counts down to `until`; the rest count
   up from when the standing changed. */
private struct PhoneClock: View {
  let p: QueueAttributes.PhoneLane
  var small: Bool = false
  var body: some View {
    if p.state == "offer", let until = parseISO(p.until) {
      VStack(alignment: .trailing, spacing: 3) {
        Text(timerInterval: Date()...max(Date(), until), countsDown: true)
          .font(.system(size: small ? 14 : 16, weight: .bold, design: .monospaced)).monospacedDigit()
          .foregroundStyle(led).lineLimit(1).minimumScaleFactor(0.7).frame(maxWidth: .infinity, alignment: .trailing)
        Text("to take it").font(.system(size: 7.5, weight: .bold, design: .monospaced)).tracking(1.1)
          .foregroundStyle(.white.opacity(0.42)).lineLimit(1).layoutPriority(-1)
      }.frame(width: 64, alignment: .trailing)
    } else if let from = parseISO(p.since) {
      let label = p.state == "desk" ? "at the desk" : p.state == "off" ? "since you left" : "waiting"
      Clock(from: from, label: label, tint: .white)
    }
  }
}

/* A rail shape that begins off the card's left edge: flat on the left, the
   floor tab's rounded cap on the right. */
private struct HalfCapsule: Shape {
  func path(in r: CGRect) -> Path {
    let rad = r.height / 2
    var p = Path()
    p.move(to: CGPoint(x: r.minX, y: r.minY))
    p.addLine(to: CGPoint(x: r.maxX - rad, y: r.minY))
    p.addArc(center: CGPoint(x: r.maxX - rad, y: r.midY), radius: rad, startAngle: .degrees(-90), endAngle: .degrees(90), clockwise: false)
    p.addLine(to: CGPoint(x: r.minX, y: r.maxY))
    p.closeSubpath()
    return p
  }
}

/* The floor's track, v2: in from the left edge, the head at the rounded end,
   you the big lit one, the light resting as dots from the edge as far as you.
   `mini` is the small lane's size. */
private struct Track: View {
  let line: [QueueAttributes.Pip]
  let up: Bool
  var mini: Bool = false
  var body: some View {
    GeometryReader { geo in
      let w = geo.size.width
      let stride: Double = mini ? 18 : 25
      ZStack(alignment: .leading) {
        HalfCapsule().fill(Color.white.opacity(up ? 0.1 : 0.07))
        if let mine = line.firstIndex(where: { $0.me }) {
          let reach = max(14, w - Double(mine) * stride - 17) - 20
          ForEach(Array(Swift.stride(from: 6.0, to: reach, by: mini ? 9.0 : 11.0)), id: \.self) { x in
            Circle().fill((up ? mint : sand).opacity(0.55))
              .frame(width: mini ? 3 : 4, height: mini ? 3 : 4)
              .position(x: x, y: geo.size.height / 2)
          }
        }
        ForEach(Array(line.enumerated()), id: \.offset) { (i, p) in
          let you = p.me
          let size: CGFloat = mini ? (you ? 21 : (i == 0 ? 17 : 14)) : (you ? 30 : (i == 0 ? 24 : 20))
          let x = max(14, w - Double(size) / 2 - 2 - Double(i) * stride)
          ZStack {
            Circle().fill(you ? (up ? mint : sand) : Color(hue: Double(p.h) / 360, saturation: 0.62, brightness: 0.62))
            if i == 0 { Circle().stroke(Color.white.opacity(0.35), lineWidth: 2) }
            Text(p.i)
              .font(.system(size: mini ? (you ? 7 : 6) : (you ? 10 : (i == 0 ? 8 : 7)), weight: .bold, design: .monospaced))
              .foregroundStyle(you ? inkDeep : .white)
          }
          .frame(width: size, height: size)
          .opacity(p.s == "w" || you ? 1 : 0.45)
          .shadow(color: you ? (up ? mint : sand).opacity(0.9) : .clear, radius: you ? 6 : 0)
          .position(x: x, y: geo.size.height / 2)
        }
      }
    }
    .frame(height: mini ? 24 : 34)
  }
}

/* The room's cord, on the card: the same curve, in from the left edge and
   running to the handset on the right. Everybody on it in sand, you in the
   line's blue with the position in dots, the light from the tail as far as
   you, and all of it to a lit handset once the desk is yours. */
private struct Cord: View {
  let line: [QueueAttributes.Pip]
  let lit: Bool
  var mini: Bool = false
  /* the draft's curve, in a 348 by 52 box; scaled to the lane */
  private let p0 = CGPoint(x: -6, y: 40), p1 = CGPoint(x: 96, y: 66), p2 = CGPoint(x: 196, y: -14), p3 = CGPoint(x: 314, y: 26)
  private let flat0 = CGPoint(x: -6, y: 30), flat1 = CGPoint(x: 96, y: 48), flat2 = CGPoint(x: 196, y: -6), flat3 = CGPoint(x: 314, y: 19)
  private func pt(_ t: Double, _ a: CGPoint, _ b: CGPoint, _ c: CGPoint, _ d: CGPoint, sx: Double, sy: Double) -> CGPoint {
    let u = 1 - t
    let x = u*u*u*a.x + 3*u*u*t*b.x + 3*u*t*t*c.x + t*t*t*d.x
    let y = u*u*u*a.y + 3*u*u*t*b.y + 3*u*t*t*c.y + t*t*t*d.y
    return CGPoint(x: x * sx, y: y * sy)
  }
  var body: some View {
    let boxH: Double = mini ? 38 : 52
    GeometryReader { geo in
      let sx = geo.size.width / 348, sy = geo.size.height / boxH
      let a = mini ? flat0 : p0, b = mini ? flat1 : p1, c = mini ? flat2 : p2, d = mini ? flat3 : p3
      let curve = Path { path in
        path.move(to: CGPoint(x: a.x * sx, y: a.y * sy))
        path.addCurve(to: CGPoint(x: d.x * sx, y: d.y * sy), control1: CGPoint(x: b.x * sx, y: b.y * sy), control2: CGPoint(x: c.x * sx, y: c.y * sy))
      }
      let me = line.firstIndex(where: { $0.me })
      let tOf: (Int) -> Double = { i in max(0.04, 0.93 - Double(i) * 0.2) }
      let litTo: Double = lit ? 1 : (me.map { tOf($0) } ?? 0)
      ZStack(alignment: .topLeading) {
        curve.stroke(Color(red: 157/255, green: 195/255, blue: 1).opacity(0.24), style: StrokeStyle(lineWidth: 3, lineCap: .round))
        curve.trimmedPath(from: 0, to: litTo).stroke(led.opacity(0.28), style: StrokeStyle(lineWidth: 9, lineCap: .round))
        curve.trimmedPath(from: 0, to: litTo).stroke(led, style: StrokeStyle(lineWidth: 3, lineCap: .round))
        ForEach(Array(line.enumerated()), id: \.offset) { (i, p) in
          let you = p.me
          let size: CGFloat = mini ? (you ? 24 : 18) : (you ? 30 : 22)
          let at = pt(tOf(i), a, b, c, d, sx: sx, sy: sy)
          ZStack {
            if you {
              Circle().fill(LinearGradient(colors: [blue1, blue2], startPoint: .topLeading, endPoint: .bottomTrailing))
            } else {
              Circle().fill(sand)
            }
            Text(p.i)
              .font(.system(size: mini ? (you ? 8 : 6.5) : (you ? 9.5 : 7.5), weight: .bold, design: .monospaced))
              .foregroundStyle(you ? .white : Color(red: 0x1F/255, green: 0x2A/255, blue: 0x22/255))
          }
          .frame(width: size, height: size)
          .shadow(color: you ? blue1.opacity(0.6) : sand.opacity(0.35), radius: you ? 9 : 6)
          .position(at)
        }
        /* the handset, at the end of the cord */
        PixGlyph(name: "phone", size: mini ? 26 : 34, color: lit ? led : Color(red: 157/255, green: 195/255, blue: 1).opacity(0.28))
          .shadow(color: lit ? led.opacity(0.8) : .clear, radius: lit ? 8 : 0)
          .position(x: geo.size.width - (mini ? 13 : 17), y: geo.size.height / 2)
      }
    }
    .frame(height: boxH)
  }
}

/* The desks, in one row: who is at each, which is free, which is yours. */
private struct DeskRow: View {
  let desks: [QueueAttributes.Desk]
  var body: some View {
    HStack(spacing: 4) {
      ForEach(Array(desks.enumerated()), id: \.offset) { (_, d) in
        Text(d.n)
          .font(.system(size: 9, weight: .semibold, design: .monospaced))
          .foregroundStyle(d.mine ? Color(red: 0x0B/255, green: 0x14/255, blue: 0x30/255) : d.open ? Color(red: 0x0B/255, green: 0x14/255, blue: 0x30/255) : .white.opacity(0.42))
          .frame(maxWidth: .infinity, minHeight: 20)
          .background(RoundedRectangle(cornerRadius: 6).fill(d.mine ? Color.white : d.open ? led : Color.white.opacity(0.07)))
      }
    }
  }
}

/* The phone lane's buttons, one row per life. Only Take it from an offer:
   passing wants a reason, and a lock screen cannot ask why. */
private struct PhoneButtons: View {
  let p: QueueAttributes.PhoneLane
  var body: some View {
    HStack(spacing: 8) {
      switch p.state {
      case "offer":
        ActionButton(label: "Take it", glyph: "check", action: "take-desk", tint: .white, fill: blue1, stroke: blue2)
      case "desk":
        ActionButton(label: "Lunch", glyph: "lunch", action: "lunch-desk")
        ActionButton(label: "Leave the desk", glyph: "door", action: "leave-desk")
      case "off":
        ActionButton(label: "Back in line", glyph: "phone", action: "back-line", tint: inkDeep, fill: mint, stroke: mint)
      default:
        ActionButton(label: "Lunch", glyph: "lunch", action: "lunch-line")
        ActionButton(label: "Away", glyph: "away", action: "away-line")
      }
    }
  }
}

/* The accent bloom, in the lane's own corner: green on the floor, the line's
   blue on the phone. */
private func bloom(_ c: Color, top: Bool) -> some View {
  RadialGradient(gradient: Gradient(colors: [c.opacity(top ? 0.22 : 0.2), .clear]),
                 center: UnitPoint(x: 0.9, y: top ? -0.12 : 0), startRadius: 4, endRadius: top ? 300 : 260)
}

private struct PhoneLaneView: View {
  let p: QueueAttributes.PhoneLane
  let big: Bool
  let top: Bool
  var body: some View {
    let hot = p.state == "offer"
    VStack(alignment: .leading, spacing: 10) {
      HStack(alignment: .center, spacing: 12) {
        VStack(alignment: .leading, spacing: 3) {
          Text(phoneHeadline(p))
            .font(.system(size: big ? (hot ? 22 : 17) : 15, weight: .bold, design: .rounded))
            .foregroundStyle(hot ? led : .white).lineLimit(1).layoutPriority(2)
          if let cap = phoneCaption(p) {
            Text(cap).font(.system(size: big ? 11.5 : 11, weight: .medium)).foregroundStyle(mist).lineLimit(1)
          }
        }
        Spacer(minLength: 6)
        PhoneClock(p: p, small: !big)
      }
      if let line = p.line, !line.isEmpty, p.state == "cord" || p.state == "free" || p.state == "offer" {
        Cord(line: line, lit: hot, mini: !big).padding(.leading, -14)
      }
      if let desks = p.desks, !desks.isEmpty, p.state == "desk" || p.state == "offer" || p.state == "free" {
        DeskRow(desks: desks)
      }
      if #available(iOS 17.0, *), big {
        PhoneButtons(p: p)
      }
    }
    .padding(.horizontal, 14)
    .padding(.top, top ? 14 : 10)
    .padding(.bottom, 14)
    .background(bloom(led, top: top))
  }
}

private struct FloorLaneView: View {
  let s: QueueAttributes.ContentState      // the floor lane, as floorState() reads it
  let big: Bool
  let top: Bool
  var body: some View {
    let ph = phaseOf(s)
    VStack(alignment: .leading, spacing: 10) {
      HStack(alignment: .center, spacing: 12) {
        VStack(alignment: .leading, spacing: 3) {
          HeadlineText(s: s, ph: ph, size: big ? (ph == .up ? 22 : 17) : 15).layoutPriority(2)
          if let cap = caption(s, ph) {
            Text(cap)
              .font(.system(size: big ? 11.5 : 11, weight: ph == .customer || ph == .asking || ph == .confirm || ph == .desk ? .bold : .medium))
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
        Track(line: line, up: ph == .up, mini: !big).padding(.leading, -14)
      }
      if #available(iOS 17.0, *), big, ph != .gone {
        Buttons(ph: ph, s: s)
      }
    }
    .padding(.horizontal, 14)
    .padding(.top, top ? 14 : 10)
    .padding(.bottom, 14)
    .background(bloom(ph == .up ? mint : (ph == .desk ? red : (ph == .customer || ph == .asking || ph == .confirm ? fly : mint)), top: top))
  }
}

/* The card, v2: the lane that leads big, the other small beneath it; both
   small when neither is urgent; one lane on its own when they are only on
   one line. */
private struct V2Card: View {
  let s: QueueAttributes.ContentState
  var body: some View {
    let f = s.floor.map { floorState($0, from: s) }
    let p = s.phone
    let both = f != nil && p != nil
    let hot = s.hot
    VStack(spacing: 0) {
      if both, let f = f, let p = p {
        if hot == "phone" {
          PhoneLaneView(p: p, big: true, top: true)
          Divider().overlay(Color.white.opacity(0.07))
          FloorLaneView(s: f, big: false, top: false)
        } else if hot == "floor" {
          FloorLaneView(s: f, big: true, top: true)
          Divider().overlay(Color.white.opacity(0.07))
          PhoneLaneView(p: p, big: false, top: false)
        } else {
          FloorLaneView(s: f, big: false, top: true)
          Divider().overlay(Color.white.opacity(0.07))
          PhoneLaneView(p: p, big: false, top: false)
        }
      } else if let p = p {
        PhoneLaneView(p: p, big: true, top: true)
      } else if let f = f {
        FloorLaneView(s: f, big: true, top: true)
      } else {
        Text("Off the line").font(.system(size: 17, weight: .bold, design: .rounded)).foregroundStyle(mist).padding(16)
      }
    }
    .background(ground)
    .overlay(
      RoundedRectangle(cornerRadius: 22, style: .continuous)
        .strokeBorder(pressTint(s.pressed), lineWidth: 3)
        .opacity(s.pressed == nil ? 0 : 1)
        .allowsHitTesting(false)
    )
    .scaleEffect(s.pressed == nil ? 1 : 0.985)
    .animation(.spring(response: 0.3, dampingFraction: 0.68), value: s.pressed)
  }
}

@main
struct SageQueueBundle: WidgetBundle {
  var body: some Widget {
    QueueLiveActivity()
  }
}
