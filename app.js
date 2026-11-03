const $ = id => document.getElementById(id);
const STORAGE_KEY = "taskly_tasks_v1";
let tasks = JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]");
let currentView = "today", currentFilter = "all", alarmTaskId = null, alarmTimer = null, audioCtx = null, soundEnabled = true, alerted = new Set();
const todayISO = () => { const d=new Date(); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`; };
const dateObj = (date,time="23:59") => new Date(`${date}T${time}:00`);
const fmtDate = (d,opts={weekday:"short",month:"short",day:"numeric"}) => new Date(`${d}T12:00:00`).toLocaleDateString(undefined,opts);
const save = () => { localStorage.setItem(STORAGE_KEY,JSON.stringify(tasks)); render(); window.dispatchEvent(new CustomEvent("taskly:save",{detail:tasks})); };
window.addEventListener("taskly:load", e => { tasks = Array.isArray(e.detail) ? e.detail : []; localStorage.setItem(STORAGE_KEY,JSON.stringify(tasks)); render(); });
const escapeHTML = s => String(s||"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
function toast(msg){$("toast").textContent=msg;$("toast").classList.add("show");setTimeout(()=>$("toast").classList.remove("show"),2600);}
function dueDate(t){return dateObj(t.date,t.time);}
function nextOccurrences(t,limit=30){
 const first=dueDate(t),out=[],now=new Date();
 for(let i=0;i<370&&out.length<limit;i++){
  const d=new Date(first);d.setDate(first.getDate()+i);
  const match=t.repeat==="daily"||t.repeat==="weekly"&&d.getDay()===first.getDay()||t.repeat==="custom"&&(t.days||[]).includes(d.getDay())||t.repeat!=="daily"&&t.repeat!=="weekly"&&t.repeat!=="custom"&&i===0;
  if(match&&d.getTime()>now.getTime()-24*60*60*1000)out.push(d);
  if(!t.repeat||t.repeat==="once")break;
 }
 return out;
}
function isOverdue(t){return !t.done && dueDate(t)<new Date();}
function isToday(t){return t.date===todayISO();}
function repeatText(t){return ({once:"ONE-TIME",daily:"DAILY",weekly:"WEEKLY",custom:"CUSTOM"})[t.repeat]||"ONE-TIME";}
function render(){
 const active=tasks.filter(t=>!t.done),done=tasks.filter(t=>t.done),over=active.filter(isOverdue);
 $("totalStat").textContent=tasks.length;$("doneStat").textContent=done.length;$("pendingStat").textContent=active.length;$("overdueStat").textContent=over.length;
 $("focusCount").textContent=`${active.length} task${active.length===1?"":"s"} left`;
 const pct=tasks.length?Math.round(done.length/tasks.length*100):0;$("progressText").textContent=pct+"%";$("progressBar").style.width=pct+"%";
 const titles={today:["YOUR PRIORITIES","Today's tasks"],upcoming:["PLAN AHEAD","Upcoming tasks"],all:["YOUR WORKSPACE","All tasks"],completed:["LOOK HOW FAR YOU'VE COME","Completed tasks"]};
 $("viewEyebrow").textContent=titles[currentView][0];$("viewTitle").innerHTML=titles[currentView][1]+'<span class="lime-dot">.</span>';
 let list=tasks.filter(t=>{
   if(currentView==="today")return isToday(t);
   if(currentView==="upcoming")return !t.done && t.date>=todayISO();
   if(currentView==="completed")return t.done;
   return true;
 });
 if(currentFilter==="pending")list=list.filter(t=>!t.done);
 if(currentFilter==="overdue")list=list.filter(isOverdue);
 list.sort((a,b)=>dueDate(a)-dueDate(b));
 $("taskList").innerHTML=list.map(t=>`<article class="task-card ${t.done?"completed":""} ${isOverdue(t)?"overdue":""}">
 <button class="check ${t.done?"checked":""}" data-action="toggle" data-id="${t.id}" aria-label="Mark complete">${t.done?"✓":""}</button>
 <div class="task-info"><div class="task-title">${escapeHTML(t.name)}</div>${t.description?`<div class="task-desc">${escapeHTML(t.description)}</div>`:""}
 <div class="task-meta"><span class="task-time ${isOverdue(t)?"overdue-label":""}">${isOverdue(t)?"OVERDUE · ": ""}${fmtDate(t.date)} · ${new Date(`2000-01-01T${t.time}`).toLocaleTimeString([],{hour:"numeric",minute:"2-digit"})}</span><span class="priority ${t.priority}">${t.priority}</span><span class="repeat-tag">${repeatText(t)}</span></div></div>
 <div class="task-actions"><button class="small-action" title="Edit" data-action="edit" data-id="${t.id}">✎</button><button class="small-action" title="Delete" data-action="delete" data-id="${t.id}">×</button></div></article>`).join("");
 $("emptyState").classList.toggle("show",list.length===0);$("taskList").style.display=list.length?"grid":"none";
 const upcoming=tasks.filter(t=>!t.done&&dueDate(t)>=new Date()).sort((a,b)=>dueDate(a)-dueDate(b)).slice(0,4);
 $("upcomingList").innerHTML=upcoming.length?upcoming.map(t=>`<div class="upcoming-item"><div class="upcoming-date"><b>${new Date(t.date+"T12:00:00").getDate()}</b>${new Date(t.date+"T12:00:00").toLocaleDateString([],{month:"short"})}</div><div><strong>${escapeHTML(t.name)}</strong><small>${fmtDate(t.date,{weekday:"short"})} · ${t.time}</small></div></div>`).join(""):'<p class="muted">No upcoming deadlines. Enjoy the breathing room.</p>';
}
function openModal(t=null){
 $("taskForm").reset();$("editingId").value=t?.id||"";$("modalTitle").innerHTML=(t?"Edit task":"Create a task")+'<span class="lime-dot">.</span>';
 $("taskName").value=t?.name||"";$("taskDescription").value=t?.description||"";$("taskDate").value=t?.date||todayISO();$("taskTime").value=t?.time||"18:00";$("taskRepeat").value=t?.repeat||"once";$("reminder").value=t?.reminder??15;$("taskPriority").value=t?.priority||"medium";$("taskSound").value=t?.sound||"high";
 document.querySelectorAll("#weekdayPicker input").forEach(c=>c.checked=(t?.days||[]).includes(Number(c.value)));
 $("weekdayPicker").classList.toggle("show",$("taskRepeat").value==="custom");$("taskModal").classList.add("open");$("taskName").focus();
}
function closeModal(){$("taskModal").classList.remove("open")}
$("taskRepeat").addEventListener("change",()=>$("weekdayPicker").classList.toggle("show",$("taskRepeat").value==="custom"));
["addTaskBtn","emptyAddBtn"].forEach(id=>$(id).addEventListener("click",()=>openModal()));
["closeModal","cancelModal"].forEach(id=>$(id).addEventListener("click",closeModal));
$("taskForm").addEventListener("submit",e=>{
 e.preventDefault();const id=$("editingId").value;const repeat=$("taskRepeat").value;const days=[...document.querySelectorAll("#weekdayPicker input:checked")].map(c=>Number(c.value));
 if(repeat==="custom"&&!days.length){toast("Choose at least one day for a custom repeat.");return;}
 const old=tasks.find(t=>t.id===id);
 const task={id:id||crypto.randomUUID(),sound:$("taskSound").value,name:$("taskName").value.trim(),description:$("taskDescription").value.trim(),date:$("taskDate").value,time:$("taskTime").value,repeat,days,reminder:Number($("reminder").value),priority:$("taskPriority").value,done:old?.done||false,created:old?.created||Date.now(),lastAlert:old?.lastAlert||{}};
 if(!task.name)return;
 if(old)tasks=tasks.map(t=>t.id===id?task:t);else tasks.push(task);
 closeModal();save();toast(old?"Task updated.":"Task added. You've got this.");
});
$("taskList").addEventListener("click",e=>{
 const b=e.target.closest("[data-action]");if(!b)return;const t=tasks.find(x=>x.id===b.dataset.id);if(!t)return;
 if(b.dataset.action==="toggle"){t.done=!t.done;if(t.done&&alarmTaskId===t.id)stopAlarm();save();toast(t.done?"Task completed. Nice work!":"Task marked pending.");}
 if(b.dataset.action==="edit")openModal(t);
 if(b.dataset.action==="delete"&&confirm("Delete this task?")){tasks=tasks.filter(x=>x.id!==t.id);save();toast("Task deleted.");}
});
document.querySelectorAll(".nav-item").forEach(b=>b.addEventListener("click",()=>{document.querySelectorAll(".nav-item").forEach(x=>x.classList.remove("active"));b.classList.add("active");currentView=b.dataset.view;currentFilter="all";document.querySelectorAll(".filter").forEach(x=>x.classList.toggle("active",x.dataset.filter==="all"));render();}));
document.querySelectorAll(".filter").forEach(b=>b.addEventListener("click",()=>{document.querySelectorAll(".filter").forEach(x=>x.classList.remove("active"));b.classList.add("active");currentFilter=b.dataset.filter;render();}));
let alarmVolume=.22;\nfunction playBeep(){
 if(!soundEnabled)return;
 try{audioCtx=audioCtx||new (window.AudioContext||window.webkitAudioContext)();if(audioCtx.state==="suspended")audioCtx.resume();
  [0,0.28,0.56].forEach((delay,i)=>{const osc=audioCtx.createOscillator(),gain=audioCtx.createGain();osc.type="sine";osc.frequency.value=i===1?880:660;gain.gain.setValueAtTime(.0001,audioCtx.currentTime+delay);gain.gain.exponentialRampToValueAtTime((alarmVolume||.22),audioCtx.currentTime+delay+.03);gain.gain.exponentialRampToValueAtTime(.0001,audioCtx.currentTime+delay+.22);osc.connect(gain);gain.connect(audioCtx.destination);osc.start(audioCtx.currentTime+delay);osc.stop(audioCtx.currentTime+delay+.24);});
 }catch(e){}
}
function startAlarm(t,kind){
 if(alarmTaskId)return;alarmTaskId=t.id;$("alarmTitle").textContent=kind==="overdue"?"This task is overdue.":"Deadline reached."; $("alarmMessage").textContent=`${t.name} · Due ${t.time}`;
 $("alarmOverlay").classList.add("open");alarmVolume=t.sound==="silent"?0:t.sound==="low"?.07:.22;playBeep();alarmTimer=setInterval(playBeep,3500);
 if("Notification"in window&&Notification.permission==="granted")new Notification(kind==="overdue"?"TASKLY · Overdue task":"TASKLY · Deadline reminder",{body:t.name,tag:"taskly-"+t.id});
}
function stopAlarm(){clearInterval(alarmTimer);alarmTimer=null;alarmTaskId=null;$("alarmOverlay").classList.remove("open");}
$("stopAlarm").addEventListener("click",stopAlarm);
$("snoozeAlarm").addEventListener("click",()=>{const t=tasks.find(x=>x.id===alarmTaskId);if(t){t.snoozeUntil=Date.now()+5*60000;save();}stopAlarm();toast("Reminder snoozed for 5 minutes.");});
$("alarmDone").addEventListener("click",()=>{const t=tasks.find(x=>x.id===alarmTaskId);if(t){t.done=true;save();}stopAlarm();toast("Task completed. Well done!");});
$("soundToggle").addEventListener("click",()=>{soundEnabled=!soundEnabled;$("soundToggle").style.color=soundEnabled?"var(--lime)":"#71809a";toast(soundEnabled?"Alarm sound enabled.":"Alarm sound muted.");});
async function enableNotifications(){if(!("Notification"in window)){toast("This browser does not support notifications.");return;}const p=await Notification.requestPermission();toast(p==="granted"?"Notifications enabled.":"Notification permission not granted.");}
$("enableNotifications").addEventListener("click",enableNotifications);
function checkReminders(){
 const now=Date.now();
 tasks.forEach(t=>{
  if(t.done||t.snoozeUntil&&now<t.snoozeUntil)return;
  const due=dueDate(t),remindAt=due-t.reminder*60000;
  const kind=now>=due.getTime()?"overdue":now>=remindAt?"reminder":null;
  if(kind&&!alerted.has(t.id+kind)){alerted.add(t.id+kind);startAlarm(t,kind);}
 });
}
function init(){
 const d=new Date();$("todayDate").textContent=d.toLocaleDateString(undefined,{weekday:"long",month:"long",day:"numeric",year:"numeric"}).toUpperCase();
 const hour=d.getHours();$("greeting").innerHTML=(hour<12?"Good morning.":hour<18?"Good afternoon.":"Good evening.")+'<br/><em>Plan it.</em> On time.';
 if("serviceWorker"in navigator&&location.protocol.startsWith("http"))navigator.serviceWorker.register("sw.js").catch(()=>{});
 render();setInterval(checkReminders,15000);
}
init();