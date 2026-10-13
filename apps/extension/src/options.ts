import { BRAND } from '@cutling/shared';
import { button,node,rpc,validBackend,type ExtensionState } from './common';
const app=document.querySelector<HTMLElement>('#app')!;
document.title=`${BRAND.korean} 연결 설정`;
async function render(){
  app.replaceChildren(node('h1','자료 저장 연결'),node('p','검색 필터는 바로 작동합니다. 찾은 자료를 모아보려면 웹과 한 번만 연결해 주세요.'));
  let state: ExtensionState;try{state=await rpc<ExtensionState>('GET_STATE');}catch(error){app.append(node('p',(error as Error).message));return;}
  const status=node('p',state.connected?'웹 서비스와 연결되어 있어요.':'필터 사용 가능 · 자료 저장은 연결이 필요해요.',{class:'status',role:'status'});
  const code=node('input',undefined,{type:'text',id:'code',autocomplete:'off',placeholder:'웹에서 발급한 연결 코드',maxlength:'100'});
  const message=(text:string,error=false)=>{status.textContent=text;status.className=`status${error?' error':''}`;};
  const pair=button('연결하기',async()=>{pair.disabled=true;try{await rpc('PAIR',{code:code.value});code.value='';message('연결했어요. 웹과 네이버 검색 탭을 새로고침해 주세요.');}catch(error){message((error as Error).message,true);}finally{pair.disabled=false;}},'primary');
  app.append(status,node('h2','1. 웹에서 연결 코드 받기'),button('웹 설정 열기',()=>rpc('OPEN_SETTINGS').then(()=>{})),node('h2','2. 코드를 붙여넣고 연결'),node('label','일회용 연결 코드',{for:'code'}),code,pair);
  const advanced=node('details');advanced.append(node('summary','서버 주소 변경'));
  const backend=node('input',undefined,{type:'url',value:state.backend,id:'backend',placeholder:'http://localhost:3000'});
  const save=button('서버 주소 저장',async()=>{try{
    const value=validBackend(backend.value);
    if(value.startsWith('https:')&&!await chrome.permissions.request({origins:[`${value}/*`]})){message('서버 접근 권한이 허용되지 않았어요.',true);return;}
    await rpc('CONFIGURE',{backend:value});message('서버 주소를 저장했어요. 웹 페이지를 새로고침한 뒤 연결해 주세요.');
  }catch(error){message((error as Error).message,true);}});
  advanced.append(node('label','웹 서버 주소',{for:'backend'}),backend,save,node('small','보통은 기본 주소를 그대로 사용하면 됩니다.'));
  app.append(advanced);if(state.connected)app.append(button('연결 해제',async()=>{await rpc('DISCONNECT');message('연결을 해제했어요. 검색 필터는 계속 작동합니다.');}));
}
void render();
