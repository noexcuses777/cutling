import {describe, expect, it} from 'vitest';
import {applyEmbeddingSignals, classifyResults, DEFAULT_FILTERS, type SearchResult} from '../src';

const result=(title:string,snippet:string,extra:Partial<SearchResult>={}):SearchResult=>({id:'r',title,snippet,url:'https://example.org/article',explicitAd:false,position:0,...extra});
const assess=(item:SearchResult,query='딥러닝')=>classifyResults([item],{query})[0]!;

describe('direct search filtering',()=>{
  it('folds a matching paid ad even without project intent or a full snippet',()=>{
    for(const snippet of ['', '딥러닝 신경망 기초 개념을 공부하는 학습 강의입니다.']) {
      const output=assess(result('딥러닝 강의',snippet,{explicitAd:true}));
      expect(output.commercialityLabel).toBe('explicit_ad');
      expect(output.recommendedAction).toBe('deemphasize');
    }
  });
  it('folds unrelated articles using the current query rather than an old project goal',()=>{
    const item=result('제주 여행 맛집과 숙소 후기','제주에서 다녀온 식당과 바닷가 숙소, 렌터카 이용 정보를 정리했습니다.');
    const output=classifyResults([item],{query:'딥러닝',learningGoal:'제주 여행 계획'})[0]!;
    expect(output.relevanceLabel).toBe('off_intent');
    expect(output.reasonCodes).toContain('off_topic');
    expect(output.recommendedAction).toBe('deemphasize');
  });
  it.each([
    ['딥러닝 개념 정리','딥러닝 모델의 구조와 신경망 학습 과정을 예제로 설명합니다.'],
    ['Backpropagation explained','A tutorial explaining gradient descent and the chain rule in neural networks.'],
    ['행렬 곱셈 기초','벡터와 행렬의 곱셈 원리를 차근차근 정리한 선형대수 입문 자료입니다.'],
    ['PyTorch Tutorial','Learn how to build a neural network with tensors and automatic differentiation.'],
    ['벡터와 내적의 기초 개념','벡터 공간에서 내적과 노름의 정의를 설명하고 직교 기저의 성질을 예제로 공부합니다.'],
    ['Matrix multiplication tutorial','This lesson explains how to multiply matrices with worked examples and exercises.'],
    ['Calculus derivatives tutorial','An introduction to derivatives and the chain rule with explanations and examples.'],
  ])('keeps relevant or prerequisite material: %s',(title,snippet)=>{
    expect(assess(result(title,snippet)).recommendedAction).not.toBe('deemphasize');
  });
  it('does not infer unrelated content from an empty or very short snippet',()=>{
    expect(assess(result('새로운 이야기','')).recommendedAction).toBe('review');
    expect(assess(result('오늘의 새 소식','소식입니다.')).recommendedAction).not.toBe('deemphasize');
  });
  it('compares specific topics beyond the fixed concept dictionary',()=>{
    expect(assess(result('리액트 useEffect 사용법','리액트에서 상태에 따라 부수 효과를 처리하는 useEffect 예제를 정리합니다.'),'리액트').recommendedAction).not.toBe('deemphasize');
    expect(assess(result('주말 부산 맛집 방문','주말에 방문한 부산의 맛집과 카페, 숙소 정보를 자세하게 기록했습니다.'),'리액트').recommendedAction).toBe('deemphasize');
  });
  it('keeps generic queries open and respects a gentle filter',()=>{
    const item=result('주말 부산 맛집 방문','주말에 방문한 부산의 맛집과 카페, 숙소 정보를 자세하게 기록했습니다.');
    expect(assess(item,'추천').recommendedAction).not.toBe('deemphasize');
    expect(classifyResults([item],{query:'딥러닝',filters:{strength:'gentle'}})[0]?.recommendedAction).toBe('review');
  });
  it('does not let embedding conflict unfold an observed ad',()=>{
    const baseline=assess(result('딥러닝 학습 강의','딥러닝 신경망 기초 개념을 공부하는 학습 강의입니다.',{explicitAd:true}));
    expect(applyEmbeddingSignals([baseline],[[1,0]],[0,1],DEFAULT_FILTERS)[0]?.recommendedAction).toBe('deemphasize');
  });
});
