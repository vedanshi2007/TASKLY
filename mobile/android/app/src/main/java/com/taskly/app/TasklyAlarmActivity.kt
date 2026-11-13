package com.taskly.app

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
    val savedTask = getSharedPreferences("taskly_alarms", MODE_PRIVATE).getString(id, null)
    val taskName = try {
      org.json.JSONObject(savedTask ?: "{}").optString("name", "It's time.")
        .takeIf { it.isNotBlank() } ?: "It's time."
    } catch (_: Exception) { "It's time." }
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
      text = taskName
      textSize = 24f
      setTextColor(android.graphics.Color.rgb(255, 122, 69))
      gravity = Gravity.CENTER
      maxLines = 3
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
}