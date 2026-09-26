// ==========================================
// GLOBAL CHART INSTANCES & STATE
// ==========================================
let dischargeChartInst = null;
let chargeChartInst = null;
let monthlyDischargeChartInst = null;
let monthlyChargeChartInst = null;
let surplusStackedChartInst = null;
let surplusCumulativeChartInst = null;
let arbitrageDualChartInst = null;

let currentlyIsolatedBess = null;

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

    // Εδώ προστέθηκαν οι κλάσεις shrink-0, whitespace-normal, και max-w-[60px] που ελέγχουν την αναδίπλωση!
    if (isPending) {
        badge.className = "flex shrink-0 items-center gap-1.5 px-2 py-1 rounded border border-orange-500/30 bg-orange-500/10 text-[10px] md:text-xs font-bold text-orange-400 shadow-sm";
        badge.querySelector('div').className = "w-1.5 h-1.5 md:w-2 md:h-2 rounded-full bg-orange-500 animate-pulse shrink-0";
        textEl.className = "text-center leading-tight max-w-[60px] md:max-w-none whitespace-normal";
        textEl.innerText = lang === 'el' ? 'Pending SCADA' : 'Pending SCADA';
    } else {
        badge.className = "flex shrink-0 items-center gap-1.5 px-2 py-1 rounded border border-emerald-500/30 bg-emerald-500/10 text-[10px] md:text-xs font-bold text-emerald-400 shadow-sm";
        badge.querySelector('div').className = "w-1.5 h-1.5 md:w-2 md:h-2 rounded-full bg-emerald-500 shrink-0";
        textEl.className = "text-center leading-tight max-w-[60px] md:max-w-none whitespace-normal";
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
// INTERACTIVE ISOLATION FOR ARBITRAGE
// ==========================================
function toggleBessIsolation(clickedUnit) {
    if (!arbitrageDualChartInst) return;

    const datasets = arbitrageDualChartInst.data.datasets;
    
    if (currentlyIsolatedBess === clickedUnit) {
        currentlyIsolatedBess = null;
        datasets.forEach((ds, idx) => {
            arbitrageDualChartInst.setDatasetVisibility(idx, true);
        });
        document.querySelectorAll('#arbitrageTableBody tr').forEach(tr => {
            tr.style.opacity = '1';
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
        document.querySelectorAll('#arbitrageTableBody tr').forEach(tr => {
            if (tr.id === "row-" + clickedUnit.replace(/\s+/g, '-')) {
                tr.style.opacity = '1';
            } else {
                tr.style.opacity = '0.3';
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

    document.getElementById('kpiChargeIsp').innerText = formatMWh(ispTotal.charge);
    document.getElementById('kpiChargeIsp').nextElementSibling.innerText = "MWh";
    document.getElementById('kpiChargeScada').innerText = formatMWh(scadaTotal.charge);
    document.getElementById('kpiChargeScada').nextElementSibling.innerText = "MWh";
    document.getElementById('kpiDischargeIsp').innerText = formatMWh(ispTotal.discharge);
    document.getElementById('kpiDischargeIsp').nextElementSibling.innerText = "MWh";
    document.getElementById('kpiDischargeScada').innerText = formatMWh(scadaTotal.discharge);
    document.getElementById('kpiDischargeScada').nextElementSibling.innerText = "MWh";

    document.getElementById('kpiRteIsp').innerText = ispTotal.rte;
    document.getElementById('kpiRteScada').innerText = scadaTotal.rte;

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
    
    monthData.forEach(d => {
        if (d.unit === "TOTAL BESS") return;
        if (!dailyTotals[d.date]) dailyTotals[d.date] = { charge: 0, discharge: 0 };
        dailyTotals[d.date].charge += d.charge;
        dailyTotals[d.date].discharge += d.discharge;
    });

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

    document.getElementById('kpiMonthlyCharge').innerText = formatMWh(cumCharge);
    document.getElementById('kpiMonthlyCharge').nextElementSibling.innerText = "MWh";
    document.getElementById('kpiMonthlyDischarge').innerText = formatMWh(cumDischarge);
    document.getElementById('kpiMonthlyDischarge').nextElementSibling.innerText = "MWh";

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
    const yBessTitle = (lang === 'en') ? 'BESS Volume (MWh)' : 'Όγκος BESS (MWh)';
    const yMcpTitle = (lang === 'en') ? 'MCP Price (€/MWh)' : 'Τιμή MCP (€/MWh)';
    const hoverTitle = (lang === 'en') ? 'Click to isolate this unit on the chart' : 'Κλικ για να απομονώσεις αυτή τη μονάδα στο γράφημα';

    const dayData = hourlyData.filter(item => {
        let d = item["Ημερομηνία"] || item["date"];
        return d && String(d).substring(0, 10) === selectedDate;
    });

    let dailyMcp = new Array(24).fill(0);
    const mcpRow = mcpData.find(item => {
        let d = item["Ημερομηνία"] || item["date"];
        return d && String(d).substring(0, 10) === selectedDate;
    });
    
    const chartLabels = [];
    for (let h = 1; h <= 24; h++) {
        let padHour = (h < 10 ? '0' + h : h) + ':00';
        chartLabels.push(padHour);
    }

    if (mcpRow) {
        for (let h = 1; h <= 24; h++) {
            let startT = (h - 1) * 4 + 1;
            if (mcpRow['T' + startT] !== undefined) {
                let q1 = parseFloat(mcpRow['T' + startT]) || 0;
                let q2 = parseFloat(mcpRow['T' + (startT + 1)]) || 0;
                let q3 = parseFloat(mcpRow['T' + (startT + 2)]) || 0;
                let q4 = parseFloat(mcpRow['T' + (startT + 3)]) || 0;
                dailyMcp[h-1] = (q1 + q2 + q3 + q4) / 4;
            } else {
                let k = h + ':00';
                dailyMcp[h-1] = parseFloat(String(mcpRow[k]).replace(',', '.')) || 0;
            }
        }
    }

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

        for (let h = 1; h <= 24; h++) {
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
            label: mcpLegendLabel,
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
            const tr = document.createElement('tr');
            
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
            
            tr.className = "hover:bg-slate-700/50 transition-all cursor-pointer group";
            tr.id = "row-" + unit.replace(/\s+/g, '-');
            
            tr.innerHTML = `
                <td class="p-3 font-bold text-slate-300 group-hover:text-white transition-colors" title="${hoverTitle}" style="border-left: 4px solid transparent;" onmouseover="this.style.borderLeftColor='${item.color}'" onmouseout="this.style.borderLeftColor='transparent'">${unit}</td>
                <td class="p-3">${formatMWh(item.charge)}</td>
                <td class="p-3">${formatMWh(item.discharge)}</td>
                <td class="p-3">
                    <span class="${rteColorClass} cursor-help border-b border-dotted border-slate-500" title="${rteTooltip}">
                        ${formatPct(item.rte)}
                    </span>
                </td>
                <td class="p-3 font-semibold ${item.pnl >= 0 ? 'text-emerald-400' : 'text-rose-400'}">${formatEur(item.pnl)}</td>
                <td class="p-3">${formatEur(item.unitProfit)} / MWh</td>
            `;
            
            tr.onclick = () => toggleBessIsolation(unit);
            tbody.appendChild(tr);
        });
    }
}

// ==========================================
// INITIALIZATION & PROGRESS LOADING SCREEN 
// ==========================================
window.addEventListener('load', () => {

    try {
        if (typeof setLang === 'function') setLang('en');
    } catch (err) {
        console.warn('Αποτυχία φόρτωσης μετάφρασης κατά την εκκίνηση:', err);
    }

    const bar = document.getElementById('loading-progress-bar');
    const pct = document.getElementById('loading-percentage');
    const sub = document.getElementById('loading-subtitle');
    const overlay = document.getElementById('loading-overlay');

    function updateProgress(percent, text) {
        if (bar) bar.style.width = percent + '%';
        if (pct) pct.innerText = percent + '%';
        if (sub) sub.innerText = text;
    }

    updateProgress(15, 'Reading data files...');

    setTimeout(() => {
        try {
            updateProgress(40, 'Calculating Daily Analytics & KPIs...');
            initGlobalDates();
            switchTab('daily');
        } catch (e) { console.error(e); }

        setTimeout(() => {
            try {
                updateProgress(70, 'Processing Monthly & Flexibility Data...');
                
                const mSelect = document.getElementById('monthSelect');
                if (mSelect && rawData && rawData.scada) {
                    const monthsSet = new Set();
                    rawData.scada.forEach(d => { if (d.date) monthsSet.add(d.date.substring(0, 7)); });
                    const months = [...monthsSet].sort();
                    mSelect.innerHTML = '';
                    months.forEach(m => {
                        let opt = document.createElement('option');
                        opt.value = m; opt.innerText = m;
                        mSelect.appendChild(opt);
                    });
                    if (months.length > 0) mSelect.value = months[months.length - 1];
                }

                const mSelectSurp = document.getElementById('monthSelectSurplus');
                if (mSelectSurp && rawData && rawData.surplus) {
                    const monthsSet = new Set();
                    rawData.surplus.forEach(d => { if (d.date) monthsSet.add(d.date.substring(0, 7)); });
                    const months = [...monthsSet].sort();
                    mSelectSurp.innerHTML = '';
                    months.forEach(m => {
                        let opt = document.createElement('option');
                        opt.value = m; opt.innerText = m;
                        mSelectSurp.appendChild(opt);
                    });
                    if (months.length > 0) mSelectSurp.value = months[months.length - 1];
                }
            } catch (e) { console.error(e); }

            setTimeout(() => {
                updateProgress(100, 'Dashboard is ready!');
                setTimeout(() => {
                    if (overlay) {
                        overlay.classList.add('opacity-0');
                        setTimeout(() => { overlay.style.display = 'none'; }, 500); 
                    }
                }, 500); 
            }, 500); 
        }, 500); 
    }, 500); 
});
