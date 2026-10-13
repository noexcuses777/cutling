import { DEFAULT_FILTERS, INTENTS, type Assessment, type ClassificationContext, type IntentResult, type SearchResult } from './types';
import { normalizeText, normalizeUrl, parseVisibleDate } from './url';

/** Product hypotheses, not calibrated probabilities; adjust against the labelled fixture. */
export const ROUTING_THRESHOLDS = { relevanceLow: 0.35, relevanceHigh: 0.68, duplicateSimilarity: 0.94, versionAgeDays: 730, maxResults: 40, maxRefineResults: 12 } as const;
const topicPatterns: Array<[RegExp,string]> = [[/딥러닝|deep learning|신경망/i,'딥러닝'],[/머신러닝|machine learning/i,'머신러닝'],[/파이썬|python/i,'파이썬'],[/선형대수|행렬|벡터/i,'선형대수'],[/확률|통계/i,'확률·통계'],[/pytorch|파이토치/i,'PyTorch'],[/tensorflow|텐서플로/i,'TensorFlow'],[/\bAI\b|인공지능/i,'AI'],[/미분|기울기/i,'미분']];
export function extractConcepts(text: string): string[] { return topicPatterns.filter(([pattern]) => pattern.test(text)).map(([,name]) => name); }
// Prerequisites and common English aliases are relevant even when the exact query is absent.
const topicSupport: Record<string, RegExp> = {
  '딥러닝': /딥\s*러닝|deep\s*learning|신경망|neural|머신\s*러닝|machine\s*learning|파이썬|python|선형대수|linear\s*algebra|행렬|벡터|내적|노름|matrix|matrices|vector|미분|적분|calculus|derivative|확률|통계|probability|statistics|역전파|backpropagation|gradient|pytorch|파이토치|tensorflow|텐서플로|numpy|인공지능|\bAI\b|\bCNN\b|\bRNN\b|transformer|트랜스포머|퍼셉트론/i,
  '머신러닝': /머신\s*러닝|machine\s*learning|딥\s*러닝|deep\s*learning|신경망|파이썬|python|선형대수|linear\s*algebra|행렬|벡터|내적|matrix|matrices|vector|미분|calculus|derivative|확률|통계|probability|statistics|scikit|sklearn|회귀|분류|과적합|overfitting|인공지능|\bAI\b/i,
  '파이썬': /파이썬|python|numpy|pandas|django|flask|fastapi|파이토치|pytorch|tensorflow|주피터|jupyter/i,
  '선형대수': /선형\s*대수|linear\s*algebra|행렬|벡터|matrix|matrices|vector|고유값|eigen/i,
  '확률·통계': /확률|통계|probability|statistics|베이즈|bayes|정규분포|회귀/i,
  'PyTorch': /pytorch|파이토치|torch|tensor|텐서|딥러닝|신경망/i,
  'TensorFlow': /tensorflow|텐서플로|keras|케라스|tensor|텐서|딥러닝|신경망/i,
  'AI': /\bAI\b|인공지능|artificial\s*intelligence|딥러닝|머신러닝|신경망|deep\s*learning|machine\s*learning|llm|언어\s*모델/i,
  '미분': /미분|기울기|도함수|편미분|derivative|gradient|calculus/i,
};
function topicMatch(query: string, text: string): boolean | undefined {
  const concepts = extractConcepts(query);
  if (concepts.length) return concepts.some(concept => topicSupport[concept]?.test(text));
  const generic = /^(공부|공부법|방법|순서|자료|정보|추천|검색|무료|기초|입문|가이드|강의|학습|최신|설치|비교|후기|로드맵|알려줘)$/;
  const terms = (query.toLowerCase().match(/[\p{L}\p{N}+#.]+/gu) ?? []).filter(term => term.length >= 2 && !generic.test(term));
  if (!terms.length) return undefined;
  const normalized = text.toLowerCase().replace(/\s+/g, '');
  return terms.some(term => normalized.includes(term));
}
export function inferIntent(query: string): IntentResult {
  let intent: string = '입문 로드맵'; let confidence: IntentResult['confidence'] = 'low';
  const rules: Array<[RegExp,string]> = [[/부트캠프|국비.*비교|교육.*비교/,'부트캠프 비교'],[/취업.*후기|합격.*후기|비전공자.*취업/,'취업 후기'],[/설치|최신|api|버전/i,'최신 설치·API'],[/시험|자격증|대비/,'시험 대비'],[/무료|공짜|오픈.*강의/,'무료 강의·자료'],[/수학|선형대수|미분|확률/,'필요한 수학'],[/프로젝트|실습|만들기/,'실습 프로젝트'],[/순서|로드맵|독학|입문|공부법/,'입문 로드맵']];
  for (const [rule,label] of rules) if (rule.test(query)) { intent = label; confidence = 'medium'; break; }
  const concepts = extractConcepts(query);
  const supported = concepts.length > 0 || /개발|코딩|프로그래밍|자료구조|알고리즘/.test(query);
  return { intent, confidence, candidates: [intent, ...INTENTS.filter(value => value !== intent)].slice(0,5), concepts, supported, explanation: supported ? (confidence === 'low' ? '목적이 여러 가지일 수 있어요. 의도를 선택하기 전에는 강하게 가리지 않아요.' : '검색어의 학습 표현으로 제안한 목적이에요. 선택한 목적이 항상 우선해요.') : '현재는 IT·AI 학습 검색에 최적화되어 있어요. 목적을 직접 선택해 주세요.' };
}
export function cosineSimilarity(a: number[], b: number[]): number {
  if (!a.length || a.length !== b.length) return 0;
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) { const av = a[i]!, bv = b[i]!; if (!Number.isFinite(av) || !Number.isFinite(bv)) return 0; dot += av*bv; na += av*av; nb += bv*bv; }
  return na && nb ? dot / Math.sqrt(na*nb) : 0;
}
export function shouldRouteToReasoning(assessment: Assessment, similarity?: number, reevaluate = false): boolean {
  return reevaluate || assessment.reasonCodes.includes('rule_embedding_conflict') || (assessment.recommendedAction === 'review' && !assessment.reasonCodes.includes('insufficient_evidence')) || (similarity !== undefined && similarity > ROUTING_THRESHOLDS.relevanceLow && similarity < ROUTING_THRESHOLDS.relevanceHigh && assessment.commercialityLabel === 'possible_promotion');
}
export function classifyResults(results: SearchResult[], context: ClassificationContext): Assessment[] {
  const filters = {...DEFAULT_FILTERS,...context.filters};
  const inference = inferIntent(context.query);
  const intent = context.selectedIntent || inference.intent;
  const uncertainIntent = !context.selectedIntent && inference.confidence === 'low';
  const wantsCareer = /취업|합격|커리어/.test(intent);
  const wantsCommercial = /부트캠프|강의 비교|교육 비교|유료/.test(intent);
  const urls = new Set<string>(), texts = new Set<string>();
  return results.slice(0,ROUTING_THRESHOLDS.maxResults).map(result => {
    const text = `${result.title} ${result.snippet}`;
    const base: Assessment = { resultId: result.id, relevanceLabel: 'unknown', commercialityLabel: 'not_observed', duplicationLabel: 'unique', freshnessLabel: 'unknown', contentType: '기타', recommendedAction: 'neutral', reasonCodes: [], evidence: [], evidenceScope: result.snippet.trim() ? 'snippet' : 'title', confidenceLevel: 'medium', limitations: ['제목·검색 요약만 확인했어요. 원문 내용과 다를 수 있어요.'], classificationStage: 'rules' };
    const url = normalizeUrl(result.url), normalizedText = normalizeText(text);
    if (urls.has(url)) { base.duplicationLabel = 'same_url'; base.reasonCodes.push('same_url'); base.evidence.push('추적 파라미터를 제외한 URL이 동일해요.'); }
    else if (normalizedText.length > 30 && texts.has(normalizedText)) { base.duplicationLabel = 'same_text'; base.reasonCodes.push('same_text'); base.evidence.push('확보한 제목·검색 요약 텍스트가 같아요. 본문 복제 여부는 알 수 없어요.'); }
    urls.add(url); texts.add(normalizedText);
    const recruitment = /모집|수강\s*신청|등록\s*상담|선착순|수강료|상담\s*신청/.test(text);
    const commercialType = /부트캠프|국비지원|강의|수강|교육\s*과정/.test(text);
    const promotion = recruitment && commercialType;
    const career = /취업\s*(성공|후기)|합격\s*(후기|수기)|연봉|이직\s*성공/.test(text);
    const review = /솔직\s*후기|후기/.test(text);
    const educational = /개념|기초|입문|학습|공부|튜토리얼|실습|예제|가이드|설명|증명|로드맵|문법|tutorial|documentation/i.test(text);
    const match = topicMatch(context.query, text);
    const related = match === true || (match === undefined && educational);
    const offTopic = match === false && result.snippet.trim().length >= 24 && result.title.trim().length >= 5;
    let official = false;
    try { const host = new URL(result.url).hostname; official = ['docs.python.org','pytorch.org','www.tensorflow.org','tensorflow.org','numpy.org','pandas.pydata.org','scikit-learn.org'].includes(host); } catch { /* schema already guards */ }
    if (official) base.contentType = '공식 문서';
    else if (promotion && /부트캠프|국비/.test(text)) base.contentType = '부트캠프 모집';
    else if (promotion) base.contentType = '유료 강의 소개';
    else if (career) base.contentType = '취업 후기';
    else if (review) base.contentType = '개인 학습 후기';
    else if (/무료.*(강의|자료)|무료로/.test(text)) base.contentType = '무료 강의';
    else if (/로드맵|공부\s*순서/.test(text)) base.contentType = '학습 로드맵';
    else if (/설치|실습|튜토리얼|예제|tutorial/i.test(text)) base.contentType = '튜토리얼';
    else if (educational) base.contentType = '개념 설명';
    if (result.explicitAd) { base.commercialityLabel = 'explicit_ad'; base.reasonCodes.push('explicit_ad'); base.evidence.push('네이버 검색 결과의 명시적 광고 표시'); }
    else if (promotion) { base.commercialityLabel = 'possible_promotion'; base.reasonCodes.push('possible_promotion'); base.evidence.push(text.match(/.{0,20}(모집|수강\s*신청|등록\s*상담|선착순|수강료|상담\s*신청).{0,35}/)?.[0] ?? '모집 및 교육 과정 표현'); }
    if (related && (educational || wantsCommercial && commercialType || wantsCareer && career)) { base.relevanceLabel = 'relevant'; base.recommendedAction = 'recommend'; base.reasonCodes.push('relevant_learning_resource'); base.evidence.push(result.snippet.slice(0,180) || result.title); }
    else if (related) base.relevanceLabel = 'partial';
    else if (offTopic) { base.relevanceLabel = 'off_intent'; base.recommendedAction = 'deemphasize'; base.reasonCodes.push('off_topic'); base.evidence.push(`검색어 “${context.query}” 및 관련 학습 개념이 제목·요약에 나타나지 않아요.`, result.snippet.slice(0,180)); }
    if (promotion && !wantsCommercial && filters.lowerPromotions) { base.relevanceLabel = 'off_intent'; base.recommendedAction = result.explicitAd || /모집|수강\s*신청|등록\s*상담/.test(result.title) ? 'deemphasize' : 'review'; base.reasonCodes.push('recruitment_focus'); }
    else if (result.explicitAd && !wantsCommercial && filters.lowerPromotions) { base.recommendedAction = related ? 'review' : 'deemphasize'; }
    if (career && !wantsCareer && filters.lowerCareer) { base.relevanceLabel = 'off_intent'; base.recommendedAction = 'deemphasize'; base.reasonCodes.push('off_intent_career_story'); base.evidence.push('취업·합격·연봉 중심의 제목 또는 요약'); }
    if (review && !promotion && !career) { base.commercialityLabel = 'unknown'; base.limitations.push('후기라는 표현만으로 홍보 여부를 확정하지 않아요.'); if (base.recommendedAction === 'neutral') base.recommendedAction = 'review'; }
    const published = parseVisibleDate(result.publishedAt, context.now);
    const age = published ? ((context.now ?? new Date()).getTime()-published.getTime())/86400000 : null;
    const versionSensitive = /설치|api|버전|tensorflow\s*1|파이토치|pytorch|패키지|프레임워크/i.test(text);
    const foundational = /선형대수|벡터|행렬|미분|확률|정리|증명/.test(text) && !versionSensitive;
    if (foundational) base.freshnessLabel = 'foundational';
    else if (age !== null && age >= 0 && age < ROUTING_THRESHOLDS.versionAgeDays) base.freshnessLabel = 'recent';
    else if (versionSensitive && age !== null && age >= ROUTING_THRESHOLDS.versionAgeDays) {
      base.freshnessLabel = 'version_sensitive_old'; base.reasonCodes.push('version_sensitive_old'); base.evidence.push(`표시 날짜: ${result.publishedAt}`);
      if (filters.freshness !== 'off') base.recommendedAction = filters.freshness === 'strict' ? 'deemphasize' : 'review';
    }
    if (base.duplicationLabel !== 'unique' && filters.groupDuplicates) base.recommendedAction = 'deemphasize';
    if (text.trim().length < 20 || !result.snippet.trim()) { base.confidenceLevel = 'low'; base.reasonCodes.push('insufficient_evidence'); base.limitations.push('검색 요약이 부족해 본문 확인이 필요해요.'); if (!result.explicitAd && base.duplicationLabel === 'unique') base.recommendedAction = 'review'; }
    if (uncertainIntent) { base.reasonCodes.push('intent_uncertain'); if (base.recommendedAction === 'deemphasize' && base.duplicationLabel === 'unique' && !offTopic && !result.explicitAd) base.recommendedAction = 'review'; }
    if (filters.strength === 'gentle' && base.recommendedAction === 'deemphasize' && !result.explicitAd && base.duplicationLabel === 'unique') base.recommendedAction = 'review';
    // Advertising is an observed page marker, independent of inferred learning intent.
    if (result.explicitAd && filters.lowerPromotions) base.recommendedAction = 'deemphasize';
    base.reasonCodes = [...new Set(base.reasonCodes)];
    if (!base.reasonCodes.length) base.reasonCodes.push('insufficient_evidence');
    return base;
  });
}

/** Embeddings contribute similarity signals only; never prove advertising or copied text. */
export function applyEmbeddingSignals(assessments: Assessment[], vectors: number[][], goal: number[], filters = DEFAULT_FILTERS): Assessment[] {
  return assessments.map((assessment,index) => {
    const vector = vectors[index]; if (!vector) return assessment;
    const similarity = cosineSimilarity(goal,vector);
    const output = {...assessment, reasonCodes: [...assessment.reasonCodes], evidence: [...assessment.evidence], limitations: [...assessment.limitations], classificationStage: 'rules_embedding'};
    if ((similarity < ROUTING_THRESHOLDS.relevanceLow && assessment.relevanceLabel === 'relevant') || (similarity > ROUTING_THRESHOLDS.relevanceHigh && assessment.relevanceLabel === 'off_intent')) { output.recommendedAction = 'review'; output.reasonCodes.push('rule_embedding_conflict'); }
    if (assessment.duplicationLabel === 'unique') for (let j=0;j<index;j++) {
      if (cosineSimilarity(vector,vectors[j] ?? []) > ROUTING_THRESHOLDS.duplicateSimilarity) { output.duplicationLabel = 'semantic_overlap'; output.reasonCodes.push('semantic_overlap'); output.evidence.push('제목·검색 요약 임베딩에서 주제 중복 후보를 찾았어요.'); if (filters.groupDuplicates) output.recommendedAction = 'review'; break; }
    }
    if (assessment.commercialityLabel === 'explicit_ad' && filters.lowerPromotions) output.recommendedAction = 'deemphasize';
    return output;
  });
}
