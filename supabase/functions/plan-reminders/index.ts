import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
function dueAt(task: any): Date | null {
  if (!task?.date || !task?.time) return null;
  const d = new Date(`${task.date}T${task.time}:00`);
  return Number.isNaN(d.getTime()) ? null : d;
}
Deno.serve(async req => {
  if (req.headers.get("authorization") !== `Bearer ${Deno.env.get("CRON_SECRET")}`) return new Response("Unauthorized", {status:401});
  const {data: rows,error}=await db.from("tasks").select("id,user_id,task_data");
  if(error) return Response.json({error:error.message},{status:500});
  const now=Date.now(), jobs:any[]=[];
  for(const row of rows??[]){
    const t=row.task_data; if(!t||t.done) continue;
    const due=dueAt(t); if(!due) continue;
    const before=new Date(due.getTime()-Number(t.reminder??15)*60000);
    if(before.getTime()<=now&&due.getTime()>now) jobs.push({user_id:row.user_id,task_id:row.id,task_title:t.name,scheduled_for:before.toISOString(),reminder_type:"before_due"});
    if(due.getTime()<=now){const overdue=new Date(due.getTime()+60000);if(overdue.getTime()>now-120000)jobs.push({user_id:row.user_id,task_id:row.id,task_title:t.name,scheduled_for:overdue.toISOString(),reminder_type:"overdue"});}
  }
  if(jobs.length){const {error:insertError}=await db.from("reminder_jobs").upsert(jobs,{onConflict:"user_id,task_id,scheduled_for,reminder_type",ignoreDuplicates:true});if(insertError)return Response.json({error:insertError.message},{status:500});}
  return Response.json({scanned:rows?.length??0,queued:jobs.length});
});