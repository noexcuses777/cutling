// @vitest-environment jsdom
import { afterEach,describe,expect,it,vi } from 'vitest';
import { classifyResults,DEFAULT_FILTERS } from '@cutling/shared';
import { extractNaverResults } from '@cutling/search-adapters';
import { ResultDecoration } from '../src/result-ui';
import { validBackend,naverSearch } from '../src/common';
import { allowedApi,hasRecentVerification,senderCategory } from '../src/policy';
afterEach(()=>document.body.replaceChildren());
describe('extension message boundaries',()=>{
  it('uses only recent authenticated proof for fast bridge status, invalidated by token, server or expiry changes',()=>{
    const now=Date.now();const stored={token:'verified-test-token',backend:'http://localhost:3000',expiresAt:new Date(now+60000).toISOString()};
    const proof={token:stored.token,backend:stored.backend,checkedAt:now-1000};
    expect(hasRecentVerification(stored,proof,stored.backend,now)).toBe(true);
    expect(hasRecentVerification(stored,undefined,stored.backend,now)).toBe(false);
    expect(hasRecentVerification(stored,{...proof,checkedAt:now-30000},stored.backend,now)).toBe(false);
    expect(hasRecentVerification(stored,{...proof,token:'old-test-token'},stored.backend,now)).toBe(false);
    expect(hasRecentVerification(stored,proof,'https://other.example',now)).toBe(false);
    expect(hasRecentVerification({...stored,expiresAt:new Date(now-1).toISOString()},proof,stored.backend,now)).toBe(false);
    expect(hasRecentVerification({...stored,token:undefined},proof,stored.backend,now)).toBe(false);
  });
  it('accepts only exact configured origin top frame for web bridge',()=>{
    const classify=(url:string,frame=0)=>senderCategory(url,frame,'chrome-extension://test/','http://localhost:3000');
    expect(classify('http://localhost:3000/settings')).toBe('web');expect(classify('http://localhost:3001/settings')).toBe('denied');expect(classify('http://localhost:3000',1)).toBe('denied');expect(classify('http://localhost.evil.test:3000')).toBe('denied');expect(classify('https://search.naver.com/search.naver')).toBe('naver');expect(classify('https://search.naver.com.evil.test')).toBe('denied');
  });
  it('API proxy rejects arbitrary external paths, settings, admin and destructive methods',()=>{
    expect(allowedApi('/api/resources','POST')).toBe(true);for(const path of ['https://evil.example/api/resources','/api/../api/resources','/api/settings','/api/data','/api/extension/code'])expect(allowedApi(path,'POST')).toBe(false);expect(allowedApi('/api/projects/test','DELETE')).toBe(false);
  });
  it('only accepts a secure configured backend or default local origins',()=>{
    expect(validBackend('http://localhost:3000')).toBe('http://localhost:3000');expect(validBackend('https://study.example/')).toBe('https://study.example');for(const input of ['http://evil.example','http://localhost:3001','https://user:secret@study.example','https://study.example/path','https://study.example/?token=1'])expect(()=>validBackend(input)).toThrow();
  });
  it('opens an actual encoded Naver search URL',()=>{const url=new URL(naverSearch('딥러닝 & 공부 순서'));expect(url.hostname).toBe('search.naver.com');expect(url.searchParams.get('query')).toBe('딥러닝 & 공부 순서');});
});
describe('reversible result controls',()=>{
  it('actually collapses original content and restores exact display/filter priorities, links and node identity',()=>{
    document.body.innerHTML='<div data-testid="search-result" style="min-height:240px;padding-top:21px!important"><a data-testid="result-title" href="https://example.com/ad?keep=1" style="display:inline!important;filter:contrast(1.2)!important">딥러닝 강의</a><p data-testid="result-snippet">실무 딥러닝을 배우는 교육 과정입니다.</p><span data-ad="true">광고</span></div>';
    const record=extractNaverResults(document,{visibleOnly:false})[0]!;const title=record.titleElement;const originalLink=title.getAttribute('href');
    const assessment=classifyResults([record.result],{query:'딥러닝'})[0]!;const decoration=new ResultDecoration(record,{save:async()=>'',feedback:async()=>{},reveal:()=>{},less:async()=>{},canSave:()=>false});
    decoration.update(assessment,true,DEFAULT_FILTERS);
    expect(decoration.collapsed).toBe(true);expect(decoration.host.dataset.cutlingCollapsed).toBe('true');
    expect(title.style.display).toBe('none');expect(record.element.style.minHeight).toBe('0');expect(decoration.host.shadowRoot!.querySelector('.preview')?.textContent).toBe('딥러닝 강의');
    expect([...decoration.host.shadowRoot!.querySelectorAll('button')].some(button=>button.textContent==='자료 담기')).toBe(false);
    [...decoration.host.shadowRoot!.querySelectorAll('button')].find(button=>button.textContent==='다시 보기')!.click();
    expect(decoration.collapsed).toBe(false);expect(title.style.display).toBe('inline');expect(title.style.getPropertyPriority('display')).toBe('important');expect(title.style.filter).toBe('contrast(1.2)');expect(record.element.style.minHeight).toBe('240px');
    [...decoration.host.shadowRoot!.querySelectorAll('button')].find(button=>button.textContent==='다시 접기')!.click();expect(decoration.collapsed).toBe(true);
    decoration.update(assessment,false,DEFAULT_FILTERS);expect(title.style.display).toBe('inline');expect(record.element.style.paddingTop).toBe('21px');expect(record.element.style.getPropertyPriority('padding-top')).toBe('important');
    decoration.restore();expect(record.element.querySelector('a')).toBe(title);expect(title.getAttribute('href')).toBe(originalLink);expect(title.style.getPropertyPriority('filter')).toBe('important');
  });
  it('preserves pending and completed save state when async classification rerenders the controls',async()=>{
    document.body.innerHTML='<div data-testid="search-result"><a data-testid="result-title" href="https://example.com/study">파이썬 기초 문법</a><p data-testid="result-snippet">변수와 함수 학습 자료예요.</p></div>';
    const record=extractNaverResults(document,{visibleOnly:false})[0]!;const assessment=classifyResults([record.result],{query:'파이썬 입문'})[0]!;
    let completeSave!:(value:string)=>void;const save=vi.fn(()=>new Promise<string>(resolve=>{completeSave=resolve;}));
    const decoration=new ResultDecoration(record,{save,feedback:async()=>{},reveal:()=>{},less:async()=>{}});decoration.update(assessment,true,DEFAULT_FILTERS);
    const saveButton=()=>[...decoration.host.shadowRoot!.querySelectorAll('button')].find(b=>['자료 담기','담는 중…','담았어요'].includes(b.textContent??''))!;
    saveButton().click();decoration.update({...assessment,classificationStage:'refined'},true,DEFAULT_FILTERS);
    expect(saveButton().disabled).toBe(true);expect(saveButton().textContent).toBe('담는 중…');
    completeSave('자료를 담았어요.');await vi.waitFor(()=>expect(saveButton().textContent).toBe('담았어요'));
    decoration.update(assessment,true,DEFAULT_FILTERS);expect(saveButton().textContent).toBe('담았어요');expect(saveButton().disabled).toBe(true);expect(decoration.host.shadowRoot!.querySelector('[role="status"]')?.textContent).toBe('자료를 담았어요.');expect(save).toHaveBeenCalledTimes(1);
  });
  it('does not change links, duplicate controls or blur the reason controls, and restores styles on OFF',()=>{
    document.body.innerHTML='<div data-testid="search-result"><a data-testid="result-title" href="https://example.com/course?keep=1" style="filter:contrast(1.1)">딥러닝 부트캠프 수강 신청 모집</a><p data-testid="result-snippet">딥러닝 국비지원 교육 과정 상담 신청</p></div>';
    const record=extractNaverResults(document,{visibleOnly:false})[0]!;const href=record.titleElement.getAttribute('href');const callbacks={save:vi.fn(async()=> '담았어요'),feedback:vi.fn(async()=>{}),reveal:vi.fn(),less:vi.fn(async()=>{})};
    const decoration=new ResultDecoration(record,callbacks);const assessment=classifyResults([record.result],{query:'딥러닝 무료 공부 순서',selectedIntent:'입문 로드맵'})[0]!;
    decoration.update(assessment,true,DEFAULT_FILTERS);decoration.update(assessment,true,DEFAULT_FILTERS);
    expect(record.titleElement.style.filter).toContain('blur');expect(record.titleElement.getAttribute('href')).toBe(href);expect(document.querySelectorAll('[data-cutling-owned="result"]')).toHaveLength(1);expect(decoration.host.style.filter).toBe('');
    const reveal=[...decoration.host.shadowRoot!.querySelectorAll('button')].find(b=>b.textContent==='다시 보기')!;reveal.click();expect(record.titleElement.style.filter).toBe('contrast(1.1)');expect(callbacks.reveal).toHaveBeenCalledTimes(1);
    decoration.update(assessment,false,DEFAULT_FILTERS);expect(decoration.host.hidden).toBe(true);decoration.restore();expect(record.titleElement.getAttribute('href')).toBe(href);expect(record.titleElement.style.filter).toBe('contrast(1.1)');expect(document.querySelector('[data-cutling-owned="result"]')).toBeNull();
  });
  it('renders external evidence as text and never executes inserted HTML',()=>{
    document.body.innerHTML='<div data-testid="search-result"><a data-testid="result-title" href="https://example.com/study">파이썬 기초 문법</a><p data-testid="result-snippet">변수와 함수 학습 자료예요.</p></div>';
    const record=extractNaverResults(document,{visibleOnly:false})[0]!;const assessment=classifyResults([record.result],{query:'파이썬 입문'})[0]!;assessment.evidence=['<img src=x onerror=alert(1)>'];const decoration=new ResultDecoration(record,{save:async()=>'',feedback:async()=>{},reveal:()=>{},less:async()=>{}});decoration.update(assessment,true,DEFAULT_FILTERS);expect(decoration.host.shadowRoot!.querySelector('img')).toBeNull();expect(decoration.host.shadowRoot!.textContent).toContain('<img src=x onerror=alert(1)>');
  });
});
