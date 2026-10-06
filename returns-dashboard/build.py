"""Aggregate raw Windsor exports (raw/*.json) into a compact dataset for the dashboard.

Returns:  FBA customer returns, bucketed by the local month of return_date.
Sales:    All Orders report, Amazon.com channel, non-cancelled, bucketed by purchase month.
Mappings (optional, from the team's Google Sheet, exported as CSV):
  map/info.csv     tab "Info"    -> ASIN -> category / product / parent-child
  map/reasons.csv  tab "Reasons" -> return reason -> classification
"""
import calendar, collections, csv, datetime, glob, html, json, os, re

HERE = os.path.dirname(os.path.abspath(__file__))
RAW = os.path.join(HERE, 'raw')
MAP = os.path.join(HERE, 'map')
ACCOUNTS = {'A1': 'A1H3J68XZ5X5W7-US', 'A2': 'A2X0F4F8T5BV34-US'}
ACCOUNT_NAMES = {'A1H3J68XZ5X5W7-US': '7th Continent', 'A2X0F4F8T5BV34-US': 'Symphonized'}
MONTHS = [f'2025-{m:02d}' for m in range(1, 13)] + [f'2026-{m:02d}' for m in range(1, 11)]
LAST_DAY = '2026-10-05'
AS_OF = 'Oct 5, 2026'
FP = 'fba_fulfillment_customer_returns_data__'
OP = 'flat_file_all_orders_data_by_order_date_general__'
UNCAT = 'Not in Info tab'


def month_end(m):
    y, mo = map(int, m.split('-'))
    return f'{m}-{calendar.monthrange(y, mo)[1]:02d}'   # a month with fewer loaded days is flagged as partial


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
    ci, cc, cp, cr, cv = col('asin'), col('categor'), col('product'), col('parent', 'child', 'type'), col('variation')
    for row in info[1:]:
        if ci is None or len(row) <= ci or not row[ci].strip():
            continue
        a = row[ci].strip()
        asin_info.setdefault(a, {
            'category': (row[cc].strip() if cc is not None and len(row) > cc else '') or UNCAT,
            'product': row[cp].strip() if cp is not None and len(row) > cp else '',
            'role': row[cr].strip() if cr is not None and len(row) > cr else '',
            'variation': row[cv].strip() if cv is not None and len(row) > cv else '',
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
        # Seller Central's return report dates returns in UTC; use the same day boundary
        day = datetime.datetime.fromisoformat(r[FP + 'return_date']).astimezone(datetime.timezone.utc).strftime('%Y-%m-%d')
        m = day[:7]
        if m not in MONTHS:
            continue
        asin = r[FP + 'asin']
        reason = r[FP + 'reason'] or 'UNKNOWN'
        disp = r[FP + 'detailed_disposition'] or 'UNKNOWN'
        names.setdefault(asin, r.get(FP + 'product_name') or '')
        returns[(acct, m, asin, reason, disp)] += int(r[FP + 'quantity'] or 0)
        text = html.unescape((r.get(FP + 'customer_comments') or '').strip())
        if text:
            comments.append((acct, m, asin, reason, disp, day, text))

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

# ---- refunds without a received return (settlement report, last ~90 days) ---
# Each settlement 'Refund' / 'Principal' line is one refunded order item. Lines whose order has
# no matching FBA return are added as returns with a synthetic reason: still pending if the refund
# is under PENDING_DAYS old at LAST_DAY, otherwise refunded without a return.
SP = 'v2_settlement_report_data_flat_file_v2__'
PENDING_DAYS = 30
NO_RETURN_GROUP = 'Refund without return'
NO_RETURN = {'REFUND_RETURN_PENDING', 'REFUND_NO_RETURN'}
settle_from = None
settle_to = None
sku2asin = {}
for path in glob.glob(os.path.join(RAW, 'fba_*.json')):
    for r in load(path):
        sku2asin.setdefault(r[FP + 'sku'], r[FP + 'asin'])
for path in glob.glob(os.path.join(RAW, 'orders_*.json')):
    for r in load(path):
        if r.get(OP + 'sku'):
            sku2asin.setdefault(r[OP + 'sku'], r[OP + 'asin'])
for row in (info or [])[1:]:
    if len(row) > 1 and row[0].strip() and row[1].strip():
        sku2asin.setdefault(row[1].strip(), row[0].strip())
returned = collections.Counter()     # (acct, order) -> returned units, any date
for path in glob.glob(os.path.join(RAW, 'fba_*.json')):
    acct = re.match(r'fba_(A\d)_', os.path.basename(path)).group(1)
    for r in load(path):
        returned[(acct, r[FP + 'order_id'])] += int(r[FP + 'quantity'] or 0) or 1
refund_lines = collections.defaultdict(list)
inv_acct = {v: k for k, v in ACCOUNTS.items()}
for path in glob.glob(os.path.join(HERE, 'raw2', 'settle_*.json')):
    for r in json.load(open(path)):
        if r[SP + 'marketplace_name'] != 'Amazon.com' or (r[SP + 'amount'] or 0) >= 0:
            continue   # positive principal lines are adjustments (e.g. restocking fee), not refunds
        acct = inv_acct[r['account_id']]
        asin = sku2asin.get(r[SP + 'sku'], 'SKU:' + r[SP + 'sku'])
        refund_lines[(acct, r[SP + 'order_id'])].append((r[SP + 'posted_date'][:10], asin))
        settle_from = min(settle_from or '9999', r[SP + 'posted_date'][:10])
        settle_to = max(settle_to or '', r[SP + 'posted_date'][:10])
no_return_units = collections.Counter()
for (acct, order), lines in refund_lines.items():
    extra = len(lines) - returned[(acct, order)]
    for day, asin in sorted(lines, reverse=True)[:max(0, extra)]:
        m = day[:7]
        if m not in MONTHS:
            continue
        age = (datetime.date.fromisoformat(LAST_DAY) - datetime.date.fromisoformat(day)).days
        reason = 'REFUND_RETURN_PENDING' if age < PENDING_DAYS else 'REFUND_NO_RETURN'
        returns[(acct, m, asin, reason, 'NOT_RECEIVED')] += 1
        no_return_units[reason] += 1
        names.setdefault(asin, '')

# ---- refunded units from the Business Report (Sales & Traffic), whole period ---
# Account-level daily totals: Amazon no longer serves the by-ASIN report for 2025.
br_refunds = collections.Counter()   # (acct, month) -> refunded units
seen_days = set()
for path in sorted(glob.glob(os.path.join(HERE, 'raw2', 'bd_*.json')), reverse=True):   # newest file wins
    for r in json.load(open(path)):
        key = (r['account_id'], r['date'])
        if key in seen_days or r['date'][:7] not in MONTHS:
            continue
        seen_days.add(key)
        br_refunds[(inv_acct[r['account_id']], r['date'][:7])] += \
            int(r['sales_and_traffic_report_by_date__salesbydate_unitsrefunded'] or 0)

# ---- encode --------------------------------------------------------------
asins = sorted({k[2] for k in returns} | {k[2] for k in sales})
reasons = sorted({k[3] for k in returns})
disps = sorted({k[4] for k in returns})
accts = sorted(ACCOUNTS)
cat_of = {a: asin_info.get(a, {}).get('category', UNCAT) for a in asins}
cats = sorted(set(cat_of.values()), key=lambda c: (c == UNCAT, c.lower()))
group_of = {r: NO_RETURN_GROUP if r in NO_RETURN else reason_group.get(r, r) for r in reasons}
groups = sorted(set(group_of.values()))
ai = {a: i for i, a in enumerate(asins)}
# Variation = product + colour / plug type from the Info tab; ASINs without one stand alone.
# ASINs sharing a product and variation (e.g. a relisted child) collapse into one option.
var_key = {a: (cat_of[a], asin_info.get(a, {}).get('variation') or a) for a in asins}
variants = sorted(set(var_key.values()), key=lambda k: (cats.index(k[0]), k[1] in asins, k[1].lower()))
vi = {k: i for i, k in enumerate(variants)}
ri = {r: i for i, r in enumerate(reasons)}
di = {d: i for i, d in enumerate(disps)}
comments.sort(key=lambda c: c[5], reverse=True)

# comment -> theme tags (cm/u_<REASON>.txt numbers each unique text; cm/assign_<REASON>.json tags it)
tags = {}
for r in reasons:
    u, a = os.path.join(HERE, 'cm', f'u_{r}.txt'), os.path.join(HERE, 'cm', f'assign_{r}.json')
    if not (os.path.exists(u) and os.path.exists(a)):
        continue
    assign = json.load(open(a))
    for line in open(u, encoding='utf-8'):
        i, text = line.rstrip('\n').split('\t', 1)
        tags[(r, text)] = [t for t in assign.get(i, [-1]) if t >= 0]
untagged = sum((c[3], c[6].replace('\n', ' ').replace('\t', ' ')) not in tags for c in comments)

data = {
    'months': MONTHS,
    'asOf': AS_OF,
    'accounts': [ACCOUNTS[a] for a in accts],
    'accountNames': [ACCOUNT_NAMES.get(ACCOUNTS[a], ACCOUNTS[a]) for a in accts],
    'asins': asins,
    'names': [names.get(a, '') for a in asins],
    'products': [asin_info.get(a, {}).get('product', '') for a in asins],
    'roles': [asin_info.get(a, {}).get('role', '') for a in asins],
    'categories': cats,
    'asinCat': [cats.index(cat_of[a]) for a in asins],
    # [product index, label, has a named variation]
    'variants': [[cats.index(c), v, v not in ai] for c, v in variants],
    'asinVar': [vi[var_key[a]] for a in asins],
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
    # [account, month, asin, reason, disposition, 'YYYY-MM-DD', text, [theme indices]]
    'comments': [[accts.index(c[0]), MONTHS.index(c[1]), ai[c[2]], ri[c[3]], di[c[4]], c[5], c[6],
                  tags.get((c[3], c[6].replace('\n', ' ').replace('\t', ' ')), [])]
                 for c in comments],
    # [account, month, refunded units] from the Business Report (account level)
    'brRefunds': [[accts.index(k[0]), MONTHS.index(k[1]), v] for k, v in sorted(br_refunds.items())],
    'noReturnFrom': settle_from,
    'noReturnTo': settle_to,
    'noReturnGroup': NO_RETURN_GROUP,
    'salesCoverage': {ACCOUNTS[a]: {m: {'through': d, 'partial': d < month_end(m)}
                                    for (aa, m), d in sorted(last_day.items()) if aa == a}
                      for a in accts},
}
summ = os.path.join(MAP, 'summaries.json')
data['summaries'] = json.load(open(summ)) if os.path.exists(summ) else {}

out = os.path.join(HERE, 'data.json')
json.dump(data, open(out, 'w'), separators=(',', ':'), ensure_ascii=False)
print('comments without theme tags:', untagged)
print('refunds without a received return:', dict(no_return_units), 'settlement from', settle_from)
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
