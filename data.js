// Πλέον διαβάζουμε το τοπικό αρχείο που παράγει το Python script!
const API_URL = "data/historical.json";

let rawData = { isp: [], scada: [], surplus: [], pump: [], bessHourly: [], mcpHourly: [] };
let currentLang = 'en';

const i18n = {
    el: {
        title: "Greek BESS Market Analytics",
        source: "Πηγή δεδομένων: Επίσημα αρχεία ISP & SCADA - ΑΔΜΗΕ (IPTO)",
        scopeTooltip: "Αφορά αποκλειστικά τις μονάδες BESS στο Σύστημα Μεταφοράς (ΑΔΜΗΕ). Δεν περιλαμβάνονται τα συστήματα στο Δίκτυο Διανομής (ΔΕΔΔΗΕ).",
        lastUpdate: "Τελευταία Ενημέρωση:",
        nextUpdate: "Επόμενη Ενημέρωση:",
        dateLabel: "Ημερομηνία:",
        monthLabel: "Μήνας:",
        tabDaily: "Ημερήσια Ανάλυση",
        tabMonthly: "Μηνιαίος Αντίκτυπος",
        tabSurplus: "Πλεόνασμα & Ευελιξία",
        tabArbitrage: "Arbitrage P&L",
        btnMethodology: "Μεθοδολογία & Παραδοχές",
        modalTitle: "Μεθοδολογία & Βασικές Παραδοχές",
        modalBody: `
            <p class="mb-3">Το παρόν Dashboard αποτελεί ένα ανεξάρτητο εργαλείο παρακολούθησης και ανάλυσης της δραστηριότητας των μονάδων Αποθήκευσης Ενέργειας (BESS) στην Ελληνική Αγορά, βασισμένο σε ανοιχτά δεδομένα.</p>
            <ul class="list-disc pl-5 space-y-2 mb-4 text-slate-400">
                <li><strong class="text-slate-200">Πηγές Δεδομένων:</strong> Τα δεδομένα αντλούνται καθημερινά από τα επίσημα αρχεία του ΑΔΜΗΕ (ISP Results & System Realization SCADA) και του ENTSO-E (Day-Ahead Market Prices).</li>
                <li><strong class="text-slate-200">Οικονομικό Μοντέλο (P&L):</strong> Η εκτίμηση εσόδων (Arbitrage) αφορά <strong>αποκλειστικά τη λειτουργία στην Αγορά Επόμενης Ημέρας (DAM)</strong>. Ως price-takers, τα συστήματα θεωρείται ότι αγοράζουν και πωλούν στην Τιμή Εκκαθάρισης Αγοράς (MCP). <em>Δεν συμπεριλαμβάνονται</em> τα έσοδα από την Αγορά Εξισορρόπησης (Balancing Market), Επικουρικές Υπηρεσίες (FCR, aFRR) ή μηχανισμούς ισχύος.</li>
                <li><strong class="text-slate-200">Απόδοση Κύκλου (RTE):</strong> Υπολογίζεται σε ημερήσια βάση (AC-to-AC) από τα δεδομένα SCADA. Ακραίες τιμές (π.χ. >92% ή <83%) οφείλονται συχνά στο φαινόμενο <em>Inter-day SoC Carryover</em>, όπου η μπαταρία διατηρεί απόθεμα ενέργειας για να το εγχύσει την επόμενη μέρα, εμφανίζοντας τεχνητά αλλοιωμένο ημερήσιο κλάσμα.</li>
                <li><strong class="text-slate-200">Περιβαλλοντικός Αντίκτυπος:</strong> Οι μετρικές μηνιαίας υποκατάστασης είναι θεωρητικές. Βασίζονται στην υπόθεση ότι κάθε παραγόμενη MWh από BESS υποκαθιστά ακριβότερη και ρυπογόνο θερμική παραγωγή (Φυσικό Αέριο/Λιγνίτη), ενώ κάθε MWh φόρτισης αφορά δυνητική απορρόφηση πλεονάσματος ΑΠΕ που αλλιώς θα περικόπτονταν.</li>
            </ul>
        `,
        dischargeTitle: "Αποφόρτιση (Discharge) Ανά Μονάδα BESS (MWh)",
        totalDischarge: "Συνολική Αποφόρτιση",
        chargeTitle: "Φόρτιση (Charge) Ανά Μονάδα BESS (MWh)",
        totalCharge: "Συνολική Φόρτιση",
        rte: "Round Trip Efficiency (RTE - Total BESS)",
        schedIsp: "ΠΡΟΓΡΑΜΜΑΤΙΣΜΟΣ (ISP)",
        actScada: "ΠΡΑΓΜΑΤΙΚΗ (SCADA)",
        monthlyDischargeTitle: "Πιθανή Υποκατάσταση Θερμικών Μονάδων (Λιγνήτης ή/και Φ. Αέριο) - (Αθροιστική Αποφόρτιση)",
        monthlyDischargeSub: "SCADA Data - Εξοικονόμηση θερμικής παραγωγής",
        monthlyChargeTitle: "Πιθανή Αποφυγή Περικοπών ΑΠΕ (Αθροιστική Φόρτιση)",
        monthlyChargeSub: "SCADA Data - Ενέργεια που αλλιώς θα περικόπτονταν (Curtailment)",
        kpiLabelAvoided: "Μηνιαια Αποφυγη",
        kpiLabelDisplaced: "Μηνιαια Υποκατασταση",
        surplusStackedTitle: "Ημερήσιο Πλεόνασμα & Απορρόφηση Ευελιξίας (GWh)",
        surplusStackedSub: "Απόλυτες τιμές. Τις μέρες χωρίς κόκκινη μπάρα (Surplus = 0) η φόρτιση αφορά καθαρά λειτουργία αγοράς (arbitrage).",
        surplusBadgeTip: "Το % απορρόφησης υπολογίζεται επί του Θεωρητικού Αρχικού Πλεονάσματος (Surplus + BESS Charge + PUMP Charge)",
        surplusCumulativeTitle: "Αθροιστική Εξέλιξη Ευελιξίας (Cumulative BESS & PUMP vs Surplus)",
        surplusCumulativeSub: "Σύγκριση της αθροιστικής φόρτισης SCADA (Μπαταρίες + Αντλησιοταμίευση) με το αθροιστικό υπολειπόμενο ISP Surplus",
        arbitrageMainTitle: "Arbitrage P&L & Ωριαίο Προφίλ Λειτουργίας",
        arbitrageDateLabel: "Ημερομηνία:",
        arbitrageChartTitle: "Ωριαία Κίνηση BESS ανά Μονάδα (MWh)",
        arbitrageChartSub: "Αρνητικές τιμές = Φόρτιση, Θετικές τιμές = Αποφόρτιση",
        arbitrageTableTitle: "Οικονομική Απόδοση & Arbitrage (Ημέρας)",
        thUnit: "ΜΟΝΑΔΑ BESS",
        thCharge: "ΣΥΝΟΛΙΚΗ ΦΟΡΤΙΣΗ (MWH)",
        thDischarge: "ΣΥΝΟΛΙΚΗ ΑΠΟΦΟΡΤΙΣΗ (MWH)",
        thRte: "RTE (%)",
        thPnl: "ΠΙΘΑΝΟ DAILY P&L (€)",
        thProfit: "UNIT PROFIT (€/MWH)"
    },
    en: {
        title: "Greek BESS Market Analytics",
        source: "Data source: IPTO (ADMIE) official ISP & SCADA files",
        scopeTooltip: "Refers exclusively to BESS units connected to the Transmission System (IPTO/ADMIE). Excludes distributed systems on the Distribution Network (HEDNO).",
        lastUpdate: "Last Update:",
        nextUpdate: "Next Update:",
        dateLabel: "Date:",
        monthLabel: "Month:",
        tabDaily: "Daily Analytics",
        tabMonthly: "Monthly Impact",
        tabSurplus: "Surplus & Flexibility",
        tabArbitrage: "Arbitrage P&L",
        btnMethodology: "Methodology & Assumptions",
        modalTitle: "Methodology & Core Assumptions",
        modalBody: `
            <p class="mb-3">This Dashboard serves as an independent tool for monitoring and analyzing Battery Energy Storage Systems (BESS) activity in the Greek Energy Market, based entirely on open data.</p>
            <ul class="list-disc pl-5 space-y-2 mb-4 text-slate-400">
                <li><strong class="text-slate-200">Data Sources:</strong> Data is fetched daily from IPTO's (ADMIE) official reports (ISP Results & System Realization SCADA) and ENTSO-E (Day-Ahead Market Prices).</li>
                <li><strong class="text-slate-200">Financial Model (P&L):</strong> The estimated Arbitrage revenue is based <strong>strictly on the Day-Ahead Market (DAM)</strong>. Assuming a price-taker behavior, units charge/discharge at the Market Clearing Price (MCP). <em>Revenues from the Balancing Market, Ancillary Services (FCR, aFRR), or Capacity Mechanisms are entirely excluded.</em></li>
                <li><strong class="text-slate-200">Round Trip Efficiency (RTE):</strong> Calculated on a daily AC-to-AC basis from SCADA telemetry. Extreme outliers (e.g., >92% or <83%) are typically caused by the <em>Inter-day SoC Carryover</em> effect, where a battery holds state-of-charge to inject on a subsequent day, artificially skewing the daily ratio.</li>
                <li><strong class="text-slate-200">Environmental Impact:</strong> Monthly displacement metrics are theoretical. They rely on the assumption that BESS discharge displaces expensive/polluting thermal generation (Gas/Lignite), while BESS charging absorbs surplus RES generation that would otherwise face curtailment.</li>
            </ul>
        `,
        dischargeTitle: "Discharge Per BESS Unit (MWh)",
        totalDischarge: "Total Discharge",
        chargeTitle: "Charge Per BESS Unit (MWh)",
        totalCharge: "Total Charge",
        rte: "Round Trip Efficiency (RTE - Total BESS)",
        schedIsp: "SCHEDULED (ISP)",
        actScada: "ACTUAL (SCADA)",
        monthlyDischargeTitle: "Potential Displaced Thermal Generation (Lignite/Gas) - (Cumulative Discharge)",
        monthlyDischargeSub: "SCADA Data - Avoided Thermal Generation",
        monthlyChargeTitle: "Potential Avoided RES Curtailment (Cumulative Charge)",
        monthlyChargeSub: "SCADA Data - Energy saved from curtailment",
        kpiLabelAvoided: "Monthly Avoided",
        kpiLabelDisplaced: "Monthly Displaced",
        surplusStackedTitle: "Daily Energy Surplus & Flexibility Absorption (GWh)",
        surplusStackedSub: "Absolute values. Days with no red bar (Surplus = 0) indicate purely market-driven arbitrage charging.",
        surplusBadgeTip: "Absorption % is calculated on the Theoretical Initial Surplus (ISP Surplus + BESS + PUMP)",
        surplusCumulativeTitle: "Cumulative Flexibility Evolution (BESS & PUMP vs Surplus)",
        surplusCumulativeSub: "Comparison of cumulative SCADA charging (Batteries + Pumped Hydro) vs cumulative residual ISP Surplus",
        arbitrageMainTitle: "Arbitrage P&L & Hourly Operation Profile",
        arbitrageDateLabel: "Date:",
        arbitrageChartTitle: "Hourly BESS Operation per Unit (MWh)",
        arbitrageChartSub: "Negative values = Charging, Positive values = Discharging",
        arbitrageTableTitle: "Daily Financial Performance & Arbitrage",
        thUnit: "BESS UNIT",
        thCharge: "TOTAL CHARGE (MWH)",
        thDischarge: "TOTAL DISCHARGE (MWH)",
        thRte: "RTE (%)",
        thPnl: "POTENTIAL DAILY P&L (€)",
        thProfit: "UNIT PROFIT (€/MWH)"
    }
};

function setLang(lang) {
    currentLang = lang;
    const t = i18n[lang];
    
    document.getElementById('mainTitle').innerText = t.title;
    document.getElementById('dataSourceText').innerText = t.source;
    document.getElementById('scopeBadge').title = t.scopeTooltip;
    document.getElementById('lastUpdateLabel').innerText = t.lastUpdate;
    document.getElementById('nextUpdateLabel').innerText = t.nextUpdate;
    document.getElementById('dateLabel').innerText = t.dateLabel;
    document.getElementById('monthLabel').innerText = t.monthLabel;
    document.getElementById('monthLabelSurp').innerText = t.monthLabel;
    
    if(document.getElementById('btnMethodologyText')) document.getElementById('btnMethodologyText').innerText = t.btnMethodology;
    if(document.getElementById('modalTitle')) document.getElementById('modalTitle').innerText = t.modalTitle;
    if(document.getElementById('modalBody')) document.getElementById('modalBody').innerHTML = t.modalBody;

    document.getElementById('tabBtnDaily').innerText = t.tabDaily;
    document.getElementById('tabBtnMonthly').innerText = t.tabMonthly;
    document.getElementById('tabBtnSurplus').innerText = t.tabSurplus;
    document.getElementById('tabBtnArbitrage').innerText = t.tabArbitrage;
    
    document.getElementById('dischargeTitle').innerText = t.dischargeTitle;
    document.getElementById('totalDischargeLabel').innerText = t.totalDischarge;
    document.getElementById('chargeTitle').innerText = t.chargeTitle;
    document.getElementById('totalChargeLabel').innerText = t.totalCharge;
    document.getElementById('rteLabel').innerText = t.rte;
    document.getElementById('lblDispIsp').innerText = t.schedIsp;
    document.getElementById('lblDispScada').innerText = t.actScada;
    document.getElementById('lblChgIsp').innerText = t.schedIsp;
    document.getElementById('lblChgScada').innerText = t.actScada;

    document.getElementById('monthlyDischargeTitle').innerText = t.monthlyDischargeTitle;
    document.getElementById('monthlyDischargeSub').innerText = t.monthlyDischargeSub;
    document.getElementById('monthlyChargeTitle').innerText = t.monthlyChargeTitle;
    document.getElementById('monthlyChargeSub').innerText = t.monthlyChargeSub;
    document.getElementById('kpiLabelAvoided').innerText = t.kpiLabelAvoided;
    document.getElementById('kpiLabelDisplaced').innerText = t.kpiLabelDisplaced;

    document.getElementById('surplusStackedTitle').innerText = t.surplusStackedTitle;
    document.getElementById('surplusStackedSub').innerText = t.surplusStackedSub;
    document.getElementById('surplusBadge').title = t.surplusBadgeTip;
    document.getElementById('surplusCumulativeTitle').innerText = t.surplusCumulativeTitle;
    document.getElementById('surplusCumulativeSub').innerText = t.surplusCumulativeSub;

    document.getElementById('arbitrageMainTitle').innerText = t.arbitrageMainTitle;
    document.getElementById('arbitrageDateLabel').innerText = t.arbitrageDateLabel;
    document.getElementById('arbitrageChartTitle').innerText = t.arbitrageChartTitle;
    document.getElementById('arbitrageChartSub').innerText = t.arbitrageChartSub;
    document.getElementById('arbitrageTableTitle').innerText = t.arbitrageTableTitle;
    document.getElementById('thUnit').innerText = t.thUnit;
    document.getElementById('thCharge').innerText = t.thCharge;
    document.getElementById('thDischarge').innerText = t.thDischarge;
    document.getElementById('thRte').innerText = t.thRte;
    document.getElementById('thPnl').innerText = t.thPnl;
    document.getElementById('thProfit').innerText = t.thProfit;

    if(lang === 'el') {
        document.getElementById('btnGr').className = "px-2 py-1 rounded bg-emerald-600 text-white transition";
        document.getElementById('btnEn').className = "px-2 py-1 rounded text-slate-400 hover:text-white transition";
    } else {
        document.getElementById('btnEn').className = "px-2 py-1 rounded bg-emerald-600 text-white transition";
        document.getElementById('btnGr').className = "px-2 py-1 rounded text-slate-400 hover:text-white transition";
    }

    if (typeof updateDashboard === "function") updateDashboard();
    if (typeof updateMonthlyDashboard === "function") updateMonthlyDashboard();
    if (typeof updateSurplusDashboard === "function") updateSurplusDashboard();
    if (typeof renderArbitrageTab === "function") renderArbitrageTab(); 
}

function parseNum(val) {
    if (val === null || val === undefined) return 0;
    if (typeof val === 'number') return isNaN(val) ? 0 : val;
    let str = String(val).trim().replace(',', '.').replace(/[^0-9.-]/g, '');
    let n = parseFloat(str);
    return isNaN(n) ? 0 : n;
}

function normalizeData(dataArray) {
    if (!dataArray || dataArray.length === 0) return [];
    
    // Πλέον τα κλειδιά έρχονται απευθείας από τη δομή του Python script
    return dataArray.map(d => ({
        date: d["Ημερομηνία"],
        unit: String(d["Μονάδα BESS"] || "").trim(),
        charge: parseNum(d["Φόρτιση (MWh)"]),
        discharge: parseNum(d["Αποφόρτιση (MWh)"]),
        rte: d["RTE (%)"] || "0.00%"
    }));
}

function updateFreshness(dates) {
    if (!dates || dates.length === 0) return;
    const latestDate = dates[0];
    let parts = latestDate.split('-');
    let formattedLatest = latestDate;
    let formattedNext = "-";
    if (parts.length === 3) {
        formattedLatest = `${parts[2]}/${parts[1]}/${parts[0]} 08:00`;
        let d = new Date(parts[0], parts[1] - 1, parseInt(parts[2]) + 1);
        let day = String(d.getDate()).padStart(2, '0');
        let month = String(d.getMonth() + 1).padStart(2, '0');
        let year = d.getFullYear();
        formattedNext = `${day}/${month}/${year} 08:00`;
    }
    document.getElementById('lastUpdateVal').innerText = formattedLatest;
    document.getElementById('nextUpdateVal').innerText = formattedNext;
}

async function init() {
    try {
        // Προσθέτουμε timestamp στο URL (cache-busting) για να μην κρατάει ο browser παλιά δεδομένα
        const res = await fetch(`${API_URL}?t=${new Date().getTime()}`);
        if (!res.ok) throw new Error("JSON file not found. Ensure the GitHub action has run.");
        
        const json = await res.json();
        
        rawData.isp = normalizeData(json.isp);
        rawData.scada = normalizeData(json.scada);
        rawData.bessHourly = json.bessHourly || [];
        rawData.mcpHourly = json.mcpHourly || [];
        
        if (json.surplus) {
            rawData.surplus = json.surplus.map(d => ({
                date: d["Ημερομηνία"],
                val: parseNum(d["Daily Surplus (MWh)"])
            }));
        }

        if (json.pump) {
            rawData.pump = json.pump.map(d => ({
                date: d["Ημερομηνία"],
                val: parseNum(d["Daily Pumping (MWh)"])
            }));
        }
        
        document.getElementById('scopeBadge').title = i18n[currentLang].scopeTooltip;

        const dates = [...new Set([
            ...rawData.isp.map(d => d.date),
            ...rawData.scada.map(d => d.date)
        ])].filter(d => d).sort().reverse();
        
        document.getElementById('dateSelect').innerHTML = dates.map(d => `<option value="${d}">${d}</option>`).join('');

        const months = [...new Set(dates.map(d => d.substring(0, 7)))].sort().reverse();
        const monthOptions = months.map(m => {
            const parts = m.split('-');
            return `<option value="${m}">${parts[1]}/${parts[0]}</option>`;
        }).join('');
        
        document.getElementById('monthSelect').innerHTML = monthOptions;
        document.getElementById('monthSelectSurplus').innerHTML = monthOptions;

        updateFreshness(dates);
        if (typeof updateDashboard === "function") updateDashboard();
        if (typeof updateMonthlyDashboard === "function") updateMonthlyDashboard();
        if (typeof updateSurplusDashboard === "function") updateSurplusDashboard();
    } catch (err) {
        console.warn("Σφάλμα κατά τη φόρτωση των δεδομένων (Αναμενόμενο αν δεν έχει τρέξει το Action): " + err.message);
    }
}
init();
