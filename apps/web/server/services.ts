import 'server-only';
import {DEFAULT_FILTERS,createDraftRoadmap,updateRoadmap,suggestNextQueries,splitParagraphs,normalizeUrl,inferIntent, type Mode,type Project,type Resource,type Roadmap} from '@cutling/shared';
import {clearAICache,createAI,readHCXConfig} from '@cutling/ai';
import {createHash} from 'node:crypto';
import {db,get,id,list,must,now,put} from './db';
import {ApiError} from './security';
import {extractPublicPage} from './extract';
import {enqueue} from './jobs';
import {mkdir,readFile,unlink,writeFile} from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';

export async function settings(ownerId:string){const allowedModes=(process.env.ALLOWED_AI_MODES||'rules,demo,live').split(',').filter(m=>['rules','demo','live'].includes(m));const saved=await get(ownerId,'settings',`settings:${ownerId}`);const result={id:`settings:${ownerId}`,mode:['live','demo','rules'].includes(process.env.AI_MODE||'')?process.env.AI_MODE:'rules',filters:DEFAULT_FILTERS,reviewSeconds:45,organizeSeconds:180,...saved,allowedModes};if(!allowedModes.includes(result.mode))result.mode=allowedModes[0]||'rules';return result;}
export function ai(ownerId:string,project:Pick<Project,'id'|'mode'>,sessionId?:string){return createAI({mode:project.mode,ownerId,config:readHCXConfig(process.env),onCall:async(log)=>{if(await get(ownerId,'project',project.id))await put(ownerId,'modelCall',{...log,id:id(),projectId:project.id,sessionId},project.id);}});}
export function hcxConfigFingerprint(){const c=readHCXConfig(process.env);return createHash('sha256').update(JSON.stringify({apiKey:c.apiKey,baseUrl:c.baseUrl,lightModel:c.lightModel,reasoningModel:c.reasoningModel,embeddingModel:c.embeddingModel,chatEndpoint:c.chatEndpoint,embeddingEndpoint:c.embeddingEndpoint})).digest('hex');}
export async function aiStatus(ownerId:string){const s=await settings(ownerId);const status=createAI({mode:s.mode,config:readHCXConfig(process.env)}).configStatus();const last=await get(ownerId,'diagnostic',`diagnostic:${ownerId}`);const sameConfig=last?.configFingerprint===hcxConfigFingerprint();return {mode:s.mode,...status,verified:status.configured&&sameConfig&&last?.verified===true,message:sameConfig?last?.message||status.message:status.message,ocr:{provider:'tesseract',external:false,available:process.env.OCR_ENABLED!=='false'},checkedAt:sameConfig?last?.checkedAt:undefined};}
export async function createProject(ownerId:string,input:any){const s=await settings(ownerId);const mode:Mode=input.mode||s.mode;if(!s.allowedModes.includes(mode))throw new ApiError(403,'MODE_DISABLED','운영자가 허용하지 않은 모드입니다.');const inferred=inferIntent(input.query);const project:Project={id:id(),title:input.title||input.query,initialQuery:input.query,learningGoal:input.learningGoal||input.query,learningLevel:input.learningLevel||'처음 시작',selectedIntent:input.selectedIntent||(inferred.confidence==='low'?'':inferred.intent),mode,filters:s.filters,createdAt:now(),updatedAt:now()};await put(ownerId,'project',project,project.id);const roadmap=createDraftRoadmap(project);await put(ownerId,'roadmap',roadmap,project.id);return {project,roadmap};}
export async function refreshRoadmap(ownerId:string,projectId:string){const project=await must<Project>(ownerId,'project',projectId);const current=await get<Roadmap>(ownerId,'roadmap',`roadmap:${projectId}`);const resources=await list<Resource>(ownerId,'resource',projectId);const roadmap=updateRoadmap(project,resources,current||undefined);if(current)await put(ownerId,'roadmapVersion',{...current,id:`${current.id}:v${current.version}`},projectId);await put(ownerId,'roadmap',roadmap,projectId);for(const r of resources){const stageIds=roadmap.stages.filter(s=>s.resourceIds.includes(r.id)).map(s=>s.id);if(JSON.stringify(r.stageIds)!==JSON.stringify(stageIds))await put(ownerId,'resource',{...r,stageIds},projectId);}scheduleHCXRoadmap(ownerId,projectId);return roadmap;}
export async function suggestions(ownerId:string,projectId:string){const roadmap=await must<Roadmap>(ownerId,'roadmap',`roadmap:${projectId}`);const sessions=await list(ownerId,'session',projectId);const notes=await list(ownerId,'note',projectId);const local=suggestNextQueries(roadmap,sessions.map(s=>s.query),notes.flatMap(n=>n.organizedContent?.nextQueries||[]));const saved=await get(ownerId,'suggestions',`suggestions:${projectId}`);if(saved?.roadmapVersion!==roadmap.version)return local;const completed=new Set(roadmap.stages.filter(stage=>stage.completed).map(stage=>stage.id));const searched=new Set(sessions.map(session=>String(session.query).trim().toLowerCase()));const model=(saved.suggestions||[]).filter((item:any)=>!completed.has(item.stageId)).map((item:any)=>({...item,status:searched.has(item.query.trim().toLowerCase())?'searched':'new'}));return [...model,...local.filter(item=>!model.some((value:any)=>value.query===item.query))].slice(0,8);}
const refinements=new Map<string,ReturnType<typeof setTimeout>>();
const generations=new Map<string,number>();
const roadmapKey=(ownerId:string,projectId:string)=>`${ownerId}:${projectId}`;
function invalidateRoadmap(ownerId:string,projectId:string){const key=roadmapKey(ownerId,projectId);generations.set(key,(generations.get(key)||0)+1);clearTimeout(refinements.get(key));refinements.delete(key);clearTimeout(updates.get(key));updates.delete(key);}
export function clearAIState(ownerId:string){for(const key of new Set([...refinements.keys(),...updates.keys(),...generations.keys()]))if(key.startsWith(`${ownerId}:`)){generations.set(key,(generations.get(key)||0)+1);clearTimeout(refinements.get(key));refinements.delete(key);clearTimeout(updates.get(key));updates.delete(key);}clearAICache(ownerId);}
function roadmapFingerprint(project:Project,resources:Resource[]){return createHash('sha256').update(JSON.stringify({project:[project.id,project.mode,project.initialQuery,project.selectedIntent,project.learningGoal,project.learningLevel,project.updatedAt],resources:resources.map(resource=>({id:resource.id,updatedAt:resource.updatedAt,summary:resource.summary,title:resource.title})).sort((a,b)=>a.id.localeCompare(b.id))})).digest('hex');}
function scheduleHCXRoadmap(ownerId:string,projectId:string){
 const key=roadmapKey(ownerId,projectId);const generation=(generations.get(key)||0)+1;generations.set(key,generation);clearTimeout(refinements.get(key));
 refinements.set(key,setTimeout(()=>{refinements.delete(key);void refineRoadmap(ownerId,projectId,generation).catch(()=>{});},500));
}
async function refineRoadmap(ownerId:string,projectId:string,generation:number){
 const key=roadmapKey(ownerId,projectId);const project=await get<Project>(ownerId,'project',projectId);if(!project||project.mode!=='live'||generations.get(key)!==generation)return;
 const engine=ai(ownerId,project);if(!engine.configStatus().configured)return;
 const current=await get<Roadmap>(ownerId,'roadmap',`roadmap:${projectId}`);const resources=await list<Resource>(ownerId,'resource',projectId);if(!current||!resources.some(resource=>resource.summary))return;
 const fingerprint=roadmapFingerprint(project,resources);const update=await engine.updateRoadmap(project,resources,current);if(update.fallback||update.mode!=='live'||generations.get(key)!==generation)return;
 const sessions=await list(ownerId,'session',projectId);const notes=await list(ownerId,'note',projectId);const next=await engine.suggestNextQueries(update.data,sessions.map(session=>session.query),notes.filter(note=>note.externalConsent===true).flatMap(note=>note.organizedContent?.nextQueries||[]));
 if(generations.get(key)!==generation)return;
 // All writes happen after model calls, in a short transaction that checks deletion and newer edits.
 await db.$transaction(async tx=>{
  const projectRow=await tx.entity.findFirst({where:{id:projectId,ownerId,kind:'project'}});const currentRow=await tx.entity.findFirst({where:{id:current.id,ownerId,kind:'roadmap'}});if(!projectRow||!currentRow||generations.get(key)!==generation)return;
  const latestProject=JSON.parse(projectRow.data) as Project,latest=JSON.parse(currentRow.data) as Roadmap;
  const sourceRows=await tx.entity.findMany({where:{ownerId,projectId,kind:'resource'}});const latestResources=sourceRows.map(row=>JSON.parse(row.data) as Resource);
  if(latest.version!==current.version||roadmapFingerprint(latestProject,latestResources)!==fingerprint)return;
  const stages=update.data.stages.map(stage=>{const manual=latest.stages.find(item=>item.id===stage.id);return{...stage,completed:manual?.completed??stage.completed,userMemo:manual?.userMemo??stage.userMemo};});
  const refined={...update.data,stages,version:latest.version+1,generatedAt:now()};
  const save=async(kind:string,value:any)=>tx.entity.upsert({where:{id:value.id},create:{id:value.id,kind,ownerId,projectId,data:JSON.stringify(value)},update:{data:JSON.stringify(value)}});
  await save('roadmapVersion',{...latest,id:`${latest.id}:v${latest.version}`});await save('roadmap',refined);
  await save('suggestions',{id:`suggestions:${projectId}`,roadmapVersion:refined.version,suggestions:next.data});
  for(const resource of latestResources){const stageIds=stages.filter(stage=>stage.resourceIds.includes(resource.id)).map(stage=>stage.id);await tx.entity.update({where:{id:resource.id},data:{data:JSON.stringify({...resource,stageIds})}});}
 });
}
export async function addResource(ownerId:string,input:any){
 const project=await must<Project>(ownerId,'project',input.projectId);const url=input.url?normalizeUrl(input.url):'';if(!url&&!input.text?.trim())throw new ApiError(400,'MISSING_SOURCE','URL 또는 본문을 입력해 주세요.');
 await validateStage(ownerId,project.id,input.stageId);
 const existing=url?(await list<Resource>(ownerId,'resource',project.id)).find(r=>r.url===url):null;
 if(existing)return {resource:existing,duplicate:true};
 const stamp=now();const resource:Resource={id:id(),projectId:project.id,url,title:input.title||input.text?.split('\n')[0]?.slice(0,100)||new URL(url).hostname,domain:url?new URL(url).hostname:'직접 입력',snippet:input.snippet||'',text:input.text||'',extractionStatus:input.text?'user_pasted':input.snippet?'snippet_only':'metadata_only',evidenceScope:input.text?'fulltext':input.snippet?'snippet':'title',paragraphs:[],status:'queued',userMemo:'',important:false,tags:[],createdAt:stamp,updatedAt:stamp,stageIds:input.stageId?[input.stageId]:[]};
 await put(ownerId,'resource',resource,project.id);const job=await enqueue(ownerId,project.id,'resource',resource.id,{fetch:!input.text&&!!url});return {resource,jobId:job.id,duplicate:false};
}
const updates=new Map<string,ReturnType<typeof setTimeout>>();
function scheduleRoadmap(ownerId:string,projectId:string){const key=`${ownerId}:${projectId}`;clearTimeout(updates.get(key));updates.set(key,setTimeout(()=>{updates.delete(key);void refreshRoadmap(ownerId,projectId).catch(()=>{});},350));}
export async function processJob(job:any){
 const {ownerId,projectId,entityId}=job;const project=await must<Project>(ownerId,'project',projectId);
 if(job.type==='classify'){
  const session=await get(ownerId,'session',job.payload.sessionId);if(!session||session.version!==job.payload.version)return {assessments:[],stale:true};
  const result=await ai(ownerId,project,session.id).analyzeResults(job.payload.results,{query:session.query,selectedIntent:project.selectedIntent,learningGoal:project.learningGoal,learningLevel:project.learningLevel,filters:project.filters,ownerId,reevaluate:job.payload.reevaluate===true||String(entityId).includes(':retry:')});
  const fresh=await get(ownerId,'session',session.id);const latestProject=await get<Project>(ownerId,'project',projectId);if(!fresh||fresh.version!==job.payload.version||!latestProject||latestProject.updatedAt!==project.updatedAt)return {assessments:[],stale:true};
  const applied=[];for(const assessment of result.data){const record=await get(ownerId,'result',`${session.id}:${assessment.resultId}`);if(record){if(record.assessment?.reasonCodes?.includes('user_feedback'))applied.push(record.assessment);else{const history=record.assessment;const preserved=['same_url','same_text'].includes(history?.duplicationLabel)?{...assessment,duplicationLabel:history.duplicationLabel,reasonCodes:[...new Set([...assessment.reasonCodes,...(history.reasonCodes||[]).filter((code:string)=>['same_url','same_text'].includes(code))])],evidence:[...new Set([...assessment.evidence,...(history.evidence||[])])],recommendedAction:project.filters.groupDuplicates?'deemphasize':assessment.recommendedAction}:assessment;await put(ownerId,'result',{...record,assessment:preserved,mode:project.mode},projectId,session.id);applied.push(preserved);}}}
  return {assessments:applied,mode:result.mode,fallback:result.fallback,errorCode:result.errorCode};
 }
 if(job.type==='resource'){
  let resource=await get<Resource>(ownerId,'resource',entityId);if(!resource)return {deleted:true};
  await put(ownerId,'resource',{...resource,status:'processing'},projectId);
  if(job.payload.fetch&&resource.url){try{const extracted=await extractPublicPage(resource.url);resource={...resource,text:extracted.text,extractionStatus:'fulltext',evidenceScope:'fulltext',error:extracted.partial?'긴 문서의 앞 40,000자만 처리했어요.':undefined};}catch(e){resource={...resource,extractionStatus:resource.snippet?'snippet_only':'failed',evidenceScope:resource.snippet?'snippet':'title',error:(e as any).code==='SSRF_BLOCKED'?'내부 네트워크 주소는 가져오지 않았어요.':'본문 추출 실패 · 확보한 제목/검색 요약만 사용해요.'};}}
  const source=resource.text||resource.snippet||resource.title;const result=await ai(ownerId,project).summarize(source,resource.evidenceScope);
  if(!await get(ownerId,'resource',entityId))return {deleted:true};
  const latest=await must<Resource>(ownerId,'resource',entityId);resource={...latest,...resource,userMemo:latest.userMemo,important:latest.important,tags:latest.tags,summary:result.data,paragraphs:splitParagraphs(source),status:'ready',updatedAt:now(),...(result.fallback&&project.mode==='live'?{error:'HCX 처리 실패 · 규칙 기반 발췌 요약을 표시해요.'}:{})};
  await put(ownerId,'resource',resource,projectId);scheduleRoadmap(ownerId,projectId);return {resourceId:entityId,fallback:result.fallback};
 }
 if(job.type==='ocr'){
  const note=await get(ownerId,'note',entityId);if(!note)return {deleted:true};let text='',error:string|undefined;
  try{
   if(process.env.OCR_ENABLED==='false')throw new Error('OCR_DISABLED');
   const {createWorker}=await import('tesseract.js');const cachePath=path.join(process.cwd(),'data','ocr');await mkdir(cachePath,{recursive:true});
   let worker:Awaited<ReturnType<typeof createWorker>>|undefined;let timeout:ReturnType<typeof setTimeout>|undefined;let expired=false;
   try{const operation=(async()=>{worker=await createWorker('kor+eng',1,{cachePath,logger:()=>{}});if(expired){await worker.terminate();throw new Error('OCR_TIMEOUT');}const r=await worker.recognize(await readFile(imagePath(note.imageStorageKey)));return r.data.text;})();text=await Promise.race([operation,new Promise<never>((_,reject)=>{timeout=setTimeout(()=>{expired=true;reject(new Error('OCR_TIMEOUT'));},60000);})]);}finally{clearTimeout(timeout);await worker?.terminate();}
   if(!text.trim())error='문자를 찾지 못했어요. 원본을 보면서 텍스트를 입력해 주세요.';
  }catch{error='OCR을 완료하지 못했어요. 언어 데이터 다운로드 연결을 확인하거나 텍스트를 직접 입력해 주세요.';}
  const latestNote=await get(ownerId,'note',entityId);if(!latestNote||!await get(ownerId,'project',projectId))return {deleted:true};
  await put(ownerId,'note',{...latestNote,ocrText:text,editedText:latestNote.editedText!==note.editedText?latestNote.editedText:text,status:error?'ocr_failed':'review',error},projectId);
  if(!note.retainImage){await unlink(imagePath(note.imageStorageKey)).catch(()=>{});const saved=await must(ownerId,'note',entityId);delete saved.imageStorageKey;delete saved.imageUrl;await put(ownerId,'note',saved,projectId);}
  return {noteId:entityId,error};
 }
 if(job.type==='organize'){
  const note=await get(ownerId,'note',entityId);if(!note)return {deleted:true};const source=note.editedText||note.ocrText;const revision=noteTextHash(source);if(job.payload?.textHash&&job.payload.textHash!==revision)return {stale:true};if(project.mode==='live'&&(note.externalConsent!==true||note.consentTextHash!==revision||job.payload?.textHash!==revision||job.payload?.externalConsent!==true))throw new ApiError(400,'CONSENT_REQUIRED','현재 필기 텍스트의 외부 전송 동의가 필요해요.');const result=await ai(ownerId,project).organizeNote(source);
  const latestNote=await get(ownerId,'note',entityId);if(!latestNote||!await get(ownerId,'project',projectId))return {deleted:true};if(noteTextHash(latestNote.editedText||latestNote.ocrText)!==revision||(project.mode==='live'&&(latestNote.externalConsent!==true||latestNote.consentTextHash!==revision)))return {stale:true};
  await put(ownerId,'note',{...latestNote,title:latestNote.title!==note.title?latestNote.title:result.data.title,organizedContent:result.data,status:'ready',error:result.fallback&&project.mode==='live'?'HCX 실패 · 규칙 기반 정리':undefined},projectId);
  const resourceId=`note-resource:${note.id}`;const existing=await get<Resource>(ownerId,'resource',resourceId);const {summarizeExtractive}=await import('@cutling/shared');
  await put(ownerId,'resource',{id:resourceId,projectId,url:'',title:result.data.title,domain:'내 필기',externalConsent:note.externalConsent===true,snippet:'',text:source,extractionStatus:'user_pasted',evidenceScope:'fulltext',paragraphs:splitParagraphs(source),summary:summarizeExtractive(source,'fulltext'),status:'ready',userMemo:existing?.userMemo||'',important:existing?.important||false,tags:['필기'],createdAt:existing?.createdAt||now(),updatedAt:now(),stageIds:latestNote.stageId?[latestNote.stageId]:[]},projectId,note.id);scheduleRoadmap(ownerId,projectId);return {noteId:note.id};
 }
 throw new ApiError(400,'UNKNOWN_JOB','알 수 없는 처리 작업입니다.');
}
export function imagePath(key:string){if(!/^[a-f\d-]+\.png$/.test(key))throw new ApiError(400,'INVALID_IMAGE','잘못된 이미지 주소입니다.');return path.join(process.cwd(),'data','uploads',key);}
export async function validateStage(ownerId:string,projectId:string,stageId?:string){if(!stageId)return;const roadmap=await must<Roadmap>(ownerId,'roadmap',`roadmap:${projectId}`);if(!roadmap.stages.some(stage=>stage.id===stageId))throw new ApiError(400,'INVALID_STAGE','이 프로젝트에 속하는 학습 단계를 선택해 주세요.');}
export const noteTextHash=(text:string)=>createHash('sha256').update(text).digest('hex');
export async function updateNote(ownerId:string,noteId:string,input:{editedText:string;title?:string;stageId?:string}){const note=await must(ownerId,'note',noteId);await validateStage(ownerId,note.projectId,input.stageId);const textChanged=input.editedText!==note.editedText;return put(ownerId,'note',{...note,...input,status:'review',...(textChanged?{externalConsent:false,consentTextHash:undefined,organizedContent:undefined}:{})},note.projectId);}
export async function createNote(ownerId:string,form:FormData){
 const projectId=String(form.get('projectId')||'');await must<Project>(ownerId,'project',projectId);const file=form.get('file');if(!(file instanceof File))throw new ApiError(400,'FILE_REQUIRED','필기 이미지를 선택해 주세요.');
 await validateStage(ownerId,projectId,String(form.get('stageId')||''));
 if(file.size>5*1024*1024)throw new ApiError(413,'IMAGE_TOO_LARGE','이미지는 5MB 이하로 올려 주세요.');
 const buffer=Buffer.from(await file.arrayBuffer());let sanitized:Buffer;
 try{const metadata=await sharp(buffer,{limitInputPixels:20_000_000}).metadata();if(!['jpeg','png','webp'].includes(metadata.format||'')||!['image/jpeg','image/png','image/webp'].includes(file.type))throw new Error('INVALID');sanitized=await sharp(buffer,{limitInputPixels:20_000_000}).rotate().resize({width:3000,height:3000,fit:'inside',withoutEnlargement:true}).png().toBuffer();}catch{throw new ApiError(415,'INVALID_IMAGE','유효한 JPG·PNG·WEBP 이미지만 지원합니다.');}
 const noteId=id(),key=`${id()}.png`;await mkdir(path.dirname(imagePath(key)),{recursive:true});await writeFile(imagePath(key),sanitized);
 const note={id:noteId,projectId,stageId:String(form.get('stageId')||''),title:file.name.slice(0,100),ocrText:'',editedText:'',imageStorageKey:key,imageUrl:`/api/notes/${noteId}/image`,retainImage:form.get('retainImage')==='true',status:'queued',createdAt:now()};await put(ownerId,'note',note,projectId);const job=await enqueue(ownerId,projectId,'ocr',note.id);return {note:publicNote(note),jobId:job.id};
}
export function publicNote(note:any){const {imageStorageKey:_key,...safe}=note;return safe;}
export async function removeProject(ownerId:string,projectId:string){await must(ownerId,'project',projectId);invalidateRoadmap(ownerId,projectId);clearAICache(ownerId);const notes=await list(ownerId,'note',projectId);for(const note of notes)if(note.imageStorageKey)await unlink(imagePath(note.imageStorageKey)).catch(()=>{});await db.entity.deleteMany({where:{ownerId,projectId}});}
export async function report(ownerId:string,projectId:string){
 const project=await must<Project>(ownerId,'project',projectId),s=await settings(ownerId);const [results,events,resources,logs,roadmap]=await Promise.all([list(ownerId,'result',projectId),list(ownerId,'event',projectId),list<Resource>(ownerId,'resource',projectId),list(ownerId,'modelCall',projectId),get<Roadmap>(ownerId,'roadmap',`roadmap:${projectId}`)]);
 const revealed=new Set(events.filter(e=>e.type==='reveal').map(e=>`${e.sessionId}:${e.resultId}`));const lowered=results.filter(r=>r.assessment?.recommendedAction==='deemphasize');const saved=resources.length,summarized=resources.filter(r=>r.summary&&r.status==='ready').length;
 const counts={analyzed:results.length,recommended:results.filter(r=>r.assessment?.recommendedAction==='recommend').length,deemphasized:lowered.length,duplicates:results.filter(r=>!['unique','unknown',undefined].includes(r.assessment?.duplicationLabel)).length,revealed:revealed.size,saved,summarized,linked:new Set(roadmap?.stages.flatMap(s=>s.resourceIds)||[]).size};
 const actual=logs.filter(l=>l.mode===project.mode);const noncache=actual.filter(l=>!l.cacheHit);const cacheHits=actual.filter(l=>l.cacheHit).length;const analyzedIds=new Set(results.map(result=>result.id));const reasoningResults=new Set(noncache.filter(l=>l.role==='reasoning'&&String(l.task).startsWith('classifyAmbiguousResults')).flatMap(l=>(l.resultIds||[]).map((resultId:string)=>`${l.sessionId}:${resultId}`)).filter(resultId=>analyzedIds.has(resultId))).size;
 let prices:any=null;try{prices=JSON.parse(process.env.MODEL_PRICING_JSON||'null');}catch{/* Invalid prices stay unavailable. */}
 let total:number|null=prices?.models&&prices?.source&&prices?.checkedAt?0:null;
 for(const log of noncache){const p=prices?.models?.[log.model];if(!p||!Number.isFinite(p.inputPerMillion)||!Number.isFinite(p.outputPerMillion)||p.inputPerMillion<0||p.outputPerMillion<0||log.inputTokens==null||log.outputTokens==null||log.usageSource!=='provider_reported'){total=null;break;}if(total!==null)total+=(log.inputTokens*p.inputPerMillion+log.outputTokens*p.outputPerMillion)/1e6;}
 return {mode:project.mode,period:{from:project.createdAt,to:now()},counts,time:{searchSeconds:lowered.filter(r=>!revealed.has(r.id)).length*s.reviewSeconds,organizationSeconds:summarized*s.organizeSeconds,assumptions:{reviewSeconds:s.reviewSeconds,organizeSeconds:s.organizeSeconds,note:'제품 가정에 따른 추정입니다. 다시 펼친 결과는 제외하며 중복 후보를 별도로 더하지 않습니다.'}},modelCalls:actual,usage:{calls:noncache.length,inputTokens:noncache.some(l=>l.inputTokens!=null)?noncache.reduce((n,l)=>n+(l.inputTokens||0),0):null,outputTokens:noncache.some(l=>l.outputTokens!=null)?noncache.reduce((n,l)=>n+(l.outputTokens||0),0):null,unavailableUsageCalls:noncache.filter(l=>l.usageSource==='unavailable').length,cacheHits,cacheHitRate:actual.length?cacheHits/actual.length:0,reasoningRatio:results.length?reasoningResults/results.length:0,reasoningRequestRatio:noncache.length?noncache.filter(l=>l.role==='reasoning').length/noncache.length:0,embeddingInputCount:noncache.filter(l=>l.role==='embedding').reduce((n,l)=>n+(l.inputCount||0),0)},comparison:{status:'unavailable',savingsPercent:null},pricing:{configured:total!==null,source:prices?.source||null,checkedAt:prices?.checkedAt||null},estimatedCost:total};
}
