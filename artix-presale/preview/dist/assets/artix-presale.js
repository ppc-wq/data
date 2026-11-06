/* Artix Pro presale page behavior: color, tier selection, live inventory, checkout, tracking. No dependencies. */
(function () {
  'use strict';
  var root = document.querySelector('[data-artix]');
  var cfgEl = document.querySelector('[data-artix-config]');
  if (!root || !cfgEl) return;

  var cfg;
  try { cfg = JSON.parse(cfgEl.textContent); } catch (e) { return; }
  var DEMO = window.ARTIX_DEMO === true;
  var reduceMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var state = { color: 'navy', tier: null, busy: false };

  /* ---------- helpers ---------- */
  function $(sel, ctx) { return (ctx || root).querySelector(sel); }
  function $$(sel, ctx) { return Array.prototype.slice.call((ctx || root).querySelectorAll(sel)); }
  var money2 = new Intl.NumberFormat('en-US', { style: 'currency', currency: cfg.currency || 'USD' });
  var money0 = new Intl.NumberFormat('en-US', { style: 'currency', currency: cfg.currency || 'USD', maximumFractionDigits: 0 });
  function fmt(c) { return money2.format(c / 100); }
  function fmtShort(c) { return c % 100 === 0 ? money0.format(c / 100) : fmt(c); }
  function num(n) { return n.toLocaleString('en-US'); }
  function remaining(t) { return Math.max(0, Math.min(t.cap, t.q)); }
  function pctOff(t) { return Math.round((cfg.launch - t.price) * 100 / cfg.launch); }
  function colorName() { return state.color === 'black' ? 'Black' : 'Navy'; }
  function openTier() {
    for (var i = 0; i < cfg.tiers.length; i++) {
      var t = cfg.tiers[i];
      if (t.a !== false && remaining(t) > 0) return t;
    }
    return null;
  }
  function tierByN(n) { return cfg.tiers.filter(function (t) { return t.n === n; })[0] || null; }
  function statusOf(t, open) {
    if (open && t.n === open.n) return 'open';
    if (remaining(t) === 0 || t.a === false) return 'soldout';
    return 'next';
  }
  function store(key, val) {
    try {
      if (val === undefined) return JSON.parse(sessionStorage.getItem(key) || 'null');
      sessionStorage.setItem(key, JSON.stringify(val));
    } catch (e) { return null; }
  }
  function say(msg) { var el = $('[data-status-msg]'); if (el) el.textContent = msg || ''; }

  /* ---------- attribution: UTMs, click IDs, referral code (kept through to checkout) ---------- */
  var ATTR_KEYS = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term', 'fbclid', 'gclid', 'ref'];
  var attr = store('artix_attr') || {};
  (function () {
    var q = new URLSearchParams(location.search), changed = false;
    ATTR_KEYS.forEach(function (k) { var v = q.get(k); if (v) { attr[k] = v.slice(0, 200); changed = true; } });
    if (changed) store('artix_attr', attr);
  })();

  /* ---------- tracking: dataLayer always, Meta Pixel / GA4 only when IDs are set and consent allows ---------- */
  window.dataLayer = window.dataLayer || [];
  var consent = { analytics: true, marketing: true }, pixelsLoaded = { meta: false, ga: false };
  function readConsent() {
    var cp = window.Shopify && window.Shopify.customerPrivacy;
    if (!cp) return;
    try { consent = { analytics: !!cp.analyticsProcessingAllowed(), marketing: !!cp.marketingAllowed() }; } catch (e) {}
  }
  function loadPixels() {
    readConsent();
    if (cfg.metaPixelId && consent.marketing && !pixelsLoaded.meta) {
      pixelsLoaded.meta = true;
      /* Standard Meta Pixel base code */
      !function (f, b, e, v, n, t, s) { if (f.fbq) return; n = f.fbq = function () { n.callMethod ? n.callMethod.apply(n, arguments) : n.queue.push(arguments); }; if (!f._fbq) f._fbq = n; n.push = n; n.loaded = !0; n.version = '2.0'; n.queue = []; t = b.createElement(e); t.async = !0; t.src = v; s = b.getElementsByTagName(e)[0]; s.parentNode.insertBefore(t, s); }(window, document, 'script', 'https://connect.facebook.net/en_US/fbevents.js');
      window.fbq('init', cfg.metaPixelId);
    }
    if (cfg.ga4Id && consent.analytics && !pixelsLoaded.ga) {
      pixelsLoaded.ga = true;
      var s = document.createElement('script'); s.async = true; s.src = 'https://www.googletagmanager.com/gtag/js?id=' + encodeURIComponent(cfg.ga4Id);
      document.head.appendChild(s);
      window.gtag = window.gtag || function () { window.dataLayer.push(arguments); };
      window.gtag('js', new Date());
      window.gtag('config', cfg.ga4Id, { send_page_view: false });
    }
  }
  var META_MAP = { page_view: 'PageView', view_content: 'ViewContent', add_to_cart: 'AddToCart', begin_checkout: 'InitiateCheckout', purchase: 'Purchase' };
  function itemFor(t) {
    return { item_id: String(t.id), item_name: 'Artix Pro', item_variant: 'Tier ' + t.n + ' ' + t.name + ' / ' + colorName(), price: t.price / 100, quantity: 1 };
  }
  function track(name, params) {
    params = params || {};
    var payload = Object.assign({ event: name, currency: cfg.currency || 'USD' }, params);
    window.dataLayer.push(payload);
    if (window.gtag && pixelsLoaded.ga) window.gtag('event', name, Object.assign({ currency: cfg.currency || 'USD' }, params));
    if (window.fbq && pixelsLoaded.meta) {
      var meta = { currency: cfg.currency || 'USD' };
      if (params.value != null) meta.value = params.value;
      if (params.items) { meta.content_ids = params.items.map(function (i) { return i.item_id; }); meta.content_type = 'product'; }
      if (params.tier) meta.tier = params.tier;
      if (params.color) meta.color = params.color;
      if (META_MAP[name]) window.fbq('track', META_MAP[name], meta);
      else window.fbq('trackCustom', name, meta);
    }
  }
  window.artixTrack = track; // reusable by other pages (e.g. referral_link_copied)

  /* ---------- rendering of live values ---------- */
  function render() {
    var open = openTier();
    var total = 0, totalCap = 0;

    cfg.tiers.forEach(function (t) {
      var rem = remaining(t), res = t.cap - rem, st = statusOf(t, open);
      total += res; totalCap += t.cap;
      var card = $('[data-tier="' + t.n + '"]');
      if (!card) return;
      card.setAttribute('data-status', st);
      var input = $('input', card), cta = $('[data-reserve-tier]', card), badge = $('[data-tier-badge]', card);
      input.disabled = st !== 'open';
      if (st !== 'open' && input.checked) input.checked = false;
      input.setAttribute('aria-label', 'Tier ' + t.n + ' · ' + t.name + ', ' + fmt(t.price) + ', ' + rem + ' left');
      badge.textContent = st === 'open' ? 'Open now' : st === 'soldout' ? 'Sold out' : 'Next';
      var bar = $('[data-tier-bar]', card);
      bar.setAttribute('aria-valuenow', res);
      bar.firstElementChild.style.width = (t.cap ? Math.round(res * 100 / t.cap) : 0) + '%';
      $('[data-tier-units]', card).textContent = num(res) + ' / ' + num(t.cap) + ' reserved · ' + num(rem) + ' left';
      cta.disabled = st !== 'open';
      if (!state.busy || st !== 'open') cta.textContent = st === 'open' ? 'Reserve for $5' : st === 'soldout' ? 'Sold out' : 'Opens when Tier ' + (t.n - 1) + ' sells out';
    });

    var tr = $('[data-total-reserved]'); if (tr) tr.textContent = num(total);
    $$('[data-when-open]').forEach(function (el) { el.hidden = !open; });
    $$('[data-when-soldout]').forEach(function (el) { el.hidden = !!open; });
    if (open) {
      $('[data-open-price]').textContent = fmt(open.price);
      $('[data-open-pct]').textContent = pctOff(open) + '% off';
    }
    var ft = $('[data-final-title]'), fs = $('[data-final-sub]'), fb = $('[data-reserve="final"]');
    if (ft) ft.textContent = open ? 'Only ' + num(remaining(open)) + ' pairs left at ' + fmt(open.price) + '.' : 'Presale is sold out.';
    if (fs) fs.textContent = open ? 'Reserve now for $5. Fully refundable, ships ' + cfg.shipDate + '.' : 'Artix Pro launches at ' + fmt(cfg.launch) + '.';
    if (fb) fb.disabled = !open;
    $$('[data-reserve="header"], [data-reserve="hero"]').forEach(function (b) { b.disabled = !open; });

    // A selected tier that is no longer open is released; the shopper sees the next price before paying.
    if (state.tier) {
      var sel = tierByN(state.tier);
      if (!sel || statusOf(sel, open) !== 'open') {
        state.tier = null;
        say(open && sel ? 'Tier ' + sel.n + ' just sold out. Tier ' + open.n + ' is now open at ' + fmt(open.price) + '.' : 'The presale just sold out.');
      }
    }
  }

  /* ---------- live inventory (Section Rendering API, no token needed) ---------- */
  var pollTimer = null;
  function refresh() {
    if (DEMO || !cfg.handle) return Promise.resolve();
    var url = '/products/' + encodeURIComponent(cfg.handle) + '?section_id=artix-inventory&t=' + Date.now();
    return fetch(url, { credentials: 'same-origin', headers: { Accept: 'text/html' } })
      .then(function (r) { if (!r.ok) throw new Error(r.status); return r.text(); })
      .then(function (html) {
        var doc = new DOMParser().parseFromString(html, 'text/html');
        var el = doc.querySelector('[data-artix-inventory]');
        if (!el) return;
        var data = JSON.parse(el.textContent);
        (data.v || []).forEach(function (row) {
          cfg.tiers.forEach(function (t) { if (t.id === row.id) { t.q = row.q; t.a = row.a; } });
        });
        render();
      })
      .catch(function () { /* keep last known live values; never substitute numbers */ });
  }
  function schedule() {
    clearTimeout(pollTimer);
    if (document.visibilityState === 'visible') pollTimer = setTimeout(function () { refresh().then(schedule); }, Math.max(15, cfg.pollSeconds || 30) * 1000);
  }
  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'visible') refresh().then(schedule); else clearTimeout(pollTimer);
  });

  /* ---------- color ---------- */
  function setColor(c, fromUser) {
    if (c !== 'navy' && c !== 'black') return;
    state.color = c;
    root.setAttribute('data-color', c);
    $$('[data-set-color]').forEach(function (b) { b.setAttribute('aria-pressed', String(b.getAttribute('data-set-color') === c)); });
    var lbl = $('[data-color-label]'); if (lbl) lbl.textContent = colorName();
    if (fromUser) track('select_color', { color: colorName() });
  }
  root.addEventListener('click', function (e) {
    var b = e.target.closest('[data-set-color]');
    if (b) setColor(b.getAttribute('data-set-color'), true);
  });

  /* ---------- tier selection ---------- */
  function selectTier(n, fromUser) {
    var t = tierByN(n), open = openTier();
    if (!t || statusOf(t, open) !== 'open') return false;
    var changed = state.tier !== n;
    state.tier = n;
    var input = $('#ax-tier-' + n); if (input) input.checked = true;
    say('');
    if (fromUser && changed) track('select_tier', { tier: 'Tier ' + t.n + ' ' + t.name, value: t.price / 100, items: [itemFor(t)] });
    return true;
  }
  $$('input[name="ax-tier"]').forEach(function (input) {
    input.addEventListener('change', function () { if (input.checked) selectTier(Number(input.value), true); });
  });

  function goToTiers() {
    var sec = document.getElementById('reserve');
    if (!sec) return;
    sec.scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth', block: 'start' });
    var h = document.getElementById('ax-tiers-title');
    if (h) setTimeout(function () { h.focus({ preventScroll: true }); }, reduceMotion ? 0 : 450);
  }

  /* ---------- checkout ---------- */
  function post(url, body) {
    return fetch(url, { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, body: JSON.stringify(body || {}) });
  }
  function toast(msg) {
    var t = document.createElement('div'); t.className = 'ax-toast'; t.setAttribute('role', 'status'); t.textContent = msg;
    document.body.appendChild(t); setTimeout(function () { t.remove(); }, 4200);
  }
  function checkoutQuery() {
    var q = new URLSearchParams();
    ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term'].forEach(function (k) { if (attr[k]) q.set(k, attr[k]); });
    var s = q.toString(); return s ? '?' + s : '';
  }
  function reserve(btn) {
    if (state.busy) return;
    var t = state.tier ? tierByN(state.tier) : null;
    if (!t || statusOf(t, openTier()) !== 'open') { goToTiers(); return; }
    var item = itemFor(t), color = colorName(), label = btn ? btn.textContent : '';
    state.busy = true;
    if (btn) { btn.setAttribute('aria-busy', 'true'); btn.textContent = 'Reserving…'; }
    function done() { state.busy = false; if (btn) { btn.removeAttribute('aria-busy'); btn.textContent = label; } render(); }

    track('add_to_cart', { tier: 'Tier ' + t.n + ' ' + t.name, color: color, value: t.price / 100, items: [item] });

    if (DEMO) {
      setTimeout(function () { toast('Preview only: this would open Shopify checkout for Tier ' + t.n + ' (' + fmt(t.price) + ') in ' + color + ' with a $5 deposit.'); done(); }, 400);
      return;
    }
    var line = { id: t.id, quantity: 1, properties: { Color: color } };
    if (t.plan) line.selling_plan = t.plan;
    var attributes = { 'Presale color': color, 'Presale tier': 'Tier ' + t.n + ' ' + t.name };
    ATTR_KEYS.forEach(function (k) { if (attr[k]) attributes[k === 'ref' ? 'referral_code' : k] = attr[k]; });

    post('/cart/clear.js')
      .then(function () { return post('/cart/add.js', { items: [line] }); })
      .then(function (r) {
        if (r.ok) return r.json();
        // Usually 422: the tier sold out between page refresh and click.
        return refresh().then(function () {
          var open = openTier();
          state.tier = null;
          say(open ? 'Tier ' + t.n + ' just sold out. Tier ' + open.n + ' is now open at ' + fmt(open.price) + '. Pick it to continue.' : 'The presale just sold out.');
          throw new Error('add_failed');
        });
      })
      .then(function () { return post('/cart/update.js', { attributes: attributes }); })
      .then(function () {
        track('begin_checkout', { tier: 'Tier ' + t.n + ' ' + t.name, color: color, value: t.price / 100, items: [item] });
        setTimeout(function () { window.location.href = '/checkout' + checkoutQuery(); }, 200);
      })
      .catch(function (err) {
        if (!err || err.message !== 'add_failed') say('Something went wrong reaching checkout. Please try again.');
        done();
        goToTiers();
      });
  }

  root.addEventListener('click', function (e) {
    var tb = e.target.closest('[data-reserve-tier]');
    if (tb) { if (selectTier(Number(tb.getAttribute('data-reserve-tier')), true)) reserve(tb); return; }
    var rb = e.target.closest('[data-reserve]');
    if (rb) reserve(rb);
  });

  /* ---------- header menu (mobile) ---------- */
  var toggle = $('.ax-nav__toggle'), list = $('#ax-nav-list');
  function closeMenu() { if (toggle) { toggle.setAttribute('aria-expanded', 'false'); list.classList.remove('is-open'); } }
  if (toggle && list) {
    toggle.addEventListener('click', function () {
      var open = toggle.getAttribute('aria-expanded') !== 'true';
      toggle.setAttribute('aria-expanded', String(open)); list.classList.toggle('is-open', open);
    });
    list.addEventListener('click', function (e) { if (e.target.closest('a')) closeMenu(); });
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape') { closeMenu(); } });
    document.addEventListener('click', function (e) { if (!e.target.closest('.ax-nav')) closeMenu(); });
  }

  /* ---------- FAQ: one open at a time (fallback for browsers without <details name>) ---------- */
  $$('.ax-faq__item').forEach(function (d) {
    d.addEventListener('toggle', function () {
      if (d.open) $$('.ax-faq__item').forEach(function (o) { if (o !== d) o.open = false; });
    });
  });

  /* ---------- view_content when the tier section is seen ---------- */
  var tierSec = $('[data-view-content]');
  if (tierSec && 'IntersectionObserver' in window) {
    var io = new IntersectionObserver(function (entries) {
      if (entries.some(function (en) { return en.isIntersecting; })) {
        io.disconnect();
        var open = openTier();
        track('view_content', open ? { value: open.price / 100, items: [itemFor(open)] } : {});
      }
    }, { threshold: 0.35 });
    io.observe(tierSec);
  }

  /* ---------- init ---------- */
  function initTracking() {
    loadPixels();
    track('page_view', { page_location: location.href, page_title: document.title });
  }
  if (window.Shopify && typeof window.Shopify.loadFeatures === 'function') {
    window.Shopify.loadFeatures([{ name: 'consent-tracking-api', version: '0.1' }], function () { initTracking(); });
    document.addEventListener('visitorConsentCollected', loadPixels);
  } else {
    initTracking();
  }

  setColor('navy', false);
  render();
  refresh().then(schedule);
})();
