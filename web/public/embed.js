/*!
 * Vigilante embed loader. Paste one tag where the console should appear:
 *   <script src="https://YOUR-SITE/embed.js" data-city="denver" data-view="dashboard" async></script>
 * Options (all optional):
 *   data-view    dashboard | map                         (default dashboard)
 *   data-city    denver | atlanta | lat,lon              (default: the visitor's last choice, else Denver)
 *   data-theme   tactical | nightvision | amber | redlight | steel
 *   data-height  CSS height, e.g. 640 or 70vh            (default 620px)
 *   data-target  CSS selector of an element to fill instead of inserting after the tag
 * The console runs in a sandboxed iframe from this site; it sets no cookies and tracks no one.
 */
(function () {
  'use strict';
  var VIEWS = { dashboard: 1, map: 1 };
  var THEMES = { tactical: 1, nightvision: 1, amber: 1, redlight: 1, steel: 1 };
  var CITY = /^(denver|atlanta|-?\d{1,2}(\.\d+)?,-?\d{1,3}(\.\d+)?)$/;

  function clean(v) {
    return String(v == null ? '' : v).trim().toLowerCase().replace(/\s+/g, '');
  }

  /** Embed page URL for a base URL (the folder embed.js is served from) and data-* options. */
  function src(base, o) {
    o = o || {};
    var q = [];
    var view = clean(o.view);
    var city = clean(o.city);
    var theme = clean(o.theme);
    if (VIEWS[view]) q.push('view=' + view);
    if (CITY.test(city)) q.push('city=' + encodeURIComponent(city));
    if (THEMES[theme]) q.push('theme=' + theme);
    return String(base).replace(/\/?$/, '/') + 'embed.html' + (q.length ? '?' + q.join('&') : '');
  }

  function height(v) {
    var s = String(v == null ? '' : v).trim();
    if (/^\d+$/.test(s)) return s + 'px';
    if (/^\d+(\.\d+)?(px|vh|em|rem|%)$/.test(s)) return s;
    return '620px';
  }

  function mount(script) {
    if (!script || script.getAttribute('data-vigilante-mounted')) return null;
    script.setAttribute('data-vigilante-mounted', '1');
    var d = script.dataset || {};
    var base = new URL('.', script.src).href;
    var frame = document.createElement('iframe');
    frame.src = src(base, d);
    frame.title = 'Vigilante situational awareness console';
    frame.loading = 'lazy';
    frame.referrerPolicy = 'strict-origin-when-cross-origin';
    frame.setAttribute('allow', 'fullscreen');
    frame.setAttribute('allowfullscreen', '');
    // Scripts and storage for the app itself; it can open links in new tabs but can't navigate your page.
    frame.setAttribute('sandbox', 'allow-scripts allow-same-origin allow-popups allow-popups-to-escape-sandbox');
    frame.style.cssText = 'display:block;width:100%;max-width:100%;height:' + height(d.height) + ';min-height:360px;border:0;border-radius:8px;background:#0b0f14;color-scheme:dark';
    var target = d.target ? document.querySelector(d.target) : null;
    if (target) target.appendChild(frame);
    else script.parentNode.insertBefore(frame, script.nextSibling);
    return frame;
  }

  window.VigilanteEmbed = { src: src, mount: mount };
  var me = document.currentScript;
  if (me) mount(me);
  else {
    // Fallback for loaders that inject the tag without currentScript.
    var all = document.querySelectorAll('script[src*="embed.js"]:not([data-vigilante-mounted])');
    for (var i = 0; i < all.length; i++) mount(all[i]);
  }
})();
