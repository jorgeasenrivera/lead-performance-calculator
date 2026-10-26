package com.sageonline.sagelive

import android.system.ErrnoException
import android.system.Os
import android.system.OsConstants
import java.io.Closeable
import java.io.File
import java.io.FileInputStream
import java.io.FileOutputStream
import java.io.IOException
import java.io.StringReader
import android.util.JsonReader
import android.util.JsonToken
import java.nio.channels.FileLock
import java.nio.channels.OverlappingFileLockException
import java.util.UUID
import org.json.JSONArray
import org.json.JSONObject
import org.json.JSONTokener

// Storage only. Not exposed by SageLiveModule or used by notifications/receivers.
internal object SageIntentJournalStore {
  class Busy : IOException("journal is owned")
  class InvalidDocument : IOException("invalid journal envelope")
  enum class Step { TEMPORARY_SYNCED, RENAMED }
  private val registry = mutableSetOf<Pair<Long, Long>>()

  // Retain across async work and close in finally. No timeout, lease or lock steal.
  // Methods serialize on this owner, but acquisition never waits or reenters.
  class Owner internal constructor(
    private val directory: File,
    private val stream: FileOutputStream,
    private val lock: FileLock,
    private val device: Long,
    private val inode: Long,
    private val checkpoint: (Step) -> Unit
  ) : Closeable {
    private var closed = false
    private var poisoned = false

    @Synchronized fun read(): ByteArray? { requireOpen(); return readLocked() }

    @Synchronized fun replace(input: ByteArray) {
      requireOpen()
      val bytes = input.copyOf()
      validate(bytes)
      readLocked() // Never replace corrupt/unreadable old bytes with a fresh journal.
      val temporary = File(directory, "journal-${UUID.randomUUID()}.tmp")
      try {
        val fd = Os.open(temporary.path, OsConstants.O_WRONLY or OsConstants.O_CREAT or OsConstants.O_EXCL or OsConstants.O_CLOEXEC or OsConstants.O_NOFOLLOW, 384)
        FileOutputStream(fd).use { output -> output.write(bytes); output.flush(); Os.fsync(fd) }
        checkpoint(Step.TEMPORARY_SYNCED)
        checkDirectory()
        Os.rename(temporary.path, File(directory, "journal.json").path)
        checkpoint(Step.RENAMED)
        val dirFD = Os.open(directory.path, OsConstants.O_RDONLY or OsConstants.O_CLOEXEC or OsConstants.O_NOFOLLOW, 0)
        try {
          // O_DIRECTORY is not exposed by the Android SDK. Validate the opened
          // descriptor before syncing so replacement cannot sync another inode.
          val info = Os.fstat(dirFD)
          if (!OsConstants.S_ISDIR(info.st_mode) || info.st_dev != device || info.st_ino != inode) throw IOException("journal directory changed")
          Os.fsync(dirFD)
        } finally { Os.close(dirFD) }
      } catch (failure: Throwable) {
        // Rename might already have happened. No deletion, reset or rollback.
        poisoned = true
        throw failure
      }
    }

    @Synchronized override fun close() {
      if (closed) return
      closed = true
      // Closing the channel releases the kernel lock. Never unlink journal.lock.
      // The JVM also rejects overlapping FileChannel locks within this process.
      stream.close()
      synchronized(registry) { registry.remove(device to inode) }
    }

    private fun requireOpen() {
      if (closed || poisoned || !lock.isValid) throw IOException("journal owner is closed or faulted")
    }

    private fun readLocked(): ByteArray? {
      checkDirectory()
      val fd = try {
        Os.open(File(directory, "journal.json").path, OsConstants.O_RDONLY or OsConstants.O_CLOEXEC or OsConstants.O_NOFOLLOW, 0)
      } catch (e: ErrnoException) {
        if (e.errno == OsConstants.ENOENT) {
          checkDirectory()
          val names = directory.list() ?: throw IOException("cannot inspect absent journal")
          if (names.any { it.startsWith("journal-") && it.endsWith(".tmp") }) throw IOException("orphan temporary journal requires review")
          return null
        }
        throw e
      }
      return FileInputStream(fd).use { input ->
        if (!OsConstants.S_ISREG(Os.fstat(fd).st_mode)) throw InvalidDocument()
        input.readBytes().also { validate(it) }
      }
    }

    private fun checkDirectory() {
      val info = Os.lstat(directory.path)
      if (!OsConstants.S_ISDIR(info.st_mode) || info.st_dev != device || info.st_ino != inode) throw IOException("journal directory changed")
    }
  }

  fun acquire(directory: File, checkpoint: (Step) -> Unit = {}): Owner {
    if (directory.absoluteFile != directory.canonicalFile || !OsConstants.S_ISDIR(Os.lstat(directory.path).st_mode)) throw IOException("dedicated real directory required")
    val canonical = directory.canonicalFile
    val identity = Os.lstat(canonical.path)
    // Closing any second descriptor of a POSIX record-lock inode can release
    // this process's lock. Reject reentry BEFORE opening that inode again.
    val key = identity.st_dev to identity.st_ino
    synchronized(registry) { if (!registry.add(key)) throw Busy() }
    var stream: FileOutputStream? = null
    var retained = false
    try {
      val fd = Os.open(File(canonical, "journal.lock").path, OsConstants.O_RDWR or OsConstants.O_CREAT or OsConstants.O_CLOEXEC or OsConstants.O_NOFOLLOW, 384)
      val acquired = FileOutputStream(fd)
      stream = acquired
      if (!OsConstants.S_ISREG(Os.fstat(fd).st_mode)) throw IOException("regular lock inode required")
      val lock = try { acquired.channel.tryLock() } catch (_: OverlappingFileLockException) { throw Busy() }
      if (lock == null) throw Busy()
      val owner = Owner(canonical, acquired, lock, identity.st_dev, identity.st_ino, checkpoint)
      retained = true
      return owner
    } catch (failure: Throwable) {
      try { stream?.close() } catch (closing: Throwable) {
        retained = true // Descriptor release is uncertain: quarantine until process death.
        failure.addSuppressed(closing)
      }
      throw failure
    } finally {
      if (!retained) synchronized(registry) { registry.remove(key) }
    }
  }

  private fun validate(bytes: ByteArray) {
    // Reject malformed UTF-8 rather than silently replacing bad input characters.
    val decoder = Charsets.UTF_8.newDecoder()
    val text = decoder.decode(java.nio.ByteBuffer.wrap(bytes)).toString()
    // org.json alone accepts non-JSON syntax. Refuse it before decoding the envelope.
    JsonReader(StringReader(text)).use { reader ->
      reader.isLenient = false
      fun consume() {
        when (reader.peek()) {
          JsonToken.BEGIN_OBJECT -> {
            reader.beginObject(); val names = mutableSetOf<String>()
            while (reader.hasNext()) { if (!names.add(reader.nextName())) throw InvalidDocument(); consume() }
            reader.endObject()
          }
          JsonToken.BEGIN_ARRAY -> { reader.beginArray(); while (reader.hasNext()) consume(); reader.endArray() }
          JsonToken.STRING -> reader.nextString()
          JsonToken.NUMBER -> if (!reader.nextString().toDouble().isFinite()) throw InvalidDocument()
          JsonToken.BOOLEAN -> reader.nextBoolean()
          JsonToken.NULL -> reader.nextNull()
          else -> throw InvalidDocument()
        }
      }
      consume()
      if (reader.peek() != JsonToken.END_DOCUMENT) throw InvalidDocument()
    }
    val parser = JSONTokener(text)
    val root = parser.nextValue() as? JSONObject ?: throw InvalidDocument()
    if (parser.nextClean() != '\u0000') throw InvalidDocument()
    if (root.keys().asSequence().toSet() != setOf("format", "revision", "records")) throw InvalidDocument()
    val format = root.get("format") as? Number ?: throw InvalidDocument()
    val revision = root.get("revision") as? Number ?: throw InvalidDocument()
    val rev = revision.toDouble()
    if (format.toDouble() != 1.0 || !rev.isFinite() || rev < 0 || rev > 9007199254740991.0 || kotlin.math.floor(rev) != rev) throw InvalidDocument()
    val records = root.get("records") as? JSONArray ?: throw InvalidDocument()
    for (i in 0 until records.length()) if (records.get(i) !is JSONObject) throw InvalidDocument()
    val unsafe = Regex("token|password|secret|authorization|credential|__proto__|constructor|prototype", RegexOption.IGNORE_CASE)
    fun inspect(value: Any?) {
      when (value) {
        is JSONObject -> for (key in value.keys()) { if (unsafe.containsMatchIn(key)) throw InvalidDocument(); inspect(value.get(key)) }
        is JSONArray -> for (i in 0 until value.length()) inspect(value.get(i))
      }
    }
    inspect(root)
  }
}
