/* First-party attribution only; no email, auth codes, paths or content stored. */
(function () {
  if (window.minacoAttribution) return;
  var key = 'minaco.attribution.v1';
  var maxAge = 90 * 86400000;
  var fields = ['gclid', 'gbraid', 'wbraid', 'utm_source', 'utm_medium', 'utm_campaign', 'utm_id', 'utm_term', 'utm_content', 'utm_source_platform', 'utm_creative_format', 'utm_marketing_tactic'];
  var landing = document.currentScript && document.currentScript.dataset.landing === 'true';
  var memory = null;
  function allowed() {
    var choice = window.__minacoConsent;
    try { choice = localStorage.getItem('minaco.consent.v1') || choice; } catch (_) {}
    return !choice || choice === 'all';
  }
  function read() {
    if (!allowed()) return null;
    try { memory = JSON.parse(localStorage.getItem(key)) || memory; } catch (_) {}
    if (!memory) return null;
    ['first', 'last'].forEach(function (part) {
      if (!memory[part] || Date.now() - memory[part].at > maxAge) memory[part] = null;
    });
    return memory;
  }
  function write(value) {
    memory = value;
    try { if (value) localStorage.setItem(key, JSON.stringify(value)); else localStorage.removeItem(key); } catch (_) {}
  }
  function capture() {
    if (!allowed()) { write(null); return; }
    var params = new URLSearchParams(location.search);
    var touch = {};
    fields.forEach(function (field) {
      var value = params.get(field);
      if (value && value.length <= 200 && !/[<>\x00-\x1f]/.test(value)) touch[field] = value;
    });
    if (!Object.keys(touch).length) { read(); return; }
    touch.at = Date.now();
    var previous = read() || {};
    // A new explicit campaign is eligible for a fresh account binding.
    // Ordinary authenticated navigation never becomes a new touch.
    var last = previous.last;
    var same = last && fields.every(function (field) { return last[field] === touch[field]; });
    if (same) return;
    write({ first: previous.boundUserId ? touch : previous.first || touch, last: touch, boundUserId: null });
  }
  window.minacoAttribution = {
    read: function (userId) {
      var value = read();
      if (!value || (value.boundUserId && value.boundUserId !== userId)) return null;
      return { first: value.first, last: value.last };
    },
    bind: function (userId) {
      var value = read();
      if (value && (!value.boundUserId || value.boundUserId === userId)) {
        value.boundUserId = userId; write(value);
      }
    }
  };
  capture();
  window.addEventListener('minaco:consent-changed', capture);
  window.addEventListener('storage', function (event) {
    if (event.key === 'minaco.consent.v1' || event.key === null) capture();
  });
  if (landing) {
    // Only campaign parameters reach GA4; never forward arbitrary query values.
    var url = new URL(location.origin + location.pathname);
    var query = new URLSearchParams(location.search);
    fields.forEach(function (field) { if (query.has(field)) url.searchParams.set(field, query.get(field).slice(0, 200)); });
    if (window.gtag) window.gtag('event', 'page_view', {page_location: url.href, page_path:'/', page_title:document.title, route_name:'landing', app_area:'marketing'});
    document.addEventListener('click', function (event) {
      var link = event.target instanceof Element && event.target.closest('a[href]');
      if (!link || !window.gtag) return;
      var target = new URL(link.href, location.href);
      if (target.origin !== location.origin) return;
      var name = target.pathname === '/api/download' ? 'download_click' : target.pathname === '/sign-up' ? 'sign_up_click' : target.pathname === '/account' && target.searchParams.get('view') === 'plan' ? 'plan_click' : null;
      if (name) window.gtag('event', name, {destination:target.pathname, app_area:'marketing'});
    }, true);
  }
})();
