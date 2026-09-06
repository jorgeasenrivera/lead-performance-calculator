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
   notification straight away rather than waiting for the round trip. If the app
   happens to be running the page is told too, so the screen behind agrees.
   If there is no session, or the network is out, the press is remembered and
   handed to the page the next time it is opened, which is the same fallback
   the iOS intents use. */
class QueueActionReceiver : BroadcastReceiver() {
  override fun onReceive(ctx: Context, intent: Intent) {
    val action = intent.getStringExtra("action") ?: return
    val pending = goAsync()
    SageLiveStore.optimistic(ctx, action)
    // Straight to the page if it is listening; it has its own session and its
    // own copy of the row, and will not act twice on one press.
    val handled = SageLiveModule.emitAction(action)
    Thread {
      try {
        if (!handled) {
          if (!post(ctx, action)) SageLiveStore.remember(ctx, action)
        }
      } catch (e: Throwable) {
        SageLiveStore.remember(ctx, action)
      } finally {
        pending.finish()
      }
    }.start()
  }

  private fun post(ctx: Context, action: String): Boolean {
    val s = SageLiveStore.session(ctx) ?: return false
    val base = s.optString("apiBase", "").trimEnd('/')
    val token = s.optString("token", "")
    val store = s.optString("store", "")
    val date = s.optString("date", "")
    if (base.isEmpty() || token.isEmpty() || store.isEmpty() || date.isEmpty()) return false
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
      conn.responseCode in 200..299
    } catch (e: Throwable) {
      false
    } finally {
      try { conn?.disconnect() } catch (e: Throwable) {}
    }
  }
}
