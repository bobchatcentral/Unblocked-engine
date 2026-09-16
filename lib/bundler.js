import { utf8ToBase64 } from './base64.js';

function esc(s) {
  return String(s || '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));
}

function withNavBootstrap(html, urlToId) {
  const mapJson = JSON.stringify(urlToId).replace(/<\/script/gi, '<\\/script');
  const bootstrap = `
<script>(function(){
  var MAP = ${mapJson};
  function normalize(href){
    try {
      var u = new URL(href, document.baseURI);
      u.hash = '';
      if (u.pathname !== '/' && u.pathname.endsWith('/')) u.pathname = u.pathname.slice(0, -1);
      return u.href;
    } catch (e) { return null; }
  }
  document.addEventListener('click', function(e){
    var a = e.target && e.target.closest ? e.target.closest('a[href]') : null;
    if (!a) return;
    var href = a.getAttribute('href');
    if (!href || href.charAt(0) === '#') return;
    var abs = normalize(href);
    if (abs && Object.prototype.hasOwnProperty.call(MAP, abs)) {
      e.preventDefault();
      parent.postMessage({ __siteCapturer: true, navigate: MAP[abs] }, '*');
    } else if (/^https?:\\/\\//i.test(href) || (abs && /^https?:\\/\\//i.test(abs))) {
      a.setAttribute('target', '_blank');
      a.setAttribute('rel', 'noopener noreferrer');
    }
  }, true);
})();</script>`;
  if (/<\/body>/i.test(html)) return html.replace(/<\/body>/i, bootstrap + '\n</body>');
  return html + bootstrap;
}

export function buildBundle(pages, { startUrl }) {
  const urlToId = {};
  pages.forEach((p, i) => {
    urlToId[p.url] = i;
    if (p.finalUrl && p.finalUrl !== p.url) urlToId[p.finalUrl] = i;
  });

  const payload = pages.map((p, i) => ({
    id: i,
    url: p.url,
    title: p.title || p.url,
    html: withNavBootstrap(p.html, urlToId)
  }));

  const payloadB64 = utf8ToBase64(JSON.stringify(payload));
  const capturedAt = new Date().toISOString();
  const home = esc(startUrl);

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Offline copy — ${home}</title>
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>
  :root{
    --ink:#10131a; --panel:#161a23; --panel-2:#1c212c; --line:rgba(255,255,255,.08);
    --text:#e7e9ee; --muted:#8b93a6; --amber:#e8b339; --amber-dim:#8a6a24;
  }
  *{box-sizing:border-box}
  html,body{height:100%}
  body{
    margin:0; background:var(--ink); color:var(--text);
    font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",system-ui,sans-serif;
    display:flex; flex-direction:column;
  }
  header{
    display:flex; align-items:center; gap:.75rem; padding:.7rem 1rem;
    background:var(--panel); border-bottom:1px solid var(--line); flex:0 0 auto;
  }
  header .seal{
    width:10px;height:10px;border-radius:50%;background:var(--amber);
    box-shadow:0 0 0 3px rgba(232,179,57,.15); flex:0 0 auto;
  }
  header .meta{min-width:0}
  header .meta .src{
    font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;
    font-size:.78rem; color:var(--muted); white-space:nowrap; overflow:hidden; text-overflow:ellipsis;
  }
  header .meta .title{font-size:.9rem; font-weight:600}
  header .count{
    margin-left:auto; font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;
    font-size:.75rem; color:var(--muted); border:1px solid var(--line); border-radius:6px; padding:.25rem .55rem;
    white-space:nowrap;
  }
  .body{flex:1 1 auto; display:flex; min-height:0}
  nav{
    width:300px; flex:0 0 auto; background:var(--panel); border-right:1px solid var(--line);
    display:flex; flex-direction:column; min-height:0;
  }
  nav .search{padding:.6rem; border-bottom:1px solid var(--line)}
  nav .search input{
    width:100%; background:var(--panel-2); border:1px solid var(--line); color:var(--text);
    border-radius:6px; padding:.45rem .6rem; font-size:.85rem; outline:none;
  }
  nav .search input:focus{border-color:var(--amber-dim)}
  nav .list{overflow-y:auto; flex:1 1 auto}
  .item{
    display:flex; gap:.6rem; align-items:flex-start; padding:.55rem .75rem; cursor:pointer;
    border-left:2px solid transparent; border-bottom:1px solid var(--line);
  }
  .item:hover{background:var(--panel-2)}
  .item.active{background:var(--panel-2); border-left-color:var(--amber)}
  .item .tag{
    font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace; font-size:.7rem; color:var(--amber-dim);
    padding-top:.1rem; flex:0 0 auto;
  }
  .item .t{min-width:0}
  .item .t .ti{font-size:.83rem; line-height:1.25; word-break:break-word}
  .item .t .u{
    font-size:.7rem; color:var(--muted); overflow:hidden; text-overflow:ellipsis; white-space:nowrap;
  }
  main{flex:1 1 auto; min-width:0; display:flex; background:#fff}
  iframe{border:0; width:100%; height:100%}
  footer{
    flex:0 0 auto; padding:.4rem 1rem; border-top:1px solid var(--line); background:var(--panel);
    font-size:.7rem; color:var(--muted); font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;
  }
</style>
</head>
<body>
  <header>
    <div class="seal"></div>
    <div class="meta">
      <div class="title">Offline site archive</div>
      <div class="src">${home}</div>
    </div>
    <div class="count">${pages.length} page${pages.length === 1 ? '' : 's'} captured</div>
  </header>
  <div class="body">
    <nav>
      <div class="search"><input id="q" type="text" placeholder="Filter captured pages..."></div>
      <div class="list" id="list"></div>
    </nav>
    <main>
      <iframe id="viewer" sandbox="allow-scripts allow-popups allow-popups-to-escape-sandbox allow-forms"></iframe>
    </main>
  </div>
  <footer>captured ${esc(capturedAt)} · self-contained, works fully offline · no data leaves this file</footer>

  <script id="__site_data__" type="text/plain">${payloadB64}</script>
  <script>
  (function(){
    var raw = atob(document.getElementById('__site_data__').textContent.trim());
    var bytes = new Uint8Array(raw.length);
    for (var i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
    var json = new TextDecoder('utf-8').decode(bytes);
    var PAGES = JSON.parse(json);

    var listEl = document.getElementById('list');
    var viewer = document.getElementById('viewer');
    var qEl = document.getElementById('q');
    var items = [];

    function render(filter){
      listEl.innerHTML = '';
      items = [];
      var f = (filter || '').toLowerCase();
      PAGES.forEach(function(p){
        var hay = (p.title + ' ' + p.url).toLowerCase();
        if (f && hay.indexOf(f) === -1) return;
        var el = document.createElement('div');
        el.className = 'item';
        el.dataset.id = p.id;
        el.innerHTML =
          '<div class="tag">' + String(p.id + 1).padStart(2,'0') + '</div>' +
          '<div class="t"><div class="ti"></div><div class="u"></div></div>';
        el.querySelector('.ti').textContent = p.title;
        el.querySelector('.u').textContent = p.url;
        el.addEventListener('click', function(){ go(p.id); });
        listEl.appendChild(el);
        items.push(el);
      });
    }

    function go(id){
      var page = PAGES[id];
      if (!page) return;
      viewer.srcdoc = page.html;
      items.forEach(function(el){ el.classList.toggle('active', Number(el.dataset.id) === id); });
      try { history.replaceState(null, '', '#p' + id); } catch(e){}
    }

    qEl.addEventListener('input', function(){ render(qEl.value); });

    window.addEventListener('message', function(e){
      var d = e.data;
      if (d && d.__siteCapturer && typeof d.navigate === 'number') go(d.navigate);
    });

    render('');
    var startId = 0;
    if (location.hash && /^#p\\d+$/.test(location.hash)) {
      startId = parseInt(location.hash.slice(2), 10) || 0;
    }
    if (PAGES.length) go(startId);
  })();
  </script>
</body>
</html>`;
}
