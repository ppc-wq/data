"""Aggregate raw Windsor exports (raw/*.json) into a compact dataset for the dashboard.

Returns: FBA customer returns, bucketed by the local month of return_date.
Sales:   All Orders report, Amazon.com channel, non-cancelled, bucketed by purchase month.
"""
import glob, json, os, re, collections

HERE = os.path.dirname(os.path.abspath(__file__))
RAW = os.path.join(HERE, 'raw')
ACCOUNTS = {'A1': 'A1H3J68XZ5X5W7-US', 'A2': 'A2X0F4F8T5BV34-US'}
MONTHS = [f'2026-{m:02d}' for m in range(1, 10)]
FP = 'fba_fulfillment_customer_returns_data__'
OP = 'flat_file_all_orders_data_by_order_date_general__'

AS_OF = '29.09.2026'
import calendar
def month_end(m):
    y, mo = map(int, m.split('-'))
    # treat the last loaded day of the current month as complete coverage
    return min(f'{m}-{calendar.monthrange(y, mo)[1]:02d}', '2026-09-29')
def fmt_day(d):
    return f'{d[8:10]}.{d[5:7]}'

def load(path):
    return json.load(open(path))['result']

returns = collections.Counter()      # (acct, month, asin, reason, disposition) -> units
names = {}
seen = set()
loaded = collections.defaultdict(set)
for path in sorted(glob.glob(os.path.join(RAW, 'fba_*.json'))):
    acct = re.match(r'fba_(A\d)_', os.path.basename(path)).group(1)
    for r in load(path):
        key = (acct,) + tuple(r.get(FP + k) for k in
               ('return_date', 'asin', 'sku', 'quantity', 'reason', 'detailed_disposition', 'product_name'))
        if key in seen:
            continue
        seen.add(key)
        m = r[FP + 'return_date'][:7]
        if m not in MONTHS:
            continue
        loaded[('returns', acct)].add(m)
        asin = r[FP + 'asin']
        names.setdefault(asin, r.get(FP + 'product_name') or '')
        returns[(acct, m, asin, r[FP + 'reason'] or 'UNKNOWN',
                 r[FP + 'detailed_disposition'] or 'UNKNOWN')] += int(r[FP + 'quantity'] or 0)

sales = collections.Counter()        # (acct, month, asin) -> units
revenue = collections.Counter()
last_day = {}
for path in sorted(glob.glob(os.path.join(RAW, 'orders_*.json'))):
    acct = re.match(r'orders_(A\d)_', os.path.basename(path)).group(1)
    for r in load(path):
        if r[OP + 'order_status'] == 'Cancelled' or r[OP + 'sales_channel'] != 'Amazon.com':
            continue
        m = r[OP + 'purchase_date'][:7]
        if m not in MONTHS:
            continue
        loaded[('sales', acct)].add(m)
        day = r[OP + 'purchase_date'][:10]
        if day > last_day.get((acct, m), ''):
            last_day[(acct, m)] = day
        k = (acct, m, r[OP + 'asin'])
        sales[k] += int(r[OP + 'quantity'] or 0)
        revenue[k] += float(r[OP + 'item_price'] or 0)

asins = sorted({k[2] for k in returns} | {k[2] for k in sales})
reasons = sorted({k[3] for k in returns})
disps = sorted({k[4] for k in returns})
accts = sorted(ACCOUNTS)
ai = {a: i for i, a in enumerate(asins)}
data = {
    'months': MONTHS,
    'accounts': [ACCOUNTS[a] for a in accts],
    'asins': asins,
    'names': [names.get(a, '') for a in asins],
    'reasons': reasons,
    'dispositions': disps,
    # [account, month, asin, reason, disposition, units]
    'returns': [[accts.index(k[0]), MONTHS.index(k[1]), ai[k[2]], reasons.index(k[3]),
                 disps.index(k[4]), v] for k, v in sorted(returns.items())],
    # [account, month, asin, units, revenue]
    'sales': [[accts.index(k[0]), MONTHS.index(k[1]), ai[k[2]], v, round(revenue[k], 2)]
              for k, v in sorted(sales.items())],
    'coverage': {f'{t}:{ACCOUNTS[a]}': sorted(ms) for (t, a), ms in sorted(loaded.items())},
    'asOf': AS_OF,
    'salesCoverage': {ACCOUNTS[a]: {m: {'through': fmt_day(d), 'partial': d < month_end(m)}
                                    for (aa, m), d in sorted(last_day.items()) if aa == a}
                      for a in accts},
}
out = os.path.join(HERE, 'data.json')
json.dump(data, open(out, 'w'), separators=(',', ':'))
print('asins', len(asins), 'reasons', len(reasons), 'return rows', len(data['returns']),
      'sales rows', len(data['sales']), 'bytes', os.path.getsize(out))
for a in accts:
    for m in MONTHS:
        ru = sum(v for k, v in returns.items() if k[0] == a and k[1] == m)
        su = sum(v for k, v in sales.items() if k[0] == a and k[1] == m)
        if ru or su:
            print(a, m, 'returns', ru, 'sold', su, f'{ru / su:.1%}' if su else '-')
print(data['coverage'])

tpl = open(os.path.join(HERE, 'template.html')).read()
open(os.path.join(HERE, 'dashboard.html'), 'w').write(tpl.replace('/*DATA*/null', json.dumps(data, ensure_ascii=False, separators=(',', ':'))))
print('dashboard.html written')
