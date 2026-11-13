package com.taskly.app

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
}