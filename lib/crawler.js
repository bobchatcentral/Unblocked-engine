import { inlinePageResources } from './resourceInliner.js';

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function normalizeUrl(raw) {
  try {
    const u = new URL(raw);
    u.hash = '';
    if (u.pathname !== '/' && u.pathname.endsWith('/')) u.pathname = u.pathname.slice(0, -1);
    return u.href;
  } catch {
    return null;
  }
}

// Passed directly as the `func` for chrome.scripting.executeScript, so it
// must be fully self-contained (no closures over outer scope) and its
// return value must be JSON-serializable.
async function pageCaptureScript(opts) {
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));

  async function autoScroll() {
    try {
      const height = document.body ? document.body.scrollHeight : 0;
      const step = Math.max(400, Math.floor(window.innerHeight * 0.9));
      let pos = 0;
      let guard = 0;
      while (pos < height && guard < 40) {
        window.scrollTo(0, pos);
        await wait(120);
        pos += step;
        guard++;
      }
      window.scrollTo(0, 0);
      await wait(150);
    } catch (e) {
      /* ignore */
    }
  }

  function waitForIdle(maxMs) {
    return new Promise((resolve) => {
      let quietTimer;
      const hardCap = setTimeout(finish, maxMs);
      let done = false;
      let observer;
      function finish() {
        if (done) return;
        done = true;
        clearTimeout(hardCap);
        clearTimeout(quietTimer);
        try {
          observer.disconnect();
        } catch (e) {}
        resolve();
      }
      try {
        observer = new MutationObserver(() => {
          clearTimeout(quietTimer);
          quietTimer = setTimeout(finish, 700);
        });
        observer.observe(document.documentElement, { childList: true, subtree: true, attributes: true });
        quietTimer = setTimeout(finish, 700);
      } catch (e) {
        finish();
      }
    });
  }

  await autoScroll();
  await waitForIdle(opts.maxSettleMs || 6000);

  const abs = (u) => {
    try {
      return new URL(u, document.baseURI).href;
    } catch {
      return null;
    }
  };

  const stylesheetUrls = new Set();
  document.querySelectorAll('link[rel~="stylesheet"][href]').forEach((l) => {
    const u = abs(l.getAttribute('href'));
    if (u) stylesheetUrls.add(u);
  });

  const links = new Set();
  document.querySelectorAll('a[href]').forEach((a) => {
    const u = abs(a.getAttribute('href'));
    if (u && /^https?:\/\//i.test(u)) links.add(u);
  });

  const title = document.title || '';
  const finalUrl = location.href;

  document.querySelectorAll('script, noscript, template').forEach((el) => el.remove());
  document.querySelectorAll('*').forEach((el) => {
    Array.from(el.attributes).forEach((attr) => {
      if (/^on/i.test(attr.name)) el.removeAttribute(attr.name);
    });
  });

  const doctype = document.doctype ? '<!DOCTYPE ' + document.doctype.name + '>' : '<!DOCTYPE html>';
  const html = doctype + '\n' + document.documentElement.outerHTML;

  return {
    finalUrl,
    title,
    html,
    stylesheetUrls: Array.from(stylesheetUrls),
    links: Array.from(links)
  };
}

export class Crawler {
  constructor({ startUrl, maxPages, maxDepth, concurrency, onLog, onProgress }) {
    this.startUrl = startUrl;
    this.maxPages = Math.max(1, Math.min(maxPages || 25, 300));
    this.maxDepth = Math.max(0, Math.min(maxDepth ?? 3, 10));
    this.concurrency = Math.max(1, Math.min(concurrency || 3, 6));
    this.onLog = onLog || (() => {});
    this.onProgress = onProgress || (() => {});
    this.cancelled = false;

    this.queue = [];
    this.visited = new Set();
    this.results = [];
    this.inFlight = 0;
    this.origin = null;
    this.windowId = null;
  }

  cancel() {
    this.cancelled = true;
  }

  log(msg) {
    this.onLog(msg);
  }

  async run() {
    const normalizedStart = normalizeUrl(this.startUrl);
    if (!normalizedStart) throw new Error('That does not look like a valid URL.');
    this.origin = new URL(normalizedStart).origin;
    this.queue.push({ url: normalizedStart, depth: 0 });
    this.visited.add(normalizedStart);

    // Do all the crawling in a single hidden, minimized window so it never
    // steals focus or flashes visibly on screen.
    const win = await chrome.windows.create({
      url: 'about:blank',
      type: 'popup',
      state: 'minimized',
      focused: false
    });
    this.windowId = win.id;

    const tabIds = [win.tabs[0].id];
    for (let i = 1; i < this.concurrency; i++) {
      const tab = await chrome.tabs.create({ windowId: win.id, url: 'about:blank', active: false });
      tabIds.push(tab.id);
    }

    try {
      await Promise.all(tabIds.map((tabId) => this._worker(tabId)));
    } finally {
      try {
        await chrome.windows.remove(win.id);
      } catch (e) {}
    }

    return this.results;
  }

  _dequeue() {
    if (this.results.length >= this.maxPages) return 'DONE';
    if (this.queue.length > 0) return this.queue.shift();
    if (this.inFlight > 0) return 'WAIT';
    return 'DONE';
  }

  async _worker(tabId) {
    while (!this.cancelled) {
      const item = this._dequeue();
      if (item === 'DONE') break;
      if (item === 'WAIT') {
        await sleep(80);
        continue;
      }
      this.inFlight++;
      try {
        await this._processOne(tabId, item);
      } catch (err) {
        this.log(`Failed: ${item.url} (${err.message || err})`);
      } finally {
        this.inFlight--;
      }
    }
  }

  _loadUrl(tabId, url, timeoutMs = 30000) {
    return new Promise((resolve, reject) => {
      let settled = false;
      const finish = (ok, err) => {
        if (settled) return;
        settled = true;
        chrome.tabs.onUpdated.removeListener(listener);
        clearTimeout(timer);
        ok ? resolve() : reject(err || new Error('Failed to load'));
      };
      const listener = (id, changeInfo) => {
        if (id !== tabId) return;
        if (changeInfo.status === 'complete') finish(true);
      };
      const timer = setTimeout(() => finish(false, new Error('Timed out loading page')), timeoutMs);
      chrome.tabs.onUpdated.addListener(listener);
      chrome.tabs.update(tabId, { url }).catch((e) => finish(false, e));
    });
  }

  async _processOne(tabId, item) {
    const { url, depth } = item;
    this.log(`Fetching (${this.results.length + 1}/${this.maxPages}): ${url}`);

    try {
      await this._loadUrl(tabId, url);
    } catch (err) {
      this.log(`  could not load: ${err.message}`);
      return;
    }

    if (this.cancelled) return;

    let captured;
    try {
      const injectionResults = await chrome.scripting.executeScript({
        target: { tabId },
        func: pageCaptureScript,
        args: [{ maxSettleMs: 6000 }]
      });
      captured = injectionResults[0] && injectionResults[0].result;
      if (!captured) throw new Error('No result returned from page');
    } catch (err) {
      this.log(`  could not read page contents: ${err.message}`);
      return;
    }

    let inlinedHtml = captured.html;
    try {
      inlinedHtml = await inlinePageResources(captured.html, captured.finalUrl || url, {
        timeoutMs: 12000,
        maxImageBytes: 4 * 1024 * 1024
      });
    } catch (err) {
      this.log(`  warning: some resources on ${url} could not be inlined (${err.message})`);
    }

    this.results.push({
      url,
      finalUrl: captured.finalUrl || url,
      title: captured.title || url,
      html: inlinedHtml
    });

    this.onProgress({
      done: this.results.length,
      total: this.maxPages,
      lastUrl: url,
      lastTitle: captured.title || url
    });

    if (depth < this.maxDepth) {
      for (const rawLink of captured.links) {
        const norm = normalizeUrl(rawLink);
        if (!norm) continue;
        if (new URL(norm).origin !== this.origin) continue;
        if (this.visited.has(norm)) continue;
        if (this.visited.size >= this.maxPages * 4) break; // safety valve
        this.visited.add(norm);
        this.queue.push({ url: norm, depth: depth + 1 });
      }
    }
  }
}
