import {classifyResults} from '../packages/shared/src/index';
import {demoResults,labelledCases} from '../fixtures/search-results';
const results=labelledCases.map(c=>{const r=demoResults.find(v=>v.id===c.resultId)!;const start=performance.now();const actual=classifyResults([r],{query:c.query,selectedIntent:c.intent})[0];return {...c,actual:actual.recommendedAction,passed:actual.recommendedAction===c.expectedAction,latencyMs:performance.now()-start};});
console.log(JSON.stringify({dataset:'synthetic-v1',scope:'규칙 기반 소규모 합성 fixture 평가',samples:results.length,passed:results.filter(r=>r.passed).length,results,paidCalls:0,costComparison:{status:'unavailable',savingsPercent:null}},null,2));
if(results.some(r=>!r.passed))process.exitCode=1;
