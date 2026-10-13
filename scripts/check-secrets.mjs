import { execFileSync } from 'node:child_process';
import fs from 'node:fs';

const files=execFileSync('git',['ls-files','-z'],{encoding:'utf8'}).split('\0').filter(Boolean);
const patterns=[/gh[pousr]_[A-Za-z0-9_]{20,}/,/github_pat_[A-Za-z0-9_]{20,}/,/sk-[A-Za-z0-9_-]{24,}/,/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/];
const findings=[];
for(const file of files){
  if(/(^|\/)\.env(?:\..*)?$/.test(file)&&!file.endsWith('/.env.example')&&file!=='.env.example')findings.push(`${file}: private environment file`);
  if(/(^|\/)(node_modules|\.next|data|dist|test-results|playwright-report|coverage)(\/|$)|\.(db(?:-.*)?|pem|key|p12|pfx|log|tsbuildinfo)$/.test(file))findings.push(`${file}: generated, private or credential file`);
  if(!fs.existsSync(file))continue;
  const text=fs.readFileSync(file,'utf8');
  if(patterns.some(pattern=>pattern.test(text)))findings.push(`${file}: credential pattern`);
  for(const match of text.matchAll(/(?:HCX_API_KEY|apiKey|api_key|access_token|client_secret)\s*[:=]\s*["']([^"'\r\n]{16,})["']/gi)){
    if(!/test|mock|placeholder|example|sentinel|changeme|process\.env/i.test(match[1]))findings.push(`${file}: possible hard-coded credential`);
  }
}
if(findings.length){console.error(findings.join('\n'));process.exitCode=1;}
else console.log(`Secret guard passed for ${files.length} tracked files. No secret values printed.`);
