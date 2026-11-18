// Designed macOS/Darwin executable tests. Not an iOS device test or app target.
import Foundation
import Darwin

@main struct SwiftStoreProbe {
  enum ProbeError: Error { case expectedFailure, injected, assertion(String) }
  static let old = Data("{\"format\":1,\"revision\":0,\"records\":[]}".utf8)
  static let next = Data("{\"format\":1,\"revision\":1,\"records\":[]}".utf8)
  static func require(_ condition: Bool, _ note: String) throws { if !condition { throw ProbeError.assertion(note) } }
  static func fails(_ action: () throws -> Void) throws {
    do { try action() } catch { return }; throw ProbeError.expectedFailure
  }
  static func child(_ root: URL, _ mode: String) throws -> (Process, Pipe) {
    let p = Process(), output = Pipe()
    p.executableURL = URL(fileURLWithPath: CommandLine.arguments[0])
    p.arguments = [mode, root.path]; p.standardOutput = output
    try p.run()
    // Every mode, including a contender regressed to blocking acquisition, is bounded.
    DispatchQueue.global().asyncAfter(deadline: .now() + 10) {
      if p.isRunning { Darwin.kill(p.processIdentifier, SIGKILL) }
    }
    return (p, output)
  }
  static func main() throws {
    if CommandLine.arguments.count == 3 {
      let root = URL(fileURLWithPath: CommandLine.arguments[2])
      do {
        let mode = CommandLine.arguments[1]
        let owner = try SageIntentJournalStore.acquire(directory: root, checkpoint: { step in
          if (mode == "--crash-before" && step == .temporarySynced) || (mode == "--crash-after" && step == .renamed) {
            FileHandle.standardOutput.write(Data("LOCKED\n".utf8))
            while true { Darwin.pause() }
          }
        })
        if mode.hasPrefix("--crash-") { try owner.replace(next) }
        if CommandLine.arguments[1] == "--hold" {
          FileHandle.standardOutput.write(Data("LOCKED\n".utf8))
          withExtendedLifetime(owner) { while true { Darwin.pause() } }
        }
        try owner.close(); Darwin.exit(0)
      } catch SageJournalError.busy { Darwin.exit(2) }
    }
    let fm = FileManager.default
    let root = fm.temporaryDirectory.resolvingSymlinksInPath().appendingPathComponent("sage-journal-probe-" + UUID().uuidString)
    try fm.createDirectory(at: root, withIntermediateDirectories: false, attributes: [.posixPermissions: 0o700])
    defer { try? fm.removeItem(at: root) }
    let owner = try SageIntentJournalStore.acquire(directory: root)
    try require(try owner.read() == nil, "confirmed absence")
    try fails { _ = try SageIntentJournalStore.acquire(directory: root) }
    let (busy, _) = try child(root, "--probe"); busy.waitUntilExit()
    try require(busy.terminationStatus == 2, "cross-process contention")
    // A full-sync unsupported error FAILS this probe; it is not downgraded/skipped.
    try owner.replace(old)
    try require(try owner.read() == old, "round trip")
    try fails { try owner.replace(Data("{broken".utf8)) }
    try fails { try owner.replace(Data([0xC3, 0x28])) }
    try fails { try owner.replace(Data("{\"format\":1,\"revision\":0,\"records\":[{\"token\":\"synthetic\"}]}".utf8)) }
    let stale = root.appendingPathComponent("journal-stale.tmp")
    try Data("synthetic interrupted file".utf8).write(to: stale)
    try owner.close(); try owner.close()
    try fails { _ = try owner.read() }
    for step in [SageIntentJournalStore.Step.temporarySynced, .renamed] {
      let f = try SageIntentJournalStore.acquire(directory: root, checkpoint: { reached in
        if (reached == .temporarySynced && step == .temporarySynced) || (reached == .renamed && step == .renamed) { throw ProbeError.injected }
      })
      try fails { try f.replace(next) }
      try fails { _ = try f.read() }
      try f.close()
      let reopened = try SageIntentJournalStore.acquire(directory: root)
      try require(try reopened.read() == (step == .temporarySynced ? old : next), "failure stage visibility")
      try reopened.close()
    }
    try require(fm.fileExists(atPath: stale.path), "stale temporary must not be pruned")
    // Simulated syscall/write failure: removing directory write permission must
    // not be treated as an empty journal. Run as an ordinary non-root account.
    let denied = try SageIntentJournalStore.acquire(directory: root)
    try fm.setAttributes([.posixPermissions: 0o500], ofItemAtPath: root.path)
    do { try fails { try denied.replace(next) } }
    catch { try fm.setAttributes([.posixPermissions: 0o700], ofItemAtPath: root.path); throw error }
    try fm.setAttributes([.posixPermissions: 0o700], ofItemAtPath: root.path); try denied.close()
    let target = root.appendingPathComponent("journal.json")
    let inaccessible = try SageIntentJournalStore.acquire(directory: root)
    try fm.setAttributes([.posixPermissions: 0], ofItemAtPath: target.path)
    do { try fails { _ = try inaccessible.read() } }
    catch { try fm.setAttributes([.posixPermissions: 0o600], ofItemAtPath: target.path); throw error }
    try fm.setAttributes([.posixPermissions: 0o600], ofItemAtPath: target.path); try inaccessible.close()
    try Data("corrupt".utf8).write(to: target)
    let corrupt = try SageIntentJournalStore.acquire(directory: root)
    try fails { _ = try corrupt.read() }; try fails { try corrupt.replace(old) }; try corrupt.close()
    try require(try Data(contentsOf: target) == Data("corrupt".utf8), "corrupt bytes preserved")
    // Restore only our synthetic fixture outside the store, never product repair.
    try next.write(to: target)
    let (holder, pipe) = try child(root, "--hold")
    defer { if holder.isRunning { Darwin.kill(holder.processIdentifier, SIGKILL); holder.waitUntilExit() } }
    let signal = pipe.fileHandleForReading.readData(ofLength: 7)
    try require(signal == Data("LOCKED\n".utf8), "child acquired")
    try fails { _ = try SageIntentJournalStore.acquire(directory: root) }
    Darwin.kill(holder.processIdentifier, SIGKILL); holder.waitUntilExit()
    let recovered = try SageIntentJournalStore.acquire(directory: root)
    try require(try recovered.read() == next, "death releases lock; committed bytes retained")
    try recovered.close()
    for mode in ["--crash-before", "--crash-after"] {
      let reset = try SageIntentJournalStore.acquire(directory: root); try reset.replace(old); try reset.close()
      let (writer, output) = try child(root, mode)
      try require(output.fileHandleForReading.readData(ofLength: 7) == Data("LOCKED\n".utf8), "writer reached fault boundary")
      Darwin.kill(writer.processIdentifier, SIGKILL); writer.waitUntilExit()
      let reopened = try SageIntentJournalStore.acquire(directory: root)
      try require(try reopened.read() == (mode == "--crash-before" ? old : next), "process death at replacement boundary")
      try reopened.close()
    }
    let orphan = root.appendingPathComponent("orphan")
    try fm.createDirectory(at: orphan, withIntermediateDirectories: false)
    try old.write(to: orphan.appendingPathComponent("journal-stale.tmp"))
    let orphanOwner = try SageIntentJournalStore.acquire(directory: orphan)
    try fails { _ = try orphanOwner.read() }; try fails { try orphanOwner.replace(next) }; try orphanOwner.close()
    let moved = root.appendingPathExtension("moved")
    let displaced = try SageIntentJournalStore.acquire(directory: root)
    try fm.moveItem(at: root, to: moved)
    do { try fails { _ = try displaced.read() }; try displaced.close() }
    catch { try fm.moveItem(at: moved, to: root); throw error }
    try fm.moveItem(at: moved, to: root)
    print("PASS Darwin store probes; not iOS device or power-loss proof")
  }
}
