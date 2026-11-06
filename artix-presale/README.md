# Artix Pro presale landing page (Shopify)

A single-page presale landing page built as Shopify theme files: one section, its own lightweight layout, and plain JavaScript with no framework, to keep mobile load times low.

```
theme/
  layout/artix.liquid                 minimal layout (no theme header/footer, fonts + page CSS/JS)
  templates/page.artix-presale.json   page template that uses the layout + section
  sections/artix-presale.liquid       the whole page (all 13 blocks) + theme-editor settings
  sections/artix-inventory.liquid     live inventory feed (JSON), polled by the page
  snippets/artix-img.liquid           responsive <img> (srcset, lazy below the fold, eager hero)
  snippets/artix-icon.liquid          line icons
  assets/artix-presale.css / .js
shopify/custom-pixel.js               purchase tracking for checkout (Customer events)
preview/build.mjs                     renders the real Liquid files with mock data → preview/dist
```

## Store setup

1. **Product.** Create one product, "Artix Pro presale", with **three variants in this order**: Tier 1, Tier 2, Tier 3. Prices: $69.99 / $79.99 / $99.99.
   - Track inventory on each variant: 100 / 300 / 600. Turn **Continue selling when out of stock OFF**.
   - Don't set a "compare-at price". The launch price is a section setting, so Shopify and Google Shopping never show a "was $149.99" price.
   - Color is not a variant. It goes to the order as the line-item property `Color: Navy|Black`, so each tier's count stays exactly 100/300/600 whatever the color mix. Your fulfillment team reads the color from the order line.
2. **Deposit plan.** Attach a pre-order selling plan with a **$5 charge at checkout** and the balance collected later. Shopify's native selling plans can collect the balance at a fixed date or manually from the order. "Charge when it ships" means collecting the payment when you fulfill: either manually in the admin or with a pre-order app that charges on fulfillment. Make the plan required for this product.
3. **Theme.** Copy the `theme/` files into your theme (Online Store → Themes → Edit code, or Shopify CLI `shopify theme push`). Create a page, for example `/pages/presale`, and assign the template `page.artix-presale`.
4. **Theme editor.** In the "Artix presale" section, pick the product and upload the images (hero, features and gift block, one per color) plus gallery blocks with alt text. Set the tracking IDs and footer link URLs.
5. **Pages.** Create Presale terms, Referral terms, Warranty and Contact pages, or point the footer settings at existing ones.
6. **Purchase tracking.** Paste `shopify/custom-pixel.js` into Settings → Customer events → Add custom pixel, then fill in the IDs.

## How live inventory works

The page renders the current numbers server-side, then re-reads them every 30 s (configurable) from
`/products/<handle>?section_id=artix-inventory` (Shopify's Section Rendering API: no API token, no app). Polling pauses while the tab is hidden. If a read fails, the last real numbers stay on screen. No numbers are ever made up.

The tier capacities (100/300/600) come from section settings. *Reserved* = capacity − current inventory. The first tier with stock is "Open now", and the next one opens automatically when it hits 0.

## Checkout

A reserve click clears the cart, adds the selected tier variant with the selling plan and the `Color` property, and saves these cart attributes: tier, color, `utm_*`, `fbclid`, `gclid` and `referral_code` (from `?ref=`). It then goes to `/checkout` with the UTMs. If the tier sells out between page load and the click, the add fails, the page refreshes inventory and tells the shopper which tier is now open and its price.

## Tracking

Every event is pushed to `window.dataLayer` (`page_view`, `view_content`, `select_tier`, `select_color`, `add_to_cart`, `begin_checkout`). GA4 (gtag) and the Meta Pixel load only if their IDs are set and Shopify's Customer Privacy API allows it. `purchase` is sent from the checkout custom pixel. `window.artixTrack('referral_link_copied', {...})` is available for the referral page.
If the Facebook & Instagram or Google & YouTube apps already send these events, leave the IDs empty to avoid double counting.

## Not built yet

- **Thank-you page referral block** (personal link, copy/share, "0 of 3 friends joined"). Shopify's thank-you page can only be customized with a checkout UI extension inside a Shopify app, and it needs a small backend: issue a code per order, count friends' fully paid orders by `referral_code`, and apply up to $30 to the referrer's balance before the balance is charged. The landing page already captures `?ref=` and stores it on the order.

## Preview

```bash
cd preview && npm install && node build.mjs && npx serve dist
```
The preview uses demo inventory and placeholder drawings, and a banner on the page says so. `node build.mjs --soldout=1` previews the page with Tier 1 sold out.
