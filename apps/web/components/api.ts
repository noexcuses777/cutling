export async function api<T>(path: string, method = 'GET', body?: unknown): Promise<T> {
  const response = await fetch(path, { method, credentials: 'same-origin', cache: 'no-store', headers: body instanceof FormData ? undefined : { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : body instanceof FormData ? body : JSON.stringify(body) });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error?.message || `요청을 완료하지 못했어요. (${response.status})`);
  return data as T;
}

export function errorText(error: unknown) { return error instanceof Error ? error.message : '일시적인 오류가 발생했어요. 다시 시도해 주세요.'; }
export function dateText(value?: string) { if (!value) return '기록 없음'; const date = new Date(value); return Number.isNaN(date.getTime()) ? '기록 없음' : new Intl.DateTimeFormat('ko-KR', { month: 'long', day: 'numeric' }).format(date); }
export function fullDate(value?: string) { if (!value) return '기록 없음'; const date = new Date(value); return Number.isNaN(date.getTime()) ? '기록 없음' : new Intl.DateTimeFormat('ko-KR', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Seoul' }).format(date); }
export function scopeLabel(value?: string) { return ({ title: '제목 기준', snippet: '검색 요약 기준', fulltext: '본문 기준', user_pasted: '직접 입력한 본문', metadata_only: '제목·주소만 확보', snippet_only: '검색 요약 확보', failed: '본문 수집 실패' } as Record<string, string>)[value || ''] || '근거 확인 중'; }
export function statusLabel(value: string) { return ({ queued: '대기 중', processing: '정리 중', ready: '정리 완료', failed: '확인 필요', ocr_processing: '문자 인식 중', review: '원문 검토', ocr_failed: '인식 실패 · 직접 입력 가능', ocr_complete: '원문 검토', organized: '정리 완료', uploaded: '업로드 완료' } as Record<string, string>)[value] || value; }

export function bridge<T>(type: 'CONNECT_STATUS' | 'OPEN_NAVER_SEARCH', payload: Record<string, unknown>, timeout = 850): Promise<T | null> {
  return new Promise(resolve => {
    const requestId = crypto.randomUUID();
    const finish = (value: T | null) => { window.clearTimeout(timer); window.removeEventListener('message', listener); resolve(value); };
    const listener = (event: MessageEvent) => { if (event.source !== window || event.origin !== window.location.origin || event.data?.source !== 'cutling-extension' || event.data?.requestId !== requestId) return; finish(event.data.payload as T); };
    const timer = window.setTimeout(() => finish(null), timeout);
    window.addEventListener('message', listener);
    window.postMessage({ source: 'cutling-web', type, requestId, payload }, window.location.origin);
  });
}
