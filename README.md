# Website Saver

A desktop app (macOS, Windows, Linux) that takes a URL, fully renders the site
— including JavaScript-heavy pages — crawls its internal links, and saves the
whole thing as **one self-contained HTML file**. That file has every image,
font, and stylesheet inlined, so it opens in any browser, fully offline, with
no additional downloads.

## How it works

- Built with **Electron**, which bundles its own Chromium browser engine. The
  packaged app end users install has everything it needs inside it — they
  never install Node.js, a browser, or any other runtime.
- For each page, a hidden Chromium window loads the URL and lets its
  JavaScript run and render normally (so React/Vue/etc. sites work), then a
  script inlines every external stylesheet, image, and font as embedded data
  and captures the resulting HTML.
- It follows links found on each page (same-domain by default) up to the page
  and depth limits you set, then bundles every captured page into one HTML
  file with a simple sidebar you can click through — no server required.

## Important limitation (by design)

The saved file is a **static snapshot**. Since the goal is a single file that
runs with no extra downloads and no server, the original page's own
JavaScript is stripped out of the saved copy. Static content, layout, images,
and text render exactly as captured. Things that depend on the *live* site's
own scripts after the snapshot is taken — search boxes that call an API,
infinite-scroll loading, login forms, animations driven by JS — won't be
interactive in the archive. Everything visible at capture time is preserved;
behavior that requires the original server or live scripts is not.

For very large sites, keep "Max pages" reasonable (the default of 40 is a
good starting point) — each page is rendered in a real Chromium instance, so
capturing hundreds of pages will take a while and produce a large file.


## Notes for advanced users

## Tuning performance

- `MAX_CONCURRENCY` in `crawler.js` (default 3) controls how many pages
  render in parallel. Raising it speeds up large crawls but uses more
  memory/CPU; lowering it is gentler on slower machines.
- `PAGE_LOAD_SETTLE_MS` in `crawler.js` (default 1200ms) is the extra wait
  after a page reports "loaded" before capturing it, to give JS-rendered
  content time to finish painting. Increase it for very JS-heavy sites that
  render slowly; decrease it to speed up simple sites.
