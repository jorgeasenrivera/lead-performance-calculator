import ActivityKit
import ExpoModulesCore

/* The app's half of the Live Activity.
   -------------------------------------------------------------------------
   Two jobs, both small:

   1. Tokens out. ActivityKit hands the app two kinds of push token and the
      server needs both: the push-to-start token (iOS 17.2+), so the server can
      put the line on the lock screen without the app being open, and the token
      of each running activity, so the server can move it. They are sent to the
      page as "onToken" events; the page registers them the same way it
      registers the device token.

   2. Start, update, end from the page. When the salesperson is looking at the
      line, the page already knows their place, and starting the activity here
      is instant where a push is a round trip. The server keeps it current
      after that.

   Everything is gated on the OS version at runtime, so the app still builds
   and runs on iOS 15 and 16.1; there is simply no activity there. */
public class SageLiveModule: Module {
  private var observing = false

  public func definition() -> ModuleDefinition {
    Name("SageLive")

    Events("onToken", "onAction")

    OnStartObserving {
      self.observe()
    }

    /* The page's session, kept where the intents (same process) can read it. */
    Function("setSession") { (s: [String: Any]) in
      let d = UserDefaults.standard
      d.set(s["token"] as? String, forKey: "sageLive.token")
      d.set(s["apiBase"] as? String, forKey: "sageLive.apiBase")
      d.set(s["store"] as? String, forKey: "sageLive.store")
      d.set(s["date"] as? String, forKey: "sageLive.date")
      if let e = s["exp"] as? Double { d.set(e, forKey: "sageLive.exp") } else { d.removeObject(forKey: "sageLive.exp") }
    }

    AsyncFunction("isRunning") { () -> Bool in
      if #available(iOS 16.2, *) { return !Activity<QueueAttributes>.activities.isEmpty }
      return false
    }

    /* A press that landed while nobody was listening: handed over once. */
    AsyncFunction("pendingAction") { () -> String? in
      let a = UserDefaults.standard.string(forKey: "sageLive.pendingAction")
      UserDefaults.standard.removeObject(forKey: "sageLive.pendingAction")
      return a
    }

    AsyncFunction("enabled") { () -> Bool in
      if #available(iOS 16.2, *) {
        return ActivityAuthorizationInfo().areActivitiesEnabled
      }
      return false
    }

    AsyncFunction("start") { (attrs: [String: Any], state: [String: Any]) -> String? in
      if #available(iOS 16.2, *) {
        return try self.start(attrs: attrs, state: state)
      }
      return nil
    }

    AsyncFunction("update") { (state: [String: Any], promise: Promise) in
      if #available(iOS 16.2, *) {
        Task { promise.resolve(await self.update(state: state)) }
      } else {
        promise.resolve(false)
      }
    }

    AsyncFunction("end") { (promise: Promise) in
      if #available(iOS 16.2, *) {
        Task { promise.resolve(await self.endAll()) }
      } else {
        promise.resolve(false)
      }
    }
  }

  private func hex(_ data: Data) -> String {
    data.map { String(format: "%02x", $0) }.joined()
  }

  private func observe() {
    guard !observing else { return }
    observing = true
    /* The Live Activity's buttons run in this process and post here. */
    NotificationCenter.default.addObserver(forName: Notification.Name("SageLiveAction"), object: nil, queue: .main) { [weak self] n in
      guard let a = n.userInfo?["action"] as? String else { return }
      UserDefaults.standard.removeObject(forKey: "sageLive.pendingAction")
      self?.sendEvent("onAction", ["action": a])
    }
    if #available(iOS 17.2, *) {
      Task {
        for await data in Activity<QueueAttributes>.pushToStartTokenUpdates {
          self.sendEvent("onToken", ["kind": "pts", "token": self.hex(data)])
        }
      }
    }
    if #available(iOS 16.2, *) {
      // Activities that are already running when the app comes back.
      for a in Activity<QueueAttributes>.activities { watch(a) }
      Task {
        for await a in Activity<QueueAttributes>.activityUpdates { self.watch(a) }
      }
    }
  }

  @available(iOS 16.2, *)
  private func watch(_ a: Activity<QueueAttributes>) {
    Task {
      for await data in a.pushTokenUpdates {
        self.sendEvent("onToken", ["kind": "activity", "token": self.hex(data), "id": a.id])
      }
    }
  }

  @available(iOS 16.2, *)
  private func contentState(_ s: [String: Any]) -> QueueAttributes.ContentState {
    let pips: [QueueAttributes.Pip]? = (s["line"] as? [[String: Any]])?.map { p in
      QueueAttributes.Pip(i: (p["i"] as? String) ?? "·", h: (p["h"] as? Int) ?? 0,
                          s: (p["s"] as? String) ?? "w", me: (p["me"] as? Bool) ?? false)
    }
    return QueueAttributes.ContentState(
      ahead: (s["ahead"] as? Int) ?? 0,
      up: (s["up"] as? Bool) ?? false,
      status: (s["status"] as? String) ?? "waiting",
      label: (s["label"] as? String) ?? "",
      line: pips,
      nudge: s["nudge"] as? Bool,
      table: s["table"] as? String,
      since: s["since"] as? String
    )
  }

  @available(iOS 16.2, *)
  private func start(attrs: [String: Any], state: [String: Any]) throws -> String? {
    guard ActivityAuthorizationInfo().areActivitiesEnabled else { return nil }
    let attributes = QueueAttributes(
      store: (attrs["store"] as? String) ?? "",
      date: (attrs["date"] as? String) ?? "",
      kind: (attrs["kind"] as? String) ?? "floor"
    )
    let content = ActivityContent(state: contentState(state), staleDate: nil)
    /* One at a time. A second line on the lock screen for the same person is
       never right; the server's end/update logic assumes one too. */
    if let running = Activity<QueueAttributes>.activities.first {
      Task { await running.update(content) }
      return running.id
    }
    let a = try Activity<QueueAttributes>.request(attributes: attributes, content: content, pushType: .token)
    watch(a)
    return a.id
  }

  @available(iOS 16.2, *)
  private func update(state: [String: Any]) async -> Bool {
    let content = ActivityContent(state: contentState(state), staleDate: nil)
    var any = false
    for a in Activity<QueueAttributes>.activities { await a.update(content); any = true }
    return any
  }

  @available(iOS 16.2, *)
  private func endAll() async -> Bool {
    var any = false
    for a in Activity<QueueAttributes>.activities {
      await a.end(nil, dismissalPolicy: .immediate)
      any = true
    }
    return any
  }
}
