# Возвраты Amazon (FBA)

Дашборд возвратов за январь–сентябрь 2026 по аккаунтам A1H3J68XZ5X5W7-US и A2X0F4F8T5BV34-US.
Показывает процент возвратов относительно продаж по месяцам с фильтрами по аккаунту, ASIN, причине и состоянию товара.

- `raw/` — выгрузки Windsor.ai (коннектор `amazon_sp`), в репозиторий не попадают:
  - `fba_<acct>_*.json` — отчёт FBA Customer Returns (`fba_fulfillment_customer_returns_data__*`);
  - `orders_<acct>_*.json` — отчёт All Orders (`flat_file_all_orders_data_by_order_date_general__*`).
- `build.py` агрегирует выгрузки в `data.json` и встраивает эти данные в `template.html`, получается `dashboard.html`.
- Возвраты относятся к месяцу даты возврата. Продажи берутся по дате заказа: канал Amazon.com, без отменённых заказов.
