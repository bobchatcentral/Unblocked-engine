function escapeHtml(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function escapeAttr(s) {
  return String(s).replace(/"/g, '&quot;');
}

// Prevent embedded JSON from prematurely closing the <script> tag it lives in.
function safeForInlineScript(jsonString) {
  return jsonString.replace(/</g, '\\u003c');
}

function buildArchiveHtml(pages, startUrl) {
  const entries = Object.entries(pages);

  const navItems = entries
    .map(([url, p]) => {
      const label = escapeHtml(p.title || url);
      return `<li><a href="#" class="__nav-link" data-url="${escapeAttr(url)}" title="${escapeAttr(url)}">${label}</a></li>`;
    })
    .join('\n');

  const pagesJson = safeForInlineScript(JSON.stringify(pages));

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Website Archive</title>
<style>
  :root { color-scheme: light dark; }
  * { box-sizing: border-box; }
  html, body { height: 100%; margin: 0; }
  body {
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    display: flex;
  }
  #__nav {
    width: 280px;
    flex-shrink: 0;
    overflow-y: auto;
    border-right: 1px solid #d0d0d5;
    padding: 16px;
    background: #f6f6f8;
  }
  #__nav h2 {
    font-size: 12px;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: #777;
    margin: 0 0 10px;
  }
  #__nav ul { list-style: none; margin: 0; padding: 0; }
  #__nav li { margin-bottom: 2px; }
  #__nav a {
    display: block;
    padding: 7px 10px;
    border-radius: 6px;
    color: #222;
    text-decoration: none;
    font-size: 13px;
    line-height: 1.3;
    word-break: break-word;
  }
  #__nav a:hover { background: #e4e7f5; }
  #__nav a.active { background: #dbe3ff; font-weight: 600; }
  #__content-wrap { flex: 1; overflow-y: auto; min-width: 0; }
  #__content { min-height: 100%; }
  @media (max-width: 700px) {
    body { flex-direction: column; }
    #__nav { width: 100%; max-height: 40vh; border-right: none; border-bottom: 1px solid #d0d0d5; }
  }
</style>
</head>
<body>
<nav id="__nav">
  <h2>Pages (${entries.length})</h2>
  <ul>${navItems}</ul>
</nav>
<div id="__content-wrap"><div id="__content"></div></div>
<script>
(function () {
  var PAGES = ${pagesJson};
  var START_URL = ${JSON.stringify(startUrl)};
  var contentEl = document.getElementById('__content');

  function showPage(url) {
    var page = PAGES[url];
    if (!page) return;

    contentEl.innerHTML = page.bodyHTML;

    var existingStyles = document.getElementById('__page-styles');
    if (existingStyles) existingStyles.remove();
    var tmp = document.createElement('div');
    tmp.innerHTML = page.headHTML;
    var styleContainer = document.createElement('div');
    styleContainer.id = '__page-styles';
    Array.prototype.forEach.call(tmp.querySelectorAll('style'), function (s) {
      styleContainer.appendChild(s.cloneNode(true));
    });
    document.head.appendChild(styleContainer);

    document.title = page.title || url;
    Array.prototype.forEach.call(document.querySelectorAll('.__nav-link'), function (a) {
      a.classList.toggle('active', a.getAttribute('data-url') === url);
    });
    document.getElementById('__content-wrap').scrollTop = 0;
  }

  Array.prototype.forEach.call(document.querySelectorAll('.__nav-link'), function (a) {
    a.addEventListener('click', function (e) {
      e.preventDefault();
      showPage(a.getAttribute('data-url'));
    });
  });

  // Intercept in-content links that point to another captured page.
  document.getElementById('__content-wrap').addEventListener('click', function (e) {
    var a = e.target.closest ? e.target.closest('a') : null;
    if (!a) return;
    var href = a.getAttribute('href');
    if (!href || href.indexOf('#') === 0) return;
    try {
      var abs = new URL(href, START_URL).toString();
      var norm = abs.replace(/\\/$/, '');
      var match = PAGES[abs] ? abs : (PAGES[norm] ? norm : null);
      if (match) {
        e.preventDefault();
        showPage(match);
      }
      // otherwise let the browser handle it as a normal (external) link
    } catch (err) {}
  });

  showPage(PAGES[START_URL] ? START_URL : Object.keys(PAGES)[0]);
})();
</script>
</body>
</html>`;
}

module.exports = { buildArchiveHtml };
