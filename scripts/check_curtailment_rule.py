#!/usr/bin/env python3
"""
Έλεγχος του κανόνα «αποφυγή περικοπών» του tab Μηνιαίος αντίκτυπος (docs/DECISIONS.md, D67).

Για κάθε ώρα της αγοράς συγκρίνει την τιμή MCP με το υπολειπόμενο πλεόνασμα του ISP και δείχνει:
  • πόσο συμφωνούν (ώρες με τιμή <= 5 €/MWh που έχουν πλεόνασμα ISP, και ώρες με πλεόνασμα ISP και τιμή > 5 €),
  • πόση φόρτιση BESS πέφτει σε κάθε στρώμα ανά μήνα: πυρήνας (τιμή <= 5) και πρόσθετο (πλεόνασμα ISP, τιμή > 5).
Χρησιμοποιεί την ίδια στοίχιση με τη σελίδα (η ώρα SCADA h αντιστοιχεί στην ώρα αγοράς h-1).

Τρέξε:   python3 scripts/check_curtailment_rule.py          (από τη ρίζα του repo)
         python3 scripts/check_curtailment_rule.py --json   (για μηχανική ανάγνωση)
"""
import json
import sys
from collections import defaultdict
from datetime import date, timedelta
from pathlib import Path

PATH = Path(__file__).resolve().parent.parent / "data" / "historical.json"
DAY, UNIT = "Ημερομηνία", "Μονάδα BESS"
PRICE_LIMIT = 5.0      # €/MWh (CURTAILMENT_PRICE_THRESHOLD στη σελίδα)
SURPLUS_MIN = 1.0      # MWh (SURPLUS_HOUR_MIN_MWH στη σελίδα)


def main():
    d = json.loads(PATH.read_text(encoding="utf-8"))
    hk = lambda h: f"{h:02d}:00"
    surplus = {r[DAY]: [r.get(hk(h)) for h in range(1, 25)] for r in d["surplusHourly"]}
    price = {r[DAY]: [r.get(f"{h}:00") for h in range(1, 25)] for r in d["mcpHourly"]}
    charge = defaultdict(lambda: [0.0] * 24)
    for r in d["bessHourly"]:
        for i, h in enumerate(range(1, 25)):
            x = r.get(hk(h))
            if x is not None and x < 0:
                charge[r[DAY]][i] += -x
    nxt = lambda s: (date.fromisoformat(s) + timedelta(1)).isoformat()

    cells = defaultdict(lambda: {"hours": 0, "bess": 0.0})
    layers = defaultdict(lambda: {"core": 0.0, "ext": 0.0, "all": 0.0})
    cheap = cheap_with_surplus = surplus_hours = 0
    for k in sorted(set(surplus) & set(price)):
        for m in range(24):
            s, p = surplus[k][m], price[k][m]
            if s is None or p is None:
                continue
            L = m + 1                      # ώρα SCADA = ώρα αγοράς + 1
            if L < 24:
                b = charge[k][L] if k in charge else None
            else:
                b = charge[nxt(k)][0] if nxt(k) in charge else None
            has_s, is_cheap = s >= SURPLUS_MIN, p <= PRICE_LIMIT
            surplus_hours += has_s
            cheap += is_cheap
            cheap_with_surplus += (is_cheap and has_s)
            cell = ("πλεόνασμα" if has_s else "χωρίς πλεόνασμα") + (" · τιμή ≤ 5" if is_cheap else " · τιμή > 5")
            cells[cell]["hours"] += 1
            if b is not None:
                cells[cell]["bess"] += b
                layers[k[:7]]["all"] += b
                if is_cheap:
                    layers[k[:7]]["core"] += b
                elif has_s:
                    layers[k[:7]]["ext"] += b
    out = {"cells": {k: {"hours": v["hours"], "bess_mwh": round(v["bess"])} for k, v in cells.items()},
           "cheap_hours": cheap, "cheap_with_isp_surplus": cheap_with_surplus,
           "share_of_cheap_hours_with_surplus_pct": round(cheap_with_surplus / max(cheap, 1) * 100, 1),
           "surplus_hours": surplus_hours,
           "share_of_surplus_hours_cheap_pct": round(cheap_with_surplus / max(surplus_hours, 1) * 100, 1),
           "months": {m: {k: round(v) for k, v in x.items()} for m, x in sorted(layers.items())}}
    if "--json" in sys.argv:
        print(json.dumps(out, ensure_ascii=False, indent=2))
        return
    print(f"Ώρες με τιμή ≤ {PRICE_LIMIT:g} €/MWh: {cheap}, από αυτές με πλεόνασμα ISP: {cheap_with_surplus} ({out['share_of_cheap_hours_with_surplus_pct']}%)")
    print(f"Ώρες με πλεόνασμα ISP: {surplus_hours}, από αυτές με τιμή ≤ {PRICE_LIMIT:g}: {out['share_of_surplus_hours_cheap_pct']}%")
    for k, v in out["cells"].items():
        print(f"  {k:32s} {v['hours']:5d} ώρες   φόρτιση BESS {v['bess_mwh']:>8,} MWh")
    print("\nΦόρτιση BESS ανά μήνα (MWh): πυρήνας (τιμή ≤ 5) | πρόσθετο (πλεόνασμα ISP, τιμή > 5) | όλη η φόρτιση")
    for m, x in out["months"].items():
        print(f"  {m}   {x['core']:>8,} | {x['ext']:>8,} | {x['all']:>8,}")


if __name__ == "__main__":
    main()
