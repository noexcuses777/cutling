import 'server-only';
import {db,get,id,list,now,put} from './db';
type Job={id:string,ownerId:string,projectId:string,type:string,entityId:string,status:string,progress:number,attempt:number,payload:any,result?:any,errorCode?:string,createdAt:string,updatedAt:string};
const state=globalThis as unknown as {cutlingJobs?:{running:boolean,recovered:boolean}};
const queue=state.cutlingJobs||={running:false,recovered:false};
export async function enqueue(ownerId:string,projectId:string,type:string,entityId:string,payload:any={}){
 const jobs=await list<Job>(ownerId,'job',projectId);const existing=jobs.find(j=>j.type===type&&j.entityId===entityId&&['queued','processing'].includes(j.status)&&(type!=='organize'||j.payload?.textHash===payload.textHash));if(existing)return existing;
 const job:Job={id:id(),ownerId,projectId,type,entityId,status:'queued',progress:0,attempt:0,payload,createdAt:now(),updatedAt:now()};await put(ownerId,'job',job,projectId);kick();return job;
}
export function kick(){if(!queue.running){queue.running=true;setTimeout(()=>void drain(),10);}}
async function drain(){
 try{
  if(!queue.recovered){const rows=await db.entity.findMany({where:{kind:'job'}});for(const row of rows){const job:Job=JSON.parse(row.data);if(job.status==='processing')await put(job.ownerId,'job',{...job,status:'queued',errorCode:'RECOVERED_AFTER_RESTART'},job.projectId);}queue.recovered=true;}
  for(;;){const rows=await db.entity.findMany({where:{kind:'job'},orderBy:{createdAt:'asc'}});const job=rows.map(r=>JSON.parse(r.data) as Job).find(j=>j.status==='queued');if(!job)break;
   if(!await get(job.ownerId,'project',job.projectId)){await db.entity.deleteMany({where:{id:job.id}});continue;}
   await put(job.ownerId,'job',{...job,status:'processing',attempt:job.attempt+1,progress:20,updatedAt:now()},job.projectId);
   try{const {processJob}=await import('./services');const result=await processJob(job);if(await get(job.ownerId,'job',job.id))await put(job.ownerId,'job',{...job,status:'completed',attempt:job.attempt+1,progress:100,result,updatedAt:now()},job.projectId);}
   catch(e){if(await get(job.ownerId,'job',job.id))await put(job.ownerId,'job',{...job,status:'failed',progress:100,errorCode:(e as any).code||'PROCESSING_FAILED',updatedAt:now()},job.projectId);}
  }
 }finally{queue.running=false;}
}
