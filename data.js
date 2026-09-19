// Pointing to the locally generated JSON file instead of Google Apps Script
const API_URL = "data/historical.json";

let rawData = { isp: [], scada: [], surplus: [], pump: [], bessHourly: [], mcpHourly: [] };
let currentLang = 'en';

const i18n = {
    // (Keep your existing i18n object exactly as it was. Omitted for brevity but DO NOT delete it in your actual file.)
    // ... [Insert your exact i18n object here from the old data.js] ...
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
    
    if(document.getElementById('btnMethodologyText')) {
        document.getElementById('btnMethodologyText').innerText = t.btnMethodology;
    }
    if(document.getElementById('modalTitle')) {
        document.getElementById('modalTitle').innerText = t.modalTitle;
    }
    if(document.getElementById('modalBody')) {
        document.getElementById('modalBody').innerHTML = t.modalBody;
    }

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

function switchTab(tabId) {
    const tabs = ['daily', 'monthly', 'surplus'];
    tabs.forEach(t => {
        const btn = document.getElementById('tabBtn' + t.charAt(0).toUpperCase() + t.slice(1));
        const view = document.getElementById('view' + t.charAt(0).toUpperCase() + t.slice(1));
        if (t === tabId) {
            btn.className = "text-emerald-400 font-bold border-b-2 border-emerald-400 pb-2 px-2 transition whitespace-nowrap";
            view.classList.remove('hidden');
        } else {
            btn.className = "text-slate-500 hover:text-emerald-300 pb-2 px-2 transition whitespace-nowrap";
            view.classList.add('hidden');
        }
    });

    if (tabId === 'daily' && typeof updateDashboard === "function") updateDashboard();
    if (tabId === 'monthly' && typeof updateMonthlyDashboard === "function") updateMonthlyDashboard();
    if (tabId === 'surplus' && typeof updateSurplusDashboard === "function") updateSurplusDashboard();
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
    
    return dataArray.map(d => ({
        // Keys map directly to the JSON structure created by Python
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
        // Cache busting to ensure the browser fetches the latest static JSON file
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
        alert("Σφάλμα κατά τη φόρτωση των δεδομένων: " + err.message);
        console.error(err);
    }
}
init();
