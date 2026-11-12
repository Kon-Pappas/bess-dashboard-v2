#!/usr/bin/env python3
"""
Μέγιστη ισχύς (MW), μέγιστη ενέργεια ενός κύκλου (MWh) και διάρκεια (ώρες) κάθε μονάδας BESS, μόνο από τα ωριαία SCADA.

Τρέχει μετά από κάθε ενημέρωση (update_data.py) και ξαναϋπολογίζει όλα από την αρχή:
    python3 capacity.py            → διαβάζει data/historical.json, γράφει data/capacity.json

Κανόνες (docs/DECISIONS.md, D76–D86):
  • Μόνο SCADA (bessHourly). Το ISP είναι πρόγραμμα και δεν χρησιμοποιείται.
  • Η ισχύς και η ενέργεια κύκλου είναι ΙΣΤΟΡΙΚΑ ΜΕΓΙΣΤΑ που ΔΕΝ ΜΕΙΩΝΟΝΤΑΙ ΠΟΤΕ. Μικρότερη ισχύς ή φόρτιση σε μια ημέρα είναι επιλογή
    χρήσης, όχι μείωση. Άρα δεν υπάρχουν γεγονότα «πτώσης», μόνο αναβαθμίσεις.
  • Οι πρώτες 40 ημέρες λειτουργίας κάθε μονάδας (commissioning) δεν μετράνε για το μέγιστο· τα νούμερα εκείνης της περιόδου φαίνονται
    ως «όσα φάνηκαν ως τώρα», χωρίς κατηγορία. Μονάδα που δούλευε ήδη όταν ξεκίνησε το SCADA μας μετράει από την πρώτη ημέρα του SCADA.
  • Μετά τις 40 ημέρες χρειάζεται βάση 14 ημερών και 8 έγκυρων κύκλων, αλλιώς «λίγα δεδομένα» (προσωρινή κατηγορία).
  • Εξασφαλισμένη τιμή = η 3η υψηλότερη από ΤΡΕΙΣ ΔΙΑΦΟΡΕΤΙΚΕΣ ΗΜΕΡΕΣ (για την ισχύ: μέγιστο κάθε ημέρας· για την ενέργεια: έγκυρος κύκλος
    με απόδοση 70–100%). Έτσι ένα λάθος SCADA 1–2 ημερών δεν γίνεται «μέγιστο» για πάντα, και το μέγιστο δεν μειώνεται όταν προστίθενται ημέρες.
  • Αναβάθμιση: η εξασφαλισμένη τιμή ανεβαίνει ≥ 12% πάνω από το προηγούμενο επίπεδο. Αν μόνο 1–2 ημέρες των τελευταίων 14 είναι ≥ 12% πάνω:
    «προς επιβεβαίωση (1 ή 2 από 3 ημέρες)».
  • Κατηγορία: 2ωρη, 3ωρη, 4ωρη… = ακέραιο μέρος της διάρκειας (μέγιστη ενέργεια κύκλου ÷ μέγιστη ισχύς), με ανοχή 0,1 ώρας.
  • Παύση (7+ ημέρες χωρίς δραστηριότητα) είναι πληροφορία, όχι μείωση.
  • Κολλημένη μέτρηση: ≥ 6 συνεχόμενες ώρες με ακριβώς την ίδια τιμή (τουλάχιστον 20% της μέγιστης ισχύος της μονάδας). Οι ημέρες αυτές, και οι ημέρες με
    πάνω από 2,2 κύκλους ή ώρα πολύ πάνω από το συνηθισμένο, είναι «ύποπτες»: ΑΓΝΟΟΥΝΤΑΙ στις εκτιμήσεις και σημαίνονται στη σελίδα.
  • Όριο αδράνειας ανά μονάδα: max(2,5, 1,5% της μέγιστης ισχύος της), ώστε η ιδιοκατανάλωση μεγάλων μονάδων (π.χ. −3 MWh/ώρα) να μη μετράει ως φόρτιση.
"""
import json
import re
import sys
from collections import defaultdict
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

DAY, UNIT = "Ημερομηνία", "Μονάδα BESS"
TAU = 2.5               # MWh/h: κάτω από αυτό η ώρα είναι αδράνεια/ιδιοκατανάλωση (≈ −1 MWh τη νύχτα)
GAP = 2                 # ώρες αδράνειας που γεφυρώνονται μέσα σε μία φάση
ASSURED_N = 3           # «εξασφαλισμένο» = επιτεύχθηκε σε τουλάχιστον 3 διαφορετικές ημέρες
RTE_MIN, RTE_MAX = 0.70, 1.00   # έγκυρος κύκλος
COMMISSIONING_DAYS = 40         # ημέρες εξαίρεσης από την πρώτη δραστηριότητα
BASELINE_DAYS = 14              # ημέρες μετά την εξαίρεση πριν συγκρίνουμε για αναβαθμίσεις
BASELINE_CYCLES = 8             # έγκυροι κύκλοι μετά την εξαίρεση πριν συγκρίνουμε
UPGRADE = 0.12                  # αύξηση ≥ 12% του μεγίστου = αναβάθμιση
RECENT_DAYS = 14                # «προς επιβεβαίωση»: ημέρες πάνω από το όριο μέσα στις τελευταίες 14
MERGE_DAYS = 10                 # αλλαγές ισχύος και ενέργειας μέσα σε 10 ημέρες είναι ένα γεγονός
CLASS_TOL = 0.1                 # ώρες ανοχής στην κατηγορία (1,95 → 2ωρη)
MIN_CLASS_H = 1.9
PAUSE_DAYS = 7                  # ημέρες χωρίς καμία ώρα δραστηριότητας → «χωρίς δραστηριότητα»
PAUSE_MIN_ACTIVE = 5            # η μονάδα πρέπει να είχε ≥ 5 ενεργές ημέρες στις 14 πριν
SPIKE_RATIO = 1.25              # ώρα πάνω από 1,25× το 99ο εκατοστημόριο της μονάδας → ύποπτο δεδομένο
SPIKE_MIN_HOURS = 50
FROZEN_HOURS = 6                # ≥ 6 συνεχόμενες ώρες με ακριβώς την ίδια τιμή → κολλημένη μέτρηση
FROZEN_SHARE = 0.20             # ... αν η τιμή είναι ≥ 20% της μέγιστης ισχύος της μονάδας (όχι η ιδιοκατανάλωση)
TAU_SHARE = 0.015               # όριο αδράνειας ανά μονάδα = max(TAU, 1,5% της μέγιστης ισχύος της)
SHARED_MIN_UNITS = 3            # ίδια αναβάθμιση σε τόσες μονάδες μέσα σε SHARED_DAYS ημέρες → πιθανό σφάλμα αρχείου
SHARED_DAYS = 2


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


def phases_of(by_day, tau=TAU):
    """Φάσεις φόρτισης (−1) / εκφόρτισης (+1) μιας μονάδας. Η σειρά σπάει όπου λείπει ημέρα."""
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
            s = 1 if x > tau else (-1 if x < -tau else 0)
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


def third(items):
    """Η 3η υψηλότερη τιμή μιας λίστας (τιμή, ημερομηνία) από τρεις διαφορετικές ημέρες, και οι τρεις ημερομηνίες· (None, []) αν είναι λιγότερες."""
    top = sorted(items, key=lambda x: -x[0])[:ASSURED_N]
    return (top[ASSURED_N - 1][0], [x[1] for x in top]) if len(top) >= ASSURED_N else (None, [])


def class_of(duration):
    if duration is None or duration < MIN_CLASS_H:
        return None
    return int(duration + CLASS_TOL)


def week_start(d):
    return d - timedelta(days=d.weekday())


def _chg(x, y):
    return None if (not x or not y or abs(y / x - 1) < 0.01) else {"from": round(x), "to": round(y), "pct": round((y / x - 1) * 100)}


def merge_upgrades(raw):
    """Αναβαθμίσεις ισχύος και ενέργειας μέσα σε MERGE_DAYS ημέρες γίνονται ένα γεγονός (π.χ. διπλασιασμός μονάδας)."""
    raw = sorted(raw, key=lambda x: x["date"])
    groups = []
    for ev in raw:
        if groups and (_d(ev["date"]) - _d(groups[-1][-1]["date"])).days <= MERGE_DAYS:
            groups[-1].append(ev)
        else:
            groups.append([ev])
    out = []
    for g in groups:
        b, a = g[0]["before"], g[-1]["after"]
        cf = class_of(b[1] / b[0]) if b[0] and b[1] else None
        ct = class_of(a[1] / a[0]) if a[0] and a[1] else None
        out.append({"date": g[0]["date"], "since": min(x["since"] for x in g), "confirmed": all(x["confirmed"] for x in g), "kind": "up",
                    "power": _chg(b[0], a[0]), "energy": _chg(b[1], a[1]), "class_from": cf, "class_to": ct,
                    "duration_from": round(b[1] / b[0], 2) if b[0] and b[1] else None, "duration_to": round(a[1] / a[0], 2) if a[0] and a[1] else None})
    return out


def scan_unit(days, as_of, tau=TAU):
    """Όλα τα στοιχεία μιας μονάδας από τις ωριαίες τιμές της. Επιστρέφει None αν η μονάδα δεν έχει δραστηριότητα."""
    ks = sorted(days)
    active = [k for k in ks if any(abs(x) >= tau for x in days[k])]
    if not active:
        return None
    first = _d(active[0]); cutoff = first + timedelta(days=COMMISSIONING_DAYS)
    peaks = {k: max(abs(x) for x in days[k]) for k in ks if days[k]}
    cyc = defaultdict(list)
    for c in cycles_of(phases_of(days, tau)):
        if c["valid"]:
            cyc[c["date"]].append(c["ed"])
    n_dates = (as_of - first).days + 1
    pv_all, ev_all, pv_post, ev_post = [], [], [], []
    obs_p, obs_e, post_p, post_e = [None] * n_dates, [None] * n_dates, [None] * n_dates, [None] * n_dates
    n_post_cycles, level, raw, since_p, since_e, prev_p, prev_e = 0, None, [], None, None, None, None
    baseline_ok = False
    for i in range(n_dates):
        t = first + timedelta(days=i); k = t.isoformat(); post = t >= cutoff
        if k in peaks and peaks[k] >= tau:
            pv_all.append((peaks[k], k))
            if post:
                pv_post.append((peaks[k], k))
        for ed in cyc.get(k, []):
            ev_all.append((ed, k))
            if post:
                ev_post.append((ed, k)); n_post_cycles += 1
        po, _ = third(pv_all); eo, _ = third(ev_all)
        obs_p[i] = round(po) if po else None; obs_e[i] = round(eo) if eo else None
        if not post:
            continue
        p, p3 = third(pv_post); e, e3 = third(ev_post)
        post_p[i] = round(p) if p else None; post_e[i] = round(e) if e else None
        if p != prev_p and p is not None:
            since_p = k; prev_p = p
        if e != prev_e and e is not None:
            since_e = k; prev_e = e
        baseline_ok = (t - cutoff).days >= BASELINE_DAYS and n_post_cycles >= BASELINE_CYCLES and p is not None and e is not None
        if not baseline_ok:
            continue
        if level is None:
            level = [p, e]
            continue
        if p >= level[0] * (1 + UPGRADE):
            raw.append({"date": k, "kind": "power", "confirmed": True, "before": (level[0], level[1]), "after": (p, level[1]), "since": min(p3)})
            level[0] = p
        if e >= level[1] * (1 + UPGRADE):
            raw.append({"date": k, "kind": "energy", "confirmed": True, "before": (level[0], level[1]), "after": (level[0], e), "since": min(e3)})
            level[1] = e
    # τρέχουσες τιμές
    in_comm = as_of < cutoff
    p_now, _ = third(pv_post); e_now, _ = third(ev_post)
    po, _ = third(pv_all); eo, _ = third(ev_all)
    P, E = (po, eo) if in_comm else (p_now, e_now)
    # «προς επιβεβαίωση»: 1–2 ημέρες των τελευταίων 14 είναι ≥ 12% πάνω από το εξασφαλισμένο μέγιστο
    pending = {"power": None, "energy": None}
    if baseline_ok:
        rp = [(v, k) for v, k in pv_post if (as_of - _d(k)).days < RECENT_DAYS and v >= p_now * (1 + UPGRADE)]
        re_ = [(v, k) for v, k in ev_post if (as_of - _d(k)).days < RECENT_DAYS and v >= e_now * (1 + UPGRADE)]
        if rp:
            pending["power"] = {"value": round(max(v for v, _ in rp)), "days": len({k for _, k in rp}), "since": min(k for _, k in rp)}
            raw.append({"date": pending["power"]["since"], "kind": "power", "confirmed": False, "before": (p_now, e_now), "after": (max(v for v, _ in rp), e_now), "since": pending["power"]["since"]})
        if re_:
            pending["energy"] = {"value": round(max(v for v, _ in re_)), "days": len({k for _, k in re_}), "since": min(k for _, k in re_)}
            raw.append({"date": pending["energy"]["since"], "kind": "energy", "confirmed": False, "before": (p_now, e_now), "after": (p_now, max(v for v, _ in re_)), "since": pending["energy"]["since"]})
    duration = (E / P) if (E and P) else None
    status = "commissioning" if in_comm else ("few_data" if not baseline_ok else "stable")
    return {
        "first": first, "cutoff": cutoff, "status": status, "baseline_ok": baseline_ok, "pending": pending,
        "power": P, "energy": E, "duration": duration, "class_h": None if in_comm else class_of(duration),
        "power_since": since_p if not in_comm else None, "energy_since": since_e if not in_comm else None,
        "changes": merge_upgrades(raw), "n_post_cycles": n_post_cycles, "all_p": obs_p, "all_e": obs_e,
        "series": {"start": first.isoformat(), "cutoff": (cutoff - first).days, "p_obs": obs_p, "e_obs": obs_e, "p": post_p, "e": post_e},
    }


def tau_of(days):
    """Όριο αδράνειας της μονάδας: max(2,5 MWh, 1,5% της μέγιστης ισχύος της)· η μέγιστη ισχύς εδώ είναι το 99ο εκατοστημόριο των ενεργών ωρών."""
    allabs = sorted(abs(x) for v in days.values() for x in v if abs(x) >= TAU)
    if not allabs:
        return TAU
    ref = allabs[int(len(allabs) * 0.99)] if len(allabs) >= SPIKE_MIN_HOURS else allabs[-1]
    return max(TAU, TAU_SHARE * ref)


def frozen_runs_of(days, tau):
    """Κολλημένη μέτρηση: ≥ FROZEN_HOURS συνεχόμενες ώρες (και μέσα από τα μεσάνυχτα) με ΑΚΡΙΒΩΣ την ίδια τιμή, τουλάχιστον FROZEN_SHARE της μέγιστης ισχύος
    της μονάδας. Σε μια πραγματική λειτουργία οι τιμές αλλάζουν· η ιδιοκατανάλωση (μικρή σταθερή τιμή) δεν μετράει."""
    allabs = sorted(abs(x) for v in days.values() for x in v if abs(x) >= tau)
    if len(allabs) < SPIKE_MIN_HOURS:
        return []
    floor = max(tau, FROZEN_SHARE * allabs[int(len(allabs) * 0.99)])
    runs, cur, prev = [], None, None

    def close():
        nonlocal cur
        if cur and cur["n"] >= FROZEN_HOURS:
            runs.append(cur)
        cur = None

    for k in sorted(days):
        if prev is not None and (_d(k) - _d(prev)).days != 1:
            close()
        prev = k
        for x in days[k]:
            if abs(x) >= floor and cur and x == cur["v"]:
                cur["n"] += 1; cur["to"] = k; cur["per_day"][k] = cur["per_day"].get(k, 0) + 1
            elif abs(x) >= floor:
                close(); cur = {"v": x, "n": 1, "from": k, "to": k, "per_day": {k: 1}}
            else:
                close()
    close()
    return runs


def suspect_days_of(days, tau=TAU):
    """Ημέρες με ΥΠΟΠΤΑ δεδομένα (πιθανό σφάλμα SCADA, όχι βλάβη), για όλο το ιστορικό:
    (α) κολλημένη μέτρηση (frozen)· (β) μέσα σε μία ημέρα εκφόρτιση ή φόρτιση πάνω από 2,2 κύκλους της μονάδας (90ό εκατοστημόριο των έγκυρων κύκλων της)·
    (γ) ώρα πάνω από 1,25× το 99ο εκατοστημόριο της ίδιας της μονάδας. Αγνοούνται στις εκτιμήσεις και σημαίνονται στη σελίδα (διακόπτης «χωρίς ύποπτες μετρήσεις»)."""
    out, seen = [], set()
    for r in frozen_runs_of(days, tau):
        for k, hrs in r["per_day"].items():
            if hrs >= FROZEN_HOURS and k not in seen:   # ημέρα με ≥ 6 ώρες της κολλημένης περιόδου (οι ημέρες-σύνορα με λίγες ώρες δεν αγνοούνται ολόκληρες)
                seen.add(k)
                out.append({"date": k, "reason": "frozen", "value": round(abs(r["v"]), 1), "hours": r["n"], "run_from": r["from"], "run_to": r["to"]})
    rest = {k: v for k, v in days.items() if k not in seen}
    valid = [c for c in cycles_of(phases_of(rest, tau)) if c["valid"]]
    if len(valid) >= 8:
        pct90 = lambda vals: sorted(vals)[int((len(vals) - 1) * 0.9)]
        e90, c90 = pct90([c["ed"] for c in valid]), pct90([c["ec"] for c in valid])
        allabs = sorted(abs(x) for v in rest.values() for x in v if abs(x) >= tau)
        p99 = allabs[int(len(allabs) * 0.99)] if len(allabs) >= SPIKE_MIN_HOURS else None
        for k in sorted(rest):
            if not rest[k]:
                continue
            v = rest[k]
            dch = sum(x for x in v if x > tau); ch = sum(-x for x in v if x < -tau)
            if dch > 2.2 * e90 or ch > 2.2 * c90:
                out.append({"date": k, "reason": "cycles", "value": round(max(dch / e90, ch / c90), 1)})
            elif p99 and max(abs(x) for x in v) > SPIKE_RATIO * p99:
                out.append({"date": k, "reason": "spike", "value": round(max(abs(x) for x in v))})
    return sorted(out, key=lambda x: x["date"])


def idle_streak(days, as_of, tau=TAU):
    """Συνεχόμενες ημέρες (που υπάρχουν στα δεδομένα) χωρίς ΚΑΜΙΑ ώρα δραστηριότητα (όλες οι ώρες κάτω από το όριο αδράνειας της μονάδας) μέχρι σήμερα, αν η μονάδα
    δούλευε πριν (≥ PAUSE_MIN_ACTIVE ενεργές ημέρες στις 14 πριν) και η περίοδος είναι ≥ PAUSE_DAYS. Επιστρέφει {days, from, last_active} ή None.
    Ουδέτερη πληροφορία: δεν ξεχωρίζει βλάβη από απόφαση και δεν είναι μείωση· το μέγιστο δεν αλλάζει."""
    ks = sorted(days)
    if not ks or _d(ks[-1]) < as_of:
        return None
    n, i = 0, len(ks) - 1
    while i >= 0 and not any(abs(x) >= tau for x in days[ks[i]]) and (i == len(ks) - 1 or (_d(ks[i + 1]) - _d(ks[i])).days == 1):
        n += 1; i -= 1
    if n < PAUSE_DAYS:
        return None
    lo = _d(ks[i + 1]) - timedelta(days=14)
    before = sum(1 for k in ks if lo <= _d(k) < _d(ks[i + 1]) and any(abs(x) >= tau for x in days[k]))
    if before < PAUSE_MIN_ACTIVE:
        return None
    return {"days": n, "from": ks[i + 1], "last_active": ks[i] if i >= 0 else None}


def idle_days_now(days, as_of, tau=TAU):
    st = idle_streak(days, as_of, tau)
    return st["days"] if st else 0


def isp_name(unit):
    """ENE_01SB → ENE_BZ1_01_SB (το όνομα της μονάδας στο ISP)"""
    a, b = unit.split("_", 1)
    return f"{a}_BZ1_{b[:2]}_{b[2:]}"


def isp_zero_context(isp, unit, streak, as_of):
    """Πλαίσιο προγράμματος για τις ημέρες ακινησίας: ΜΟΝΟ αν το ISP προγραμμάτισε 0 MWh (φόρτιση και εκφόρτιση) την ημέρα. Δεν λέμε ποτέ τι «δεν εκτελέστηκε»:
    μια ροή εκτός ISP (ενδοημερήσια, aFRR, mFRR) θα φαινόταν στο SCADA. Επιστρέφει (συνεχόμενες ημέρες με 0 στο ISP μέχρι σήμερα, αν ισχύει για όλες τις ημέρες)."""
    if not streak:
        return 0, False
    name, zero, d = isp_name(unit), 0, as_of
    while d >= _d(streak["from"]):
        r = isp.get((name, d.isoformat()))
        if r is None or r.get("Φόρτιση (MWh)") is None or r.get("Αποφόρτιση (MWh)") is None or r["Φόρτιση (MWh)"] > 0.5 or r["Αποφόρτιση (MWh)"] > 0.5:
            break
        zero += 1; d -= timedelta(days=1)
    return zero, zero == streak["days"]


def mark_shared(units):
    """Ίδια αναβάθμιση σε ≥ SHARED_MIN_UNITS μονάδες μέσα σε SHARED_DAYS ημέρες: πιθανό σφάλμα αρχείου, όχι αναβαθμίσεις."""
    ev = [(c, u["unit"]) for u in units for c in u["changes"]]
    for c, _ in ev:
        near = {u2 for c2, u2 in ev if abs((_d(c2["date"]) - _d(c["date"])).days) <= SHARED_DAYS}
        c["shared"] = len(near) >= SHARED_MIN_UNITS


def fleet_changes(units, limit=60):
    """Όλες οι αναβαθμίσεις όλων των μονάδων, νεότερες πρώτα (για την καρτέλα «Αλλαγές & παρακολούθηση»)."""
    ev = [dict(c, unit=u["unit"]) for u in units for c in u["changes"]]
    ev.sort(key=lambda c: (c["date"], c["unit"]), reverse=True)
    return {"latest": ev[:limit], "total": len(ev), "pending": sum(1 for c in ev if not c["confirmed"]), "shared": sum(1 for c in ev if c.get("shared"))}


def build(hist, now=None):
    by = load_units(hist)
    isp = {(r[UNIT], r[DAY]): r for r in hist.get("isp", [])}
    stamp = (now or datetime.now(timezone.utc)).strftime("%Y-%m-%dT%H:%M:%SZ")
    if not by:
        return {"generated": stamp, "as_of": None, "units": [], "fleet": {"weekly": []}, "changes": fleet_changes([])}
    as_of = max(_d(k) for v in by.values() for k in v)
    units, scans = [], {}
    for u in sorted(by):
        raw_days = by[u]
        tau = tau_of(raw_days)
        suspects = suspect_days_of(raw_days, tau)
        bad = {x["date"] for x in suspects}
        days = {k: v for k, v in raw_days.items() if k not in bad}   # οι ύποπτες ημέρες αγνοούνται (θεωρούνται ότι λείπουν)
        sc = scan_unit(days, as_of, tau)
        if not sc:
            continue
        scans[u] = sc
        age = (as_of - sc["first"]).days + 1
        streak = idle_streak(days, as_of, tau)
        idle = streak["days"] if streak else 0
        isp_zero, isp_all = isp_zero_context(isp, u, streak, as_of)
        units.append({
            "unit": u, "site": u.split("_")[0], "first_seen": sc["first"].isoformat(), "age_days": age,
            "commissioning_end": sc["cutoff"].isoformat(), "commissioning_day": min(age, COMMISSIONING_DAYS),
            "power_mw": round(sc["power"]) if sc["power"] else None, "energy_mwh": round(sc["energy"]) if sc["energy"] else None,
            "duration_h": round(sc["duration"], 2) if sc["duration"] else None, "class_h": sc["class_h"],
            "provisional": sc["status"] != "stable", "power_since": sc["power_since"], "energy_since": sc["energy_since"],
            "valid_cycles": sc["n_post_cycles"], "status": sc["status"], "idle_days": idle, "idle_from": streak["from"] if streak else None,
            "last_active": streak["last_active"] if streak else None, "idle_isp_zero": isp_zero, "idle_isp_all": isp_all, "pending": sc["pending"],
            "tau_mwh": round(tau, 1), "suspect_days": suspects, "suspect_30": sum(1 for x in suspects if (as_of - _d(x["date"])).days < 30),
            "changes": sc["changes"], "series": sc["series"]})
    # στόλος: εβδομαδιαία άθροιση των μεγίστων που φάνηκαν ως τότε (κάθε μονάδα, από την πρώτη της δραστηριότητα· περιλαμβάνει και το commissioning)
    fleet, w = [], week_start(min(sc["first"] for sc in scans.values()))
    while w <= as_of:
        end = min(w + timedelta(days=6), as_of)
        mw = mwh = n = 0
        for u, sc in scans.items():
            i = (end - sc["first"]).days
            if i < 0:
                continue
            p, e = sc["all_p"][min(i, len(sc["all_p"]) - 1)], sc["all_e"][min(i, len(sc["all_e"]) - 1)]
            if p and e:
                mw += p; mwh += e; n += 1
        if n:
            fleet.append({"w": w.isoformat(), "mw": round(mw), "mwh": round(mwh), "h": round(mwh / mw, 2), "units": n})
        w += timedelta(days=7)
    mark_shared(units)
    return {
        "generated": stamp, "as_of": as_of.isoformat(), "data_from": min(_d(k) for v in by.values() for k in v).isoformat(),
        "params": {"tau_mwh": TAU, "commissioning_days": COMMISSIONING_DAYS, "baseline_days": BASELINE_DAYS, "baseline_cycles": BASELINE_CYCLES,
                   "assured_n": ASSURED_N, "rte_valid": [RTE_MIN, RTE_MAX], "upgrade_pct": UPGRADE * 100, "class_tolerance_h": CLASS_TOL},
        "units": units, "fleet": {"weekly": fleet}, "changes": fleet_changes(units),
    }


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
    print(f"capacity.json: {len(res['units'])} μονάδες, as_of {res['as_of']}, {len(res['fleet']['weekly'])} εβδομάδες στόλου, {res['changes']['total']} αναβαθμίσεις")
