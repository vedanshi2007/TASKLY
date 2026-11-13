package com.taskly.app

import android.app.*
import android.content.Context
import android.content.Intent
import android.media.AudioAttributes
import android.media.MediaPlayer
import android.os.Build
import android.os.IBinder
import androidx.core.app.NotificationCompat

class TasklyAlarmService : Service() {
  private var player: MediaPlayer? = null
  override fun onBind(intent: Intent?): IBinder? = null

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    if (intent?.action == "STOP") { stopRinging(); return START_NOT_STICKY }
    if (intent?.action == "SNOOZE") {
      val id = intent.getStringExtra("taskId") ?: ""
      stopRinging()
      if (id.isNotBlank()) TasklyAlarmModule.schedule(this, id, System.currentTimeMillis() + 5 * 60 * 1000L, true)
      return START_NOT_STICKY
    }
    val id = intent?.getStringExtra("taskId") ?: ""
    val snooze = intent?.getBooleanExtra("snooze", false) ?: false
    val raw = getSharedPreferences("taskly_alarms", Context.MODE_PRIVATE).getString(id, null)
    val sound = try { org.json.JSONObject(raw ?: "{}").optString("sound", "high") } catch (_: Exception) { "high" }
    startForeground(4107, buildNotification(id))
    if (sound != "silent") startLoop(sound)
    try {
      val screen = Intent(this, TasklyAlarmActivity::class.java)
        .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP)
        .putExtra("taskId", id)
      startActivity(screen)
    } catch (_: Exception) {}
    return START_STICKY
  }

  private fun startLoop(sound: String) {
    try {
      player?.release()
      player = MediaPlayer.create(this, R.raw.taskly_alarm)
      player?.setAudioAttributes(AudioAttributes.Builder()
        .setUsage(AudioAttributes.USAGE_ALARM)
        .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION).build())
      player?.isLooping = true
      player?.setVolume(if (sound == "low") 0.35f else 1f, if (sound == "low") 0.35f else 1f)
      player?.start()
    } catch (_: Exception) {}
  }

  private fun buildNotification(id: String): Notification {
    val channel = "taskly_alarm_ring"
    if (Build.VERSION.SDK_INT >= 26) {
      val manager = getSystemService(NotificationManager::class.java)
      manager.createNotificationChannel(NotificationChannel(channel, "TASKLY alarm", NotificationManager.IMPORTANCE_HIGH).apply {
        description = "Active TASKLY deadline alarm"
        lockscreenVisibility = Notification.VISIBILITY_PUBLIC
      })
    }
    val stop = PendingIntent.getService(this, 1, Intent(this, TasklyAlarmService::class.java).setAction("STOP"),
      PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
    val snooze = PendingIntent.getService(this, 2, Intent(this, TasklyAlarmService::class.java)
      .setAction("SNOOZE").putExtra("taskId", id), PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
    val full = PendingIntent.getActivity(this, 3, Intent(this, TasklyAlarmActivity::class.java)
      .putExtra("taskId", id).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP),
      PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
    return NotificationCompat.Builder(this, channel)
      .setSmallIcon(android.R.drawable.ic_lock_idle_alarm)
      .setContentTitle("TASKLY · Time's up")
      .setContentText("Your task deadline has arrived")
      .setCategory(NotificationCompat.CATEGORY_ALARM).setPriority(NotificationCompat.PRIORITY_MAX)
      .setOngoing(true).setAutoCancel(false).setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
      .setFullScreenIntent(full, true)
      .addAction(android.R.drawable.ic_media_pause, "STOP", stop)
      .addAction(android.R.drawable.ic_lock_idle_alarm, "SNOOZE 5 MIN", snooze).build()
  }

  private fun stopRinging() {
    try { player?.stop() } catch (_: Exception) {}
    player?.release(); player = null
    stopForeground(STOP_FOREGROUND_REMOVE)
    stopSelf()
  }
  override fun onDestroy() { try { player?.release() } catch (_: Exception) {}; player = null; super.onDestroy() }
}