import {test,expect} from '@playwright/test';
import {readFile} from 'node:fs/promises';
test('real PNG upload → local Korean OCR or editable fallback → organized archive → delete image',async({request})=>{
 test.setTimeout(120000);await request.get('/api/bootstrap');const {project}=await(await request.post('/api/projects',{data:{query:'선형대수 벡터 행렬',mode:'rules'}})).json();
 const upload=await request.post('/api/notes',{multipart:{projectId:project.id,retainImage:'true',file:{name:'sample-note.png',mimeType:'image/png',buffer:await readFile('docs/sample-note.png')}}});expect(upload.status()).toBe(201);const {note,jobId}=await upload.json();expect((await request.get(note.imageUrl)).status()).toBe(200);
 await expect.poll(async()=>(await(await request.get(`/api/jobs/${jobId}`)).json()).job.status,{timeout:85000,intervals:[1000,2000,4000]}).toBe('completed');
 const recognized=(await(await request.get(`/api/notes/${note.id}`)).json()).note;expect(['review','ocr_failed']).toContain(recognized.status);
 // The handwritten-OCR boundary is editable even if language data cannot download.
 await request.patch(`/api/notes/${note.id}`,{data:{editedText:'벡터는 크기와 방향을 갖습니다.\n행렬은 선형 변환을 표현합니다.\n고유값은 왜 필요한가요?'}});const organized=await request.post(`/api/notes/${note.id}/organize`,{data:{}});expect(organized.ok()).toBe(true);const result=await organized.json();await expect.poll(async()=>(await(await request.get(`/api/jobs/${result.jobId}`)).json()).job.status,{timeout:20000}).toBe('completed');
 const ready=(await(await request.get(`/api/notes/${note.id}`)).json()).note;expect(ready.organizedContent.confirmed.length).toBeGreaterThan(0);expect(ready.organizedContent.questions.length).toBeGreaterThan(0);const resources=(await(await request.get(`/api/resources?projectId=${project.id}`)).json()).resources;expect(resources.some((r:any)=>r.id===`note-resource:${note.id}`)).toBe(true);
 test.info().annotations.push({type:'OCR result',description:`status=${recognized.status}; textLength=${recognized.ocrText.length}; Korean=${/벡터|행렬/.test(recognized.ocrText)}`});
 await request.delete(`/api/notes/${note.id}`);expect((await request.get(note.imageUrl)).status()).toBe(404);await request.delete(`/api/projects/${project.id}`);
});
