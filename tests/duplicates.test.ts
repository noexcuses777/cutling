import {it,expect} from 'vitest';
import {withDuplicateHistory} from '../apps/web/server/duplicates';
import {classifyResults,DEFAULT_FILTERS} from '../packages/shared/src/index';
it('detects URLs saved or observed in earlier result batches without losing source links',()=>{const r={id:'second',title:'파이썬 함수 입문',snippet:'파이썬 함수를 설명하는 개념 학습 자료입니다.',url:'https://example.org/p?utm_source=naver',explicitAd:false,position:0};const a=classifyResults([r],{query:'파이썬',selectedIntent:'입문 로드맵'});const result=withDuplicateHistory(a,[r],[{url:'https://example.org/p',title:'앞서 저장한 자료',snippet:''}],DEFAULT_FILTERS);expect(result[0].duplicationLabel).toBe('same_url');expect(r.url).toContain('utm_source');});
