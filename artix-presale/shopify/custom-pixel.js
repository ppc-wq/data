// Artix presale: purchase tracking for Shopify checkout.
// Paste into Shopify admin → Settings → Customer events → Add custom pixel.
// Fill in the two IDs below. Leave an ID empty if the Facebook & Instagram or
// Google & YouTube app already sends Purchase / purchase, or you will count orders twice.
//
// Note: for a pre-order with a deposit, Shopify's checkout total is the full order
// amount; the $5 is the amount charged today. We report the full tier price as value.

const META_PIXEL_ID = '';   // e.g. '1234567890'
const GA4_ID = '';          // e.g. 'G-XXXXXXX'

function loadMeta() {
  if (!META_PIXEL_ID || window.fbq) return;
  !function (f, b, e, v, n, t, s) { if (f.fbq) return; n = f.fbq = function () { n.callMethod ? n.callMethod.apply(n, arguments) : n.queue.push(arguments); }; if (!f._fbq) f._fbq = n; n.push = n; n.loaded = !0; n.version = '2.0'; n.queue = []; t = b.createElement(e); t.async = !0; t.src = v; s = b.getElementsByTagName(e)[0]; s.parentNode.insertBefore(t, s); }(window, document, 'script', 'https://connect.facebook.net/en_US/fbevents.js');
  window.fbq('init', META_PIXEL_ID);
}
function loadGA() {
  if (!GA4_ID || window.gtag) return;
  const s = document.createElement('script');
  s.async = true;
  s.src = 'https://www.googletagmanager.com/gtag/js?id=' + GA4_ID;
  document.head.appendChild(s);
  window.dataLayer = window.dataLayer || [];
  window.gtag = function () { window.dataLayer.push(arguments); };
  window.gtag('js', new Date());
  window.gtag('config', GA4_ID, { send_page_view: false });
}

analytics.subscribe('checkout_completed', (event) => {
  const c = event.data.checkout;
  const lines = c.lineItems || [];
  // Only report presale orders (the landing page sets this cart attribute).
  const attrs = Object.fromEntries((c.attributes || []).map((a) => [a.key, a.value]));
  if (!attrs['Presale tier']) return;

  const value = Number(c.totalPrice?.amount ?? c.subtotalPrice?.amount ?? 0);
  const currency = c.currencyCode || 'USD';
  const items = lines.map((l) => ({
    item_id: String(l.variant?.id ?? ''),
    item_name: l.title,
    item_variant: [attrs['Presale tier'], attrs['Presale color']].filter(Boolean).join(' / '),
    price: Number(l.variant?.price?.amount ?? 0),
    quantity: l.quantity,
  }));
  const orderId = c.order?.id || c.token;

  loadMeta();
  loadGA();
  if (window.fbq) {
    window.fbq('track', 'Purchase', {
      value, currency,
      content_ids: items.map((i) => i.item_id),
      content_type: 'product',
    }, { eventID: String(orderId) });
  }
  if (window.gtag) {
    window.gtag('event', 'purchase', {
      transaction_id: String(orderId),
      value, currency, items,
      campaign_source: attrs.utm_source,
      campaign_medium: attrs.utm_medium,
      campaign_name: attrs.utm_campaign,
      referral_code: attrs.referral_code,
    });
  }
});
