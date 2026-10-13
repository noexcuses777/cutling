import {afterEach,expect,it,vi} from 'vitest';
import http from 'node:http';
import {EventEmitter} from 'node:events';
import {extractPublicPage} from '../apps/web/server/extract';

afterEach(()=>{vi.restoreAllMocks();vi.useRealTimers();});

it('aborts a continuously trickling public response at the total 12 second deadline',async()=>{
 vi.useFakeTimers();
 const response=Object.assign(new EventEmitter(),{statusCode:200,headers:{'content-type':'text/plain'},destroy:vi.fn()});
 const request=Object.assign(new EventEmitter(),{destroy:vi.fn((error:Error)=>{request.emit('error',error);return request;})});
 vi.spyOn(http,'get').mockImplementation(((_url:unknown,_options:unknown,callback:(res:unknown)=>void)=>{queueMicrotask(()=>callback(response));return request;}) as any);
 const pending=extractPublicPage('http://93.184.216.34/article');
 const rejected=expect(pending).rejects.toMatchObject({code:'FETCH_TIMEOUT',status:408});
 for(let second=0;second<12;second++){await vi.advanceTimersByTimeAsync(1000);response.emit('data',Buffer.from('still sending a small chunk\n'));}
 await rejected;
 expect(request.destroy).toHaveBeenCalledOnce();
});

it('closes a redirect body and blocks its private destination before another request',async()=>{
 const response={statusCode:302,headers:{location:'http://127.0.0.1/private'},destroy:vi.fn()};
 const request=Object.assign(new EventEmitter(),{destroy:vi.fn()});
 const get=vi.spyOn(http,'get').mockImplementation(((_url:unknown,_options:unknown,callback:(res:unknown)=>void)=>{queueMicrotask(()=>callback(response));return request;}) as any);
 await expect(extractPublicPage('http://93.184.216.34/redirect')).rejects.toMatchObject({code:'SSRF_BLOCKED'});
 expect(response.destroy).toHaveBeenCalledOnce();expect(get).toHaveBeenCalledOnce();
});
