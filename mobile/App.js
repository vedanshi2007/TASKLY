import React, { useEffect, useState } from "react";
import {
  Alert, FlatList, KeyboardAvoidingView, Platform, Pressable,
  SafeAreaView, StyleSheet, Text, TextInput, View
} from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Notifications from "expo-notifications";
import { supabase, isCloudConfigured } from "./supabase";

const KEY = "taskly_mobile_tasks_v1";
const SOUND_OPTIONS = [
  { id: "silent", label: "SILENT" },
  { id: "low", label: "LOW" },
  { id: "high", label: "HIGH" }
];

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true, shouldPlaySound: true, shouldSetBadge: false,
    shouldShowBanner: true, shouldShowList: true
  })
});

const makeId = () => Date.now().toString() + Math.random().toString(16).slice(2);
const pad = n => String(n).padStart(2, "0");
const toLocalDate = d => `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;
const parseDue = (date, time) => new Date(`${date}T${time}:00`);

async function prepareNotifications() {
  const permission = await Notifications.requestPermissionsAsync();
  if (!permission.granted) return false;
  if (Platform.OS === "android") {
    const channels = [
      { id: "taskly-silent", name: "Silent reminders", importance: Notifications.AndroidImportance.LOW, sound: null, vibrationPattern: [] },
      { id: "taskly-low", name: "Low sound reminders", importance: Notifications.AndroidImportance.DEFAULT, sound: "default", vibrationPattern: [] },
      { id: "taskly-high", name: "Loud reminders", importance: Notifications.AndroidImportance.MAX, sound: "default", vibrationPattern: [0, 500, 250, 500, 250, 500] }
    ];
    for (const channel of channels) {
      await Notifications.setNotificationChannelAsync(channel.id, {
        ...channel, lockscreenVisibility: Notifications.AndroidNotificationVisibility.PUBLIC
      });
    }
  }
  return true;
}

function nextDates(task, limit = 45) {
  const first = parseDue(task.date, task.time);
  const result = [];
  const now = new Date();
  for (let offset = 0; offset < 370 && result.length < limit; offset++) {
    const day = new Date(first);
    day.setDate(first.getDate() + offset);
    if (day <= now) continue;
    const weekday = day.getDay();
    const matches = task.repeat === "once" ? offset === 0 :
      task.repeat === "daily" ? true :
      task.repeat === "weekly" ? weekday === first.getDay() :
      (task.days || []).includes(weekday);
    if (matches) result.push(day);
    if (task.repeat === "once" && offset >= 0) break;
  }
  return result;
}

async function scheduleTask(task) {
  if (!(await prepareNotifications())) return [];
  const ids = [];
  const channelId = `taskly-${task.sound || "low"}`;
  for (const due of nextDates(task)) {
    const reminderAt = new Date(due.getTime() - (task.reminder || 0) * 60000);
    const triggerAt = reminderAt > new Date() ? reminderAt : due;
    if (triggerAt <= new Date()) continue;
    const sound = task.sound === "silent" ? null : "default";
    const id = await Notifications.scheduleNotificationAsync({
      content: {
        title: "TASKLY · Deadline reminder", body: task.name,
        sound, data: { taskId: task.id },
        vibrate: task.sound === "high" ? [0, 500, 250, 500] : undefined
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
  const [name, setName] = useState("");
  const [date, setDate] = useState(toLocalDate(new Date()));
  const [time, setTime] = useState("18:00");
  const [repeat, setRepeat] = useState("once");
  const [reminder, setReminder] = useState("15");
  const [sound, setSound] = useState("high");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [session, setSession] = useState(null);
  const [authBusy, setAuthBusy] = useState(false);
  const [ready, setReady] = useState(false);
  const [syncLabel, setSyncLabel] = useState("Device only");

  useEffect(() => {
    let authListener;
    (async () => {
      await prepareNotifications();
      const saved = await AsyncStorage.getItem(KEY);
      if (saved) setTasks(JSON.parse(saved));
      if (isCloudConfigured) {
        const { data } = await supabase.auth.getSession();
        setSession(data.session);
        if (data.session) await syncFromCloud(data.session);
        const listener = supabase.auth.onAuthStateChange((_event, nextSession) => {
          setSession(nextSession);
          if (nextSession) setTimeout(() => syncFromCloud(nextSession), 0);
          else setSyncLabel("Signed out · device only");
        });
        authListener = listener.data.subscription;
      } else {
        setSyncLabel("Cloud setup needed");
      }
      setReady(true);
    })();
    return () => authListener?.unsubscribe();
  }, []);

  async function saveLocal(next) {
    setTasks(next);
    await AsyncStorage.setItem(KEY, JSON.stringify(next));
  }

  async function syncToCloud(next, activeSession = session) {
    if (!isCloudConfigured || !activeSession?.user?.id) return;
    setSyncLabel("Syncing…");
    const rows = next.map(task => ({
      id: task.id, user_id: activeSession.user.id, task_data: task,
      updated_at: new Date().toISOString()
    }));
    if (rows.length) {
      const { error } = await supabase.from("tasks").upsert(rows, { onConflict: "id" });
      if (error) { setSyncLabel("Sync paused · " + error.message); return; }
    }
    setSyncLabel("Synced ✓");
  }

  async function syncFromCloud(activeSession) {
    if (!isCloudConfigured || !activeSession?.user?.id) return;
    setSyncLabel("Syncing…");
    const { data, error } = await supabase.from("tasks").select("task_data,updated_at")
      .eq("user_id", activeSession.user.id);
    if (error) { setSyncLabel("Sync error · check setup"); return; }
    const localText = await AsyncStorage.getItem(KEY);
    const local = localText ? JSON.parse(localText) : [];
    const byId = new Map(local.map(t => [t.id, t]));
    for (const row of data || []) byId.set(row.task_data.id, row.task_data);
    const merged = [...byId.values()];
    await saveLocal(merged);
    setSyncLabel("Synced ✓");
    for (const task of merged.filter(t => !t.done && !(t.notificationIds || []).length)) {
      task.notificationIds = await scheduleTask(task);
    }
    await AsyncStorage.setItem(KEY, JSON.stringify(merged));
    await syncToCloud(merged, activeSession);
  }

  async function persist(next) {
    await saveLocal(next);
    await syncToCloud(next);
  }

  async function signIn(createAccount = false) {
    if (!isCloudConfigured) return Alert.alert("Cloud sync setup", "Add your Supabase project URL and public anon key to mobile/.env. See mobile/README.md.");
    if (!email.trim() || password.length < 6) return Alert.alert("Check login details", "Enter an email and a password with at least 6 characters.");
    setAuthBusy(true);
    const result = createAccount
      ? await supabase.auth.signUp({ email: email.trim(), password })
      : await supabase.auth.signInWithPassword({ email: email.trim(), password });
    setAuthBusy(false);
    if (result.error) return Alert.alert("Account issue", result.error.message);
    if (createAccount && !result.data.session) Alert.alert("Check your email", "Confirm your email, then sign in.");
    else if (result.data.session) await syncFromCloud(result.data.session);
  }

  async function addTask() {
    if (!name.trim()) return Alert.alert("Add a task name", "Enter what you need to do.");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) {
      return Alert.alert("Check date and time", "Use YYYY-MM-DD and 24-hour HH:MM format.");
    }
    const task = { id: makeId(), name: name.trim(), date, time, repeat,
      reminder: Number(reminder) || 0, sound, days: [], done: false, notificationIds: [] };
    task.notificationIds = await scheduleTask(task);
    await persist([task, ...tasks]);
    setName("");
    Alert.alert("Task saved", task.notificationIds.length
      ? "Your device reminders have been scheduled."
      : "Task saved. Check notification permission in device settings.");
  }

  async function toggleTask(task) {
    const updated = { ...task, done: !task.done };
    if (updated.done) {
      await Promise.all((task.notificationIds || []).map(id => Notifications.cancelScheduledNotificationAsync(id).catch(() => {})));
      updated.notificationIds = [];
    } else updated.notificationIds = await scheduleTask(updated);
    await persist(tasks.map(t => t.id === task.id ? updated : t));
  }

  async function removeTask(task) {
    await Promise.all((task.notificationIds || []).map(id => Notifications.cancelScheduledNotificationAsync(id).catch(() => {})));
    const next = tasks.filter(t => t.id !== task.id);
    await persist(next);
    if (session) await supabase.from("tasks").delete().eq("id", task.id).eq("user_id", session.user.id);
  }

  if (!ready) return <SafeAreaView style={styles.screen}><Text style={styles.brand}>TASKLY</Text><Text style={styles.muted}>Loading your tasks…</Text></SafeAreaView>;

  return (
    <SafeAreaView style={styles.screen}>
      <KeyboardAvoidingView style={styles.container} behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <Text style={styles.brand}>TASKLY<Text style={styles.dot}>.</Text></Text>
        <Text style={styles.heading}>Plan it. Do it. On time.</Text>
        <Text style={styles.muted}>{syncLabel}</Text>
        {isCloudConfigured && !session ? <View style={styles.form}>
          <Text style={styles.section}>SYNC YOUR DEVICES</Text>
          <TextInput value={email} onChangeText={setEmail} autoCapitalize="none" keyboardType="email-address" placeholder="Email address" placeholderTextColor="#8993A8" style={styles.input}/>
          <TextInput value={password} onChangeText={setPassword} secureTextEntry placeholder="Password (6+ characters)" placeholderTextColor="#8993A8" style={styles.input}/>
          <View style={styles.row}>
            <Pressable onPress={() => signIn(false)} style={styles.add}><Text style={styles.addText}>{authBusy ? "PLEASE WAIT" : "SIGN IN"}</Text></Pressable>
            <Pressable onPress={() => signIn(true)} style={styles.choice}><Text style={styles.choiceText}>CREATE ACCOUNT</Text></Pressable>
          </View>
        </View> : null}
        {session ? <Pressable onPress={() => supabase.auth.signOut()}><Text style={styles.signout}>Sign out · {session.user.email}</Text></Pressable> : null}
        <View style={styles.form}>
          <TextInput value={name} onChangeText={setName} placeholder="What do you need to do?" placeholderTextColor="#8993A8" style={styles.input}/>
          <TextInput value={date} onChangeText={setDate} placeholder="YYYY-MM-DD" placeholderTextColor="#8993A8" style={styles.input}/>
          <TextInput value={time} onChangeText={setTime} placeholder="HH:MM (24-hour)" placeholderTextColor="#8993A8" style={styles.input}/>
          <Text style={styles.label}>Repeat</Text>
          <View style={styles.row}>{["once", "daily", "weekly"].map(v => <Pressable key={v} onPress={() => setRepeat(v)} style={[styles.choice, repeat === v && styles.choiceOn]}><Text style={styles.choiceText}>{v.toUpperCase()}</Text></Pressable>)}</View>
          <Text style={styles.label}>Remind before deadline</Text>
          <View style={styles.row}>{["0", "5", "15", "30"].map(v => <Pressable key={v} onPress={() => setReminder(v)} style={[styles.choice, reminder === v && styles.choiceOn]}><Text style={styles.choiceText}>{v === "0" ? "AT DUE" : v + " MIN"}</Text></Pressable>)}</View>
          <Text style={styles.label}>Notification sound</Text>
          <View style={styles.row}>{SOUND_OPTIONS.map(v => <Pressable key={v.id} onPress={() => setSound(v.id)} style={[styles.choice, sound === v.id && styles.choiceOn]}><Text style={styles.choiceText}>{v.label}</Text></Pressable>)}</View>
          <Pressable onPress={addTask} style={styles.add}><Text style={styles.addText}>+ ADD TASK</Text></Pressable>
        </View>
        <Text style={styles.section}>YOUR TASKS · {tasks.filter(t => !t.done).length} LEFT</Text>
        <FlatList data={tasks} keyExtractor={item => item.id}
          ListEmptyComponent={<Text style={styles.muted}>No tasks yet. Add your first one above.</Text>}
          renderItem={({item}) => <View style={styles.card}>
            <Pressable onPress={() => toggleTask(item)} style={[styles.check, item.done && styles.checked]}><Text style={styles.checkText}>{item.done ? "✓" : ""}</Text></Pressable>
            <View style={styles.taskBody}><Text style={[styles.taskName, item.done && styles.strike]}>{item.name}</Text><Text style={styles.muted}>{item.date} · {item.time} · {item.repeat.toUpperCase()} · {(item.sound || "low").toUpperCase()} SOUND</Text></View>
            <Pressable onPress={() => Alert.alert("Delete task?", item.name, [{text:"Cancel"}, {text:"Delete", style:"destructive", onPress:()=>removeTask(item)}])}><Text style={styles.delete}>×</Text></Pressable>
          </View>}
        />
        <Text style={styles.foot}>Device reminders • Cloud sync requires Supabase setup</Text>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen:{flex:1,backgroundColor:"#05070d"},container:{flex:1,padding:20,paddingTop:18},
  brand:{fontSize:34,fontWeight:"900",letterSpacing:3,color:"#F4F7FF"},dot:{color:"#B7F34A"},
  heading:{fontSize:22,fontWeight:"800",color:"#F4F7FF",marginTop:8},muted:{color:"#8993A8",fontSize:12,marginTop:5},
  form:{backgroundColor:"#101624",borderColor:"#202B40",borderWidth:1,borderRadius:18,padding:14,marginTop:18,marginBottom:16},
  input:{backgroundColor:"#080D17",borderColor:"#27344D",borderWidth:1,borderRadius:10,padding:12,color:"#F4F7FF",marginBottom:9},
  label:{color:"#AEB9CC",fontSize:11,fontWeight:"700",marginTop:7,marginBottom:8},
  row:{flexDirection:"row",gap:7,marginBottom:8,flexWrap:"wrap"},choice:{paddingVertical:9,paddingHorizontal:12,borderRadius:9,borderWidth:1,borderColor:"#35425B",justifyContent:"center"},
  choiceOn:{backgroundColor:"#203D9C",borderColor:"#4771FF"},choiceText:{fontSize:10,color:"#F4F7FF",fontWeight:"800"},
  add:{backgroundColor:"#315CFF",padding:14,borderRadius:10,alignItems:"center",marginTop:8,flex:1},addText:{color:"white",fontWeight:"900",letterSpacing:1},
  section:{color:"#B7F34A",fontSize:11,fontWeight:"900",letterSpacing:1.5,marginBottom:10},
  card:{flexDirection:"row",alignItems:"center",backgroundColor:"#101624",borderWidth:1,borderColor:"#202B40",borderRadius:13,padding:12,marginBottom:9},
  check:{width:25,height:25,borderRadius:8,borderWidth:1,borderColor:"#52617A",alignItems:"center",justifyContent:"center",marginRight:10},
  checked:{backgroundColor:"#B7F34A",borderColor:"#B7F34A"},checkText:{color:"#05070d",fontWeight:"900"},
  taskBody:{flex:1},taskName:{color:"#F4F7FF",fontWeight:"700",fontSize:14},strike:{textDecorationLine:"line-through",color:"#758097"},
  delete:{color:"#FF718A",fontSize:25,paddingHorizontal:7},foot:{color:"#64718A",fontSize:10,textAlign:"center",paddingVertical:10},
  signout:{color:"#B7F34A",fontSize:11,marginTop:10}
});
