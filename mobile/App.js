import React, { useEffect, useRef, useState } from "react";
import {
  Alert, KeyboardAvoidingView, Platform, Pressable,
  SafeAreaView, ScrollView, StyleSheet, Text, TextInput, View
} from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Notifications from "expo-notifications";

const KEY = "taskly_mobile_tasks_v2";
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
  const parts = text.match(/^(0?[1-9]|1[0-2]):([0-5]\\d)\\s*(AM|PM)$/);
  if (parts) {
    let hour = Number(parts[1]) % 12;
    if (parts[3] === "PM") hour += 12;
    return pad(hour) + ":" + parts[2];
  }
  return /^([01]\\d|2[0-3]):[0-5]\\d$/.test(text) ? text : null;
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
        { id:"taskly-low", name:"Low reminders", importance:Notifications.AndroidImportance.DEFAULT, sound:"default", vibrationPattern:[] },
        { id:"taskly-high", name:"High reminders", importance:Notifications.AndroidImportance.MAX, sound:"default", vibrationPattern:[0,500,250,500,250,500] }
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
  await Promise.all((task.notificationIds || []).map(id =>
    Notifications.cancelScheduledNotificationAsync(id).catch(() => {})
  ));
}

async function scheduleTask(task) {
  if (!notificationPermissionGranted || task.done) return [];
  const reminders = futureDates(task).map(due => {
    const reminderAt = new Date(due.getTime() - (Number(task.reminder) || 0) * 60000);
    const triggerAt = reminderAt > new Date() ? reminderAt : due;
    if (triggerAt <= new Date()) return null;
    const channelId = `taskly-${task.sound || "low"}`;
    const sound = task.sound === "silent" ? null : "default";
    return Notifications.scheduleNotificationAsync({
      content: {
        title: "TASKLY · Deadline reminder",
        body: task.name,
        sound,
        data: { taskId: task.id },
        vibrate: task.sound === "high" ? [0,500,250,500] : []
      },
      trigger: Platform.OS === "android"
        ? { type: Notifications.SchedulableTriggerInputTypes.DATE, date: triggerAt, channelId }
        : { type: Notifications.SchedulableTriggerInputTypes.DATE, date: triggerAt }
    });
  }).filter(Boolean);
  return Promise.all(reminders);
}

export default function App() {
  const [tasks, setTasks] = useState([]);
  const [ready, setReady] = useState(false);
  const [introSeen, setIntroSeen] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [name, setName] = useState("");
  const [date, setDate] = useState(today());
  const [time, setTime] = useState("6:00 PM");
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
        await setupNotifications();
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
    setName(""); setDate(today()); setTime("6:00 PM"); setRepeat("once");
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
      reminder:Number(reminder), sound, priority, done:false,
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
    setEditingId(task.id); setName(task.name); setDate(task.date); setTime(to12Hour(task.time));
    setRepeat(task.repeat || "once"); setDays(task.days || []);
    setReminder(String(task.reminder ?? 15)); setSound(task.sound || "low");
    setPriority(task.priority || "medium");
    setShowForm(true);
  }

  async function toggleTask(task) {
    const updated = {...task, done:!task.done, notificationIds:[]};
    if (updated.done) await cancelTaskNotifications(task);
    else updated.notificationIds = await scheduleTask(updated);
    await saveTasks(tasks.map(t => t.id === task.id ? updated : t));
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

  if (!ready) return <SafeAreaView style={styles.loading}><Text style={styles.brand}>TASKLY<Text style={styles.orange}>.</Text></Text><Text style={styles.muted}>Getting your day ready…</Text></SafeAreaView>;

  if (!introSeen) {
    return (
      <SafeAreaView style={styles.welcomeScreen}>
        <View style={styles.welcomeTop}>
          <Text style={styles.welcomeBrand}>TASKLY<Text style={styles.orange}>.</Text></Text>
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
            <View>
              <Text style={styles.brand}>TASKLY<Text style={styles.orange}>.</Text></Text>
              <Text style={styles.muted}>A little more organised, every day.</Text>
            </View>
            <View style={styles.avatar}><Text style={styles.avatarText}>T</Text></View>
          </View>

          <View style={styles.welcomePanel}>
            <View style={styles.panelDecor}/>
            <Text style={styles.panelEyebrow}>YOUR DAILY OVERVIEW</Text>
            <Text style={styles.panelTitle}>You've got this.</Text>
            <Text style={styles.panelSub}>One task at a time. Make today count.</Text>
            <View style={styles.statsRow}>
              <View style={styles.statBox}><Text style={styles.statNumber}>{pendingCount}</Text><Text style={styles.statLabel}>TO DO</Text></View>
              <View style={styles.statDivider}/>
              <View style={styles.statBox}><Text style={styles.statNumber}>{doneCount}</Text><Text style={styles.statLabel}>DONE</Text></View>
              <View style={styles.statDivider}/>
              <View style={styles.statBox}><Text style={styles.statNumber}>{tasks.length}</Text><Text style={styles.statLabel}>TOTAL</Text></View>
            </View>
          </View>

          <View style={styles.sectionHeader}>
            <View><Text style={styles.sectionTitle}>Your tasks</Text><Text style={styles.sectionHint}>Keep your priorities close.</Text></View>
            <Pressable onPress={() => { resetForm(); setShowForm(!showForm); }} style={styles.newButton}>
              <Text style={styles.newButtonText}>{showForm ? "CLOSE" : "+ NEW TASK"}</Text>
            </Pressable>
          </View>

          {showForm && <View style={styles.form}>
            <Text style={styles.formTitle}>{editingId ? "EDIT YOUR TASK" : "CREATE A TASK"}</Text>
            <TextInput value={name} onChangeText={setName} placeholder="What do you need to do?" placeholderTextColor="#9B879D" style={styles.input}/>
            <Text style={styles.label}>DUE DATE · YYYY-MM-DD</Text>
            <TextInput value={date} onChangeText={setDate} placeholder="YYYY-MM-DD" placeholderTextColor="#9B879D" style={styles.input}/>
            <Text style={styles.label}>TIME · 12-HOUR</Text>
            <TextInput value={time} onChangeText={setTime} placeholder="6:00 PM" placeholderTextColor="#9B879D" style={styles.input}/>
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
  topBar:{flexDirection:"row",alignItems:"center",justifyContent:"space-between",marginBottom:20},
  brand:{fontSize:29,fontWeight:"900",letterSpacing:2.5,color:"#301934"},orange:{color:"#FF5A1F"},
  muted:{color:"#947D95",fontSize:12,marginTop:5},
  avatar:{width:42,height:42,borderRadius:15,backgroundColor:"#EBD2E8",alignItems:"center",justifyContent:"center"},
  avatarText:{fontSize:17,fontWeight:"900",color:"#60365F"},
  welcomePanel:{backgroundColor:"#301934",borderRadius:24,padding:21,overflow:"hidden",marginBottom:25},
  panelDecor:{position:"absolute",right:-35,top:-45,width:150,height:150,borderRadius:75,backgroundColor:"#553454"},
  panelEyebrow:{fontSize:9,fontWeight:"900",letterSpacing:2,color:"#E7B9DF"},
  panelTitle:{fontSize:27,fontWeight:"900",color:"#FFFFFF",marginTop:10},
  panelSub:{fontSize:12,color:"#D7C0D8",marginTop:5},
  statsRow:{flexDirection:"row",alignItems:"center",marginTop:22},
  statBox:{flex:1},statNumber:{fontSize:25,fontWeight:"900",color:"#FFFFFF"},statLabel:{fontSize:8,fontWeight:"900",letterSpacing:1.5,color:"#D7A8D2",marginTop:4},
  statDivider:{width:1,height:34,backgroundColor:"#654B66",marginHorizontal:12},
  sectionHeader:{flexDirection:"row",alignItems:"center",justifyContent:"space-between",marginBottom:15},
  sectionTitle:{fontSize:22,fontWeight:"900",color:"#301934"},sectionHint:{fontSize:11,color:"#947D95",marginTop:3},
  newButton:{backgroundColor:"#FF5A1F",paddingVertical:12,paddingHorizontal:14,borderRadius:12},
  newButtonText:{fontSize:10,fontWeight:"900",letterSpacing:0.8,color:"#FFFFFF"},
  form:{backgroundColor:"#FFFFFF",borderWidth:1,borderColor:"#F0E2EF",borderRadius:20,padding:16,marginBottom:17},
  formTitle:{fontSize:11,fontWeight:"900",letterSpacing:1.5,color:"#A66BA4",marginBottom:12},
  input:{backgroundColor:"#FFF8FC",borderColor:"#EAD9E9",borderWidth:1,borderRadius:12,padding:13,color:"#301934",marginBottom:9},
  label:{color:"#765F78",fontSize:9,fontWeight:"900",letterSpacing:1,marginTop:8,marginBottom:8},
  row:{flexDirection:"row",gap:7,marginBottom:9,flexWrap:"wrap"},
  choice:{paddingVertical:9,paddingHorizontal:11,borderRadius:10,borderWidth:1,borderColor:"#EAD9E9",backgroundColor:"#FFFFFF",justifyContent:"center"},
  choiceOn:{backgroundColor:"#F3DDF0",borderColor:"#C68BC1"},
  choiceText:{fontSize:9,color:"#765F78",fontWeight:"900"},choiceTextOn:{color:"#60365F"},
  add:{backgroundColor:"#301934",padding:15,borderRadius:12,alignItems:"center",marginTop:9},
  addDisabled:{opacity:0.55},
  addText:{color:"#FFFFFF",fontWeight:"900",letterSpacing:1.2,fontSize:11},
  cancel:{padding:12,alignItems:"center"},cancelText:{color:"#947D95",fontWeight:"900",fontSize:10},
  filterRow:{flexDirection:"row",gap:8,marginBottom:13},
  empty:{backgroundColor:"#FFFFFF",borderRadius:18,borderWidth:1,borderColor:"#F0E2EF",padding:25,alignItems:"center",marginTop:5},
  emptyIcon:{fontSize:27,color:"#FF5A1F"},emptyTitle:{fontSize:17,fontWeight:"900",color:"#301934",marginTop:8},
  card:{flexDirection:"row",alignItems:"center",backgroundColor:"#FFFFFF",borderWidth:1,borderColor:"#F0E2EF",borderRadius:16,padding:13,marginBottom:10},
  check:{width:25,height:25,borderRadius:9,borderWidth:1.5,borderColor:"#C68BC1",alignItems:"center",justifyContent:"center",marginRight:10},
  checked:{backgroundColor:"#DDA0DD",borderColor:"#DDA0DD"},checkText:{color:"#301934",fontWeight:"900"},
  taskBody:{flex:1},taskName:{color:"#301934",fontWeight:"800",fontSize:13},strike:{textDecorationLine:"line-through",color:"#A994A9"},
  taskMeta:{color:"#947D95",fontSize:10,marginTop:5},
  tagRow:{flexDirection:"row",gap:6,marginTop:7,flexWrap:"wrap"},
  tag:{color:"#754B73",backgroundColor:"#F5E7F3",fontSize:8,fontWeight:"900",paddingHorizontal:7,paddingVertical:4,borderRadius:6},
  priorityTag:{color:"#B94A21",backgroundColor:"#FFF0E9",fontSize:8,fontWeight:"900",paddingHorizontal:7,paddingVertical:4,borderRadius:6},
  actions:{alignItems:"flex-end",marginLeft:5},edit:{color:"#8B5B89",fontSize:9,fontWeight:"900",padding:5},
  delete:{color:"#D94D3D",fontSize:9,fontWeight:"900",padding:5},
  foot:{color:"#A48BA5",fontSize:9,textAlign:"center",paddingVertical:18}
});