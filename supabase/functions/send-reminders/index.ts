import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import webpush from "npm:web-push";
const supabase=createClient(Deno.env.get("SUPABASE_URL")!,Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
webpush.setVapidDetails(Deno.env.get("VAPID_SUBJECT")!,Deno.env.get("VAPID_PUBLIC_KEY")!,Deno.env.get("VAPID_PRIVATE_KEY")!);
Deno.serve(async req=>{
  if((req.headers.get("authorization")||"")!==`Bearer ${Deno.env.get("CRON_SECRET")}`)return new Response("Unauthorized",{status:401});
  const now=new Date().toISOString();
  const {data:jobs,error}=await supabase.from("reminder_jobs").select("id,user_id,task_title,reminder_type").is("sent_at",null).lte("scheduled_for",now).limit(100);
  if(error)return Response.json({error:error.message},{status:500});
  let sent=0;
  for(const job of jobs??[]){
    const {data:subs}=await supabase.from("push_subscriptions").select("subscription").eq("user_id",job.user_id);
    const payload=JSON.stringify({title:job.reminder_type==="overdue"?"TASKLY · Overdue task":"TASKLY · Upcoming deadline",body:job.task_title,url:"/"});
    for(const sub of subs??[]){try{await webpush.sendNotification(sub.subscription,payload);sent++;}catch(err){console.error("Push failed",err);}}
    await supabase.from("reminder_jobs").update({sent_at:now}).eq("id",job.id);
  }
  return Response.json({processed:jobs?.length??0,pushDeliveries:sent});
});