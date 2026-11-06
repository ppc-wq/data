// Renders the real Shopify theme files (layout + section + snippets) with liquidjs and mock data,
// so the page can be previewed and tested without a store. Output: preview/dist/index.html
// Usage: node build.mjs [--soldout=1]   (marks tier 1 as sold out to test tier switching)
import { Liquid, Tag } from 'liquidjs';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const theme = path.join(here, '..', 'theme');
const dist = path.join(here, 'dist');
fs.mkdirSync(path.join(dist, 'assets'), { recursive: true });
fs.mkdirSync(path.join(dist, 'images'), { recursive: true });

const soldout1 = process.argv.includes('--soldout=1');

/* ---------- placeholder renders (stand-ins until real product images are uploaded) ---------- */
const COLORS = { navy: { body: '#1F2A44', deep: '#141C30', lid: '#26324F' }, black: { body: '#1B1C20', deep: '#0E0F11', lid: '#25262B' } };
const SILVER = '#C9CCD1', SILVER2 = '#AEB2B8', TIP = '#D9DBDE', SHADOW = '#EFEFEC';
function bud(cx, cy, c, flip = 1, s = 1) {
  return `<g transform="translate(${cx} ${cy}) scale(${flip * s} ${s})">
    <ellipse cx="-58" cy="18" rx="34" ry="28" fill="${TIP}"/>
    <path d="M-40 -70 C 40 -110 120 -40 105 30 C 92 95 10 120 -40 80 C -80 50 -90 -40 -40 -70Z" fill="${c.body}"/>
    <circle cx="30" cy="5" r="52" fill="${SILVER}"/><circle cx="30" cy="5" r="52" fill="none" stroke="${SILVER2}" stroke-width="3"/>
    <path d="M2 -28 L58 38" stroke="#E3E5E8" stroke-width="3" opacity=".7"/>
  </g>`;
}
function svg(inner) { return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 800" width="1600" height="1600"><rect width="800" height="800" fill="#FFFFFF"/>${inner}</svg>`; }
const shots = {
  open: (c) => svg(`<ellipse cx="400" cy="660" rx="230" ry="26" fill="${SHADOW}"/>
    <g transform="rotate(-8 400 360)"><rect x="210" y="170" width="380" height="190" rx="95" fill="${c.lid}"/><rect x="250" y="205" width="300" height="120" rx="60" fill="${c.deep}"/></g>
    <rect x="200" y="380" width="400" height="270" rx="120" fill="${c.body}"/>
    <rect x="235" y="395" width="330" height="120" rx="60" fill="${c.deep}"/>
    ${bud(320, 445, c, -1, .62)}${bud(480, 445, c, 1, .62)}
    <rect x="380" y="600" width="40" height="6" rx="3" fill="${SILVER}"/>`),
  pair: (c) => svg(`<ellipse cx="400" cy="610" rx="250" ry="22" fill="${SHADOW}"/>${bud(285, 410, c, -1, 1.25)}${bud(515, 410, c, 1, 1.25)}`),
  closed: (c) => svg(`<ellipse cx="400" cy="610" rx="220" ry="24" fill="${SHADOW}"/>
    <rect x="200" y="260" width="400" height="330" rx="140" fill="${c.body}"/><path d="M206 400 H594" stroke="${c.deep}" stroke-width="5"/>
    <text x="400" y="505" text-anchor="middle" font-family="Sora, Arial, sans-serif" font-weight="600" font-size="34" fill="${SILVER}">artix</text>
    <circle cx="400" cy="560" r="5" fill="#9BE28F"/>`),
  side: (c) => svg(`<ellipse cx="400" cy="610" rx="180" ry="20" fill="${SHADOW}"/>${bud(400, 400, c, 1, 1.9)}`),
};
const both = (kind) => svg(`<g transform="translate(-170 0)">${shots[kind](COLORS.navy).replace(/^<svg[^>]*>|<\/svg>$/g, '').replace('<rect width="800" height="800" fill="#FFFFFF"/>', '')}</g><g transform="translate(170 0)">${shots[kind](COLORS.black).replace(/^<svg[^>]*>|<\/svg>$/g, '').replace('<rect width="800" height="800" fill="#FFFFFF"/>', '')}</g>`).replace('<svg ', '<svg ').replace('viewBox="0 0 800 800"', 'viewBox="-60 0 920 800"');
const files = {};
for (const [name, c] of Object.entries(COLORS)) for (const [kind, fn] of Object.entries(shots)) files[`${kind}-${name}.svg`] = fn(c);
files['closed-both.svg'] = both('closed');
for (const [f, content] of Object.entries(files)) fs.writeFileSync(path.join(dist, 'images', f), content);
const img = (f) => ({ src: `images/${f}`, width: 1600, height: 1600 });

/* ---------- mock Shopify objects (illustrative inventory; clearly bannered as demo in the output) ---------- */
const variants = [
  { id: 4400000000001, title: 'Tier 1', price: 6999, inventory_quantity: soldout1 ? 0 : 63, available: !soldout1, selling_plan_allocations: [{ selling_plan: { id: 690000001 } }] },
  { id: 4400000000002, title: 'Tier 2', price: 7999, inventory_quantity: 300, available: true, selling_plan_allocations: [{ selling_plan: { id: 690000001 } }] },
  { id: 4400000000003, title: 'Tier 3', price: 9999, inventory_quantity: 600, available: true, selling_plan_allocations: [{ selling_plan: { id: 690000001 } }] },
];
const product = { handle: 'artix-pro-presale', price: 6999, price_min: 6999, variants };
const settings = {
  product, launch_price_cents: 14999, ship_date: 'December 15',
  tier_1_name: 'Early Bird', tier_1_capacity: 100, tier_2_name: 'Presale', tier_2_capacity: 300, tier_3_name: 'Last Call', tier_3_capacity: 600,
  poll_seconds: 30, compare_heading: 'Flagship features. Half the price of AirPods Pro 3.',
  hero_navy: img('open-navy.svg'), hero_black: img('open-black.svg'),
  pair_navy: img('pair-navy.svg'), pair_black: img('pair-black.svg'),
  closed_navy: img('closed-navy.svg'), closed_black: img('closed-black.svg'),
  meta_pixel_id: '', ga4_id: '',
};
const blocks = [
  ['side-navy.svg', 'Side view of an Artix Pro earbud in Navy'],
  ['side-black.svg', 'Side view of an Artix Pro earbud in Black'],
  ['closed-both.svg', 'Closed Artix Pro charging cases in Navy and Black'],
  ['open-black.svg', 'Artix Pro earbuds in Black in their open charging case'],
  ['pair-black.svg', 'A pair of Artix Pro earbuds in Black'],
  ['open-navy.svg', 'Artix Pro earbuds in Navy in their open charging case'],
].map(([f, alt]) => ({ settings: { image: img(f), alt }, shopify_attributes: '' }));

/* ---------- liquid engine with the Shopify filters/tags the theme uses ---------- */
const engine = new Liquid({ root: [path.join(theme, 'snippets')], extname: '.liquid', strictFilters: true });
engine.registerTag('schema', class extends Tag {
  constructor(token, remainTokens, liquid) { super(token, remainTokens, liquid); const stream = liquid.parser.parseStream(remainTokens); stream.on('tag:endschema', () => stream.stop()).on('template', () => {}).on('end', () => { throw new Error('schema not closed'); }); stream.start(); }
  * render() {}
});
const usd = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });
engine.registerFilter('money', (c) => usd.format(Number(c) / 100));
engine.registerFilter('money_without_trailing_zeros', (c) => usd.format(Number(c) / 100).replace(/\.00$/, ''));
engine.registerFilter('image_url', (image) => image?.src || '');
engine.registerFilter('asset_url', (name) => `assets/${name}`);

const sectionSrc = fs.readFileSync(path.join(theme, 'sections', 'artix-presale.liquid'), 'utf8');
const layoutSrc = fs.readFileSync(path.join(theme, 'layout', 'artix.liquid'), 'utf8');

const banner = `<div style="background:#121317;color:#fff;font:500 13px/1.45 Inter,system-ui,sans-serif;padding:10px 16px;text-align:center">Preview: demo inventory and placeholder drawings, not connected to Shopify. Checkout buttons show a notice instead.</div>`;
const content = banner + await engine.parseAndRender(sectionSrc, { section: { settings, blocks }, shop: { name: 'Artix' }, cart: { currency: { iso_code: 'USD' } } });
const html = await engine.parseAndRender(layoutSrc, {
  page_title: 'Artix Pro presale: reserve for $5', page_description: 'Reserve Artix Pro wireless noise-cancelling earbuds for a $5 refundable deposit. Ships December 15.',
  shop: { name: 'Artix' }, canonical_url: 'https://example.com/pages/presale',
  content_for_header: '<script>window.ARTIX_DEMO = true;</script>', content_for_layout: content,
});
fs.writeFileSync(path.join(dist, 'index.html'), html);
for (const f of ['artix-presale.css', 'artix-presale.js']) fs.copyFileSync(path.join(theme, 'assets', f), path.join(dist, 'assets', f));
console.log('Built', path.join(dist, 'index.html'));
