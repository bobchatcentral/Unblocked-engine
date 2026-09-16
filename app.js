import { Crawler } from './lib/crawler.js';
import { buildBundle } from './lib/bundler.js';

const urlInput = document.getElementById('url');
const maxPagesInput = document.getElementById('maxPages');
const maxDepthInput = document.getElementById('maxDepth');
const concurrencyInput = document.getElementById('concurrency');

const startBtn = document.getElementById('startBtn');
const cancelBtn = document.getElementById('cancelBtn');

const logPanel = document.getElementById('logPanel');
const logEl = document.getElementById('log');
const logCount = document.getElementById('logCount');
const logTitle = document.getElementById('logTitle');

const resultPanel = document.getElementById('resultPanel');
const resultTitle = document.getElementById('resultTitle');
const resultPath = document.getElementById('resultPath');
const newBtn = document.getElementById('newBtn');

let running = false;
let activeCrawler = null;

function appendLog(msg, isErr) {
  const line = document.createElement('div');
  if (isErr) line.className = 'err';
  line.textContent = msg;
  logEl.appendChild(line);
  logEl.scrollTop = logEl.scrollHeight;
}

function normalizeUrlInput(raw) {
  let v = (raw || '').trim();
  if (!v) return '';
  if (!/^https?:\/\//i.test(v)) v = 'https://' + v;
  return v;
}

function suggestFileName(url) {
  try {
    const u = new URL(url);
    const host = u.hostname.replace(/^www\./, '').replace(/[^a-z0-9.-]/gi, '_');
    const date = new Date().toISOString().slice(0, 10);
    return `${host}-${date}.html`;
  } catch {
    return `captured-site-${Date.now()}.html`;
  }
}

function setRunning(isRunning) {
  running = isRunning;
  startBtn.hidden = isRunning;
  cancelBtn.hidden = !isRunning;
  [urlInput, maxPagesInput, maxDepthInput, concurrencyInput].forEach((el) => {
    el.disabled = isRunning;
  });
}

startBtn.addEventListener('click', async () => {
  const url = normalizeUrlInput(urlInput.value);
  if (!url) {
    urlInput.focus();
    return;
  }

  resultPanel.hidden = true;
  logEl.innerHTML = '';
  logCount.textContent = '';
  logTitle.textContent = 'Capturing…';
  logPanel.hidden = false;
  setRunning(true);
  appendLog(`Starting capture of ${url}`);

  const options = {
    maxPages: parseInt(maxPagesInput.value, 10) || 25,
    maxDepth: parseInt(maxDepthInput.value, 10) || 0,
    concurrency: parseInt(concurrencyInput.value, 10) || 3
  };

  activeCrawler = new Crawler({
    startUrl: url,
    ...options,
    onLog: (msg) => appendLog(msg),
    onProgress: (p) => {
      logCount.textContent = `${p.done} / ${p.total} pages`;
    }
  });

  try {
    const pages = await activeCrawler.run();
    setRunning(false);

    if (!pages.length) {
      logTitle.textContent = 'Stopped';
      appendLog('No pages were captured. Check the URL and try again.', true);
      return;
    }

    appendLog(`Bundling ${pages.length} page(s) into a single HTML file...`);
    const html = buildBundle(pages, { startUrl: url });
    const sizeMb = (new TextEncoder().encode(html).length / (1024 * 1024)).toFixed(2);

    const blob = new Blob([html], { type: 'text/html' });
    const blobUrl = URL.createObjectURL(blob);
    const filename = suggestFileName(url);

    chrome.downloads.download({ url: blobUrl, filename, saveAs: true }, (downloadId) => {
      // Give the browser a moment to read the blob before we free it.
      setTimeout(() => URL.revokeObjectURL(blobUrl), 30000);

      logTitle.textContent = 'Done';
      appendLog(`Saved ${pages.length} page(s) — ${sizeMb} MB`);

      resultTitle.textContent = `Captured ${pages.length} page${pages.length === 1 ? '' : 's'}`;
      resultPath.textContent = downloadId
        ? `Saved as ${filename} (see your Downloads)`
        : 'Save was cancelled or blocked — check the download permission for this extension.';
      resultPanel.hidden = false;
    });
  } catch (err) {
    setRunning(false);
    logTitle.textContent = 'Stopped';
    appendLog(err.message || String(err), true);
  } finally {
    activeCrawler = null;
  }
});

cancelBtn.addEventListener('click', () => {
  if (activeCrawler) {
    appendLog('Cancelling…');
    activeCrawler.cancel();
  }
});

newBtn.addEventListener('click', () => {
  resultPanel.hidden = true;
  logPanel.hidden = true;
  urlInput.value = '';
  urlInput.focus();
});

urlInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !running) startBtn.click();
});
