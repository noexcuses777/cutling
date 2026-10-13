import 'server-only';
import {createHash,randomBytes} from 'node:crypto';
import {NextRequest} from 'next/server';
import {db,id} from './db';
export class ApiError extends Error {constructor(public status:number,public code:string,message:string,public retryable=false){super(message);}}
export const hash=(value:string)=>createHash('sha256').update(value).digest('hex');
export const token=()=>randomBytes(32).toString('base64url');
export const webOrigins=()=>new Set(['http://localhost:3000','http://127.0.0.1:3000',...(process.env.APP_ORIGIN?[new URL(process.env.APP_ORIGIN).origin]:[])]);
export function isExtensionOrigin(origin:string){return /^chrome-extension:\/\/[a-p]{32}$/.test(origin);}
export function checkHost(req:NextRequest){
 const host=req.headers.get('host');if(![...webOrigins()].some(o=>new URL(o).host===host))throw new ApiError(403,'HOST_REJECTED','허용되지 않은 서버 주소입니다.');
 const site=req.headers.get('sec-fetch-site');const origin=req.headers.get('origin');
 if(origin&&!webOrigins().has(origin)&&!isExtensionOrigin(origin))throw new ApiError(403,'ORIGIN_REJECTED','허용되지 않은 요청 출처입니다.');
 if(site==='cross-site'&&!origin?.startsWith('chrome-extension://'))throw new ApiError(403,'ORIGIN_REJECTED','외부 사이트의 요청을 허용하지 않습니다.');
}
export async function authenticate(req:NextRequest){
 const bearer=req.headers.get('authorization');const origin=req.headers.get('origin');
 const raw=bearer?.startsWith('Bearer ')?bearer.slice(7):req.cookies.get('cutling_session')?.value;
 if(!raw)throw new ApiError(401,'UNAUTHORIZED','웹 서비스를 열거나 확장 프로그램을 연결해 주세요.');
 const credential=await db.credential.findUnique({where:{hash:hash(raw)}});
 if(!credential||credential.expiresAt.getTime()<=Date.now())throw new ApiError(401,'TOKEN_EXPIRED','연결이 만료되었습니다. 다시 연결해 주세요.');
 const type=bearer?'extension':'session';
 const extensionMatches=origin?credential.origin===origin:credential.origin===`chrome-extension://${req.headers.get('x-cutling-extension-id')||''}`;
 if(credential.kind!==type||(type==='extension'&&!extensionMatches))throw new ApiError(403,'ORIGIN_REJECTED','연결된 확장 프로그램만 접근할 수 있습니다.');
 if(type==='session'&&origin&&!webOrigins().has(origin))throw new ApiError(403,'ORIGIN_REJECTED','웹 요청 출처를 확인할 수 없습니다.');
 return {ownerId:credential.ownerId,type,credential};
}
export async function bootstrap(req:NextRequest){
 if(req.headers.get('authorization')||isExtensionOrigin(req.headers.get('origin')||''))throw new ApiError(403,'WEB_ONLY','웹 서비스에서 연결을 시작해 주세요.');
 const existing=req.cookies.get('cutling_session')?.value;
 if(existing){const c=await db.credential.findUnique({where:{hash:hash(existing)}});if(c?.kind==='session'&&c.expiresAt.getTime()>Date.now())return {ownerId:c.ownerId};}
 const ownerId=id(),raw=token();await db.workspace.create({data:{id:ownerId}});
 await db.credential.create({data:{hash:hash(raw),kind:'session',ownerId,expiresAt:new Date(Date.now()+30*86400_000)}});return {ownerId,raw};
}
export async function consumePairCode(code:string,origin:string){
 if(!isExtensionOrigin(origin))throw new ApiError(403,'EXTENSION_ONLY','확장 프로그램 설정에서 연결 코드를 입력해 주세요.');
 const c=await db.credential.findUnique({where:{hash:hash(code.toUpperCase())}});
 if(!c||c.kind!=='code'||c.expiresAt.getTime()<=Date.now())throw new ApiError(400,'PAIR_CODE_INVALID','연결 코드가 만료되었거나 이미 사용되었습니다.');
 const raw=token(),expiresAt=new Date(Date.now()+30*86400_000);
 await db.$transaction(async tx=>{const result=await tx.credential.deleteMany({where:{hash:c.hash,kind:'code',expiresAt:{gt:new Date()}}});if(result.count!==1)throw new ApiError(400,'PAIR_CODE_USED','이미 사용된 연결 코드입니다.');await tx.credential.create({data:{hash:hash(raw),ownerId:c.ownerId,kind:'extension',origin,expiresAt}});});
 return {ownerId:c.ownerId,token:raw,expiresAt:expiresAt.toISOString()};
}
const rateBuckets=new Map<string,{count:number,until:number}>();
export function rateLimit(key:string,max=240){const stamp=Date.now();if(rateBuckets.size>2000){for(const [k,v]of rateBuckets)if(v.until<stamp)rateBuckets.delete(k);}const bucket=rateBuckets.get(key);if(!bucket||bucket.until<stamp){rateBuckets.set(key,{count:1,until:stamp+60000});return;}if(++bucket.count>max)throw new ApiError(429,'RATE_LIMIT','잠시 후 다시 시도해 주세요.',true);}
export async function readJson(req:NextRequest,limit=200_000){
 const length=Number(req.headers.get('content-length')||0);if(length>limit)throw new ApiError(413,'BODY_TOO_LARGE','요청이 너무 큽니다.');
 if(!req.body)return {};let size=0;const chunks:Uint8Array[]=[];const reader=req.body.getReader();
 while(true){const {value,done}=await reader.read();if(done)break;size+=value.length;if(size>limit){await reader.cancel();throw new ApiError(413,'BODY_TOO_LARGE','요청이 너무 큽니다.');}chunks.push(value);}
 try{return JSON.parse(Buffer.concat(chunks).toString('utf8')||'{}');}catch{throw new ApiError(400,'INVALID_JSON','올바른 JSON 요청이 필요합니다.');}
}
