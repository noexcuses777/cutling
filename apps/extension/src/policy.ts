export function senderCategory(url:string,frameId:number|undefined,extensionRoot:string,backend:string):'extension'|'naver'|'web'|'denied'{
  try{const parsed=new URL(url);if(url.startsWith(extensionRoot))return 'extension';if(parsed.protocol==='https:'&&['search.naver.com','blog.naver.com','m.blog.naver.com'].includes(parsed.hostname))return 'naver';if(parsed.origin===backend&&frameId===0)return 'web';}catch{}return 'denied';
}
export function allowedApi(path: unknown, method: unknown): path is string {
  if(typeof path!=='string'||typeof method!=='string'||path.includes('..')||path.includes('#')||path.includes('://'))return false;
  const routes: Record<string,RegExp[]>={GET:[/^\/api\/projects$/, /^\/api\/projects\/[\w-]+$/, /^\/api\/jobs\/[\w-]+$/, /^\/api\/search\/suggestions\?projectId=[\w-]+$/],POST:[/^\/api\/search\/sessions$/, /^\/api\/search\/intent$/, /^\/api\/search\/results\/analyze$/, /^\/api\/search\/results\/[\w-]+\/feedback$/, /^\/api\/resources$/, /^\/api\/events$/, /^\/api\/projects\/[\w-]+\/roadmap\/refresh$/],PATCH:[/^\/api\/projects\/[\w-]+$/]};
  return !!routes[method]?.some(r=>r.test(path));
}
export type VerifiedConnection = { token:string; backend:string; checkedAt:number };
/** A short-lived proof of a successful authenticated response, never merely a stored token. */
export function hasRecentVerification(stored:{token?:string;expiresAt?:string;backend?:string},proof:VerifiedConnection|undefined,backend:string,now=Date.now()):boolean {
  return !!stored.token&&!!stored.expiresAt&&Date.parse(stored.expiresAt)>now&&proof?.token===stored.token&&proof.backend===backend&&proof.checkedAt<=now&&now-proof.checkedAt<30_000;
}
