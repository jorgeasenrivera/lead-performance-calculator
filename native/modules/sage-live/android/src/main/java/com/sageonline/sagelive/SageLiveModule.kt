package com.sageonline.sagelive

import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import org.json.JSONObject

/* The app's half of the Live Update: the same module name, the same function
   names and the same shapes as the iOS one, so index.js and the shell say one
   thing to both phones.

   Two differences that are the platform, not a shortcut. There is no
   push-to-start token here and no per-activity token, because a notification is
   posted by the app rather than woken by the server; the server reaches an
   Android phone with an ordinary push, which it already does, and the shell
   re-posts the card from what the push carries. So "onToken" is declared and
   never fires. And a press on a button is handled by a receiver that runs
   whether or not this module is alive; when it is alive it is told first. */
class SageLiveModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("SageLive")

    Events("onToken", "onAction")

    OnStartObserving { listening = this@SageLiveModule }
    OnStopObserving { if (listening === this@SageLiveModule) listening = null }
    OnDestroy { if (listening === this@SageLiveModule) listening = null }

    /* The page's session, kept where the receiver can read it with the app
       closed. Same keys, same job as the iOS UserDefaults. */
    Function("setSession") { s: Map<String, Any?> ->
      SageLiveStore.setSession(appContext.reactContext ?: return@Function, s)
    }

    AsyncFunction("enabled") {
      val ctx = appContext.reactContext ?: return@AsyncFunction false
      LineNotification.canPromote(ctx)
    }

    AsyncFunction("isRunning") {
      val ctx = appContext.reactContext ?: return@AsyncFunction false
      SageLiveStore.running(ctx)
    }

    AsyncFunction("pendingAction") {
      val ctx = appContext.reactContext ?: return@AsyncFunction null
      SageLiveStore.takePending(ctx)
    }

    /* attrs carries the store and the day, which the notification does not
       draw; it is the session that says where a button's press goes. Kept for
       the same shape as iOS, where the activity's attributes are fixed for its
       life and the state is what moves. */
    AsyncFunction("start") { _: Map<String, Any?>, state: Map<String, Any?> ->
      val ctx = appContext.reactContext ?: return@AsyncFunction null
      val s = LineNotification.stateFrom(state)
      SageLiveStore.setState(ctx, s)
      SageLiveStore.setRunning(ctx, true)
      LineNotification.post(ctx, s)
      "line"
    }

    AsyncFunction("update") { state: Map<String, Any?> ->
      val ctx = appContext.reactContext ?: return@AsyncFunction false
      if (!SageLiveStore.running(ctx)) return@AsyncFunction false
      val s = LineNotification.stateFrom(state)
      SageLiveStore.setState(ctx, s)
      LineNotification.post(ctx, s)
      true
    }

    AsyncFunction("end") {
      val ctx = appContext.reactContext ?: return@AsyncFunction false
      SageLiveStore.setRunning(ctx, false)
      SageLiveStore.setState(ctx, null)
      LineNotification.cancel(ctx)
      true
    }
  }

  companion object {
    /* Set while JavaScript is listening. The receiver asks before doing the
       work itself, so a press with the app in front is handled by the page,
       which has the row in hand, and a press with the app gone goes to the API. */
    @Volatile private var listening: SageLiveModule? = null

    fun emitAction(action: String): Boolean {
      val m = listening ?: return false
      return try {
        m.sendEvent("onAction", mapOf("action" to action))
        true
      } catch (e: Throwable) {
        false
      }
    }
  }
}
