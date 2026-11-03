import React, { useEffect, useState } from "react";
import {
  Alert, AppState, FlatList, KeyboardAvoidingView, Platform, Pressable,
  SafeAreaView, ScrollView, StyleSheet, Text, TextInput, View
} from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Notifications from "expo-notifications";

const KEY = "taskly_mobile_tasks_v2";
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
const validTime = value => /^([01]\d|2[0-3]):[0-5]\d$/.test(value);
const dueDate = task => new Date(`${task.date}T${task.time}:00`);

async function setupNotifications() {
  const permission = await Notifications.requestPermissionsAsync();
  if (!permission.granted) return false;
  if (Platform.OS === "android") {
    const channels = [
      { id:"taskly-silent", name:"Silent reminders", importance:Notifications.AndroidImportance.LOW, sound:null, vibrationPattern:[] },
      { id:"taskly-low", name:"Low reminders", importance:Notifications.AndroidImportance.DEFAULT, sound:"default", vibrationPattern:[] },
      { id:"taskly-high", name:"High reminders", importance:Notifications.AndroidImportance.MAX, sound:"default", vibrationPattern:[0,500,250,500,250,500] }
    ];
    for (const channel of channels) await Notifications.setNotificationChannelAsync(channel.id, channel);
  }
  return true;
}

function futureDates(task, limit = 45) {
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
  const permission = await setupNotifications();
  if (!permission || task.done) return [];
  const ids = [];
  for (const due of futureDates(task)) {
    const reminderAt = new Date(due.getTime() - (Number(task.reminder) || 0) * 60000);
    const triggerAt = reminderAt > new Date() ? reminderAt : due;
    if (triggerAt <= new Date()) continue;
    const channelId = `taskly-${task.sound || "low"}`;
    const sound = task.sound === "silent" ? null : "default";
    const id = await Notifications.scheduleNotificationAsync({
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
    ids.push(id);
  }
  return ids;
}

export default function App() {
  const [tasks, setTasks] = useState([]);
  const [ready, setReady] = useState(false);
  const [name, setName] = useState("");
  const [date, setDate] = useState(today());
  const [time, setTime] = useState("18:00");
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
        const saved = await AsyncStorage.getItem(KEY);
        const loaded = saved ? JSON.parse(saved) : [];
        if (!active) return;
        setTasks(loaded);
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
    const sub = AppState.addEventListener("change", async state => {
      if (state === "active") {
        const saved = await AsyncStorage.getItem(KEY);
        const loaded = saved ? JSON.parse(saved) : [];
        for (const task of loaded) {
          if (!task.done) {
            await cancelTaskNotifications(task);
            task.notificationIds = await scheduleTask(task);
          }
        }
        setTasks(loaded);
        await AsyncStorage.setItem(KEY, JSON.stringify(loaded));
      }
    });
    return () => { active = false; sub.remove(); };
  }, []);

  async function saveTasks(next) {
    setTasks(next);
    await AsyncStorage.setItem(KEY, JSON.stringify(next));
  }

  function resetForm() {
    setName(""); setDate(today()); setTime("18:00"); setRepeat("once");
    setDays([]); setReminder("15"); setSound("high"); setPriority("medium");
    setEditingId(null);
  }

  async function saveTask() {
    if (!name.trim()) return Alert.alert("Task name needed", "Enter what you need to do.");
    if (!validDate(date) || !validTime(time)) return Alert.alert("Check date and time", "Use YYYY-MM-DD and 24-hour HH:MM format.");
    if (repeat === "custom" && days.length === 0) return Alert.alert("Choose days", "Select at least one day for a custom repeat.");
    if (repeat === "once" && dueDate({date,time}) <= new Date()) return Alert.alert("Choose a future time", "The deadline must be in the future.");
    const old = tasks.find(t => t.id === editingId);
    if (old) await cancelTaskNotifications(old);
    const task = {
      id: editingId || makeId(), name:name.trim(), date, time, repeat, days,
      reminder:Number(reminder), sound, priority, done:false,
      created:old?.created || Date.now(), notificationIds:[]
    };
    task.notificationIds = await scheduleTask(task);
    const next = old ? tasks.map(t => t.id === old.id ? task : t) : [task, ...tasks];
    await saveTasks(next);
    resetForm();
    Alert.alert("Saved", task.notificationIds.length
      ? "Your device reminders are scheduled."
      : "Task saved. Check notification permission and device settings.");
  }

  function editTask(task) {
    setEditingId(task.id); setName(task.name); setDate(task.date); setTime(task.time);
    setRepeat(task.repeat || "once"); setDays(task.days || []);
    setReminder(String(task.reminder ?? 15)); setSound(task.sound || "low");
    setPriority(task.priority || "medium");
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
      <Text style={styles.choiceText}>{label.toUpperCase()}</Text>
    </Pressable>;
  }

  const visible = tasks.filter(t => filter === "all" ? true : filter === "pending" ? !t.done : t.done);
  if (!ready) return <SafeAreaView style={styles.screen}><Text style={styles.brand}>TASKLY.</Text><Text style={styles.muted}>Loading your tasks…</Text></SafeAreaView>;

  return (
    <SafeAreaView style={styles.screen}>
      <KeyboardAvoidingView style={styles.container} behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <Text style={styles.brand}>TASKLY<Text style={styles.dot}>.</Text></Text>
        <Text style={styles.heading}>Plan it. Do it. On time.</Text>
        <Text style={styles.muted}>Saved on this device · Cloud sync is off</Text>
        <ScrollView keyboardShouldPersistTaps="handled">
          <View style={styles.form}>
            <Text style={styles.section}>{editingId ? "EDIT TASK" : "CREATE A TASK"}</Text>
            <TextInput value={name} onChangeText={setName} placeholder="What do you need to do?" placeholderTextColor="#8993A8" style={styles.input}/>
            <Text style={styles.label}>Due date · YYYY-MM-DD</Text>
            <TextInput value={date} onChangeText={setDate} placeholder="YYYY-MM-DD" placeholderTextColor="#8993A8" style={styles.input}/>
            <Text style={styles.label}>Time · 24-hour HH:MM</Text>
            <TextInput value={time} onChangeText={setTime} placeholder="18:00" placeholderTextColor="#8993A8" style={styles.input}/>
            <Text style={styles.label}>Repeat</Text>
            <View style={styles.row}>{REPEATS.map(v => choice(v,repeat===v,()=>setRepeat(v)))}</View>
            {repeat === "custom" && <><Text style={styles.label}>Repeat on</Text><View style={styles.row}>{WEEKDAYS.map(d => choice(d.label,days.includes(d.value),()=>setDays(old=>old.includes(d.value)?old.filter(x=>x!==d.value):[...old,d.value])))}</View></>}
            <Text style={styles.label}>Remind me</Text>
            <View style={styles.row}>{[["0","AT DUE"],["5","5 MIN"],["15","15 MIN"],["30","30 MIN"],["60","1 HOUR"]].map(([v,l])=>choice(l,reminder===v,()=>setReminder(v)))}</View>
            <Text style={styles.label}>Reminder sound</Text>
            <View style={styles.row}>{SOUNDS.map(v=>choice(v,sound===v,()=>setSound(v)))}</View>
            <Text style={styles.label}>Priority</Text>
            <View style={styles.row}>{["low","medium","high"].map(v=>choice(v,priority===v,()=>setPriority(v)))}</View>
            <Pressable onPress={saveTask} style={styles.add}><Text style={styles.addText}>{editingId ? "SAVE CHANGES" : "+ ADD TASK"}</Text></Pressable>
            {editingId ? <Pressable onPress={resetForm} style={styles.cancel}><Text style={styles.choiceText}>CANCEL EDIT</Text></Pressable> : null}
          </View>
          <View style={styles.listHead}>
            <Text style={styles.section}>YOUR TASKS · {tasks.filter(t=>!t.done).length} LEFT</Text>
            <View style={styles.row}>{["all","pending","done"].map(v=>choice(v,filter===v,()=>setFilter(v)))}</View>
          </View>
          <FlatList scrollEnabled={false} data={visible} keyExtractor={item=>item.id}
            ListEmptyComponent={<Text style={styles.muted}>No tasks here yet.</Text>}
            renderItem={({item})=><View style={styles.card}>
              <Pressable onPress={()=>toggleTask(item)} style={[styles.check,item.done&&styles.checked]}><Text style={styles.checkText}>{item.done?"✓":""}</Text></Pressable>
              <View style={styles.taskBody}>
                <Text style={[styles.taskName,item.done&&styles.strike]}>{item.name}</Text>
                <Text style={styles.muted}>{item.date} · {item.time} · {(item.repeat||"once").toUpperCase()}</Text>
                <Text style={styles.meta}>{(item.priority||"medium").toUpperCase()} PRIORITY · {(item.sound||"low").toUpperCase()} SOUND</Text>
              </View>
              <View><Pressable onPress={()=>editTask(item)}><Text style={styles.edit}>EDIT</Text></Pressable><Pressable onPress={()=>Alert.alert("Delete task?",item.name,[{text:"Cancel"},{text:"Delete",style:"destructive",onPress:()=>deleteTask(item)}])}><Text style={styles.delete}>DELETE</Text></Pressable></View>
            </View>}
          />
          <Text style={styles.foot}>Reminders are scheduled on this device. iOS/Android settings can affect sound and delivery.</Text>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen:{flex:1,backgroundColor:"#05070d"},container:{flex:1,padding:20,paddingTop:18},
  brand:{fontSize:34,fontWeight:"900",letterSpacing:3,color:"#F4F7FF"},dot:{color:"#B7F34A"},
  heading:{fontSize:22,fontWeight:"800",color:"#F4F7FF",marginTop:8},muted:{color:"#8993A8",fontSize:12,marginTop:5},
  form:{backgroundColor:"#101624",borderColor:"#202B40",borderWidth:1,borderRadius:18,padding:14,marginTop:18,marginBottom:20},
  input:{backgroundColor:"#080D17",borderColor:"#27344D",borderWidth:1,borderRadius:10,padding:12,color:"#F4F7FF",marginBottom:9},
  label:{color:"#AEB9CC",fontSize:11,fontWeight:"700",marginTop:7,marginBottom:8},
  row:{flexDirection:"row",gap:7,marginBottom:8,flexWrap:"wrap"},choice:{paddingVertical:9,paddingHorizontal:11,borderRadius:9,borderWidth:1,borderColor:"#35425B",justifyContent:"center"},
  choiceOn:{backgroundColor:"#203D9C",borderColor:"#4771FF"},choiceText:{fontSize:10,color:"#F4F7FF",fontWeight:"800"},
  add:{backgroundColor:"#315CFF",padding:14,borderRadius:10,alignItems:"center",marginTop:8},addText:{color:"white",fontWeight:"900",letterSpacing:1},
  cancel:{padding:12,alignItems:"center"},section:{color:"#B7F34A",fontSize:11,fontWeight:"900",letterSpacing:1.5,marginBottom:10},
  listHead:{marginBottom:10},card:{flexDirection:"row",alignItems:"center",backgroundColor:"#101624",borderWidth:1,borderColor:"#202B40",borderRadius:13,padding:12,marginBottom:9},
  check:{width:25,height:25,borderRadius:8,borderWidth:1,borderColor:"#52617A",alignItems:"center",justifyContent:"center",marginRight:10},
  checked:{backgroundColor:"#B7F34A",borderColor:"#B7F34A"},checkText:{color:"#05070d",fontWeight:"900"},
  taskBody:{flex:1},taskName:{color:"#F4F7FF",fontWeight:"700",fontSize:14},strike:{textDecorationLine:"line-through",color:"#758097"},
  meta:{color:"#B7F34A",fontSize:9,marginTop:5,fontWeight:"800"},edit:{color:"#9CB5FF",fontSize:10,fontWeight:"800",padding:5},
  delete:{color:"#FF718A",fontSize:10,fontWeight:"800",padding:5},foot:{color:"#64718A",fontSize:10,textAlign:"center",paddingVertical:14}
});
