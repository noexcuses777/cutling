import {classifyResults} from '@cutling/shared';
import {demoResults,labelledCases} from '../../../fixtures/search-results';
export const DEMO_RESULTS=demoResults;
export function runBenchmark(){
 const latencies:number[]=[];let matched=0;const cases=labelledCases.map(test=>{const result=demoResults.find(r=>r.id===test.resultId)!;const start=performance.now();const assessment=classifyResults([result],{query:test.query,selectedIntent:test.intent})[0];latencies.push(performance.now()-start);const pass=assessment.recommendedAction===test.expectedAction;if(pass)matched++;return {...test,actualAction:assessment.recommendedAction,pass};});latencies.sort((a,b)=>a-b);
 return {status:'completed',datasetVersion:'synthetic-v1',comparisonScope:'rules_fixture_quality_only',qualityMetrics:{samples:cases.length,matched,matchRatio:cases.length?matched/cases.length:null,cases},usageMetrics:{modelCalls:0,meanLatencyMs:latencies.reduce((a,b)=>a+b,0)/Math.max(latencies.length,1),p95LatencyMs:latencies[Math.floor(latencies.length*.95)]||0},comparison:{status:'unavailable',savingsPercent:null},message:'합성 소규모 규칙 평가입니다. 실제 네이버 전체 정확도나 유료 모델 대비 절감률을 의미하지 않습니다.'};
}
