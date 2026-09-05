import ActivityKit
import SwiftUI
import WidgetKit

/* The line, on the lock screen.
   -------------------------------------------------------------------------
   Drawn in the app's own colours: ink ground, sand for the number, mint for
   "you're up". The whole thing is the number of people ahead, because that is
   the only thing a salesperson checks a locked phone for. */

private let ink = Color(red: 0x15 / 255, green: 0x21 / 255, blue: 0x1B / 255)
private let sand = Color(red: 0xE4 / 255, green: 0xC9 / 255, blue: 0x8D / 255)
private let mint = Color(red: 0x8F / 255, green: 0xD8 / 255, blue: 0xAF / 255)
private let mist = Color.white.opacity(0.62)

private func headline(_ s: QueueAttributes.ContentState) -> String {
  if s.up { return "You're up" }
  switch s.status {
  case "customer": return "With a customer"
  case "lunch": return "At lunch"
  case "away": return "Away"
  case "gone": return "Off the line"
  default: return s.ahead == 0 ? "You're next" : "\(s.ahead) ahead of you"
  }
}

private func caption(_ s: QueueAttributes.ContentState) -> String {
  if s.up { return "Head to the door. The next one is yours." }
  if s.status == "waiting" { return "In the line" }
  return "Off the line for now"
}

private struct BigNumber: View {
  let s: QueueAttributes.ContentState
  var body: some View {
    if s.up {
      Image(systemName: "arrow.up.right.circle.fill")
        .font(.system(size: 30, weight: .bold))
        .foregroundStyle(mint)
    } else {
      Text(s.status == "waiting" ? "\(s.ahead)" : "·")
        .font(.system(size: 34, weight: .heavy, design: .rounded))
        .monospacedDigit()
        .foregroundStyle(s.status == "waiting" ? sand : mist)
    }
  }
}

private struct LockScreen: View {
  let context: ActivityViewContext<QueueAttributes>
  var body: some View {
    let s = context.state
    HStack(spacing: 14) {
      BigNumber(s: s)
        .frame(width: 54)
      VStack(alignment: .leading, spacing: 3) {
        Text(headline(s))
          .font(.system(size: 18, weight: .bold, design: .rounded))
          .foregroundStyle(s.up ? mint : .white)
        Text(caption(s))
          .font(.system(size: 12, weight: .medium))
          .foregroundStyle(mist)
        Text(context.attributes.kind == "queue" ? "UP NEXT" : "THE FLOOR")
          .font(.system(size: 9, weight: .bold, design: .monospaced))
          .tracking(1.6)
          .foregroundStyle(sand.opacity(0.85))
          .padding(.top, 2)
      }
      Spacer(minLength: 0)
    }
    .padding(16)
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
      return DynamicIsland {
        DynamicIslandExpandedRegion(.leading) {
          BigNumber(s: s).frame(width: 54).padding(.leading, 6)
        }
        DynamicIslandExpandedRegion(.center) {
          VStack(alignment: .leading, spacing: 2) {
            Text(headline(s))
              .font(.system(size: 16, weight: .bold, design: .rounded))
              .foregroundStyle(s.up ? mint : .white)
            Text(caption(s))
              .font(.system(size: 11, weight: .medium))
              .foregroundStyle(mist)
          }
        }
        DynamicIslandExpandedRegion(.bottom) {
          Text(context.attributes.kind == "queue" ? "UP NEXT" : "THE FLOOR")
            .font(.system(size: 9, weight: .bold, design: .monospaced))
            .tracking(1.6)
            .foregroundStyle(sand.opacity(0.85))
        }
      } compactLeading: {
        Image(systemName: s.up ? "arrow.up.right.circle.fill" : "person.2.fill")
          .foregroundStyle(s.up ? mint : sand)
      } compactTrailing: {
        Text(s.up ? "UP" : (s.status == "waiting" ? "\(s.ahead)" : "·"))
          .font(.system(size: 13, weight: .bold, design: .rounded))
          .monospacedDigit()
          .foregroundStyle(s.up ? mint : sand)
      } minimal: {
        Text(s.up ? "↑" : (s.status == "waiting" ? "\(s.ahead)" : "·"))
          .font(.system(size: 12, weight: .bold, design: .rounded))
          .foregroundStyle(s.up ? mint : sand)
      }
      .keylineTint(sand)
    }
  }
}

@main
struct SageQueueBundle: WidgetBundle {
  var body: some Widget {
    QueueLiveActivity()
  }
}
