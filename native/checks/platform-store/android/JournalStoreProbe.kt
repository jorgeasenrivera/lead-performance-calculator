package com.sageonline.sagelive

import android.app.Activity
import android.app.Instrumentation
import android.content.*
import android.os.*
import java.io.File
import java.io.IOException
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit

// Designed instrumentation, not connected to the application's Gradle build.
class JournalStoreProbe : Instrumentation() {
  private val old = "{\"format\":1,\"revision\":0,\"records\":[]}".toByteArray()
  private val next = "{\"format\":1,\"revision\":1,\"records\":[]}".toByteArray()
  private fun fails(action: () -> Unit) { try { action() } catch (_: Throwable) { return }; error("expected failure") }
  private fun child(root: File, hold: Boolean, crashStage: String? = null): Pair<ServiceConnection, Bundle> {
    val latch = CountDownLatch(1); var response: Bundle? = null
    val thread = HandlerThread("journal-probe-reply"); thread.start()
    val reply = Messenger(object : Handler(thread.looper) {
      override fun handleMessage(message: Message) { response = message.data; latch.countDown() }
    })
    val connection = object : ServiceConnection {
      var sent = false
      override fun onServiceConnected(name: ComponentName, binder: IBinder) {
        if (sent) return // A restarted process must not silently reacquire our test lock.
        sent = true
        Messenger(binder).send(Message.obtain().also {
          it.replyTo = reply; it.data = Bundle().also { b -> b.putString("directory", root.path); b.putBoolean("hold", hold); b.putString("crashStage", crashStage) }
        })
      }
      override fun onServiceDisconnected(name: ComponentName) {}
    }
    check(context.bindService(Intent(context, JournalLockService::class.java), connection, Context.BIND_AUTO_CREATE))
    try { check(latch.await(10, TimeUnit.SECONDS)); return connection to response!! }
    catch (e: Throwable) { context.unbindService(connection); throw e }
    finally { thread.quitSafely() }
  }
  override fun onCreate(arguments: Bundle?) { super.onCreate(arguments); start() }
  override fun onStart() {
    val output = Bundle()
    try { runProbe(); output.putString("result", "PASS synthetic Android store probes"); finish(Activity.RESULT_OK, output) }
    catch (e: Throwable) { output.putString("result", "FAIL " + e.toString()); finish(Activity.RESULT_CANCELED, output) }
  }
  private fun runProbe() {
    val root = File(context.cacheDir, "journal-probe-${java.util.UUID.randomUUID()}").canonicalFile
    check(root.mkdir())
    try {
      val owner = SageIntentJournalStore.acquire(root)
      check(owner.read() == null)
      fails { SageIntentJournalStore.acquire(root) }
      val (connection, result) = child(root, false)
      try { check(result.getString("state") == "busy") } finally { context.unbindService(connection) }
      owner.replace(old); check(owner.read()!!.contentEquals(old))
      fails { owner.replace(byteArrayOf(0xC3.toByte(), 0x28.toByte())) }
      for (text in listOf("{broken", "{format:1,revision:0,records:[]}", "{'format':1,'revision':0,'records':[]}", "{\"format\":1,\"revision\":0,\"records\":[{\"token\":\"synthetic\"}]}")) {
        fails { owner.replace(text.toByteArray()) }
      }
      owner.close(); owner.close(); fails { owner.read() }
      val stale = File(root, "journal-stale.tmp"); stale.writeText("synthetic interrupted bytes")
      for (step in SageIntentJournalStore.Step.values()) {
        val failing = SageIntentJournalStore.acquire(root) { if (it == step) throw AssertionError("injected IO stage") }
        fails { failing.replace(next) }; fails { failing.read() }; failing.close()
        SageIntentJournalStore.acquire(root).use { reopened ->
          check(reopened.read()!!.contentEquals(if (step == SageIntentJournalStore.Step.TEMPORARY_SYNCED) old else next))
        }
      }
      check(stale.exists())
      val denied = SageIntentJournalStore.acquire(root)
      android.system.Os.chmod(root.path, 320) // 0500, temporary synthetic directory only.
      try { fails { denied.replace(next) } } finally { android.system.Os.chmod(root.path, 448); denied.close() }
      val file = File(root, "journal.json")
      val inaccessible = SageIntentJournalStore.acquire(root); android.system.Os.chmod(file.path, 0)
      try { fails { inaccessible.read() } } finally { android.system.Os.chmod(file.path, 384); inaccessible.close() }
      file.writeText("corrupt")
      SageIntentJournalStore.acquire(root).use { bad -> fails { bad.read() }; fails { bad.replace(old) } }
      check(file.readText() == "corrupt")
      file.writeBytes(next) // Test fixture restoration, never product repair.
      val (heldConnection, held) = child(root, true)
      try {
        check(held.getString("state") == "acquired")
        val pid = held.getInt("pid"); check(pid > 0 && pid != Process.myPid())
        fails { SageIntentJournalStore.acquire(root) }
        Process.killProcess(pid) // Only this test APK's distinct synthetic holder process.
        val deadline = SystemClock.elapsedRealtime() + 5000
        while (true) {
          try { SageIntentJournalStore.acquire(root).use { check(it.read()!!.contentEquals(next)) }; break }
          catch (busy: SageIntentJournalStore.Busy) { if (SystemClock.elapsedRealtime() >= deadline) throw busy; Thread.sleep(10) }
        }
      } finally { context.unbindService(heldConnection) }
      for (stage in SageIntentJournalStore.Step.values()) {
        SageIntentJournalStore.acquire(root).use { it.replace(old) }
        val (writerConnection, writer) = child(root, true, stage.name)
        try {
          check(writer.getString("state") == "acquired")
          val pid = writer.getInt("pid"); check(pid > 0 && pid != Process.myPid()); Process.killProcess(pid)
          val deadline = SystemClock.elapsedRealtime() + 5000
          while (true) {
            try {
              SageIntentJournalStore.acquire(root).use {
                check(it.read()!!.contentEquals(if (stage == SageIntentJournalStore.Step.TEMPORARY_SYNCED) old else next))
              }; break
            } catch (busy: SageIntentJournalStore.Busy) { if (SystemClock.elapsedRealtime() >= deadline) throw busy; Thread.sleep(10) }
          }
        } finally { context.unbindService(writerConnection) }
      }
      val orphan = File(root, "orphan"); check(orphan.mkdir()); File(orphan, "journal-stale.tmp").writeBytes(old)
      SageIntentJournalStore.acquire(orphan).use { fails { it.read() }; fails { it.replace(next) } }
      val swapped = File(root.parentFile, root.name + "-swap")
      var substitutionCompleted = false
      val wrongDirectory = SageIntentJournalStore.acquire(root) { step ->
        if (step == SageIntentJournalStore.Step.RENAMED) {
          check(root.renameTo(swapped)); check(root.mkdir())
          substitutionCompleted = true
        }
      }
      try {
        var rejectedDirectory = false
        try { wrongDirectory.replace(next) }
        catch (failure: IOException) {
          check(failure.message == "journal directory changed")
          rejectedDirectory = true
        }
        check(substitutionCompleted && rejectedDirectory)
        fails { wrongDirectory.read() }
      }
      finally {
        try { wrongDirectory.close() }
        finally { if (swapped.exists()) { check(root.delete()); check(swapped.renameTo(root)) } }
      }
      val moved = File(root.parentFile, root.name + "-moved")
      val displaced = SageIntentJournalStore.acquire(root); check(root.renameTo(moved))
      try { fails { displaced.read() }; displaced.close() } finally { check(moved.renameTo(root)) }
    } finally { root.deleteRecursively() }
  }
}
