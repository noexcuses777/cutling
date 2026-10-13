import { DEFAULT_BACKEND, naverSearch, supportedUrl, validBackend, type TabContext } from './common';
import { FilterSettingsSchema, type FilterSettings, type Project } from '@cutling/shared';
import {allowedApi,hasRecentVerification,senderCategory,type VerifiedConnection} from './policy';

type Stored = {backend?: string; token?: string; expiresAt?: string; enabled?: boolean; selectedProjectId?: string; alwaysDomains?: string[]; localFilters?:FilterSettings};
const settings = async () => await chrome.storage.local.get(['backend','token','expiresAt','enabled','selectedProjectId','alwaysDomains','localFilters']) as Stored;
void chrome.storage.local.setAccessLevel({accessLevel:'TRUSTED_CONTEXTS'});
void chrome.storage.session.setAccessLevel({accessLevel:'TRUSTED_CONTEXTS'});
const id = (value: unknown) => typeof value === 'string' && /^[a-zA-Z0-9_-]{1,120}$/.test(value) ? value : undefined;
async function rememberVerification(stored:Stored){
  const current=await settings();
  if(stored.token&&current.token===stored.token&&current.backend===stored.backend)await chrome.storage.session.set({connectionVerification:{token:stored.token,backend:stored.backend??DEFAULT_BACKEND,checkedAt:Date.now()}});
}

async function api(path: string, method='GET', body?: unknown, anonymous=false) {
  const stored=await settings();
  if (!anonymous && (!stored.token || !stored.expiresAt || Date.parse(stored.expiresAt)<Date.now())) throw new Error('연결이 필요하거나 만료되었어요. 확장 설정에서 다시 연결해 주세요.');
  const response=await fetch(`${stored.backend ?? DEFAULT_BACKEND}${path}`,{method,headers:{'Content-Type':'application/json','X-Cutling-Extension-ID':chrome.runtime.id,...(!anonymous?{Authorization:`Bearer ${stored.token}`}:{})},body:body===undefined?undefined:JSON.stringify(body),credentials:'omit',redirect:'error',signal:AbortSignal.timeout(18000)});
  const data=await response.json().catch(()=>({}));
  if(!response.ok){if(response.status===401&&(await settings()).token===stored.token){await chrome.storage.local.remove(['token','expiresAt']);await chrome.storage.session.remove('connectionVerification');}throw new Error(data.error?.message ?? `서버 응답 오류 (${response.status})`);}
  if(!anonymous)await rememberVerification(stored);
  return data;
}
let statusRequest:{key:string;promise:Promise<{connected:boolean}>}|undefined;
async function connectionStatus(stored:Stored){
  if(!stored.token||!stored.expiresAt||Date.parse(stored.expiresAt)<=Date.now())return {connected:false};
  const backend=stored.backend??DEFAULT_BACKEND;
  const proof=(await chrome.storage.session.get('connectionVerification')).connectionVerification as VerifiedConnection|undefined;
  const key=`${backend}|${stored.token}`;
  const verify=()=>{
    if(statusRequest?.key===key)return statusRequest.promise;
    const promise=api('/api/extension/status').then(async result=>({connected:result.connected===true&&(await settings()).token===stored.token}));
    statusRequest={key,promise};void promise.finally(()=>{if(statusRequest?.promise===promise)statusRequest=undefined;}).catch(()=>{});return promise;
  };
  // PAIR and authenticated API responses provide a 30s proof. Recheck in the
  // background; a page status probe must not wait for the whole project list.
  if(hasRecentVerification(stored,proof,backend)){void verify().catch(()=>{});return {connected:true};}
  return verify();
}
async function tabContext(tabId?: number): Promise<TabContext | undefined> {
  if(tabId===undefined)return undefined;
  return (await chrome.storage.session.get(`tab:${tabId}`))[`tab:${tabId}`];
}
async function setContext(tabId: number, context: TabContext) { await chrome.storage.session.set({[`tab:${tabId}`]:context}); }
async function state(tabId?: number) {
  const stored=await settings();let projects: Project[]=[];let error: string|undefined;
  let connected=!!stored.token && !!stored.expiresAt && Date.parse(stored.expiresAt)>Date.now();
  if(connected)try{projects=(await api('/api/projects')).projects;}catch(e){error=(e as Error).message;connected=false;}
  let context=await tabContext(tabId);
  if(!context && stored.selectedProjectId && projects.some(p=>p.id===stored.selectedProjectId))context={projectId:stored.selectedProjectId};
  return {connected,projects,context,backend:stored.backend??DEFAULT_BACKEND,enabled:stored.enabled!==false,expiresAt:stored.expiresAt,error,alwaysDomains:stored.alwaysDomains??[],localFilters:stored.localFilters};
}
async function openSearch(payload: Record<string,unknown>, sourceTabId?: number) {
  const projectId=id(payload.projectId);const query=typeof payload.query==='string'?payload.query.trim().slice(0,300):'';
  if(!projectId||!query)throw new Error('프로젝트와 검색어가 필요해요.');
  await api(`/api/projects/${encodeURIComponent(projectId)}`);
  let sessionId=id(payload.sessionId);
  if(!sessionId)sessionId=(await api('/api/search/sessions','POST',{projectId,query})).session.id;
  const tab=await chrome.tabs.create({url:'about:blank'});
  if(tab.id===undefined)throw new Error('검색 탭을 열지 못했어요.');
  await setContext(tab.id,{projectId,sessionId,query});
  await chrome.storage.local.set({selectedProjectId:projectId});
  await chrome.tabs.update(tab.id,{url:naverSearch(query)});
  if(sourceTabId) await api('/api/events','POST',{projectId,sessionId,type:'search_opened',metadata:{source:'extension'}}).catch(()=>{});
  return {opened:true};
}
async function handle(message: unknown,sender: chrome.runtime.MessageSender) {
  if(sender.id!==chrome.runtime.id||!message||typeof message!=='object')throw new Error('허용되지 않은 메시지예요.');
  const {type,payload={}}=message as {type:string;payload:Record<string,unknown>};
  const stored=await settings();const backend=stored.backend??DEFAULT_BACKEND;
  const category=senderCategory(sender.url??'',sender.frameId,chrome.runtime.getURL(''),backend);
  const trusted=category==='extension';
  const search=category==='naver';
  const web=category==='web';
  if(!trusted&&!search&&!web)throw new Error('허용되지 않은 페이지예요.');
  if(type==='BRIDGE_CONFIG' && web)return {backend};
  if(type==='CONNECT_STATUS' && web)return connectionStatus(stored);
  if(type==='OPEN_NAVER_SEARCH' && (web||trusted||search))return openSearch(payload,sender.tab?.id);
  if(web)throw new Error('웹 페이지는 연결 상태와 검색 열기만 요청할 수 있어요.');
  const tabId=trusted&&typeof payload.tabId==='number'?payload.tabId:sender.tab?.id;
  if(type==='GET_LOCAL_STATE')return {enabled:stored.enabled!==false,alwaysDomains:stored.alwaysDomains??[],localFilters:stored.localFilters,backend};
  if(type==='SET_LOCAL_FILTERS'){
    const filters=FilterSettingsSchema.parse(payload.filters);await chrome.storage.local.set({localFilters:filters});
    for(const tab of await chrome.tabs.query({url:['https://search.naver.com/*']}))if(tab.id!==undefined)void chrome.tabs.sendMessage(tab.id,{type:'CUTLING_FILTERS',filters}).catch(()=>{});
    return {filters};
  }
  if(type==='GET_STATE')return state(tabId);
  if(type==='SET_CONTEXT'){
    const projectId=id(payload.projectId);if(!projectId||tabId===undefined)throw new Error('프로젝트를 선택해 주세요.');
    await api(`/api/projects/${projectId}`);await setContext(tabId,{projectId});await chrome.storage.local.set({selectedProjectId:projectId});return {ok:true};
  }
  if(type==='SET_ENABLED'){
    await chrome.storage.local.set({enabled:payload.enabled===true});
    for(const tab of await chrome.tabs.query({url:['https://search.naver.com/*']}))if(tab.id!==undefined)void chrome.tabs.sendMessage(tab.id,{type:'CUTLING_ENABLED',enabled:payload.enabled===true}).catch(()=>{});
    return {enabled:payload.enabled===true};
  }
  if(type==='ALWAYS_DOMAIN'){
    if(typeof payload.domain!=='string'||!/^[a-z0-9.-]{1,253}$/i.test(payload.domain))throw new Error('도메인을 확인해 주세요.');
    const domains=[...new Set([...(stored.alwaysDomains??[]),payload.domain])].slice(-200);await chrome.storage.local.set({alwaysDomains:domains});return {alwaysDomains:domains};
  }
  if(type==='API'){
    const method=payload.method??'GET';if(!allowedApi(payload.path,method))throw new Error('지원하지 않는 요청이에요.');
    const result=await api(payload.path,method as string,payload.body);
    if(payload.path==='/api/search/sessions'&&tabId!==undefined){const body=payload.body as Record<string,string>;await setContext(tabId,{projectId:body.projectId,query:body.query,sessionId:result.session.id});}
    return result;
  }
  if(type==='OPEN_DASHBOARD'){
    const context=await tabContext(tabId);const projectId=id(payload.projectId)??context?.projectId??stored.selectedProjectId;
    await chrome.tabs.create({url:`${backend}${projectId?`/projects/${encodeURIComponent(projectId)}`:'/settings'}`});return {opened:true};
  }
  if(type==='OPEN_OPTIONS'){await chrome.runtime.openOptionsPage();return {opened:true};}
  if(type==='OPEN_SETTINGS'){await chrome.tabs.create({url:`${backend}/settings`});return {opened:true};}
  if(!trusted)throw new Error('확장 설정 화면에서만 사용할 수 있어요.');
  if(type==='CONFIGURE'){
    const next=validBackend(String(payload.backend??DEFAULT_BACKEND));
    if(next.startsWith('https:')&&!await chrome.permissions.contains({origins:[`${next}/*`]}))throw new Error('설정한 서버 접근 권한이 필요해요.');
    await chrome.scripting.unregisterContentScripts({ids:['cutling-web-custom']}).catch(()=>{});
    if(next.startsWith('https:'))await chrome.scripting.registerContentScripts([{id:'cutling-web-custom',matches:[`${next}/*`],js:['bridge.js'],runAt:'document_start'}]);
    if(next!==backend){await chrome.storage.local.remove(['token','expiresAt']);await chrome.storage.session.remove('connectionVerification');if(backend.startsWith('https:'))await chrome.permissions.remove({origins:[`${backend}/*`]}).catch(()=>{});}
    await chrome.storage.local.set({backend:next});return {backend:next};
  }
  if(type==='PAIR'){
    if(typeof payload.code!=='string'||payload.code.length>100)throw new Error('연결 코드를 확인해 주세요.');
    const paired=await api('/api/extension/pair','POST',{code:payload.code.trim()},true);
    if(typeof paired.token!=='string'||typeof paired.expiresAt!=='string')throw new Error('올바르지 않은 연결 응답이에요.');
    await chrome.storage.local.set({token:paired.token,expiresAt:paired.expiresAt,selectedProjectId:paired.projects?.[0]?.id});await rememberVerification(await settings());return {connected:true,expiresAt:paired.expiresAt};
  }
  if(type==='DISCONNECT'){
    await api('/api/extension/revoke','POST').catch(()=>{});await chrome.storage.local.remove(['token','expiresAt','selectedProjectId','alwaysDomains']);await chrome.storage.session.clear();return {connected:false};
  }
  if(type==='CAPTURE_CURRENT'){
    if(tabId===undefined)throw new Error('열린 탭을 찾지 못했어요.');
    const tab=await chrome.tabs.get(tabId);if(!supportedUrl(tab.url??''))throw new Error('현재 페이지 본문 담기는 네이버 블로그에서 지원해요.');
    const projectId=id(payload.projectId)??(await tabContext(tabId))?.projectId??stored.selectedProjectId;if(!projectId)throw new Error('프로젝트를 먼저 선택해 주세요.');
    const capture=await Promise.race([chrome.tabs.sendMessage(tabId,{type:'CUTLING_CAPTURE'}),new Promise<never>((_,reject)=>setTimeout(()=>reject(new Error('본문을 찾지 못했어요. 웹에서 URL 또는 본문을 직접 담아 주세요.')),4000))]);
    if(!capture?.text)throw new Error('본문을 찾지 못했어요. 웹에서 URL 또는 본문을 직접 담아 주세요.');
    const saved=await api('/api/resources','POST',{projectId,url:capture.url,title:capture.title,text:capture.text});return {...saved,partial:capture.partial};
  }
  throw new Error('지원하지 않는 동작이에요.');
}
chrome.runtime.onMessage.addListener((message,sender,sendResponse)=>{
  void handle(message,sender).then(data=>sendResponse({ok:true,data})).catch(error=>sendResponse({ok:false,error:error instanceof Error?error.message:'요청을 처리하지 못했어요.'}));return true;
});
chrome.tabs.onRemoved.addListener(tabId=>void chrome.storage.session.remove(`tab:${tabId}`));
