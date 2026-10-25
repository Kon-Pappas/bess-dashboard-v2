#!/usr/bin/env python3
"""
Μέτρηση του data/historical.json: μέγεθος, gzip, ανά κλειδί, ρυθμός ανάπτυξης και προβολή.

Τρέξε:   python3 scripts/data_size.py            (από τη ρίζα του repo)
         python3 scripts/data_size.py --json     (για μηχανική ανάγνωση)

Όρια παρακολούθησης (ROADMAP, φάση 7 · K05):
  gzip > 250 KB   ή   χρόνος μέχρι το πρώτο γράφημα > 5 s σε Slow 4G
  → περνάμε σε αρχεία ανά μήνα (πλάνο στο ROADMAP).
Η σελίδα κατεβάζει το αρχείο gzip (GitHub Pages), άρα το gzip είναι το νούμερο που μετράει για τον επισκέπτη.
"""
import gzip, json, sys, datetime as dt
from collections import defaultdict
from pathlib import Path

PATH = Path(__file__).resolve().parent.parent / "data" / "historical.json"
GZIP_LIMIT_KB = 250
DAY, UNIT = "Ημερομηνία", "Μονάδα BESS"

def main():
    raw = PATH.read_bytes()
    data = json.loads(raw)
    gz_kb = len(gzip.compress(raw, 6)) / 1024
    days = sorted({r[DAY] for r in data["isp"]})
    units_per_day = defaultdict(set)
    for r in data["bessHourly"]:
        units_per_day[r[DAY]].add(r[UNIT])
    last30 = set(days[-30:])
    per_key = {}
    for k, v in data.items():
        rows = v if isinstance(v, list) else []
        b = len(json.dumps(v, ensure_ascii=False, separators=(",", ":")).encode())
        g = len(gzip.compress(json.dumps(v, ensure_ascii=False, separators=(",", ":")).encode(), 6))
        marg = sum(len(json.dumps(r, ensure_ascii=False, separators=(",", ":"))) for r in rows if r.get(DAY) in last30) / max(len(last30), 1)
        per_key[k] = dict(raw_kb=round(b / 1024, 1), gzip_kb=round(g / 1024, 1), rows=len(rows), kb_per_day=round(marg / 1024, 2))
    growth_kb = sum(x["kb_per_day"] for x in per_key.values())
    gz_ratio = gz_kb / (len(raw) / 1024)
    last_with_units = max(units_per_day) if units_per_day else days[-1]      # η τελευταία ημέρα που έχει ωριαία δεδομένα SCADA
    units_now = len(units_per_day[last_with_units])
    result = dict(
        raw_kb=round(len(raw) / 1024, 1), gzip_kb=round(gz_kb, 1), days=len(days), first=days[0], last=days[-1],
        units_last_day=units_now, units_day=last_with_units, growth_kb_per_day_last30=round(growth_kb, 2),
        gzip_growth_kb_per_day=round(growth_kb * gz_ratio, 2),
        days_until_gzip_limit=(None if gz_kb >= GZIP_LIMIT_KB else int((GZIP_LIMIT_KB - gz_kb) / max(growth_kb * gz_ratio, 0.01))),
        over_limit=gz_kb >= GZIP_LIMIT_KB, per_key=per_key)
    if "--json" in sys.argv:
        print(json.dumps(result, ensure_ascii=False, indent=2)); return
    print(f"historical.json: {result['raw_kb']} KB raw, {result['gzip_kb']} KB gzip, {result['days']} days ({result['first']} → {result['last']}), {units_now} units on {last_with_units}")
    print(f"Growth over the last 30 days: {result['growth_kb_per_day_last30']} KB/day raw, about {result['gzip_growth_kb_per_day']} KB/day gzip")
    for k, x in sorted(per_key.items(), key=lambda kv: -kv[1]['raw_kb']):
        print(f"  {k:14s} {x['raw_kb']:8.1f} KB raw {x['gzip_kb']:7.1f} KB gzip {x['rows']:6d} rows {x['kb_per_day']:6.2f} KB/day")
    if result["over_limit"]:
        print(f"!! gzip is above {GZIP_LIMIT_KB} KB: time to move to monthly files (see docs/ROADMAP.md, phase 7).")
    else:
        d = result["days_until_gzip_limit"]
        print(f"gzip limit {GZIP_LIMIT_KB} KB: about {d} days away at today's pace (more if units keep being added: the pace grows).")

if __name__ == "__main__":
    main()
