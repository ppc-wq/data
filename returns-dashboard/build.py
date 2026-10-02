"""Aggregate raw Windsor exports (raw/*.json) into a compact dataset for the dashboard.

Returns:  FBA customer returns, bucketed by the local month of return_date.
Sales:    All Orders report, Amazon.com channel, non-cancelled, bucketed by purchase month.
Mappings (optional, from the team's Google Sheet, exported as CSV):
  map/info.csv     tab "Info"    -> ASIN -> category / product / parent-child
  map/reasons.csv  tab "Reasons" -> return reason -> classification
"""
import calendar, collections, csv, glob, html, json, os, re

HERE = os.path.dirname(os.path.abspath(__file__))
RAW = os.path.join(HERE, 'raw')
MAP = os.path.join(HERE, 'map')
ACCOUNTS = {'A1': 'A1H3J68XZ5X5W7-US', 'A2': 'A2X0F4F8T5BV34-US'}
MONTHS = [f'2026-{m:02d}' for m in range(1, 10)]
LAST_DAY = '2026-09-30'
AS_OF = 'Sep 30, 2026'
FP = 'fba_fulfillment_customer_returns_data__'
OP = 'flat_file_all_orders_data_by_order_date_general__'
UNCAT = 'Uncategorized'


def month_end(m):
    y, mo = map(int, m.split('-'))
    return min(f'{m}-{calendar.monthrange(y, mo)[1]:02d}', LAST_DAY)


def load(path):
    j = json.load(open(path))
    return j.get('result', j.get('data'))


def read_csv(name):
    path = os.path.join(MAP, name)
    if not os.path.exists(path):
        return None
    with open(path, newline='', encoding='utf-8-sig') as f:
        return list(csv.reader(f))


# ---- mappings ------------------------------------------------------------
asin_info = {}       # asin -> {'category', 'product', 'role'}
info = read_csv('info.csv')
if info:
    head = [h.strip().lower() for h in info[0]]
    col = lambda *names: next((i for i, h in enumerate(head) if any(n in h for n in names)), None)
    ci, cc, cp, cr = col('asin'), col('categor'), col('product'), col('parent', 'child', 'type')
    for row in info[1:]:
        if ci is None or len(row) <= ci or not row[ci].strip():
            continue
        a = row[ci].strip()
        asin_info.setdefault(a, {
            'category': (row[cc].strip() if cc is not None and len(row) > cc else '') or UNCAT,
            'product': row[cp].strip() if cp is not None and len(row) > cp else '',
            'role': row[cr].strip() if cr is not None and len(row) > cr else '',
        })

reason_group = {}    # reason code -> classification
rs = read_csv('reasons.csv')
if rs:
    for row in rs[1:]:
        if len(row) >= 2 and row[0].strip():
            reason_group[row[0].strip().upper().replace(' ', '_')] = row[1].strip() or row[0].strip()

# ---- returns -------------------------------------------------------------
returns = collections.Counter()      # (acct, month, asin, reason, disposition) -> units
comments = []
names = {}
seen = set()
for path in sorted(glob.glob(os.path.join(RAW, 'fba_*.json'))):
    acct = re.match(r'fba_(A\d)_', os.path.basename(path)).group(1)
    for r in load(path):
        key = (acct,) + tuple(r.get(FP + k) for k in
                              ('return_date', 'order_id', 'license_plate_number', 'asin', 'sku', 'quantity', 'reason'))
        if key in seen:
            continue
        seen.add(key)
        m = r[FP + 'return_date'][:7]
        if m not in MONTHS:
            continue
        asin = r[FP + 'asin']
        reason = r[FP + 'reason'] or 'UNKNOWN'
        disp = r[FP + 'detailed_disposition'] or 'UNKNOWN'
        names.setdefault(asin, r.get(FP + 'product_name') or '')
        returns[(acct, m, asin, reason, disp)] += int(r[FP + 'quantity'] or 0)
        text = html.unescape((r.get(FP + 'customer_comments') or '').strip())
        if text:
            comments.append((acct, m, asin, reason, disp, r[FP + 'return_date'][:10], text))

# ---- sales ---------------------------------------------------------------
sales = collections.Counter()        # (acct, month, asin) -> units
last_day = {}
for path in sorted(glob.glob(os.path.join(RAW, 'orders_*.json'))):
    acct = re.match(r'orders_(A\d)_', os.path.basename(path)).group(1)
    for r in load(path):
        if r[OP + 'order_status'] == 'Cancelled' or r[OP + 'sales_channel'] != 'Amazon.com':
            continue
        m = r[OP + 'purchase_date'][:7]
        if m not in MONTHS:
            continue
        day = r[OP + 'purchase_date'][:10]
        if day > last_day.get((acct, m), ''):
            last_day[(acct, m)] = day
        sales[(acct, m, r[OP + 'asin'])] += int(r[OP + 'quantity'] or 0)

# ---- encode --------------------------------------------------------------
asins = sorted({k[2] for k in returns} | {k[2] for k in sales})
reasons = sorted({k[3] for k in returns})
disps = sorted({k[4] for k in returns})
accts = sorted(ACCOUNTS)
cat_of = {a: asin_info.get(a, {}).get('category', UNCAT) for a in asins}
cats = sorted(set(cat_of.values()), key=lambda c: (c == UNCAT, c.lower()))
group_of = {r: reason_group.get(r, r) for r in reasons}
groups = sorted(set(group_of.values()))
ai = {a: i for i, a in enumerate(asins)}
ri = {r: i for i, r in enumerate(reasons)}
di = {d: i for i, d in enumerate(disps)}
comments.sort(key=lambda c: c[5], reverse=True)

data = {
    'months': MONTHS,
    'asOf': AS_OF,
    'accounts': [ACCOUNTS[a] for a in accts],
    'asins': asins,
    'names': [names.get(a, '') for a in asins],
    'products': [asin_info.get(a, {}).get('product', '') for a in asins],
    'roles': [asin_info.get(a, {}).get('role', '') for a in asins],
    'categories': cats,
    'asinCat': [cats.index(cat_of[a]) for a in asins],
    'mapped': bool(asin_info),
    'reasons': reasons,
    'groups': groups,
    'reasonGroup': [groups.index(group_of[r]) for r in reasons],
    'grouped': bool(reason_group),
    'dispositions': disps,
    # [account, month, asin, reason, disposition, units]
    'returns': [[accts.index(k[0]), MONTHS.index(k[1]), ai[k[2]], ri[k[3]], di[k[4]], v]
                for k, v in sorted(returns.items())],
    # [account, month, asin, units]
    'sales': [[accts.index(k[0]), MONTHS.index(k[1]), ai[k[2]], v] for k, v in sorted(sales.items())],
    # [account, month, asin, reason, disposition, 'YYYY-MM-DD', text]
    'comments': [[accts.index(c[0]), MONTHS.index(c[1]), ai[c[2]], ri[c[3]], di[c[4]], c[5], c[6]]
                 for c in comments],
    'salesCoverage': {ACCOUNTS[a]: {m: {'through': d, 'partial': d < month_end(m)}
                                    for (aa, m), d in sorted(last_day.items()) if aa == a}
                      for a in accts},
}
summ = os.path.join(MAP, 'summaries.json')
data['summaries'] = json.load(open(summ)) if os.path.exists(summ) else {}

out = os.path.join(HERE, 'data.json')
json.dump(data, open(out, 'w'), separators=(',', ':'), ensure_ascii=False)
print('asins', len(asins), 'mapped', sum(a in asin_info for a in asins),
      'categories', len(cats), 'reasons', len(reasons), 'groups', len(groups),
      'return rows', len(data['returns']), 'comments', len(comments), 'bytes', os.path.getsize(out))
for a in accts:
    for m in MONTHS:
        ru = sum(v for k, v in returns.items() if k[0] == a and k[1] == m)
        su = sum(v for k, v in sales.items() if k[0] == a and k[1] == m)
        print(a, m, 'returns', ru, 'sold', su, f'{ru / su:.1%}' if su else '-')
unmapped = [a for a in asins if a not in asin_info]
if asin_info and unmapped:
    print('ASINs without a category:', unmapped)
unknown_reasons = [r for r in reasons if r not in reason_group]
if reason_group and unknown_reasons:
    print('Reasons without a classification:', unknown_reasons)

tpl = open(os.path.join(HERE, 'template.html')).read()
open(os.path.join(HERE, 'dashboard.html'), 'w').write(
    tpl.replace('/*DATA*/null', json.dumps(data, ensure_ascii=False, separators=(',', ':'))))
print('dashboard.html written')
