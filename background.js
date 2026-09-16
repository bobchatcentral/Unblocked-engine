// Minimal service worker. All the real work happens in app.html/app.js,
// which — being an extension page — has the same chrome.* API access as
// this background script, so there's no need to relay messages back and
// forth. This file only exists to open the app when the toolbar icon is
// clicked (and to reuse an already-open tab if there is one).

chrome.action.onClicked.addListener(async () => {
  const appUrl = chrome.runtime.getURL('app.html');
  const existing = await chrome.tabs.query({ url: appUrl });
  if (existing.length) {
    chrome.tabs.update(existing[0].id, { active: true });
    chrome.windows.update(existing[0].windowId, { focused: true });
  } else {
    chrome.tabs.create({ url: appUrl });
  }
});

chrome.runtime.onInstalled.addListener((details) => {
  if (details.reason === 'install') {
    chrome.tabs.create({ url: chrome.runtime.getURL('app.html') });
  }
});
