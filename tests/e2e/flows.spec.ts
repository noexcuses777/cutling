import {test,expect} from '@playwright/test';
test('persistent project → classifications → resource → cited summary → roadmap → notes → report → delete',async({page,request})=>{
 await page.goto('/');await expect(page.getByRole('heading').first()).toBeVisible();
 const api=page.request;await api.get('/api/bootstrap');
 const created=await api.post('/api/projects',{data:{query:'선형대수 공부 방법',selectedIntent:'필요한 수학',mode:'rules'}});expect(created.status()).toBe(201);const {project}=await created.json();
 const sessionResponse=await api.post('/api/search/sessions',{data:{projectId:project.id,query:project.initialQuery}});const {session,searchUrl}=await sessionResponse.json();expect(new URL(searchUrl).hostname).toBe('search.naver.com');
 const classified=await api.post('/api/search/results/analyze',{data:{projectId:project.id,sessionId:session.id,query:project.initialQuery,results:[{id:'math',title:'선형대수 벡터와 행렬 기초',snippet:'벡터의 선형 결합과 행렬의 곱을 설명하는 개념 자료입니다.',url:'https://example.com/math',publishedAt:'2008-01-01',explicitAd:false,position:0},{id:'ad',title:'AI 부트캠프 수강생 모집',snippet:'수강 신청과 취업 지원 혜택, 국비 지원 교육.',url:'https://example.com/ad',explicitAd:true,position:1}]}});expect(classified.ok()).toBe(true);const analysis=await classified.json();expect(analysis.assessments.find((a:any)=>a.resultId==='math').recommendedAction).not.toBe('deemphasize');
 const source='벡터는 크기와 방향을 갖는 양입니다.\n행렬은 선형 변환을 표현하며 벡터 연산에 사용됩니다.\n고유값은 선형 변환의 성질을 이해하는 데 사용됩니다.';
 const saved=await api.post('/api/resources',{data:{projectId:project.id,title:'내 선형대수 학습 자료',text:source}});expect(saved.status()).toBe(201);const {resource,jobId}=await saved.json();
 await expect.poll(async()=>((await (await api.get(`/api/jobs/${jobId}`)).json()).job.status),{timeout:30000}).toBe('completed');
 const loaded=(await (await api.get(`/api/resources/${resource.id}`)).json()).resource;expect(loaded.summary.summaryLines).toHaveLength(3);expect(loaded.summary.evidenceReferences.length).toBeGreaterThan(0);
 const refreshed=(await (await api.post(`/api/projects/${project.id}/roadmap/refresh`,{data:{}})).json()).roadmap;expect(refreshed.stages.some((s:any)=>s.resourceIds.includes(resource.id))).toBe(true);
 const stage=refreshed.stages[0];await api.patch(`/api/roadmap/stages/${encodeURIComponent(stage.id)}`,{data:{projectId:project.id,completed:true,userMemo:'내가 완료한 단계'}});await api.post(`/api/projects/${project.id}/roadmap/refresh`,{data:{}});const roadmap=(await (await api.get(`/api/projects/${project.id}/roadmap`)).json()).roadmap;expect(roadmap.stages[0].completed).toBe(true);
 await page.goto(`/archive/${resource.id}?project=${project.id}`);await expect(page.getByText('내 선형대수 학습 자료').first()).toBeVisible();await page.reload();await expect(page.getByText('내 선형대수 학습 자료').first()).toBeVisible();
 const alien=await request.get(`/api/resources/${resource.id}`);expect(alien.status()).toBe(401);
 const metrics=(await (await api.get(`/api/projects/${project.id}/report`)).json());expect(metrics.counts.saved).toBe(1);expect(metrics.comparison.savingsPercent).toBeNull();expect(metrics.estimatedCost).toBeNull();
 const invalid=await api.post('/api/notes',{multipart:{projectId:project.id,file:{name:'fake.png',mimeType:'image/png',buffer:Buffer.from('<script>evil()</script>')}}});expect(invalid.status()).toBe(415);
 await api.delete(`/api/projects/${project.id}`);expect((await api.get(`/api/resources/${resource.id}`)).status()).toBe(404);
});
test('pairing one-time code, scoped origin token, revoke, second owner isolation',async({request,playwright})=>{
 await request.get('/api/bootstrap');const {project}=await (await request.post('/api/projects',{data:{query:'파이썬 독학'}})).json();
 const second=await playwright.request.newContext({baseURL:'http://127.0.0.1:3000'});await second.get('/api/bootstrap');expect((await second.get(`/api/projects/${project.id}`)).status()).toBe(404);
 const {code}=await (await request.post('/api/extension/code',{data:{}})).json();const origin=`chrome-extension://${'a'.repeat(32)}`;
 const extension=await playwright.request.newContext({baseURL:'http://127.0.0.1:3000',extraHTTPHeaders:{origin}});const paired=await extension.post('/api/extension/pair',{data:{code}});expect(paired.status()).toBe(200);const {token}=await paired.json();expect((await extension.post('/api/extension/pair',{data:{code}})).status()).toBe(400);
 expect((await extension.get(`/api/projects/${project.id}`,{headers:{authorization:`Bearer ${token}`}})).status()).toBe(200);expect((await extension.get('/api/projects',{headers:{authorization:`Bearer ${token}`,origin:`chrome-extension://${'b'.repeat(32)}`}})).status()).toBe(403);
 await request.post('/api/extension/revoke',{data:{}});expect((await extension.get('/api/projects',{headers:{authorization:`Bearer ${token}`}})).status()).toBe(401);
 await request.delete(`/api/projects/${project.id}`);await second.dispose();await extension.dispose();
});
