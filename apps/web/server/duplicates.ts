import {normalizeUrl,normalizeText,type Assessment,type SearchResult,type FilterSettings} from '@cutling/shared';
/** Persisted previous batches and saved URLs contribute exact-match duplicate signals. */
export function withDuplicateHistory(assessments:Assessment[],results:SearchResult[],history:Array<{url:string,title:string,snippet:string}>,filters:FilterSettings){
 const urls=new Set(history.filter(r=>r.url).map(r=>normalizeUrl(r.url)));const texts=new Set(history.map(r=>normalizeText(`${r.title} ${r.snippet}`)).filter(t=>t.length>30));
 return assessments.map(a=>{const r=results.find(r=>r.id===a.resultId);if(!r)return a;const sameUrl=urls.has(normalizeUrl(r.url));const sameText=texts.has(normalizeText(`${r.title} ${r.snippet}`));if(!sameUrl&&!sameText)return a;const label=sameUrl?'same_url':'same_text';return {...a,duplicationLabel:label as 'same_url'|'same_text',recommendedAction:filters.groupDuplicates?'deemphasize' as const:a.recommendedAction,reasonCodes:[...new Set([...a.reasonCodes,label])],evidence:[...a.evidence,'이 프로젝트에서 이미 본 결과 또는 저장 자료와 주소/검색 텍스트가 같아요. 본문 복제를 판단한 것은 아니에요.']};});
}
