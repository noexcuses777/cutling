const base=process.env.CUTLING_URL||'http://127.0.0.1:3000';
const bootstrap=await fetch(`${base}/api/bootstrap`);if(!bootstrap.ok)throw new Error('먼저 pnpm dev로 웹 서버를 실행해 주세요.');const cookie=bootstrap.headers.get('set-cookie')?.split(';')[0]||'';
const response=await fetch(`${base}/api/demo/seed`,{method:'POST',headers:{cookie,'content-type':'application/json',origin:new URL(base).origin},body:'{}'});const data=await response.json();if(!response.ok)throw new Error(data.error?.message||'Seed failed');
console.log(`별도 데모 워크스페이스에 생성됨: ${data.project.title}\n브라우저에서 사용할 데모는 홈의 샘플 프로젝트 버튼으로 만드세요.`);
