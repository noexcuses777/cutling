import 'server-only';
import dns from 'node:dns/promises';
import http from 'node:http';
import https from 'node:https';
import ipaddr from 'ipaddr.js';
import {load} from 'cheerio';
import {ApiError} from './security';
export function publicAddress(address:string){try{let ip=ipaddr.parse(address);if(ip.kind()==='ipv6'&&(ip as ipaddr.IPv6).isIPv4MappedAddress())ip=(ip as ipaddr.IPv6).toIPv4Address();return ip.range()==='unicast';}catch{return false;}}
export async function validatePublicUrl(input:string,resolver=dns.lookup){
 let url:URL;try{url=new URL(input);}catch{throw new ApiError(400,'INVALID_URL','올바른 URL을 입력해 주세요.');}
 if(!['http:','https:'].includes(url.protocol)||url.username||url.password||(url.port&&!['80','443'].includes(url.port)))throw new ApiError(400,'UNSAFE_URL','공개 HTTP/HTTPS 문서만 가져올 수 있습니다.');
 const hostname=url.hostname.replace(/^\[|\]$/g,'');
 if(hostname==='localhost'||hostname.endsWith('.localhost')||hostname.endsWith('.local')||hostname.endsWith('.internal'))throw new ApiError(400,'SSRF_BLOCKED','내부 네트워크 주소는 가져올 수 없습니다.');
 const addresses=ipaddr.isValid(hostname)?[{address:hostname,family:ipaddr.parse(hostname).kind()==='ipv4'?4:6}]:await resolver(hostname,{all:true,verbatim:true});
 if(!addresses.length||addresses.some(a=>!publicAddress(a.address)))throw new ApiError(400,'SSRF_BLOCKED','내부 네트워크 주소는 가져올 수 없습니다.');
 return {url,addresses};
}
export async function extractPublicPage(input:string){
 const deadline=Date.now()+12000;let target=input;
 for(let hops=0;hops<=3;hops++){
  const remaining=deadline-Date.now();if(remaining<=0)throw new ApiError(408,'FETCH_TIMEOUT','본문 수집 시간이 초과되었습니다.',true);
  let timer:ReturnType<typeof setTimeout>|undefined;
  const validated=await Promise.race([validatePublicUrl(target),new Promise<never>((_,reject)=>{timer=setTimeout(()=>reject(new ApiError(408,'FETCH_TIMEOUT','주소 확인 시간이 초과되었습니다.',true)),remaining);})]).finally(()=>clearTimeout(timer));
  const {url,addresses}=validated;
  let bodyDeadline:ReturnType<typeof setTimeout>|undefined;
  const response=await new Promise<{status:number,location?:string,mime:string,body:string}>((resolve,reject)=>{
   const transport=url.protocol==='https:'?https:http;
   const req=transport.get(url,{headers:{'User-Agent':'Cutling/0.1 user-requested-resource','Accept':'text/html,text/plain'},lookup:(_host,options,callback)=>{
    // Pin the connection to the DNS answers that passed validation (prevents DNS rebinding).
    if(typeof options==='object'&&options.all)(callback as any)(null,addresses);else (callback as any)(null,addresses[0].address,addresses[0].family);
   }},res=>{
    if(res.statusCode&&[301,302,303,307,308].includes(res.statusCode)){res.destroy();resolve({status:res.statusCode,location:res.headers.location,mime:'',body:''});return;}
    const mime=(res.headers['content-type']||'').split(';')[0];if(!['text/html','text/plain','application/xhtml+xml'].includes(mime)){res.destroy();reject(new ApiError(415,'UNSUPPORTED_DOCUMENT','HTML 또는 텍스트 자료만 지원합니다.'));return;}
    const chunks:Buffer[]=[];let size=0;res.on('data',chunk=>{size+=chunk.length;if(size>1_000_000){req.destroy();reject(new ApiError(413,'DOCUMENT_TOO_LARGE','본문이 너무 큽니다. 필요한 부분을 붙여 넣어 주세요.'));}else chunks.push(chunk);});res.on('error',reject);res.on('end',()=>resolve({status:res.statusCode||500,mime,body:Buffer.concat(chunks).toString('utf8')}));
   });
   // A socket inactivity timeout alone lets a slow stream monopolize the queue.
   bodyDeadline=setTimeout(()=>req.destroy(new ApiError(408,'FETCH_TIMEOUT','본문 수집 시간이 초과되었습니다.',true)),Math.max(1,deadline-Date.now()));
   req.on('error',reject);
  }).finally(()=>clearTimeout(bodyDeadline));
  if([301,302,303,307,308].includes(response.status)){if(!response.location||hops===3)throw new ApiError(400,'REDIRECT_LIMIT','본문 이동 횟수를 초과했습니다.');target=new URL(response.location,url).toString();continue;}
  if(response.status>=400)throw new ApiError(response.status,'FETCH_RESTRICTED','원문 접근이 제한되었습니다. 본문을 직접 붙여 넣어 주세요.');
  if(response.mime==='text/plain')return {text:response.body.slice(0,40000),title:'',partial:response.body.length>40000};
  const $=load(response.body);$('script,style,nav,header,footer,aside,form,iframe,noscript,[role="navigation"],.comments,.advertisement').remove();
  const root=$('article').first().length?$('article').first():$('main').first().length?$('main').first():$('.se-main-container').first().length?$('.se-main-container').first():$('body');
  root.find('p,h1,h2,h3,li,pre,div,section').each((_,el)=>{$(el).append('\n');});const text=root.text().split('\n').map(s=>s.replace(/\s+/g,' ').trim()).filter(Boolean).join('\n');
  if(text.length<70)throw new ApiError(422,'INSUFFICIENT_TEXT','본문을 충분히 확보하지 못했습니다. 직접 붙여 넣을 수 있습니다.');
  return {text:text.slice(0,40000),title:$('title').text().slice(0,200),partial:text.length>40000};
 }
 throw new ApiError(400,'FETCH_FAILED','본문을 가져올 수 없습니다.');
}
