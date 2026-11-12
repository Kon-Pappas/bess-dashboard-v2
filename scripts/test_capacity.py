#!/usr/bin/env python3
"""Αυτοέλεγχος του capacity.py με συνθετικές μονάδες όπου η σωστή απάντηση είναι γνωστή.
Τρέξε:  python3 scripts/test_capacity.py   (από τη ρίζα του repo)"""
import json
import sys
import tempfile
from datetime import date, timedelta
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
import capacity as C


def day_row(unit, d, hours):
    row = {C.DAY: d, C.UNIT: unit}
    for i, x in enumerate(hours, 1):
        row[f"{i:02d}:00"] = float(x)
    return row


def cycle_day(power=50.0, hours_charge=4, hours_dis=4, eff=0.88, start_ch=10, start_dis=18, n=24):
    """μία ημέρα με έναν κύκλο: φόρτιση hours_charge ώρες, εκφόρτιση hours_dis ώρες· ιδιοκατανάλωση -1 τις υπόλοιπες"""
    h = [-1.0] * n
    for i in range(hours_charge): h[start_ch + i] = -power
    e = power * hours_charge * eff
    for i in range(hours_dis): h[start_dis + i] = e / hours_dis
    return h



def wobble(h):
    """μικρή φυσική διακύμανση ±0,5 MWh ώρα παρά ώρα (στην πράξη οι τιμές δεν είναι ποτέ ακριβώς ίδιες για 6+ ώρες· το άθροισμα μένει ίδιο)"""
    out, k = [], 0
    for x in h:
        if abs(x) >= 2.5:
            out.append(x + (0.5 if k % 2 == 0 else -0.5)); k += 1
        else:
            out.append(x)
    return out

def hist(unit_days):
    return {"bessHourly": [day_row(u, d, h) for u, days in unit_days.items() for d, h in days.items()]}


def run(unit_days):
    return {u["unit"]: u for u in C.build(hist(unit_days))["units"]}


D0 = date(2026, 9, 1)
ds = lambda i: (D0 + timedelta(days=i)).isoformat()
ok = 0


def check(name, cond, info=""):
    global ok
    print(("✔" if cond else "✘"), name, info)
    if not cond:
        raise SystemExit(1)
    ok += 1


def steady(n, power=50, hc=4):
    return {ds(i): cycle_day(power, hc, hc) for i in range(n)}


# ---- 1. σταθερή μονάδα: 50 MW × 4 ώρες φόρτιση, απόδοση 0,88 → 176 MWh, 3,52 ώρες → 3ωρη
u = run({"A_01SB": steady(100)})["A_01SB"]
check("σταθερή μονάδα: ισχύς 50, ενέργεια 176", u["power_mw"] == 50 and u["energy_mwh"] == 176, (u["power_mw"], u["energy_mwh"]))
check("σταθερή μονάδα: διάρκεια 3,52 → κατηγορία 3, κατάσταση stable, καμία αναβάθμιση", u["duration_h"] == 3.52 and u["class_h"] == 3 and u["status"] == "stable" and u["changes"] == [], (u["duration_h"], u["class_h"], u["status"], u["changes"]))
check("σταθερή μονάδα: έχει ημερομηνία από πότε ισχύει το μέγιστο", u["power_since"] is not None and u["energy_since"] is not None, (u["power_since"], u["energy_since"]))

# ---- 2. κανόνας κατηγορίας (εξασφαλισμένη εκφόρτιση, ακέραιο μέρος με ανοχή 0,1)
for dur, cls in ((2.4, 2), (3.1, 3), (4.0, 4), (2.6, 2), (1.95, 2), (1.5, None)):
    check(f"κατηγορία {dur} → {cls}", C.class_of(dur) == cls)

# ---- 3. commissioning: οι πρώτες 40 ημέρες δεν μετράνε· τα νούμερα φαίνονται, χωρίς κατηγορία
u = run({"B_01SB": steady(30)})["B_01SB"]
check("commissioning (30 ημέρες): κατάσταση commissioning, χωρίς κατηγορία, προσωρινά νούμερα", u["status"] == "commissioning" and u["class_h"] is None and u["provisional"] and u["power_mw"] == 50, (u["status"], u["class_h"]))
check("commissioning: δεν έχει ημερομηνία «από», η ημέρα είναι 30 από 40", u["power_since"] is None and u["commissioning_day"] == 30, (u["power_since"], u["commissioning_day"]))
# μετά τις 40 ημέρες αλλά χωρίς βάση 14 ημερών: «λίγα δεδομένα» με προσωρινή κατηγορία
u = run({"C_01SB": steady(45)})["C_01SB"]
check("45 ημέρες: few_data (δεν υπάρχει ακόμα βάση 14 ημερών), προσωρινή κατηγορία", u["status"] == "few_data" and u["provisional"] and u["class_h"] == 3, (u["status"], u["class_h"]))

# ---- 4. η εξαίρεση: μια δοκιμή (κύκλοι 6 ωρών, 264 MWh) στις ημέρες 5–20 δεν γίνεται μέγιστο
days = steady(120)
for i in range(5, 21):
    days[ds(i)] = cycle_day(50, 6, 6, start_ch=2, start_dis=12)
u = run({"D_01SB": days})["D_01SB"]
check("δοκιμή μέσα στο commissioning: το μέγιστο μένει 176 και δεν υπάρχει αναβάθμιση", u["energy_mwh"] == 176 and u["changes"] == [], (u["energy_mwh"], u["changes"]))
# ανέβασμα ισχύος και χωρητικότητας μέσα στο commissioning (25 → 50 MW) δεν είναι αναβάθμιση
days = {ds(i): cycle_day(25 + 25 * i / 39, 4, 4) for i in range(40)}
days.update(steady(120) | {k: v for k, v in days.items()})
days = {ds(i): (cycle_day(25 + 25 * i / 39, 4, 4) if i < 40 else cycle_day(50, 4, 4)) for i in range(120)}
u = run({"E_01SB": days})["E_01SB"]
check("ramp μέσα στο commissioning: τελικό μέγιστο 50 / 176, καμία αναβάθμιση", u["power_mw"] == 50 and u["energy_mwh"] == 176 and u["changes"] == [], (u["power_mw"], u["energy_mwh"], u["changes"]))

# ---- 5. κάθε μονάδα έχει τη δική της εξαίρεση: μονάδα που αρχίζει την ημέρα 60 είναι σε commissioning μέχρι την ημέρα 100
days = {ds(i): cycle_day(50, 4, 4) for i in range(60, 90)}
u = run({"F_01SB": days, "F_02SB": steady(90)})["F_01SB"]
check("μονάδα που ξεκίνησε αργότερα: commissioning, ημέρα 30 από 40", u["status"] == "commissioning" and u["commissioning_day"] == 30, (u["status"], u["commissioning_day"]))

# ---- 6. διπλός κύκλος μέσα στη μέρα, κύκλος πάνω από τα μεσάνυχτα, ημέρες 23 και 25 ωρών, κενή ημέρα
def double(power=50.0):
    h = [-1.0] * 24
    for i in range(3): h[1 + i] = -power
    for i in range(4): h[6 + i] = 3 * power * 0.88 / 4
    for i in range(3): h[13 + i] = -power
    for i in range(4): h[18 + i] = 3 * power * 0.88 / 4
    return h
u = run({"G_01SB": {ds(i): double() for i in range(100)}})["G_01SB"]
check("διπλός κύκλος: μέγιστη ενέργεια κύκλου 132 (όχι 264)", u["energy_mwh"] == 132, u["energy_mwh"])
days = {}
for i in range(100):
    h = [-1.0] * 24
    for j in range(4): h[10 + j] = -50
    for j in range(2): h[22 + j] = 44
    if i > 0: h[0:2] = [44, 44]
    days[ds(i)] = h
u = run({"H_01SB": days})["H_01SB"]
check("κύκλος πάνω από τα μεσάνυχτα: 176 (88+88)", u["energy_mwh"] == 176, u["energy_mwh"])
days = steady(100); days[ds(60)] = cycle_day(50, 4, 4, n=25); days[ds(61)] = cycle_day(50, 4, 4, n=23, start_dis=17)
u = run({"I_01SB": days})["I_01SB"]
check("ημέρες 25 και 23 ωρών: 176 και καμία αναβάθμιση", u["energy_mwh"] == 176 and u["changes"] == [], (u["energy_mwh"], u["changes"]))
days = steady(100); del days[ds(70)]
u = run({"J_01SB": days})["J_01SB"]
check("κενή ημέρα στο ιστορικό: 176, stable", u["energy_mwh"] == 176 and u["status"] == "stable", (u["energy_mwh"], u["status"]))

# ---- 7. κύκλος με RTE > 100% (λάθος SCADA) δεν μετράει
days = steady(100)
for i in range(6): days[ds(80)][18 + i] = 150.0     # 900 MWh εκφόρτιση έναντι 200 φόρτιση
u = run({"K_01SB": days})["K_01SB"]
check("ημέρα με RTE ≫ 100%: το μέγιστο παραμένει 176", u["energy_mwh"] == 176, u["energy_mwh"])

# ---- 8. η αρχή των τριών ημερών: δύο ημέρες μεγαλύτερου κύκλου δεν αλλάζουν το μέγιστο· τρεις ημέρες το αλλάζουν και δίνουν αναβάθμιση
base = lambda: steady(100)
days = base()
for i in (70, 71): days[ds(i)] = wobble(cycle_day(50, 8, 8, start_ch=1, start_dis=12))
u = run({"L_01SB": days})["L_01SB"]
check("δύο ημέρες μεγαλύτερου κύκλου: το μέγιστο μένει 176, ούτε αναβάθμιση", u["energy_mwh"] == 176 and not [c for c in u["changes"] if c["confirmed"]], (u["energy_mwh"], u["changes"]))
days = base()
for i in (60, 61, 62): days[ds(i)] = wobble(cycle_day(50, 8, 8, start_ch=1, start_dis=12))
u = run({"M_01SB": days})["M_01SB"]
check("τρεις ημέρες μεγαλύτερου κύκλου: μέγιστο 352 και μία επιβεβαιωμένη αναβάθμιση", u["energy_mwh"] == 352 and len([c for c in u["changes"] if c["confirmed"]]) == 1, (u["energy_mwh"], u["changes"]))

# ---- 9. ΔΕΝ ΜΕΙΩΝΕΤΑΙ: χαμηλότερη ισχύς και φόρτιση με λιγότερη ενέργεια για 30 ημέρες είναι επιλογή χρήσης
days = steady(100)
for i in range(60, 100): days[ds(i)] = cycle_day(25, 4, 4)
u = run({"N_01SB": days})["N_01SB"]
check("χαμηλότερη χρήση 40 ημέρες: το μέγιστο ισχύος και ενέργειας ΔΕΝ μειώνεται, καμία αλλαγή", u["power_mw"] == 50 and u["energy_mwh"] == 176 and u["changes"] == [], (u["power_mw"], u["energy_mwh"], u["changes"]))
days = steady(100)
for i in range(60, 100):
    h = [-1.0] * 24
    for j in range(5): h[10 + j] = -88.0 / 5
    for j in range(5): h[18 + j] = 77.44 / 5
    days[ds(i)] = h
u = run({"O_01SB": days})["O_01SB"]
check("πιο αργοί κύκλοι (λιγότερη ισχύς, ίδια ενέργεια): το μέγιστο ισχύος μένει 50", u["power_mw"] == 50 and u["changes"] == [], (u["power_mw"], u["changes"]))

# ---- 10. αναβάθμιση 2ωρης σε 3ωρη (50 MW: 132 → 176 MWh, 2,64 → 3,52 ώρες) την ημέρα 70
days = {ds(i): cycle_day(50, 3, 3) for i in range(70)}
days.update({ds(i): cycle_day(50, 4, 4) for i in range(70, 100)})
u = run({"P_01SB": days})["P_01SB"]
conf = [c for c in u["changes"] if c["confirmed"]]
check("αναβάθμιση 2ωρη → 3ωρη: ένα επιβεβαιωμένο γεγονός, ενέργεια 132 → 176, ισχύς αμετάβλητη, κατηγορία 2 → 3", len(conf) == 1 and conf[0]["energy"]["from"] == 132 and conf[0]["energy"]["to"] == 176 and conf[0]["power"] is None and (conf[0]["class_from"], conf[0]["class_to"]) == (2, 3), conf)
check("αναβάθμιση: το γεγονός έχει ημερομηνία ανίχνευσης και εκτιμώμενη αρχή (±3 ημέρες)", ds(72) <= conf[0]["date"] <= ds(80) and ds(67) <= conf[0]["since"] <= ds(73), (conf[0]["date"], conf[0]["since"]))
check("αναβάθμιση: το νέο μέγιστο 176 και η κατηγορία 3 στην καρτέλα", u["energy_mwh"] == 176 and u["class_h"] == 3, (u["energy_mwh"], u["class_h"]))

# ---- 11. «προς επιβεβαίωση»: 1 ή 2 ημέρες μεγαλύτερου κύκλου στο τέλος
for n in (1, 2):
    days = {ds(i): cycle_day(50, 3, 3) for i in range(100 - n)}
    days.update({ds(i): cycle_day(50, 4, 4) for i in range(100 - n, 100)})
    u = run({f"Q{n}_01SB": days})[f"Q{n}_01SB"]
    pend = u["pending"]["energy"]
    check(f"{n} ημέρα(ες) μεγαλύτερου κύκλου: προς επιβεβαίωση ({n} από 3), το μέγιστο δεν αλλάζει", pend and pend["days"] == n and u["energy_mwh"] == 132 and any(not c["confirmed"] for c in u["changes"]), (pend, u["energy_mwh"]))

# ---- 12. λάθος SCADA 1–2 ημερών στην ισχύ (εκφόρτιση ×2,2): μόνο «προς επιβεβαίωση», το μέγιστο δεν αλλάζει· 3+ ημέρες: αναβάθμιση
for n in (1, 2):
    days = steady(100)
    for i in range(100 - n, 100): days[ds(i)] = [x * 2.2 if x > 0 else x for x in days[ds(i)]]
    u = run({f"R{n}_01SB": days})[f"R{n}_01SB"]
    check(f"λάθος ισχύος {n} ημέρας: το μέγιστο παραμένει 50 και μόνο προς επιβεβαίωση", u["power_mw"] == 50 and not [c for c in u["changes"] if c["confirmed"]], (u["power_mw"], u["changes"]))
days = steady(100)
for i in range(94, 100): days[ds(i)] = [x * 2.2 if x > 0 else x for x in days[ds(i)]]
u = run({"S_01SB": days})["S_01SB"]
check("το ίδιο λάθος 6 ημερών: γίνεται μέγιστο (δεν ξεχωρίζει από αναβάθμιση)", u["power_mw"] > 50, u["power_mw"])

# ---- 13. κοινή αναβάθμιση σε 3 μονάδες την ίδια ημέρα: shared· σε μία μόνη: όχι
def upgraded(at):
    d = {ds(i): cycle_day(50, 3, 3) for i in range(at)}
    d.update({ds(i): cycle_day(50, 4, 4) for i in range(at, 110)})
    return d
res = run({"W_01SB": upgraded(70), "W_02SB": upgraded(70), "W_03SB": upgraded(71), "W_04SB": {ds(i): cycle_day(50, 3, 3) for i in range(110)}})
check("κοινή αναβάθμιση σε 3 μονάδες: shared", all(res[u]["changes"][0]["shared"] for u in ("W_01SB", "W_02SB", "W_03SB")), [(u, [c.get("shared") for c in res[u]["changes"]]) for u in res])
res = run({"X_01SB": upgraded(70), "X_02SB": {ds(i): cycle_day(50, 3, 3) for i in range(110)}})
check("αναβάθμιση σε μία μονάδα: όχι shared", res["X_01SB"]["changes"][0]["shared"] is False, res["X_01SB"]["changes"])

# ---- 14. ύποπτες ημέρες (ιστορικό 200 ημερών)
days = {ds(i): cycle_day(50, 4, 4) for i in range(200)}
days[ds(190)] = [x * 2.0 if x > 0 else x for x in days[ds(190)]]
days[ds(192)] = [x * 3.0 if x > 0 else x for x in days[ds(192)]]
res = run({"V_01SB": days})["V_01SB"]
dates = {x["date"] for x in res["suspect_days"]}
check("ύποπτες ημέρες: εντοπίζονται οι δύο λανθασμένες ημέρες, όχι οι υπόλοιπες", dates == {ds(190), ds(192)}, sorted(dates))


# ---- 18. κολλημένη μέτρηση: ≥ 6 συνεχόμενες ώρες με την ίδια τιμή (και μέσα από τα μεσάνυχτα), ≥ 20% της μέγιστης ισχύος της μονάδας
days = steady(120)
for i in (80, 81, 82): days[ds(i)] = [100.0] * 24      # 72 ώρες στα +100 MWh (διπλάσιο της ισχύος της μονάδας)
u = run({"FZ_01SB": days})["FZ_01SB"]
fr = [x for x in u["suspect_days"] if x["reason"] == "frozen"]
check("κολλημένη μέτρηση 72 ωρών: 3 ύποπτες ημέρες (frozen) με 72 ώρες", {x["date"] for x in fr} == {ds(80), ds(81), ds(82)} and fr[0]["hours"] == 72 and fr[0]["value"] == 100.0, fr)
check("οι ύποπτες ημέρες ΑΓΝΟΟΥΝΤΑΙ: τα μέγιστα μένουν 50 / 176 και δεν υπάρχει αναβάθμιση (αλλιώς 3 ημέρες στα 100 MW θα ήταν «αναβάθμιση»)", u["power_mw"] == 50 and u["energy_mwh"] == 176 and u["changes"] == [], (u["power_mw"], u["energy_mwh"], u["changes"]))
days = steady(120); days[ds(60)] = [-50.0] * 5 + [-1.0] * 19
u = run({"FZ_02SB": days})["FZ_02SB"]
check("5 ώρες με την ίδια τιμή δεν είναι κόλλημα (κανονική φόρτιση)", not [x for x in u["suspect_days"] if x["reason"] == "frozen"], u["suspect_days"])
days = steady(120)
for i in range(70, 73): days[ds(i)] = [-50.0] * 12 + [0.0] * 12      # 12 ώρες/ημέρα με την ίδια τιμή, χωρίς να συνεχίζονται: μένουν 12 ώρες κολλημένες την ημέρα
u = run({"FZ_03SB": days})["FZ_03SB"]
check("12 ώρες με την ίδια τιμή μέσα σε μία ημέρα: ύποπτη ημέρα", {x["date"] for x in u["suspect_days"] if x["reason"] == "frozen"} == {ds(70), ds(71), ds(72)}, u["suspect_days"])
# ημέρα-σύνορο: μόνο 3 ώρες της κολλημένης περιόδου στην προηγούμενη ημέρα
days = steady(120)
days[ds(50)][-3:] = [100.0, 100.0, 100.0]
for i in (51, 52): days[ds(i)] = [100.0] * 24
days[ds(53)][:2] = [100.0, 100.0]
u = run({"FZ_04SB": days})["FZ_04SB"]
check("ημέρες-σύνορο της κολλημένης περιόδου (3 και 2 ώρες) δεν αγνοούνται ολόκληρες", {x["date"] for x in u["suspect_days"] if x["reason"] == "frozen"} == {ds(51), ds(52)}, u["suspect_days"])

# ---- 19. όριο αδράνειας ανά μονάδα: μεγάλη μονάδα (300 MW) με ιδιοκατανάλωση −3 MWh/ώρα δεν μετράει ως φόρτιση ούτε ως κόλλημα
def big_day():
    h = [-3.0] * 24
    for i in range(10, 14): h[i] = -300.0
    for i in range(18, 22): h[i] = 264.0
    return h
u = run({"BG_01SB": {ds(i): big_day() for i in range(120)}})["BG_01SB"]
check("μονάδα 300 MW: όριο αδράνειας 4,5 MWh (1,5% της ισχύος), η ιδιοκατανάλωση −3 δεν είναι δραστηριότητα ούτε κόλλημα", u["tau_mwh"] == 4.5 and u["suspect_days"] == [], (u["tau_mwh"], u["suspect_days"]))
check("μονάδα 300 MW: μέγιστα 300 MW και 1056 MWh, κατηγορία 3", u["power_mw"] == 300 and u["energy_mwh"] == 1056 and u["class_h"] == 3, (u["power_mw"], u["energy_mwh"], u["class_h"]))
u = run({"SM_01SB": steady(120)})["SM_01SB"]
check("μονάδα 50 MW: το όριο αδράνειας μένει 2,5", u["tau_mwh"] == 2.5, u["tau_mwh"])

# ---- 15. χωρίς δραστηριότητα: ουδέτερη πληροφορία, όχι μείωση, όχι γεγονός
days = steady(100); days.update({ds(i): [0.0] * 24 for i in range(100, 109)})
u = run({"Y_01SB": days})["Y_01SB"]
check("9 ημέρες χωρίς δραστηριότητα: idle_days 9, μέγιστα αμετάβλητα, κατάσταση stable, κανένα γεγονός", u["idle_days"] == 9 and u["power_mw"] == 50 and u["energy_mwh"] == 176 and u["status"] == "stable" and u["changes"] == [], (u["idle_days"], u["status"], u["changes"]))
days = steady(100); days.update({ds(i): [0.0] * 24 for i in range(100, 105)})
u = run({"Z_01SB": days})["Z_01SB"]
check("5 ημέρες χωρίς δραστηριότητα: δεν αναφέρεται", u["idle_days"] == 0, u["idle_days"])


# ---- 20. ακινησία: ακριβής περίοδος, τελευταία δραστηριότητα, και το πλαίσιο «το ISP προγραμμάτισε 0 MWh» (μόνο όταν το ISP είναι 0 όλη την ημέρα)
def isp_rows(unit_name, plan):
    """plan: {ημερομηνία: (φόρτιση, εκφόρτιση)} για μονάδα με όνομα X_01SB → X_BZ1_01_SB"""
    a, b = unit_name.split("_", 1)
    nm = f"{a}_BZ1_{b[:2]}_{b[2:]}"
    return [{C.DAY: d, C.UNIT: nm, "Φόρτιση (MWh)": c, "Αποφόρτιση (MWh)": e} for d, (c, e) in plan.items()]

def idle_unit(n_idle, plan_for):
    days = steady(100); days.update({ds(i): [0.0] * 24 for i in range(100, 100 + n_idle)})
    h = hist({"ID_01SB": days}); h["isp"] = isp_rows("ID_01SB", {ds(i): plan_for(i) for i in range(100 + n_idle)})
    return {u["unit"]: u for u in C.build(h)["units"]}["ID_01SB"]

u = idle_unit(9, lambda i: (0.0, 0.0) if i >= 100 else (200.0, 176.0))
check("ακινησία 9 ημερών: από την 1η ημέρα, τελευταία δραστηριότητα την προηγούμενη", u["idle_days"] == 9 and u["idle_from"] == ds(100) and u["last_active"] == ds(99), (u["idle_days"], u["idle_from"], u["last_active"]))
check("ISP 0 όλες τις ημέρες ακινησίας: idle_isp_all και 9 ημέρες", u["idle_isp_zero"] == 9 and u["idle_isp_all"] is True, (u["idle_isp_zero"], u["idle_isp_all"]))
u = idle_unit(9, lambda i: (200.0, 176.0))
check("το ISP προγραμμάτιζε κανονικά: ΔΕΝ λέμε τίποτα για το ISP (δεν γράφουμε τι δεν εκτελέστηκε)", u["idle_days"] == 9 and u["idle_isp_zero"] == 0 and u["idle_isp_all"] is False, (u["idle_isp_zero"], u["idle_isp_all"]))
u = idle_unit(9, lambda i: (0.0, 0.0) if i >= 106 else (200.0, 176.0))
check("ISP 0 μόνο τις τελευταίες 3 ημέρες: 3 ημέρες, όχι «όλες»", u["idle_isp_zero"] == 3 and u["idle_isp_all"] is False, (u["idle_isp_zero"], u["idle_isp_all"]))
days = steady(100); days.update({ds(i): [0.0] * 24 for i in range(100, 109)})
u = run({"NI_01SB": days})["NI_01SB"]
check("χωρίς γραμμές ISP: άγνωστο, όχι «0»", u["idle_days"] == 9 and u["idle_isp_zero"] == 0 and u["idle_isp_all"] is False, (u["idle_isp_zero"], u["idle_isp_all"]))
u = idle_unit(6, lambda i: (0.0, 0.0) if i >= 100 else (200.0, 176.0))
check("6 ημέρες δεν είναι ακινησία (όριο 7)", u["idle_days"] == 0 and u["idle_from"] is None and u["idle_isp_all"] is False, (u["idle_days"], u["idle_from"]))
u = idle_unit(7, lambda i: (0.0, 0.0) if i >= 100 else (200.0, 176.0))
check("7 ημέρες είναι ακινησία", u["idle_days"] == 7 and u["idle_isp_all"] is True, (u["idle_days"], u["idle_isp_all"]))
check("όνομα μονάδας ISP", C.isp_name("ENE_01SB") == "ENE_BZ1_01_SB" and C.isp_name("STO_03SP") == "STO_BZ1_03_SP")

# ---- 16. στόλος: το άθροισμα των μεγίστων δεν μειώνεται ποτέ
days = steady(100)
for i in range(80, 100): days[ds(i)] = cycle_day(20, 2, 2)
fl = C.build(hist({"T_01SB": days, "T_02SB": steady(100)}))["fleet"]["weekly"]
check("στόλος: τα εβδομαδιαία μέγιστα είναι αύξοντα", all(b["mwh"] >= a["mwh"] and b["mw"] >= a["mw"] for a, b in zip(fl, fl[1:])), [(w["w"], w["mw"], w["mwh"]) for w in fl][-3:])

# ---- 17. εγγραφή αρχείου: έγκυρο JSON, ατομική αντικατάσταση, δεν σπάει χωρίς SCADA
with tempfile.TemporaryDirectory() as td:
    hp, op = Path(td) / "historical.json", Path(td) / "capacity.json"
    hp.write_text(json.dumps(hist({"J_01SB": steady(100)})), encoding="utf-8")
    res = C.write(hp, op)
    back = json.loads(op.read_text(encoding="utf-8"))
    check("εγγραφή: το αρχείο διαβάζεται και ταιριάζει", back["units"][0]["unit"] == "J_01SB" and back["as_of"] == res["as_of"] and back["data_from"] == ds(0))
    check("εγγραφή: δεν μένει προσωρινό αρχείο", not (Path(td) / "capacity.tmp").exists())
    hp.write_text(json.dumps({"bessHourly": []}), encoding="utf-8")
    res = C.write(hp, op)
    check("χωρίς SCADA: κενή εκτίμηση, όχι σφάλμα", res["units"] == [] and res["as_of"] is None)

print(f"\nΟΚ: {ok} έλεγχοι")
