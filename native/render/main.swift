/* The entry of the render binary, and nothing else: see the RENDER block at
   the foot of ../targets/queue/QueueActivity.swift. Compiled only by the
   workflow, and kept outside targets/ so the widget build never sees it.
   Named main.swift because Swift allows top-level code in no other file: the
   first run said so, three times. */
import Foundation
import UIKit

/* The share of pixels, in whole percent, that are not the card's ground
   (5, 8, 6), read back from the PNG just written. */
func inkShare(atPath path: String) -> Int {
  guard let img = UIImage(contentsOfFile: path), let cg = img.cgImage,
        let data = cg.dataProvider?.data, let ptr = CFDataGetBytePtr(data) else { return -1 }
  let bpp = cg.bitsPerPixel / 8, row = cg.bytesPerRow
  var ink = 0, all = 0
  for y in stride(from: 0, to: cg.height, by: 3) {
    for x in stride(from: 0, to: cg.width, by: 3) {
      let i = y * row + x * bpp
      let r = Int(ptr[i]), g = Int(ptr[i + 1]), b = Int(ptr[i + 2])
      all += 1
      if abs(r - 5) + abs(g - 8) + abs(b - 6) > 24 { ink += 1 }
    }
  }
  return all == 0 ? -1 : (ink * 100) / all
}

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
      /* How much of the picture is not the ground: a blank card would say
         0%, so a run that drew nothing cannot pass as a run that drew. */
      let ink = inkShare(atPath: out + "/" + name + ".png")
      print("\(name.padding(toLength: 22, withPad: " ", startingAt: 0)) \(Int(size.width.rounded())) x \(h) pt   ink \(ink)%\(flag)")
    }
    print(over == 0 ? "every card within 160 pt" : "\(over) card(s) over 160 pt")
    exit(0)
  } catch {
    fputs("render: \(error)\n", stderr)
    exit(1)
  }
}
RunLoop.main.run()
