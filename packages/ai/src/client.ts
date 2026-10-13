import { createHash, randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { ModelCallLog } from '@cutling/shared';
import { configured, type HCXConfig } from './config';

export class HCXError extends Error { constructor(public code:string,public retryable=false) { super(code); this.name='HCXError'; } }
type OnCall=(log:ModelCallLog)=>void|Promise<void>;
class Semaphore {
  active=0; queue:Array<()=>void>=[];
  constructor(private limit:number) {}
  async acquire() { if (this.active>=this.limit) await new Promise<void>(resolve=>this.queue.push(resolve)); else this.active++; }
  release() { const next=this.queue.shift(); if(next) next(); else this.active--; }
}
const semaphores=new Map<string,Semaphore>();
const usageSchema=z.object({promptTokens:z.number().int().nonnegative().optional(),completionTokens:z.number().int().nonnegative().optional()}).passthrough();
const envelopeSchema=z.object({status:z.object({code:z.string().regex(/^\d{5}$/),message:z.string().optional()}),result:z.unknown().optional()});
const chatSchema=z.object({message:z.object({content:z.string().min(1)}),usage:usageSchema.optional(),inputLength:z.number().optional(),outputLength:z.number().optional()}).passthrough();
const embeddingSchema=z.object({embedding:z.array(z.number().finite()).min(1),inputTokens:z.number().int().nonnegative().optional()});
export function extractJSON(text:string):unknown { let content=text.trim(); if (content.startsWith('```')) content=content.replace(/^```(?:json)?\s*/i,'').replace(/\s*```$/,''); try {return JSON.parse(content);} catch {throw new HCXError('INVALID_JSON');} }
export class HCXClient {
  private semaphore:Semaphore;
  constructor(public readonly config:HCXConfig,private onCall?:OnCall,private fetchImpl:typeof fetch=fetch) {
    const identity=createHash('sha256').update(`${config.baseUrl}|${config.apiKey}|${config.maxConcurrency}`).digest('hex');
    if (!semaphores.has(identity)) semaphores.set(identity,new Semaphore(config.maxConcurrency));
    this.semaphore=semaphores.get(identity)!;
  }
  get configured() {return configured(this.config);}
  private endpoint(path:string,model:string):string {
    const value=path.replace(/\{model(?:Name)?\}/g,encodeURIComponent(model));
    const base=new URL(this.config.baseUrl);
    const url=new URL(value,base);
    if (url.protocol!=='https:'||url.origin!==base.origin||url.username||url.password) throw new HCXError('INVALID_ENDPOINT');
    return url.toString();
  }
  async record(log:ModelCallLog) {try {await this.onCall?.(log);}catch {/* logging failures cannot leak prompt/error data or prevent fallback */}}
  private async request<T>(role:ModelCallLog['role'],task:string,model:string,path:string,body:unknown,parse:(result:unknown)=>{data:T;inputTokens:number|null;outputTokens:number|null},inputCount=1,resultIds?:string[]):Promise<T> {
    if(!this.config.apiKey||!model) throw new HCXError('NOT_CONFIGURED');
    const endpoint=this.endpoint(path,model);
    for(let attempt=0;attempt<=this.config.maxRetries;attempt++) {
      await this.semaphore.acquire();
      const requestId=randomUUID(),started=Date.now(),controller=new AbortController();
      const timer=setTimeout(()=>controller.abort(),this.config.requestTimeoutMs);
      let retry=false;
      let observedInput:number|null=null,observedOutput:number|null=null;
      try {
        const response=await this.fetchImpl(endpoint,{method:'POST',headers:{Authorization:`Bearer ${this.config.apiKey}`,'Content-Type':'application/json','X-NCP-CLOVASTUDIO-REQUEST-ID':requestId},body:JSON.stringify(body),signal:controller.signal,redirect:'error'});
        if(!response.ok) throw new HCXError(response.status===401||response.status===403?'AUTH_FAILED':response.status===429?'RATE_LIMITED':response.status===404?'MODEL_OR_ENDPOINT_UNSUPPORTED':`HTTP_${response.status}`,response.status===429||response.status>=500);
        const envelope=envelopeSchema.safeParse(await response.json());
        if(!envelope.success) throw new HCXError('INVALID_PROVIDER_RESPONSE');
        if(envelope.data.status.code!=='20000') { const code=envelope.data.status.code; throw new HCXError(code.startsWith('401')||code.startsWith('403')?'AUTH_FAILED':code.startsWith('429')?'RATE_LIMITED':`PROVIDER_${code}`,code.startsWith('429')||code.startsWith('5')); }
        const observed=z.object({usage:usageSchema.optional(),inputTokens:z.number().int().nonnegative().optional(),inputLength:z.number().int().nonnegative().optional(),outputLength:z.number().int().nonnegative().optional()}).safeParse(envelope.data.result);
        if(observed.success){observedInput=observed.data.usage?.promptTokens??observed.data.inputTokens??observed.data.inputLength??null;observedOutput=observed.data.usage?.completionTokens??observed.data.outputLength??(role==='embedding'?0:null);}
        const parsed=parse(envelope.data.result);
        await this.record({provider:'hcx',model,role,task,requestId,latencyMs:Date.now()-started,inputTokens:parsed.inputTokens,outputTokens:parsed.outputTokens,usageSource:parsed.inputTokens!==null&&parsed.outputTokens!==null?'provider_reported':'unavailable',cacheHit:false,mode:'live',success:true,inputCount,resultCount:resultIds?.length,resultIds,createdAt:new Date().toISOString()});
        return parsed.data;
      } catch(error) {
        const safe=error instanceof HCXError?error:new HCXError(controller.signal.aborted?'TIMEOUT':error instanceof z.ZodError?'SCHEMA_ERROR':'NETWORK_ERROR',controller.signal.aborted||!(error instanceof z.ZodError));
        await this.record({provider:'hcx',model,role,task,requestId,latencyMs:Date.now()-started,inputTokens:observedInput,outputTokens:observedOutput,usageSource:observedInput!==null&&observedOutput!==null?'provider_reported':'unavailable',cacheHit:false,mode:'live',success:false,errorCode:safe.code,inputCount,resultCount:resultIds?.length,resultIds,createdAt:new Date().toISOString()});
        if(attempt>=this.config.maxRetries||!safe.retryable) throw safe;
        retry=true;
      } finally {clearTimeout(timer);this.semaphore.release();}
      if(retry) await new Promise(resolve=>setTimeout(resolve,Math.min(2000,250*2**attempt)));
    }
    throw new HCXError('REQUEST_FAILED');
  }
  async chat<T>(role:'light'|'reasoning',task:string,system:string,input:unknown,schema:z.ZodType<T>,validate?:(value:T)=>T):Promise<T> {
    const model=role==='light'?this.config.lightModel:this.config.reasoningModel;
    const thinking=/^HCX-007$/i.test(model);
    const body={messages:[{role:'system',content:system},{role:'user',content:JSON.stringify(input)}],temperature:0.2,topP:0.8,...(thinking?{thinking:{effort:'low'},maxCompletionTokens:5120}:{maxTokens:3000})};
    const resultIds=typeof input==='object'&&input!==null&&'results' in input&&Array.isArray(input.results)?input.results.map((result:unknown)=>typeof result==='object'&&result!==null&&'id' in result?String(result.id):'').filter(Boolean):undefined;
    return this.request(role,task,model,this.config.chatEndpoint,body,result=>{const parsed=chatSchema.parse(result);let data=schema.parse(extractJSON(parsed.message.content));if(validate){try{data=validate(data);}catch(error){throw error instanceof HCXError?error:new HCXError('AI_VALIDATION_ERROR');}}return{data,inputTokens:parsed.usage?.promptTokens??parsed.inputLength??null,outputTokens:parsed.usage?.completionTokens??parsed.outputLength??null};},1,resultIds);
  }
  async embedText(text:string):Promise<number[]> {
    // Native embedding v2 takes one text and selects its model by endpoint, not a made-up model field.
    return this.request('embedding','embedTexts',this.config.embeddingModel,this.config.embeddingEndpoint,{text:text.slice(0,6000)},result=>{const parsed=embeddingSchema.parse(result);return{data:parsed.embedding,inputTokens:parsed.inputTokens??null,outputTokens:0};});
  }
}
