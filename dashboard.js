// ==========================================
// GLOBAL CHART INSTANCES & STATE
// ==========================================
let dischargeChartInst = null;
let chargeChartInst = null;
let monthlyDischargeChartInst = null;
let monthlyChargeChartInst = null;
let surplusStackedChartInst = null;
let surplusCumulativeChartInst = null;
let surplusHourlyChartInst = null;
let arbitrageDualChartInst = null;

let currentlyIsolatedBess = null;

// ==========================================
// ΑΝΤΙΣΤΟΙΧΙΣΗ ΩΡΩΝ MCP ↔ SCADA
// Η ημέρα παράδοσης της Αγοράς Επόμενης Ημέρας ορίζεται σε CET, ενώ οι ώρες του SCADA ακολουθούν
// την ελληνική ώρα (+1h). Εμπειρικά (συσχέτιση BESS-MCP, κάθε μήνας Ιούν-Σεπ) η ώρα SCADA h
// ταιριάζει με την ώρα MCP h-1. Δεν έχει επιβεβαιωθεί από τεκμηρίωση του ΑΔΜΗΕ.
// Αλλαγή προεπιλογής: μετάβαση της παρακάτω σταθεράς σε false.
// ==========================================
let mcpShiftEnabled = true;

function setMcpShift(on) {
    mcpShiftEnabled = !!on;
    renderArbitrageTab();
    // Το φίλτρο τιμής του Monthly tab χρησιμοποιεί την ίδια αντιστοίχιση ωρών
    if (typeof updateMonthlyDashboard === 'function') updateMonthlyDashboard();
    if (typeof renderSurplusHourlyProfile === 'function') renderSurplusHourlyProfile();
}

// Ωριαίες τιμές MCP μιας εγγραφής (υποστηρίζει και τέταρτα T1..T96). Τιμές που λείπουν -> 0.
function getMcpHoursFromRow(row, nH) {
    const out = new Array(nH).fill(0);
    if (!row) return out;
    for (let h = 1; h <= nH; h++) {
        const startT = (h - 1) * 4 + 1;
        if (row['T' + startT] !== undefined) {
            let sum = 0;
            for (let i = 0; i < 4; i++) sum += parseFloat(row['T' + (startT + i)]) || 0;
            out[h - 1] = sum / 4;
        } else {
            out[h - 1] = parseFloat(String(row[h + ':00']).replace(',', '.')) || 0;
        }
    }
    return out;
}

// ==========================================
// ΠΙΘΑΝΗ ΑΠΟΦΥΓΗ ΠΕΡΙΚΟΠΩΝ: μόνο φόρτιση BESS σε ώρες με τιμή MCP <= όριο
// Φόρτιση όταν η τιμή είναι >5 €/MWh (π.χ. νυχτερινό arbitrage) δεν μετράει ως αποφυγή περικοπής,
// γιατί οι περικοπές συμβαίνουν μόνο όταν οι ΑΠΕ κορέσουν την αγορά (τιμή ≈ 0 ή αρνητική).
// ==========================================
const CURTAILMENT_PRICE_THRESHOLD = 5; // €/MWh

function getPrevDayLastPrice(dateStr, mcpData, fallback) {
    const prev = new Date(dateStr + 'T00:00:00Z');
    prev.setUTCDate(prev.getUTCDate() - 1);
    const prevStr = prev.toISOString().substring(0, 10);
    const prevRow = mcpData.find(item => {
        const d = item["Ημερομηνία"] || item["date"];
        return d && String(d).substring(0, 10) === prevStr;
    });
    if (!prevRow) return fallback;
    const nPrev = (prevRow['25:00'] !== undefined && prevRow['25:00'] !== null) ? 25 : 24;
    const hours = getMcpHoursFromRow(prevRow, nPrev);
    if (nPrev === 24 && (prevRow['24:00'] === null || prevRow['24:00'] === undefined)) return hours[22]; // ημέρα 23 ωρών
    return hours[nPrev - 1];
}

// Επιστρέφει { 'YYYY-MM-DD': MWh } με τη φόρτιση BESS σε ώρες όπου η (ευθυγραμμισμένη) τιμή MCP <= όριο.
function computeCheapChargeByDate(selectedMonth) {
    const out = {};
    const mcpData = getMcpData();
    const mcpByDate = {};
    mcpData.forEach(item => {
        const d = item["Ημερομηνία"] || item["date"];
        if (d) mcpByDate[String(d).substring(0, 10)] = item;
    });

    getHourlyData().forEach(row => {
        const date = String(row["Ημερομηνία"] || row["date"] || '').substring(0, 10);
        if (!date.startsWith(selectedMonth)) return;
        const mcpRow = mcpByDate[date];
        if (!mcpRow) return; // χωρίς τιμές MCP δεν μπορούμε να ταξινομήσουμε τις ώρες

        const nH = (row['25:00'] !== undefined && row['25:00'] !== null) ? 25 : 24;
        const raw = getMcpHoursFromRow(mcpRow, nH);
        const prices = alignMcpToScadaHours(raw, mcpShiftEnabled ? getPrevDayLastPrice(date, mcpData, raw[0]) : raw[0], mcpShiftEnabled);

        for (let h = 1; h <= nH; h++) {
            const v = parseFloat(row[(h < 10 ? '0' + h : h) + ':00']);
            if (!isNaN(v) && v < 0 && prices[h - 1] <= CURTAILMENT_PRICE_THRESHOLD) {
                out[date] = (out[date] || 0) + (-v);
            }
        }
    });
    return out;
}

// Τιμή που αντιστοιχεί σε κάθε ώρα SCADA. Με shift: ώρα 1 <- τελευταία ώρα προηγούμενης ημέρας, ώρα k <- ώρα k-1.
function alignMcpToScadaHours(mcpHours, prevDayLastPrice, shift) {
    if (!shift) return mcpHours.slice();
    return mcpHours.map((_, i) => (i === 0 ? prevDayLastPrice : mcpHours[i - 1]));
}

// ==========================================
// DATA CLUTTER REDUCTION (Κανόνας 2)
// ==========================================
function formatMWh(val) {
    return Math.round(val).toLocaleString('el-GR');
}

function formatEur(val) {
    return val.toLocaleString('el-GR', { style: 'currency', currency: 'EUR', minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function formatPct(val) {
    return val.toFixed(1) + '%';
}

function getHourlyData() {
    return (typeof rawData !== 'undefined' && rawData && rawData.bessHourly) 
        ? rawData.bessHourly 
        : (window.bessHourlyData || window.rawData?.bessHourly || []);
}

function getMcpData() {
    return (typeof rawData !== 'undefined' && rawData && rawData.mcpHourly) 
        ? rawData.mcpHourly 
        : (window.rawData?.mcpHourly || []);
}

// ==========================================
// SMART DEFAULT SELECTION (Κανόνας 7)
// ==========================================
function initGlobalDates() {
    if (!rawData || !rawData.isp) return;

    const datesSet = new Set();
    rawData.isp.forEach(d => datesSet.add(d.date));
    if (rawData.scada) rawData.scada.forEach(d => datesSet.add(d.date));
    
    const allDates = Array.from(datesSet).sort();
    const dateSelect = document.getElementById('dateSelect');
    const arbSelect = document.getElementById('arbitrageDateSelect');
    
    if (dateSelect) dateSelect.innerHTML = '';
    if (arbSelect) arbSelect.innerHTML = '';

    let latestCompleteDate = null;

    allDates.forEach(date => {
        const hasScada = rawData.scada && rawData.scada.some(d => d.date === date && d.unit === "TOTAL BESS");
        const isPending = !hasScada;
        
        const lang = typeof currentLang !== 'undefined' ? currentLang : 'en';
        const pendingText = lang === 'el' ? ' (Εκκρεμεί SCADA)' : ' (Pending SCADA)';
        const displayText = date + (isPending ? pendingText : '');

        [dateSelect, arbSelect].forEach(select => {
            if (select) {
                let opt = document.createElement('option');
                opt.value = date;
                opt.innerText = displayText;
                opt.dataset.pending = isPending; 
                select.appendChild(opt);
            }
        });

        if (!isPending) {
            latestCompleteDate = date;
        }
    });

    const finalDefault = latestCompleteDate || allDates[allDates.length - 1];
    
    if (dateSelect) dateSelect.value = finalDefault;
    if (arbSelect) arbSelect.value = finalDefault;
}

function updateStatusBadge() {
    const badge = document.getElementById('dataStatusBadge');
    const textEl = document.getElementById('dataStatusText');
    if (!badge || !textEl) return;

    let activeSelect = null;
    if (!document.getElementById('viewDaily').classList.contains('hidden')) {
        activeSelect = document.getElementById('dateSelect');
    } else if (!document.getElementById('viewArbitrage').classList.contains('hidden')) {
        activeSelect = document.getElementById('arbitrageDateSelect');
    }

    if (!activeSelect) {
        badge.classList.add('hidden');
        return;
    }

    badge.classList.remove('hidden');
    const option = activeSelect.options[activeSelect.selectedIndex];
    if (!option) return;

    const isPending = option.dataset.pending === 'true';
    const lang = typeof currentLang !== 'undefined' ? currentLang : 'en';

    if (isPending) {
        badge.className = "flex shrink-0 items-center gap-1.5 px-2 py-0.5 rounded border border-orange-500/30 bg-orange-500/10 text-[10px] md:text-xs font-bold text-orange-400 shadow-sm";
        badge.querySelector('div').className = "w-1.5 h-1.5 md:w-2 md:h-2 rounded-full bg-orange-500 animate-pulse shrink-0";
        textEl.className = "whitespace-nowrap";
        textEl.innerText = lang === 'el' ? 'Pending SCADA' : 'Pending SCADA';
    } else {
        badge.className = "flex shrink-0 items-center gap-1.5 px-2 py-0.5 rounded border border-emerald-500/30 bg-emerald-500/10 text-[10px] md:text-xs font-bold text-emerald-400 shadow-sm";
        badge.querySelector('div').className = "w-1.5 h-1.5 md:w-2 md:h-2 rounded-full bg-emerald-500 shrink-0";
        textEl.className = "whitespace-nowrap";
        textEl.innerText = lang === 'el' ? 'Complete Data' : 'Complete Data';
    }
}

// ==========================================
// 0. TABS SWITCHING (Controller)
// ==========================================
function switchTab(tabName) {
    document.getElementById('viewDaily').classList.add('hidden');
    document.getElementById('viewMonthly').classList.add('hidden');
    document.getElementById('viewSurplus').classList.add('hidden');
    document.getElementById('viewArbitrage').classList.add('hidden');

    const inactiveClass = "w-full text-slate-400 bg-slate-800 border border-slate-700 rounded-xl py-3 px-3 text-center text-sm font-medium hover:bg-slate-700/50 transition-colors shadow-sm md:w-auto md:bg-transparent md:border-0 md:border-b-2 md:border-transparent md:rounded-none md:hover:bg-transparent md:hover:text-emerald-300 md:py-2 md:pb-2 md:px-2 whitespace-nowrap md:shadow-none";

    document.getElementById('tabBtnDaily').className = inactiveClass;
    document.getElementById('tabBtnMonthly').className = inactiveClass;
    document.getElementById('tabBtnSurplus').className = inactiveClass;
    document.getElementById('tabBtnArbitrage').className = inactiveClass;

    document.getElementById('globalDateContainer').classList.remove('flex');
    document.getElementById('globalDateContainer').classList.add('hidden');
    
    document.getElementById('globalMonthContainer').classList.remove('flex');
    document.getElementById('globalMonthContainer').classList.add('hidden');
    
    document.getElementById('globalSurplusContainer').classList.remove('flex');
    document.getElementById('globalSurplusContainer').classList.add('hidden');
    
    document.getElementById('globalArbitrageContainer').classList.remove('flex');
    document.getElementById('globalArbitrageContainer').classList.add('hidden');

    const activeClass = "w-full text-white bg-indigo-600 font-bold border border-transparent rounded-xl py-3 px-3 text-center text-sm transition-colors shadow-md md:w-auto md:text-emerald-400 md:bg-transparent md:border-0 md:border-b-2 md:border-emerald-400 md:rounded-none md:py-2 md:pb-2 md:px-2 whitespace-nowrap md:shadow-none";

    if (tabName === 'daily') {
        document.getElementById('viewDaily').classList.remove('hidden');
        document.getElementById('tabBtnDaily').className = activeClass;
        document.getElementById('globalDateContainer').classList.remove('hidden');
        document.getElementById('globalDateContainer').classList.add('flex');
        
        updateDashboard();
    } else if (tabName === 'monthly') {
        document.getElementById('viewMonthly').classList.remove('hidden');
        document.getElementById('tabBtnMonthly').className = activeClass;
        document.getElementById('globalMonthContainer').classList.remove('hidden');
        document.getElementById('globalMonthContainer').classList.add('flex');
        
        updateMonthlyDashboard();
    } else if (tabName === 'surplus') {
        document.getElementById('viewSurplus').classList.remove('hidden');
        document.getElementById('tabBtnSurplus').className = activeClass;
        document.getElementById('globalSurplusContainer').classList.remove('hidden');
        document.getElementById('globalSurplusContainer').classList.add('flex');
        
        updateSurplusDashboard();
    } else if (tabName === 'arbitrage') {
        document.getElementById('viewArbitrage').classList.remove('hidden');
        document.getElementById('tabBtnArbitrage').className = activeClass;
        document.getElementById('globalArbitrageContainer').classList.remove('hidden');
        document.getElementById('globalArbitrageContainer').classList.add('flex');
        
        renderArbitrageTab();
    }

    updateStatusBadge();
}

// ==========================================
// INTERACTIVE ISOLATION & MOBILE ACCORDION
// ==========================================
function toggleBessIsolation(clickedUnit) {
    if (!arbitrageDualChartInst) return;

    const datasets = arbitrageDualChartInst.data.datasets;
    const safeUnitId = clickedUnit.replace(/\s+/g, '-');
    
    if (currentlyIsolatedBess === clickedUnit) {
        currentlyIsolatedBess = null;
        datasets.forEach((ds, idx) => {
            arbitrageDualChartInst.setDatasetVisibility(idx, true);
        });
        
        document.querySelectorAll('.bess-main-row').forEach(tr => {
            tr.style.opacity = '1';
            const icon = tr.querySelector('.chevron-icon');
            if (icon) icon.classList.remove('rotate-180');
        });
        
        document.querySelectorAll('.bess-expand-row').forEach(tr => {
            tr.classList.add('hidden');
        });
    } else {
        currentlyIsolatedBess = clickedUnit;
        datasets.forEach((ds, idx) => {
            if (ds.yAxisID === 'yMcp') {
                arbitrageDualChartInst.setDatasetVisibility(idx, true);
            } else {
                arbitrageDualChartInst.setDatasetVisibility(idx, ds.label === clickedUnit);
            }
        });
        
        document.querySelectorAll('.bess-main-row').forEach(tr => {
            const icon = tr.querySelector('.chevron-icon');
            if (tr.id === "row-" + safeUnitId) {
                tr.style.opacity = '1';
                if (icon) icon.classList.add('rotate-180');
            } else {
                tr.style.opacity = '0.3';
                if (icon) icon.classList.remove('rotate-180');
            }
        });
        
        document.querySelectorAll('.bess-expand-row').forEach(tr => {
            if (tr.id === "expand-" + safeUnitId) {
                tr.classList.remove('hidden');
                tr.style.opacity = '1'; 
            } else {
                tr.classList.add('hidden');
            }
        });
    }
    arbitrageDualChartInst.update();
}

// ==========================================
// 1. DAILY DASHBOARD
// ==========================================
function updateDashboard() {
    updateStatusBadge();
    const selectedDate = document.getElementById('dateSelect').value;
    if (!selectedDate || !rawData || !rawData.isp || rawData.isp.length === 0) return;

    const ispDay = rawData.isp.filter(d => d.date === selectedDate);
    const scadaDay = rawData.scada.filter(d => d.date === selectedDate);

    const ispTotal = ispDay.find(d => d.unit === "TOTAL BESS") || { charge: 0, discharge: 0, rte: "0.00%" };
    const scadaTotal = scadaDay.find(d => d.unit === "TOTAL BESS") || { charge: 0, discharge: 0, rte: "0.00%" };

    const kpiMap = {
        'kpiChargeIsp': ispTotal.charge,
        'kpiChargeIsp_mob': ispTotal.charge,
        'kpiChargeScada': scadaTotal.charge,
        'kpiChargeScada_mob': scadaTotal.charge,
        'kpiDischargeIsp': ispTotal.discharge,
        'kpiDischargeIsp_mob': ispTotal.discharge,
        'kpiDischargeScada': scadaTotal.discharge,
        'kpiDischargeScada_mob': scadaTotal.discharge
    };

    for (const [id, val] of Object.entries(kpiMap)) {
        const el = document.getElementById(id);
        if (el) el.innerText = formatMWh(val);
    }

    const rteMap = {
        'kpiRteIsp': ispTotal.rte,
        'kpiRteIsp_mob': ispTotal.rte,
        'kpiRteScada': scadaTotal.rte,
        'kpiRteScada_mob': scadaTotal.rte
    };

    for (const [id, val] of Object.entries(rteMap)) {
        const el = document.getElementById(id);
        if (el) el.innerText = val;
    }

    const unitMap = {};
    function getBaseUnitId(name) { return name.toUpperCase().replace(/BZ\d+/g, '').replace(/_/g, ''); }

    ispDay.forEach(d => {
        if (d.unit === "TOTAL BESS") return;
        const id = getBaseUnitId(d.unit);
        if (!unitMap[id]) unitMap[id] = { display: d.unit.replace(/_BZ\d+_/g, '_'), ispDischarge: 0, scadaDischarge: 0, ispCharge: 0, scadaCharge: 0 };
        unitMap[id].ispDischarge += d.discharge;
        unitMap[id].ispCharge += d.charge;
    });

    scadaDay.forEach(d => {
        if (d.unit === "TOTAL BESS") return;
        const id = getBaseUnitId(d.unit);
        if (!unitMap[id]) unitMap[id] = { display: d.unit, ispDischarge: 0, scadaDischarge: 0, ispCharge: 0, scadaCharge: 0 };
        unitMap[id].scadaDischarge += d.discharge;
        unitMap[id].scadaCharge += d.charge;
        unitMap[id].display = d.unit;
    });

    const units = Object.keys(unitMap).sort();
    const labels = units.map(u => unitMap[u].display);
    
    renderDailyCharts(
        labels, 
        units.map(u => unitMap[u].ispDischarge), 
        units.map(u => unitMap[u].scadaDischarge), 
        units.map(u => unitMap[u].ispCharge), 
        units.map(u => unitMap[u].scadaCharge)
    );
}

function renderDailyCharts(labels, ispDischarge, scadaDischarge, ispCharge, scadaCharge) {
    Chart.defaults.color = '#94a3b8';
    Chart.defaults.font.family = 'ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
    
    const tooltipOptions = {
        callbacks: { label: function(ctx) { return formatMWh(ctx.parsed.y) + ' MWh'; } }
    };

    const ctxDischarge = document.getElementById('dischargeChart').getContext('2d');
    if (dischargeChartInst) dischargeChartInst.destroy();
    
    dischargeChartInst = new Chart(ctxDischarge, { 
        type: 'bar', 
        data: { 
            labels: labels, 
            datasets: [
                { label: 'ISP (MWh)', data: ispDischarge, backgroundColor: '#60a5fa', borderRadius: 4 }, 
                { label: 'SCADA (MWh)', data: scadaDischarge, backgroundColor: '#34d399', borderRadius: 4 }
            ] 
        }, 
        options: { 
            responsive: true, maintainAspectRatio: false, 
            plugins: { legend: { position: 'top' }, tooltip: tooltipOptions }, 
            scales: { x: { grid: { display: false } }, y: { grid: { color: '#334155' } } } 
        } 
    });

    const ctxCharge = document.getElementById('chargeChart').getContext('2d');
    if (chargeChartInst) chargeChartInst.destroy();
    
    chargeChartInst = new Chart(ctxCharge, { 
        type: 'bar', 
        data: { 
            labels: labels, 
            datasets: [
                { label: 'ISP (MWh)', data: ispCharge, backgroundColor: '#c084fc', borderRadius: 4 }, 
                { label: 'SCADA (MWh)', data: scadaCharge, backgroundColor: '#fb923c', borderRadius: 4 }
            ] 
        }, 
        options: { 
            responsive: true, maintainAspectRatio: false, 
            plugins: { legend: { position: 'top' }, tooltip: tooltipOptions }, 
            scales: { x: { grid: { display: false } }, y: { grid: { color: '#334155' } } } 
        } 
    });
}

// ==========================================
// 2. MONTHLY DASHBOARD
// ==========================================
function updateMonthlyDashboard() {
    const selectedMonth = document.getElementById('monthSelect').value;
    if (!selectedMonth || !rawData || !rawData.scada || rawData.scada.length === 0) return;

    const monthData = rawData.scada.filter(d => d.date.startsWith(selectedMonth));
    const dailyTotals = {};
    const cheapCharge = computeCheapChargeByDate(selectedMonth);
    
    monthData.forEach(d => {
        if (d.unit === "TOTAL BESS") return;
        if (!dailyTotals[d.date]) dailyTotals[d.date] = { charge: 0, discharge: 0 };
        dailyTotals[d.date].discharge += d.discharge;
    });
    // Φόρτιση = μόνο ώρες με τιμή MCP <= CURTAILMENT_PRICE_THRESHOLD (πιθανή αποφυγή περικοπής)
    Object.keys(dailyTotals).forEach(date => { dailyTotals[date].charge = cheapCharge[date] || 0; });

    const sortedDates = Object.keys(dailyTotals).sort();
    let cumCharge = 0, cumDischarge = 0;
    const labels = [], chargeData = [], dischargeData = [];

    sortedDates.forEach(date => {
        let parts = date.split('-');
        if (parts.length >= 3) labels.push(`${parts[2]}/${parts[1]}`);
        else labels.push(date);
        
        cumCharge += dailyTotals[date].charge;
        cumDischarge += dailyTotals[date].discharge;
        chargeData.push(cumCharge); 
        dischargeData.push(cumDischarge); 
    });

    const strCharge = formatMWh(cumCharge);
    const strDischarge = formatMWh(cumDischarge);

    const kpiChargePc = document.getElementById('kpiMonthlyCharge');
    if (kpiChargePc) kpiChargePc.innerText = strCharge;
    
    const kpiDischargePc = document.getElementById('kpiMonthlyDischarge');
    if (kpiDischargePc) kpiDischargePc.innerText = strDischarge;

    const kpiChargeMob = document.getElementById('kpiMonthlyCharge_mob');
    if (kpiChargeMob) kpiChargeMob.innerText = strCharge;

    const kpiDischargeMob = document.getElementById('kpiMonthlyDischarge_mob');
    if (kpiDischargeMob) kpiDischargeMob.innerText = strDischarge;

    renderMonthlyCharts(labels, chargeData, dischargeData);
}

function renderMonthlyCharts(labels, chargeData, dischargeData) {
    const tooltipOptions = { callbacks: { label: function(ctx) { return formatMWh(ctx.parsed.y) + ' MWh'; } } };

    const ctxDischarge = document.getElementById('monthlyDischargeChart').getContext('2d');
    if (monthlyDischargeChartInst) monthlyDischargeChartInst.destroy();
    
    monthlyDischargeChartInst = new Chart(ctxDischarge, { 
        type: 'line', 
        data: { 
            labels: labels, 
            datasets: [{ 
                label: 'MWh', data: dischargeData, borderColor: '#34d399', 
                backgroundColor: 'rgba(52, 211, 153, 0.2)', fill: true, tension: 0.3, pointRadius: 3, pointBackgroundColor: '#34d399' 
            }] 
        }, 
        options: { 
            responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false }, tooltip: tooltipOptions }, 
            scales: { x: { grid: { display: false } }, y: { grid: { color: '#334155' }, title: { display: true, text: 'MWh' } } } 
        } 
    });

    const ctxCharge = document.getElementById('monthlyChargeChart').getContext('2d');
    if (monthlyChargeChartInst) monthlyChargeChartInst.destroy();
    
    monthlyChargeChartInst = new Chart(ctxCharge, { 
        type: 'line', 
        data: { 
            labels: labels, 
            datasets: [{ 
                label: 'MWh', data: chargeData, borderColor: '#fb923c', 
                backgroundColor: 'rgba(251, 146, 60, 0.2)', fill: true, tension: 0.3, pointRadius: 3, pointBackgroundColor: '#fb923c' 
            }] 
        }, 
        options: { 
            responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false }, tooltip: tooltipOptions }, 
            scales: { x: { grid: { display: false } }, y: { grid: { color: '#334155' }, title: { display: true, text: 'MWh' } } } 
        } 
    });
}

// ==========================================
// 3. SURPLUS DASHBOARD
// ==========================================
function updateSurplusDashboard() {
    const selectedMonth = document.getElementById('monthSelectSurplus').value;
    if (!selectedMonth || !rawData || !rawData.surplus) return;

    const monthScada = rawData.scada ? rawData.scada.filter(d => d.date.startsWith(selectedMonth)) : [];
    const scadaTotals = {};
    monthScada.forEach(d => {
        if (d.unit === "TOTAL BESS") return;
        if (!scadaTotals[d.date]) scadaTotals[d.date] = 0;
        scadaTotals[d.date] += d.charge;
    });

    const monthPump = rawData.pump ? rawData.pump.filter(d => d.date.startsWith(selectedMonth)) : [];
    const pumpTotals = {};
    monthPump.forEach(d => { pumpTotals[d.date] = d.val; });

    const monthSurplus = rawData.surplus.filter(d => d.date.startsWith(selectedMonth));
    const surpTotals = {};
    monthSurplus.forEach(d => { surpTotals[d.date] = d.val; });

    const allDates = [...new Set([...Object.keys(scadaTotals), ...Object.keys(pumpTotals), ...Object.keys(surpTotals)])].sort();
    
    const labels = [];
    const dailyBess = [];
    const dailyPump = [];
    const dailySurp = [];
    
    const cumBess = [];
    const cumPump = [];
    const cumSurp = [];
    
    let runBess = 0, runPump = 0, runSurp = 0;

    allDates.forEach(date => {
        let parts = date.split('-');
        if (parts.length >= 3) labels.push(`${parts[2]}/${parts[1]}`);
        else labels.push(date);

        let bessDay = (scadaTotals[date] || 0);
        let pumpDay = (pumpTotals[date] || 0);
        let surpDay = Math.abs(surpTotals[date] || 0);
        
        dailyBess.push(bessDay);
        dailyPump.push(pumpDay);
        dailySurp.push(surpDay);

        runBess += bessDay;
        runPump += pumpDay;
        runSurp += surpDay;
        
        cumBess.push(runBess);
        cumPump.push(runPump);
        cumSurp.push(runSurp);
    });

    let bessMax = { pct: -1, val: 0, date: '' };
    let bessMin = { pct: 101, val: 0, date: '' };
    let pumpMax = { pct: -1, val: 0, date: '' };
    let pumpMin = { pct: 101, val: 0, date: '' };

    for (let i = 0; i < labels.length; i++) {
        let b = dailyBess[i];
        let p = dailyPump[i];
        let s = dailySurp[i];
        let total = b + p + s;
        let dateLbl = labels[i];

        if (total > 0) {
            let bPct = (b / total) * 100;
            let pPct = (p / total) * 100;

            if (bPct > 0 && bPct < 100) {
                if (bPct > bessMax.pct) { bessMax = { pct: bPct, val: b, date: dateLbl }; }
                if (bPct < bessMin.pct) { bessMin = { pct: bPct, val: b, date: dateLbl }; }
            }
            
            if (pPct > 0 && pPct < 100) {
                if (pPct > pumpMax.pct) { pumpMax = { pct: pPct, val: p, date: dateLbl }; }
                if (pPct < pumpMin.pct) { pumpMin = { pct: pPct, val: p, date: dateLbl }; }
            }
        }
    }

    const populateKPI = (prefix, data) => {
        if (data.pct === -1 || data.pct === 101) {
            document.getElementById(`${prefix}Pct`).innerText = '-';
            document.getElementById(`${prefix}Date`).innerText = '';
            document.getElementById(`${prefix}Mwh`).innerText = '';
        } else {
            document.getElementById(`${prefix}Pct`).innerText = formatPct(data.pct);
            document.getElementById(`${prefix}Date`).innerText = data.date;
            document.getElementById(`${prefix}Mwh`).innerText = formatMWh(data.val) + ' MWh';
        }
    };

    populateKPI('bessBest', bessMax);
    populateKPI('bessWorst', bessMin);
    populateKPI('pumpBest', pumpMax);
    populateKPI('pumpWorst', pumpMin);

    renderSurplusCharts(labels, dailyBess, dailyPump, dailySurp, cumBess, cumPump, cumSurp);
    renderSurplusHourlyProfile();
}


// ==========================================
// ΩΡΙΑΙΟ ΠΡΟΦΙΛ: ΠΛΕΟΝΑΣΜΑ (ISP) vs ΦΟΡΤΙΣΗ BESS & PUMP
// Άξονας x = ώρα ημέρας σε ΕΛΛΗΝΙΚΗ ώρα (L = 0..23, διάστημα [L, L+1)).
//  - SCADA (BESS, PUMP): ώρα h = [h-1, h) τοπικής ώρας  ->  κλειδί h = L+1
//  - Δεδομένα αγοράς (MCP, ISP surplus): ώρα CET. Με ενεργό το checkbox ευθυγράμμισης ισχύει
//    ότι ώρα αγοράς k = τοπική ώρα [k, k+1)  ->  κλειδί k = L (L=0 <- τελευταία ώρα προηγούμενης ημέρας).
// Η παραδοχή ότι το ISP ακολουθεί το ρολόι της αγοράς (όπως το MCP) δεν έχει επιβεβαιωθεί από τεκμηρίωση ΑΔΜΗΕ.
// ==========================================
const SURPLUS_HOUR_MIN_MWH = 1;         // ώρα «πλεονάσματος» αν residual ISP >= 1 MWh
const SURPLUS_HIGH_DAY_PERCENTILE = 0.75;

function hourlyRowToArray(row, nMax) {
    const arr = new Array(nMax).fill(0);
    if (!row) return arr;
    for (let h = 1; h <= nMax; h++) {
        const v = parseFloat(row[(h < 10 ? '0' + h : h) + ':00']);
        arr[h - 1] = isNaN(v) ? 0 : v;
    }
    return arr;
}

function localHourValue(arr, prevArr, L, keyShift) {
    const k = L + 1 - keyShift;           // κλειδί ώρας (1-based)
    if (k >= 1) return arr[k - 1] || 0;
    return prevArr ? (prevArr[prevArr.length - 1] || 0) : 0;
}

function prevDateString(dateStr) {
    const d = new Date(dateStr + 'T00:00:00Z');
    d.setUTCDate(d.getUTCDate() - 1);
    return d.toISOString().substring(0, 10);
}

function renderSurplusHourlyProfile() {
    const monthEl = document.getElementById('monthSelectSurplus');
    const canvas = document.getElementById('surplusHourlyChart');
    if (!monthEl || !canvas || !rawData) return;
    const month = monthEl.value;
    const lang = typeof currentLang !== 'undefined' ? currentLang : 'en';
    const t = (typeof i18n !== 'undefined' && i18n[lang]) ? i18n[lang] : {};
    const mode = (document.getElementById('surplusHourlyMode') || {}).value || 'all';
    const kpiBox = document.getElementById('surplusHourlyKpis');
    const noteEl = document.getElementById('surplusHourlyNote');

    // --- δεδομένα ανά ημερομηνία ---
    const dateOf = r => String(r["Ημερομηνία"] || r["date"] || '').substring(0, 10);
    const bessByDate = {};
    getHourlyData().forEach(r => {
        const date = dateOf(r);
        if (!date) return;
        if (!bessByDate[date]) bessByDate[date] = new Array(25).fill(0);
        for (let h = 1; h <= 25; h++) {
            const v = parseFloat(r[(h < 10 ? '0' + h : h) + ':00']);
            if (!isNaN(v) && v < 0) bessByDate[date][h - 1] += -v; // μόνο φόρτιση
        }
    });
    const pumpByDate = {}, surpByDate = {}, mcpByDate = {};
    (rawData.pumpHourly || []).forEach(r => { pumpByDate[dateOf(r)] = hourlyRowToArray(r, 25); });
    (rawData.surplusHourly || []).forEach(r => { surpByDate[dateOf(r)] = hourlyRowToArray(r, 25); });
    getMcpData().forEach(r => { mcpByDate[dateOf(r)] = getMcpHoursFromRow(r, 24); });

    // Μόνο ημέρες όπου υπάρχουν ΚΑΙ οι τέσσερις πηγές (ώστε οι μέσοι όροι να αφορούν τις ίδιες ημέρες)
    let days = Object.keys(bessByDate).filter(d => d.startsWith(month) && pumpByDate[d] && surpByDate[d] && mcpByDate[d]).sort();

    const resetChart = () => { if (surplusHourlyChartInst) { surplusHourlyChartInst.destroy(); surplusHourlyChartInst = null; } };
    if (days.length === 0) {
        resetChart();
        if (kpiBox) kpiBox.innerHTML = '';
        if (noteEl) noteEl.textContent = t.surplusHourlyEmpty || 'Not enough hourly data for the selected month.';
        return;
    }

    const dayTotal = d => surpByDate[d].reduce((a, b) => a + b, 0);
    let usedDays = days;
    if (mode === 'high' && days.length >= 4) {
        const totals = days.map(dayTotal).sort((a, b) => a - b);
        const thr = totals[Math.min(totals.length - 1, Math.floor(SURPLUS_HIGH_DAY_PERCENTILE * (totals.length - 1)))];
        usedDays = days.filter(d => dayTotal(d) >= thr);
    }

    const marketShift = (typeof mcpShiftEnabled !== 'undefined' && mcpShiftEnabled) ? 1 : 0;
    const n = usedDays.length;
    const bessAvg = new Array(24).fill(0), pumpAvg = new Array(24).fill(0), surpAvg = new Array(24).fill(0), mcpAvg = new Array(24).fill(0);
    let sumBess = 0, sumPump = 0, sumSurp = 0, bessIn = 0, pumpIn = 0;

    usedDays.forEach(d => {
        const prev = prevDateString(d);
        for (let L = 0; L < 24; L++) {
            const b = localHourValue(bessByDate[d], null, L, 0);
            const p = localHourValue(pumpByDate[d], null, L, 0);
            const sv = localHourValue(surpByDate[d], surpByDate[prev], L, marketShift);
            const m = localHourValue(mcpByDate[d], mcpByDate[prev], L, marketShift);
            bessAvg[L] += b / n; pumpAvg[L] += p / n; surpAvg[L] += sv / n; mcpAvg[L] += m / n;
            sumBess += b; sumPump += p; sumSurp += sv;
            if (sv >= SURPLUS_HOUR_MIN_MWH) { bessIn += b; pumpIn += p; }
        }
    });

    // --- KPIs ---
    const fmt = v => (typeof formatMWh === 'function') ? formatMWh(v) : Math.round(v).toLocaleString();
    const pct = v => (isFinite(v) ? v.toFixed(0) + '%' : '–');
    const tile = (label, value, sub, color) => `
        <div class="bg-slate-900/60 border border-slate-700 rounded-lg px-3 py-2">
            <div class="text-[10px] uppercase tracking-wide text-slate-400">${label}</div>
            <div class="text-xl font-bold ${color}">${value}</div>
            <div class="text-[10px] text-slate-500">${sub}</div>
        </div>`;
    const flexPerDay = (sumBess + sumPump) / n;
    if (kpiBox) {
        kpiBox.innerHTML =
            tile(t.surplusHourlyKpiResidual || 'Avg ISP residual / day', fmt(sumSurp / n) + ' MWh', n + (lang === 'el' ? ' ημέρες' : ' days'), 'text-red-400') +
            tile(t.surplusHourlyKpiRatio || 'Flex charging ÷ residual', pct(sumSurp > 0 ? (flexPerDay / (sumSurp / n)) * 100 : NaN), fmt(flexPerDay) + ' MWh / ' + (lang === 'el' ? 'ημέρα' : 'day'), 'text-slate-200') +
            tile(t.surplusHourlyKpiBess || 'BESS in surplus hours', pct(sumBess > 0 ? (bessIn / sumBess) * 100 : NaN), (lang === 'el' ? 'της φόρτισης BESS' : 'of BESS charging'), 'text-emerald-400') +
            tile(t.surplusHourlyKpiPump || 'PUMP in surplus hours', pct(sumPump > 0 ? (pumpIn / sumPump) * 100 : NaN), (lang === 'el' ? 'της φόρτισης PUMP' : 'of PUMP charging'), 'text-blue-400');
    }

    // --- Γράφημα ---
    const labels = []; for (let L = 0; L < 24; L++) labels.push((L < 10 ? '0' + L : L) + ':00');
    resetChart();
    surplusHourlyChartInst = new Chart(canvas.getContext('2d'), {
        data: {
            labels: labels,
            datasets: [
                { type: 'bar', label: 'BESS Charge (SCADA)', data: bessAvg, backgroundColor: '#34d399', stack: 'flex', yAxisID: 'y', order: 3 },
                { type: 'bar', label: 'PUMP Charge (SCADA)', data: pumpAvg, backgroundColor: '#3b82f6', stack: 'flex', yAxisID: 'y', order: 3 },
                { type: 'line', label: 'Residual Surplus (ISP)', data: surpAvg, borderColor: '#ef4444', backgroundColor: 'rgba(239,68,68,0.15)', fill: true, tension: 0.25, pointRadius: 2, yAxisID: 'y', order: 1 },
                { type: 'line', label: (lang === 'el' ? 'Τιμή MCP (€/MWh)' : 'MCP Price (€/MWh)'), data: mcpAvg, borderColor: '#fbbf24', borderDash: [5, 4], borderWidth: 2, pointRadius: 0, tension: 0.2, yAxisID: 'y2', order: 2 },
                { type: 'line', label: (lang === 'el' ? 'Όριο 5 €/MWh' : '€5/MWh threshold'), data: new Array(24).fill(CURTAILMENT_PRICE_THRESHOLD), borderColor: 'rgba(251,191,36,0.45)', borderDash: [2, 3], borderWidth: 1, pointRadius: 0, yAxisID: 'y2', order: 2 }
            ]
        },
        options: {
            responsive: true, maintainAspectRatio: false,
            interaction: { mode: 'index', intersect: false },
            plugins: {
                legend: { position: 'top' },
                tooltip: { callbacks: { label: ctx => ctx.dataset.yAxisID === 'y2' ? `${ctx.dataset.label}: ${ctx.parsed.y.toFixed(1)}` : `${ctx.dataset.label}: ${fmt(ctx.parsed.y)} MWh` } }
            },
            scales: {
                x: { stacked: true, grid: { display: false }, title: { display: true, text: (lang === 'el' ? 'Ώρα ημέρας (ελληνική ώρα)' : 'Hour of day (Greek local time)') } },
                y: { stacked: true, grid: { color: '#334155' }, title: { display: true, text: 'MWh / h' }, beginAtZero: true },
                y2: { position: 'right', grid: { display: false }, title: { display: true, text: '€/MWh' } }
            }
        }
    });

    if (noteEl) {
        const first = usedDays[0], last = usedDays[n - 1];
        noteEl.textContent = (lang === 'el')
            ? `Μέσος όρος ${n} ημερών (${first} έως ${last}), μόνο ημέρες με δεδομένα BESS, PUMP, ISP και MCP. Το ISP είναι προγραμματισμός (όχι μέτρηση) και δεν περιλαμβάνει εξαγωγές. ` +
              (marketShift ? 'Δεδομένα αγοράς (MCP, ISP) και SCADA ευθυγραμμίζονται με μετατόπιση μίας ώρας (CET → ελληνική ώρα), παραδοχή που δεν έχει επιβεβαιωθεί από τον ΑΔΜΗΕ.' : 'Χωρίς μετατόπιση ώρας ανάμεσα σε αγορά και SCADA.')
            : `Average of ${n} days (${first} to ${last}), only days with BESS, PUMP, ISP and MCP data. ISP is a schedule (not a measurement) and excludes exports. ` +
              (marketShift ? 'Market data (MCP, ISP) and SCADA are aligned with a one-hour shift (CET → Greek local time), an assumption not yet confirmed by IPTO.' : 'No hour shift applied between market data and SCADA.');
    }
}

function renderSurplusCharts(labels, dailyBess, dailyPump, dailySurplus, cumBess, cumPump, cumSurplus) {
    const ctxStacked = document.getElementById('surplusStackedChart').getContext('2d');
    if (surplusStackedChartInst) surplusStackedChartInst.destroy();
    
    const lang = typeof currentLang !== 'undefined' ? currentLang : 'en';

    surplusStackedChartInst = new Chart(ctxStacked, {
        type: 'bar',
        data: {
            labels: labels,
            datasets: [
                { label: 'BESS Charge (SCADA)', data: dailyBess, backgroundColor: '#34d399', stack: 'Stack 0' },
                { label: 'PUMP Charge (SCADA)', data: dailyPump, backgroundColor: '#3b82f6', stack: 'Stack 0' },
                { label: 'Residual Surplus (ISP)', data: dailySurplus, backgroundColor: '#ef4444', stack: 'Stack 0' }
            ]
        },
        options: {
            responsive: true, maintainAspectRatio: false,
            plugins: {
                legend: { position: 'top' },
                tooltip: {
                    callbacks: {
                        label: function(ctx) { return formatMWh(ctx.parsed.y) + ' MWh'; },
                        footer: function(tooltipItems) {
                            let idx = tooltipItems[0].dataIndex;
                            let bess = dailyBess[idx];
                            let pump = dailyPump[idx];
                            let surp = dailySurplus[idx];
                            
                            if (surp === 0) {
                                return (lang === 'el') 
                                    ? "Zero ISP Surplus\nΠιθανή καθαρή λειτουργία Market Arbitrage." 
                                    : "Zero ISP Surplus\nPotential pure Market Arbitrage operation.";
                            }
                            
                            let total = bess + pump + surp;
                            let pctBess = formatPct((bess / total) * 100);
                            let pctPump = formatPct((pump / total) * 100);
                            let pctSurp = formatPct((surp / total) * 100);
                            
                            return (lang === 'el') ? 
                                `\n💡 Επίλυση Θεωρητικού Πλεονάσματος:\n- Αντλησιοταμίευση (PUMP): ${pctPump}\n- Μπαταρίες (BESS): ${pctBess}\n- Τελικό Πλεόνασμα (Surplus): ${pctSurp}` :
                                `\n💡 Theoretical Surplus Resolution:\n- Pumped Hydro (PUMP): ${pctPump}\n- Batteries (BESS): ${pctBess}\n- Residual Surplus: ${pctSurp}`;
                        }
                    }
                }
            },
            scales: { 
                x: { stacked: true, grid: { display: false } }, 
                y: { stacked: true, grid: { color: '#334155' }, title: { display: true, text: 'MWh' } } 
            }
        }
    });

    const ctxCum = document.getElementById('surplusCumulativeChart').getContext('2d');
    if (surplusCumulativeChartInst) surplusCumulativeChartInst.destroy();
    
    surplusCumulativeChartInst = new Chart(ctxCum, {
        type: 'line',
        data: {
            labels: labels,
            datasets: [
                { label: 'Cum. BESS Charge', data: cumBess, borderColor: '#34d399', backgroundColor: 'rgba(52, 211, 153, 0.1)', fill: true, tension: 0.3 },
                { label: 'Cum. PUMP Charge', data: cumPump, borderColor: '#3b82f6', backgroundColor: 'rgba(59, 130, 246, 0.1)', fill: true, tension: 0.3 },
                { label: 'Cum. Residual Surplus', data: cumSurplus, borderColor: '#ef4444', backgroundColor: 'transparent', fill: false, tension: 0.3 }
            ]
        },
        options: {
            responsive: true, maintainAspectRatio: false,
            plugins: { 
                legend: { position: 'top' },
                tooltip: { callbacks: { label: function(ctx) { return formatMWh(ctx.parsed.y) + ' MWh'; } } }
            },
            scales: { x: { grid: { display: false } }, y: { grid: { color: '#334155' }, title: { display: true, text: 'MWh' } } }
        }
    });
}

// ==========================================
// 4. ARBITRAGE P&L & HOURLY OPERATIONS
// ==========================================
function renderArbitrageTab() {
    updateStatusBadge();
    currentlyIsolatedBess = null; 

    const select = document.getElementById('arbitrageDateSelect');
    if (!select) return;
    
    const selectedDate = select.value;
    const hourlyData = getHourlyData();
    const mcpData = getMcpData();

    if (!selectedDate || !hourlyData || hourlyData.length === 0) return;

    const lang = typeof currentLang !== 'undefined' ? currentLang : 'en';
    const mcpLegendLabel = (lang === 'en') ? 'MCP Price (€/MWh)' : 'Τιμή MCP (€/MWh)';
    const mcpLegendLabelFinal = mcpLegendLabel + (mcpShiftEnabled ? (lang === 'en' ? ' – SCADA-aligned' : ' – ευθυγραμμισμένη με SCADA') : '');
    const chk = document.getElementById('mcpShiftToggle');
    if (chk) chk.checked = mcpShiftEnabled;
    const shiftLbl = document.getElementById('mcpShiftLabel');
    if (shiftLbl) shiftLbl.textContent = (lang === 'en')
        ? 'Align MCP to SCADA hours (MCP hour h−1 ↔ SCADA hour h)'
        : 'Αντιστοίχιση MCP με ώρες SCADA (ώρα MCP h−1 ↔ ώρα SCADA h)';
    const alignNote = document.getElementById('arbitrageAlignNote');
    if (alignNote) alignNote.textContent = mcpShiftEnabled
        ? ((lang === 'en')
            ? 'The day-ahead delivery day is defined in CET, while SCADA hours follow Greek local time (+1h). Hourly volumes are priced with a one-hour offset, which fits the data better (correlation 0.63 vs 0.58, consistent in every month). Not yet confirmed by IPTO documentation.'
            : 'Η ημέρα παράδοσης της Αγοράς Επόμενης Ημέρας ορίζεται σε CET, ενώ οι ώρες SCADA ακολουθούν την ελληνική ώρα (+1h). Οι ωριαίοι όγκοι αποτιμώνται με μετατόπιση μίας ώρας, που ταιριάζει καλύτερα στα δεδομένα (συσχέτιση 0,63 έναντι 0,58, σταθερά κάθε μήνα). Δεν έχει επιβεβαιωθεί ακόμα από τεκμηρίωση του ΑΔΜΗΕ.')
        : ((lang === 'en')
            ? 'Raw matching: SCADA hour h is priced with MCP hour h, without any offset.'
            : 'Απλή αντιστοίχιση: η ώρα SCADA h αποτιμάται με την ώρα MCP h, χωρίς μετατόπιση.');
    const yBessTitle = (lang === 'en') ? 'BESS Volume (MWh)' : 'Όγκος BESS (MWh)';
    const yMcpTitle = (lang === 'en') ? 'MCP Price (€/MWh)' : 'Τιμή MCP (€/MWh)';
    const hoverTitle = (lang === 'en') ? 'Click to isolate this unit on the chart' : 'Κλικ για να απομονώσεις αυτή τη μονάδα στο γράφημα';

    const dayData = hourlyData.filter(item => {
        let d = item["Ημερομηνία"] || item["date"];
        return d && String(d).substring(0, 10) === selectedDate;
    });

    const nH = dayData.some(r => r['25:00'] !== undefined && r['25:00'] !== null) ? 25 : 24;

    const mcpRow = mcpData.find(item => {
        let d = item["Ημερομηνία"] || item["date"];
        return d && String(d).substring(0, 10) === selectedDate;
    });

    const chartLabels = [];
    for (let h = 1; h <= nH; h++) {
        chartLabels.push((h < 10 ? '0' + h : h) + ':00');
    }

    const dailyMcpRaw = getMcpHoursFromRow(mcpRow, nH);
    let prevDayLast = dailyMcpRaw[0]; // fallback αν δεν υπάρχει προηγούμενη ημέρα
    if (mcpRow && mcpShiftEnabled) {
        const prevDate = new Date(selectedDate + 'T00:00:00Z');
        prevDate.setUTCDate(prevDate.getUTCDate() - 1);
        const prevStr = prevDate.toISOString().substring(0, 10);
        const prevRow = mcpData.find(item => {
            let d = item["Ημερομηνία"] || item["date"];
            return d && String(d).substring(0, 10) === prevStr;
        });
        if (prevRow) {
            const nPrev = (prevRow['25:00'] !== undefined && prevRow['25:00'] !== null) ? 25 : 24;
            const prevHours = getMcpHoursFromRow(prevRow, nPrev);
            prevDayLast = prevHours[nPrev - 1];
            if (nPrev === 24 && (prevRow['24:00'] === null || prevRow['24:00'] === undefined)) prevDayLast = prevHours[22]; // ημέρα 23 ωρών
        }
    }
    const dailyMcp = alignMcpToScadaHours(dailyMcpRaw, prevDayLast, mcpShiftEnabled);

    const datasets = [];
    const colorPalette = ['#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899', '#14b8a6', '#f97316'];
    let colorIdx = 0;
    const pnlSummary = {};

    dayData.forEach(row => {
        const unitName = row["Μονάδα BESS"] || row["unit"];
        if (!unitName || unitName === "TOTAL BESS") return;

        const dataPoints = [];
        let totalChargeMWh = 0;
        let totalDischargeMWh = 0;
        let dailyRevenue = 0;
        let dailyCost = 0;

        for (let h = 1; h <= nH; h++) {
            let key1 = h + ':00';                     
            let key2 = (h < 10 ? '0' + h : h) + ':00'; 
            let key3 = key1 + ':00';                   
            let key4 = key2 + ':00';                   
            
            let rawVal = row[key1] ?? row[key2] ?? row[key3] ?? row[key4] ?? 0;
            const val = parseFloat(String(rawVal).replace(',', '.')) || 0;
            dataPoints.push(val);
            
            const currentMcp = dailyMcp[h-1];

            if (val < 0) {
                let chargeVol = Math.abs(val);
                totalChargeMWh += chargeVol;
                dailyCost += (chargeVol * currentMcp);
            }
            if (val > 0) {
                totalDischargeMWh += val;
                dailyRevenue += (val * currentMcp);
            }
        }

        const rte = totalChargeMWh > 0 ? (totalDischargeMWh / totalChargeMWh) * 100 : 0;
        let actualDailyPnl = dailyRevenue - dailyCost; 
        let unitProfit = totalDischargeMWh > 0 ? actualDailyPnl / totalDischargeMWh : 0;

        pnlSummary[unitName] = {
            charge: totalChargeMWh,
            discharge: totalDischargeMWh,
            rte: rte,
            pnl: actualDailyPnl,
            unitProfit: unitProfit,
            color: colorPalette[colorIdx % colorPalette.length]
        };

        datasets.push({
            label: unitName,
            data: dataPoints,
            backgroundColor: colorPalette[colorIdx % colorPalette.length],
            stack: 'bessStack',
            borderRadius: 2,
            type: 'bar',
            yAxisID: 'y'
        });
        colorIdx++;
    });

    if (mcpRow) {
        datasets.push({
            label: mcpLegendLabelFinal,
            data: dailyMcp,
            borderColor: '#eab308', 
            backgroundColor: '#eab308',
            type: 'line',
            borderWidth: 2,
            pointRadius: 2,
            fill: false,
            yAxisID: 'yMcp'
        });
    }

    const canvasCtx = document.getElementById('arbitrageDualChart');
    if (!canvasCtx) return;
    const ctx = canvasCtx.getContext('2d');
    
    if (arbitrageDualChartInst) arbitrageDualChartInst.destroy();

    arbitrageDualChartInst = new Chart(ctx, {
        type: 'bar',
        data: { labels: chartLabels, datasets: datasets },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            scales: {
                x: { stacked: true, grid: { display: false } },
                y: { 
                    stacked: true, 
                    grid: { color: '#334155' }, 
                    title: { display: true, text: yBessTitle },
                    position: 'left'
                },
                yMcp: {
                    type: 'linear',
                    display: true,
                    position: 'right',
                    grid: { display: false },
                    title: { display: true, text: yMcpTitle, color: '#eab308' },
                    ticks: { color: '#eab308' }
                }
            },
            plugins: { 
                legend: { position: 'top' },
                tooltip: {
                    callbacks: {
                        label: function(context) {
                            let label = context.dataset.label || '';
                            if (label) label += ': ';
                            if (context.dataset.yAxisID === 'yMcp') {
                                label += formatEur(context.parsed.y) + ' / MWh';
                            } else {
                                label += formatMWh(context.parsed.y) + ' MWh';
                            }
                            return label;
                        }
                    }
                } 
            }
        }
    });

    const tbody = document.getElementById('arbitrageTableBody');
    if (tbody) {
        tbody.innerHTML = '';
        Object.keys(pnlSummary).forEach(unit => {
            const item = pnlSummary[unit];
            const safeUnitId = unit.replace(/\s+/g, '-');
            
            let rteColorClass = "text-slate-300"; 
            let rteTooltip = (lang === 'en') ? "Normal RTE levels." : "Φυσιολογικά επίπεδα απόδοσης (RTE).";
            
            if (item.rte > 0 && item.rte < 83) {
                rteColorClass = "text-yellow-400 font-bold";
                rteTooltip = (lang === 'en') ? "Low RTE (<83%): Possible SoC carryover for next day use or high auxiliary consumption." : "Χαμηλό RTE (<83%): Πιθανή διατήρηση αποθέματος (SoC) για χρήση την επόμενη ημέρα ή υψηλές ιδιοκαταναλώσεις.";
            } else if (item.rte > 92) {
                rteColorClass = "text-rose-500 font-bold";
                rteTooltip = (lang === 'en') ? "Unrealistic RTE (>92%): Discharging energy stored yesterday (SoC Carryover) or SCADA error." : "Μη ρεαλιστικό RTE (>92%): Εκφόρτιση ενέργειας που είχε αποθηκευτεί χθες (SoC Carryover) ή σφάλμα SCADA.";
            } else if (item.rte === 0) {
                rteColorClass = "text-slate-500";
                rteTooltip = (lang === 'en') ? "Zero cycle activity." : "Μηδενική δραστηριότητα κύκλου.";
            }
            
            const trMain = document.createElement('tr');
            trMain.className = "bess-main-row hover:bg-slate-700/50 transition-all cursor-pointer group";
            trMain.id = "row-" + safeUnitId;
            
            trMain.innerHTML = `
                <td class="p-3 text-left" style="border-left: 4px solid transparent;" onmouseover="this.style.borderLeftColor='${item.color}'" onmouseout="if(currentlyIsolatedBess !== '${unit}') this.style.borderLeftColor='transparent'">
                    <div class="flex items-center justify-between font-bold text-slate-300 group-hover:text-white transition-colors" title="${hoverTitle}">
                        <span>${unit}</span>
                        <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4 md:hidden text-slate-500 transition-transform duration-300 chevron-icon" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7" />
                        </svg>
                    </div>
                </td>
                <td class="p-3 text-right">${formatMWh(item.charge)}</td>
                <td class="p-3 text-right">${formatMWh(item.discharge)}</td>
                <td class="p-3 hidden md:table-cell text-right">
                    <span class="${rteColorClass} cursor-help border-b border-dotted border-slate-500" title="${rteTooltip}">
                        ${formatPct(item.rte)}
                    </span>
                </td>
                <td class="p-3 font-semibold hidden md:table-cell text-right ${item.pnl >= 0 ? 'text-emerald-400' : 'text-rose-400'}">${formatEur(item.pnl)}</td>
                <td class="p-3 hidden md:table-cell text-right">${formatEur(item.unitProfit)} / MWh</td>
            `;
            
            trMain.onclick = () => toggleBessIsolation(unit);
            tbody.appendChild(trMain);

            const trExpand = document.createElement('tr');
            trExpand.className = "bess-expand-row hidden md:hidden bg-slate-800/30";
            trExpand.id = "expand-" + safeUnitId;

            trExpand.innerHTML = `
                <td colspan="3" class="p-0 border-t-0">
                    <div class="flex flex-col bg-slate-900/40" style="border-left: 4px solid ${item.color};">
                        
                        <div class="flex justify-between items-center py-3 px-4 border-b border-slate-700/50">
                            <span class="text-[11px] font-bold text-slate-500 uppercase tracking-wider">RTE</span>
                            <span class="${rteColorClass} text-sm font-semibold cursor-help" title="${rteTooltip}">${formatPct(item.rte)}</span>
                        </div>
                        
                        <div class="flex justify-between items-center py-3 px-4 border-b border-slate-700/50">
                            <span class="text-[11px] font-bold text-slate-500 uppercase tracking-wider">Potential Daily P&L</span>
                            <span class="text-sm font-bold ${item.pnl >= 0 ? 'text-emerald-400' : 'text-rose-400'}">${formatEur(item.pnl)}</span>
                        </div>
                        
                        <div class="flex justify-between items-center py-3 px-4">
                            <span class="text-[11px] font-bold text-slate-500 uppercase tracking-wider">Profit / MWh</span>
                            <span class="text-sm font-bold text-yellow-400">${formatEur(item.unitProfit)}</span>
                        </div>

                    </div>
                </td>
            `;
            
            trExpand.onclick = () => toggleBessIsolation(unit);
            tbody.appendChild(trExpand);
        });
    }
}

// ==========================================
// NEO INITIALIZATION & WATERFALL LOADING UI 
// ==========================================

function animateStep(stepNum, nextAction) {
    const row = document.getElementById(`loadRow${stepNum}`);
    const bar = document.getElementById(`loadBar${stepNum}`);
    const pct = document.getElementById(`loadPct${stepNum}`);
    
    // Εμφάνιση της σειράς
    if (row) row.classList.remove('opacity-0');
    
    // Μικρή καθυστέρηση για να παίξει το CSS transition
    setTimeout(() => {
        if (bar) bar.style.width = '100%'; // Η μπάρα αρχίζει να γεμίζει (css duration 300ms)
        
        // Counter από 0 έως 100
        let start = 0;
        const interval = setInterval(() => {
            start += 12; // Ταχύτητα γεμίσματος
            if (start >= 100) {
                start = 100;
                clearInterval(interval);
                
                // Μόλις φτάσει 100%, βάζουμε πράσινο χρώμα και SVG checkmark (τικ)
                if (pct) {
                    pct.innerHTML = `<svg class="w-3.5 h-3.5 text-emerald-400 inline" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="3" d="M5 13l4 4L19 7" /></svg>`;
                }
                if (bar) {
                    if(stepNum === 1) bar.classList.replace('bg-blue-500', 'bg-emerald-500');
                    else bar.classList.replace('bg-purple-500', 'bg-emerald-500');
                }
            } else {
                if (pct) pct.innerText = start + '%';
            }
        }, 30); // Ανανέωση νούμερου κάθε 30ms (συνολικά ~250ms)
        
        // Πάμε στο επόμενο βήμα μετά από 500ms
        setTimeout(() => {
            if (nextAction) nextAction();
        }, 500);
        
    }, 50);
}

window.addEventListener('load', () => {

    // Ασφαλής ρύθμιση γλώσσας
    try {
        if (typeof setLang === 'function') setLang('en');
    } catch (err) {
        console.warn('Αποτυχία φόρτωσης μετάφρασης:', err);
    }

    // Καθυστερούμε λιγάκι για να είμαστε σίγουροι ότι "ζωγραφίστηκε" το modal στην οθόνη
    setTimeout(() => {
        
        // ΒΗΜΑ 1: Data Files
        animateStep(1, () => {
            
            // Τρέχουμε τους υπολογισμούς στο background τώρα (Daily)
            try { initGlobalDates(); switchTab('daily'); } catch (e) { console.error(e); }
            
            // ΒΗΜΑ 2: Daily Analytics
            animateStep(2, () => {
                
                // Υπολογισμοί background (Monthly)
                try {
                    const mSelect = document.getElementById('monthSelect');
                    if (mSelect && rawData && rawData.scada) {
                        const mSet = new Set();
                        rawData.scada.forEach(d => { if (d.date) mSet.add(d.date.substring(0, 7)); });
                        const months = [...mSet].sort();
                        mSelect.innerHTML = '';
                        months.forEach(m => mSelect.appendChild(new Option(m, m)));
                        if (months.length > 0) mSelect.value = months[months.length - 1];
                    }
                } catch (e) { console.error(e); }

                // ΒΗΜΑ 3: Monthly Impact
                animateStep(3, () => {
                    
                    // Υπολογισμοί background (Surplus)
                    try {
                        const msSelect = document.getElementById('monthSelectSurplus');
                        if (msSelect && rawData && rawData.surplus) {
                            const mSet = new Set();
                            rawData.surplus.forEach(d => { if (d.date) mSet.add(d.date.substring(0, 7)); });
                            const months = [...mSet].sort();
                            msSelect.innerHTML = '';
                            months.forEach(m => msSelect.appendChild(new Option(m, m)));
                            if (months.length > 0) msSelect.value = months[months.length - 1];
                        }
                    } catch (e) { console.error(e); }

                    // ΒΗΜΑ 4: Surplus & Flex
                    animateStep(4, () => {
                        
                        // ΒΗΜΑ 5: Arbitrage P&L
                        animateStep(5, () => {
                            
                            // ΒΗΜΑ 6: Dashboard is Ready!
                            const row6 = document.getElementById('loadRow6');
                            const spinner = document.getElementById('mainSpinner');
                            
                            if (spinner) spinner.classList.add('hidden'); // Κρύβουμε το spinner
                            
                            if (row6) {
                                row6.classList.remove('opacity-0', 'translate-y-2');
                                row6.classList.add('opacity-100', 'translate-y-0');
                            }
                            
                            // Περιμένουμε λίγο να το δει ο χρήστης και σβήνουμε το Overlay
                            setTimeout(() => {
                                const overlay = document.getElementById('loading-overlay');
                                if (overlay) {
                                    overlay.classList.add('opacity-0');
                                    setTimeout(() => overlay.style.display = 'none', 500); 
                                }
                            }, 800);
                            
                        }); // Τέλος 5
                    }); // Τέλος 4
                }); // Τέλος 3
            }); // Τέλος 2
        }); // Τέλος 1
    }, 200); // Αρχική καθυστέρηση
});
