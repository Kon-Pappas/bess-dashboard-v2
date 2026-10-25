#!/usr/bin/env python3
"""
Εκτίμηση ισχύος (MW), ενέργειας ανά κύκλο (MWh) και διάρκειας (ώρες) κάθε μονάδας BESS, μόνο από τα ωριαία SCADA.

Τρέχει μετά από κάθε ενημέρωση (update_data.py) και ξαναϋπολογίζει όλα από την αρχή:
    python3 capacity.py            → διαβάζει data/historical.json, γράφει data/capacity.json

Κανόνες (docs/DECISIONS.md, D56–D60):
  • Μόνο SCADA (bessHourly). Το ISP είναι πρόγραμμα και δεν χρησιμοποιείται.
  • Η ημέρα ΔΕΝ είναι μονάδα μέτρησης: οι ώρες χωρίζονται σε φάσεις φόρτισης και εκφόρτισης (σε διπλούς κύκλους, ή κύκλους που περνούν τα μεσάνυχτα).
  • Έγκυρος κύκλος: φόρτιση που ακολουθείται από εκφόρτιση με απόδοση 70–100%.
  • «Εξασφαλισμένη» τιμή = η τιμή που επιτεύχθηκε τουλάχιστον 3 φορές στις τελευταίες 30 ημέρες (η 3η υψηλότερη).
    Έτσι μία ανώμαλη μέρα (π.χ. 9/9, RTE 207%) ή μία δοκιμή commissioning δεν αλλάζει την εκτίμηση.
  • Κατηγορία: 2ωρη, 3ωρη, 4ωρη… = ακέραιο μέρος της διάρκειας (εκφόρτιση ÷ ισχύς), με ανοχή 0,1 ώρας.
  • Αλλαγές (αναβαθμίσεις, δοκιμές, υποβαθμίσεις): η εκτίμηση των τελευταίων 14 ημερών ξεφεύγει πάνω από 12% από το προηγούμενο επίπεδο
    για 5 συνεχόμενες ημέρες → επιβεβαιωμένη αλλαγή· για 2–4 ημέρες στο τέλος του ιστορικού → «προς επιβεβαίωση».
"""
import json
import re
import sys
from collections import defaultdict
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

DAY, UNIT = "Ημερομηνία", "Μονάδα BESS"
TAU = 2.5          # MWh/h: κάτω από αυτό η ώρα θεωρείται αδράνεια/ιδιοκατανάλωση (≈ −1 MWh τη νύχτα)
GAP = 2            # ώρες αδράνειας που γεφυρώνονται μέσα σε μία φάση
WINDOW = 30        # ημέρες για την τρέχουσα εκτίμηση (και 30 πριν για τη σύγκριση)
ASSURED_N = 3      # «εξασφαλισμένο» = επιτεύχθηκε τουλάχιστον 3 φορές
RTE_MIN, RTE_MAX = 0.70, 1.00   # έγκυρος κύκλος
MIN_VALID = 8      # λιγότεροι έγκυροι κύκλοι → «λίγα δεδομένα»
MIN_AGE_DAYS = 21  # νεότερη μονάδα → «λίγα δεδομένα»
CHANGE = 0.10      # μεταβολή πάνω από 10% σε σχέση με τις προηγούμενες 30 ημέρες → «σε αλλαγή»
CLASS_TOL = 0.1    # ώρες ανοχής στην κατηγορία (1,95 → 2ωρη)
MIN_CLASS_H = 1.9
ANOMALY_RATIO = 1.3  # ημέρα μονάδας με εκφόρτιση/φόρτιση πάνω από αυτό δεν μετράει στα ρεκόρ ενέργειας στόλου
RECORD_GAIN = 0.01   # ένα ρεκόρ πρέπει να ξεπερνά το προηγούμενο κατά 1%
CHG_WINDOW = 14      # ημέρες της «γρήγορης» εκτίμησης για την ανίχνευση αλλαγών
CHG_THR = 0.12       # μεταβολή πάνω από 12% σε σχέση με το προηγούμενο επίπεδο
CHG_RUN = 5          # συνεχόμενες ημέρες πάνω από το όριο → επιβεβαιωμένη αλλαγή
CHG_CAND = 2         # ημέρες στο τέλος του ιστορικού → «προς επιβεβαίωση»
CHG_MERGE_DAYS = 10  # αλλαγές ισχύος και ενέργειας μέσα σε 10 ημέρες είναι ένα γεγονός
MIN_LEVEL_CYCLES = 3

HOUR_KEY = re.compile(r"^(\d{2}):00$")


def _d(s):
    return date.fromisoformat(s)


def hours_of_row(row):
    """Ωριαίες τιμές μιας γραμμής SCADA: 24 (ή 23 / 25 στις αλλαγές ώρας). Κενές τιμές (null) δεν υπάρχουν στην ημέρα."""
    out = []
    for h in range(1, 26):
        v = row.get(f"{h:02d}:00")
        if v is None:
            continue
        out.append(float(v))
    return out


def load_units(hist):
    """{unit: {date: [hourly MWh]}} από το bessHourly."""
    by = defaultdict(dict)
    for r in hist.get("bessHourly", []):
        by[r[UNIT]][r[DAY]] = hours_of_row(r)
    return by


def phases_of(by_day):
    """Φάσεις φόρτισης (−1) / εκφόρτισης (+1) μιας μονάδας. Η σειρά σπάει όπου λείπει ημέρα.
    Κάθε φάση: {s, e (MWh), pk (μέγιστη ώρα), start, end (ημερομηνίες)}."""
    out, cur, idle, prev = [], None, 0, None

    def close():
        nonlocal cur, idle
        if cur:
            out.append(cur)
        cur, idle = None, 0

    for day in sorted(by_day):
        if prev is not None and (_d(day) - _d(prev)).days != 1:
            close()
        prev = day
        for x in by_day[day]:
            s = 1 if x > TAU else (-1 if x < -TAU else 0)
            if s == 0:
                if cur:
                    idle += 1
                    if idle > GAP:
                        close()
                continue
            if cur and cur["s"] == s:
                cur["e"] += abs(x); cur["pk"] = max(cur["pk"], abs(x)); cur["end"] = day; idle = 0
            else:
                close()
                cur = {"s": s, "e": abs(x), "pk": abs(x), "start": day, "end": day}
    close()
    return out


def cycles_of(phases):
    """Ζεύγη φόρτιση → εκφόρτιση. Έγκυρος κύκλος: απόδοση 70–100%."""
    out = []
    for a, b in zip(phases, phases[1:]):
        if a["s"] == -1 and b["s"] == 1 and a["e"] > 0:
            r = b["e"] / a["e"]
            out.append({"date": b["end"], "ec": a["e"], "ed": b["e"], "rte": r, "valid": RTE_MIN <= r <= RTE_MAX})
    return out


def assured(values, n=ASSURED_N):
    """Η n-οστή υψηλότερη τιμή (δηλαδή επιτεύχθηκε τουλάχιστον n φορές). None αν υπάρχουν λιγότερες από n."""
    v = sorted(values, reverse=True)
    return v[n - 1] if len(v) >= n else None


def estimate(by_day, cycles, end, window=WINDOW):
    """Εκτίμηση για το παράθυρο [end−window+1, end]."""
    lo = end - timedelta(days=window - 1)
    hrs = [abs(x) for k, v in by_day.items() if lo <= _d(k) <= end for x in v if abs(x) >= TAU]
    cyc = [c for c in cycles if lo <= _d(c["date"]) <= end]
    valid = [c for c in cyc if c["valid"]]
    p = assured(hrs)
    e = assured([c["ed"] for c in valid])
    ec = assured([c["ec"] for c in valid])
    return {"power": p, "energy": e, "energy_charge": ec, "n_cycles": len(cyc), "n_valid": len(valid),
            "duration": (e / p) if (e and p) else None}


def class_of(duration):
    if duration is None or duration < MIN_CLASS_H:
        return None
    return int(duration + CLASS_TOL)


def pct(new, old):
    return round((new / old - 1) * 100, 1) if (new and old) else None


def level_series(days, cyc, first, as_of):
    """Καθημερινή «γρήγορη» εκτίμηση (τελευταίες 14 ημέρες): [(ημερομηνία, ισχύς, ενέργεια, έγκυροι κύκλοι)]."""
    out, t = [], _d(first) + timedelta(days=CHG_WINDOW)
    while t <= as_of:
        e = estimate(days, cyc, t, window=CHG_WINDOW)
        out.append((t, e["power"], e["energy"], e["n_valid"]))
        t += timedelta(days=1)
    return out


def _median(vals):
    v = sorted(vals)
    return v[len(v) // 2]


def detect_changes(series):
    """Βήματα στο επίπεδο ισχύος / ενέργειας μιας μονάδας. Ένα νέο επίπεδο γίνεται το «προηγούμενο» και ξεκινά η σύγκριση από την αρχή,
    οπότε μια δοκιμή που επιστρέφει (π.χ. 9/7 και 22/7 της ENE_01SB) δίνει δύο γεγονότα."""
    ref = {"power": None, "energy": None}
    run = {"power": [], "energy": []}
    raw = []
    snap = lambda: (ref["power"], ref["energy"])
    for t, p, e, n in series:
        if n < MIN_LEVEL_CYCLES:
            continue
        if ref["power"] is None and p: ref["power"] = p
        if ref["energy"] is None and e: ref["energy"] = e
        if ref["power"] is None or ref["energy"] is None:
            continue
        for kind, val in (("power", p), ("energy", e)):
            if val is None:
                continue
            if abs(val / ref[kind] - 1) >= CHG_THR:
                run[kind].append((t, val))
            else:
                run[kind].clear()
            if len(run[kind]) >= CHG_RUN:
                before = snap(); new = _median([v for _, v in run[kind]])
                raw.append({"date": run[kind][0][0], "kind": kind, "confirmed": True, "before": before})
                ref[kind] = new
                raw[-1]["after"] = snap(); run[kind].clear()
    for kind in ("power", "energy"):          # ό,τι τρέχει ακόμα στο τέλος του ιστορικού
        r = run[kind]
        if len(r) >= CHG_CAND:
            before = snap(); new = _median([v for _, v in r])
            after = (new, ref["energy"]) if kind == "power" else (ref["power"], new)
            raw.append({"date": r[0][0], "kind": kind, "confirmed": False, "before": before, "after": after})
    return sorted(raw, key=lambda x: x["date"])


def merge_changes(raw):
    """Αλλαγές ισχύος και ενέργειας μέσα σε CHG_MERGE_DAYS ημέρες γίνονται ένα γεγονός (π.χ. διπλασιασμός μονάδας)."""
    groups = []
    for ev in raw:
        if groups and (ev["date"] - groups[-1][-1]["date"]).days <= CHG_MERGE_DAYS:
            groups[-1].append(ev)
        else:
            groups.append([ev])
    out = []
    for g in groups:
        b, a = g[0]["before"], g[-1]["after"]
        ch = lambda x, y: None if (not x or not y or abs(y / x - 1) < 0.01) else {"from": round(x), "to": round(y), "pct": round((y / x - 1) * 100)}
        pw, en = ch(b[0], a[0]), ch(b[1], a[1])
        signs = [c["pct"] for c in (pw, en) if c]
        kind = "up" if signs and min(signs) >= 0 else ("down" if signs and max(signs) <= 0 else "mixed")
        extra = {}
        if len(g) > 1 and all(abs(x) < CHG_THR * 100 for x in signs):   # πτώση και επιστροφή (ή άνοδος και επιστροφή) μέσα στην ίδια ομάδα
            states = [g[0]["before"]] + [x["after"] for x in g]
            ps = [p for p, _ in states if p]; es = [e for _, e in states if e]
            dev = lambda vals, base: max((abs(v / base - 1), v) for v in vals)
            (dp, vp), (de, ve) = dev(ps, b[0]), dev(es, b[1])
            kind = "dip" if (ve < b[1] or vp < b[0]) and (ve / b[1] if de >= dp else vp / b[0]) < 1 else "surge"
            extra = {"date_to": g[-1]["date"].isoformat(), "extreme_power": round(vp), "extreme_energy": round(ve)}
            pw = en = None                          # η καθαρή μεταβολή ενός επεισοδίου δεν λέει τίποτα· δείχνουμε το άκρο
        cf = class_of(b[1] / b[0]) if b[0] and b[1] else None
        ct = class_of(a[1] / a[0]) if a[0] and a[1] else None
        if extra:
            ct = cf
        out.append({"date": g[0]["date"].isoformat(), "confirmed": all(x["confirmed"] for x in g), "kind": kind,
                    "power": pw, "energy": en, "class_from": cf, "class_to": ct,
                    "duration_from": round(b[1] / b[0], 2) if b[0] and b[1] else None, "duration_to": round(a[1] / a[0], 2) if a[0] and a[1] else None, **extra})
    return out


def since_of(ev, days, cyc):
    """Πότε ξεκίνησε περίπου η αλλαγή: η πρώτη ώρα ή ο πρώτος έγκυρος κύκλος στο νέο επίπεδο, μέχρι 14 ημέρες πριν ανιχνευθεί.
    Η ανίχνευση αργεί λίγες ημέρες (χρειάζονται 3 κύκλοι στο νέο επίπεδο)."""
    d = _d(ev["date"]); lo = d - timedelta(days=CHG_WINDOW)
    cands = []
    if ev["kind"] != "down":
        if ev["power"]:
            t = ev["power"]["to"] * 0.95
            cands += [_d(k) for k, v in days.items() if lo <= _d(k) <= d and any(abs(x) >= t for x in v)]
        if ev["energy"]:
            t = ev["energy"]["to"] * 0.95
            cands += [_d(c["date"]) for c in cyc if c["valid"] and lo <= _d(c["date"]) <= d and c["ed"] >= t]
    return (min(cands) if cands else d).isoformat()


def week_start(d):
    return d - timedelta(days=d.weekday())


def build(hist, now=None):
    by = load_units(hist)
    if not by:
        return {"generated": (now or datetime.now(timezone.utc)).strftime("%Y-%m-%dT%H:%M:%SZ"), "as_of": None, "units": [], "fleet": {"weekly": []}, "records": {"cards": [], "events": []}}
    as_of = max(_d(k) for v in by.values() for k in v)
    units, cyc_by, ph_by = [], {}, {}
    for u in sorted(by):
        days = by[u]
        ph = phases_of(days); cyc = cycles_of(ph)
        cyc_by[u], ph_by[u] = cyc, ph
        active = sorted(k for k, v in days.items() if any(abs(x) >= TAU for x in v))
        if not active:
            continue
        first, age = active[0], (as_of - _d(active[0])).days + 1
        now_est = estimate(days, cyc, as_of)
        prev_est = estimate(days, cyc, as_of - timedelta(days=WINDOW))
        trend_p, trend_e = pct(now_est["power"], prev_est["power"]), pct(now_est["energy"], prev_est["energy"])
        if now_est["energy"] is None or now_est["n_valid"] < MIN_VALID or age < MIN_AGE_DAYS:
            status = "few_data"
        elif any(t is not None and abs(t) > CHANGE * 100 for t in (trend_p, trend_e)):
            status = "changing"
        else:
            status = "stable"
        # ημέρες με ανωμαλία (εκφόρτιση πολύ μεγαλύτερη από φόρτιση) στο τρέχον παράθυρο
        lo = as_of - timedelta(days=WINDOW - 1)
        anomalies = 0
        for k, v in days.items():
            if lo <= _d(k) <= as_of:
                c = sum(-x for x in v if x < -TAU); dch = sum(x for x in v if x > TAU)
                if c > 0 and dch / c > ANOMALY_RATIO and dch > 50:
                    anomalies += 1
        # καθημερινή «γρήγορη» εκτίμηση (14 ημέρες) και αλλαγές επιπέδου
        lv = level_series(days, cyc, first, as_of)
        changes = merge_changes(detect_changes(lv))
        for c in changes:
            c["since"] = since_of(c, days, cyc)
        series = {"start": lv[0][0].isoformat() if lv else None,
                  "p": [round(x[1]) if x[1] else None for x in lv], "e": [round(x[2]) if x[2] else None for x in lv]}
        units.append({
            "unit": u, "site": u.split("_")[0], "first_seen": first, "age_days": age,
            "power_mw": round(now_est["power"]) if now_est["power"] else None,
            "power_all_mw": round(max((abs(x) for v in days.values() for x in v), default=0)),
            "energy_mwh": round(now_est["energy"]) if now_est["energy"] else None,
            "energy_charge_mwh": round(now_est["energy_charge"]) if now_est["energy_charge"] else None,
            "duration_h": round(now_est["duration"], 2) if now_est["duration"] else None,
            "class_h": class_of(now_est["duration"]),
            "cycles_30": now_est["n_cycles"], "valid_30": now_est["n_valid"],
            "status": status, "trend_power_pct": trend_p, "trend_energy_pct": trend_e,
            "anomaly_days_30": anomalies, "changes": changes, "series": series})

    # ---- στόλος: εβδομαδιαία εκτίμηση (το άθροισμα των εκτιμήσεων κάθε μονάδας στο παράθυρο που τελειώνει εκείνη την εβδομάδα)
    first_all = min(_d(u["first_seen"]) for u in units)
    fleet, w = [], week_start(first_all)
    while w <= as_of:
        end = min(w + timedelta(days=6), as_of)
        mw = mwh = n = 0
        for u in units:
            est = estimate(by[u["unit"]], cyc_by[u["unit"]], end)
            if est["power"] and est["energy"]:
                mw += est["power"]; mwh += est["energy"]; n += 1
        if n:
            fleet.append({"w": w.isoformat(), "mw": round(mw), "mwh": round(mwh), "h": round(mwh / mw, 2), "units": n})
        w += timedelta(days=7)

    return {
        "generated": (now or datetime.now(timezone.utc)).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "as_of": as_of.isoformat(),
        "data_from": min(_d(k) for v in by.values() for k in v).isoformat(),   # η πρώτη ημέρα με SCADA
        "params": {"tau_mwh": TAU, "gap_h": GAP, "window_days": WINDOW, "assured_n": ASSURED_N, "rte_valid": [RTE_MIN, RTE_MAX],
                   "min_valid_cycles": MIN_VALID, "min_age_days": MIN_AGE_DAYS, "change_pct": CHANGE * 100, "class_tolerance_h": CLASS_TOL},
        "units": units,
        "fleet": {"weekly": fleet},
        "changes": fleet_changes(units),
        "records": records(by, as_of),
    }


def fleet_changes(units, limit=12):
    """Οι τελευταίες αλλαγές όλων των μονάδων, νεότερες πρώτα."""
    ev = [dict(c, unit=u["unit"]) for u in units for c in u["changes"]]
    ev.sort(key=lambda c: (c["date"], c["unit"]), reverse=True)
    return {"latest": ev[:limit], "total": len(ev), "pending": sum(1 for c in ev if not c["confirmed"])}


def records(by, as_of):
    """Ρεκόρ στόλου από την αρχή της καταγραφής: ταυτόχρονη ισχύς φόρτισης/εκφόρτισης και ημερήσια ενέργεια.
    Μια ημέρα μονάδας με εκφόρτιση ≫ φόρτιση (ανωμαλία, π.χ. 9/9) δεν μετράει στα ρεκόρ ενέργειας."""
    days = sorted({k for v in by.values() for k in v})
    best = {m: None for m in ("fleet_dis_mw", "fleet_chg_mw", "fleet_dis_mwh", "fleet_chg_mwh")}
    events, cards = [], {}
    for k in days:
        n = max((len(by[u][k]) for u in by if k in by[u]), default=0)
        dis_h, chg_h = [0.0] * n, [0.0] * n
        dis_d = chg_d = 0.0
        for u in by:
            v = by[u].get(k)
            if not v:
                continue
            for i, x in enumerate(v):
                if x > TAU: dis_h[i] += x
                elif x < -TAU: chg_h[i] += -x
            c = sum(-x for x in v if x < -TAU); d_ = sum(x for x in v if x > TAU)
            if c > 0 and d_ / c > ANOMALY_RATIO and d_ > 50:
                continue   # ανώμαλη ημέρα μονάδας
            dis_d += d_; chg_d += c
        vals = {"fleet_dis_mw": (max(dis_h, default=0), (dis_h.index(max(dis_h)) + 1) if dis_h else None),
                "fleet_chg_mw": (max(chg_h, default=0), (chg_h.index(max(chg_h)) + 1) if chg_h else None),
                "fleet_dis_mwh": (dis_d, None), "fleet_chg_mwh": (chg_d, None)}
        for m, (v, hour) in vals.items():
            prev = best[m]
            if v > 0 and (prev is None or v > prev["value"] * (1 + RECORD_GAIN)):
                ev = {"metric": m, "date": k, "value": round(v), "hour": hour, "prev": round(prev["value"]) if prev else None, "prev_date": prev["date"] if prev else None}
                events.append(ev)
                best[m] = {"value": v, "date": k, "hour": hour}
    for m, b in best.items():
        if b:
            cards[m] = {"metric": m, "value": round(b["value"]), "date": b["date"], "hour": b["hour"]}
    order = ["fleet_dis_mw", "fleet_chg_mw", "fleet_dis_mwh", "fleet_chg_mwh"]
    events.sort(key=lambda e: (e["date"], order.index(e["metric"])), reverse=True)
    return {"cards": [cards[m] for m in order if m in cards], "events": events[:12], "events_total": len(events)}


def write(hist_path=None, out_path=None):
    root = Path(__file__).resolve().parent
    hist_path = Path(hist_path) if hist_path else root / "data" / "historical.json"
    out_path = Path(out_path) if out_path else root / "data" / "capacity.json"
    hist = json.loads(hist_path.read_text(encoding="utf-8"))
    out = build(hist)
    tmp = out_path.with_suffix(".tmp")
    tmp.write_text(json.dumps(out, ensure_ascii=False, separators=(",", ":"), allow_nan=False) + "\n", encoding="utf-8")
    tmp.replace(out_path)   # ατομική εγγραφή
    return out


if __name__ == "__main__":
    res = write(*(sys.argv[1:3]))
    print(f"capacity.json: {len(res['units'])} μονάδες, as_of {res['as_of']}, {len(res['fleet']['weekly'])} εβδομάδες στόλου")
