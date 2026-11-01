#!/usr/bin/env python3
"""Έλεγχος ότι το update_data.py αγνοεί τα κενά στις ημερομηνίες START_DATE / END_DATE (χωρίς δίκτυο: όλες οι λήψεις αντικαθίστανται).
Τρέξε:  python3 scripts/test_update_dates.py   (από τη ρίζα του repo)"""
import io
import os
import sys
from contextlib import redirect_stdout
from pathlib import Path
from unittest import mock
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
import update_data as U
import capacity

ok = 0


def check(name, cond, info=""):
    global ok
    print(("✔" if cond else "✘"), name, info)
    if not cond:
        raise SystemExit(1)
    ok += 1


def run_main(start, end):
    """τρέχει το main() με περιβάλλον START/END και επιστρέφει τις ημερομηνίες που επεξεργάστηκε και ό,τι τύπωσε"""
    seen = []
    env = {"START_DATE": start, "END_DATE": end, "DAY_DELAY_SECONDS": "0"}
    with mock.patch.dict(os.environ, env), \
         mock.patch.object(U, "load_existing_data", lambda: {k: [] for k in U.DB_KEYS}), \
         mock.patch.object(U, "fetch_admie_excel", lambda *a, **k: seen.append(a[0]) or None), \
         mock.patch.object(U, "process_isp", lambda *a, **k: None), mock.patch.object(U, "process_scada", lambda *a, **k: None), \
         mock.patch.object(U, "fetch_entsoe", lambda *a, **k: None), mock.patch.object(U, "save_data", lambda *a, **k: None), \
         mock.patch.object(U, "write_meta", lambda *a, **k: None), mock.patch.object(capacity, "write", lambda *a, **k: {"units": []}):
        buf = io.StringIO()
        with redirect_stdout(buf):
            U.main()
    return sorted(set(seen)), buf.getvalue()


days, out = run_main("2026-08-09", "2026-08-10")
check("ημερομηνίες χωρίς κενά: 9 και 10 Αυγούστου", days == ["2026-08-09", "2026-08-10"], days)
days, out = run_main("2026-08-09 ", "2026-08-10")
check("κενό στο τέλος του start_date (το λάθος της 1ης Νοεμβρίου): δουλεύει", days == ["2026-08-09", "2026-08-10"] and "Λάθος μορφή" not in out, (days, out[:80]))
days, out = run_main("  2026-08-09", " 2026-08-10  ")
check("κενά πριν και μετά και στις δύο ημερομηνίες: δουλεύει", days == ["2026-08-09", "2026-08-10"], days)
days, out = run_main("2026-08-0x", "2026-08-10")
check("πραγματικά λάθος ημερομηνία: μήνυμα λάθους και τίποτα δεν λαμβάνεται", days == [] and "Λάθος μορφή" in out, (days, out[:80]))
print(f"\nΟΚ: {ok} έλεγχοι")
