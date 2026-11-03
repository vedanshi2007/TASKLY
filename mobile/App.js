import React, { useEffect, useState } from "react";
import {
  Alert, FlatList, KeyboardAvoidingView, Platform, Pressable,
  SafeAreaView, StyleSheet, Text, TextInput, View
} from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Notifications from "expo-notifications";

const KEY = "taskly_mobile_tasks_v1";

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
    shouldShowBanner: true,
    shouldShowList: true
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
    await Notifications.setNotificationChannelAsync("task-reminders", {
      name: "Task reminders",
      importance: Notifications.AndroidImportance.MAX,
      vibrationPattern: [0, 300, 150, 300],
      sound: "default",
      lockscreenVisibility: Notifications.AndroidNotificationVisibility.PUBLIC
    });
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
  const allowed = await prepareNotifications();
  if (!allowed) return [];
  const ids = [];
  const dates = nextDates(task);
  for (const due of dates) {
    const reminderAt = new Date(due.getTime() - (task.reminder || 0) * 60000);
    const triggerAt = reminderAt > new Date() ? reminderAt : due;
    if (triggerAt <= new Date()) continue;
    const id = await Notifications.scheduleNotificationAsync({
      content: {
        title: "TASKLY · Deadline reminder",
        body: task.name,
        sound: "default",
        data: { taskId: task.id }
      },
      trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date: triggerAt, channelId: "task-reminders" }
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
  const [ready, setReady] = useState(false);

  useEffect(() => {
    (async () => {
      await prepareNotifications();
      const saved = await AsyncStorage.getItem(KEY);
      if (saved) {
        const loaded = JSON.parse(saved);
        setTasks(loaded);
        // Rebuild a rolling reminder window when the app is opened.
        for (const task of loaded.filter(t => !t.done)) {
          const freshIds = await scheduleTask(task);
          task.notificationIds = [...new Set([...(task.notificationIds || []), ...freshIds])];
        }
        await AsyncStorage.setItem(KEY, JSON.stringify(loaded));
      }
      setReady(true);
    })();
  }, []);

  async function persist(next) {
    setTasks(next);
    await AsyncStorage.setItem(KEY, JSON.stringify(next));
  }

  async function addTask() {
    if (!name.trim()) return Alert.alert("Add a task name", "Enter what you need to do.");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) {
      return Alert.alert("Check date and time", "Use YYYY-MM-DD and 24-hour HH:MM format.");
    }
    const task = {
      id: makeId(), name: name.trim(), date, time, repeat,
      reminder: Number(reminder) || 0, days: [], done: false, notificationIds: []
    };
    task.notificationIds = await scheduleTask(task);
    await persist([task, ...tasks]);
    setName("");
    Alert.alert("Task saved", task.notificationIds.length
      ? "Your device reminders have been scheduled."
      : "Task saved. Enable notifications in device settings to receive reminders.");
  }

  async function toggleTask(task) {
    const updated = { ...task, done: !task.done };
    if (updated.done) {
      await Promise.all((task.notificationIds || []).map(id => Notifications.cancelScheduledNotificationAsync(id).catch(() => {})));
      updated.notificationIds = [];
    } else {
      updated.notificationIds = await scheduleTask(updated);
    }
    await persist(tasks.map(t => t.id === task.id ? updated : t));
  }

  async function removeTask(task) {
    await Promise.all((task.notificationIds || []).map(id => Notifications.cancelScheduledNotificationAsync(id).catch(() => {})));
    await persist(tasks.filter(t => t.id !== task.id));
  }

  if (!ready) return <SafeAreaView style={styles.screen}><Text style={styles.brand}>TASKLY</Text><Text style={styles.muted}>Loading your tasks…</Text></SafeAreaView>;

  return (
    <SafeAreaView style={styles.screen}>
      <KeyboardAvoidingView style={styles.container} behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <Text style={styles.brand}>TASKLY<Text style={styles.dot}>.</Text></Text>
        <Text style={styles.heading}>Plan it. Do it. On time.</Text>
        <Text style={styles.muted}>Your reminders are scheduled on this device.</Text>
        <View style={styles.form}>
          <TextInput value={name} onChangeText={setName} placeholder="What do you need to do?" placeholderTextColor="#8993A8" style={styles.input}/>
          <TextInput value={date} onChangeText={setDate} placeholder="YYYY-MM-DD" placeholderTextColor="#8993A8" style={styles.input}/>
          <TextInput value={time} onChangeText={setTime} placeholder="HH:MM (24-hour)" placeholderTextColor="#8993A8" style={styles.input}/>
          <Text style={styles.label}>Repeat</Text>
          <View style={styles.row}>
            {["once", "daily", "weekly"].map(v => <Pressable key={v} onPress={() => setRepeat(v)} style={[styles.choice, repeat === v && styles.choiceOn]}><Text style={styles.choiceText}>{v.toUpperCase()}</Text></Pressable>)}
          </View>
          <Text style={styles.label}>Remind before deadline</Text>
          <View style={styles.row}>
            {["0", "5", "15", "30"].map(v => <Pressable key={v} onPress={() => setReminder(v)} style={[styles.choice, reminder === v && styles.choiceOn]}><Text style={styles.choiceText}>{v === "0" ? "AT DUE" : v + " MIN"}</Text></Pressable>)}
          </View>
          <Pressable onPress={addTask} style={styles.add}><Text style={styles.addText}>+ ADD TASK</Text></Pressable>
        </View>
        <Text style={styles.section}>YOUR TASKS · {tasks.filter(t => !t.done).length} LEFT</Text>
        <FlatList
          data={tasks}
          keyExtractor={item => item.id}
          ListEmptyComponent={<Text style={styles.muted}>No tasks yet. Add your first one above.</Text>}
          renderItem={({item}) => <View style={styles.card}>
            <Pressable onPress={() => toggleTask(item)} style={[styles.check, item.done && styles.checked]}><Text style={styles.checkText}>{item.done ? "✓" : ""}</Text></Pressable>
            <View style={styles.taskBody}><Text style={[styles.taskName, item.done && styles.strike]}>{item.name}</Text><Text style={styles.muted}>{item.date} · {item.time} · {item.repeat.toUpperCase()}</Text></View>
            <Pressable onPress={() => Alert.alert("Delete task?", item.name, [{text:"Cancel"}, {text:"Delete", style:"destructive", onPress:()=>removeTask(item)}])}><Text style={styles.delete}>×</Text></Pressable>
          </View>}
        />
        <Text style={styles.foot}>Local device reminders • Cloud sync setup is the next step</Text>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen:{flex:1,backgroundColor:"#05070d"},container:{flex:1,padding:20,paddingTop:18},
  brand:{fontSize:34,fontWeight:"900",letterSpacing:3,color:"#F4F7FF"},dot:{color:"#B7F34A"},
  heading:{fontSize:22,fontWeight:"800",color:"#F4F7FF",marginTop:8},muted:{color:"#8993A8",fontSize:12,marginTop:5},
  form:{backgroundColor:"#101624",borderColor:"#202B40",borderWidth:1,borderRadius:18,padding:14,marginTop:20,marginBottom:22},
  input:{backgroundColor:"#080D17",borderColor:"#27344D",borderWidth:1,borderRadius:10,padding:12,color:"#F4F7FF",marginBottom:9},
  label:{color:"#AEB9CC",fontSize:11,fontWeight:"700",marginTop:7,marginBottom:8},
  row:{flexDirection:"row",gap:7,marginBottom:8},choice:{paddingVertical:9,paddingHorizontal:12,borderRadius:9,borderWidth:1,borderColor:"#35425B"},
  choiceOn:{backgroundColor:"#203D9C",borderColor:"#4771FF"},choiceText:{fontSize:10,color:"#F4F7FF",fontWeight:"800"},
  add:{backgroundColor:"#315CFF",padding:14,borderRadius:10,alignItems:"center",marginTop:8},addText:{color:"white",fontWeight:"900",letterSpacing:1},
  section:{color:"#B7F34A",fontSize:11,fontWeight:"900",letterSpacing:1.5,marginBottom:10},
  card:{flexDirection:"row",alignItems:"center",backgroundColor:"#101624",borderWidth:1,borderColor:"#202B40",borderRadius:13,padding:12,marginBottom:9},
  check:{width:25,height:25,borderRadius:8,borderWidth:1,borderColor:"#52617A",alignItems:"center",justifyContent:"center",marginRight:10},
  checked:{backgroundColor:"#B7F34A",borderColor:"#B7F34A"},checkText:{color:"#05070d",fontWeight:"900"},
  taskBody:{flex:1},taskName:{color:"#F4F7FF",fontWeight:"700",fontSize:14},strike:{textDecorationLine:"line-through",color:"#758097"},
  delete:{color:"#FF718A",fontSize:25,paddingHorizontal:7},foot:{color:"#64718A",fontSize:10,textAlign:"center",paddingVertical:10}
});
