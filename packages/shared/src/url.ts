const tracking = /^(utm_.+|fbclid|gclid|dclid|msclkid|yclid|_ga|_gl|n_media|n_query|n_rank|n_ad_group|n_ad|n_keyword_id|n_keyword|n_campaign_type|n_ad_group_type|n_match|NaPm)$/i;

/** Remove known tracking only; preserve article identifiers and arbitrary query parameters. */
export function normalizeUrl(input: string): string {
  try {
    const url = new URL(input.trim());
    if (!['http:', 'https:'].includes(url.protocol)) return input.trim();
    url.hash = '';
    url.hostname = url.hostname.toLowerCase();
    for (const name of Array.from(url.searchParams.keys())) if (tracking.test(name)) url.searchParams.delete(name);
    if (['m.blog.naver.com', 'blog.naver.com'].includes(url.hostname)) {
      const blogId = url.searchParams.get('blogId');
      const logNo = url.searchParams.get('logNo');
      if (/^\/PostView\.naver$/i.test(url.pathname) && blogId && logNo && /^\d+$/.test(logNo)) {
        return `https://blog.naver.com/${encodeURIComponent(blogId)}/${logNo}`;
      }
      if (/^\/[^/]+\/\d+\/?$/.test(url.pathname)) {
        url.hostname = 'blog.naver.com'; url.protocol = 'https:'; url.search = ''; url.pathname = url.pathname.replace(/\/$/, '');
      }
    }
    url.searchParams.sort();
    return url.toString();
  } catch { return input.trim(); }
}
export function extractQuery(url: string): string {
  try { const parsed = new URL(url); return parsed.hostname === 'search.naver.com' ? (parsed.searchParams.get('query') ?? '').trim() : ''; } catch { return ''; }
}
export function searchUrl(query: string): string { return `https://search.naver.com/search.naver?query=${encodeURIComponent(query)}`; }
export function normalizeText(text: string): string { return text.normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]/gu, ''); }
function stable(value: unknown): string {
  if (value === undefined) return 'null';
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  if (value !== null && typeof value === 'object') return `{${Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${JSON.stringify(k)}:${stable(v)}`).join(',')}}`;
  return JSON.stringify(value);
}
/** Deterministic cache identity; server adds cryptographic SHA-256 before storage. */
export function makeCacheKey(input: unknown, context: unknown = {}): string {
  const value = stable({ input, context, schemaVersion: '1', promptVersion: '2026-10-13.1' });
  let a = 2166136261, b = 5381;
  for (let i = 0; i < value.length; i++) { a = Math.imul(a ^ value.charCodeAt(i), 16777619); b = Math.imul(b, 33) ^ value.charCodeAt(i); }
  return `cutling-v1-${(a >>> 0).toString(16)}${(b >>> 0).toString(16)}-${value.length}`;
}
export function parseVisibleDate(value?: string|null, now = new Date()): Date|null {
  if (!value?.trim()) return null;
  const relative = value.match(/(\d+)\s*(분|시간|일|주|개월|년)\s*전/);
  if (relative) { const units: Record<string,number> = { 분: 60000, 시간: 3600000, 일: 86400000, 주: 604800000, 개월: 2592000000, 년: 31536000000 }; return new Date(now.getTime() - Number(relative[1]) * (units[relative[2]!] ?? 0)); }
  const date = value.match(/(20\d{2})[.\-/년]\s*(\d{1,2})[.\-/월]\s*(\d{1,2})/);
  if (date) { const result = new Date(Date.UTC(Number(date[1]), Number(date[2]) - 1, Number(date[3]))); return result.getUTCMonth() === Number(date[2]) - 1 && result.getUTCDate() === Number(date[3]) ? result : null; }
  const parsed = new Date(value); return Number.isNaN(parsed.getTime()) ? null : parsed;
}
