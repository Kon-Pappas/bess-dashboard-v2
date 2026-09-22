import os
import json
import requests
import pandas as pd
from datetime import datetime, timedelta
from io import BytesIO

# --- ΡΥΘΜΙΣΕΙΣ ---
DATA_FILE = "data/historical.json"
ADMIE_URL = "https://www.admie.gr/getOperationMarketFile"
ENTSOE_TOKEN = os.environ.get("ENTSOE_TOKEN")
HEADERS = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"}
DAYS_TO_FETCH = 5

def load_existing_data():
    if os.path.exists(DATA_FILE):
        with open(DATA_FILE, "r", encoding="utf-8") as f:
            try:
                return json.load(f)
            except json.JSONDecodeError:
                pass
    return {
        "isp": [], "scada": [], "surplus": [], 
        "pump": [], "bessHourly": [], "mcpHourly": []
    }

def save_data(data):
    os.makedirs(os.path.dirname(DATA_FILE), exist_ok=True)
    with open(DATA_FILE, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)

def fetch_admie_excel(date_str, category):
    url = f"{ADMIE_URL}?dateStart={date_str}&dateEnd={date_str}&FileCategory={category}"
    res = requests.get(url, headers=HEADERS)
    if not res.ok: return None
    
    try:
        data = res.json()
        if not data: return None
        file_path = data[0].get("file_path", "")
        file_url = f"https://www.admie.gr{file_path}" if file_path.startswith("/") else file_path
        
        excel_res = requests.get(file_url, headers=HEADERS)
        if not excel_res.ok: return None
        return pd.read_excel(BytesIO(excel_res.content), header=None)
    except Exception:
        return None

def process_admie_file(df, date_str, category, db):
    if df is None or df.empty: return

    if category == "ISP2ISPResults":
        surplus_val = 0.0
        surplus_row = df[df.apply(lambda r: r.astype(str).str.contains("Energy Surplus").any(), axis=1)]
        if not surplus_row.empty:
            row_vals = surplus_row.iloc[0].dropna().values
            try: surplus_val = float(str(row_vals[-1]).replace(',', '.'))
            except: pass
        db["surplus"] = [d for d in db["surplus"] if d.get("Ημερομηνία") != date_str]
        db["surplus"].append({"Ημερομηνία": date_str, "Daily Surplus (MWh)": surplus_val})

    elif category == "SystemRealizationSCADA":
        pump_val = 0.0
        pump_row = df[df.apply(lambda r: r.astype(str).str.upper().str.contains("TOTAL PUMPING").any(), axis=1)]
        if not pump_row.empty:
            row_vals = pump_row.iloc[0].dropna().values
            try: pump_val = abs(float(str(row_vals[-1]).replace(',', '.')))
            except: pass
        db["pump"] = [d for d in db["pump"] if d.get("Ημερομηνία") != date_str]
        db["pump"].append({"Ημερομηνία": date_str, "Daily Pumping (MWh)": pump_val})

    target_agg = "isp" if category == "ISP2ISPResults" else "scada"
    db[target_agg] = [d for d in db[target_agg] if d.get("Ημερομηνία") != date_str]
    if category == "SystemRealizationSCADA":
        db["bessHourly"] = [d for d in db["bessHourly"] if d.get("Ημερομηνία") != date_str]

    calc_total_charge, calc_total_discharge = 0.0, 0.0
    found_total = False

    for idx, row in df.iterrows():
        row_list = row.tolist()
        unit_name = ""
        name_idx = -1
        
        for c in range(min(len(row_list), 4)):
            val = str(row_list[c]).strip().upper()
            if val.endswith("SB") or val.endswith("SP") or val == "TOTAL BESS":
                unit_name = str(row_list[c]).strip()
                name_idx = c
                break
                
        if unit_name:
            if unit_name == "TOTAL BESS": found_total = True
            
            numeric_vals = []
            for v in row_list[name_idx+1:]:
                try: numeric_vals.append(float(str(v).replace(' ', '').replace(',', '.')))
                except: pass

            charge_sum = sum(abs(v) for v in numeric_vals if v < 0)
            discharge_sum = sum(v for v in numeric_vals if v > 0)
            
            factor = 4 if category == "ISP2ISPResults" and len(numeric_vals) > 90 else 1
            charge_sum = round(charge_sum / factor, 3)
            discharge_sum = round(discharge_sum / factor, 3)
            rte = (discharge_sum / charge_sum * 100) if charge_sum > 0 else 0
            
            if unit_name != "TOTAL BESS":
                calc_total_charge += charge_sum
                calc_total_discharge += discharge_sum

            db[target_agg].append({
                "Ημερομηνία": date_str,
                "Μονάδα BESS": unit_name,
                "Φόρτιση (MWh)": charge_sum,
                "Αποφόρτιση (MWh)": discharge_sum,
                "RTE (%)": f"{rte:.2f}%"
            })

            if category == "SystemRealizationSCADA" and unit_name != "TOTAL BESS":
                hourly_entry = {"Ημερομηνία": date_str, "Μονάδα BESS": unit_name}
                for h in range(1, 25):
                    val = numeric_vals[h-1] if (h-1) < len(numeric_vals) else 0
                    hourly_entry[f"{h:02d}:00"] = val
                db["bessHourly"].append(hourly_entry)

    if not found_total and calc_total_charge > 0:
        rte = (calc_total_discharge / calc_total_charge * 100) if calc_total_charge > 0 else 0
        db[target_agg].append({
            "Ημερομηνία": date_str,
            "Μονάδα BESS": "TOTAL BESS",
            "Φόρτιση (MWh)": round(calc_total_charge, 3),
            "Αποφόρτιση (MWh)": round(calc_total_discharge, 3),
            "RTE (%)": f"{rte:.2f}%"
        })

def fetch_entsoe(date_str, db):
    print(f"[{date_str}] Ξεκινάει η λήψη ENTSO-E...")
    
    if not ENTSOE_TOKEN:
        print(f"[{date_str}] ❌ ΔΕΝ βρέθηκε το ENTSOE_TOKEN!")
        return
        
    dt = datetime.strptime(date_str, "%Y-%m-%d")
    year = dt.year
    
    march_end = max(d for d in [datetime(year, 3, i) for i in range(25, 32)] if d.weekday() == 6)
    oct_end = max(d for d in [datetime(year, 10, i) for i in range(25, 32)] if d.weekday() == 6)
    
    is_dst = march_end <= dt < oct_end
    
    # Διατηρούμε την απόλυτα σωστή ώρα του ENEX (Market Coupling σε CET)
    start_hour = 22 if is_dst else 23
    
    start_time = dt - timedelta(days=1)
    period_start = f"{start_time.strftime('%Y%m%d')}{start_hour}00"
    period_end = f"{dt.strftime('%Y%m%d')}{start_hour}00"
    
    target_start_utc = start_time.replace(hour=start_hour, minute=0, second=0)

    url = (
        f"https://web-api.tp.entsoe.eu/api?securityToken={ENTSOE_TOKEN}"
        f"&documentType=A44&in_Domain=10YGR-HTSO-----Y&out_Domain=10YGR-HTSO-----Y"
        f"&periodStart={period_start}&periodEnd={period_end}"
    )
    
    try:
        res = requests.get(url, headers=HEADERS)
        if not res.ok: return
            
        if "<Reason>" in res.text: return
        
        import xml.etree.ElementTree as ET
        root = ET.fromstring(res.text)
        ns = {'ns': root.tag.split('}')[0].strip('{')}
        
        # Απόλυτη Θωράκιση: Φτιάχνουμε 96 "άδεια" κουτάκια για κάθε 15λεπτο της ημέρας
        quarters = [None] * 96
        
        for ts in root.findall('ns:TimeSeries', ns):
            # ΦΙΛΤΡΟ 1: Μόνο Day-Ahead (A62). Πετάει έξω Intraday & Fallbacks.
            business_type = ts.find('ns:businessType', ns)
            if business_type is not None and business_type.text != "A62":
                continue
                
            # ΦΙΛΤΡΟ 2: Μόνο τιμές σε Ευρώ (Σώζει 100% τη Βουλγαρία από το BGN)
            currency = ts.find('ns:currency_Unit.name', ns)
            if currency is not None and currency.text != "EUR":
                continue

            period = ts.find('ns:Period', ns)
            if period is None: continue
            
            period_start_str = period.find('ns:timeInterval/ns:start', ns).text.replace('Z', '')
            if len(period_start_str) == 16:
                period_start_utc = datetime.strptime(period_start_str, "%Y-%m-%dT%H:%M")
            else:
                period_start_utc = datetime.strptime(period_start_str[:19], "%Y-%m-%dT%H:%M:%S")
                
            resolution = period.find('ns:resolution', ns).text
            
            for point in period.findall('ns:Point', ns):
                pos = int(point.find('ns:position', ns).text)
                price = float(point.find('ns:price.amount', ns).text)
                
                # Αν είναι 15λεπτη τιμή (PT15M), τη βάζουμε κατευθείαν στο σωστό 15λεπτο
                if resolution == "PT15M":
                    point_time = period_start_utc + timedelta(minutes=15 * (pos - 1))
                    diff_minutes = int((point_time - target_start_utc).total_seconds() // 60)
                    idx = diff_minutes // 15
                    if 0 <= idx < 96:
                        quarters[idx] = price
                        
                # Αν είναι Ωριαία τιμή (PT60M), γεμίζουμε 4 δεκαπεντάλεπτα 
                # (ΑΛΛΑ μόνο αν δεν τα έχουμε ήδη γεμίσει με πιο ακριβή 15λεπτα δεδομένα!)
                elif resolution == "PT60M":
                    point_time = period_start_utc + timedelta(hours=(pos - 1))
                    diff_hours = int((point_time - target_start_utc).total_seconds() // 3600)
                    if 0 <= diff_hours < 24:
                        start_idx = diff_hours * 4
                        for i in range(4):
                            if quarters[start_idx + i] is None:
                                quarters[start_idx + i] = price

        # Υπολογισμός τελικών ωριαίων τιμών βγάζοντας τον μέσο όρο των τετάρτων!
        valid_hours = 0
        mcp_entry = {"Ημερομηνία": date_str}
        
        for h in range(24):
            # Παίρνουμε τα 4 τέταρτα κάθε ώρας (εξαιρώντας τα άδεια 'None')
            q_slice = quarters[h*4 : h*4+4]
            valid_qs = [q for q in q_slice if q is not None]
            
            if len(valid_qs) > 0:
                mcp_entry[f"{h+1}:00"] = round(sum(valid_qs) / len(valid_qs), 2)
                valid_hours += 1
            else:
                mcp_entry[f"{h+1}:00"] = 0.0

        if valid_hours > 0:
            db["mcpHourly"] = [d for d in db["mcpHourly"] if d.get("Ημερομηνία") != date_str]
            db["mcpHourly"].append(mcp_entry)
            print(f"[{date_str}] ✔ Επιτυχία ENTSO-E! Αποθηκεύτηκαν {valid_hours}/24 ωριαίες τιμές.")
            
    except Exception as e:
        print(f"[{date_str}] ❌ Σφάλμα κώδικα (Parsing) ENTSO-E: {e}")

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
        
        df_isp = fetch_admie_excel(target_date, "ISP2ISPResults")
        process_admie_file(df_isp, target_date, "ISP2ISPResults", db)
        
        df_scada = fetch_admie_excel(target_date, "SystemRealizationSCADA")
        process_admie_file(df_scada, target_date, "SystemRealizationSCADA", db)
        
        fetch_entsoe(target_date, db)

    save_data(db)
    print("\n✔ Η ενημέρωση ολοκληρώθηκε!")

if __name__ == "__main__":
    main()
