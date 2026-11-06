const { withAndroidManifest, withMainApplication, withDangerousMod } = require("@expo/config-plugins");
const fs = require("fs");
const path = require("path");

const kotlinFiles = {
  "TasklyAlarmModule.kt": `package com.taskly.app

import android.app.AlarmManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.provider.Settings
import com.facebook.react.bridge.*
import com.facebook.react.ReactPackage
import com.facebook.react.uimanager.ViewManager
import org.json.JSONObject

class TasklyAlarmModule(private val ctx: ReactApplicationContext) : ReactContextBaseJavaModule(ctx) {
  override fun getName() = "TasklyAlarm"

  @ReactMethod fun scheduleAlarm(json: String, promise: Promise) {
    try {
      val data = JSONObject(json)
      val id = data.getString("id")
      val prefs = ctx.getSharedPreferences("taskly_alarms", Context.MODE_PRIVATE)
      prefs.edit().putString(id, data.toString()).apply()
      val alarm = ctx.getSystemService(Context.ALARM_SERVICE) as AlarmManager
      if (Build.VERSION.SDK_INT >= 31 && !alarm.canScheduleExactAlarms()) {
        val settings = Intent(Settings.ACTION_REQUEST_SCHEDULE_EXACT_ALARM,
          Uri.parse("package:" + ctx.packageName)).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        ctx.startActivity(settings)
        promise.reject("EXACT_ALARM_PERMISSION", "Allow alarms and reminders for TASKLY, then save the task again.")
        return
      }
      schedule(ctx, id, data.getLong("triggerAt"), false)
      promise.resolve(true)
    } catch (e: Exception) { promise.reject("SCHEDULE_FAILED", e.message, e) }
  }

  @ReactMethod fun cancelAlarm(id: String, promise: Promise) {
    cancel(ctx, id, false)
    cancel(ctx, id, true)
    ctx.getSharedPreferences("taskly_alarms", Context.MODE_PRIVATE).edit().remove(id).apply()
    promise.resolve(true)
  }

  @ReactMethod fun stopAlarm(promise: Promise) {
    ctx.startService(Intent(ctx, TasklyAlarmService::class.java).setAction("STOP"))
    promise.resolve(true)
  }

  companion object {
    fun schedule(context: Context, id: String, at: Long, snooze: Boolean) {
      val intent = Intent(context, TasklyAlarmReceiver::class.java).apply {
        action = "com.taskly.app.ALARM"
        putExtra("taskId", id)
        putExtra("snooze", snooze)
      }
      val code = (id + if (snooze) "_snooze" else "").hashCode()
      val pending = PendingIntent.getBroadcast(context, code, intent,
        PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
      val manager = context.getSystemService(Context.ALARM_SERVICE) as AlarmManager
      if (Build.VERSION.SDK_INT >= 23) manager.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, at, pending)
      else manager.setExact(AlarmManager.RTC_WAKEUP, at, pending)
    }

    fun cancel(context: Context, id: String, snooze: Boolean) {
      val intent = Intent(context, TasklyAlarmReceiver::class.java).apply { action = "com.taskly.app.ALARM" }
      val code = (id + if (snooze) "_snooze" else "").hashCode()
      val pending = PendingIntent.getBroadcast(context, code, intent,
        PendingIntent.FLAG_NO_CREATE or PendingIntent.FLAG_IMMUTABLE)
      if (pending != null) {
        (context.getSystemService(Context.ALARM_SERVICE) as AlarmManager).cancel(pending)
        pending.cancel()
      }
    }
  }
}

class TasklyAlarmPackage : ReactPackage {
  override fun createNativeModules(context: ReactApplicationContext) =
    listOf(TasklyAlarmModule(context))
  override fun createViewManagers(context: ReactApplicationContext): List<ViewManager<*, *>> = emptyList()
}`,
  "TasklyAlarmReceiver.kt": `package com.taskly.app

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import org.json.JSONObject
import java.util.Calendar

class TasklyAlarmReceiver : BroadcastReceiver() {
  override fun onReceive(context: Context, intent: Intent) {
    val id = intent.getStringExtra("taskId") ?: return
    val snooze = intent.getBooleanExtra("snooze", false)
    if (!snooze) {
      val raw = context.getSharedPreferences("taskly_alarms", Context.MODE_PRIVATE).getString(id, null)
      if (raw != null) {
        try {
          val task = JSONObject(raw)
          val next = nextOccurrence(task)
          if (next > System.currentTimeMillis() && task.optString("repeat", "once") != "once") {
            task.put("triggerAt", next)
            context.getSharedPreferences("taskly_alarms", Context.MODE_PRIVATE)
              .edit().putString(id, task.toString()).apply()
            TasklyAlarmModule.schedule(context, id, next, false)
          }
        } catch (_: Exception) {}
      }
    }
    val service = Intent(context, TasklyAlarmService::class.java)
      .setAction("RING").putExtra("taskId", id).putExtra("snooze", snooze)
    if (android.os.Build.VERSION.SDK_INT >= 26) context.startForegroundService(service)
    else context.startService(service)
  }

  private fun nextOccurrence(task: JSONObject): Long {
    val base = Calendar.getInstance().apply { timeInMillis = task.getLong("triggerAt") }
    val repeat = task.optString("repeat", "once")
    if (repeat == "daily") base.add(Calendar.DAY_OF_YEAR, 1)
    else if (repeat == "weekly") base.add(Calendar.DAY_OF_YEAR, 7)
    else if (repeat == "custom") {
      val days = task.optJSONArray("days")
      if (days != null && days.length() > 0) {
        for (offset in 1..7) {
          val candidate = Calendar.getInstance().apply {
            timeInMillis = task.getLong("triggerAt")
            add(Calendar.DAY_OF_YEAR, offset)
          }
          var match = false
          for (i in 0 until days.length()) {
            if (candidate.get(Calendar.DAY_OF_WEEK) - 1 == days.optInt(i)) match = true
          }
          if (match) return candidate.timeInMillis
        }
      }
      base.add(Calendar.DAY_OF_YEAR, 7)
    }
    return base.timeInMillis
  }
}`,
  "TasklyAlarmService.kt": `package com.taskly.app

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
}`,
  "TasklyAlarmActivity.kt": `package com.taskly.app

import android.app.Activity
import android.content.Intent
import android.os.Build
import android.os.Bundle
import android.view.Gravity
import android.view.WindowManager
import android.widget.Button
import android.widget.LinearLayout
import android.widget.TextView

class TasklyAlarmActivity : Activity() {
  override fun onCreate(savedInstanceState: Bundle?) {
    super.onCreate(savedInstanceState)
    if (Build.VERSION.SDK_INT >= 27) {
      setShowWhenLocked(true)
      setTurnScreenOn(true)
    } else {
      window.addFlags(WindowManager.LayoutParams.FLAG_SHOW_WHEN_LOCKED or
        WindowManager.LayoutParams.FLAG_TURN_SCREEN_ON or WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
    }
    window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
    val id = intent.getStringExtra("taskId") ?: ""
    val root = LinearLayout(this).apply {
      orientation = LinearLayout.VERTICAL
      gravity = Gravity.CENTER
      setPadding(32, 32, 32, 32)
      setBackgroundColor(android.graphics.Color.rgb(48, 25, 52))
    }
    root.addView(TextView(this).apply {
      text = "TASKLY"
      textSize = 30f
      setTextColor(android.graphics.Color.WHITE)
      gravity = Gravity.CENTER
    })
    root.addView(TextView(this).apply {
      text = "It's time."
      textSize = 24f
      setTextColor(android.graphics.Color.rgb(255, 122, 69))
      gravity = Gravity.CENTER
      setPadding(0, 28, 0, 36)
    })
    root.addView(Button(this).apply {
      text = "SNOOZE · 5 MIN"
      setOnClickListener {
        startService(Intent(this@TasklyAlarmActivity, TasklyAlarmService::class.java)
          .setAction("SNOOZE").putExtra("taskId", id))
        finish()
      }
    })
    root.addView(Button(this).apply {
      text = "STOP"
      setOnClickListener {
        startService(Intent(this@TasklyAlarmActivity, TasklyAlarmService::class.java).setAction("STOP"))
        finish()
      }
    })
    setContentView(root)
  }
}`,
  "TasklyBootReceiver.kt": `package com.taskly.app

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import org.json.JSONObject

class TasklyBootReceiver : BroadcastReceiver() {
  override fun onReceive(context: Context, intent: Intent) {
    if (intent.action != Intent.ACTION_BOOT_COMPLETED &&
        intent.action != "android.intent.action.MY_PACKAGE_REPLACED") return
    val prefs = context.getSharedPreferences("taskly_alarms", Context.MODE_PRIVATE)
    for ((id, raw) in prefs.all) {
      if (raw is String) try {
        val task = JSONObject(raw)
        val trigger = task.optLong("triggerAt", 0L)
        if (trigger > System.currentTimeMillis()) TasklyAlarmModule.schedule(context, id, trigger, false)
      } catch (_: Exception) {}
    }
  }
}`
};

module.exports = function withTasklyAlarm(config) {
  config = withAndroidManifest(config, config => {
    const manifest = config.modResults.manifest;
    manifest['uses-permission'] = manifest['uses-permission'] || [];
    const permissions = [
      'android.permission.SCHEDULE_EXACT_ALARM',
      'android.permission.RECEIVE_BOOT_COMPLETED',
      'android.permission.FOREGROUND_SERVICE',
      'android.permission.FOREGROUND_SERVICE_MEDIA_PLAYBACK',
      'android.permission.USE_FULL_SCREEN_INTENT',
      'android.permission.POST_NOTIFICATIONS',
      'android.permission.VIBRATE'
    ];
    for (const name of permissions) {
      if (!manifest['uses-permission'].some(p => p.$['android:name'] === name)) {
        manifest['uses-permission'].push({ $: { 'android:name': name } });
      }
    }
    const app = manifest.application[0];
    app.service = app.service || [];
    app.receiver = app.receiver || [];
    app.activity = app.activity || [];
    const add = (list, name, props = {}) => {
      if (!list.some(x => x.$['android:name'] === name)) list.push({ $: { 'android:name': name, ...props } });
    };
    add(app.service, '.TasklyAlarmService', {
      'android:exported': 'false',
      'android:foregroundServiceType': 'mediaPlayback'
    });
    add(app.receiver, '.TasklyAlarmReceiver', { 'android:exported': 'false' });
    add(app.receiver, '.TasklyBootReceiver', { 'android:enabled': 'true', 'android:exported': 'true' });
    const boot = app.receiver.find(x => x.$['android:name'] === '.TasklyBootReceiver');
    boot['intent-filter'] = [{ action: [{ $: { 'android:name': 'android.intent.action.BOOT_COMPLETED' } }, { $: { 'android:name': 'android.intent.action.MY_PACKAGE_REPLACED' } }] }];
    add(app.activity, '.TasklyAlarmActivity', {
      'android:exported': 'false',
      'android:excludeFromRecents': 'true',
      'android:launchMode': 'singleTop',
      'android:showWhenLocked': 'true',
      'android:turnScreenOn': 'true',
      'android:theme': '@android:style/Theme.Material.Light.NoActionBar'
    });
    return config;
  });

  config = withMainApplication(config, config => {
    let src = config.modResults.contents;
    if (!src.includes('add(TasklyAlarmPackage())')) {
      src = src.replace(
        /PackageList\(this\)\.packages\.apply\s*\{/,
        'PackageList(this).packages.apply {\n            add(TasklyAlarmPackage())'
      );
    }
    config.modResults.contents = src;
    return config;
  });

  config = withDangerousMod(config, ['android', async config => {
    const root = path.join(config.modRequest.platformProjectRoot, 'app', 'src', 'main', 'java', 'com', 'taskly', 'app');
    fs.mkdirSync(root, { recursive: true });
    for (const [name, contents] of Object.entries(kotlinFiles)) {
      fs.writeFileSync(path.join(root, name), contents, 'utf8');
    }
    return config;
  }]);
  return config;
};
