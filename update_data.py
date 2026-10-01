import os
import json
import math
import time
import requests
import pandas as pd
import xml.etree.ElementTree as ET
from datetime import datetime, timedelta, timezone
from io import BytesIO
from zoneinfo import ZoneInfo

# --- ΡΥΘΜΙΣΕΙΣ ---
DATA_FILE = "data/historical.json"
ADMIE_URL = "https://www.admie.gr/getOperationMarketFile"
ENTSOE_TOKEN = os.environ.get("ENTSOE_TOKEN")
HEADERS = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"}
DAYS_TO_FETCH = 5

# Η ημέρα παράδοσης της Αγοράς Επόμενης Ημέρας (EnEx / market coupling) ορίζεται σε ώρα CET/CEST (Βρυξέλλες)
MARKET_TZ = ZoneInfo("Europe/Brussels")
UTC = timezone.utc

DB_KEYS = ["isp", "scada", "surplus", "pump", "bessHourly", "mcpHourly"]


# ---------------------------------------------------------------------------
# Βοηθητικά
# ---------------------------------------------------------------------------
def load_existing_data():
    db = {k: [] for k in DB_KEYS}
    if os.path.exists(DATA_FILE):
        with open(DATA_FILE, "r", encoding="utf-8") as f:
            try:
                db.update(json.load(f))
            except json.JSONDecodeError:
                print("⚠ Το historical.json δεν διαβάστηκε (JSON error) - ξεκινάμε από κενό.")
    for k in DB_KEYS:
        db.setdefault(k, [])
    return db


def save_data(db):
    """Γράφει το JSON με μία εγγραφή ανά γραμμή (μικρότερο αρχείο, καθαρά git diffs).
    Ταξινόμηση μόνο κατά ημερομηνία (stable sort, η σειρά εντός ημέρας διατηρείται).
    allow_nan=False: αν κάποτε μπει NaN στα δεδομένα, αποτυγχάνει αντί να γράψει άκυρο JSON."""
    os.makedirs(os.path.dirname(DATA_FILE), exist_ok=True)
    parts = []
    for key, val in db.items():
        if isinstance(val, list):
            rows = sorted(val, key=lambda r: r.get("Ημερομηνία", "")) if val and isinstance(val[0], dict) else val
            if rows:
                body = ",\n".join("    " + json.dumps(r, ensure_ascii=False, allow_nan=False) for r in rows)
                parts.append(f'  {json.dumps(key)}: [\n{body}\n  ]')
            else:
                parts.append(f'  {json.dumps(key)}: []')
        else:
            parts.append(f'  {json.dumps(key)}: {json.dumps(val, ensure_ascii=False, allow_nan=False)}')
    text = "{\n" + ",\n".join(parts) + "\n}\n"
    tmp = DATA_FILE + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        f.write(text)
    os.replace(tmp, DATA_FILE)


def http_get(url, retries=3, timeout=60):
    """GET με timeout και retry (5xx / 429 / δικτυακά σφάλματα). Δεν τυπώνει ποτέ το URL (περιέχει το token)."""
    last = None
    for attempt in range(retries):
        try:
            res = requests.get(url, headers=HEADERS, timeout=timeout)
            if res.status_code < 500 and res.status_code != 429:
                return res
            last = f"HTTP {res.status_code}"
        except requests.RequestException as e:
            last = type(e).__name__
        time.sleep(3 * (attempt + 1))
    print(f"   ⚠ Αποτυχία αιτήματος μετά από {retries} προσπάθειες ({last})")
    return None


def to_num(v):
    """Μετατροπή κελιού σε float. Κενά/NaN/κείμενο -> None."""
    try:
        f = float(str(v).replace(" ", "").replace(",", "."))
    except (ValueError, TypeError):
        return None
    return None if math.isnan(f) else f


def day_window_utc(date_str):
    """Επιστρέφει (start_utc, end_utc, n_hours) της ημέρας παράδοσης σε CET/CEST.
    Χειρίζεται σωστά τις ημέρες αλλαγής ώρας (23 ή 25 ώρες)."""
    d = datetime.strptime(date_str, "%Y-%m-%d")
    nxt = d + timedelta(days=1)
    start = datetime(d.year, d.month, d.day, tzinfo=MARKET_TZ).astimezone(UTC).replace(tzinfo=None)
    end = datetime(nxt.year, nxt.month, nxt.day, tzinfo=MARKET_TZ).astimezone(UTC).replace(tzinfo=None)
    n_hours = int(round((end - start).total_seconds() / 3600))
    return start, end, n_hours


# ---------------------------------------------------------------------------
# ADMIE
# ---------------------------------------------------------------------------
def fetch_admie_excel(date_str, category):
    url = f"{ADMIE_URL}?dateStart={date_str}&dateEnd={date_str}&FileCategory={category}"
    res = http_get(url)
    if res is None or not res.ok:
        return None
    try:
        data = res.json()
        if not data:
            return None
        if len(data) > 1:
            # Πολλαπλές εκδόσεις αρχείου: παίρνουμε αυτή με το "μεγαλύτερο" όνομα (π.χ. _02 > _01)
            data = sorted(data, key=lambda x: x.get("file_path", ""))
            print(f"   ℹ {category}: {len(data)} αρχεία, επιλέχθηκε το {data[-1].get('file_path', '')}")
        file_path = data[-1].get("file_path", "")
        file_url = f"https://www.admie.gr{file_path}" if file_path.startswith("/") else file_path

        excel_res = http_get(file_url, timeout=120)
        if excel_res is None or not excel_res.ok:
            return None
        return pd.read_excel(BytesIO(excel_res.content), header=None, sheet_name=0)
    except Exception as e:
        print(f"   ⚠ {category}: αποτυχία ανάγνωσης αρχείου ({type(e).__name__})")
        return None


def _unit_name_in_row(row_list):
    """Επιστρέφει (όνομα μονάδας, index στήλης) αν η γραμμή είναι μονάδα BESS ή TOTAL BESS."""
    for c in range(min(len(row_list), 4)):
        val = str(row_list[c]).strip().upper()
        if val.endswith("SB") or val.endswith("SP") or val == "TOTAL BESS":
            return str(row_list[c]).strip(), c
    return "", -1


def _bess_row(date_str, unit, charge, discharge):
    charge, discharge = round(charge, 3), round(discharge, 3)
    rte = (discharge / charge * 100) if charge > 0 else 0
    return {
        "Ημερομηνία": date_str,
        "Μονάδα BESS": unit,
        "Φόρτιση (MWh)": charge,
        "Αποφόρτιση (MWh)": discharge,
        "RTE (%)": f"{rte:.2f}%",
    }


def _find_header_cols(df, marker):
    """Βρίσκει τη γραμμή επικεφαλίδας που περιέχει το marker ('SUM' / 'TOTAL') και επιστρέφει (row, marker_col)."""
    for idx in range(len(df)):
        cells = [str(c).strip().upper() for c in df.iloc[idx].tolist()]
        if marker in cells:
            return df.iloc[idx].tolist(), cells.index(marker)
    return None, None


def _last_value(row):
    vals = row.dropna().values
    if len(vals) == 0:
        return None
    return to_num(vals[-1])


def parse_isp(df, date_str):
    """ISP: 96 τέταρτα (MW) ανά μονάδα + στήλη TOTAL (MWh) που ΔΕΝ πρέπει να προστεθεί.
    Επιστρέφει (aggregate_rows, surplus_value)."""
    surplus_val = 0.0
    surplus_row = df[df.apply(lambda r: r.astype(str).str.contains("Energy Surplus").any(), axis=1)]
    if not surplus_row.empty:
        v = _last_value(surplus_row.iloc[0])
        if v is not None:
            surplus_val = v

    _, total_col = _find_header_cols(df, "TOTAL")
    units = []
    total_row_net = None
    for _, row in df.iterrows():
        row_list = row.tolist()
        unit, name_idx = _unit_name_in_row(row_list)
        if not unit:
            continue
        if total_col is not None and total_col > name_idx:
            cols = row_list[name_idx + 1: total_col]
            file_total = to_num(row_list[total_col])
        else:  # fallback: χωρίς επικεφαλίδα
            nums = [to_num(v) for v in row_list[name_idx + 1:]]
            nums = [n for n in nums if n is not None]
            cols = nums[:96] if len(nums) in (96, 97) else nums
            file_total = None
        q = [to_num(v) or 0.0 for v in cols]
        charge = sum(-v for v in q if v < 0) / 4
        discharge = sum(v for v in q if v > 0) / 4
        if unit == "TOTAL BESS":
            total_row_net = file_total if file_total is not None else (discharge - charge)
            continue
        if file_total is not None and abs((discharge - charge) - file_total) > 0.5:
            print(f"   ⚠ ISP {unit}: καθαρό ενέργειας {discharge - charge:.2f} ≠ TOTAL αρχείου {file_total:.2f}")
        units.append(_bess_row(date_str, unit, charge, discharge))

    rows = list(units)
    if units:
        sum_net = sum(u["Αποφόρτιση (MWh)"] - u["Φόρτιση (MWh)"] for u in units)
        if total_row_net is not None and abs(sum_net - total_row_net) > 1.0:
            print(f"   ⚠ ISP: άθροισμα μονάδων (net {sum_net:.1f}) ≠ γραμμή TOTAL BESS ({total_row_net:.1f}) - νέα/άγνωστη μονάδα;")
        rows.append(_bess_row(date_str, "TOTAL BESS",
                              sum(u["Φόρτιση (MWh)"] for u in units),
                              sum(u["Αποφόρτιση (MWh)"] for u in units)))
    return rows, surplus_val


def parse_scada(df, date_str, n_hours):
    """SCADA: στήλες ωρών 01..24 (+ '25' για ημέρα 25 ωρών) και στήλη SUM (καθαρό σύνολο) που ΔΕΝ προστίθεται.
    Επιστρέφει (aggregate_rows, hourly_rows, pump_value)."""
    pump_val = 0.0
    pump_row = df[df.apply(lambda r: r.astype(str).str.upper().str.contains("TOTAL PUMPING").any(), axis=1)]
    if not pump_row.empty:
        v = _last_value(pump_row.iloc[0])
        if v is not None:
            pump_val = abs(v)

    header, sum_col = _find_header_cols(df, "SUM")
    hour_cols = []  # (στήλη, ώρα)
    if header is not None:
        for c, v in enumerate(header[:sum_col]):
            n = to_num(v)
            if n is not None and float(n).is_integer() and 1 <= n <= 25:
                hour_cols.append((c, int(n)))

    units, hourly = [], []
    total_row_net = None
    for _, row in df.iterrows():
        row_list = row.tolist()
        unit, name_idx = _unit_name_in_row(row_list)
        if not unit:
            continue
        if hour_cols:
            hours = {h: (to_num(row_list[c]) or 0.0) for c, h in hour_cols}
            file_sum = to_num(row_list[sum_col])
        else:  # fallback: πρώτες 24 αριθμητικές τιμές μετά το όνομα
            nums = [to_num(v) for v in row_list[name_idx + 1:]]
            hours = {i + 1: (n or 0.0) for i, n in enumerate(nums[:24])}
            file_sum = None
        net = sum(hours.values())
        if unit == "TOTAL BESS":
            total_row_net = file_sum if file_sum is not None else net
            continue
        if file_sum is not None and abs(net - file_sum) > 2:
            print(f"   ⚠ SCADA {unit}: άθροισμα ωρών {net:.0f} ≠ SUM αρχείου {file_sum:.0f}")
        charge = sum(-v for v in hours.values() if v < 0)
        discharge = sum(v for v in hours.values() if v > 0)
        units.append(_bess_row(date_str, unit, charge, discharge))

        entry = {"Ημερομηνία": date_str, "Μονάδα BESS": unit}
        for h in range(1, max(24, n_hours) + 1):
            entry[f"{h:02d}:00"] = hours.get(h, 0.0)
        hourly.append(entry)

    rows = list(units)
    if units:
        sum_net = sum(u["Αποφόρτιση (MWh)"] - u["Φόρτιση (MWh)"] for u in units)
        if total_row_net is not None and abs(sum_net - total_row_net) > 3:
            print(f"   ⚠ SCADA: άθροισμα μονάδων (net {sum_net:.0f}) ≠ γραμμή TOTAL BESS ({total_row_net:.0f}) - νέα/άγνωστη μονάδα;")
        # TOTAL BESS = άθροισμα μονάδων (φυσική φόρτιση/αποφόρτιση). Η γραμμή TOTAL του αρχείου
        # συμψηφίζει τις μονάδες ανά ώρα και δίνει χαμηλότερες τιμές φόρτισης/αποφόρτισης.
        rows.append(_bess_row(date_str, "TOTAL BESS",
                              sum(u["Φόρτιση (MWh)"] for u in units),
                              sum(u["Αποφόρτιση (MWh)"] for u in units)))
    return rows, hourly, pump_val


def _replace_date(lst, date_str):
    return [d for d in lst if d.get("Ημερομηνία") != date_str]


def process_isp(df, date_str, db):
    if df is None or df.empty:
        return
    rows, surplus_val = parse_isp(df, date_str)
    # Το surplus αποθηκεύεται πάντα (ανεξάρτητο από το αν υπάρχουν μονάδες BESS, π.χ. πριν την έναρξη καταγραφής)
    db["surplus"] = _replace_date(db["surplus"], date_str) + [{"Ημερομηνία": date_str, "Daily Surplus (MWh)": surplus_val}]
    if not rows:
        print(f"   ℹ ISP {date_str}: δεν βρέθηκαν μονάδες BESS - διατηρούνται τα παλιά δεδομένα BESS (αν υπάρχουν).")
        return
    db["isp"] = _replace_date(db["isp"], date_str) + rows


def process_scada(df, date_str, db):
    if df is None or df.empty:
        return
    _, _, n_hours = day_window_utc(date_str)
    rows, hourly, pump_val = parse_scada(df, date_str, n_hours)
    # Το pumping αποθηκεύεται πάντα (το SCADA BESS ξεκινά 18/6, το TOTAL PUMPING υπάρχει και πριν)
    db["pump"] = _replace_date(db["pump"], date_str) + [{"Ημερομηνία": date_str, "Daily Pumping (MWh)": pump_val}]
    if not rows:
        print(f"   ℹ SCADA {date_str}: δεν βρέθηκαν μονάδες BESS - διατηρούνται τα παλιά δεδομένα BESS (αν υπάρχουν).")
        return
    db["scada"] = _replace_date(db["scada"], date_str) + rows
    db["bessHourly"] = _replace_date(db["bessHourly"], date_str) + hourly


# ---------------------------------------------------------------------------
# ENTSO-E (τιμές Αγοράς Επόμενης Ημέρας, EnEx)
# ---------------------------------------------------------------------------
def _parse_iso(s):
    return datetime.fromisoformat(s.replace("Z", "")[:19])


def parse_entsoe_xml(xml_text, start_utc, n_hours):
    """Επιστρέφει λίστα n_hours ωριαίων τιμών (ή None όπου λείπουν).

    ΣΗΜΑΝΤΙΚΟ: το ENTSO-E (curveType A03) ΠΑΡΑΛΕΙΠΕΙ τα σημεία που έχουν την ίδια τιμή με το προηγούμενο.
    Κάθε θέση που λείπει μέσα σε μια Period σημαίνει «ίδια τιμή με την προηγούμενη», άρα γίνεται
    forward-fill μέχρι το τέλος της Period (όχι πέρα από αυτό)."""
    root = ET.fromstring(xml_text)
    ns = {"ns": root.tag.split("}")[0].strip("{")}
    n_q = n_hours * 4
    quarters = [None] * n_q

    periods = []  # (βήμα σε λεπτά, αρχή, πλήθος θέσεων, {θέση: τιμή})
    for ts in root.findall("ns:TimeSeries", ns):
        # ΦΙΛΤΡΟ 1: Μόνο Day-Ahead (A62)
        business_type = ts.find("ns:businessType", ns)
        if business_type is not None and business_type.text != "A62":
            continue
        # ΦΙΛΤΡΟ 2: Μόνο τιμές σε Ευρώ
        currency = ts.find("ns:currency_Unit.name", ns)
        if currency is not None and currency.text != "EUR":
            continue

        for period in ts.findall("ns:Period", ns):
            resolution = period.find("ns:resolution", ns).text
            step = {"PT15M": 15, "PT60M": 60}.get(resolution)
            if step is None:
                continue
            p_start = _parse_iso(period.find("ns:timeInterval/ns:start", ns).text)
            p_end = _parse_iso(period.find("ns:timeInterval/ns:end", ns).text)
            n_pts = int((p_end - p_start).total_seconds() // 60 // step)
            prices = {}
            for point in period.findall("ns:Point", ns):
                prices[int(point.find("ns:position", ns).text)] = float(point.find("ns:price.amount", ns).text)
            periods.append((step, p_start, n_pts, prices))

    # Πρώτα τα 15λεπτα, μετά τα ωριαία (τα ωριαία γεμίζουν μόνο ό,τι έμεινε κενό)
    for step, p_start, n_pts, prices in sorted(periods, key=lambda p: p[0]):
        last = None
        for pos in range(1, n_pts + 1):
            if pos in prices:
                last = prices[pos]
            if last is None:
                continue
            t = p_start + timedelta(minutes=step * (pos - 1))
            if step == 15:
                idx = int((t - start_utc).total_seconds() // 900)
                if 0 <= idx < n_q:
                    quarters[idx] = last
            else:
                h = int((t - start_utc).total_seconds() // 3600)
                if 0 <= h < n_hours:
                    for i in range(4):
                        if quarters[h * 4 + i] is None:
                            quarters[h * 4 + i] = last

    hourly = []
    for h in range(n_hours):
        qs = [q for q in quarters[h * 4: h * 4 + 4] if q is not None]
        hourly.append(round(sum(qs) / len(qs), 2) if qs else None)
    return hourly


def fetch_entsoe(date_str, db):
    print(f"[{date_str}] Ξεκινάει η λήψη ENTSO-E...")

    if not ENTSOE_TOKEN:
        print(f"[{date_str}] ❌ ΔΕΝ βρέθηκε το ENTSOE_TOKEN!")
        return

    start_utc, end_utc, n_hours = day_window_utc(date_str)
    url = (
        f"https://web-api.tp.entsoe.eu/api?securityToken={ENTSOE_TOKEN}"
        f"&documentType=A44&in_Domain=10YGR-HTSO-----Y&out_Domain=10YGR-HTSO-----Y"
        f"&periodStart={start_utc.strftime('%Y%m%d%H%M')}&periodEnd={end_utc.strftime('%Y%m%d%H%M')}"
    )

    res = http_get(url, timeout=90)
    if res is None or not res.ok:
        print(f"[{date_str}] ❌ Αποτυχία λήψης ENTSO-E.")
        return
    if "<Reason>" in res.text:
        print(f"[{date_str}] ⚠ Το ENTSO-E δεν έχει (ακόμα) δεδομένα για αυτή την ημέρα.")
        return

    try:
        hourly = parse_entsoe_xml(res.text, start_utc, n_hours)
    except Exception as e:
        print(f"[{date_str}] ❌ Σφάλμα parsing ENTSO-E ({type(e).__name__}): {e}")
        return

    missing = [h + 1 for h, v in enumerate(hourly) if v is None]
    if missing:
        # Δεν αντικαθιστούμε καλά δεδομένα με ελλιπή. Το επόμενο τρέξιμο θα ξαναδοκιμάσει.
        print(f"[{date_str}] ⚠ Ελλιπείς ώρες {missing} - δεν αποθηκεύτηκε.")
        return

    mcp_entry = {"Ημερομηνία": date_str}
    for h in range(1, max(24, n_hours) + 1):
        mcp_entry[f"{h}:00"] = hourly[h - 1] if h <= n_hours else None
    db["mcpHourly"] = _replace_date(db["mcpHourly"], date_str) + [mcp_entry]
    print(f"[{date_str}] ✔ Επιτυχία ENTSO-E! Αποθηκεύτηκαν {n_hours}/{n_hours} ωριαίες τιμές.")


# ---------------------------------------------------------------------------
def main():
    db = load_existing_data()

    start_date_env = os.environ.get("START_DATE")
    end_date_env = os.environ.get("END_DATE")

    target_dates = []

    # Αν δώσαμε ημερομηνίες από το GitHub UI (Backfill)
    if start_date_env and end_date_env:
        print(f"Εκκίνηση BESS Data Update (Μαζικό Backfill: {start_date_env} έως {end_date_env})...")
        try:
            start_dt = datetime.strptime(start_date_env, "%Y-%m-%d")
            end_dt = datetime.strptime(end_date_env, "%Y-%m-%d")
            delta = end_dt - start_dt
            for i in range(delta.days + 1):
                target_dates.append((start_dt + timedelta(days=i)).strftime("%Y-%m-%d"))
        except ValueError:
            print("❌ Λάθος μορφή ημερομηνίας. Χρησιμοποιήστε YYYY-MM-DD.")
            return
    # Αν τρέχει αυτόματα με cron (Καθημερινό Healing)
    else:
        print(f"Εκκίνηση BESS Data Update (Αυτόματο Healing {DAYS_TO_FETCH} ημερών)...")
        today = datetime.now()
        for i in range(DAYS_TO_FETCH - 1, -1, -1):
            target_dates.append((today - timedelta(days=i)).strftime("%Y-%m-%d"))

    for target_date in target_dates:
        print(f"\n--- Επεξεργασία: {target_date} ---")

        process_isp(fetch_admie_excel(target_date, "ISP2ISPResults"), target_date, db)
        process_scada(fetch_admie_excel(target_date, "SystemRealizationSCADA"), target_date, db)
        fetch_entsoe(target_date, db)

        # Ευγένεια προς τους servers σε μαζικό backfill (αποφυγή rate limits / ban)
        time.sleep(float(os.environ.get("DAY_DELAY_SECONDS", "2")))

    save_data(db)
    print("\n✔ Η ενημέρωση ολοκληρώθηκε!")


if __name__ == "__main__":
    main()
