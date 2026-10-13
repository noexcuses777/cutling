import type { ModelCallLog } from './types';

export interface Price { inputPerMillion: number; outputPerMillion: number; currency?: string }
export function calculateCost(usage: {inputTokens:number|null;outputTokens:number|null;cacheHit?:boolean}, price?: Price|null): number|null {
  if (usage.cacheHit) return 0;
  if (!price || usage.inputTokens === null || usage.outputTokens === null || !Number.isFinite(price.inputPerMillion) || !Number.isFinite(price.outputPerMillion) || price.inputPerMillion < 0 || price.outputPerMillion < 0) return null;
  return (Math.max(0,usage.inputTokens)*price.inputPerMillion+Math.max(0,usage.outputTokens)*price.outputPerMillion)/1_000_000;
}
export function costReduction(baselineCost?: number|null,actualCost?: number|null): number|null { return baselineCost == null || actualCost == null || !Number.isFinite(baselineCost) || !Number.isFinite(actualCost) || baselineCost<=0 ? null : (baselineCost-actualCost)/baselineCost*100; }
export function estimateTime(input: {deemphasized?:number;duplicates?:number;revealed?:number;summarized?:number;deemphasizedIds?:string[];duplicateIds?:string[];revealedIds?:string[];reviewSeconds?:number;organizeSeconds?:number}) {
  const reviewSeconds=Math.max(0,input.reviewSeconds??45),organizeSeconds=Math.max(0,input.organizeSeconds??180);
  const hasIds=!!(input.deemphasizedIds||input.duplicateIds); const hidden=new Set([...(input.deemphasizedIds??[]),...(input.duplicateIds??[])]);
  for (const id of input.revealedIds??[]) hidden.delete(id);
  // Counts alone cannot identify overlap: use the larger group, never their sum.
  const avoided=hasIds?hidden.size:Math.max(0,Math.max(input.deemphasized??0,input.duplicates??0)-(input.revealed??0));
  return {searchSeconds:avoided*reviewSeconds,organizationSeconds:Math.max(0,input.summarized??0)*organizeSeconds,assumptions:[`결과 검토 ${reviewSeconds}초/건, 자료 정리 ${organizeSeconds}초/건이라는 제품 가정이에요. 실제 측정 시간이 아니에요.`,'다시 펼친 결과를 제외하며, 중복 후보와 주목도를 낮춘 결과를 중복 합산하지 않아요.']};
}
export function aggregateUsage(logs: ModelCallLog[]) {
  const calls=logs.filter(item=>!item.cacheHit),cacheHits=logs.filter(item=>item.cacheHit).length;
  return {calls:calls.length,inputTokens:calls.reduce((sum,item)=>sum+(item.inputTokens??0),0),outputTokens:calls.reduce((sum,item)=>sum+(item.outputTokens??0),0),unavailableUsageCalls:calls.filter(item=>item.usageSource==='unavailable').length,cacheHits,cacheHitRate:logs.length?cacheHits/logs.length:0,reasoningRatio:calls.length?calls.filter(item=>item.role==='reasoning').length/calls.length:0,embeddingInputCount:calls.filter(item=>item.role==='embedding').reduce((sum,item)=>sum+(item.inputCount??0),0)};
}
export function benchmarkComparison(baseline?:number|null,actual?:number|null,measured=false) { const savingsPercent=costReduction(baseline,actual); return {status:savingsPercent===null?'unavailable' as const:measured?'measured' as const:'estimated' as const,savingsPercent}; }
