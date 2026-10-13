// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import { captureNaverBlog, extractNaverResults, isOwnedMutation, queryFromNaver, safeSourceUrl, VersionGate } from '../src/index';

// This HTML is synthetic. It is not a captured or verified current Naver page.
const fixture = `<main><div data-testid="search-result"><a data-testid="result-title" href="https://docs.python.org/3/tutorial/?utm_source=naver">파이썬 공식 입문</a><p data-testid="result-snippet">기초 문법과 함수 예제로 파이썬을 학습해요.</p><time datetime="2025-03-05">2025.03.05</time></div><div class="total_wrap"><a class="title_link" href="https://example.com/course">딥러닝 부트캠프 수강 신청</a><span class="dsc_txt">모집 중인 교육 과정입니다.</span><span class="ad_mark">광고</span></div><div data-testid="search-result"><a data-testid="result-title" href="https://example.com/no-snippet">제목만 있는 자료</a></div><article class="unknown-layout"><a href="https://example.com/unknown">알 수 없는 레이아웃</a></article></main>`;
const parse=(html=fixture,url='https://search.naver.com/search.naver?query=파이썬')=>{const doc=new DOMParser().parseFromString(html,'text/html');Object.defineProperty(doc,'URL',{value:url});return doc;};
afterEach(()=>{document.body.replaceChildren();});
describe('synthetic Naver DOM adapter',()=>{
  it('extracts each observed Powerlink ad using the section marker even without per-card ad labels',()=>{
    const html=`<section><h2>딥러닝 관련 광고</h2><div id="power_link_body" class="nad_area"><ul class="lst_type"><li class="lst type_sublink"><div class="title_url_area"><a class="lnk_head" href="https://adcr.naver.com/adcr?x=1">딥러닝 국비지원 과정</a><a href="https://example.com">표시 주소</a></div><div class="desc_area"><a class="link_desc" href="https://adcr.naver.com/adcr?x=1">실습부터 취업까지 교육 과정 안내</a></div></li><li class="lst type_img"><div class="title_url_area"><a class="lnk_head" href="https://adcr.naver.com/adcr?x=2">딥러닝 강의</a></div><div class="desc_area"><a class="link_desc" href="https://adcr.naver.com/adcr?x=2">원하는 시간에 배우는 실무 수업</a></div></li></ul></div></section>`;
    const doc=parse(html);const result=extractNaverResults(doc,{visibleOnly:false});
    expect(result).toHaveLength(2);expect(result.every(item=>item.result.explicitAd)).toBe(true);
    expect(result[0]!.element.matches('li.lst')).toBe(true);expect(result[0]!.result.snippet).toBe('실습부터 취업까지 교육 과정 안내');
    expect(result[0]!.result.url).toBe('https://adcr.naver.com/adcr?x=1');expect(result[1]!.result.id).not.toBe(result[0]!.result.id);
  });
  it('supports observed SDS web-result structure without hash selectors or hidden AI source text',()=>{
    const html=readFileSync(resolve('packages/search-adapters/fixtures/naver-sds-2026-10.html'),'utf8');const result=extractNaverResults(parse(html),{visibleOnly:false});expect(result).toHaveLength(1);expect(result[0]!.result).toMatchObject({title:'합성 자료: 딥러닝 입문 공부 순서',url:'https://example.com/learning',publishedAt:'2026-07-03T00:00:00.000Z'});expect(result[0]!.result.snippet).toContain('파이썬 기초와 선형대수');expect(result[0]!.result.snippet).not.toContain('자동 설명');expect(result[0]!.result.title).not.toContain('새 창 열림');
  });
  it('extracts title, snippet, original link, absolute date and explicit ad separately',()=>{
    const result=extractNaverResults(parse(),{visibleOnly:false});expect(result).toHaveLength(3);
    expect(result[0]!.result).toMatchObject({title:'파이썬 공식 입문',snippet:'기초 문법과 함수 예제로 파이썬을 학습해요.',url:'https://docs.python.org/3/tutorial/?utm_source=naver',publishedAt:'2025-03-05T00:00:00.000Z',explicitAd:false});
    expect(result[1]!.result.explicitAd).toBe(true);expect(result[2]!.result.snippet).toBe('');expect(result[2]!.result.publishedAt).toBeNull();
  });
  it('skips unknown blocks, invalid schemes and owned nodes',()=>{
    const doc=parse(`${fixture}<div data-cutling-owned="panel"><div data-testid="search-result"><a data-testid="result-title" href="https://example.com/own">확장 링크</a></div></div><div data-testid="search-result"><a data-testid="result-title" href="javascript:alert(1)">나쁜 링크</a></div>`);
    expect(extractNaverResults(doc,{visibleOnly:false})).toHaveLength(3);
  });
  it('detects dynamic results and keeps stable identifiers without duplicating extraction',()=>{
    const doc=parse();const initial=extractNaverResults(doc,{visibleOnly:false});
    doc.body.insertAdjacentHTML('beforeend','<div class="total_wrap"><a class="title_link" href="https://example.com/added">스크롤 후 추가된 자료</a><p class="dsc_txt">추가된 학습 자료의 요약</p></div>');
    const updated=extractNaverResults(doc,{visibleOnly:false});expect(updated).toHaveLength(4);expect(updated[0]!.result.id).toBe(initial[0]!.result.id);
    expect(new Set(updated.map(r=>r.result.id)).size).toBe(4);expect(extractNaverResults(doc,{visibleOnly:false,limit:2})).toHaveLength(2);
  });
  it('keeps identical URL result blocks separately identifiable for duplicate badges',()=>{const block='<div class="total_wrap"><a class="title_link" href="https://example.com/same">같은 자료의 제목</a><p class="dsc_txt">같은 요약이 두 번 표시된 검색 결과</p></div>';const result=extractNaverResults(parse(block+block),{visibleOnly:false});expect(result).toHaveLength(2);expect(result[0]!.result.id).not.toBe(result[1]!.result.id);expect(result[0]!.result.url).toBe(result[1]!.result.url);});
  it('only includes visible records when visibility filtering is enabled',()=>{
    document.body.innerHTML=fixture;
    const visible=document.querySelector<HTMLElement>('[data-testid="search-result"]')!;
    visible.getBoundingClientRect=()=>({x:0,y:100,top:100,left:0,right:700,bottom:200,width:700,height:100,toJSON(){return {};}});
    expect(extractNaverResults(document)).toHaveLength(1);
  });
  it('ignores extension-owned mutations but catches actual appended results',async()=>{
    const records:MutationRecord[]=[];const observer=new MutationObserver(items=>records.push(...items));observer.observe(document.body,{childList:true,subtree:true});
    const owned=document.createElement('div');owned.dataset.cutlingOwned='result';document.body.append(owned);await Promise.resolve();
    expect(records.length).toBe(1);expect(isOwnedMutation(records[0]!)).toBe(true);
    const actual=document.createElement('article');document.body.append(actual);await Promise.resolve();expect(isOwnedMutation(records[1]!)).toBe(false);observer.disconnect();
  });
  it('never rewrites original source links',()=>{const doc=parse();const before=[...doc.querySelectorAll('a')].map(a=>a.getAttribute('href'));extractNaverResults(doc,{visibleOnly:false});expect([...doc.querySelectorAll('a')].map(a=>a.getAttribute('href'))).toEqual(before);});
});
describe('query, URL and stale response controls',()=>{
  it('decodes Naver query and rejects other origins',()=>{expect(queryFromNaver('https://search.naver.com/search.naver?query=%ED%8C%8C%EC%9D%B4%EC%8D%AC+%EA%B3%B5%EB%B6%80')).toBe('파이썬 공부');expect(queryFromNaver('https://evil.example/?query=test')).toBe('');});
  it('rejects script URLs and credential URLs',()=>{expect(safeSourceUrl('javascript:alert(1)','https://search.naver.com')).toBeNull();expect(safeSourceUrl('https://user:password@example.com','https://search.naver.com')).toBeNull();});
  it('rejects an old response after a new query/filter/intent version',()=>{const gate=new VersionGate();const first=gate.next();expect(gate.isCurrent(first)).toBe(true);const next=gate.next();expect(gate.isCurrent(first)).toBe(false);expect(gate.isCurrent(next)).toBe(true);});
});
describe('user-triggered Naver blog capture',()=>{
  it('caps a long article at the API limit and marks only actual truncation as partial',()=>{const doc=parse(`<article><p>${'가'.repeat(45000)}</p></article>`,'https://blog.naver.com/study/123');const result=captureNaverBlog(doc);expect(result?.text.length).toBe(40000);expect(result?.partial).toBe(true);const exact=parse(`<article><p>${'가'.repeat(40000)}</p></article>`,'https://blog.naver.com/study/124');expect(captureNaverBlog(exact)?.partial).toBe(false);});
  it('extracts supported article paragraphs and excludes comments or inserted controls',()=>{
    const doc=parse('<h1>공부 기록</h1><div class="se-main-container"><p>벡터와 행렬을 공부했습니다.</p><p>행렬 곱셈을 연습합니다.</p><div class="comment"><p>댓글은 제외</p></div><nav><p>메뉴</p></nav><div data-cutling-owned><p>확장 버튼</p></div></div>','https://blog.naver.com/study/123');
    expect(captureNaverBlog(doc)).toMatchObject({title:'공부 기록',text:'벡터와 행렬을 공부했습니다.\n\n행렬 곱셈을 연습합니다.',partial:false});
  });
  it('does not capture unsupported pages or unavailable body',()=>{expect(captureNaverBlog(parse('<article>본문</article>','https://example.com/a'))).toBeNull();expect(captureNaverBlog(parse('<div>로그인이 필요해요</div>','https://blog.naver.com/a'))).toBeNull();});
});
