#!/usr/bin/env python3
"""Αυτοέλεγχος του capacity.py με συνθετικές μονάδες όπου η σωστή απάντηση είναι γνωστή.
Τρέξε:  python3 scripts/test_capacity.py   (από τη ρίζα του repo)"""
import sys
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

def hist(unit_days):
    rows = []
    for unit, days in unit_days.items():
        for d, hrs in days.items():
            rows.append(day_row(unit, d, hrs))
    return {"bessHourly": rows}

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

# 1. σταθερή μονάδα, 1 κύκλος/ημέρα, 50 MW × 4 ώρες φόρτιση, απόδοση 0,88: εκφόρτιση 176 MWh → 3,52 ώρες → 3ωρη
u = run({"A_01SB": {ds(i): cycle_day(50, 4, 4) for i in range(40)}})["A_01SB"]
check("σταθερή μονάδα: ισχύς 50 MW", u["power_mw"] == 50, u["power_mw"])
check("σταθερή μονάδα: ενέργεια 176 MWh", u["energy_mwh"] == 176, u["energy_mwh"])
check("σταθερή μονάδα: διάρκεια 3,52 h → κατηγορία 3 (ακέραιο μέρος)", u["duration_h"] == 3.52 and u["class_h"] == 3, (u["duration_h"], u["class_h"]))
check("σταθερή μονάδα: κατάσταση stable", u["status"] == "stable", u["status"])

# 2. διπλός κύκλος μέσα στη μέρα: οι ημερήσιες τιμές θα έδιναν 2× — η εκτίμηση πρέπει να μένει 176
def double(power=50.0):
    h = [-1.0] * 24
    for i in range(3): h[1 + i] = -power
    for i in range(4): h[6 + i] = 3 * power * 0.88 / 4
    for i in range(3): h[13 + i] = -power
    for i in range(4): h[18 + i] = 3 * power * 0.88 / 4
    return h
u = run({"B_01SB": {ds(i): double() for i in range(40)}})["B_01SB"]
check("διπλός κύκλος: ενέργεια ανά κύκλο 132 (όχι 264)", u["energy_mwh"] == 132, u["energy_mwh"])

# 3. κύκλος που περνά τα μεσάνυχτα: εκφόρτιση 22:00–02:00
def night():
    h = [-1.0] * 24
    for i in range(4): h[10 + i] = -50
    for i in range(2): h[22 + i] = 44      # 22–24
    return h, [44, 44] + [-1.0] * 22         # επόμενη μέρα 00–02 συνεχίζει
days = {}
for i in range(40):
    a, b = night(); days[ds(i)] = [x for x in a]
    days[ds(i)][0:2] = [44, 44] if i > 0 else [-1, -1]
u = run({"C_01SB": days})["C_01SB"]
check("κύκλος πάνω από τα μεσάνυχτα: ενέργεια 176 (88+88)", u["energy_mwh"] == 176, u["energy_mwh"])

# 4. ανώμαλη ημέρα (RTE 207%): μία ημέρα με τεράστια εκφόρτιση δεν αλλάζει την εξασφαλισμένη τιμή
days = {ds(i): cycle_day(50, 4, 4) for i in range(40)}
days[ds(35)] = cycle_day(50, 4, 4)[:]
for i in range(6): days[ds(35)][18 + i] = 150.0    # 900 MWh εκφόρτιση έναντι 200 φόρτιση
u = run({"D_01SB": days})["D_01SB"]
check("ανώμαλη ημέρα: ενέργεια παραμένει 176", u["energy_mwh"] == 176, u["energy_mwh"])

# 5. «τουλάχιστον 3 φορές»: δύο μόνο υψηλοί κύκλοι δεν αρκούν
days = {ds(i): cycle_day(50, 4, 4) for i in range(40)}
for i in (30, 31):
    days[ds(i)] = cycle_day(50, 8, 8, start_ch=1, start_dis=12)      # 8h × 50 = 400 charge → 352 discharge
u = run({"E_01SB": days})["E_01SB"]
check("δύο μόνο φορές μεγαλύτερος κύκλος: αγνοείται (176)", u["energy_mwh"] == 176, u["energy_mwh"])
for i in (30, 31, 32):
    days[ds(i)] = cycle_day(50, 8, 8, start_ch=1, start_dis=12)
u = run({"E_01SB": days})["E_01SB"]
check("τρεις φορές: μετράει (352)", u["energy_mwh"] == 352, u["energy_mwh"])

# 6. κανόνας κατηγορίας (εξασφαλισμένη εκφόρτιση): ακέραιο μέρος με ανοχή 0,1
check("κατηγορία 2,4 → 2", C.class_of(2.4) == 2)
check("κατηγορία 3,1 → 3", C.class_of(3.1) == 3)
check("κατηγορία 4,0 → 4", C.class_of(4.0) == 4)
check("κατηγορία 2,6 → 2 (δεν στρογγυλοποιείται προς τα πάνω)", C.class_of(2.6) == 2)
check("κατηγορία 1,95 → 2 (ανοχή)", C.class_of(1.95) == 2)
check("κατηγορία 1,5 → καμία (ούτε 2ωρη)", C.class_of(1.5) is None)

# 7. νέα μονάδα: 10 ημέρες δεδομένων → «λίγα δεδομένα», χωρίς κατηγορία βέβαιη
u = run({"F_01SB": {ds(i): cycle_day(50, 4, 4) for i in range(10)}})["F_01SB"]
check("νέα μονάδα: few_data", u["status"] == "few_data", u["status"])

# 8. ανέβασμα ισχύος (commissioning): η ισχύς διπλασιάζεται μέσα στο τελευταίο 30ήμερο → «σε αλλαγή»
days = {ds(i): cycle_day(25, 4, 4) for i in range(0, 45)}
days.update({ds(i): cycle_day(50, 4, 4) for i in range(45, 75)})
u = run({"G_01SB": days})["G_01SB"]
check("ανέβασμα ισχύος: changing", u["status"] == "changing", (u["status"], u["trend_power_pct"]))

# 9. μέρα 25 ωρών (πίνακας με 25 τιμές) και μέρα 23 ωρών δεν σπάνε τον υπολογισμό
days = {ds(i): cycle_day(50, 4, 4) for i in range(40)}
days[ds(20)] = cycle_day(50, 4, 4, n=25)
days[ds(21)] = cycle_day(50, 4, 4, n=23, start_dis=17)
u = run({"H_01SB": days})["H_01SB"]
check("μέρες 25 και 23 ωρών: ενέργεια 176", u["energy_mwh"] == 176, u["energy_mwh"])

# 10. κενή ημέρα στο ιστορικό σπάει τη σειρά: ούτε κύκλος ούτε εκτίμηση ξεπερνά το κενό
days = {ds(i): cycle_day(50, 4, 4) for i in range(40) if i != 20}
u = run({"I_01SB": days})["I_01SB"]
check("κενή ημέρα: η εκτίμηση παραμένει σταθερή", u["energy_mwh"] == 176 and u["status"] == "stable", (u["energy_mwh"], u["status"]))

# 11. εγγραφή αρχείου: έγκυρο JSON (χωρίς NaN), ατομική αντικατάσταση, και δεν σπάει όταν λείπει το SCADA
import json, tempfile
with tempfile.TemporaryDirectory() as td:
    hp, op = Path(td) / "historical.json", Path(td) / "capacity.json"
    hp.write_text(json.dumps(hist({"J_01SB": {ds(i): cycle_day(50, 4, 4) for i in range(40)}})), encoding="utf-8")
    res = C.write(hp, op)
    back = json.loads(op.read_text(encoding="utf-8"))
    check("εγγραφή: το αρχείο διαβάζεται και ταιριάζει", back["units"][0]["unit"] == "J_01SB" and back["as_of"] == res["as_of"] and back["data_from"] == ds(0))
    check("εγγραφή: δεν μένει προσωρινό αρχείο", not (Path(td) / "capacity.tmp").exists())
    hp.write_text(json.dumps({"bessHourly": []}), encoding="utf-8")
    res = C.write(hp, op)
    check("χωρίς SCADA: κενή εκτίμηση, όχι σφάλμα", res["units"] == [] and res["as_of"] is None)

# ------------------------------------------------------------------ αλλαγές επιπέδου (αναβαθμίσεις, δοκιμές, επεισόδια)
def changes_of(unit_days):
    u = next(iter(run(unit_days).values()))
    return u["changes"], u

# 12. αναβάθμιση 2ωρης σε 3ωρη (50 MW: εκφόρτιση 132 → 176 MWh, διάρκεια 2,64 → 3,52 ώρες) την ημέρα 50
days = {ds(i): cycle_day(50, 3, 3) for i in range(50)}
days.update({ds(i): cycle_day(50, 4, 4) for i in range(50, 85)})
ch, u = changes_of({"K_01SB": days})
check("αναβάθμιση: ένα γεγονός", len(ch) == 1, [c["date"] for c in ch])
e = ch[0]
check("αναβάθμιση: ενέργεια 132 → 176, ισχύς αμετάβλητη", e["energy"]["from"] == 132 and e["energy"]["to"] == 176 and e["power"] is None, (e["energy"], e["power"]))
check("αναβάθμιση: κατηγορία 2 → 3, επιβεβαιωμένη, είδος up", (e["class_from"], e["class_to"], e["confirmed"], e["kind"]) == (2, 3, True, "up"), (e["class_from"], e["class_to"], e["confirmed"], e["kind"]))
check("αναβάθμιση: ανιχνεύεται 3–10 ημέρες μετά την αλλαγή και η αρχή εκτιμάται σωστά (±3 ημέρες)",
      ds(52) <= e["date"] <= ds(60) and ds(47) <= e["since"] <= ds(53), (e["date"], e["since"]))

# 13. διπλασιασμός ισχύος με ίδια διάρκεια (25 → 50 MW, 4 ώρες): η κατηγορία μένει, αλλάζουν ισχύς και ενέργεια
days = {ds(i): cycle_day(25, 4, 4) for i in range(50)}
days.update({ds(i): cycle_day(50, 4, 4) for i in range(50, 85)})
ch, u = changes_of({"L_01SB": days})
e = ch[0]
check("διπλασιασμός: ισχύς +100% και ενέργεια +100%, κατηγορία 3 → 3", e["power"]["pct"] == 100 and e["energy"]["pct"] == 100 and e["class_from"] == e["class_to"] == 3, (e["power"], e["energy"], e["class_from"], e["class_to"]))

# 14. προσωρινή δοκιμή: 14 ημέρες σε μεγαλύτερο κύκλο και επιστροφή → δύο γεγονότα (άνοδος, πτώση)
days = {ds(i): cycle_day(50, 4, 4) for i in range(40)}
days.update({ds(i): cycle_day(50, 6, 6, start_ch=2, start_dis=12) for i in range(40, 54)})
days.update({ds(i): cycle_day(50, 4, 4) for i in range(54, 95)})
ch, u = changes_of({"M_01SB": days})
check("προσωρινή δοκιμή: δύο γεγονότα, άνοδος και μετά πτώση", [c["kind"] for c in ch] == ["up", "down"], [(c["kind"], c["date"]) for c in ch])

# 15. σταθερή μονάδα με φυσική διακύμανση ±5%: κανένα γεγονός
days = {ds(i): cycle_day([48, 50, 52][i % 3], 4, 4) for i in range(120)}
ch, u = changes_of({"N_01SB": days})
check("σταθερή μονάδα με διακύμανση: κανένα γεγονός", ch == [], ch)

# 16. αλλαγή πολύ πρόσφατη (5 ημέρες πριν το τέλος): «προς επιβεβαίωση», όχι επιβεβαιωμένη
days = {ds(i): cycle_day(50, 3, 3) for i in range(64)}
days.update({ds(i): cycle_day(50, 4, 4) for i in range(64, 69)})       # 5 ημέρες στο νέο επίπεδο: η εκτίμηση το περνά την 3η, άρα 3 ημέρες πάνω από το όριο
ch, u = changes_of({"O_01SB": days})
check("πρόσφατη αλλαγή: προς επιβεβαίωση", len(ch) == 1 and ch[0]["confirmed"] is False, [(c["date"], c["confirmed"]) for c in ch])

# 17. επεισόδιο: αλυσίδα βημάτων που καταλήγει στο ίδιο επίπεδο γράφεται ως ένα επεισόδιο με το χαμηλότερο σημείο
raw = [{"date": date(2026, 7, 16), "kind": "power", "confirmed": True, "before": (20.0, 38.0), "after": (17.0, 38.0)},
       {"date": date(2026, 7, 26), "kind": "energy", "confirmed": True, "before": (17.0, 38.0), "after": (17.0, 18.0)},
       {"date": date(2026, 7, 28), "kind": "power", "confirmed": True, "before": (17.0, 18.0), "after": (10.0, 18.0)},
       {"date": date(2026, 8, 5), "kind": "power", "confirmed": True, "before": (10.0, 18.0), "after": (19.0, 18.0)},
       {"date": date(2026, 8, 14), "kind": "energy", "confirmed": True, "before": (19.0, 18.0), "after": (19.0, 34.0)},
       {"date": date(2026, 8, 19), "kind": "energy", "confirmed": True, "before": (19.0, 34.0), "after": (19.0, 42.0)}]
m = C.merge_changes(raw)
check("επεισόδιο: ένα γεγονός, είδος dip, χαμηλότερο σημείο 10 MW / 18 MWh", len(m) == 1 and m[0]["kind"] == "dip" and m[0]["extreme_power"] == 10 and m[0]["extreme_energy"] == 18 and m[0]["date_to"] == "2026-08-19", m)

print(f"\nΟΚ: {ok} έλεγχοι")
