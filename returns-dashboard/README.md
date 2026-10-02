# Amazon Returns (FBA)

Returns dashboard for January–September 2026, accounts A1H3J68XZ5X5W7-US and A2X0F4F8T5BV34-US:
monthly return rate vs. units sold, filters by account, category, ASIN, reason group and item condition,
plus a customer-comments tab.

- `raw/` (not committed) — Windsor.ai exports, connector `amazon_sp`:
  - `fba_<acct>_*.json` — FBA Customer Returns (`fba_fulfillment_customer_returns_data__*`, incl. `customer_comments`);
  - `orders_<acct>_*.json` — All Orders (`flat_file_all_orders_data_by_order_date_general__*`).
- `map/info.csv` — the "Info" tab of the mapping sheet (ASIN → category, product, parent/child).
- `map/reasons.csv` — the "Reasons" tab (Amazon return reason → reason group).
- `map/summaries.json` — comment themes per return reason.
- `build.py` aggregates everything into `data.json` and injects it into `template.html` → `dashboard.html`.
