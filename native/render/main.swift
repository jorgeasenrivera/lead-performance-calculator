/* The entry of the render binary, and nothing else: see the RENDER block at
   the foot of ../targets/queue/QueueActivity.swift. Compiled only by the
   workflow, and kept outside targets/ so the widget build never sees it.
   Named main.swift because Swift allows top-level code in no other file: the
   first run said so, three times. */
import Foundation

let out = CommandLine.arguments.count > 1 ? CommandLine.arguments[1] : "."
try? FileManager.default.createDirectory(atPath: out, withIntermediateDirectories: true)
Task { @MainActor in
  do {
    let sizes = try renderActivityStates(to: out)
    var over = 0
    for (name, size) in sizes {
      let h = Int(size.height.rounded())
      let flag = h > 160 ? "  OVER the 160 pt budget" : ""
      if h > 160 { over += 1 }
      print("\(name.padding(toLength: 22, withPad: " ", startingAt: 0)) \(Int(size.width.rounded())) x \(h) pt\(flag)")
    }
    print(over == 0 ? "every card within 160 pt" : "\(over) card(s) over 160 pt")
    exit(0)
  } catch {
    fputs("render: \(error)\n", stderr)
    exit(1)
  }
}
RunLoop.main.run()
