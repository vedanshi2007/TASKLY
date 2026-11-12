import React, { useEffect, useRef, useState } from "react";
import {
  Alert, KeyboardAvoidingView, NativeModules, Platform, Pressable,
  SafeAreaView, ScrollView, StyleSheet, Text, TextInput, View
} from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Notifications from "expo-notifications";

const KEY = "taskly_mobile_tasks_v2";
const NativeAlarm = NativeModules.TasklyAlarm;
const INTRO_KEY = "taskly_intro_seen_v1";
const SOUNDS = ["silent", "low", "high"];
const REPEATS = ["once", "daily", "weekly", "custom"];
const WEEKDAYS = [{label:"Sun",value:0},{label:"Mon",value:1},{label:"Tue",value:2},{label:"Wed",value:3},{label:"Thu",value:4},{label:"Fri",value:5},{label:"Sat",value:6}];

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true, shouldPlaySound: true, shouldSetBadge: false,
    shouldShowBanner: true, shouldShowList: true
  })
});

const makeId = () => Date.now().toString() + Math.random().toString(16).slice(2);
const pad = n => String(n).padStart(2, "0");
const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;
};
const validDate = value => /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(new Date(value + "T12:00:00").getTime());
const to24Hour = value => {
  const text = String(value || "").trim().toUpperCase();
  const parts = text.match(/^(0?[1-9]|1[0-2]):([0-5]\d)\s*(AM|PM)$/);
  if (parts) {
    let hour = Number(parts[1]) % 12;
    if (parts[3] === "PM") hour += 12;
    return pad(hour) + ":" + parts[2];
  }
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(text) ? text : null;
};
const to12Hour = value => {
  const normalized = to24Hour(value);
  if (!normalized) return value || "";
  const parts = normalized.split(":").map(Number);
  return (parts[0] % 12 || 12) + ":" + pad(parts[1]) + (parts[0] >= 12 ? " PM" : " AM");
};
const dueDate = task => new Date(task.date + "T" + (to24Hour(task.time) || "00:00") + ":00");

let notificationPermissionGranted = false;
let notificationSetupPromise = null;

async function setupNotifications() {
  if (notificationSetupPromise) return notificationSetupPromise;
  notificationSetupPromise = (async () => {
    const permission = await Notifications.requestPermissionsAsync();
    notificationPermissionGranted = permission.granted;
    if (!notificationPermissionGranted) return false;
    if (Platform.OS === "android") {
      const channels = [
        { id:"taskly-silent", name:"Silent reminders", importance:Notifications.AndroidImportance.LOW, sound:null, vibrationPattern:[] },
        { id:"taskly-low-v4", name:"Low reminders", importance:Notifications.AndroidImportance.HIGH, sound:"taskly_alarm.wav", vibrationPattern:[0,250] },
        { id:"taskly-high-v4", name:"High reminders", importance:Notifications.AndroidImportance.MAX, sound:"taskly_alarm.wav", vibrationPattern:[0,500,250,500,250,500] }
      ];
      await Promise.all(channels.map(channel =>
        Notifications.setNotificationChannelAsync(channel.id, channel)
      ));
    }
    return true;
  })().catch(error => {
    notificationSetupPromise = null;
    throw error;
  });
  return notificationSetupPromise;
}

function futureDates(task, limit = 14) {
  const first = dueDate(task);
  const dates = [];
  const now = new Date();
  for (let i = 0; i < 370 && dates.length < limit; i++) {
    const d = new Date(first);
    d.setDate(first.getDate() + i);
    const matches = task.repeat === "once" ? i === 0 :
      task.repeat === "daily" ? true :
      task.repeat === "weekly" ? d.getDay() === first.getDay() :
      (task.days || []).includes(d.getDay());
    if (matches && d > now) dates.push(d);
    if (task.repeat === "once") break;
  }
  return dates;
}

async function cancelTaskNotifications(task) {
  if (Platform.OS === "android" && NativeAlarm) {
    try { await NativeAlarm.cancelAlarm(String(task.id)); } catch (error) {
      console.warn("TASKLY native alarm cancellation failed:", error);
    }
  }
  await Promise.all((task.notificationIds || []).map(id =>
    Notifications.cancelScheduledNotificationAsync(id).catch(() => {})
  ));
}

async function scheduleTask(task) {
  if (task.done) return [];
  if (Platform.OS === "android" && NativeAlarm) {
    const due = dueDate(task);
    const triggerAt = due.getTime() - (Number(task.reminder) || 0) * 60000;
    try {
      await NativeAlarm.scheduleAlarm(JSON.stringify({
        id: String(task.id), name: task.name, date: task.date,
        time: to24Hour(task.time), repeat: task.repeat || "once",
        days: task.days || [], sound: task.sound || "high",
        triggerAt: Math.max(triggerAt, Date.now() + 1000)
      }));
      return [];
    } catch (error) {
      console.warn("TASKLY native alarm scheduling failed:", error);
      Alert.alert("Alarm could not be scheduled", "Please allow exact alarms for TASKLY in Android settings.");
      return [];
    }
  }
  if (!notificationPermissionGranted) return [];

  const reminders = futureDates(task).map(due => {
    const reminderAt = new Date(due.getTime() - (Number(task.reminder) || 0) * 60000);
    const triggerAt = reminderAt > new Date() ? reminderAt : due;
    if (triggerAt <= new Date()) return null;

    const channelId = task.sound === "silent"
      ? "taskly-silent"
      : task.sound === "high"
        ? "taskly-high-v4"
        : "taskly-low-v4";

    return {
      content: {
        title: "TASKLY · Deadline reminder",
        body: task.name,
        sound: task.sound === "silent" ? null : "taskly_alarm.wav",
        data: { taskId: task.id }
      },
      trigger: Platform.OS === "android"
        ? { type: Notifications.SchedulableTriggerInputTypes.DATE, date: triggerAt, channelId }
        : { type: Notifications.SchedulableTriggerInputTypes.DATE, date: triggerAt }
    };
  }).filter(Boolean);

  const ids = [];
  for (const reminder of reminders) {
    try {
      const id = await Notifications.scheduleNotificationAsync(reminder);
      ids.push(id);
    } catch (error) {
      console.warn("TASKLY could not schedule one reminder:", error);
    }
  }
  return ids;
}

export default function App() {
  const [tasks, setTasks] = useState([]);
  const [ready, setReady] = useState(false);
  const [introSeen, setIntroSeen] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [name, setName] = useState("");
  const [date, setDate] = useState(today());
  const [time, setTime] = useState("6:00 PM");
  const [ampm, setAmpm] = useState("PM");
  const [ampmOpen, setAmpmOpen] = useState(false);
  const [calendarOpen, setCalendarOpen] = useState(false);
  const [calendarMonth, setCalendarMonth] = useState(new Date());
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);
  const [repeat, setRepeat] = useState("once");
  const [days, setDays] = useState([]);
  const [reminder, setReminder] = useState("15");
  const [sound, setSound] = useState("high");
  const [priority, setPriority] = useState("medium");
  const [editingId, setEditingId] = useState(null);
  const [filter, setFilter] = useState("all");

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const [saved, intro] = await Promise.all([
          AsyncStorage.getItem(KEY), AsyncStorage.getItem(INTRO_KEY)
        ]);
        const loaded = saved ? JSON.parse(saved) : [];
        if (!active) return;
        setTasks(loaded);
        setIntroSeen(intro === "yes");
        if (Platform.OS !== "android" || !NativeAlarm) await setupNotifications();
        const refreshed = [];
        for (const task of loaded) {
          if (!task.done) {
            await cancelTaskNotifications(task);
            task.notificationIds = await scheduleTask(task);
          }
          refreshed.push(task);
        }
        if (active) {
          setTasks(refreshed);
          await AsyncStorage.setItem(KEY, JSON.stringify(refreshed));
        }
      } catch (e) {
        Alert.alert("Could not load tasks", "Please close and reopen TASKLY.");
      } finally {
        if (active) setReady(true);
      }
    })();
    return () => { active = false; };
  }, []);

  async function saveTasks(next) {
    setTasks(next);
    await AsyncStorage.setItem(KEY, JSON.stringify(next));
  }

  async function startApp() {
    await AsyncStorage.setItem(INTRO_KEY, "yes");
    setIntroSeen(true);
  }

  function resetForm() {
    setName(""); setDate(today()); setTime("6:00 PM"); setAmpm("PM"); setAmpmOpen(false); setCalendarOpen(false); setCalendarMonth(new Date()); setRepeat("once");
    setDays([]); setReminder("15"); setSound("high"); setPriority("medium");
    setEditingId(null);
  }

  async function saveTask() {
    if (!name.trim()) return Alert.alert("Task name needed", "Enter what you need to do.");
    const time24 = to24Hour(time);
    if (!validDate(date) || !time24) return Alert.alert("Check date and time", "Enter the date as YYYY-MM-DD and time like 6:30 PM.");
    if (repeat === "custom" && days.length === 0) return Alert.alert("Choose days", "Select at least one day for a custom repeat.");
    if (repeat === "once" && dueDate({date,time:time24}) <= new Date()) return Alert.alert("Choose a future time", "The deadline must be in the future.");
    if (savingRef.current) return;
    savingRef.current = true;
    setSaving(true);
    const old = tasks.find(t => t.id === editingId);
    const task = {
      id: editingId || makeId(), name:name.trim(), date, time:time24, repeat, days,
      reminder:Number(reminder), sound, priority, done:old?.done ?? false,
      created:old?.created || Date.now(), notificationIds:[]
    };
    const next = old ? tasks.map(t => t.id === old.id ? task : t) : [task, ...tasks];

    try {
      await saveTasks(next);
    } catch (error) {
      savingRef.current = false;
      setSaving(false);
      Alert.alert("Save failed", "Please check your device storage and try again.");
      return;
    }

    resetForm();
    setShowForm(false);
    savingRef.current = false;
    setSaving(false);
    Alert.alert("Saved", "Your task has been saved on this device.");

    void (async () => {
      try {
        if (old) await cancelTaskNotifications(old);
        const ids = await scheduleTask(task);
        const latest = next.map(item =>
          item.id === task.id ? {...item, notificationIds:ids} : item
        );
        setTasks(latest);
        await AsyncStorage.setItem(KEY, JSON.stringify(latest));
      } catch (error) {
        console.warn("TASKLY reminder scheduling failed:", error);
      }
    })();
  }

  function editTask(task) {
    setEditingId(task.id); setName(task.name); setDate(task.date); setTime(to12Hour(task.time)); setAmpm(to12Hour(task.time).slice(-2)); setAmpmOpen(false); setCalendarMonth(new Date(task.date + "T12:00:00")); setCalendarOpen(false);
    setRepeat(task.repeat || "once"); setDays(task.days || []);
    setReminder(String(task.reminder ?? 15)); setSound(task.sound || "low");
    setPriority(task.priority || "medium");
    setShowForm(true);
  }

  async function toggleTask(task) {
    const updated = {...task, done:!task.done, notificationIds:[]};
    const next = tasks.map(t => t.id === task.id ? updated : t);
    try {
      await saveTasks(next);
    } catch (error) {
      Alert.alert("Could not update task", "Please try again.");
      return;
    }
    if (updated.done) {
      await cancelTaskNotifications(task);
    } else {
      try {
        const ids = await scheduleTask(updated);
        const latest = next.map(t => t.id === updated.id ? {...t, notificationIds:ids} : t);
        setTasks(latest);
        await AsyncStorage.setItem(KEY, JSON.stringify(latest));
      } catch (error) {
        console.warn("TASKLY reminder scheduling failed:", error);
      }
    }
  }

  async function deleteTask(task) {
    await cancelTaskNotifications(task);
    await saveTasks(tasks.filter(t => t.id !== task.id));
    if (editingId === task.id) resetForm();
  }

  function choice(label, selected, onPress) {
    return <Pressable key={label} onPress={onPress} style={[styles.choice, selected && styles.choiceOn]}>
      <Text style={[styles.choiceText, selected && styles.choiceTextOn]}>{label.toUpperCase()}</Text>
    </Pressable>;
  }

  const visible = tasks.filter(t => filter === "all" ? true : filter === "pending" ? !t.done : t.done);
  const pendingCount = tasks.filter(t => !t.done).length;
  const doneCount = tasks.filter(t => t.done).length;
  const monthStart = new Date(calendarMonth.getFullYear(), calendarMonth.getMonth(), 1);
  const monthName = monthStart.toLocaleDateString("en-US", { month: "long", year: "numeric" });
  const calendarCells = [
    ...Array(monthStart.getDay()).fill(null),
    ...Array.from({length:new Date(calendarMonth.getFullYear(), calendarMonth.getMonth()+1, 0).getDate()}, (_, i) => i + 1)
  ];
  while (calendarCells.length % 7 !== 0) calendarCells.push(null);
  const selectedDay = date.slice(8, 10);

  if (!ready) return <SafeAreaView style={styles.loading}><Text style={styles.loadingBrand}>TASKLY</Text><Text style={styles.muted}>Getting your day ready…</Text></SafeAreaView>;

  if (!introSeen) {
    return (
      <SafeAreaView style={styles.welcomeScreen}>
        <View style={styles.welcomeTop}>
          <Text style={styles.welcomeBrand}>TASKLY</Text>
          <View style={styles.pill}><Text style={styles.pillText}>YOUR DAY, IN YOUR HANDS</Text></View>
        </View>
        <View style={styles.heroArt}>
          <View style={styles.orbitOne} />
          <View style={styles.orbitTwo} />
          <View style={styles.heroCard}>
            <View style={styles.heroCheck}><Text style={styles.heroCheckText}>✓</Text></View>
            <View style={styles.heroLines}><View style={styles.heroLineLong}/><View style={styles.heroLineShort}/></View>
            <View style={styles.heroBadge}><Text style={styles.heroBadgeText}>ON TIME</Text></View>
          </View>
          <View style={styles.sparkle}>✦</View>
          <View style={styles.sparkleSmall}>✧</View>
        </View>
        <View style={styles.welcomeCopy}>
          <Text style={styles.eyebrow}>LESS STRESS. MORE DONE.</Text>
          <Text style={styles.welcomeTitle}>Make room for{ "\n" }what matters.</Text>
          <Text style={styles.welcomeText}>Keep your tasks, deadlines and reminders together. Take one thing at a time — you've got this.</Text>
          <Pressable onPress={startApp} style={styles.getStarted}>
            <Text style={styles.getStartedText}>GET STARTED</Text>
            <Text style={styles.arrow}>→</Text>
          </Pressable>
          <Text style={styles.localNote}>PRIVATE BY DESIGN · SAVED ON THIS DEVICE</Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.screen}>
      <KeyboardAvoidingView style={styles.container} behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <ScrollView keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
          <View style={styles.topBar}>
            <View style={styles.brandGroup}>
              <Text style={styles.brand}>TASKLY</Text>
              <Text style={styles.muted}>Plan it. Do it. On time.</Text>
            </View>
            <View style={styles.avatar}><Text style={styles.avatarText}>V</Text></View>
          </View>

          <View style={styles.welcomePanel}>
            <View style={styles.panelDecor}/>
            <View style={styles.panelContent}>
              <View style={styles.panelCopy}>
                <Text style={styles.panelEyebrow}>GOOD TO SEE YOU! ✨</Text>
                <Text style={styles.panelTitle}>You've got this.</Text>
                <Text style={styles.panelSub}>Let's stay productive today ♡</Text>
              </View>
              <View style={styles.clockArt}>
                <View style={styles.clockBellLeft}/>
                <View style={styles.clockBellRight}/>
                <View style={styles.clockFace}>
                  <View style={styles.clockHandHour}/>
                  <View style={styles.clockHandMinute}/>
                  <View style={styles.clockCenter}/>
                </View>
                <View style={styles.clockLegLeft}/>
                <View style={styles.clockLegRight}/>
              </View>
            </View>
            <View style={styles.statsRow}>
              <View style={styles.statBox}><Text style={styles.statNumber}>{tasks.length}</Text><Text style={styles.statLabel}>TOTAL TASKS</Text></View>
              <View style={styles.statDivider}/>
              <View style={styles.statBox}><Text style={styles.statNumber}>{pendingCount}</Text><Text style={styles.statLabel}>PENDING</Text></View>
              <View style={styles.statDivider}/>
              <View style={styles.statBox}><Text style={styles.statNumber}>{doneCount}</Text><Text style={styles.statLabel}>DONE</Text></View>
            </View>
          </View>

          <View style={styles.sectionHeader}>
            <View><Text style={styles.sectionTitle}>Your Tasks</Text><Text style={styles.sectionHint}>One step at a time.</Text></View>
            <Pressable onPress={() => { resetForm(); setShowForm(!showForm); }} style={styles.newButton}>
              <Text style={styles.newButtonText}>{showForm ? "CLOSE" : "+ NEW TASK"}</Text>
            </Pressable>
          </View>

          {showForm && <View style={styles.form}>
            <Text style={styles.formTitle}>{editingId ? "EDIT YOUR TASK" : "CREATE A TASK"}</Text>
            <TextInput value={name} onChangeText={setName} placeholder="What do you need to do?" placeholderTextColor="#9B879D" style={styles.input}/>
            <Text style={styles.label}>DUE DATE</Text>
            <Pressable onPress={() => { setCalendarOpen(!calendarOpen); setAmpmOpen(false); }} style={styles.dateButton}>
              <Text style={styles.dateButtonIcon}>▦</Text>
              <Text style={styles.dateButtonText}>{new Date(date + "T12:00:00").toLocaleDateString("en-US", {day:"numeric", month:"long", year:"numeric"})}</Text>
              <Text style={styles.dateButtonHint}>{calendarOpen ? "CLOSE" : "CHANGE"}</Text>
            </Pressable>
            {calendarOpen && <View style={styles.calendar}>
              <View style={styles.calendarHeader}>
                <Pressable onPress={() => setCalendarMonth(new Date(calendarMonth.getFullYear(), calendarMonth.getMonth()-1, 1))} style={styles.monthArrow}><Text style={styles.monthArrowText}>‹</Text></Pressable>
                <Text style={styles.monthTitle}>{monthName}</Text>
                <Pressable onPress={() => setCalendarMonth(new Date(calendarMonth.getFullYear(), calendarMonth.getMonth()+1, 1))} style={styles.monthArrow}><Text style={styles.monthArrowText}>›</Text></Pressable>
              </View>
              <View style={styles.calendarGrid}>
                {["S","M","T","W","T","F","S"].map((d,i)=><Text key={d+i} style={styles.weekDay}>{d}</Text>)}
                {calendarCells.map((day,index) => {
                  if (!day) return <View key={"blank"+index} style={styles.dayCell}/>;
                  const value = calendarMonth.getFullYear()+"-"+pad(calendarMonth.getMonth()+1)+"-"+pad(day);
                  const chosen = value === date;
                  const past = new Date(value+"T23:59:59") < new Date(new Date().toDateString());
                  return <Pressable key={value} disabled={past} onPress={() => { setDate(value); setCalendarOpen(false); }} style={[styles.dayCell, chosen && styles.daySelected, past && styles.dayDisabled]}>
                    <Text style={[styles.dayText, chosen && styles.dayTextSelected, past && styles.dayTextDisabled]}>{day}</Text>
                  </Pressable>;
                })}
              </View>
            </View>}
            <Text style={styles.label}>TIME</Text>
            <View style={styles.timeRow}>
              <TextInput value={time.split(" ")[0]} onChangeText={value => setTime(value + " " + ampm)} placeholder="6:00" placeholderTextColor="#9B879D" keyboardType="numbers-and-punctuation" style={[styles.input,styles.timeInput]}/>
              <View style={styles.ampmWrap}>
                <Pressable onPress={() => { setAmpmOpen(!ampmOpen); setCalendarOpen(false); }} style={styles.ampmButton}>
                  <Text style={styles.ampmButtonText}>{ampm}</Text><Text style={styles.ampmChevron}>⌄</Text>
                </Pressable>
                {ampmOpen && <View style={styles.ampmMenu}>
                  {["AM","PM"].map(v=><Pressable key={v} onPress={() => { setAmpm(v); setTime(time.split(" ")[0]+" "+v); setAmpmOpen(false); }} style={[styles.ampmOption,ampm===v && styles.ampmOptionOn]}><Text style={[styles.ampmOptionText,ampm===v && styles.ampmOptionTextOn]}>{v}</Text></Pressable>)}
                </View>}
              </View>
            </View>
            <Text style={styles.label}>REPEAT</Text>
            <View style={styles.row}>{REPEATS.map(v => choice(v,repeat===v,()=>setRepeat(v)))}</View>
            {repeat === "custom" && <><Text style={styles.label}>REPEAT ON</Text><View style={styles.row}>{WEEKDAYS.map(d => choice(d.label,days.includes(d.value),()=>setDays(old=>old.includes(d.value)?old.filter(x=>x!==d.value):[...old,d.value])))}</View></>}
            <Text style={styles.label}>REMIND ME</Text>
            <View style={styles.row}>{[["0","AT DUE"],["5","5 MIN"],["15","15 MIN"],["30","30 MIN"],["60","1 HOUR"]].map(([v,l])=>choice(l,reminder===v,()=>setReminder(v)))}</View>
            <Text style={styles.label}>REMINDER SOUND</Text>
            <View style={styles.row}>{SOUNDS.map(v=>choice(v,sound===v,()=>setSound(v)))}</View>
            <Text style={styles.label}>PRIORITY</Text>
            <View style={styles.row}>{["low","medium","high"].map(v=>choice(v,priority===v,()=>setPriority(v)))}</View>
            <Pressable onPress={saveTask} disabled={saving} style={[styles.add, saving && styles.addDisabled]}><Text style={styles.addText}>{saving ? "SAVING…" : editingId ? "SAVE CHANGES" : "ADD TASK"}</Text></Pressable>
            {editingId ? <Pressable onPress={() => { resetForm(); setShowForm(false); }} style={styles.cancel}><Text style={styles.cancelText}>CANCEL</Text></Pressable> : null}
          </View>}

          <View style={styles.filterRow}>{["all","pending","done"].map(v=>choice(v,filter===v,()=>setFilter(v)))}</View>
{visible.length === 0 ? (
            <View style={styles.empty}><Text style={styles.emptyIcon}>✦</Text><Text style={styles.emptyTitle}>A fresh start.</Text><Text style={styles.muted}>Add your first task and make it happen.</Text></View>
          ) : visible.map(item => (
            <View key={item.id} style={styles.card}>
              <Pressable onPress={() => toggleTask(item)} style={[styles.check,item.done && styles.checked]}><Text style={styles.checkText}>{item.done ? "✓" : ""}</Text></Pressable>
              <View style={styles.taskBody}>
                <Text style={[styles.taskName,item.done && styles.strike]}>{item.name}</Text>
                <Text style={styles.taskMeta}>{item.date}  ·  {to12Hour(item.time)}</Text>
                <View style={styles.tagRow}><Text style={styles.tag}>{(item.repeat || "once").toUpperCase()}</Text><Text style={styles.priorityTag}>{(item.priority || "medium").toUpperCase()} PRIORITY</Text></View>
              </View>
              <View style={styles.actions}>
                <Pressable onPress={() => editTask(item)}><Text style={styles.edit}>EDIT</Text></Pressable>
                <Pressable onPress={() => Alert.alert("Delete task?", item.name, [
                  {text:"Cancel", style:"cancel"},
                  {text:"Delete", style:"destructive", onPress:() => deleteTask(item)}
                ])}><Text style={styles.delete}>DELETE</Text></Pressable>
              </View>
            </View>
          ))}
          <Text style={styles.foot}>Your tasks stay on this device. Cloud sync is off.</Text>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  loading:{flex:1,backgroundColor:"#FFF8FC",alignItems:"center",justifyContent:"center"},
  loadingBrand:{fontSize:30,fontWeight:"900",letterSpacing:3,color:"#301934",marginBottom:12},
  brandGroup:{flexDirection:"column",alignItems:"flex-start"},
  welcomeScreen:{flex:1,backgroundColor:"#FFF8FC",paddingHorizontal:26,paddingTop:26,paddingBottom:22,justifyContent:"space-between"},
  welcomeTop:{flexDirection:"row",justifyContent:"space-between",alignItems:"center"},
  welcomeBrand:{fontSize:27,fontWeight:"900",letterSpacing:2.5,color:"#301934"},
  pill:{backgroundColor:"#F4DDF0",paddingHorizontal:11,paddingVertical:8,borderRadius:30},
  pillText:{fontSize:8,fontWeight:"900",letterSpacing:1,color:"#60365F"},
  heroArt:{height:260,alignItems:"center",justifyContent:"center",position:"relative"},
  orbitOne:{position:"absolute",width:238,height:238,borderRadius:119,backgroundColor:"#F7E5F3"},
  orbitTwo:{position:"absolute",width:188,height:188,borderRadius:94,borderWidth:1.5,borderColor:"#DDA0DD"},
  heroCard:{width:235,height:142,backgroundColor:"#FFFFFF",borderRadius:22,padding:20,flexDirection:"row",alignItems:"center",shadowColor:"#301934",shadowOpacity:0.12,shadowRadius:20,elevation:7,transform:[{rotate:"-5deg"}]},
  heroCheck:{width:42,height:42,borderRadius:14,backgroundColor:"#DDA0DD",alignItems:"center",justifyContent:"center"},
  heroCheckText:{fontSize:24,fontWeight:"900",color:"#301934"},
  heroLines:{flex:1,marginLeft:14,gap:10},
  heroLineLong:{height:9,width:"95%",borderRadius:8,backgroundColor:"#E9DCE9"},
  heroLineShort:{height:8,width:"62%",borderRadius:8,backgroundColor:"#F2EAF1"},
  heroBadge:{position:"absolute",right:13,bottom:15,backgroundColor:"#FF5A1F",paddingHorizontal:10,paddingVertical:6,borderRadius:8},
  heroBadgeText:{fontSize:8,fontWeight:"900",color:"#FFFFFF",letterSpacing:1},
  sparkle:{position:"absolute",top:27,right:45,fontSize:34,color:"#FF5A1F"},
  sparkleSmall:{position:"absolute",bottom:35,left:42,fontSize:30,color:"#A66BA4"},
  welcomeCopy:{paddingBottom:5},
  eyebrow:{fontSize:10,fontWeight:"900",letterSpacing:2,color:"#B15E9F",marginBottom:12},
  welcomeTitle:{fontSize:39,lineHeight:43,fontWeight:"900",color:"#301934",letterSpacing:-1},
  welcomeText:{fontSize:14,lineHeight:22,color:"#765F78",marginTop:13,marginBottom:22},
  getStarted:{height:58,backgroundColor:"#301934",borderRadius:17,paddingHorizontal:20,flexDirection:"row",alignItems:"center",justifyContent:"space-between"},
  getStartedText:{fontSize:12,fontWeight:"900",letterSpacing:2,color:"#FFFFFF"},
  arrow:{fontSize:25,color:"#FF7A45"},
  localNote:{fontSize:8,fontWeight:"800",letterSpacing:1.5,color:"#A48BA5",textAlign:"center",marginTop:15},
  screen:{flex:1,backgroundColor:"#FFF8FC"},container:{flex:1,paddingHorizontal:20,paddingTop:16},
  topBar:{flexDirection:"row",alignItems:"center",justifyContent:"space-between",marginBottom:18,paddingHorizontal:2},
  brand:{fontSize:30,fontWeight:"900",letterSpacing:2.2,color:"#301934"},orange:{color:"#FF5A1F"},
  muted:{color:"#947D95",fontSize:12,marginTop:4},
  avatar:{width:46,height:46,borderRadius:23,backgroundColor:"#EBD2E8",borderWidth:2,borderColor:"#F7E4F4",alignItems:"center",justifyContent:"center"},
  avatarText:{fontSize:18,fontWeight:"900",color:"#60365F"},
  welcomePanel:{backgroundColor:"#301934",borderRadius:27,padding:19,overflow:"hidden",marginBottom:23,shadowColor:"#301934",shadowOpacity:0.16,shadowRadius:14,elevation:5},
  panelDecor:{position:"absolute",right:-34,top:-65,width:190,height:190,borderRadius:95,backgroundColor:"#553454"},
  panelContent:{minHeight:132,flexDirection:"row",alignItems:"center",justifyContent:"space-between"},
  panelCopy:{flex:1,paddingRight:5},
  panelEyebrow:{fontSize:9,fontWeight:"900",letterSpacing:1.2,color:"#E7B9DF"},
  panelTitle:{fontSize:25,fontWeight:"900",color:"#FFFFFF",marginTop:12,lineHeight:30},
  panelSub:{fontSize:11,color:"#E5CFE4",marginTop:5},
  clockArt:{width:126,height:132,alignItems:"center",justifyContent:"center",position:"relative"},
  clockFace:{width:94,height:94,borderRadius:47,backgroundColor:"#FBEAFF",borderWidth:5,borderColor:"#DDA0DD",alignItems:"center",justifyContent:"center",shadowColor:"#000000",shadowOpacity:0.2,shadowRadius:8,elevation:5},
  clockBellLeft:{position:"absolute",top:8,left:18,width:28,height:16,borderRadius:14,backgroundColor:"#DDA0DD",transform:[{rotate:"-28deg"}]},
  clockBellRight:{position:"absolute",top:8,right:17,width:28,height:16,borderRadius:14,backgroundColor:"#DDA0DD",transform:[{rotate:"28deg"}]},
  clockHandHour:{position:"absolute",width:7,height:28,borderRadius:5,backgroundColor:"#60365F",top:22,left:40,transform:[{rotate:"-42deg"}]},
  clockHandMinute:{position:"absolute",width:5,height:34,borderRadius:5,backgroundColor:"#8B5B89",top:15,left:49,transform:[{rotate:"48deg"}]},
  clockCenter:{width:10,height:10,borderRadius:5,backgroundColor:"#60365F"},
  clockLegLeft:{position:"absolute",bottom:8,left:27,width:7,height:18,borderRadius:5,backgroundColor:"#DDA0DD",transform:[{rotate:"28deg"}]},
  clockLegRight:{position:"absolute",bottom:8,right:27,width:7,height:18,borderRadius:5,backgroundColor:"#DDA0DD",transform:[{rotate:"-28deg"}]},
  statsRow:{flexDirection:"row",alignItems:"center",marginTop:13,paddingVertical:11,paddingHorizontal:9,borderRadius:17,backgroundColor:"#FFFFFF12",borderWidth:1,borderColor:"#FFFFFF18"},
  statBox:{flex:1,alignItems:"center"},statNumber:{fontSize:23,fontWeight:"900",color:"#FFFFFF"},statLabel:{fontSize:8,fontWeight:"900",letterSpacing:0.8,color:"#E5C2E1",marginTop:3},
  statDivider:{width:1,height:34,backgroundColor:"#765A78",marginHorizontal:8},
  sectionHeader:{flexDirection:"row",alignItems:"center",justifyContent:"space-between",marginBottom:14,marginTop:2},
  sectionTitle:{fontSize:23,fontWeight:"900",color:"#301934"},sectionHint:{fontSize:11,color:"#947D95",marginTop:3},
  newButton:{backgroundColor:"#FF5A1F",paddingVertical:12,paddingHorizontal:15,borderRadius:14,shadowColor:"#FF5A1F",shadowOpacity:0.18,shadowRadius:7,elevation:2},
  newButtonText:{fontSize:10,fontWeight:"900",letterSpacing:0.6,color:"#FFFFFF"},
  form:{backgroundColor:"#FFFFFF",borderWidth:1,borderColor:"#F0E2EF",borderRadius:20,padding:16,marginBottom:17},
  formTitle:{fontSize:11,fontWeight:"900",letterSpacing:1.5,color:"#A66BA4",marginBottom:12},
  input:{backgroundColor:"#FFF8FC",borderColor:"#EAD9E9",borderWidth:1,borderRadius:12,padding:13,color:"#301934",marginBottom:9},
  dateButton:{height:48,backgroundColor:"#FFF8FC",borderColor:"#EAD9E9",borderWidth:1,borderRadius:12,paddingHorizontal:13,flexDirection:"row",alignItems:"center",marginBottom:9},
  dateButtonIcon:{fontSize:19,color:"#A66BA4",marginRight:10},
  dateButtonText:{flex:1,color:"#301934",fontSize:13,fontWeight:"700"},
  dateButtonHint:{fontSize:9,fontWeight:"900",letterSpacing:0.8,color:"#A66BA4"},
  calendar:{backgroundColor:"#FFF8FC",borderWidth:1,borderColor:"#EAD9E9",borderRadius:14,padding:10,marginBottom:12},
  calendarHeader:{flexDirection:"row",alignItems:"center",justifyContent:"space-between",marginBottom:10},
  monthArrow:{width:34,height:34,borderRadius:10,backgroundColor:"#F3DDF0",alignItems:"center",justifyContent:"center"},
  monthArrowText:{fontSize:25,color:"#60365F",lineHeight:28},
  monthTitle:{fontSize:13,fontWeight:"900",color:"#301934"},
  calendarGrid:{flexDirection:"row",flexWrap:"wrap"},
  weekDay:{width:"14.2857%",textAlign:"center",fontSize:10,fontWeight:"900",color:"#A66BA4",paddingVertical:8},
  dayCell:{width:"14.2857%",height:38,alignItems:"center",justifyContent:"center",borderRadius:10},
  daySelected:{backgroundColor:"#301934"},
  dayDisabled:{opacity:0.28},
  dayText:{fontSize:12,color:"#60365F",fontWeight:"600"},
  dayTextSelected:{color:"#FFFFFF",fontWeight:"900"},
  dayTextDisabled:{color:"#B8AAB8"},
  timeRow:{flexDirection:"row",gap:9,alignItems:"flex-start",marginBottom:4},
  timeInput:{flex:1,marginBottom:9},
  ampmWrap:{width:105,zIndex:5},
  ampmButton:{height:48,backgroundColor:"#F3DDF0",borderWidth:1,borderColor:"#DDB5D8",borderRadius:12,paddingHorizontal:13,flexDirection:"row",alignItems:"center",justifyContent:"space-between"},
  ampmButtonText:{fontSize:13,fontWeight:"900",color:"#60365F"},
  ampmChevron:{fontSize:18,color:"#60365F"},
  ampmMenu:{position:"absolute",top:52,left:0,right:0,backgroundColor:"#FFFFFF",borderWidth:1,borderColor:"#EAD9E9",borderRadius:12,padding:5,elevation:8,shadowColor:"#301934",shadowOpacity:0.12,shadowRadius:8},
  ampmOption:{paddingVertical:11,paddingHorizontal:12,borderRadius:8},
  ampmOptionOn:{backgroundColor:"#F3DDF0"},
  ampmOptionText:{fontSize:12,fontWeight:"800",color:"#765F78"},
  ampmOptionTextOn:{color:"#60365F"},
  label:{color:"#765F78",fontSize:9,fontWeight:"900",letterSpacing:1,marginTop:8,marginBottom:8},
  row:{flexDirection:"row",gap:7,marginBottom:9,flexWrap:"wrap"},
  choice:{paddingVertical:9,paddingHorizontal:11,borderRadius:10,borderWidth:1,borderColor:"#EAD9E9",backgroundColor:"#FFFFFF",justifyContent:"center"},
  choiceOn:{backgroundColor:"#F3DDF0",borderColor:"#C68BC1"},
  choiceText:{fontSize:9,color:"#765F78",fontWeight:"900"},choiceTextOn:{color:"#60365F"},
  add:{backgroundColor:"#301934",padding:15,borderRadius:12,alignItems:"center",marginTop:9},
  addDisabled:{opacity:0.55},
  addText:{color:"#FFFFFF",fontWeight:"900",letterSpacing:1.2,fontSize:11},
  cancel:{padding:12,alignItems:"center"},cancelText:{color:"#947D95",fontWeight:"900",fontSize:10},
  filterRow:{flexDirection:"row",gap:9,marginBottom:15},
  empty:{backgroundColor:"#FFFFFF",borderRadius:18,borderWidth:1,borderColor:"#F0E2EF",padding:25,alignItems:"center",marginTop:5},
  emptyIcon:{fontSize:27,color:"#FF5A1F"},emptyTitle:{fontSize:17,fontWeight:"900",color:"#301934",marginTop:8},
  card:{flexDirection:"row",alignItems:"center",backgroundColor:"#FFFFFF",borderWidth:1,borderColor:"#F0E2EF",borderLeftWidth:4,borderLeftColor:"#C68BC1",borderRadius:17,padding:14,marginBottom:10,shadowColor:"#60365F",shadowOpacity:0.05,shadowRadius:7,elevation:2},
  check:{width:27,height:27,borderRadius:14,borderWidth:1.7,borderColor:"#8B5B89",alignItems:"center",justifyContent:"center",marginRight:11},
  checked:{backgroundColor:"#DDA0DD",borderColor:"#DDA0DD"},checkText:{color:"#301934",fontWeight:"900"},
  taskBody:{flex:1},taskName:{color:"#301934",fontWeight:"800",fontSize:14},strike:{textDecorationLine:"line-through",color:"#A994A9"},
  taskMeta:{color:"#947D95",fontSize:10,marginTop:5},
  tagRow:{flexDirection:"row",gap:6,marginTop:7,flexWrap:"wrap"},
  tag:{color:"#754B73",backgroundColor:"#F5E7F3",fontSize:8,fontWeight:"900",paddingHorizontal:7,paddingVertical:4,borderRadius:6},
  priorityTag:{color:"#B94A21",backgroundColor:"#FFF0E9",fontSize:8,fontWeight:"900",paddingHorizontal:7,paddingVertical:4,borderRadius:6},
  actions:{alignItems:"flex-end",marginLeft:5},edit:{color:"#8B5B89",fontSize:9,fontWeight:"900",padding:5},
  delete:{color:"#D94D3D",fontSize:9,fontWeight:"900",padding:5},
  foot:{color:"#A48BA5",fontSize:9,textAlign:"center",paddingVertical:18}
});
