import { BRAND, DEFAULT_FILTERS, INTENTS, classifyResults, type Assessment, type FilterSettings, type Project, type Resource } from '@cutling/shared';
import { captureNaverBlog, extractNaverResults, isOwnedMutation, queryFromNaver, VersionGate, type ExtractedResult } from '@cutling/search-adapters';
import { button,node,rpc,DEFAULT_BACKEND,type ExtensionState } from './common';
import { ResultDecoration } from './result-ui';

chrome.runtime.onMessage.addListener((message,sender,respond)=>{
  if(sender.id!==chrome.runtime.id||message.type!=='CUTLING_CAPTURE')return;
  const capture=captureNaverBlog(document);if(capture)respond(capture);
});
if(location.hostname==='search.naver.com'&&window.top===window)void start().catch(()=>{});

async function start(){
  if(document.querySelector('[data-cutling-owned="panel"]'))return;
  const gate=new VersionGate();
  let query=queryFromNaver(location.href);
  let state:ExtensionState={connected:false,backend:DEFAULT_BACKEND,enabled:true,projects:[],alwaysDomains:[]};
  let localFilters={...DEFAULT_FILTERS};let project:Project|undefined;let resources:Resource[]=[];
  let sessionId:string|undefined;let sessionQuery='';let enabled=true;let expanded=false;
  let status='광고와 관련 없는 결과를 정리하고 있어요.';
  let timer:ReturnType<typeof setTimeout>|undefined;let running:number|undefined;
  const processed=new Set<string>();const serverProcessed=new Set<string>();const records=new Map<string,ExtractedResult>();
  const decorations=new Map<string,ResultDecoration>();const assessments=new Map<string,Assessment>();
  const panel=node('aside',undefined,{'data-cutling-owned':'panel','aria-label':`${BRAND.korean} 검색 필터`});
  const root=panel.attachShadow({mode:'open'});document.body.append(panel);
  const api=<T>(path:string,method='GET',body?:unknown)=>rpc<T>('API',{path,method,body});
  const currentFilters=()=>project?.filters??localFilters;
  function restore(){for(const decoration of decorations.values())decoration.restore();decorations.clear();records.clear();assessments.clear();processed.clear();serverProcessed.clear();}
  function setStatus(value:string){status=value;renderPanel();}
  function schedule(){if(timer)clearTimeout(timer);timer=setTimeout(()=>void scan(),180);}
  function redraw(){for(const [id,decoration]of decorations){const assessment=assessments.get(id);if(assessment)decoration.update(assessment,enabled,currentFilters(),state.alwaysDomains?.includes(decoration.record.result.domain??''));}renderPanel();}
  async function save(record:ExtractedResult){
    if(!project)throw new Error('자료를 저장하려면 웹과 연결한 뒤 학습 목록을 선택해 주세요.');
    const result=await api<{resource:Resource;duplicate:boolean}>('/api/resources','POST',{projectId:project.id,url:record.result.url,title:record.result.title,snippet:record.result.snippet});
    if(!resources.some(item=>item.id===result.resource.id))resources.push(result.resource);renderPanel();
    return result.duplicate?'이미 저장한 자료예요.':'자료를 저장했어요.';
  }
  async function feedback(record:ExtractedResult,type:string){
    if(type==='always_domain'){const data=await rpc<{alwaysDomains:string[]}>('ALWAYS_DOMAIN',{domain:record.result.domain});state.alwaysDomains=data.alwaysDomains;redraw();}
    if(!project||!sessionId)return;
    const response=await api<{jobId?:string}>(`/api/search/results/${record.result.id}/feedback`,'POST',{projectId:project.id,sessionId,type,domain:record.result.domain});
    if(type==='reevaluate'&&response.jobId)void poll(response.jobId,gate.current());
  }
  function apply(items:Assessment[],version:number){
    if(!gate.isCurrent(version)||!enabled)return;
    for(const assessment of items){
      const record=records.get(assessment.resultId);if(!record||!record.element.isConnected)continue;
      assessments.set(assessment.resultId,assessment);
      let decoration=decorations.get(assessment.resultId);
      if(!decoration){
        decoration=new ResultDecoration(record,{save:()=>save(record),canSave:()=>!!project&&state.connected,feedback:type=>feedback(record,type),reveal:()=>renderPanel(),less:async()=>{
          const filters={...currentFilters(),strength:'gentle' as const};
          if(assessment.commercialityLabel==='explicit_ad'||/강의|부트캠프/.test(assessment.contentType))filters.lowerPromotions=false;
          else if(assessment.contentType==='취업 후기')filters.lowerCareer=false;
          await updateFilters(filters);
        }});decorations.set(assessment.resultId,decoration);
      }
      decoration.update(assessment,enabled,currentFilters(),state.alwaysDomains?.includes(record.result.domain??''));
    }
    renderPanel();
  }
  async function poll(jobId:string,version:number){
    for(let attempt=0;attempt<45;attempt++){
      await new Promise(resolve=>setTimeout(resolve,Math.min(700+attempt*100,3000)));
      if(!gate.isCurrent(version)||!enabled)return;
      try{
        const data=await api<{job:{status:string;result?:{assessments:Assessment[];fallback?:boolean}}}>(`/api/jobs/${jobId}`);
        if(!gate.isCurrent(version))return;
        if(data.job.result?.assessments)apply(data.job.result.assessments,version);
        if(['completed','ready','succeeded','failed'].includes(data.job.status)){setStatus('정리가 끝났어요. 접힌 결과는 언제든 펼칠 수 있어요.');return;}
      }catch{if(gate.isCurrent(version))setStatus('기본 필터가 적용됐어요.');return;}
    }
  }
  async function scan(){
    const version=gate.current();
    // A project, server connection or AI request is never a prerequisite for filtering.
    if(!enabled||!query)return;
    for(const [id,record]of records)if(!record.element.isConnected){decorations.get(id)?.restore();decorations.delete(id);records.delete(id);assessments.delete(id);processed.delete(id);}
    const visible=extractNaverResults(document,{visibleOnly:true,limit:80});
    const batch=visible.filter(record=>!processed.has(record.result.id)).slice(0,10);
    if(!batch.length&&!processed.size){setStatus('검색 결과를 기다리고 있어요.');return;}
    for(const record of batch){
      for(const [oldId,old]of records)if(old.element===record.element&&oldId!==record.result.id){decorations.get(oldId)?.restore();decorations.delete(oldId);records.delete(oldId);assessments.delete(oldId);processed.delete(oldId);}
      records.set(record.result.id,record);processed.add(record.result.id);
    }
    if(batch.length){
      const context={query,selectedIntent:project?.selectedIntent,learningGoal:project?.learningGoal,filters:currentFilters()};
      apply(classifyResults([...records.values()].slice(-40).map(r=>r.result),context),version);
      setStatus('광고와 검색 목적에 맞지 않는 결과를 접었어요.');schedule();
    }
    // Scrolling and mutation scans keep working while the optional server is slow.
    if(!project||!sessionId||!state.connected||running===version)return;
    const remoteBatch=[...records.values()].filter(record=>!serverProcessed.has(record.result.id)).slice(0,10);
    if(!remoteBatch.length)return;
    for(const record of remoteBatch)serverProcessed.add(record.result.id);
    running=version;
    try{
      const response=await api<{assessments:Assessment[];jobId?:string;version:number}>('/api/search/results/analyze','POST',{projectId:project.id,sessionId,query,results:remoteBatch.map(r=>r.result),version});
      if(!gate.isCurrent(version)||response.version!==version)return;
      apply(response.assessments,version);if(response.jobId)void poll(response.jobId,version);
    }catch{if(gate.isCurrent(version))setStatus('기본 필터가 적용됐어요. 서버가 없어도 계속 사용할 수 있어요.');}
    finally{if(running===version)running=undefined;if(gate.isCurrent(version))schedule();}
  }
  async function activate(projectId:string){
    const reusableSession=project?.id===projectId&&sessionQuery===query?sessionId:state.context?.projectId===projectId&&state.context.query===query?state.context.sessionId:undefined;
    const version=gate.next();restore();sessionId=undefined;project=undefined;schedule();
    try{
      const data=await api<{project:Project;resources:Resource[]}>(`/api/projects/${projectId}`);
      if(!gate.isCurrent(version))return;project=data.project;resources=data.resources;
      const search=reusableSession?{session:{id:reusableSession}}:await api<{session:{id:string}}>('/api/search/sessions','POST',{projectId,query});
      if(!gate.isCurrent(version))return;sessionId=search.session.id;sessionQuery=query;
      restore();setStatus('학습 목록에 자료를 저장할 수 있어요.');
    }catch{if(gate.isCurrent(version))setStatus('기본 필터를 사용 중이에요. 자료 저장 연결은 다시 확인해 주세요.');}
    finally{if(gate.isCurrent(version)){redraw();schedule();}}
  }
  async function updateFilters(filters:FilterSettings){
    if(project){project.filters=filters;void api(`/api/projects/${project.id}`,'PATCH',{filters}).catch(()=>setStatus('현재 화면에는 적용했어요. 웹 설정 저장은 다시 확인해 주세요.'));}
    else{localFilters=filters;await rpc('SET_LOCAL_FILTERS',{filters});}
    gate.next();restore();renderPanel();schedule();
  }
  async function selectIntent(intent:string){
    if(!project)return;project.selectedIntent=intent;gate.next();restore();schedule();
    try{await api('/api/search/intent','POST',{projectId:project.id,query,selectedIntent:intent});}catch{setStatus('현재 검색에 적용했어요. 저장 연결은 다시 확인해 주세요.');}
  }
  function renderPanel(){
    const collapsed=[...decorations.values()].filter(item=>item.collapsed).length;
    root.replaceChildren(node('style',`:host{position:fixed;right:20px;bottom:22px;z-index:10000;font:13px/1.5 system-ui,-apple-system,'Malgun Gothic',sans-serif;color:#2b3038}*{box-sizing:border-box}.panel{width:296px;max-height:calc(100vh - 48px);overflow:auto;background:white;border:1px solid #dfe2e7;border-radius:10px;box-shadow:0 4px 20px #1e26321a;padding:18px}h2{margin:0;font-size:17px}p{margin:10px 0;color:#636b75}.row{display:flex;gap:8px;align-items:center;justify-content:space-between}button,select{font:inherit;color:#343b44;background:white;border:1px solid #dfe2e7;border-radius:6px;padding:7px 10px;cursor:pointer}button:hover{background:#f6f7f8}button:focus-visible,select:focus-visible,input:focus-visible,summary:focus-visible{outline:2px solid #4b5f7d;outline-offset:2px}.open{padding:11px 15px;box-shadow:0 3px 12px #1e263215}.count{font-size:24px;color:#262c34;margin:14px 0}.count small{font-size:12px;color:#747c87}.meta{font-size:12px;color:#7b828d}select{width:100%;margin:8px 0}label{display:block;margin:12px 0}input{accent-color:#424e61;margin-right:8px}details{border-top:1px solid #eceef1;margin-top:14px;padding-top:14px}summary{cursor:pointer}.close{border:0;padding:2px 0;color:#7a838f}.primary{background:#343e4e;color:white;border-color:#343e4e}.primary:hover{background:#475469}.foot{display:flex;gap:8px;margin-top:14px}.foot button{flex:1}.status{font-size:12px}.query{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.switch{font-weight:600}.help{font-size:12px;padding-top:5px}@media(max-width:600px){:host{right:12px;bottom:12px}.panel{width:calc(100vw - 24px);max-height:70vh}}`));
    if(!expanded){const open=button(`${BRAND.korean} · ${enabled?`${collapsed}개 접음`:'필터 꺼짐'}`,()=>{expanded=true;renderPanel();},'open');open.setAttribute('aria-expanded','false');root.append(open);return;}
    const body=node('section',undefined,{class:'panel'});const header=node('div',undefined,{class:'row'});
    header.append(node('h2',BRAND.korean),button('접기',()=>{expanded=false;renderPanel();},'close'));body.append(header,node('p',query||'검색어를 입력해 주세요.',{class:'query'}));
    const toggle=node('input',undefined,{type:'checkbox',id:'cutling-enabled'});toggle.checked=enabled;
    toggle.addEventListener('change',()=>void rpc('SET_ENABLED',{enabled:toggle.checked}).catch(e=>setStatus(e.message)));
    const toggleLabel=node('label','필터 켜기',{class:'switch'});toggleLabel.prepend(toggle);body.append(toggleLabel);
    const count=node('p',`${collapsed}개 접음 `,{class:'count'});count.append(node('small',`/ 확인한 결과 ${assessments.size}개`));body.append(count,node('p',status,{class:'status',role:'status'}));
    const settings=node('details');settings.append(node('summary','필터 설정'));
    for(const [key,label]of [['lowerPromotions','광고·모집 홍보 접기'],['lowerCareer','취업 후기 접기'],['groupDuplicates','중복 결과 접기']] as const){
      const checkbox=node('input',undefined,{type:'checkbox'});checkbox.checked=currentFilters()[key];const field=node('label',label);field.prepend(checkbox);
      checkbox.addEventListener('change',()=>void updateFilters({...currentFilters(),[key]:checkbox.checked}).catch(e=>setStatus(e.message)));settings.append(field);
    }
    const strength=node('select',undefined,{'aria-label':'필터 강도'});
    for(const [value,label]of [['gentle','약하게'],['balanced','보통'],['strong','강하게']]){const option=node('option',label,{value});option.selected=value===currentFilters().strength;strength.append(option);}
    strength.addEventListener('change',()=>void updateFilters({...currentFilters(),strength:strength.value as FilterSettings['strength']}).catch(e=>setStatus(e.message)));settings.append(strength);body.append(settings);
    const learning=node('details');learning.append(node('summary',project?`자료 저장 · ${project.title}`:'자료를 저장하고 싶다면'));
    if(state.connected){
      const select=node('select',undefined,{'aria-label':'연결할 학습 프로젝트'});select.append(node('option','학습 목록 선택',{value:''}));
      for(const item of state.projects){const option=node('option',item.title,{value:item.id});option.selected=item.id===project?.id;select.append(option);}
      select.addEventListener('change',()=>{if(select.value)void rpc('SET_CONTEXT',{projectId:select.value}).then(()=>activate(select.value)).catch(e=>setStatus(e.message));});learning.append(select);
      if(project){const intent=node('select',undefined,{'aria-label':'검색 목적'});for(const label of INTENTS){const option=node('option',label,{value:label});option.selected=label===project.selectedIntent;intent.append(option);}intent.addEventListener('change',()=>void selectIntent(intent.value));learning.append(intent,node('p',`저장한 자료 ${resources.length}개`,{class:'meta'}));}
      learning.append(button('내 자료 열기',()=>rpc('OPEN_DASHBOARD',{projectId:project?.id}).then(()=>{})));
    }else learning.append(node('p','필터는 연결 없이 작동해요. 자료 저장과 정리는 웹에 연결하면 사용할 수 있어요.',{class:'help'}),button('웹 연결하기',()=>rpc('OPEN_OPTIONS').then(()=>{})));
    body.append(learning,node('p','접힌 결과의 ‘다시 보기’로 원문을 펼칠 수 있어요.',{class:'meta'}));root.append(body);
  }
  renderPanel();
  const observer=new MutationObserver(mutations=>{if(mutations.some(m=>!isOwnedMutation(m)))schedule();});
  observer.observe(document.body,{childList:true,subtree:true,characterData:true});
  window.addEventListener('scroll',schedule,{passive:true});window.addEventListener('resize',schedule,{passive:true});
  const queryCheck=window.setInterval(()=>{const next=queryFromNaver(location.href);if(next!==query){query=next;gate.next();restore();sessionId=undefined;if(project)void activate(project.id);else{renderPanel();schedule();}}},800);
  chrome.runtime.onMessage.addListener((message,sender)=>{
    if(sender.id!==chrome.runtime.id)return;
    if(message.type==='CUTLING_ENABLED'){enabled=message.enabled===true;gate.next();restore();setStatus(enabled?'광고와 관련 없는 결과를 정리하고 있어요.':'필터를 껐어요. 검색 결과를 원래대로 표시합니다.');if(enabled)schedule();}
    if(message.type==='CUTLING_FILTERS'&&!project){localFilters=message.filters;gate.next();restore();renderPanel();schedule();}
  });
  window.addEventListener('pagehide',event=>{if(event.persisted)return;observer.disconnect();window.clearInterval(queryCheck);if(timer)clearTimeout(timer);restore();});
  window.addEventListener('pageshow',event=>{if(event.persisted)schedule();});
  // Read local preferences before filtering. This endpoint never contacts a server.
  try{const local=await rpc<Partial<ExtensionState>>('GET_LOCAL_STATE');state={...state,...local};enabled=state.enabled;localFilters=state.localFilters??localFilters;}catch{/* keep defaults when an older worker is reloading */}
  renderPanel();schedule();
  // Optional pairing/project data loads in the background and cannot block local filtering.
  void rpc<ExtensionState>('GET_STATE').then(async connected=>{state=connected;renderPanel();if(state.connected&&state.context?.projectId)await activate(state.context.projectId);}).catch(()=>{});
}
