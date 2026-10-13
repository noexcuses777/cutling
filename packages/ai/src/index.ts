import 'server-only';
import { createHash, randomUUID } from 'node:crypto';
import { z } from 'zod';
import { AssessmentSchema, IntentResultSchema, OrganizedNoteSchema, SummarySchema, DEFAULT_FILTERS, ROUTING_THRESHOLDS, applyEmbeddingSignals, classifyResults, inferIntent as inferRules, organizeNoteRules, shouldRouteToReasoning, splitParagraphs, summarizeExtractive, validateSummaryEvidence, type Assessment, type ClassificationContext, type EvidenceScope, type ModelCallLog, type Mode, type Project } from '@cutling/shared';
import { createDraftRoadmap, updateRoadmap as updateRoadmapRules, suggestNextQueries as suggestRules, type SearchResult, type Resource, type Roadmap } from '@cutling/shared';
import { HCXClient, HCXError } from './client';
import { configured, readHCXConfig, type HCXConfig } from './config';
import { CLASSIFY_PROMPT, INTENT_PROMPT, NOTE_PROMPT, PROMPT_VERSION, SUMMARY_PROMPT, ROADMAP_PROMPT, SUGGEST_PROMPT } from './prompts';
export { HCXClient, HCXError, readHCXConfig };
export type { HCXConfig, ModelCallLog };
export interface AIResult<T> { data:T; mode:Mode; fallback:boolean; errorCode?:string }
export interface AIOptions { mode:Mode;config?:Partial<HCXConfig>;ownerId?:string;onCall?:(log:ModelCallLog)=>void|Promise<void>;fetchImpl?:typeof fetch }
const cache=new Map<string,{expiresAt:number;data:unknown;owner:string}>();
const ownerEpochs=new Map<string,number>();
export function clearAICache(ownerId:string):void {ownerEpochs.set(ownerId,(ownerEpochs.get(ownerId)??0)+1);for(const [key,value] of cache)if(value.owner===ownerId)cache.delete(key);}
const clone=<T>(value:T):T=>JSON.parse(JSON.stringify(value)) as T;

export function createAI(options:AIOptions) {
  const config={...readHCXConfig(),...options.config}; const client=new HCXClient(config,options.onCall,options.fetchImpl);
  // Default per-instance namespace prevents accidentally sharing personal data between users.
  const namespace=options.ownerId || randomUUID();
  const ownerEpoch=ownerEpochs.get(namespace)??0;
  const cacheBase={namespace,base:config.baseUrl,mode:options.mode,promptVersion:PROMPT_VERSION,schemaVersion:2};
  const localMode=options.mode==='demo'?'demo':'rules';
  const errorCode=(error:unknown)=>error instanceof HCXError?error.code:error instanceof z.ZodError?'SCHEMA_ERROR':'AI_VALIDATION_ERROR';
  async function cached<T>(role:'embedding'|'light'|'reasoning',task:string,input:unknown,work:()=>Promise<T>,enabled=true):Promise<T> {
    const model=role==='embedding'?config.embeddingModel:role==='light'?config.lightModel:config.reasoningModel;
    const key=createHash('sha256').update(JSON.stringify({cacheBase,role,task,model,endpoint:role==='embedding'?config.embeddingEndpoint:config.chatEndpoint,input})).digest('hex');
    const found=enabled?cache.get(key):undefined;
    if(found&&found.expiresAt>Date.now()) {await client.record({provider:'hcx',model,role,task,requestId:randomUUID(),latencyMs:0,inputTokens:0,outputTokens:0,usageSource:'provider_reported',cacheHit:true,mode:'live',success:true,inputCount:role==='embedding'?1:undefined,createdAt:new Date().toISOString()});return clone(found.data as T);}
    const result=await work();
    if(enabled&&(ownerEpochs.get(namespace)??0)===ownerEpoch) {if(cache.size>=500) {const first=cache.keys().next().value;if(first)cache.delete(first);}cache.set(key,{expiresAt:Date.now()+config.cacheTtlMs,data:clone(result),owner:namespace});}
    return result;
  }
  async function run<T>(fallback:()=>T,work:()=>Promise<T>):Promise<AIResult<T>> {
    if(options.mode!=='live'||!configured(config))return {data:fallback(),mode:localMode,fallback:options.mode==='live',...(options.mode==='live'?{errorCode:'NOT_CONFIGURED'}:{})};
    try {return{data:await work(),mode:'live',fallback:false};}catch(error){return{data:fallback(),mode:'rules',fallback:true,errorCode:errorCode(error)};}
  }
  async function validatedChat<T>(role:'light'|'reasoning',task:string,system:string,input:unknown,schema:z.ZodType<T>,validate?:(value:T)=>T):Promise<T> {
    try {return await client.chat(role,task,system,input,schema,validate);} catch(error) {const code=errorCode(error);if(!['INVALID_JSON','SCHEMA_ERROR','AI_VALIDATION_ERROR','INVALID_EVIDENCE_REFERENCE','MISSING_SUMMARY_EVIDENCE','EVIDENCE_SCOPE_MISMATCH','INVALID_ASSESSMENT_IDS','INVALID_ROADMAP_REFERENCE','INVALID_SUGGESTION_REFERENCE'].includes(code))throw error;return client.chat(role,`${task}:repair`,`${system}\n이전 응답의 JSON 구조 또는 근거 검증에 실패했다. 제공한 ID와 출력 구조를 정확히 준수하라.`,input,schema,validate);}
  }
  async function refine(results:SearchResult[],assessments:Assessment[],context:ClassificationContext,role:'light'|'reasoning'):Promise<Assessment[]> {
    const schema=z.object({assessments:z.array(AssessmentSchema).max(ROUTING_THRESHOLDS.maxRefineResults)});
    const input={context,results:results.map(result=>({...result,snippet:result.snippet.slice(0,1200)})),previous:assessments};
    const output=await cached(role,'classifyAmbiguousResults',input,()=>validatedChat(role,'classifyAmbiguousResults',CLASSIFY_PROMPT,input,schema,value=>{
      const expected=new Set(results.map(result=>result.id));
      if(value.assessments.length!==expected.size||new Set(value.assessments.map(item=>item.resultId)).size!==expected.size||value.assessments.some(item=>!expected.has(item.resultId)))throw new HCXError('INVALID_ASSESSMENT_IDS');
      return value;
    }));
    return output.assessments.map(assessment=>{
      const result=results.find(item=>item.id===assessment.resultId)!; const previous=assessments.find(item=>item.resultId===assessment.resultId)!;
      const text=`${result.title} ${result.snippet}`;
      const verifiedEvidence=assessment.evidence.filter(value=>text.includes(value));
      const output={...assessment,evidenceScope:previous.evidenceScope,classificationStage:role,evidence:verifiedEvidence,limitations:[...assessment.limitations,'제목·검색 요약 기반 모델 판단이며 검증된 정확도 확률이 아니에요.']};
      if(!verifiedEvidence.length){output.recommendedAction='review';output.confidenceLevel='low';output.limitations.push('모델의 근거 발췌가 원문과 일치하지 않아 검토 상태로 유지해요.');}
      if(result.explicitAd) {output.commercialityLabel='explicit_ad';output.reasonCodes=[...new Set([...output.reasonCodes,'explicit_ad'])];if(context.filters?.lowerPromotions??DEFAULT_FILTERS.lowerPromotions)output.recommendedAction='deemphasize';}
      if(previous.duplicationLabel==='same_url'||previous.duplicationLabel==='same_text')output.duplicationLabel=previous.duplicationLabel;
      if(previous.freshnessLabel==='foundational') output.freshnessLabel='foundational';
      return output;
    });
  }
  return {
    configStatus(){return{configured:configured(config),verified:false,roles:{light:config.lightModel||'미설정',reasoning:config.reasoningModel||'미설정',embedding:config.embeddingModel||'미설정'},message:configured(config)?'설정되어 있어요. 실제 연결 진단은 아직 수행하지 않았어요.':'서버 HCX 설정이 없어 규칙 기반 기능을 사용할 수 있어요.'};},
    async diagnose(){
      const base={configured:configured(config),verified:false,roles:{light:config.lightModel||'미설정',reasoning:config.reasoningModel||'미설정',embedding:config.embeddingModel||'미설정'}};
      if(!base.configured)return {...base,message:'키와 역할별 모델 설정이 필요해요. 실제 연결은 확인되지 않았어요.',errorCode:'NOT_CONFIGURED'};
      try {await client.chat('light','diagnose','연결 확인용이다. JSON {"ok":true}만 출력한다.',{test:true},z.object({ok:z.literal(true)}));await client.chat('reasoning','diagnose','연결 확인용이다. JSON {"ok":true}만 출력한다.',{test:true},z.object({ok:z.literal(true)}));await client.embedText('학습 자료');return{...base,verified:true,message:`경량·정밀·임베딩 역할의 실제 요청에 성공했어요.${config.lightModel===config.reasoningModel?' 경량과 정밀 역할이 같은 모델을 사용해요.':''}`};}catch(error){return{...base,message:'연결 확인에 실패했어요. 설정과 계정 권한을 확인해 주세요. 규칙 모드를 사용할 수 있어요.',errorCode:errorCode(error)};}
    },
    async inferIntent(query:string,project?:Partial<Project>):Promise<AIResult<ReturnType<typeof inferRules>>> {
      const fallback=()=>{const inferred=inferRules(query);return project?.selectedIntent?{...inferred,intent:project.selectedIntent}:inferred;};
      return run(fallback,()=>{const input={query:query.slice(0,500),selectedIntent:project?.selectedIntent,learningGoal:project?.learningGoal,learningLevel:project?.learningLevel};return cached('light','inferIntent',input,()=>validatedChat('light','inferIntent',INTENT_PROMPT,input,IntentResultSchema,value=>project?.selectedIntent?{...value,intent:project.selectedIntent}:value));});
    },
    async embedTexts(texts:string[]):Promise<AIResult<number[][]>> {return run(()=>[],()=>Promise.all(texts.slice(0,41).map(text=>cached('embedding','embedTexts',text,()=>client.embedText(text)))));},
    async analyzeResults(results:SearchResult[],context:ClassificationContext):Promise<AIResult<Assessment[]>> {
      const bounded=results.slice(0,ROUTING_THRESHOLDS.maxResults); const rules=classifyResults(bounded,context);
      if(options.mode!=='live'||!configured(config))return{data:rules,mode:localMode,fallback:options.mode==='live',...(options.mode==='live'?{errorCode:'NOT_CONFIGURED'}:{})};
      let assessed=rules; let lastError:string|undefined;
      try {
        const goal=`${context.query} ${context.selectedIntent||''} ${context.learningGoal||''}`;
        const texts=[goal,...bounded.map(result=>`${result.title}\n${result.snippet}`)]; const unique=[...new Set(texts)];
        const vectors=await Promise.all(unique.map(text=>cached('embedding','embedTexts',text,()=>client.embedText(text))));
        const vectorMap=new Map(unique.map((text,index)=>[text,vectors[index]!]));
        assessed=applyEmbeddingSignals(rules,texts.slice(1).map(text=>vectorMap.get(text)!),vectorMap.get(goal)!,{...DEFAULT_FILTERS,...context.filters});
      }catch(error){lastError=errorCode(error);}
      const lightCandidates=assessed.filter(item=>item.recommendedAction==='review'&&!item.reasonCodes.includes('insufficient_evidence')).slice(0,ROUTING_THRESHOLDS.maxRefineResults);
      if(lightCandidates.length)try {const refined=await refine(bounded.filter(result=>lightCandidates.some(item=>item.resultId===result.id)),lightCandidates,context,'light');assessed=assessed.map(item=>refined.find(value=>value.resultId===item.resultId)??item);}catch(error){lastError=errorCode(error);}
      const reasoningCandidates=assessed.filter(item=>shouldRouteToReasoning(item,undefined,context.reevaluate)).slice(0,ROUTING_THRESHOLDS.maxRefineResults);
      if(reasoningCandidates.length)try {const refined=await refine(bounded.filter(result=>reasoningCandidates.some(item=>item.resultId===result.id)),reasoningCandidates,context,'reasoning');assessed=assessed.map(item=>refined.find(value=>value.resultId===item.resultId)??item);}catch(error){lastError=errorCode(error);}
      if(lastError)assessed=assessed.map(item=>({...item,limitations:[...item.limitations,'일부 AI 요청에 실패해 확보한 규칙·모델 결과를 유지했어요.']}));
      return{data:assessed,mode:assessed.some(item=>item.classificationStage!=='rules')?'live':'rules',fallback:!!lastError,...(lastError?{errorCode:lastError}:{})};
    },
    async summarize(text:string,evidenceScope:EvidenceScope='fulltext') {
      const fallback=()=>summarizeExtractive(text,evidenceScope);
      if(text.trim().length<40)return{data:fallback(),mode:localMode,fallback:options.mode==='live',errorCode:'INSUFFICIENT_EVIDENCE'};
      return run(fallback,()=>{const input={paragraphs:splitParagraphs(text).slice(0,24),evidenceScope};return cached('light','summarizeResource',input,()=>validatedChat('light','summarizeResource',SUMMARY_PROMPT,input,SummarySchema,value=>validateSummaryEvidence(value,input.paragraphs,evidenceScope)));});
    },
    async organizeNote(text:string) {
      const role=text.length>6000||/[∫Σ∑∂]|증명|선수 지식/.test(text)?'reasoning':'light';
      return run(()=>organizeNoteRules(text),()=>validatedChat(role,'organizeNote',NOTE_PROMPT,{text:text.slice(0,18000)},OrganizedNoteSchema));
    },
    async generateRoadmap(project:Project):Promise<AIResult<Roadmap>> {
      // Initial plans are deliberately explicit general suggestions; no unobserved sources.
      return {data:createDraftRoadmap(project),mode:localMode,fallback:false};
    },
    async updateRoadmap(project:Project,resources:Resource[],current?:Roadmap):Promise<AIResult<Roadmap>> {
      const fallback=updateRoadmapRules(project,resources,current);
      if(!resources.length)return{data:fallback,mode:localMode,fallback:false};
      const stageSchema=z.object({id:z.string(),objective:z.string().max(500),explanation:z.string().max(1000),prerequisites:z.array(z.string().max(150)).max(10),concepts:z.array(z.string().max(150)).max(15),resourceIds:z.array(z.string()).max(30),connectionReason:z.string().max(1000),missingTopics:z.array(z.string().max(150)).max(15),nextQuery:z.string().max(200)});
      const schema=z.object({changeSummary:z.string().max(1000),stages:z.array(stageSchema).max(20)});
      const privateIds=new Set(resources.filter(resource=>resource.domain==='내 필기'&&(!('externalConsent' in resource)||resource.externalConsent!==true)).map(resource=>resource.id));
      const sources=resources.filter(resource=>!privateIds.has(resource.id)).filter(resource=>resource.summary).sort((a,b)=>b.updatedAt.localeCompare(a.updatedAt)).slice(0,30).map(resource=>({id:resource.id,title:resource.title,summary:resource.summary,paragraphs:resource.paragraphs.filter(paragraph=>resource.summary?.evidenceReferences.some(reference=>reference.paragraphIds.includes(paragraph.id))).slice(0,3).map(paragraph=>({...paragraph,text:paragraph.text.slice(0,250)}))}));
      if(!sources.length)return {data:fallback,mode:localMode,fallback:false};
      const sourceIds=new Set(sources.map(source=>source.id));
      const input={goal:project.learningGoal,level:project.learningLevel,intent:project.selectedIntent,stages:fallback.stages.map(stage=>({id:stage.id,title:stage.title,objective:stage.objective,concepts:stage.concepts,prerequisites:stage.prerequisites,missingTopics:stage.missingTopics,resourceIds:stage.resourceIds.filter(id=>sourceIds.has(id))})),resources:sources};
      return run(()=>fallback,async()=>{
        const output=await cached('reasoning','updateRoadmap',input,()=>validatedChat('reasoning','updateRoadmap',ROADMAP_PROMPT,input,schema,value=>{
          const ids=fallback.stages.map(stage=>stage.id),sourceIds=new Set(sources.map(source=>source.id));
          if(value.stages.length!==ids.length||value.stages.some((stage,index)=>stage.id!==ids[index]||stage.resourceIds.some(id=>!sourceIds.has(id))))throw new HCXError('INVALID_ROADMAP_REFERENCE');
          return value;
        }));
        const stages=fallback.stages.map(stage=>{const proposed=output.stages.find(item=>item.id===stage.id)!;const localPrivate=stage.resourceIds.filter(id=>privateIds.has(id));const resourceIds=[...new Set([...proposed.resourceIds,...localPrivate])];return{...stage,...proposed,resourceIds,completed:stage.completed,userMemo:stage.userMemo,title:stage.title,status:resourceIds.length?'source_based' as const:'draft' as const,connectionReason:`${proposed.connectionReason}${localPrivate.length?' 개인 필기는 로컬에서 연결했어요.':''}`,explanation:proposed.resourceIds.length?proposed.explanation:`일반 학습 제안: ${proposed.explanation}`};});
        return{...fallback,stages,changeSummary:output.changeSummary,status:stages.some(stage=>stage.resourceIds.length)?'source_based' as const:'draft' as const};
      });
    },
    async suggestNextQueries(roadmap:Roadmap,executed:string[]=[],questions:string[]=[]){
      const fallback=()=>suggestRules(roadmap,executed,questions);
      const schema=z.object({suggestions:z.array(z.object({stageId:z.string(),query:z.string().min(1).max(200),reason:z.string().min(1).max(400),intent:z.string().max(100)})).max(6)});
      const input={stages:roadmap.stages.filter(stage=>!stage.completed).map(stage=>({id:stage.id,title:stage.title,missingTopics:stage.missingTopics})),executed,questions};
      return run(fallback,async()=>{const output=await cached('light','suggestNextQueries',input,()=>validatedChat('light','suggestNextQueries',SUGGEST_PROMPT,input,schema,value=>{if(value.suggestions.some(item=>!input.stages.some(stage=>stage.id===item.stageId)||/https?:\/\//.test(item.query)))throw new HCXError('INVALID_SUGGESTION_REFERENCE');return value;}));return output.suggestions.filter(item=>!executed.some(query=>query.trim().toLowerCase()===item.query.trim().toLowerCase())).map((item,index)=>({...item,id:`ai-suggest:${item.stageId}:${index}`,status:'new'}));});
    }
  };
}
