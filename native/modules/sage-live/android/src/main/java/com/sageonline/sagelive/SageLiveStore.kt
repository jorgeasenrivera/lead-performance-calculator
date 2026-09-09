package com.sageonline.sagelive

import android.content.Context
import android.content.SharedPreferences
import org.json.JSONObject

/* What has to outlive the app being killed: the page's session, the state the
   notification is currently showing, and a press nobody was awake to hear. */
object SageLiveStore {
  private const val FILE = "sage.live"

  private fun prefs(ctx: Context): SharedPreferences =
    ctx.applicationContext.getSharedPreferences(FILE, Context.MODE_PRIVATE)

  fun setSession(ctx: Context, s: Map<String, Any?>) {
    val o = JSONObject()
    for (k in listOf("token", "apiBase", "store", "date")) {
      val v = s[k]
      if (v != null) o.put(k, v.toString())
    }
    prefs(ctx).edit().putString("session", o.toString()).apply()
  }

  fun session(ctx: Context): JSONObject? =
    try { prefs(ctx).getString("session", null)?.let { JSONObject(it) } } catch (e: Throwable) { null }

  fun setState(ctx: Context, s: JSONObject?) {
    prefs(ctx).edit().putString("state", s?.toString()).apply()
  }

  fun state(ctx: Context): JSONObject? =
    try { prefs(ctx).getString("state", null)?.let { JSONObject(it) } } catch (e: Throwable) { null }

  fun setRunning(ctx: Context, on: Boolean) {
    prefs(ctx).edit().putBoolean("running", on).apply()
  }

  fun running(ctx: Context): Boolean = prefs(ctx).getBoolean("running", false)

  fun remember(ctx: Context, action: String) {
    prefs(ctx).edit().putString("pending", action).apply()
  }

  fun takePending(ctx: Context): String? {
    val p = prefs(ctx).getString("pending", null)
    if (p != null) prefs(ctx).edit().remove("pending").apply()
    return p
  }

  /* The card should move under the thumb, not a second later when the server
     answers. Only the cheap, certain part of each action is done here; the
     server's answer arrives afterwards and overwrites this either way. */
  fun optimistic(ctx: Context, action: String) {
    if (!running(ctx)) return
    val s = state(ctx) ?: return
    /* The same mutation the iOS intent applies, so a press looks the same on
       both phones before either has heard back from the server. */
    val now = java.text.SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss'Z'", java.util.Locale.US)
      .apply { timeZone = java.util.TimeZone.getTimeZone("UTC") }.format(java.util.Date())
    when (action) {
      "lunch", "away" -> { s.put("status", action); s.put("up", false); s.put("nudge", false); s.put("since", now) }
      "back" -> { s.put("status", "waiting"); s.put("nudge", false); s.put("since", now) }
      /* Ending the visit clears the guest and everything asked about them. */
      "done" -> {
        s.put("status", "waiting"); s.put("up", false); s.put("nudge", false); s.put("since", now)
        s.remove("confirm"); s.remove("ask"); s.remove("askAt"); s.remove("askBy"); s.remove("table")
      }
      "take" -> {
        s.put("status", "customer"); s.put("up", false); s.put("nudge", false); s.put("since", now)
        s.remove("ask"); s.remove("askAt"); s.remove("askBy"); s.remove("confirm")
      }
      /* An ask goes out from wherever they are. askBy stays empty until a
         manager picks it up, which is what tells the card to say claimed. */
      "fly", "to" -> { s.put("ask", action); s.put("askAt", now); s.remove("askBy") }
      "cancel" -> { s.remove("ask"); s.remove("askAt"); s.remove("askBy") }
      /* The question before the visit ends, and the answer that takes it back
         off. Neither reaches the server: they only change what the card asks. */
      "ask-done" -> s.put("confirm", true)
      "keep" -> s.remove("confirm")
      "ack", "with-guest" -> { s.put("nudge", false); s.remove("askedBy"); s.remove("place") }
      "pass" -> { s.put("up", false); s.put("nudge", false); s.put("since", now) }
      else -> return
    }
    setState(ctx, s)
    LineNotification.post(ctx, s)
  }
}
