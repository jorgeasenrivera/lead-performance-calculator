package com.sageonline.sagelive

import android.app.Service
import android.content.Intent
import android.os.*
import java.io.File

// Test APK only, declared in a distinct private process by its test manifest.
class JournalLockService : Service() {
  private var owner: SageIntentJournalStore.Owner? = null
  private val messenger = Messenger(object : Handler(Looper.getMainLooper()) {
    override fun handleMessage(message: Message) {
      val reply = Bundle()
      try {
        val root = File(message.data.getString("directory")!!).canonicalFile
        check(root.parentFile == cacheDir.canonicalFile && root.name.startsWith("journal-probe-"))
        val stage = message.data.getString("crashStage")
        val acquired = SageIntentJournalStore.acquire(root) { step ->
          if (step.name == stage) {
            val reached = Bundle().also { it.putString("state", "acquired"); it.putInt("pid", Process.myPid()) }
            message.replyTo.send(Message.obtain().also { it.data = reached })
            // Test parent kills this synthetic process at the selected checkpoint.
            while (true) Thread.sleep(1000)
          }
        }
        if (stage != null) acquired.replace("{\"format\":1,\"revision\":1,\"records\":[]}".toByteArray())
        if (message.data.getBoolean("hold")) owner = acquired else acquired.close()
        reply.putString("state", "acquired")
      } catch (_: SageIntentJournalStore.Busy) { reply.putString("state", "busy") }
      catch (e: Throwable) { reply.putString("state", "error:" + e.javaClass.simpleName) }
      reply.putInt("pid", Process.myPid())
      message.replyTo.send(Message.obtain().also { it.data = reply })
    }
  })
  override fun onBind(intent: Intent) = messenger.binder
  override fun onDestroy() { owner?.close(); super.onDestroy() }
}
