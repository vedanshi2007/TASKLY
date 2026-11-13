package com.taskly.app

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
}