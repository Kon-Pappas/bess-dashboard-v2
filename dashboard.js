// ==========================================
// GLOBAL CHART INSTANCES
// ==========================================
let dischargeChartInst = null;
let chargeChartInst = null;
let monthlyDischargeChartInst = null;
let monthlyChargeChartInst = null;
let surplusStackedChartInst = null;
let surplusCumulativeChartInst = null;
let arbitrageDualChartInst = null;

// Μεταβλητή για να θυμόμαστε ποια BESS είναι "απομονωμένη"
let currentlyIsolatedBess = null;

// ==========================================
// HELPERS
// ==========================================
function formatGWh(mwh) {
    let gwh = mwh / 1000;
    return gwh < 1 ? gwh.toFixed(3) : gwh.toFixed(2);
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
// 0. TABS SWITCHING (Controller)
// ==========================================
function switchTab(tabName) {
    document.getElementById('viewDaily').classList.add('hidden');
    document.getElementById('viewMonthly').classList.add('hidden');
    document.getElementById('viewSurplus').classList.add('hidden');
    document.getElementById('viewArbitrage').classList.add('hidden');

    const inactiveClass = "text-slate-500 hover:text-emerald-300 pb-2 px-2 transition whitespace-nowrap";
    document.getElementById('tabBtnDaily').className = inactiveClass;
    document.getElementById('tabBtnMonthly').className = inactiveClass;
    document.getElementById('tabBtnSurplus').className = inactiveClass;
    document.getElementById('tabBtnArbitrage').className = inactiveClass;

    const activeClass = "text-emerald-400 font-bold border-b-2 border-emerald-400 pb-2 px-2 transition whitespace-nowrap";

    if (tabName === 'daily') {
        document.getElementById('viewDaily').classList.remove('hidden');
        document.getElementById('tabBtnDaily').className = activeClass;
        updateDashboard();
    } else if (tabName === 'monthly') {
        document.getElementById('viewMonthly').classList.remove('hidden');
        document.getElementById('tabBtnMonthly').className = activeClass;
        updateMonthlyDashboard();
    } else if (tabName === 'surplus') {
        document.getElementById('viewSurplus').classList.remove('hidden');
        document.getElementById('tabBtnSurplus').className = activeClass;
        updateSurplusDashboard();
    } else if (tabName === 'arbitrage') {
        document.getElementById('viewArbitrage').classList.remove('hidden');
        document.getElementById('tabBtnArbitrage').className = activeClass;
        initArbitrageTab();
    }
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
    const selectedDate = document.getElementById('dateSelect').value;
    if (!selectedDate || !rawData || !rawData.isp || rawData.isp.length === 0) return;

    const ispDay = rawData.isp.filter(d => d.date === selectedDate);
    const scadaDay = rawData.scada.filter(d => d.date === selectedDate);

    const ispTotal = ispDay.find(d => d.unit === "TOTAL BESS") || { charge: 0, discharge: 0, rte: "0.00%" };
    const scadaTotal = scadaDay.find(d => d.unit === "TOTAL BESS") || { charge: 0, discharge: 0, rte: "0.00%" };

    document.getElementById('kpiChargeIsp').innerText = formatGWh(ispTotal.charge);
    document.getElementById('kpiChargeScada').innerText = formatGWh(scadaTotal.charge);
    document.getElementById('kpiDischargeIsp').innerText = formatGWh(ispTotal.discharge);
    document.getElementById('kpiDischargeScada').innerText = formatGWh(scadaTotal.discharge);
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
            plugins: { legend: { position: 'top' } }, 
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
            plugins: { legend: { position: 'top' } }, 
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
        chargeData.push(cumCharge / 1000); 
        dischargeData.push(cumDischarge / 1000); 
    });

    document.getElementById('kpiMonthlyCharge').innerText = formatGWh(cumCharge);
    document.getElementById('kpiMonthlyDischarge').innerText = formatGWh(cumDischarge);

    renderMonthlyCharts(labels, chargeData, dischargeData);
}

function renderMonthlyCharts(labels, chargeData, dischargeData) {
    const ctxDischarge = document.getElementById('monthlyDischargeChart').getContext('2d');
    if (monthlyDischargeChartInst) monthlyDischargeChartInst.destroy();
    
    monthlyDischargeChartInst = new Chart(ctxDischarge, { 
        type: 'line', 
        data: { 
            labels: labels, 
            datasets: [{ 
                label: 'GWh', data: dischargeData, borderColor: '#34d399', 
                backgroundColor: 'rgba(52, 211, 153, 0.2)', fill: true, tension: 0.3, pointRadius: 3, pointBackgroundColor: '#34d399' 
            }] 
        }, 
        options: { 
            responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } }, 
            scales: { x: { grid: { display: false } }, y: { grid: { color: '#334155' }, title: { display: true, text: 'GWh' } } } 
        } 
    });

    const ctxCharge = document.getElementById('monthlyChargeChart').getContext('2d');
    if (monthlyChargeChartInst) monthlyChargeChartInst.destroy();
    
    monthlyChargeChartInst = new Chart(ctxCharge, { 
        type: 'line', 
        data: { 
            labels: labels, 
            datasets: [{ 
                label: 'GWh', data: chargeData, borderColor: '#fb923c', 
                backgroundColor: 'rgba(251, 146, 60, 0.2)', fill: true, tension: 0.3, pointRadius: 3, pointBackgroundColor: '#fb923c' 
            }] 
        }, 
        options: { 
            responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } }, 
            scales: { x: { grid: { display: false } }, y: { grid: { color: '#334155' }, title: { display: true, text: 'GWh' } } } 
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
    const dailyBessGWh = [];
    const dailyPumpGWh = [];
    const dailySurpGWh = [];
    
    const cumBessGWh = [];
    const cumPumpGWh = [];
    const cumSurpGWh = [];
    
    let runBess = 0, runPump = 0, runSurp = 0;

    allDates.forEach(date => {
        let parts = date.split('-');
        if (parts.length >= 3) labels.push(`${parts[2]}/${parts[1]}`);
        else labels.push(date);

        let bessDay = (scadaTotals[date] || 0) / 1000;
        let pumpDay = (pumpTotals[date] || 0) / 1000;
        let surpDay = Math.abs(surpTotals[date] || 0) / 1000;
        
        dailyBessGWh.push(bessDay);
        dailyPumpGWh.push(pumpDay);
        dailySurpGWh.push(surpDay);

        runBess += bessDay;
        runPump += pumpDay;
        runSurp += surpDay;
        
        cumBessGWh.push(runBess);
        cumPumpGWh.push(runPump);
        cumSurpGWh.push(runSurp);
    });

    renderSurplusCharts(labels, dailyBessGWh, dailyPumpGWh, dailySurpGWh, cumBessGWh, cumPumpGWh, cumSurpGWh);
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
                            let pctBess = ((bess / total) * 100).toFixed(1);
                            let pctPump = ((pump / total) * 100).toFixed(1);
                            let pctSurp = ((surp / total) * 100).toFixed(1);
                            
                            return (lang === 'el') ? 
                                `\n💡 Επίλυση Θεωρητικού Πλεονάσματος:\n- Αντλησιοταμίευση (PUMP): ${pctPump}%\n- Μπαταρίες (BESS): ${pctBess}%\n- Τελικό Πλεόνασμα (Surplus): ${pctSurp}%` :
                                `\n💡 Theoretical Surplus Resolution:\n- Pumped Hydro (PUMP): ${pctPump}%\n- Batteries (BESS): ${pctBess}%\n- Residual Surplus: ${pctSurp}%`;
                        }
                    }
                }
            },
            scales: { 
                x: { stacked: true, grid: { display: false } }, 
                y: { stacked: true, grid: { color: '#334155' }, title: { display: true, text: 'GWh' } } 
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
            plugins: { legend: { position: 'top' } },
            scales: { x: { grid: { display: false } }, y: { grid: { color: '#334155' }, title: { display: true, text: 'GWh' } } }
        }
    });
}

// ==========================================
// 4. ARBITRAGE P&L & HOURLY OPERATIONS
// ==========================================
function initArbitrageTab() {
    const select = document.getElementById('arbitrageDateSelect');
    if (!select) return;

    const hourlyData = getHourlyData();

    if (!hourlyData || hourlyData.length === 0) {
        select.innerHTML = '<option value="">Loading data...</option>';
        setTimeout(initArbitrageTab, 1000);
        return;
    }

    if (select.options.length <= 1 || select.options[0].text === "Loading data..." || select.options[0].text === "Φόρτωση δεδομένων...") {
        const datesSet = new Set();
        
        hourlyData.forEach(item => {
            let rawDate = item["Ημερομηνία"] || item["date"];
            if (rawDate) {
                if (rawDate instanceof Date) {
                    rawDate = rawDate.toISOString().split('T')[0];
                } else {
                    rawDate = String(rawDate).split('T')[0].trim();
                }
                datesSet.add(rawDate);
            }
        });

        const dates = [...datesSet].sort();

        select.innerHTML = '';
        dates.forEach(d => {
            let opt = document.createElement('option');
            opt.value = d;
            opt.innerText = d;
            select.appendChild(opt);
        });

        if (dates.length > 0) {
            select.value = dates[dates.length - 1];
        }
    }
    renderArbitrageTab();
}

function renderArbitrageTab() {
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
        if (!d) return false;
        if (d instanceof Date) d = d.toISOString().split('T')[0];
        return String(d).startsWith(selectedDate);
    });

    let dailyMcp = new Array(24).fill(0);
    const mcpRow = mcpData.find(item => {
        let d = item["Ημερομηνία"] || item["date"];
        if (!d) return false;
        if (d instanceof Date) d = d.toISOString().split('T')[0];
        return String(d).startsWith(selectedDate);
    });

    const chartLabels = [];
    
    for (let h = 1; h <= 24; h++) {
        let padHour = (h < 10 ? '0' + h : h) + ':00';
        chartLabels.push(padHour);
    }

    if (mcpRow) {
        for (let h = 1; h <= 24; h++) {
            let k = h + ':00';
            dailyMcp[h-1] = parseFloat(String(mcpRow[k]).replace(',', '.')) || 0;
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
                                label += context.parsed.y.toFixed(2) + ' €/MWh';
                            } else {
                                label += context.parsed.y.toFixed(2) + ' MWh';
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
            
            // --- ΛΟΓΙΚΗ RTE (ΔΙΓΛΩΣΣΑ Χρώματα & Tooltips 83-92) ---
            let rteColorClass = "text-slate-300"; 
            let rteTooltip = (lang === 'en') ? "Normal RTE levels." : "Φυσιολογικά επίπεδα απόδοσης (RTE).";
            
            if (item.rte > 0 && item.rte < 83) {
                rteColorClass = "text-yellow-400 font-bold";
                rteTooltip = (lang === 'en') 
                    ? "Low RTE (<83%): Possible SoC carryover for next day use or high auxiliary consumption." 
                    : "Χαμηλό RTE (<83%): Πιθανή διατήρηση αποθέματος (SoC) για χρήση την επόμενη ημέρα ή υψηλές ιδιοκαταναλώσεις.";
            } else if (item.rte > 92) {
                rteColorClass = "text-rose-500 font-bold";
                rteTooltip = (lang === 'en') 
                    ? "Unrealistic RTE (>92%): Discharging energy stored yesterday (SoC Carryover) or SCADA error." 
                    : "Μη ρεαλιστικό RTE (>92%): Εκφόρτιση ενέργειας που είχε αποθηκευτεί χθες (SoC Carryover) ή σφάλμα SCADA.";
            } else if (item.rte === 0) {
                rteColorClass = "text-slate-500";
                rteTooltip = (lang === 'en') ? "Zero cycle activity." : "Μηδενική δραστηριότητα κύκλου.";
            }
            
            tr.className = "hover:bg-slate-700/50 transition-all cursor-pointer group";
            tr.id = "row-" + unit.replace(/\s+/g, '-');
            
            tr.innerHTML = `
                <td class="p-3 font-bold text-slate-300 group-hover:text-white transition-colors" title="${hoverTitle}" style="border-left: 4px solid transparent;" onmouseover="this.style.borderLeftColor='${item.color}'" onmouseout="this.style.borderLeftColor='transparent'">${unit}</td>
                <td class="p-3">${item.charge.toFixed(2)}</td>
                <td class="p-3">${item.discharge.toFixed(2)}</td>
                <td class="p-3">
                    <span class="${rteColorClass} cursor-help border-b border-dotted border-slate-500" title="${rteTooltip}">
                        ${item.rte.toFixed(1)}%
                    </span>
                </td>
                <td class="p-3 font-semibold ${item.pnl >= 0 ? 'text-emerald-400' : 'text-rose-400'}">${item.pnl.toLocaleString('el-GR', {style: 'currency', currency: 'EUR', minimumFractionDigits: 0, maximumFractionDigits: 0})}</td>
                <td class="p-3">${item.unitProfit.toFixed(0)} €/MWh</td>
            `;
            
            tr.onclick = (e) => {
                toggleBessIsolation(unit);
            };
            
            tbody.appendChild(tr);
        });
    }
}

// ==========================================
// INITIALIZATION & PROGRESS LOADING SCREEN 
// ==========================================
window.addEventListener('load', () => {
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
            switchTab('daily');
        } catch (e) {
            console.error(e);
        }

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
            } catch (e) {
                console.error(e);
            }

            setTimeout(() => {
                try {
                    updateProgress(90, 'Preparing Hourly Arbitrage & P&L...');
                    initArbitrageTab();
                } catch (e) {
                    console.error(e);
                }

                updateProgress(100, 'Dashboard is ready!');
                
                setTimeout(() => {
                    if (overlay) {
                        overlay.classList.add('opacity-0');
                        setTimeout(() => {
                            overlay.style.display = 'none';
                        }, 500); 
                    }
                }, 1500); 

            }, 2400); 

        }, 2400); 

    }, 1500); 
});
