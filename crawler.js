const { BrowserWindow } = require('electron');
const { URL } = require('url');
const { buildArchiveHtml } = require('./combine');

const DEFAULT_MAX_PAGES = 40;
const DEFAULT_MAX_DEPTH = 3;
const PAGE_LOAD_SETTLE_MS = 1200; // extra wait after load for JS-rendered content to settle
const PAGE_TIMEOUT_MS = 30000;
const MAX_CONCURRENCY = 3; // hidden windows rendered in parallel

function normalizeUrl(raw) {
  try {
    const parsed = new URL(raw);
    parsed.hash = '';
    let s = parsed.toString();
    if (s.endsWith('/') && parsed.pathname !== '/') s = s.slice(0, -1);
    return s;
  } catch (e) {
    return null;
  }
}

function sameOrigin(a, b) {
  try {
    return new URL(a).hostname === new URL(b).hostname;
  } catch (e) {
    return false;
  }
}

// This function is serialized and executed *inside* the target page's own
// renderer process, so `fetch`, `document`, etc. refer to that page.
const CAPTURE_SCRIPT = `
(async () => {
  async function toDataUrl(url) {
    try {
      const res = await fetch(url, { cache: 'force-cache' });
      const blob = await res.blob();
      return await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onloadend = () => resolve(reader.result);
        reader.onerror = reject;
        reader.readAsDataURL(blob);
      });
    } catch (e) {
      return null;
    }
  }

  async function inlineCssUrls(cssText, baseUrl) {
    const matches = [...cssText.matchAll(/url\\(([^)]+)\\)/g)];
    for (const m of matches) {
      let raw = m[1].trim().replace(/^['"]|['"]$/g, '');
      if (!raw || raw.startsWith('data:')) continue;
      try {
        const abs = new URL(raw, baseUrl).toString();
        const dataUrl = await toDataUrl(abs);
        if (dataUrl) cssText = cssText.split(m[0]).join('url(' + dataUrl + ')');
      } catch (e) {}
    }
    return cssText;
  }

  // Inline external stylesheets
  const linkEls = Array.from(document.querySelectorAll('link[rel~="stylesheet"]'));
  for (const link of linkEls) {
    try {
      const href = link.href;
      if (!href) continue;
      const res = await fetch(href);
      let css = await res.text();
      css = await inlineCssUrls(css, href);
      const styleEl = document.createElement('style');
      styleEl.textContent = css;
      link.replaceWith(styleEl);
    } catch (e) {}
  }

  // Inline url() references inside existing <style> blocks
  const styleEls = Array.from(document.querySelectorAll('style'));
  for (const styleEl of styleEls) {
    styleEl.textContent = await inlineCssUrls(styleEl.textContent || '', document.baseURI);
  }

  // Inline <img> sources
  const imgs = Array.from(document.querySelectorAll('img[src]'));
  for (const img of imgs) {
    try {
      if (img.src.startsWith('data:')) continue;
      const dataUrl = await toDataUrl(img.src);
      if (dataUrl) img.src = dataUrl;
      img.removeAttribute('srcset');
    } catch (e) {}
  }

  // Inline background-image / url() references in inline style attributes
  const withStyle = Array.from(document.querySelectorAll('[style*="url("]'));
  for (const el of withStyle) {
    const styleAttr = await inlineCssUrls(el.getAttribute('style') || '', document.baseURI);
    el.setAttribute('style', styleAttr);
  }

  // Collect outgoing links before we strip scripts
  const links = Array.from(document.querySelectorAll('a[href]'))
    .map(a => a.href)
    .filter(Boolean);

  // Strip scripts: the output is a static snapshot, so page JS is removed.
  Array.from(document.querySelectorAll('script')).forEach(s => s.remove());
  const baseTag = document.querySelector('base');
  if (baseTag) baseTag.remove();

  return {
    title: document.title,
    headHTML: document.head.innerHTML,
    bodyHTML: document.body.innerHTML,
    links,
  };
})()
`;

async function capturePage(url, timeoutMs) {
  const win = new BrowserWindow({
    show: false,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      images: true,
    },
  });
  try {
    const loaded = new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('timed out loading page')), timeoutMs);
      win.webContents.once('did-finish-load', () => {
        clearTimeout(timer);
        resolve();
      });
      win.webContents.once('did-fail-load', (_e, _code, desc) => {
        clearTimeout(timer);
        reject(new Error(`failed to load: ${desc || 'unknown error'}`));
      });
    });
    win.loadURL(url);
    await loaded;
    // Give client-side rendered (React/Vue/etc) content time to finish painting.
    await new Promise((r) => setTimeout(r, PAGE_LOAD_SETTLE_MS));
    const result = await win.webContents.executeJavaScript(CAPTURE_SCRIPT, true);
    return result;
  } finally {
    if (!win.isDestroyed()) win.destroy();
  }
}

async function crawlSite(options, log) {
  const {
    seedUrl,
    maxPages = DEFAULT_MAX_PAGES,
    maxDepth = DEFAULT_MAX_DEPTH,
    sameOriginOnly = true,
  } = options;

  const start = normalizeUrl(seedUrl);
  if (!start) throw new Error('That does not look like a valid URL.');

  const visited = new Set();
  const queued = new Set([start]);
  const queue = [{ url: start, depth: 0 }];
  const pages = {};

  async function worker() {
    while (queue.length && Object.keys(pages).length < maxPages) {
      const item = queue.shift();
      if (!item) return;
      const { url, depth } = item;
      if (visited.has(url)) continue;
      visited.add(url);

      log(`Fetching (${Object.keys(pages).length + 1}/${maxPages}): ${url}`);
      try {
        const result = await capturePage(url, PAGE_TIMEOUT_MS);
        pages[url] = {
          title: result.title,
          headHTML: result.headHTML,
          bodyHTML: result.bodyHTML,
        };

        if (depth < maxDepth) {
          for (const link of result.links) {
            const norm = normalizeUrl(link);
            if (!norm) continue;
            if (sameOriginOnly && !sameOrigin(norm, start)) continue;
            if (visited.has(norm) || queued.has(norm)) continue;
            if (Object.keys(pages).length + queue.length >= maxPages) continue;
            queued.add(norm);
            queue.push({ url: norm, depth: depth + 1 });
          }
        }
      } catch (e) {
        log(`  Skipped ${url} (${e.message})`);
      }
    }
  }

  const workers = Array.from({ length: MAX_CONCURRENCY }, () => worker());
  await Promise.all(workers);

  const count = Object.keys(pages).length;
  if (count === 0) throw new Error('Could not capture any pages from that URL.');

  log(`Captured ${count} page(s). Building the archive file...`);
  return buildArchiveHtml(pages, start);
}

module.exports = { crawlSite };
