import { test, expect, chromium, type BrowserContext } from '@playwright/test';
import path from 'node:path';

/** Local integration only: this page is synthetic and intercepted, NOT live Naver. */
const fixture=`<!doctype html><html lang="ko"><head><meta charset="utf-8"><title>Cutling 합성 검색 fixture</title><style>body{font-family:system-ui;margin:30px;background:#fff}main{width:760px}.card{padding:24px;border:1px solid #ddd;margin:18px 0;min-height:160px}a{font-size:22px}p{line-height:1.6}</style></head><body><main><h1>합성 검색 fixture · 실제 네이버 결과 아님</h1><div class="card" data-testid="search-result" id="promotion"><a data-testid="result-title" href="https://example.com/cutling-promo?campaign=test">파이썬 부트캠프 수강 신청 모집</a><p data-testid="result-snippet">파이썬 입문 국비지원 교육 과정. 선착순 모집, 수강 신청과 상담 안내.</p><span data-ad="true">광고</span></div><div class="card" data-testid="search-result" id="learning"><a data-testid="result-title" href="https://docs.python.org/3/tutorial/">파이썬 기초 문법 공식 튜토리얼</a><p data-testid="result-snippet">파이썬 변수와 함수, 조건문과 반복문의 기초를 예제로 공부하는 공식 튜토리얼입니다.</p></div></main></body></html>`;
const base='http://127.0.0.1:3000';

test('MV3 extension pairs, analyzes synthetic search, restores controls and shares saved data',async({},testInfo)=>{
  test.setTimeout(150_000);
  const extensionPath=path.resolve('apps/extension/dist');
  let context:BrowserContext|undefined;
  let createdProjectId:string|undefined;
  try{
    // A short temporary profile avoids Windows long-path failures in Chrome's
    // Local Extension Settings store underneath deeply nested test output paths.
    context=await chromium.launchPersistentContext('',{channel:'chromium',headless:true,viewport:{width:1600,height:1100},args:[`--disable-extensions-except=${extensionPath}`,`--load-extension=${extensionPath}`]});
    context.setDefaultTimeout(15000);context.setDefaultNavigationTimeout(20000);
    const worker=context.serviceWorkers()[0]??await context.waitForEvent('serviceworker');
    await worker.evaluate(()=>chrome.runtime.id);
    await worker.evaluate(()=>{(globalThis as any).__cutlingBridgeEvents=[];chrome.runtime.onMessage.addListener((message,sender)=>{if(message.type==='CONNECT_STATUS')(globalThis as any).__cutlingBridgeEvents.push({type:message.type,source:sender.url,time:Date.now()});});});
    const extensionId=new URL(worker.url()).host;
    await context.route('https://search.naver.com/**',route=>route.fulfill({status:200,contentType:'text/html; charset=utf-8',body:fixture}));
    const boot=await context.request.get(`${base}/api/bootstrap`);expect(boot.ok()).toBe(true);
    const headers={Origin:base};
    const created=await context.request.post(`${base}/api/projects`,{headers,data:{title:'확장 통합 테스트 · 합성 자료',query:'파이썬 입문',learningGoal:'파이썬 기초 문법을 공부하기',selectedIntent:'입문 로드맵',mode:'rules'}});
    expect(created.ok()).toBe(true);const {project}=await created.json();createdProjectId=project.id;
    const codeResponse=await context.request.post(`${base}/api/extension/code`,{headers,data:{}});expect(codeResponse.ok()).toBe(true);const {code}=await codeResponse.json();
    const options=await context.newPage();await options.goto(`chrome-extension://${extensionId}/options.html`);
    await options.getByText('서버 주소 변경',{exact:true}).click();
    await options.getByLabel('웹 서버 주소').fill(base);await options.getByRole('button',{name:'서버 주소 저장'}).click();
    await expect(options.getByRole('status')).toContainText('서버 주소를 저장했어요');
    await options.getByLabel('일회용 연결 코드').fill(code);await options.getByRole('button',{name:'연결하기',exact:true}).click();
    await expect(options.getByRole('status')).toContainText('연결했어요');
    const popup=await context.newPage();await popup.goto(`chrome-extension://${extensionId}/popup.html`);
    await expect(popup.getByRole('status')).toContainText('연결됨');await expect(popup.getByRole('combobox',{name:'현재 프로젝트'})).toHaveValue(project.id);await popup.close();
    // Exercise the real webpage bridge and service worker tab mapping.
    const web=await context.newPage();
    await web.addInitScript(()=>{(globalThis as any).__cutlingBridgeEvents=[];window.addEventListener('message',event=>{if(event.data?.type==='CONNECT_STATUS'&&['cutling-web','cutling-extension'].includes(event.data?.source))(globalThis as any).__cutlingBridgeEvents.push({source:event.data.source,id:event.data.requestId,connected:event.data.payload?.connected,error:event.data.payload?.error,time:Date.now()});});});
    await web.goto(base);await web.bringToFront();
    try{await expect(web.getByText('자료 저장까지 연결되어 있어요',{exact:true})).toBeVisible();}catch(error){const diagnostic={page:await web.evaluate(()=>(globalThis as any).__cutlingBridgeEvents),worker:await worker.evaluate(()=>(globalThis as any).__cutlingBridgeEvents)};console.log('Bridge diagnostic',JSON.stringify(diagnostic));await testInfo.attach('bridge-events',{body:JSON.stringify(diagnostic,null,2),contentType:'application/json'});throw error;}
    await expect.poll(async()=>web.evaluate(async()=>new Promise<boolean>(resolve=>{const requestId=crypto.randomUUID();const listener=(event:MessageEvent)=>{if(event.source===window&&event.data?.source==='cutling-extension'&&event.data.requestId===requestId){window.removeEventListener('message',listener);resolve(event.data.payload?.connected===true);}};window.addEventListener('message',listener);window.postMessage({source:'cutling-web',type:'CONNECT_STATUS',requestId,payload:{}},location.origin);setTimeout(()=>{window.removeEventListener('message',listener);resolve(false);},5000);}))).toBe(true);
    const newSearch=context.waitForEvent('page');
    const opened=await web.evaluate(({projectId})=>new Promise<{opened?:boolean;error?:string}>(resolve=>{
      const requestId=crypto.randomUUID();
      const listener=(event:MessageEvent)=>{if(event.source===window&&event.data?.source==='cutling-extension'&&event.data.requestId===requestId){window.removeEventListener('message',listener);clearTimeout(timeout);resolve(event.data.payload);}};
      const timeout=setTimeout(()=>{window.removeEventListener('message',listener);resolve({error:'Search bridge acknowledgement timed out'});},20000);
      window.addEventListener('message',listener);
      window.postMessage({source:'cutling-web',type:'OPEN_NAVER_SEARCH',requestId,payload:{projectId,query:'파이썬 입문'}},location.origin);
    }),{projectId:project.id});
    expect(opened,JSON.stringify({opened,pages:context.pages().map(page=>page.url())})).toEqual({opened:true});
    const search=await newSearch;await search.waitForURL('https://search.naver.com/**');
    await expect(search.getByRole('heading',{name:'합성 검색 fixture · 실제 네이버 결과 아님'})).toBeVisible();
    await expect(search.locator('[data-cutling-owned="result"]')).toHaveCount(2);
    const promo=search.locator('#promotion');const original=await promo.locator('a').getAttribute('href');
    await expect(promo.locator('a')).toHaveCSS('filter',/blur/);
    await promo.getByRole('button',{name:'다시 보기',exact:true}).click();await expect(promo.locator('a')).toHaveCSS('filter','none');expect(await promo.locator('a').getAttribute('href')).toBe(original);
    const panel=search.locator('[data-cutling-owned="panel"]');
    if(!await panel.getByLabel('필터 켜기',{exact:true}).isVisible())await panel.getByRole('button',{expanded:false}).click();
    await panel.locator('summary').filter({hasText:/^자료 저장/}).click();
    await expect(panel.getByRole('combobox',{name:'연결할 학습 프로젝트'})).toHaveValue(project.id);
    await panel.getByLabel('필터 켜기').uncheck();await expect(search.locator('[data-cutling-owned="result"]')).toHaveCount(0);await expect(promo.locator('a')).toHaveCSS('filter','none');
    await panel.getByLabel('필터 켜기').check();await expect(search.locator('[data-cutling-owned="result"]')).toHaveCount(2);
    await search.locator('#learning').getByRole('button',{name:'자료 담기',exact:true}).click();
    await expect(search.locator('#learning').getByRole('button',{name:'담았어요',exact:true})).toBeVisible();
    await expect.poll(async()=>{const response=await context!.request.get(`${base}/api/resources?projectId=${project.id}`);return (await response.json()).resources.length;}).toBe(1);
    const saved=(await(await context.request.get(`${base}/api/resources?projectId=${project.id}`)).json()).resources[0];expect(saved.url).toBe('https://docs.python.org/3/tutorial/');expect(saved.snippet).toContain('변수와 함수');
    // Later DOM additions are handled once, and source links remain intact.
    await search.evaluate(()=>{document.querySelector('main')!.insertAdjacentHTML('beforeend','<div class="card" data-testid="search-result" id="dynamic"><a data-testid="result-title" href="https://example.com/dynamic">파이썬 함수 기초 예제</a><p data-testid="result-snippet">함수 정의와 반환값을 학습하는 파이썬 입문 자료입니다.</p></div>');});
    await search.locator('#dynamic').scrollIntoViewIfNeeded();await expect(search.locator('#dynamic [data-cutling-owned="result"]')).toHaveCount(1);
    await search.screenshot({path:testInfo.outputPath('synthetic-extension.png'),fullPage:true});
    await testInfo.attach('synthetic-extension',{path:testInfo.outputPath('synthetic-extension.png'),contentType:'image/png'});
  }finally{if(context){if(createdProjectId)await context.request.delete(`${base}/api/projects/${createdProjectId}`,{headers:{Origin:base}}).catch(()=>{});await context.request.post(`${base}/api/extension/revoke`,{headers:{Origin:base},data:{}}).catch(()=>{});}await context?.close();}
});
