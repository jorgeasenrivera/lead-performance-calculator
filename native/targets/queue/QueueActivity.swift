import ActivityKit
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
     with customer  amber dot, since, table         FlyBy · T.O. · Done
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

enum Phase { case waiting, next, up, customer, desk, off, gone }

func phaseOf(_ s: QueueAttributes.ContentState) -> Phase {
  if s.nudge == true { return .desk }
  switch s.status {
  case "customer": return .customer
  case "lunch", "away": return .off
  case "gone": return .gone
  default:
    if s.up { return .up }
    return s.ahead == 0 ? .next : .waiting
  }
}

private func headline(_ s: QueueAttributes.ContentState, _ ph: Phase) -> String {
  switch ph {
  case .up: return "You're up"
  case .next: return "You're next"
  case .desk: return "The desk is asking for you"
  case .customer: return "With a customer"
  case .off: return s.status == "lunch" ? "At lunch" : "Away"
  case .gone: return "Off the line"
  case .waiting: return "\(s.ahead) ahead of you"
  }
}

private func caption(_ s: QueueAttributes.ContentState, _ ph: Phase) -> String? {
  switch ph {
  case .up: return nil
  case .next: return "Nobody waiting ahead of you"
  case .desk: return "Head back to the floor."
  case .customer: return s.table.map { $0.hasPrefix("O") ? "Office \($0.dropFirst())" : "Table \($0)" } ?? "On the floor"
  case .off: return "Off the line for now"
  case .gone: return "Signed out for the day"
  case .waiting: return "In the line"
  }
}

private func accent(_ ph: Phase) -> Color {
  switch ph {
  case .up: return mint
  case .desk: return red
  case .customer: return fly
  case .off, .gone: return mist
  default: return sand
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
          let x = max(0.06, 0.90 - Double(i) * 0.13) * w
          let you = p.me
          ZStack {
            Circle().fill(you ? (up ? mint : sand) : Color(hue: Double(p.h) / 360, saturation: 0.62, brightness: 0.62))
            if i == 0 { Circle().stroke(Color.white.opacity(0.35), lineWidth: 2) }
            Text(p.i)
              .font(.system(size: i == 0 ? 8 : 7, weight: .bold, design: .monospaced))
              .foregroundStyle(you ? inkDeep : .white)
          }
          .frame(width: i == 0 ? 26 : 20, height: i == 0 ? 26 : 20)
          .opacity(p.s == "w" || you ? 1 : 0.45)
          .shadow(color: you ? (up ? mint : sand).opacity(0.9) : .clear, radius: you ? 6 : 0)
          .position(x: x, y: geo.size.height / 2)
        }
      }
    }
    .frame(height: 30)
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
        ActionButton(label: "FlyBy", glyph: "fly", action: "fly", tint: fly, fill: fly.opacity(0.18), stroke: fly)
        ActionButton(label: "T.O.", glyph: "to", action: "to", tint: red, fill: Color(red: 216/255, green: 72/255, blue: 60/255).opacity(0.18), stroke: red)
        ActionButton(label: "Done", glyph: "check", action: "done", tint: Color.white.opacity(0.7)).frame(width: 84)
      case .desk:
        ActionButton(label: "On my way", glyph: "arrowup", action: "ack", tint: inkDeep, fill: sand, stroke: sand)
      case .off:
        ActionButton(label: "Back on the floor", glyph: "door", action: "back", tint: inkDeep, fill: mint, stroke: mint)
      case .gone:
        EmptyView()
      }
    }
  }
}

// MARK: - the card

private struct LockScreen: View {
  let context: ActivityViewContext<QueueAttributes>
  var body: some View {
    let s = context.state
    let ph = phaseOf(s)
    let ac = accent(ph)
    VStack(alignment: .leading, spacing: 10) {
      HStack(spacing: 12) {
        BigGlyph(s: s, ph: ph)
        VStack(alignment: .leading, spacing: 2) {
          Text(headline(s, ph))
            .font(.system(size: ph == .up ? 22 : 17, weight: .bold, design: .rounded))
            .foregroundStyle(ph == .up || ph == .desk ? ac : .white)
          if let cap = caption(s, ph) {
            Text(cap).font(.system(size: 11.5, weight: .medium)).foregroundStyle(mist)
          }
          if ph == .customer, let since = s.since, let d = ISO8601DateFormatter().date(from: since) {
            Text(d, style: .relative)
              .font(.system(size: 8.5, weight: .bold, design: .monospaced))
              .foregroundStyle(fly)
          }
        }
        Spacer(minLength: 0)
      }
      if ph != .customer && ph != .desk && ph != .gone, let line = s.line, !line.isEmpty {
        Rail(line: line, up: ph == .up)
      }
      if #available(iOS 17.0, *), ph != .gone {
        Buttons(ph: ph)
      }
    }
    .padding(14)
    .opacity(ph == .off || ph == .gone ? 0.75 : 1)
    .activityBackgroundTint(ink)
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
            Text(headline(s, ph))
              .font(.system(size: 16, weight: .bold, design: .rounded))
              .foregroundStyle(ph == .up || ph == .desk ? ac : .white)
            if let cap = caption(s, ph) {
              Text(cap).font(.system(size: 11, weight: .medium)).foregroundStyle(mist)
            }
          }
        }
        DynamicIslandExpandedRegion(.bottom) {
          VStack(spacing: 8) {
            if ph != .customer && ph != .desk && ph != .gone, let line = s.line, !line.isEmpty {
              Rail(line: line, up: ph == .up)
            }
            if #available(iOS 17.0, *), ph != .gone {
              Buttons(ph: ph)
            }
          }
        }
      } compactLeading: {
        switch ph {
        case .up: PixGlyph(name: "arrowup", size: 12, color: mint)
        case .desk: PixGlyph(name: "warn", size: 12, color: red)
        case .customer: PixGlyph(name: "user", size: 12, color: fly)
        default: Text("⋯").foregroundStyle(sand)
        }
      } compactTrailing: {
        Text(ph == .up ? "UP" : ph == .desk ? "DESK" : ph == .customer ? "CUST" : ph == .next ? "NEXT" : (s.status == "waiting" ? "\(s.ahead)" : "·"))
          .font(.system(size: 12, weight: .bold, design: .rounded))
          .monospacedDigit()
          .foregroundStyle(ac)
      } minimal: {
        Text(ph == .up ? "↑" : ph == .desk ? "!" : ph == .customer ? "●" : (s.status == "waiting" ? "\(s.ahead)" : "·"))
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
