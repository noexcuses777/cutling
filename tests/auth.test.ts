import {beforeEach,describe,it,expect,vi} from 'vitest';
import {NextRequest} from '../apps/web/node_modules/next/server';
const state=vi.hoisted(()=>({credential:null as any}));
vi.mock('../apps/web/server/db',()=>({db:{credential:{findUnique:async()=>state.credential}},id:()=> 'test-id'}));
import {authenticate} from '../apps/web/server/security';
const origin=`chrome-extension://${'a'.repeat(32)}`;
const request=(headers:Record<string,string>)=>new NextRequest('http://localhost:3000/api/projects',{headers:{host:'localhost:3000',...headers}});
beforeEach(()=>{state.credential={kind:'extension',origin,ownerId:'owner',expiresAt:new Date(Date.now()+60000)};});
describe('token and sender binding',()=>{
 it('rejects expired token',async()=>{state.credential.expiresAt=new Date(Date.now()-1);await expect(authenticate(request({authorization:'Bearer fake',origin}))).rejects.toMatchObject({code:'TOKEN_EXPIRED'});});
 it('accepts privileged Chrome GET without Origin only with bound extension ID',async()=>{await expect(authenticate(request({authorization:'Bearer fake','x-cutling-extension-id':'a'.repeat(32)}))).resolves.toMatchObject({ownerId:'owner',type:'extension'});await expect(authenticate(request({authorization:'Bearer fake'}))).rejects.toMatchObject({code:'ORIGIN_REJECTED'});});
 it('rejects conflicting browser origin despite matching ID',async()=>{await expect(authenticate(request({authorization:'Bearer fake',origin:`chrome-extension://${'b'.repeat(32)}`,'x-cutling-extension-id':'a'.repeat(32)}))).rejects.toMatchObject({code:'ORIGIN_REJECTED'});});
 it('cannot use a web cookie as an extension bearer',async()=>{state.credential.kind='session';await expect(authenticate(request({authorization:'Bearer fake',origin}))).rejects.toMatchObject({code:'ORIGIN_REJECTED'});});
});
