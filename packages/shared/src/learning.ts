import { extractConcepts, inferIntent } from './classification';
import type { EvidenceScope, OrganizedNote, Paragraph, Project, Resource, Roadmap, RoadmapStage, Summary } from './types';
import { SummarySchema } from './types';

export function splitParagraphs(text: string, maxChars = 60000): Paragraph[] {
  return text.replace(/\r/g,'').slice(0,maxChars).split(/\n\s*\n|\n/).map(value => value.trim()).filter(Boolean).flatMap(value => value.length > 2000 ? value.match(/[\s\S]{1,2000}/g) ?? [] : [value]).map((value,index) => ({id:`p${index+1}`,text:value}));
}
/** Safe offline fallback: short source excerpts, never ungrounded generated claims. */
export function summarizeExtractive(text: string, evidenceScope: EvidenceScope = 'fulltext'): Summary {
  const paragraphs = splitParagraphs(text);
  const lines: string[] = []; const references: Summary['evidenceReferences'] = [];
  for (const paragraph of paragraphs) {
    const sentences = paragraph.text.split(/(?<=[.!?。]|다\.)\s+/).filter(value => value.trim().length > 10);
    for (const sentence of sentences) {
      const excerpt = sentence.trim().slice(0,180);
      if (lines.includes(excerpt)) continue;
      lines.push(excerpt); references.push({line:lines.length,paragraphIds:[paragraph.id]});
      if (lines.length === 3) break;
    }
    if (lines.length === 3) break;
  }
  const limitations = ['규칙 기반 발췌 요약이에요. 원문에 없는 설명은 추가하지 않았어요.'];
  if (text.trim().length < 40) { lines.length = 0; references.length = 0; limitations.push('확보한 텍스트가 너무 짧아 내용 요약을 만들지 않았어요.'); }
  const notices = ['요약할 근거가 충분하지 않아요. 원문을 열거나 본문을 붙여 넣어 주세요.', '확보한 내용만으로 추가 개념을 확인하기 어려워요.', '학습 순서에 활용하려면 본문 확인이 필요해요.'];
  while (lines.length < 3) lines.push(notices[lines.length]!);
  if (evidenceScope !== 'fulltext') limitations.push(evidenceScope === 'snippet' ? '본문을 확보하지 못해 검색 요약만 사용했어요.' : '제목만 확보했어요. 자료 내용 전체의 요약이 아니에요.');
  return SummarySchema.parse({summaryLines:lines,keyConcepts:extractConcepts(text),prerequisites:[],evidenceReferences:references,limitations,evidenceScope});
}
export function validateSummaryEvidence(summary: Summary, paragraphs: Paragraph[], scope?: EvidenceScope): Summary {
  const parsed = SummarySchema.parse(summary);
  const ids = new Set(paragraphs.map(item=>item.id));
  const lines = new Set<number>();
  for (const reference of parsed.evidenceReferences) { if (lines.has(reference.line) || !reference.paragraphIds.length || reference.paragraphIds.some(id => !ids.has(id))) throw new Error('INVALID_EVIDENCE_REFERENCE'); lines.add(reference.line); }
  if (paragraphs.length && [1,2,3].some(line => !lines.has(line))) throw new Error('MISSING_SUMMARY_EVIDENCE');
  if (scope && parsed.evidenceScope !== scope) throw new Error('EVIDENCE_SCOPE_MISMATCH');
  return parsed;
}
type PlanRow = [key:string,title:string,concepts:string[],objective:string];
function plan(project: Pick<Project,'initialQuery'|'selectedIntent'|'learningGoal'|'learningLevel'>): PlanRow[] {
  const query = `${project.initialQuery} ${project.learningGoal}`; const intent = project.selectedIntent || inferIntent(query).intent;
  if (/부트캠프/.test(intent)) return [['criteria','내 조건과 비교 기준',['학습 목표','시간','비용'],'예산·시간·선수 지식 조건을 정리해요.'],['curriculum','커리큘럼과 실습 비교',['커리큘럼','프로젝트'],'실제 교육 내용과 프로젝트 비중을 비교해요.'],['evidence','후기와 모집 조건 확인',['후기','수강료','환불'],'모집 정보와 독립적인 후기를 구분해 확인해요.']];
  if (/취업 후기/.test(intent)) return [['background','출발점과 경험 비교',['비전공자','학습 경험'],'글쓴이의 출발점과 내 조건을 비교해요.'],['skills','직무 역량과 준비 과정',['프로젝트','포트폴리오'],'채용 직무에 필요한 역량을 살펴봐요.'],['limitations','후기의 조건과 한계',['취업 후기','학습 계획'],'개인 사례를 일반화하지 않고 나의 계획을 정리해요.']];
  if (/설치|API/.test(intent)) return [['environment','환경과 버전 확인',['버전','운영체제'],'공식 지원 환경과 사용 버전을 확인해요.'],['install','설치와 기본 예제',['설치','예제'],'설치 후 가장 작은 예제를 실행해요.'],['verify','오류 해결과 검증',['오류','API'],'자주 발생하는 오류와 변경 사항을 확인해요.']];
  if (/선형대수/.test(query)) return [['vectors','벡터와 선형 결합',['벡터','선형 결합'],'벡터를 좌표와 연산으로 이해해요.'],['matrices','행렬과 선형 변환',['행렬','선형 변환'],'행렬 연산이 어떤 변환인지 설명해요.'],['application','고유값과 학습 연결',['고유값','차원 축소'],'고유값과 응용 사례를 연결해요.']];
  if (/파이썬|python/i.test(query) && !/딥러닝|머신러닝/.test(query)) return [['syntax','파이썬 기본 문법',['파이썬','자료형','조건문'],'짧은 프로그램을 읽고 작성해요.'],['functions','함수와 데이터 다루기',['함수','리스트','파일'],'반복 작업을 함수로 정리하고 데이터를 읽어요.'],['project','작은 자동화 프로젝트',['실습','자동화'],'일상 문제를 작은 프로그램으로 해결해요.']];
  if (/수학/.test(intent)) return [['linear','벡터와 행렬',['선형대수','벡터','행렬'],'데이터와 연산의 기본 표현을 익혀요.'],['calculus','미분과 기울기',['미분','기울기'],'함수 변화율과 최적화를 연결해요.'],['probability','확률과 통계',['확률','통계'],'데이터의 불확실성과 평가를 이해해요.']];
  let rows: PlanRow[] = [['python','파이썬과 데이터 기초',['파이썬','NumPy','Pandas'],'데이터를 읽고 배열 연산을 익혀요.'],['math','필요한 수학',['선형대수','미분','확률'],'모델 학습을 이해하는 수학 개념을 살펴봐요.'],['ml','머신러닝과 평가',['머신러닝','검증','과적합'],'학습·검증·테스트와 평가를 구분해요.'],['practice','신경망과 작은 실습',['딥러닝','PyTorch','실습'],'하나의 작은 모델을 구현하고 평가해요.']];
  if (/머신러닝/.test(query) && !/딥러닝/.test(query)) rows[3] = ['practice','머신러닝 실습 프로젝트',['머신러닝','scikit-learn','실습'],'작은 데이터로 기준 모델을 만들고 평가해요.'];
  if (/실습 경험/.test(project.learningLevel) || /실습 프로젝트/.test(intent)) rows = [rows[2]!,['design','문제 정의와 데이터 준비',['문제 정의','데이터'],'목표와 평가 기준을 정하고 데이터를 준비해요.'],rows[3]!];
  else if (/기초 지식/.test(project.learningLevel)) rows = rows.slice(1);
  if (/시험/.test(intent)) rows.push(['review','핵심 개념 복습과 문제 풀이',['복습','문제 풀이'],'개념을 설명하고 문제로 빈틈을 확인해요.']);
  if (!extractConcepts(query).length && !/개발|코딩|프로그래밍/.test(query)) rows = [['overview','주제의 핵심 개념 확인',[project.initialQuery],'검색 주제의 범위와 기본 용어를 확인해요.'],['sources','근거 자료 비교',[project.initialQuery,'입문'],'서로 다른 출처로 내용을 비교해요.'],['apply','질문 정리와 적용',[project.initialQuery,'예제'],'남은 질문을 정리하고 작은 사례에 적용해요.']];
  return rows;
}
export function createDraftRoadmap(project: Project): Roadmap {
  const rows = plan(project);
  const stages: RoadmapStage[] = rows.map(([key,title,concepts,objective],index) => ({ id: `${project.id}:${key}`, title, objective, explanation: '일반 학습 제안이에요. 자료를 담으면 출처와 함께 구체화돼요.', prerequisites: index ? rows[index-1]![2].slice(0,2) : [], concepts, resourceIds: [], missingTopics: [...concepts], nextQuery: `${concepts.slice(0,2).join(' ')} ${/무료/.test(project.selectedIntent) ? '무료 자료' : '입문'}`, completed: false, userMemo: '', status: 'draft' }));
  return {id:`roadmap:${project.id}`,projectId:project.id,version:1,status:'draft',generatedAt:new Date().toISOString(),changeSummary:'검색 목적 기반 초안 — 자료를 담으면 출처와 함께 구체화돼요.',stages};
}
export function updateRoadmap(project: Project, resources: Resource[], current?: Roadmap): Roadmap {
  const draft = createDraftRoadmap(project); const sourceIds = new Set(resources.map(item=>item.id));
  const stages = draft.stages.map(stage => {
    const previous = current?.stages.find(item=>item.id===stage.id);
    const linked = resources.filter(resource => {
      const text = `${resource.title} ${resource.summary?.keyConcepts.join(' ') ?? ''} ${resource.summary?.summaryLines.join(' ') ?? resource.snippet}`.toLowerCase();
      return stage.concepts.some(concept=>text.includes(concept.toLowerCase())) || resource.stageIds.includes(stage.id);
    });
    const covered = new Set(linked.flatMap(resource=>stage.concepts.filter(concept=>`${resource.title} ${resource.summary?.keyConcepts.join(' ')} ${resource.summary?.summaryLines.join(' ')}`.toLowerCase().includes(concept.toLowerCase()))));
    return {...stage, completed: previous?.completed ?? false, userMemo: previous?.userMemo ?? '', resourceIds: linked.map(item=>item.id), missingTopics: stage.concepts.filter(concept=>!covered.has(concept)), status: linked.length ? 'source_based' as const : 'draft' as const, explanation: linked.length ? '저장 자료의 제목·요약·핵심 개념을 이 단계와 연결했어요. 학습 순서는 일반 제안이에요.' : stage.explanation, connectionReason: linked.length ? `${linked.map(item=>item.title).join(', ')}의 확보된 내용에서 단계 개념을 찾았어요.` : undefined};
  });
  // Keep manual completion and notes even if an intent change removes their original stage.
  for (const previous of current?.stages ?? []) if (!stages.some(item=>item.id===previous.id) && (previous.completed || previous.userMemo)) stages.push({...previous,resourceIds:previous.resourceIds.filter(id=>sourceIds.has(id)),explanation:'목적 변경 전 단계예요. 완료 표시와 메모를 보존했어요.',connectionReason:previous.connectionReason});
  const count = new Set(stages.flatMap(stage=>stage.resourceIds)).size;
  const before = new Set(current?.stages.flatMap(stage=>stage.resourceIds) ?? []);
  const added = resources.filter(resource=>!before.has(resource.id));
  const removed = [...before].filter(id=>!sourceIds.has(id));
  return {...draft,version:(current?.version ?? 0)+1,status:count?'source_based':'draft',stages,changeSummary:added.length?`${added.length}개 자료를 검토해 관련 단계에 연결했어요. 연결되지 않은 자료는 아카이브에서 확인할 수 있어요.`:removed.length?`${removed.length}개 삭제된 자료의 출처 연결을 해제했어요. 완료 표시와 메모는 유지했어요.`:'현재 자료와 학습 목적을 기준으로 연결과 부족한 개념을 갱신했어요.'};
}
export function suggestNextQueries(roadmap: Roadmap, executed: string[] = [], questions: string[] = []) {
  const seen = new Set(executed.map(value=>value.trim().toLowerCase()));
  const suggestions = roadmap.stages.filter(stage=>!stage.completed && stage.missingTopics.length).map(stage=>({id:`suggest:${stage.id}`,query:`${stage.missingTopics.slice(0,2).join(' ')} 입문`,reason:`${stage.title} 단계에서 ${stage.missingTopics.slice(0,2).join(', ')} 자료가 부족해요.`,stageId:stage.id,intent:'부족한 개념 보완',status:seen.has(`${stage.missingTopics.slice(0,2).join(' ')} 입문`.toLowerCase())?'searched':'new'}));
  return [...questions.slice(0,3).map((query,index)=>({id:`question:${index}`,query,reason:'필기에서 남긴 질문을 확인해 보세요.',stageId:roadmap.stages[0]?.id ?? '',intent:'필기 질문 해결',status:seen.has(query.toLowerCase())?'searched':'new'})),...suggestions].sort((a,b)=>(a.status==='searched'?1:0)-(b.status==='searched'?1:0)).slice(0,8);
}
export function organizeNoteRules(text: string): OrganizedNote {
  const sentences = text.split(/\n|(?<=[.!?])\s+/).map(value=>value.trim()).filter(Boolean);
  const uncertain = sentences.filter(value=>/\?\?|[□�]|판독|불명확/.test(value));
  const questions = sentences.filter(value=>/\?|왜|어떻게|모르/.test(value) && !uncertain.includes(value));
  return {title:sentences[0]?.slice(0,80) || '직접 정리할 필기',confirmed:sentences.filter(value=>!uncertain.includes(value)&&!questions.includes(value)).slice(0,12),explanations:[],questions:questions.slice(0,10),uncertainParts:uncertain.length?uncertain.slice(0,10):['OCR의 글자·수식은 원본과 대조해 주세요. 규칙 정리는 사실 여부를 검증하지 않아요.'],nextQueries:questions.slice(0,5).map(value=>value.replace(/\?/g,'').slice(0,150))};
}
