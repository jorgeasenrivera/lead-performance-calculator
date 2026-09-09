package com.sageonline.sagelive

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.graphics.Color
import android.os.Build
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.graphics.drawable.IconCompat
import org.json.JSONArray
import org.json.JSONObject

/* The line, on an Android lock screen.
   -------------------------------------------------------------------------
   Android 16's Live Updates are the same idea as an iOS Live Activity and a
   different shape: an ongoing notification that asks to be promoted, which the
   system then draws as a chip in the status bar and a card on the lock screen.
   A promoted notification may not carry custom views, so the pixel rail the
   Live Activity draws cannot be drawn here. What it may carry is ProgressStyle,
   which is a segmented bar with a tracker on it, and a queue is exactly that:
   one segment per person, the door at the right hand end, and the tracker
   standing where you are. The colours are the same hues the rest of Sage gives
   people, so the bar reads as the same line the board and the phone draw.

   Below Android 16 there is no promotion and no chip. The same notification is
   posted anyway: ongoing, with the same buttons, in the shade rather than on
   the lock screen. That is worth having, and it is one branch at the end
   rather than a second implementation. */
object LineNotification {
  const val CHANNEL = "line"
  const val ID = 4711

  private const val MINT = 0xFF8FD8AF.toInt()
  private const val SAND = 0xFFE4C98D.toInt()
  private const val MIST = 0xFF9FB0A4.toInt()
  private const val RED = 0xFFD8483C.toInt()
  private const val FLY = 0xFFE8A93C.toInt()

  /** The same ten phases the Live Activity has, worked out the same way, so
      the two never disagree. The three that were missing here — asking,
      claimed and confirm — are the whole of the FlyBy round trip and the
      question before a visit ends, so without them an Android phone could
      start an ask and never see it picked up. */
  private fun phaseOf(s: JSONObject): String {
    val status = s.optString("status", "waiting")
    if (status == "gone") return "gone"
    if (s.optBoolean("nudge", false)) return "desk"
    if (status == "customer") {
      /* Order matters, the same order as iOS: a question about ending the
         visit outranks a claimed ask, which outranks an open one, because it
         is the thing the person is being asked right now. */
      if (s.optBoolean("confirm", false)) return "confirm"
      val ask = s.optString("ask", "")
      if (ask.isNotEmpty() && ask != "null") {
        val by = s.optString("askBy", "")
        return if (by.isNotEmpty() && by != "null") "claimed" else "asking"
      }
      return "customer"
    }
    if (status == "lunch" || status == "away") return "off"
    if (s.optBoolean("up", false)) return "up"
    return if (s.optInt("ahead", 0) == 0) "next" else "waiting"
  }

  private fun str(s: JSONObject, key: String): String? {
    val v = s.optString(key, "")
    return if (v.isEmpty() || v == "null") null else v
  }

  private fun headline(s: JSONObject, ph: String): String = when (ph) {
    "up" -> "You're up"
    "next" -> "You're next"
    /* The desk asking for a meeting says where, not who: the location is what
       you act on, and the manager's name is one more thing to read. */
    "desk" -> if (str(s, "place") != null) "Meeting, now" else "The desk wants you"
    "customer" -> "With a customer"
    "asking" -> if (s.optString("ask") == "to") "Requesting T.O." else "Requesting FlyBy"
    "claimed" -> str(s, "askBy")?.let { "$it is on the way" } ?: "Manager on the way"
    "confirm" -> "Has your guest left?"
    "off" -> if (s.optString("status") == "lunch") "At lunch" else "Out of the line"
    "gone" -> "Off the line"
    else -> "${s.optInt("ahead", 0)} ahead of you"
  }

  /* Said once. A headline that already carries the fact does not get a caption
     repeating it underneath, which is what "In the line" and "Head to the
     door" were doing. Empty means no second line at all. */
  private fun caption(s: JSONObject, ph: String): String = when (ph) {
    "customer", "asking", "confirm" -> {
      val t = str(s, "table")
      when {
        t == null -> ""
        t.startsWith("O") -> "Office ${t.drop(1)}"
        else -> "Table $t"
      }
    }
    "desk" -> str(s, "place") ?: str(s, "askedBy") ?: ""
    "off" -> if (s.optString("status") == "lunch") "You'll be passed until you tap back in"
             else "On the floor, not taking a turn"
    "gone" -> "Signed out for the day"
    else -> ""
  }

  /* The status bar chip has room for a couple of words and no more, so this is
     the one thing worth knowing without opening anything. */
  private fun chip(s: JSONObject, ph: String): String = when (ph) {
    "up" -> "You're up"
    "desk" -> "Desk"
    "customer" -> "With a guest"
    "asking" -> if (s.optString("ask") == "to") "T.O. out" else "FlyBy out"
    "claimed" -> "On the way"
    "confirm" -> "Gone?"
    "next" -> "Next"
    "off" -> if (s.optString("status") == "lunch") "Lunch" else "Out"
    "gone" -> ""
    else -> "${s.optInt("ahead", 0)} ahead"
  }

  private fun accent(ph: String): Int = when (ph) {
    "up", "claimed" -> MINT
    "desk" -> RED
    "customer", "asking", "confirm" -> FLY
    "off", "gone" -> MIST
    else -> SAND
  }

  /** The buttons, matching the Live Activity's phase for phase. */
  private fun actions(ph: String, s: JSONObject): List<Pair<String, String>> = when (ph) {
    "waiting", "next" -> listOf("lunch" to "Lunch", "away" to "Away")
    "up" -> listOf("take" to "Got them", "pass" to "Pass")
    /* "They left" asks before it acts rather than ending the visit on a thumb
       that landed one target over, which is what ask-done is for. */
    "customer" -> listOf("fly" to "FlyBy", "to" to "T.O.", "ask-done" to "They left")
    "asking" -> listOf("cancel" to "Never mind", "ask-done" to "They left")
    "claimed" -> listOf("ask-done" to "They left")
    "confirm" -> listOf("done" to "Yes, they left", "keep" to "Not yet")
    /* The honest second answer. The desk would rather send somebody else than
       stand there wondering. */
    "desk" -> listOf("ack" to "On my way", "with-guest" to "With a guest")
    "off" -> listOf("back" to (if (s.optString("status") == "lunch") "Back on the floor" else "Back in line"))
    else -> emptyList()
  }

  fun ensureChannel(ctx: Context) {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
    val mgr = ctx.getSystemService(NotificationManager::class.java) ?: return
    if (mgr.getNotificationChannel(CHANNEL) != null) return
    // Not IMPORTANCE_MIN: a channel that low is never promoted. Not high
    // either, because the line moving is not worth a sound every time.
    val ch = NotificationChannel(CHANNEL, "The line", NotificationManager.IMPORTANCE_DEFAULT)
    ch.description = "Where you stand on the floor, while you are on it."
    ch.setShowBadge(false)
    ch.enableVibration(false)
    mgr.createNotificationChannel(ch)
  }

  private fun tapIntent(ctx: Context): PendingIntent? {
    val open = ctx.packageManager.getLaunchIntentForPackage(ctx.packageName) ?: return null
    open.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP)
    return PendingIntent.getActivity(ctx, 0, open,
      PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
  }

  private fun actionIntent(ctx: Context, action: String): PendingIntent {
    val i = Intent(ctx, QueueActionReceiver::class.java)
      .setAction("com.sageonline.sagelive.ACTION")
      .putExtra("action", action)
    // A distinct request code per action, or every button would share one
    // PendingIntent and the last one built would win.
    return PendingIntent.getBroadcast(ctx, action.hashCode(), i,
      PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
  }

  /* One segment per person, back of the line first so the door is the right
     hand end, which is the way every other drawing of the line in Sage runs.
     The tracker stands on you. */
  private fun progressStyle(ctx: Context, s: JSONObject, ph: String): NotificationCompat.ProgressStyle? {
    val line = s.optJSONArray("line") ?: return null
    if (line.length() == 0) return null
    val style = NotificationCompat.ProgressStyle()
    val segs = ArrayList<NotificationCompat.ProgressStyle.Segment>()
    var mine = -1
    // line[0] is the front of the queue; reversed, the front lands at the door.
    for (i in line.length() - 1 downTo 0) {
      val p = line.optJSONObject(i) ?: continue
      val me = p.optBoolean("me", false)
      if (me) mine = segs.size + 1
      val colour = if (me) (if (ph == "up") MINT else SAND)
        else Color.HSVToColor(floatArrayOf(p.optInt("h", 200).toFloat(), 0.62f, 0.62f))
      segs.add(NotificationCompat.ProgressStyle.Segment(1).setColor(colour))
    }
    if (segs.isEmpty()) return null
    style.setProgressSegments(segs)
    style.setProgress(if (mine > 0) mine else segs.size)
    style.setProgressTrackerIcon(IconCompat.createWithResource(ctx, R.drawable.sage_line))
    return style
  }

  fun build(ctx: Context, state: JSONObject): Notification {
    ensureChannel(ctx)
    val ph = phaseOf(state)
    val b = NotificationCompat.Builder(ctx, CHANNEL)
      .setSmallIcon(R.drawable.sage_line)
      .setContentTitle(headline(state, ph))        // required for promotion
      .setContentText(caption(state, ph))
      .setColor(accent(ph))
      .setOngoing(true)                            // required for promotion
      .setOnlyAlertOnce(true)
      .setShowWhen(false)
      .setCategory(NotificationCompat.CATEGORY_STATUS)
      .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
      .setRequestPromotedOngoing(true)
      .setShortCriticalText(chip(state, ph))

    tapIntent(ctx)?.let { b.setContentIntent(it) }
    if (ph == "waiting" || ph == "next" || ph == "up") progressStyle(ctx, state, ph)?.let { b.setStyle(it) }
    for ((action, label) in actions(ph, state)) {
      b.addAction(NotificationCompat.Action.Builder(
        R.drawable.sage_line, label, actionIntent(ctx, action)).build())
    }
    return b.build()
  }

  fun post(ctx: Context, state: JSONObject) {
    try {
      NotificationManagerCompat.from(ctx).notify(ID, build(ctx, state))
    } catch (e: SecurityException) { /* notifications refused: nothing to show */ }
  }

  fun cancel(ctx: Context) {
    try { NotificationManagerCompat.from(ctx).cancel(ID) } catch (e: Exception) {}
  }

  /** Whether this phone can promote a notification to the chip at all. */
  fun canPromote(ctx: Context): Boolean {
    if (Build.VERSION.SDK_INT < 36) return false
    val mgr = ctx.getSystemService(NotificationManager::class.java) ?: return false
    return try { mgr.canPostPromotedNotifications() } catch (e: Throwable) { false }
  }

  fun stateFrom(map: Map<String, Any?>): JSONObject {
    val o = JSONObject()
    for ((k, v) in map) {
      when (v) {
        null -> {}
        is List<*> -> {
          val arr = JSONArray()
          for (item in v) if (item is Map<*, *>) {
            val p = JSONObject()
            for ((pk, pv) in item) if (pv != null) p.put(pk.toString(), pv)
            arr.put(p)
          }
          o.put(k, arr)
        }
        else -> o.put(k, v)
      }
    }
    return o
  }
}
