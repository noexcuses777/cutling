import type { SearchResult } from '../packages/shared/src/index';
/** Entirely synthetic examples: example.org URLs are placeholders, never recommended live sources. */
export const FIXTURE_NOTICE = '합성 평가 데이터입니다. 실제 네이버 결과·실제 사용자 자료가 아닙니다.';
const result=(id:string,title:string,snippet:string,extra:Partial<SearchResult>={}):SearchResult=>({id,title,snippet,url:`https://example.org/learning/${id}`,explicitAd:false,position:Number(id.replace(/\D/g,''))||1,publishedAt:null,...extra});
export const demoResults:SearchResult[] = [
  result('r1','AI 부트캠프 수강 신청 모집','국비지원 AI 부트캠프 교육 과정. 등록 상담과 수강 신청을 받습니다.',{explicitAd:true}),
  result('r2','AI 부트캠프 모집 과정 안내','파이썬부터 딥러닝까지 교육 과정과 수강료, 모집 조건을 소개합니다.'),
  result('r3','딥러닝 유료 강의 수강 신청','유료 강의 소개와 수강료 안내, 선착순 수강 신청.'),
  result('r4','딥러닝 무료 공부 순서와 자료','파이썬 기초, 선형대수, 머신러닝 평가를 익힌 뒤 딥러닝 실습으로 연결합니다.'),
  result('r5','파이썬 독학 한 달 학습 후기','파이썬 문법과 함수 예제를 매일 실습하며 막혔던 점을 정리했습니다.'),
  result('r6','비전공자 AI 취업 성공 후기','AI 개발 직무 취업 후기. 포트폴리오를 준비하고 면접에서 경험을 설명했습니다.'),
  result('r7','The Python Tutorial','파이썬 자료형, 조건문, 함수와 모듈을 설명하는 공식 튜토리얼입니다.',{url:'https://docs.python.org/3/tutorial/'}),
  result('r8','선형대수 벡터와 행렬 기초','벡터의 선형 결합과 행렬 곱셈의 개념 및 증명을 설명합니다.',{publishedAt:'2014-03-11'}),
  result('r9','TensorFlow 1 설치법과 API 사용','TensorFlow 1.0 버전 패키지 설치와 API 예제를 설명합니다.',{publishedAt:'2018-05-01'}),
  result('r10','이것만 보면 끝! 파이썬 함수 개념','파이썬 함수의 매개변수, 반환값을 세 가지 예제로 차근차근 설명합니다.'),
  result('r11','AI 교육 솔직 후기','AI 교육 과정에서 개인적으로 느꼈던 점을 정리했습니다. 자세한 모집 조건은 확인되지 않았습니다.'),
  result('r12','딥러닝 무료 공부 순서와 자료','파이썬 기초, 선형대수, 머신러닝 평가를 익힌 뒤 딥러닝 실습으로 연결합니다.'),
  result('r13','딥러닝 학습 단계 정리','딥러닝에 필요한 선수 지식과 실습 순서를 소개합니다.',{url:'https://example.org/learning/r4?utm_source=naver&fbclid=synthetic'}),
  result('r14','머신러닝 과적합과 검증 데이터','머신러닝에서 과적합을 확인하고 검증 데이터를 나누는 개념을 설명합니다.'),
  result('r15','자료','',{}),
];
export const SEARCH_RESULTS = demoResults;
export const SYNTHETIC_RESULTS = demoResults;
export const demoText = '파이썬으로 데이터를 읽고 NumPy 배열을 다루는 것은 머신러닝 실습의 출발점입니다.\n\n선형대수의 벡터와 행렬은 데이터와 모델 연산을 표현하는 데 사용됩니다.\n\n학습 데이터와 검증 데이터를 나누면 모델의 과적합 여부를 살펴볼 수 있습니다.\n\n기초 개념을 익힌 뒤 작은 딥러닝 예제로 입력과 출력, 손실 함수를 확인해 보세요.';
export const labelledCases = [
  {query:'딥러닝 무료 공부 순서',intent:'무료 강의·자료',resultId:'r1',expectedAction:'deemphasize'},
  {query:'AI 부트캠프 비교',intent:'부트캠프 비교',resultId:'r1',expectedAction:'deemphasize'},
  {query:'비전공자 AI 취업 후기',intent:'취업 후기',resultId:'r6',expectedAction:'recommend'},
  {query:'선형대수 기초',intent:'필요한 수학',resultId:'r8',expectedAction:'recommend'},
  {query:'최신 TensorFlow 프레임워크 설치법',intent:'최신 설치·API',resultId:'r9',expectedAction:'review'},
  {query:'파이썬 독학',intent:'입문 로드맵',resultId:'r10',expectedAction:'recommend'},
] as const;
