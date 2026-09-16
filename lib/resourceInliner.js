import { bytesToBase64 } from './base64.js';

const MIME_BY_EXT = {
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif',
  '.svg': 'image/svg+xml', '.webp': 'image/webp', '.avif': 'image/avif', '.ico': 'image/x-icon',
  '.woff': 'font/woff', '.woff2': 'font/woff2', '.ttf': 'font/ttf', '.otf': 'font/otf',
  '.eot': 'application/vnd.ms-fontobject', '.css': 'text/css', '.mp4': 'video/mp4',
  '.webm': 'video/webm', '.mp3': 'audio/mpeg'
};

function guessMime(url) {
  const clean = url.split('?')[0].split('#')[0];
  const idx = clean.lastIndexOf('.');
  if (idx === -1) return 'application/octet-stream';
  return MIME_BY_EXT[clean.slice(idx).toLowerCase()] || 'application/octet-stream';
}

function resolveUrl(rel, base) {
  try {
    return new URL(rel, base).href;
  } catch {
    return null;
  }
}

async function fetchBuffer(url, opts) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs || 10000);
  try {
    // credentials: 'include' + the extension's host_permissions means cookies
    // for the target origin are sent, and the response is exempt from CORS
    // (unlike a fetch from a plain web page), so we can read the body even
    // for third-party CDNs.
    const res = await fetch(url, { signal: controller.signal, credentials: 'include', redirect: 'follow' });
    if (!res.ok) return null;
    const arrayBuf = await res.arrayBuffer();
    const bytes = new Uint8Array(arrayBuf);
    let mime = res.headers.get('content-type');
    if (mime) mime = mime.split(';')[0].trim();
    if (!mime || mime === 'application/octet-stream') mime = guessMime(url) || mime;
    return { bytes, mime: mime || 'application/octet-stream' };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

async function fetchTextSafe(url, opts) {
  const result = await fetchBuffer(url, opts);
  if (!result) return null;
  return new TextDecoder('utf-8').decode(result.bytes);
}

async function fetchAsDataUri(url, opts) {
  const maxBytes = opts.maxImageBytes || 4 * 1024 * 1024;
  const result = await fetchBuffer(url, opts);
  if (!result) return null;
  if (result.bytes.length > maxBytes) return { tooLarge: true };
  return { dataUri: `data:${result.mime};base64,${bytesToBase64(result.bytes)}`, bytes: result.bytes.length };
}

async function replaceAsync(str, regex, asyncFn) {
  const matches = [];
  str.replace(regex, (...args) => {
    matches.push(args);
    return '';
  });
  if (!matches.length) return str;
  const replacements = await Promise.all(matches.map((args) => asyncFn(...args)));
  let i = 0;
  return str.replace(regex, () => replacements[i++]);
}

async function inlineUrlsInCss(cssText, baseUrl, opts) {
  const urlRegex = /url\(\s*(['"]?)([^'")]+)\1\s*\)/gi;
  return replaceAsync(cssText, urlRegex, async (match, quote, rel) => {
    if (/^data:/i.test(rel)) return match;
    const abs = resolveUrl(rel, baseUrl);
    if (!abs || !/^https?:/i.test(abs)) return match;
    const result = await fetchAsDataUri(abs, opts);
    if (!result || result.tooLarge) return match;
    return `url("${result.dataUri}")`;
  });
}

async function expandImports(cssText, baseUrl, opts, seen, depth) {
  if (depth > 4) return cssText;
  const importRegex = /@import\s+(?:url\(\s*(['"]?)([^'")]+)\1\s*\)|(['"])([^'"]+)\3)[^;]*;/gi;
  return replaceAsync(cssText, importRegex, async (match, q1, u1, q3, u2) => {
    const rel = u1 || u2;
    if (!rel) return '';
    const abs = resolveUrl(rel, baseUrl);
    if (!abs || seen.has(abs)) return '';
    seen.add(abs);
    const childText = await fetchTextSafe(abs, opts);
    if (!childText) return '';
    const childExpanded = await expandImports(childText, abs, opts, seen, depth + 1);
    return inlineUrlsInCss(childExpanded, abs, opts);
  });
}

async function inlineStylesheetLinks(html, baseUrl, opts) {
  const linkTagRegex = /<link\b[^>]*>/gi;
  return replaceAsync(html, linkTagRegex, async (tag) => {
    if (!/rel\s*=\s*["']?\s*stylesheet/i.test(tag)) return tag;
    const hrefMatch = tag.match(/href\s*=\s*["']([^"']+)["']/i);
    if (!hrefMatch) return tag;
    const abs = resolveUrl(hrefMatch[1], baseUrl);
    if (!abs || !/^https?:/i.test(abs)) return tag;
    let css = await fetchTextSafe(abs, opts);
    if (css == null) return tag;
    css = await expandImports(css, abs, opts, new Set([abs]), 0);
    css = await inlineUrlsInCss(css, abs, opts);
    const escaped = css.replace(/<\/style/gi, '<\\/style');
    return `<style data-inlined-from="${abs.replace(/"/g, '&quot;')}">\n${escaped}\n</style>`;
  });
}

async function inlineImages(html, baseUrl, opts) {
  let out = html;

  out = await replaceAsync(out, /(\ssrc\s*=\s*)(["'])([^"']+)\2/gi, async (m, p1, q, val) => {
    if (/^data:/i.test(val)) return m;
    const abs = resolveUrl(val, baseUrl);
    if (!abs || !/^https?:/i.test(abs)) return m;
    const r = await fetchAsDataUri(abs, opts);
    if (!r || r.tooLarge) return m;
    return `${p1}${q}${r.dataUri}${q}`;
  });

  out = await replaceAsync(out, /(\ssrcset\s*=\s*)(["'])([^"']+)\2/gi, async (m, p1, q, val) => {
    const parts = val.split(',').map((s) => s.trim()).filter(Boolean);
    const resolved = await Promise.all(
      parts.map(async (part) => {
        const spaceIdx = part.indexOf(' ');
        const u = spaceIdx === -1 ? part : part.slice(0, spaceIdx);
        const desc = spaceIdx === -1 ? '' : part.slice(spaceIdx + 1);
        if (!u || /^data:/i.test(u)) return part;
        const abs = resolveUrl(u, baseUrl);
        if (!abs || !/^https?:/i.test(abs)) return part;
        const r = await fetchAsDataUri(abs, opts);
        if (!r || r.tooLarge) return part;
        return desc ? `${r.dataUri} ${desc}` : r.dataUri;
      })
    );
    return `${p1}${q}${resolved.join(', ')}${q}`;
  });

  out = await replaceAsync(out, /(\sstyle\s*=\s*)(["'])([^"']*?)\2/gi, async (m, p1, q, styleVal) => {
    if (!/url\(/i.test(styleVal)) return m;
    const newVal = await inlineUrlsInCss(styleVal, baseUrl, opts);
    return `${p1}${q}${newVal}${q}`;
  });

  return out;
}

export async function inlinePageResources(html, baseUrl, opts) {
  let out = await inlineStylesheetLinks(html, baseUrl, opts);
  out = await inlineImages(out, baseUrl, opts);
  return out;
}
