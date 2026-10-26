import Foundation
import CoreFoundation
import Darwin

// Storage-only, deliberately absent from the Expo module definition.
// The caller supplies a dedicated private directory, never session/preferences storage.
enum SageJournalError: Error {
  case busy, closed, invalidDirectory, invalidDocument
  case io(String, Int32)
}

final class SageIntentJournalStore {
  enum Step: Equatable { case temporarySynced, renamed }
  private static let registryLock = NSLock()
  private static var ownedDirectories = Set<String>()

  // Explicit ownership may span await boundaries. Retain this object until all
  // work completes, then close in defer. No lease timeout or lock stealing.
  final class Owner {
    private let gate = NSLock()
    private let directory: String
    private let identity: (dev_t, ino_t)
    private var lockFD: Int32
    private let checkpoint: (Step) throws -> Void
    private var poisoned = false

    fileprivate init(directory: String, identity: (dev_t, ino_t), lockFD: Int32, checkpoint: @escaping (Step) throws -> Void) {
      self.directory = directory
      self.identity = identity
      self.lockFD = lockFD
      self.checkpoint = checkpoint
    }

    func read() throws -> Data? {
      gate.lock(); defer { gate.unlock() }
      try requireOpen()
      return try readLocked()
    }

    func replace(_ bytes: Data) throws {
      // Snapshot value and validate before changing any files.
      try SageIntentJournalStore.validate(bytes)
      gate.lock(); defer { gate.unlock() }
      try requireOpen()
      // Never overwrite corrupt or unreadable existing data as if it were absent.
      _ = try readLocked()
      let temporary = directory + "/journal-" + UUID().uuidString + ".tmp"
      var fd: Int32 = -1
      do {
        fd = Darwin.open(temporary, O_WRONLY | O_CREAT | O_EXCL | O_CLOEXEC | O_NOFOLLOW, mode_t(0o600))
        guard fd >= 0 else { throw SageJournalError.io("create temporary", errno) }
        try bytes.withUnsafeBytes { buffer in
          var offset = 0
          while offset < buffer.count {
            let count = Darwin.write(fd, buffer.baseAddress!.advanced(by: offset), buffer.count - offset)
            if count < 0 && errno == EINTR { continue }
            guard count > 0 else { throw SageJournalError.io("write temporary", count == 0 ? EIO : errno) }
            offset += count
          }
        }
        guard Darwin.fsync(fd) == 0 else { throw SageJournalError.io("sync temporary", errno) }
        // Do not silently downgrade a failed full synchronization request.
        guard Darwin.fcntl(fd, F_FULLFSYNC) == 0 else { throw SageJournalError.io("full sync temporary", errno) }
        try checkpoint(.temporarySynced)
        try checkDirectory()
        guard Darwin.rename(temporary, directory + "/journal.json") == 0 else { throw SageJournalError.io("rename", errno) }
        try checkpoint(.renamed)
        let dirFD = Darwin.open(directory, O_RDONLY | O_DIRECTORY | O_CLOEXEC | O_NOFOLLOW)
        guard dirFD >= 0 else { throw SageJournalError.io("open directory for sync", errno) }
        var directoryOpen = true
        defer { if directoryOpen { Darwin.close(dirFD) } }
        guard Darwin.fsync(dirFD) == 0 else { throw SageJournalError.io("sync directory", errno) }
        // Flush device caches after the directory update too. Platform tests must
        // establish support; an unsupported request is an uncertain write, not success.
        guard Darwin.fcntl(fd, F_FULLFSYNC) == 0 else { throw SageJournalError.io("full sync replacement", errno) }
        directoryOpen = false
        guard Darwin.close(dirFD) == 0 else { throw SageJournalError.io("close directory", errno) }
        let closing = fd; fd = -1
        guard Darwin.close(closing) == 0 else { throw SageJournalError.io("close replacement", errno) }
      } catch {
        if fd >= 0 { Darwin.close(fd) }
        // A replacement may already be visible. Preserve both old/new evidence;
        // no temp cleanup, rollback, retry or success inference on a write error.
        poisoned = true
        throw error
      }
    }

    func close() throws {
      gate.lock(); defer { gate.unlock() }
      if lockFD < 0 { return }
      let fd = lockFD; lockFD = -1
      // close releases flock even on process death. Never unlink the lock inode.
      let result = Darwin.close(fd), code = errno
      if result != 0 { throw SageJournalError.io("close lock; ownership remains quarantined", code) }
      SageIntentJournalStore.registryLock.lock()
      SageIntentJournalStore.ownedDirectories.remove("\(identity.0):\(identity.1)")
      SageIntentJournalStore.registryLock.unlock()
    }

    deinit { try? close() }

    private func requireOpen() throws {
      guard lockFD >= 0 && !poisoned else { throw SageJournalError.closed }
    }

    private func readLocked() throws -> Data? {
      try checkDirectory()
      let fd = Darwin.open(directory + "/journal.json", O_RDONLY | O_CLOEXEC | O_NOFOLLOW)
      if fd < 0 {
        if errno == ENOENT {
          try checkDirectory()
          let names = try FileManager.default.contentsOfDirectory(atPath: directory)
          guard !names.contains(where: { $0.hasPrefix("journal-") && $0.hasSuffix(".tmp") }) else { throw SageJournalError.invalidDocument }
          return nil
        }
        throw SageJournalError.io("open journal", errno)
      }
      var fileOpen = true
      defer { if fileOpen { Darwin.close(fd) } }
      var info = stat()
      guard Darwin.fstat(fd, &info) == 0 else { throw SageJournalError.io("stat journal", errno) }
      guard (info.st_mode & S_IFMT) == S_IFREG else { throw SageJournalError.invalidDocument }
      var bytes = Data(), buffer = [UInt8](repeating: 0, count: 8192)
      while true {
        let count = Darwin.read(fd, &buffer, buffer.count)
        if count < 0 && errno == EINTR { continue }
        guard count >= 0 else { throw SageJournalError.io("read journal", errno) }
        if count == 0 { break }
        bytes.append(contentsOf: buffer.prefix(count))
      }
      try SageIntentJournalStore.validate(bytes)
      fileOpen = false
      guard Darwin.close(fd) == 0 else { throw SageJournalError.io("close journal read", errno) }
      return bytes
    }

    private func checkDirectory() throws {
      var info = stat()
      guard Darwin.lstat(directory, &info) == 0, (info.st_mode & S_IFMT) == S_IFDIR,
            info.st_dev == identity.0, info.st_ino == identity.1 else { throw SageJournalError.invalidDirectory }
    }
  }

  static func acquire(directory: URL, checkpoint: @escaping (Step) throws -> Void = { _ in }) throws -> Owner {
    let path = directory.standardizedFileURL.path
    var info = stat()
    guard Darwin.lstat(path, &info) == 0, (info.st_mode & S_IFMT) == S_IFDIR,
          directory.resolvingSymlinksInPath().standardizedFileURL.path == path else { throw SageJournalError.invalidDirectory }
    let identity = (info.st_dev, info.st_ino)
    let key = "\(identity.0):\(identity.1)"
    registryLock.lock()
    let inserted = ownedDirectories.insert(key).inserted
    registryLock.unlock()
    guard inserted else { throw SageJournalError.busy }
    var retained = false
    defer {
      if !retained { registryLock.lock(); ownedDirectories.remove(key); registryLock.unlock() }
    }
    let fd = Darwin.open(path + "/journal.lock", O_RDWR | O_CREAT | O_CLOEXEC | O_NOFOLLOW, mode_t(0o600))
    guard fd >= 0 else { throw SageJournalError.io("open lock", errno) }
    var keepFD = false
    defer { if !keepFD { Darwin.close(fd) } }
    guard Darwin.fstat(fd, &info) == 0, (info.st_mode & S_IFMT) == S_IFREG else { throw SageJournalError.invalidDirectory }
    guard Darwin.flock(fd, LOCK_EX | LOCK_NB) == 0 else {
      if errno == EWOULDBLOCK || errno == EAGAIN { throw SageJournalError.busy }
      throw SageJournalError.io("acquire lock", errno)
    }
    retained = true; keepFD = true
    return Owner(directory: path, identity: identity, lockFD: fd, checkpoint: checkpoint)
  }

  // Storage envelope validation only. The JS foundation still validates the
  // complete record schema. No credentials may be supplied as input values.
  private static func validate(_ bytes: Data) throws {
    guard let object = try? JSONSerialization.jsonObject(with: bytes),
          let root = object as? [String: Any], Set(root.keys) == Set(["format", "revision", "records"]),
          let format = root["format"] as? NSNumber, CFGetTypeID(format) != CFBooleanGetTypeID(), format.doubleValue == 1,
          let revision = root["revision"] as? NSNumber, CFGetTypeID(revision) != CFBooleanGetTypeID(),
          revision.doubleValue >= 0, revision.doubleValue <= 9007199254740991,
          revision.doubleValue.rounded(.down) == revision.doubleValue,
          root["records"] is [[String: Any]] else { throw SageJournalError.invalidDocument }
    func inspect(_ value: Any) throws {
      if let map = value as? [String: Any] {
        for (key, child) in map {
          if key.range(of: "token|password|secret|authorization|credential|__proto__|constructor|prototype", options: [.regularExpression, .caseInsensitive]) != nil { throw SageJournalError.invalidDocument }
          try inspect(child)
        }
      } else if let list = value as? [Any] { for child in list { try inspect(child) } }
    }
    try inspect(root)
  }
}
