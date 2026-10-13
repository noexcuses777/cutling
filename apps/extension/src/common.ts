import type { FilterSettings, Project } from '@cutling/shared';
export const DEFAULT_BACKEND = 'http://localhost:3000';
export type TabContext = { projectId: string; sessionId?: string; query?: string };
export type ExtensionState = { connected: boolean; backend: string; expiresAt?: string; enabled: boolean; projects: Project[]; context?: TabContext; error?: string; alwaysDomains?:string[]; localFilters?:FilterSettings };
export function validBackend(value: string): string {
  const u = new URL(value);
  if (u.username || u.password || u.search || u.hash || u.pathname !== '/') throw new Error('서버의 기본 주소만 입력해 주세요.');
  if (u.protocol !== 'https:' && !['http://localhost:3000', 'http://127.0.0.1:3000'].includes(u.origin)) throw new Error('HTTPS 주소 또는 기본 로컬 서버 주소를 사용해 주세요.');
  return u.origin;
}
export const naverSearch = (query: string) => `https://search.naver.com/search.naver?query=${encodeURIComponent(query.slice(0,300))}`;
export const supportedUrl = (value: string) => {try {const u=new URL(value);return u.protocol==='https:' && ['search.naver.com','blog.naver.com','m.blog.naver.com'].includes(u.hostname);}catch{return false;}};
export async function rpc<T = unknown>(type: string, payload: Record<string,unknown> = {}): Promise<T> {
  let timeout:ReturnType<typeof setTimeout>|undefined;
  const response=await Promise.race([chrome.runtime.sendMessage({type,payload}),new Promise<never>((_,reject)=>{timeout=setTimeout(()=>reject(new Error('확장 프로그램의 응답이 지연되고 있어요. 확장 프로그램을 새로고침한 뒤 다시 시도해 주세요.')),22000);})]).finally(()=>{if(timeout)clearTimeout(timeout);});
  if (!response?.ok) throw new Error(response?.error ?? '확장 프로그램 연결이 끊겼어요. 페이지를 새로고침해 주세요.');
  return response.data as T;
}
export function node<K extends keyof HTMLElementTagNameMap>(tag: K, text?: string, attrs: Record<string,string> = {}): HTMLElementTagNameMap[K] {
  const element=document.createElement(tag);if(text!==undefined)element.textContent=text;for(const [k,v]of Object.entries(attrs))element.setAttribute(k,v);return element;
}
export function button(text: string, action: () => void | Promise<void>, className = ''): HTMLButtonElement {
  const b=node('button',text,{type:'button',class:className});b.addEventListener('click',()=>void action());return b;
}
