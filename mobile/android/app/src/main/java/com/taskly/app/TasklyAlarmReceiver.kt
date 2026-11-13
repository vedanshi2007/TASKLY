package com.taskly.app

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
}