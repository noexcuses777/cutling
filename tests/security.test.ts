import {describe,it,expect} from 'vitest';
import {publicAddress,validatePublicUrl} from '../apps/web/server/extract';
import {checkHost,ApiError,isExtensionOrigin} from '../apps/web/server/security';
import {NextRequest} from '../apps/web/node_modules/next/server';
describe('public URL collection safeguards',()=>{
 it.each(['127.0.0.1','0.0.0.0','10.1.2.3','172.16.0.1','192.168.1.1','169.254.169.254','::1','fc00::1','fe80::1','::ffff:127.0.0.1','224.0.0.1'])('rejects private/reserved %s',a=>expect(publicAddress(a)).toBe(false));
 it('permits public internet IP',()=>expect(publicAddress('8.8.8.8')).toBe(true));
 it.each(['http://localhost/a','http://127.1/a','http://2130706433/a','http://[::1]/','file:///etc/passwd','http://user:password@example.com/','http://example.com:9000/'])('rejects unsafe URL %s',async u=>{await expect(validatePublicUrl(u)).rejects.toBeDefined();});
 it('rejects mixed public/private DNS answers',async()=>{await expect(validatePublicUrl('https://example.com',async()=>[{address:'93.184.216.34',family:4},{address:'192.168.0.5',family:4}] as any)).rejects.toMatchObject({code:'SSRF_BLOCKED'});});
 it('returns vetted DNS addresses for pinning',async()=>{const r=await validatePublicUrl('https://example.com',async()=>[{address:'93.184.216.34',family:4}] as any);expect(r.addresses[0].address).toBe('93.184.216.34');});
});
describe('origin and host restrictions',()=>{
 const req=(host:string,origin?:string)=>new NextRequest(`http://${host}/api/projects`,{headers:{host,...(origin?{origin}:{})}});
 it('blocks arbitrary web origins and Host rebinding',()=>{expect(()=>checkHost(req('localhost:3000','https://evil.example'))).toThrow(ApiError);expect(()=>checkHost(req('evil.example:3000'))).toThrow(ApiError);});
 it('accepts exact local service origin',()=>expect(()=>checkHost(req('localhost:3000','http://localhost:3000'))).not.toThrow());
 it('validates extension IDs strictly',()=>{expect(isExtensionOrigin(`chrome-extension://${'a'.repeat(32)}`)).toBe(true);expect(isExtensionOrigin('chrome-extension://anything')).toBe(false);});
});
