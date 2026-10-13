import { rpc } from './common';
// No token crosses this bridge. Only a status probe and a project search may be requested.
// Register immediately at document_start so bootstrap/focus probes are not lost
// while the worker wakes. The worker independently enforces the configured
// backend origin and top-frame identity before either allowed action executes.
if(window.top===window){
  const pageOrigin=location.origin;
  const requests=new Map<string,number>();
  window.addEventListener('message',event=>{
    if(event.source!==window||event.origin!==pageOrigin||!event.data||event.data.source!=='cutling-web')return;
    const {type,requestId,payload}=event.data;
    if(!['CONNECT_STATUS','OPEN_NAVER_SEARCH'].includes(type)||typeof requestId!=='string'||requestId.length>100)return;
    if(requests.has(requestId))return;
    const now=Date.now();for(const [key,time] of requests)if(now-time>60000)requests.delete(key);
    if(requests.size>100)return;requests.set(requestId,now);
    const sanitized=type==='OPEN_NAVER_SEARCH'?{projectId:payload?.projectId,query:payload?.query,sessionId:payload?.sessionId}:{};
    void rpc(type,sanitized).then(data=>window.postMessage({source:'cutling-extension',type,requestId,payload:data},pageOrigin)).catch(error=>window.postMessage({source:'cutling-extension',type,requestId,payload:{error:(error as Error).message}},pageOrigin));
  });
}
