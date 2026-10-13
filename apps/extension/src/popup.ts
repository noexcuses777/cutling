import { BRAND } from '@cutling/shared';
import { button,node,rpc,supportedUrl,type ExtensionState } from './common';
const app=document.querySelector<HTMLElement>('#app')!;
document.title=BRAND.korean;
async function render(){
  app.replaceChildren(node('h1',BRAND.korean),node('p','광고와 관련 없는 검색 결과를 접어둡니다.'));
  const [tab]=await chrome.tabs.query({active:true,currentWindow:true});
  const local=await rpc<Pick<ExtensionState,'enabled'>>('GET_LOCAL_STATE');
  const toggle=node('input',undefined,{type:'checkbox',id:'toggle'});toggle.checked=local.enabled;
  toggle.addEventListener('change',()=>void rpc('SET_ENABLED',{enabled:toggle.checked}));
  const label=node('label','필터 켜기');label.prepend(toggle);app.append(label);
  const status=node('p',supportedUrl(tab?.url??'')?'현재 탭에서 필터를 사용할 수 있어요.':'네이버에서 검색하면 필터가 자동으로 적용돼요.',{class:'status',role:'status'});app.append(status);
  const state=await rpc<ExtensionState>('GET_STATE',{tabId:tab?.id});
  if(state.connected){
    status.textContent='웹 연결됨 · 자료 저장도 사용할 수 있어요.';
    const select=node('select',undefined,{'aria-label':'현재 프로젝트'});select.append(node('option','자료를 저장할 학습 목록',{value:''}));
    for(const project of state.projects){const option=node('option',project.title,{value:project.id});option.selected=project.id===state.context?.projectId;select.append(option);}
    select.addEventListener('change',()=>{if(select.value)void rpc('SET_CONTEXT',{projectId:select.value,tabId:tab?.id}).then(()=>{status.textContent='선택했어요. 검색 탭을 새로고침해 주세요.';}).catch(e=>{status.textContent=e.message;});});
    app.append(select,button('내 자료 열기',()=>rpc('OPEN_DASHBOARD',{projectId:select.value,tabId:tab?.id}).then(()=>{}),'primary'));
    if(tab?.url&&/^https:\/\/(m\.)?blog\.naver\.com\//.test(tab.url))app.append(button('이 페이지 담기',async()=>{status.textContent='본문을 읽고 있어요…';try{const result=await rpc<{partial:boolean}>('CAPTURE_CURRENT',{tabId:tab.id,projectId:select.value});status.textContent=result.partial?'일부 본문을 저장했어요.':'현재 본문을 저장했어요.';}catch(error){status.textContent=(error as Error).message;}}));
  }else app.append(node('small','필터는 연결 없이 작동합니다. 웹에 연결하면 찾은 자료를 저장할 수 있어요.'));
  app.append(button(state.connected?'연결 설정':'자료 저장 연결하기',()=>rpc('OPEN_OPTIONS').then(()=>{})));
}
void render().catch(error=>app.append(node('p',error.message,{class:'error'})));
