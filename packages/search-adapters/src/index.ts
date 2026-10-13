import type { SearchResult } from '@cutling/shared';

export const OWNED = '[data-cutling-owned]';
export interface ExtractedResult { result: SearchResult; element: HTMLElement; titleElement: HTMLElement; snippetElement?: HTMLElement }
const adSections = '#power_link_body, .sp_power, .nad_area, .ad_section, [data-ad="true"], [data-ad-section="true"]';
const titleSelectors = ['#power_link_body a.lnk_head', '.nad_area a.lnk_head', '.sp_power a.lnk_head', '.ad_section a.lnk_head', '.title_link', '.api_txt_lines.total_tit', '.link_tit', '.news_tit', '.fds-web-doc-root a:has(.sds-comps-text-type-headline1)', '.fds-ugc-block a:has(.sds-comps-text-type-headline1)', 'a[data-testid="result-title"]', 'a[data-cutling-title]', 'a[class*="title_link"]'];
const blockSelectors = ['.fds-web-doc-root', '.total_wrap', '.view_wrap', '.news_wrap', '.fds-ugc-block', '.api_bx', '.lst_total', '[data-testid="search-result"]', '[data-cutling-result]'];
const snippetSelectors = ['.desc_area .link_desc', '.sds-comps-text-ellipsis-3 .sds-comps-text-content', '.dsc_txt', '.api_txt_lines.dsc_txt_wrap', '.total_dsc', '.news_dsc', '.dsc', '[data-testid="result-snippet"]', '[data-cutling-snippet]'];
function first<T extends Element = HTMLElement>(root: ParentNode, selectors: string[]): T | null {
  for (const selector of selectors) { const value = root.querySelector<T>(selector); if (value && !value.closest(OWNED)) return value; }
  return null;
}
const compact = (s: string | null | undefined, max: number) => (s ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
export function queryFromNaver(url: string): string {
  try { const u = new URL(url); return u.hostname === 'search.naver.com' ? compact(u.searchParams.get('query'), 300) : ''; } catch { return ''; }
}
export function safeSourceUrl(href: string, base: string): string | null {
  try { const u = new URL(href, base); if (!['http:', 'https:'].includes(u.protocol) || u.username || u.password) return null; return u.href; } catch { return null; }
}
function idFor(input: string): string {
  let hash = 2166136261;
  for (const char of input) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619);
  return `naver-${(hash >>> 0).toString(36)}`;
}
const elementIds=new WeakMap<HTMLElement,{key:string;id:string}>();
let elementSequence=0;
function localId(element:HTMLElement,key:string){const existing=elementIds.get(element);if(existing?.key===key)return existing.id;const id=`${idFor(key)}-${++elementSequence}`;elementIds.set(element,{key,id});return id;}
export function isVisible(element: HTMLElement, view: Window): boolean {
  const rect = element.getBoundingClientRect();
  const style = view.getComputedStyle(element);
  return rect.width > 0 && rect.height > 0 && rect.bottom > 0 && rect.top < view.innerHeight && rect.right > 0 && rect.left < view.innerWidth && style.display !== 'none' && style.visibility !== 'hidden';
}
/** Supports observed SDS organic and Powerlink ad cards; skips unknown layouts. */
export function extractNaverResults(doc: Document, options: { visibleOnly?: boolean; limit?: number } = {}): ExtractedResult[] {
  const results: ExtractedResult[] = [];
  const seen = new Set<HTMLElement>();
  const nodes = doc.querySelectorAll<HTMLAnchorElement>(titleSelectors.join(','));
  for (const anchor of nodes) {
    if (results.length >= (options.limit ?? 60)) break;
    if (anchor.closest(OWNED)) continue;
    const adSection=anchor.closest(adSections);
    let element: HTMLElement | null = adSection ? anchor.closest<HTMLElement>('li.lst, li[class*="lst_type"], [data-ad="true"]') : null;
    if(!element)for (const selector of blockSelectors) { element = anchor.closest<HTMLElement>(selector); if (element) break; }
    if (!element || seen.has(element) || element.closest(OWNED)) continue;
    if (options.visibleOnly !== false && doc.defaultView && !isVisible(element, doc.defaultView)) continue;
    const url = safeSourceUrl(anchor.getAttribute('href') ?? '', doc.URL);
    const title = compact(anchor.querySelector('.sds-comps-text-type-headline1')?.textContent ?? anchor.textContent, 500);
    if (!url || !title || new URL(url).hostname === 'search.naver.com') continue;
    seen.add(element);
    const snippetElement = first<HTMLElement>(element, snippetSelectors) ?? undefined;
    const dateElement = first<HTMLElement>(element, ['time', '.sub_time', '.date', '[data-date]', '.sds-comps-text-left']);
    const rawDate = dateElement?.getAttribute('datetime') ?? dateElement?.getAttribute('data-date') ?? dateElement?.textContent ?? '';
    const absoluteDate = rawDate.match(/(20\d{2})[.\-/]\s*(\d{1,2})[.\-/]\s*(\d{1,2})/);
    let publishedAt: string | null = null;
    if (absoluteDate) { const date = new Date(`${absoluteDate[1]}-${absoluteDate[2]!.padStart(2,'0')}-${absoluteDate[3]!.padStart(2,'0')}T00:00:00Z`); if (!Number.isNaN(date.valueOf())) publishedAt = date.toISOString(); }
    const ad = element.matches(adSections)||!!adSection||!!first(element, ['[data-ad="true"]', '.ad_mark', '.sp_ad', '.ad_badge', '[aria-label="광고"]']);
    results.push({
      element, titleElement: anchor, snippetElement,
      result: { id: localId(element,`${url}|${title}|${compact(snippetElement?.textContent,1400)}`), title, snippet: compact(snippetElement?.textContent, 1400), url, domain: new URL(url).hostname,
        contentTypeHint: new URL(url).hostname.endsWith('blog.naver.com') ? '블로그' : undefined,
        publishedAt, explicitAd: !!ad, position: results.length, extractedAt: new Date().toISOString() },
    });
  }
  return results;
}
export function isOwnedMutation(mutation: MutationRecord): boolean {
  const target = mutation.target.nodeType === 1 ? mutation.target as Element : mutation.target.parentElement;
  if (target?.closest(OWNED)) return true;
  if (mutation.type === 'childList' && mutation.addedNodes.length + mutation.removedNodes.length > 0) {
    return [...mutation.addedNodes, ...mutation.removedNodes].every(node => node.nodeType === 1 && !!(node as Element).matches(OWNED));
  }
  return false;
}
export class VersionGate {
  // Session mappings survive a content-script reload; a wall-clock seed keeps a
  // new page's versions above the previous page's small sequence of changes.
  private version: number;
  constructor(initialVersion=Date.now()){this.version=initialVersion;}
  next(): number { return ++this.version; }
  current(): number { return this.version; }
  isCurrent(version: number): boolean { return this.version === version; }
}
export function captureNaverBlog(doc: Document): {title:string;url:string;text:string;partial:boolean} | null {
  if (!['blog.naver.com', 'm.blog.naver.com'].includes(new URL(doc.URL).hostname)) return null;
  const article = first<HTMLElement>(doc, ['.se-main-container', '#postViewArea', '.post_ct', 'article']);
  if (!article) return null;
  const clone = article.cloneNode(true) as HTMLElement;
  clone.querySelectorAll('script,style,nav,aside,.comment,.se-module-map,[data-cutling-owned]').forEach(el => el.remove());
  const paragraphs = [...clone.querySelectorAll('p,.se-text-paragraph,h1,h2,h3,li')].map(p => compact(p.textContent, 40001)).filter(Boolean);
  const rawText=paragraphs.length?paragraphs.join('\n\n'):compact(clone.textContent,40001);
  const text = rawText.slice(0,40000);
  return text ? { title: compact(first(doc, ['.se-title-text', '.pcol1 .htitle', 'h1'])?.textContent ?? doc.title, 500), url: doc.URL, text, partial: rawText.length>40000 } : null;
}
