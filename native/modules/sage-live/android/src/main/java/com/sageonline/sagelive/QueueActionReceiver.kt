package com.sageonline.sagelive

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import org.json.JSONObject
import java.io.OutputStreamWriter
import java.net.HttpURLConnection
import java.net.URL

/* A button pressed on the Live Update.
   -------------------------------------------------------------------------
   The press has to work with the app closed, which is the whole point of the
   thing being on the lock screen. So this does the work itself: it reads the
   session the page handed the shell, acts through the site's API, and moves the
   notification from authoritative updates rather than assuming the action changed it. If the app
   happens to be running the page is told too, so the screen behind agrees.
   If there is no session, or the network is out, the press is remembered and
   handed to the page the next time it is opened, which is the same fallback
   the iOS intents use. */
class QueueActionReceiver : BroadcastReceiver() {
  override fun onReceive(ctx: Context, intent: Intent) {
    val action = intent.getStringExtra("action") ?: return
    val pending = goAsync()
    /* Two of the buttons only change what the card is asking and have nothing
       to tell the server: "They left" puts the question up, "Not yet" takes it
       back down. Posting either would file a visit ending that has not
       happened. The same two are local-only in the iOS intents. */
    if (action == "ask-done" || action == "keep") {
      SageLiveStore.optimistic(ctx, action)
      pending.finish(); return
    }
    // Straight to the page if it is listening; it has its own session and its
    // own copy of the row, and will not act twice on one press.
    val handled = SageLiveModule.emitAction(action)
    Thread {
      try {
        if (!handled) {
          if (post(ctx, action) == ServerOutcome.UNAVAILABLE) SageLiveStore.remember(ctx, action)
        }
      } catch (e: Throwable) {
        SageLiveStore.remember(ctx, action)
      } finally {
        pending.finish()
      }
    }.start()
  }

  private enum class ServerOutcome { ACKNOWLEDGED, UNCONFIRMED, UNAVAILABLE }

  private fun post(ctx: Context, action: String): ServerOutcome {
    val s = SageLiveStore.session(ctx) ?: return ServerOutcome.UNAVAILABLE
    val base = s.optString("apiBase", "").trimEnd('/')
    val token = s.optString("token", "")
    val store = s.optString("store", "")
    val date = s.optString("date", "")
    if (base.isEmpty() || token.isEmpty() || store.isEmpty() || date.isEmpty()) return ServerOutcome.UNAVAILABLE
    var conn: HttpURLConnection? = null
    return try {
      conn = (URL("$base/api/queue-action").openConnection() as HttpURLConnection).apply {
        requestMethod = "POST"
        connectTimeout = 12000
        readTimeout = 12000
        doOutput = true
        setRequestProperty("content-type", "application/json")
        setRequestProperty("authorization", "Bearer $token")
      }
      val body = JSONObject()
        .put("store", store).put("date", date).put("action", action).toString()
      OutputStreamWriter(conn.outputStream).use { it.write(body) }
      if (conn.responseCode !in 200..299) return ServerOutcome.UNAVAILABLE
      // An unreadable 2xx may have committed. Do not replay it through the page.
      try {
        val ack = conn.inputStream.bufferedReader().use { JSONObject(it.readText()) }
        if (ack.opt("ok") == true && ack.opt("changed") is Boolean) ServerOutcome.ACKNOWLEDGED
        else ServerOutcome.UNCONFIRMED
      } catch (e: Throwable) { ServerOutcome.UNCONFIRMED }
    } catch (e: Throwable) {
      ServerOutcome.UNAVAILABLE
    } finally {
      try { conn?.disconnect() } catch (e: Throwable) {}
    }
  }
}
