import {NextRequest,NextResponse} from 'next/server';
import {z} from 'zod';
import {randomBytes} from 'node:crypto';
import {readFile,unlink} from 'node:fs/promises';
import {BRAND,FilterSettingsSchema,ModeSchema,SearchResultSchema,classifyResults, type Project} from '@cutling/shared';
import {db,get,id,list,must,now,put,remove} from '../../../server/db';
import {ApiError,authenticate,bootstrap,checkHost,consumePairCode,hash,isExtensionOrigin,rateLimit,readJson,webOrigins} from '../../../server/security';
import {addResource,ai,aiStatus,clearAIState,createNote,createProject,hcxConfigFingerprint,imagePath,noteTextHash,publicNote,refreshRoadmap,removeProject,report,settings,suggestions,updateNote} from '../../../server/services';
import {enqueue,kick} from '../../../server/jobs';
import {withDuplicateHistory} from '../../../server/duplicates';
import {createAI,readHCXConfig} from '@cutling/ai';
export const runtime='nodejs';
export const dynamic='force-dynamic';
type Context={params:Promise<{path:string[]}>};
const string=z.string().trim().min(1).max(300);
const goal=z.string().trim().max(500);
const sourceSchema=z.object({projectId:string,url:z.string().url().max(4000).refine(v=>/^https?:\/\//.test(v)&&!new URL(v).username&&!new URL(v).password).optional(),title:z.string().max(500).optional(),snippet:z.string().max(5000).optional(),text:z.string().max(40000).optional(),stageId:z.string().max(200).optional()});
function webOnly(auth:{type:string}){if(auth.type!=='session')throw new ApiError(403,'WEB_ONLY','이 작업은 웹 설정에서만 실행할 수 있습니다.');}
async function extensionStatus(ownerId:string){const connection=await db.credential.findFirst({where:{ownerId,kind:'extension',expiresAt:{gt:new Date()}},orderBy:{createdAt:'desc'}});return {connected:!!connection,expiresAt:connection?.expiresAt.toISOString()};}
function safeJob(job:any){const {ownerId:_owner,payload:_payload,...safe}=job;return safe;}
async function handler(req:NextRequest,context:Context){
 const requestId=id();const origin=req.headers.get('origin')||'';const headers:Record<string,string>={'X-Request-ID':requestId,'Cache-Control':'no-store'};
 if(isExtensionOrigin(origin)){headers['Access-Control-Allow-Origin']=origin;headers.Vary='Origin';}
 const json=(data:any,status=200)=>NextResponse.json(data,{status,headers});
 try{
  checkHost(req);const p=(await context.params).path;const route=p.join('/');const method=req.method;const q=req.nextUrl.searchParams;
  if(method==='OPTIONS'){if(!isExtensionOrigin(origin)&&!webOrigins().has(origin))throw new ApiError(403,'ORIGIN_REJECTED','허용되지 않은 출처입니다.');return new NextResponse(null,{status:204,headers:{...headers,'Access-Control-Allow-Methods':'GET, POST, PATCH, DELETE, OPTIONS','Access-Control-Allow-Headers':'Content-Type, Authorization, X-Cutling-Extension-ID','Access-Control-Max-Age':'600'}});}
  rateLimit(`global:${req.headers.get('host')}`,800);
  if(route==='health'&&method==='GET')return json({ok:true,brand:BRAND.name});
  if(route==='bootstrap'&&method==='GET'){
   const auth=await bootstrap(req);const [projects,s,status,extension]=await Promise.all([list(auth.ownerId,'project'),settings(auth.ownerId),aiStatus(auth.ownerId),extensionStatus(auth.ownerId)]);kick();const res=json({projects,settings:s,aiStatus:status,extension,mode:s.mode});if(auth.raw)res.cookies.set('cutling_session',auth.raw,{httpOnly:true,sameSite:'strict',secure:req.nextUrl.protocol==='https:',path:'/',maxAge:30*86400});return res;
  }
  if(route==='extension/pair'&&method==='POST'){
   rateLimit(`pair:${origin}`,12);const body=z.object({code:z.string().trim().min(6).max(20)}).parse(await readJson(req));const paired=await consumePairCode(body.code,origin);return json({token:paired.token,expiresAt:paired.expiresAt,projects:await list(paired.ownerId,'project')});
  }
  const auth=await authenticate(req);const ownerId=auth.ownerId;rateLimit(ownerId);kick();
  const body=['POST','PATCH'].includes(method)&&!(route==='notes'&&method==='POST')?await readJson(req):{};
  if(route==='projects'){
   if(method==='GET')return json({projects:await list(ownerId,'project')});
   if(method==='POST')return json(await createProject(ownerId,z.object({query:string,title:string.optional(),learningGoal:goal.optional(),learningLevel:string.optional(),selectedIntent:string.optional(),mode:ModeSchema.optional()}).parse(body)),201);
  }
  if(p[0]==='projects'&&p.length>=2){
   const project=await must<Project>(ownerId,'project',p[1]);
   if(p.length===2&&method==='GET'){const [resources,roadmap,notes,next,sessions]=await Promise.all([list(ownerId,'resource',project.id),get(ownerId,'roadmap',`roadmap:${project.id}`),list(ownerId,'note',project.id),suggestions(ownerId,project.id),list(ownerId,'session',project.id)]);return json({project,resources,roadmap,notes:notes.map(publicNote),suggestions:next,sessions});}
   if(p.length===2&&method==='PATCH'){const changes=z.object({title:string.optional(),selectedIntent:string.optional(),learningLevel:string.optional(),learningGoal:goal.optional(),filters:FilterSettingsSchema.optional()}).parse(body);const updated={...project,...changes,updatedAt:now()};await put(ownerId,'project',updated,project.id);const roadmap=await refreshRoadmap(ownerId,project.id);return json({project:updated,roadmap});}
   if(p.length===2&&method==='DELETE'){await removeProject(ownerId,project.id);return json({ok:true});}
   if(p[2]==='roadmap'){if(method==='GET')return json({roadmap:await get(ownerId,'roadmap',`roadmap:${project.id}`)});if(method==='POST'&&['refresh','generate'].includes(p[3]))return json({roadmap:await refreshRoadmap(ownerId,project.id)});}
   if(p[2]==='report'&&method==='GET')return json(await report(ownerId,project.id));
  }
  if(route==='search/sessions'&&method==='POST'){
   const input=z.object({projectId:string,query:string,tabSessionId:z.string().max(200).optional()}).parse(body);const project=await must<Project>(ownerId,'project',input.projectId);const session={id:id(),...input,intentSnapshot:project.selectedIntent,filterSettingsSnapshot:project.filters,startedAt:now(),version:0};await put(ownerId,'session',session,project.id);const url=new URL('https://search.naver.com/search.naver');url.searchParams.set('query',input.query);return json({session,searchUrl:url.toString()},201);
  }
  if(route==='search/intent'&&method==='POST'){
   const input=z.object({projectId:string,query:string,selectedIntent:string.optional()}).parse(body);let project=await must<Project>(ownerId,'project',input.projectId);const result=await ai(ownerId,project).inferIntent(input.query,project);
   if(input.selectedIntent){project={...project,selectedIntent:input.selectedIntent,updatedAt:now()};await put(ownerId,'project',project,project.id);}return json({...result.data,intent:input.selectedIntent||result.data.intent,roadmap:await refreshRoadmap(ownerId,project.id),fallback:result.fallback});
  }
  if(route==='search/results/analyze'&&method==='POST'){
   const input=z.object({projectId:string,sessionId:string,query:string,results:z.array(SearchResultSchema).min(1).max(30),version:z.number().int().nonnegative().optional()}).parse(body);const project=await must<Project>(ownerId,'project',input.projectId);const session=await must(ownerId,'session',input.sessionId);if(session.projectId!==project.id)throw new ApiError(403,'PROJECT_MISMATCH','검색 프로젝트가 일치하지 않습니다.');
   const version=input.version??session.version;if(version<session.version)return json({assessments:[],version,mode:project.mode,status:'stale'});await put(ownerId,'session',{...session,version,query:input.query},project.id);
   const history=(await list(ownerId,'result',project.id)).filter(r=>r.sessionId!==session.id||!input.results.some(i=>i.id===r.localId));const saved=await list(ownerId,'resource',project.id);
   const assessments=withDuplicateHistory(classifyResults(input.results,{query:input.query,selectedIntent:project.selectedIntent,learningGoal:project.learningGoal,learningLevel:project.learningLevel,filters:project.filters}),input.results,[...history,...saved],project.filters);
   for(const result of input.results)await put(ownerId,'result',{...result,localId:result.id,id:`${session.id}:${result.id}`,assessment:assessments.find(a=>a.resultId===result.id),sessionId:session.id,mode:project.mode,createdAt:now()},project.id,session.id);
   const job=project.mode==='live'?await enqueue(ownerId,project.id,'classify',`${session.id}:${version}:${id()}`,{sessionId:session.id,results:input.results,version}):null;
   return json({assessments,jobId:job?.id,mode:project.mode,version,status:job?'refining':'complete'});
  }
  if(p[0]==='search'&&p[1]==='results'&&p[3]==='feedback'&&method==='POST'){
   const input=z.object({projectId:string,sessionId:string,type:z.enum(['reveal','useful','always_domain','reevaluate']),domain:z.string().max(300).optional()}).parse(body);await must(ownerId,'project',input.projectId);const result=await must(ownerId,'result',`${input.sessionId}:${p[2]}`);if(result.projectId&&result.projectId!==input.projectId)throw new ApiError(403,'PROJECT_MISMATCH','프로젝트가 일치하지 않습니다.');const session=await must(ownerId,'session',input.sessionId);if(session.projectId!==input.projectId)throw new ApiError(403,'PROJECT_MISMATCH','프로젝트가 일치하지 않습니다.');await put(ownerId,'event',{id:id(),...input,resultId:p[2],timestamp:now()},input.projectId);
   if(input.type==='useful')await put(ownerId,'result',{...result,assessment:{...result.assessment,recommendedAction:'recommend',reasonCodes:['user_feedback'],evidence:['사용자가 유용한 자료로 선택했어요.']}},input.projectId,input.sessionId);
   if(input.type==='reevaluate'){const original={...result,id:result.localId};const job=await enqueue(ownerId,input.projectId,'classify',`${result.id}:retry:${id()}`,{sessionId:session.id,results:[original],version:session.version});return json({ok:true,jobId:job.id});}return json({ok:true});
  }
  if(route==='search/suggestions'&&['GET','POST'].includes(method)){const projectId=string.parse(q.get('projectId')||body.projectId);await must(ownerId,'project',projectId);return json({suggestions:await suggestions(ownerId,projectId)});}
  if(route==='resources'){
   if(method==='GET'){const projectId=q.get('projectId')||undefined;if(projectId)await must(ownerId,'project',projectId);return json({resources:await list(ownerId,'resource',projectId)});}
   if(method==='POST')return json(await addResource(ownerId,sourceSchema.parse(body)),201);
  }
  if(p[0]==='resources'&&p[1]){
   const resource=await must(ownerId,'resource',p[1]);
   if(p.length===2&&method==='GET')return json({resource});
   if(p.length===2&&method==='PATCH'){const changes=z.object({userMemo:z.string().max(10000).optional(),important:z.boolean().optional(),tags:z.array(z.string().max(50)).max(20).optional()}).parse(body);return json({resource:await put(ownerId,'resource',{...resource,...changes,updatedAt:now()},resource.projectId)});}
   if(p.length===2&&method==='DELETE'){await remove(ownerId,'resource',resource.id);await refreshRoadmap(ownerId,resource.projectId);return json({ok:true});}
   if(['summarize','reextract'].includes(p[2])&&method==='POST'){const updated={...resource,status:'queued'};await put(ownerId,'resource',updated,resource.projectId);const job=await enqueue(ownerId,resource.projectId,'resource',resource.id,{fetch:p[2]==='reextract'});return json({resource:updated,jobId:job.id});}
  }
  if(p[0]==='roadmap'&&p[1]==='stages'&&p[2]&&method==='PATCH'){
   const input=z.object({projectId:string,completed:z.boolean().optional(),userMemo:z.string().max(10000).optional()}).parse(body);await must(ownerId,'project',input.projectId);const roadmap=await must(ownerId,'roadmap',`roadmap:${input.projectId}`);if(!roadmap.stages.some((s:any)=>s.id===p[2]))throw new ApiError(404,'NOT_FOUND','학습 단계를 찾을 수 없습니다.');roadmap.stages=roadmap.stages.map((s:any)=>s.id===p[2]?{...s,...(input.completed!==undefined?{completed:input.completed}:{}),...(input.userMemo!==undefined?{userMemo:input.userMemo}:{})}:s);return json({roadmap:await put(ownerId,'roadmap',roadmap,input.projectId)});
  }
  if(route==='notes'){
   if(method==='GET'){const projectId=q.get('projectId')||undefined;if(projectId)await must(ownerId,'project',projectId);return json({notes:(await list(ownerId,'note',projectId)).map(publicNote)});}
   if(method==='POST'){rateLimit(`upload:${ownerId}`,10);const max=6*1024*1024;let size=0;const chunks:Uint8Array[]=[];const reader=req.body?.getReader();if(!reader)throw new ApiError(400,'FILE_REQUIRED','이미지를 선택해 주세요.');for(;;){const r=await reader.read();if(r.done)break;size+=r.value.length;if(size>max){await reader.cancel();throw new ApiError(413,'IMAGE_TOO_LARGE','이미지 업로드는 5MB 이하로 제한됩니다.');}chunks.push(r.value);}const form=await new Request(req.url,{method:'POST',headers:{'content-type':req.headers.get('content-type')||''},body:Buffer.concat(chunks)}).formData();return json(await createNote(ownerId,form),201);}
  }
  if(p[0]==='notes'&&p[1]){
   const note=await must(ownerId,'note',p[1]);
   if(p[2]==='image'&&method==='GET'){if(!note.imageStorageKey)throw new ApiError(404,'NOT_FOUND','보관된 이미지가 없습니다.');return new NextResponse(await readFile(imagePath(note.imageStorageKey)),{headers:{...headers,'Content-Type':'image/png','Content-Disposition':'inline'}});}
   if(p.length===2&&method==='GET')return json({note:publicNote(note)});
   if(p.length===2&&method==='PATCH'){const input=z.object({editedText:z.string().max(40000),title:z.string().max(200).optional(),stageId:z.string().max(200).optional()}).parse(body);return json({note:publicNote(await updateNote(ownerId,note.id,input))});}
   if(p[2]==='organize'&&method==='POST'){const project=await must<Project>(ownerId,'project',note.projectId);if(project.mode==='live'&&body.externalConsent!==true)throw new ApiError(400,'CONSENT_REQUIRED','검토한 필기 텍스트의 HCX 전송에 동의해 주세요.');if(!(note.editedText||note.ocrText).trim())throw new ApiError(400,'EMPTY_NOTE','인식 결과를 확인하거나 텍스트를 입력해 주세요.');const textHash=noteTextHash(note.editedText||note.ocrText);const updated={...note,status:'processing',externalConsent:body.externalConsent===true,consentTextHash:body.externalConsent===true?textHash:undefined};await put(ownerId,'note',updated,note.projectId);const job=await enqueue(ownerId,note.projectId,'organize',note.id,{textHash,externalConsent:body.externalConsent===true});return json({note:publicNote(updated),jobId:job.id});}
   if(p.length===2&&method==='DELETE'){if(note.imageStorageKey)await unlink(imagePath(note.imageStorageKey)).catch(()=>{});await remove(ownerId,'note',note.id);await remove(ownerId,'resource',`note-resource:${note.id}`);await refreshRoadmap(ownerId,note.projectId);return json({ok:true});}
  }
  if(route==='events'&&method==='POST'){const input=z.object({projectId:string,sessionId:string.optional(),resultId:string.optional(),type:z.enum(['reveal','save','click','filter_off','useful','always_domain','search_opened']),metadata:z.record(z.unknown()).optional()}).parse(body);await must(ownerId,'project',input.projectId);if(input.sessionId){const session=await must(ownerId,'session',input.sessionId);if(session.projectId!==input.projectId)throw new ApiError(403,'PROJECT_MISMATCH','프로젝트가 일치하지 않습니다.');}await put(ownerId,'event',{id:id(),...input,timestamp:now()},input.projectId);return json({ok:true});}
  if(route==='extension/code'&&method==='POST'){webOnly(auth);const code=randomBytes(5).toString('hex').toUpperCase(),expiresAt=new Date(Date.now()+5*60000);await db.credential.deleteMany({where:{ownerId,kind:'code'}});await db.credential.create({data:{hash:hash(code),kind:'code',ownerId,expiresAt}});return json({code,expiresAt:expiresAt.toISOString()});}
  if(route==='extension/status'&&method==='GET')return json(await extensionStatus(ownerId));
  if(route==='extension/revoke'&&method==='POST'){await db.credential.deleteMany({where:auth.type==='extension'?{hash:auth.credential.hash,ownerId}:{ownerId,kind:{in:['extension','code']}}});return json({ok:true});}
  if(route==='settings'){
   if(method==='GET')return json({settings:await settings(ownerId)});
   if(method==='PATCH'){webOnly(auth);const s=await settings(ownerId);const changes=z.object({mode:ModeSchema.optional(),filters:FilterSettingsSchema.optional(),reviewSeconds:z.number().min(0).max(600).optional(),organizeSeconds:z.number().min(0).max(3600).optional()}).parse(body);if(changes.mode&&!s.allowedModes.includes(changes.mode))throw new ApiError(403,'MODE_DISABLED','허용되지 않은 모드입니다.');return json({settings:await put(ownerId,'settings',{...s,...changes})});}
  }
  if(route==='ai/status'&&method==='GET')return json(await aiStatus(ownerId));
  if(route==='ai/diagnose'&&method==='POST'){webOnly(auth);rateLimit(`diagnose:${ownerId}`,4);const result=await createAI({mode:'live',ownerId,config:readHCXConfig(process.env),onCall:async(log)=>{await put(ownerId,'modelCall',{...log,id:id(),diagnostic:true});}}).diagnose();await put(ownerId,'diagnostic',{id:`diagnostic:${ownerId}`,...result,configFingerprint:hcxConfigFingerprint(),checkedAt:now()});return json(await aiStatus(ownerId));}
  if(p[0]==='jobs'&&p[1]&&method==='GET')return json({job:safeJob(await must(ownerId,'job',p[1]))});
  if(route==='data'&&method==='DELETE'){webOnly(auth);clearAIState(ownerId);for(const project of await list(ownerId,'project'))await removeProject(ownerId,project.id);await db.entity.deleteMany({where:{ownerId}});await db.credential.deleteMany({where:{ownerId,kind:{in:['extension','code']}}});return json({ok:true});}
  if(route==='demo/results'&&method==='GET'){const {DEMO_RESULTS}=await import('../../../server/fixtures');return json({results:DEMO_RESULTS,synthetic:true});}
  if(route==='demo/seed'&&method==='POST'){webOnly(auth);const {DEMO_RESULTS}=await import('../../../server/fixtures');const {project}=await createProject(ownerId,{query:'딥러닝 공부 순서',title:'딥러닝, 첫 걸음 · 데모 데이터',mode:'demo',selectedIntent:'입문 로드맵'});const session={id:id(),projectId:project.id,query:project.initialQuery,version:0,startedAt:now()};await put(ownerId,'session',session,project.id);const assessments=classifyResults(DEMO_RESULTS,{query:project.initialQuery,selectedIntent:project.selectedIntent,filters:project.filters});for(const result of DEMO_RESULTS)await put(ownerId,'result',{...result,localId:result.id,id:`${session.id}:${result.id}`,assessment:assessments.find(a=>a.resultId===result.id),sessionId:session.id,mode:'demo'},project.id);for(const result of DEMO_RESULTS.filter(r=>assessments.find(a=>a.resultId===r.id)?.recommendedAction==='recommend').slice(0,3))await addResource(ownerId,{projectId:project.id,title:result.title,url:result.url,text:result.snippet});return json({project});}
  if(route==='benchmarks/run'&&method==='POST'){webOnly(auth);if(process.env.BENCHMARK_ENABLED==='false')throw new ApiError(403,'BENCHMARK_DISABLED','벤치마크가 비활성화되어 있습니다.');const projectId=string.parse(body.projectId);await must(ownerId,'project',projectId);const {runBenchmark}=await import('../../../server/fixtures');const benchmark={id:id(),...runBenchmark(),createdAt:now()};await put(ownerId,'benchmark',benchmark,projectId);return json({benchmark});}
  if(p[0]==='benchmarks'&&p[1]&&method==='GET')return json({benchmark:await must(ownerId,'benchmark',p[1])});
  throw new ApiError(404,'NOT_FOUND','요청한 기능을 찾을 수 없습니다.');
 }catch(error){
  if(error instanceof z.ZodError)return json({error:{code:'VALIDATION_ERROR',message:'입력 내용을 확인해 주세요.',retryable:false,requestId}},400);
  const e=error as any;const status=e.status||500;return json({error:{code:e.code&&typeof e.code==='string'&&!e.code.startsWith('P')?e.code:'INTERNAL_ERROR',message:status<500?e.message:'처리 중 문제가 발생했습니다. 잠시 후 다시 시도해 주세요.',retryable:status>=500||Boolean(e.retryable),requestId}},status);
 }
}
export const GET=handler,POST=handler,PATCH=handler,DELETE=handler,OPTIONS=handler;
