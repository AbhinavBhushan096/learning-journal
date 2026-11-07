import { assertSafeExternalUrl, cleanText, safeExternalUrl } from './security.js';

async function safeFetch(input, redirects = 0) {
  const url = await assertSafeExternalUrl(input);
  const response = await fetch(url, { redirect: 'manual', signal: AbortSignal.timeout(7000), headers: { 'User-Agent': 'LearningJournal/1.0 (+public preview fetcher)', Accept: 'text/html,application/json;q=0.9' } });
  if ([301,302,303,307,308].includes(response.status)) {
    if (redirects >= 3) throw Object.assign(new Error('Too many redirects.'), { status: 400 });
    const location = response.headers.get('location'); if (!location) throw new Error('Invalid redirect.');
    return safeFetch(new URL(location, url).toString(), redirects + 1);
  }
  if (!response.ok) throw Object.assign(new Error(`The remote page returned ${response.status}.`), { status: 422 });
  const length = Number(response.headers.get('content-length') || 0);
  if (length > 1024 * 1024) throw Object.assign(new Error('The remote page is too large to preview.'), { status: 422 });
  return { response, finalUrl: url.toString() };
}
function getYouTubeId(url) {
  try {
    const value = new URL(url);
    if (value.hostname === 'youtu.be') return value.pathname.slice(1).split('/')[0];
    if (value.hostname.endsWith('youtube.com')) return value.searchParams.get('v') || value.pathname.match(/\/(?:shorts|embed)\/([^/?]+)/)?.[1];
  } catch { return null; }
  return null;
}
function meta(html, key) {
  const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const patterns = [
    new RegExp(`<meta[^>]+(?:property|name)=["']${escaped}["'][^>]+content=["']([^"']*)["'][^>]*>`, 'i'),
    new RegExp(`<meta[^>]+content=["']([^"']*)["'][^>]+(?:property|name)=["']${escaped}["'][^>]*>`, 'i')
  ];
  return patterns.map(p => html.match(p)?.[1]).find(Boolean) || '';
}
function decode(value) { return value.replace(/&amp;/g,'&').replace(/&quot;/g,'"').replace(/&#39;/g,"'").replace(/&lt;/g,'<').replace(/&gt;/g,'>'); }
export async function fetchPreview(input) {
  const youtubeId = getYouTubeId(input);
  if (youtubeId) {
    const canonical = `https://www.youtube.com/watch?v=${encodeURIComponent(youtubeId)}`;
    const { response } = await safeFetch(`https://www.youtube.com/oembed?url=${encodeURIComponent(canonical)}&format=json`);
    const data = await response.json();
    return { kind:'lecture', url: canonical, title: cleanText(data.title,160), description: cleanText(`Video by ${data.author_name || 'YouTube'}`,500), thumbnailUrl: safeExternalUrl(data.thumbnail_url) || `https://i.ytimg.com/vi/${youtubeId}/hqdefault.jpg`, source: cleanText(data.author_name,80) };
  }
  const { response, finalUrl } = await safeFetch(input);
  const type = response.headers.get('content-type') || '';
  if (!type.includes('text/html')) throw Object.assign(new Error('Only web pages and YouTube links can be previewed.'), { status: 422 });
  const html = (await response.text()).slice(0, 1024 * 1024);
  const title = decode(meta(html,'og:title') || meta(html,'twitter:title') || html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] || new URL(finalUrl).hostname);
  const description = decode(meta(html,'og:description') || meta(html,'description') || '');
  const image = meta(html,'og:image') || meta(html,'twitter:image');
  let thumbnailUrl = null; try { if (image) thumbnailUrl = safeExternalUrl(new URL(decode(image), finalUrl).toString()); } catch { /* ignore malformed image */ }
  return { kind:'article', url: finalUrl, title: cleanText(title,160), description: cleanText(description,500), thumbnailUrl, source: new URL(finalUrl).hostname.replace(/^www\./,'') };
}
