# Site Capturer — ChromeOS Extension

Same idea as the desktop app, but built as a Chrome Extension instead of an
Electron app — this is the native ChromeOS path, with **no Linux/Crostini
required**. It runs entirely inside Chrome, the same browser ChromeOS itself
is built on.

## How it's different from the desktop app

| | Desktop app (Electron) | This extension |
|---|---|---|
| Renders JS-heavy pages | hidden `BrowserWindow` | a real (minimized, hidden) browser tab |
| Reads the rendered page | `webContents.executeJavaScript` | `chrome.scripting.executeScript` |
| Downloads CSS/images cross-origin | Node `fetch` (no CORS at all) | `fetch()` from the extension, exempt from CORS via `host_permissions` |
| Saves the final file | native Save dialog + `fs.writeFileSync` | `chrome.downloads.download()` (native ChromeOS "Save As") |
| Install | `.dmg` / `.exe` / `.AppImage` | Add the extension — nothing else |

The output is the same: one self-contained `.html` file with every page's
text, styles, images, and fonts embedded, browsable offline via a small
built-in sidebar.

## Try it now (unpacked, for yourself or testing)

1. Open `chrome://extensions` (works identically on ChromeOS).
2. Turn on **Developer mode** (top-right toggle).
3. Click **Load unpacked** and select this `site-capturer-chromeos` folder.
4. Click the new Site Capturer icon in the toolbar — it opens the app in a
   new tab. Enter a URL, adjust the limits if you like, and click **Capture
   site**. When it finishes, Chrome's normal Save dialog opens.

No build step, no Node, no npm — it's plain HTML/CSS/JS, which is also why it
works on ChromeOS with zero developer-mode Linux container involved.

## Publishing it properly (so it installs like any other ChromeOS app)

1. Zip the contents of this folder (not the folder itself — `manifest.json`
   should be at the zip's root).
2. Create a one-time [Chrome Web Store developer account](https://chrome.google.com/webstore/devconsole) (a small one-time registration fee applies).
3. Upload the zip, fill in the listing details, and submit for review.
4. Once approved, anyone — including on ChromeOS — installs it with one click
   from the Web Store, exactly like any other extension. Still nothing to
   download separately, no Crostini, no sideloading required.

If you'd rather keep it private/internal (e.g. just for your own devices or
a small team), you can also publish as **unlisted** or use **Chrome Enterprise
policy** to force-install it on managed ChromeOS devices — both skip public
review while still giving a normal one-click install experience.

## Permissions this extension asks for, and why

- `tabs` / `windows` — to open a hidden window and load pages in it for capture.
- `scripting` — to read each page's fully-rendered DOM after its JavaScript runs.
- `downloads` — to save the finished file via ChromeOS's native Save dialog.
- `host_permissions: <all_urls>` — needed so capturing works on *any* site you
  point it at, and so the extension can fetch that site's CSS/images without
  CORS blocking it (a plain webpage can't do this; an extension with granted
  host permissions can).

## Same honest limitations as the desktop app

- Login-gated/paywalled content isn't handled specially — only what's
  reachable without extra authentication steps gets captured.
- Live/interactive behavior (checkout flows, live search, WebSockets) won't
  work in the saved copy — it's a rendered snapshot, not a working backend.
- Very large sites are capped by "Max pages"; images over ~4MB are left as
  remote links instead of embedded, to keep the file size sane.
- A handful of pages may fail to load if a site actively blocks automated
  browsing — those are logged and skipped rather than stopping the whole run.

## Project layout

```
manifest.json      Extension manifest (Manifest V3)
background.js       Opens the app tab when the toolbar icon is clicked
app.html/.css/.js    The app's UI — same look as the desktop app
lib/crawler.js       Drives hidden tabs, crawls links (chrome.tabs/scripting)
lib/resourceInliner.js  Fetches CSS/images/fonts, converts to data URIs
lib/bundler.js        Packs captured pages into the final single HTML file
lib/base64.js          Browser-safe base64 helpers (no Node Buffer available)
```
