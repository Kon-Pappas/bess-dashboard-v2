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
// ΧΡΩΜΑΤΑ ΔΕΔΟΜΕΝΩΝ (D18-D20, φάση 2)
// Ένα χρώμα ανά οντότητα σε ΟΛΑ τα tabs. Κανένα δεν είναι το accent (emerald)·
// κίτρινο = εισαγωγές και κόκκινο = εξαγωγές σε όλο το hub, άρα δεν χρησιμοποιούνται για δεδομένα του BESS.
// Το πρόγραμμα (ISP) έχει την ίδια απόχρωση με το πραγματικό (SCADA), πιο ανοιχτή.
// ==========================================
const COLORS = {
    charge:       '#fb923c',  // φόρτιση BESS (SCADA): πορτοκαλί
    chargeIsp:    '#fdba74',  // φόρτιση όπως προγραμματίστηκε (ISP)
    discharge:    '#a78bfa',  // αποφόρτιση BESS (SCADA): βιολετί
    dischargeIsp: '#c4b5fd',  // αποφόρτιση όπως προγραμματίστηκε (ISP)
    pump:         '#3b82f6',  // άντληση: μπλε
    residual:     '#e879f9',  // residual surplus (ISP): φούξια
    offSurplus:   '#64748b',  // φόρτιση εκτός ωρών πλεονάσματος (arbitrage): γκρι
    mcp:          '#f1f5f9',  // τιμή MCP: ουδέτερη γραμμή αναφοράς
    mcpThreshold: '#94a3b8',  // όριο 5 €/MWh
    fleetPower:   '#e2e8f0',  // ισχύς στόλου (Capacity tab): ουδέτερη γραμμή
    fleetEnergy:  '#a78bfa',  // ενέργεια στόλου: το χρώμα της εκφόρτισης, γιατί μετριέται στην εκφόρτιση
    duration:     '#94a3b8'   // μέση διάρκεια
};
// Ετικέτα γραφήματος στη γλώσσα της σελίδας (κλειδιά lbl… του i18n στο data.js)
function L(key, fallback) {
    const t = (typeof i18n !== 'undefined' && i18n[currentLang]) || {};
    return t[key] || fallback;
}
// ==========================================
// ΓΡΑΦΗΜΑΤΑ: ώρες, αριθμοί και tooltips (D38-D41, όπως live και Flows)
// ==========================================
// Ώρα από τον αριθμό της (H01 → 0), όχι από τη θέση στη λίστα, ώστε μια ημέρα αλλαγής ώρας να μη μετακινεί τις ετικέτες.
const hourStart = (h) => { const n = parseInt(String(h).replace(/\D/g, ''), 10); return Number.isFinite(n) ? n - 1 : 0; };
const pad2 = (n) => String(n).padStart(2, '0');
const hourTick = (h) => pad2(hourStart(h));                                    // άξονας: 00 … 23
const hourRange = (h) => `${pad2(hourStart(h))}–${pad2(hourStart(h) + 1)}`;    // tooltip: 00–01 … 23–24
const escapeHtml = (s) => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const TT = () => i18n[currentLang];

// Αριθμοί στη γλώσσα της σελίδας, με το σωστό σύμβολο μείον και «–» όταν λείπει η τιμή
function fmtN(v, dec = 0, signed = false) {
    if (v === null || v === undefined || Number.isNaN(v)) return '–';
    return new Intl.NumberFormat(i18n[currentLang].locale, { minimumFractionDigits: dec, maximumFractionDigits: dec, signDisplay: signed ? 'exceptZero' : 'auto' })
        .format(v).replace('-', '−');
}
const roundsToZero = (v, dec = 0) => v === null || v === undefined || Math.abs(v) < 0.5 * Math.pow(10, -dec);

// Δικό μας HTML tooltip (ίδιο με live και Flows): μένει πάντα μέσα στην οθόνη
function htmlTip(build) {
    return (ctx) => {
        let el = document.getElementById('chart-tip');
        if (!el) {
            el = document.createElement('div');
            el.id = 'chart-tip';
            el.className = 'fixed z-[9000] pointer-events-none rounded-lg border border-slate-600 bg-slate-900/95 shadow-2xl px-4 py-3 min-w-[240px] max-w-[92vw] transition-opacity duration-150';
            el.style.opacity = 0;
            document.body.appendChild(el);
        }
        const tt = ctx.tooltip;
        if (!tt || tt.opacity === 0 || !tt.dataPoints || !tt.dataPoints.length) { el.style.opacity = 0; return; }
        const html = build(tt.dataPoints[0].dataIndex);
        if (!html) { el.style.opacity = 0; return; }
        el.innerHTML = html;
        el.style.opacity = 1;
        const r = ctx.chart.canvas.getBoundingClientRect();
        const w = el.offsetWidth, h = el.offsetHeight, gap = 14;
        let x = r.left + tt.caretX + gap;
        if (x + w > window.innerWidth - 8) x = r.left + tt.caretX - w - gap;
        x = Math.max(8, Math.min(x, window.innerWidth - w - 8));
        let y = r.top + (ctx.chart.chartArea ? ctx.chart.chartArea.top : 0);
        y = Math.max(8, Math.min(y, window.innerHeight - h - 8));
        el.style.left = `${x}px`; el.style.top = `${y}px`;
    };
}
const tipOff = (build) => ({ enabled: false, external: htmlTip(build) });
function hideChartTip() { const el = document.getElementById('chart-tip'); if (el) el.style.opacity = 0; }
window.addEventListener('scroll', hideChartTip, { passive: true });

const tipHead = (left, right = '') => `<div class="flex justify-between items-baseline gap-6 mb-2.5"><span class="text-acc-400 font-bold text-sm">${escapeHtml(left)}</span><span class="text-xs font-bold text-slate-300">${escapeHtml(right)}</span></div>`;
const tipRule = '<div class="border-t border-dashed border-white/20 my-2"></div>';
function tipRow(label, value, color, opts = {}) {
    const sw = color ? `<span class="w-2.5 h-2.5 rounded-sm shrink-0" style="background:${color}"></span>` : '';
    const pct = opts.pct ? `<span class="text-[11px] font-normal text-slate-400 ml-2">${opts.pct}</span>` : '';
    const unit = opts.unit === false ? '' : ` <span class="text-[11px] font-normal text-slate-500">${escapeHtml(opts.unit || 'MWh')}</span>`;
    return `<div class="grid grid-cols-[1fr_auto] gap-4 py-0.5 ${opts.strong ? 'text-white font-bold' : 'text-slate-300'} text-[13px]">` +
        `<span class="flex items-center gap-2 min-w-0">${sw}<span class="truncate">${escapeHtml(label)}</span></span>` +
        `<span class="text-right ${opts.strong ? '' : 'text-slate-100'}" style="font-variant-numeric:tabular-nums">${value}${unit}${pct}</span></div>`;
}
const tipGroup = (title) => `<div class="text-[11px] text-slate-400 mb-0.5">${escapeHtml(title)}</div>`;
const tipNote = (text) => `<div class="text-[11px] text-slate-400 mt-1.5">${escapeHtml(text)}</div>`;

// Κοινές ρυθμίσεις όλων των γραφημάτων (μία φορά, όπως στο live και στο Flows)
function applyChartDefaults() {
    Chart.defaults.color = '#94a3b8';
    Chart.defaults.borderColor = '#334155';
    Chart.defaults.font.family = getComputedStyle(document.body).fontFamily;
    Chart.defaults.font.size = 12;
    Chart.defaults.plugins.legend.labels.boxWidth = 12;
    Chart.defaults.plugins.legend.labels.boxHeight = 12;
    Chart.defaults.animation.duration = (typeof REDUCE_MOTION !== 'undefined' && REDUCE_MOTION) ? 0 : 400;
}

// Σε κινητό οι χιλιάδες γράφονται «5k» στους κάθετους άξονες: κερδίζουμε οριζόντιο χώρο για το γράφημα (D45)
function axisTick(v, idx, ticks) {
    if (isPhone()) {
        if (Math.abs(v) >= 1000) { const k = v / 1000; return fmtN(k, Number.isInteger(k) ? 0 : 1) + 'k'; }
        return fmtN(v, Number.isInteger(v) ? 0 : 1);
    }
    return (typeof Chart !== 'undefined' && Chart.Ticks && Chart.Ticks.formatters) ? Chart.Ticks.formatters.numeric.call(this, v, idx, ticks) : v;
}
const yTicks = { callback: axisTick };
// Στο κινητό δείχνουμε ΟΛΕΣ τις μονάδες στον οριζόντιο άξονα, κάθετες και μικρότερες· αλλιώς το Chart.js παραλείπει τις μισές (D48)
const unitXTicks = () => isPhone() ? { autoSkip: false, maxRotation: 90, minRotation: 90, font: { size: 10 } } : {};

// ---- Daily Analytics: μία μονάδα, πρόγραμμα έναντι πραγματικού
function unitTip(unit, isp, sc, cIsp, cSc) {
    const T = TT(), sel = document.getElementById('dateSelect');
    let html = tipHead(unit, sel && sel.value ? fmtDay(sel.value) : '');
    if (roundsToZero(isp) && roundsToZero(sc)) return html + tipNote(T.tipNoMove);
    if (!roundsToZero(isp)) html += tipRow(T.schedIsp, fmtN(isp), cIsp);
    if (!roundsToZero(sc)) html += tipRow(T.actScada, fmtN(sc), cSc);
    const dev = (sc || 0) - (isp || 0);
    if (!roundsToZero(dev)) html += tipRule + tipRow(T.tipDev, fmtN(dev, 0, true), null);
    return html;
}

// ---- Monthly Impact: αθροιστικό και νούμερο της ημέρας
function cumTip(dates, data, color) {
    const T = TT();
    return (i) => {
        const day = data[i] - (i > 0 ? data[i - 1] : 0);
        return tipHead(fmtDay(dates[i])) + tipRow(T.tipCum, fmtN(data[i]), color, { strong: true }) + (roundsToZero(day) ? '' : tipRow(T.tipDay, fmtN(day, 0, true), null));
    };
}

function rgba(hex, a) {
    const n = parseInt(hex.slice(1), 16);
    return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
}
function hslToHex(h, s, l) {
    s /= 100; l /= 100;
    const k = (n) => (n + h / 30) % 12, a = s * Math.min(l, 1 - l);
    const f = (n) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
    return '#' + [f(0), f(8), f(4)].map(x => Math.round(x * 255).toString(16).padStart(2, '0')).join('');
}

// Μονάδες (Arbitrage tab): το χρώμα το παίρνει ο ΣΤΑΘΜΟΣ (πρόθεμα ονόματος: SUS, STO, MYT…), η απόχρωση η μονάδα μέσα στον σταθμό.
// Όλα βγαίνουν αυτόματα από τα δεδομένα, χωρίς αλλαγή κώδικα όταν μπαίνει νέα μονάδα, και δεν αλλάζουν ποτέ για όσα υπάρχουν ήδη:
// η σειρά είναι «πρώτη εμφάνιση στα δεδομένα» (ημερομηνία, μετά όνομα). Νέος σταθμός παίρνει το επόμενο ελεύθερο χρώμα.
// Μέχρι UNIT_MODE_MAX_UNITS μονάδες (και όσο όλοι οι σταθμοί έχουν χρώμα) το γράφημα δείχνει μονάδες· πέρα από αυτό, σταθμούς.
const SITE_HUES = { SUS: 205, STO: 335, MYT: 275, OPT: 28, ENE: 240, PPC: null };  // null = ουδέτερο (γκρι-γαλάζιο)
const SPARE_HUES = [185, 310];                                                    // για νέους σταθμούς, με σειρά εμφάνισης
const UNIT_SHADES = [62, 78, 46, 34];                                             // πρώτη μονάδα: μεσαία, μετά ανοιχτότερη, σκουρότερη
const UNIT_MODE_MAX_UNITS = 20;
const SITE_OTHERS_COLOR = '#475569';

let unitRegistryCache = null;
function getUnitRegistry() {
    const rows = getHourlyData();
    if (unitRegistryCache && unitRegistryCache.rows === rows.length) return unitRegistryCache;
    const first = {};
    rows.forEach(r => {
        const u = r["Μονάδα BESS"] || r["unit"], d = String(r["Ημερομηνία"] || r["date"] || '').substring(0, 10);
        if (!u || u === 'TOTAL BESS' || !d) return;
        if (!first[u] || d < first[u]) first[u] = d;
    });
    const units = Object.keys(first).sort((a, b) => first[a].localeCompare(first[b]) || a.localeCompare(b));
    const siteOf = (u) => u.split('_')[0];
    const sites = [];
    units.forEach(u => { if (!sites.includes(siteOf(u))) sites.push(siteOf(u)); });
    const hueOf = {}; let spare = 0;
    sites.forEach(s => {
        if (Object.prototype.hasOwnProperty.call(SITE_HUES, s)) hueOf[s] = SITE_HUES[s];
        else if (spare < SPARE_HUES.length) hueOf[s] = SPARE_HUES[spare++];
        // αλλιώς: χωρίς χρώμα (undefined)
    });
    const idx = {}, counter = {};
    units.forEach(u => { const s = siteOf(u); idx[u] = counter[s] = (counter[s] === undefined ? 0 : counter[s] + 1); });
    const allHaveColour = sites.every(s => hueOf[s] !== undefined);
    unitRegistryCache = {
        rows: rows.length, units, sites, hueOf, idx, siteOf,
        unitMode: units.length <= UNIT_MODE_MAX_UNITS && allHaveColour
    };
    return unitRegistryCache;
}
function shadeColour(hue, shadeIdx) {
    const L = UNIT_SHADES[shadeIdx % UNIT_SHADES.length];
    return hue === null ? hslToHex(215, 16, L + 4) : hslToHex(hue, 80, L);
}
function unitColour(unit, reg) {
    const site = reg.siteOf(unit), hue = reg.hueOf[site];
    return hue === undefined ? SITE_OTHERS_COLOR : shadeColour(hue, reg.idx[unit] || 0);
}
function siteColour(site, reg) {
    const hue = reg.hueOf[site];
    return hue === undefined ? SITE_OTHERS_COLOR : shadeColour(hue, 0);
}

// ==========================================
// ΑΝΤΙΣΤΟΙΧΙΣΗ ΩΡΩΝ MCP ↔ SCADA
// Η ημέρα παράδοσης της Αγοράς Επόμενης Ημέρας ορίζεται σε CET, ενώ οι ώρες του SCADA ακολουθούν
// την ελληνική ώρα (+1h). Εμπειρικά (συσχέτιση BESS-MCP, κάθε μήνας Ιούν-Σεπ) η ώρα SCADA h
// ταιριάζει με την ώρα MCP h-1. Δεν έχει επιβεβαιωθεί από τεκμηρίωση του ΑΔΜΗΕ.
// Αλλαγή προεπιλογής: μετάβαση της παρακάτω σταθεράς σε false.
// ==========================================
let mcpShiftEnabled = true;

// Συγχρονίζει ΟΛΑ τα checkbox ευθυγράμμισης ωρών (header + κάρτες) και τα κείμενά τους με την τρέχουσα κατάσταση/γλώσσα.
function syncMcpShiftControls() {
    const lang = typeof currentLang !== 'undefined' ? currentLang : 'en';
    const label = (lang === 'el') ? '⏱ Ευθυγράμμιση ωρών' : '⏱ Hour alignment';
    const tip = (lang === 'el')
        ? 'Η ημέρα της αγοράς (MCP, ISP) ορίζεται σε CET, ενώ οι ώρες SCADA ακολουθούν την ελληνική ώρα (+1h). Ενεργό: οι ώρες ευθυγραμμίζονται με μετατόπιση μίας ώρας. Επηρεάζει τις καρτέλες Μηνιαίος αντίκτυπος, Πλεόνασμα & ευελιξία και Arbitrage P&L.'
        : 'The market day (MCP, ISP) is defined in CET, while SCADA hours follow Greek local time (+1h). On: hours are aligned with a one-hour shift. Affects the Monthly, Surplus and Arbitrage tabs.';
    document.querySelectorAll('.mcp-shift-toggle').forEach(el => { el.checked = !!mcpShiftEnabled; });
    document.querySelectorAll('.mcp-shift-label').forEach(el => { el.textContent = label; });
    document.querySelectorAll('.mcp-shift-chip').forEach(el => { el.title = tip; });
}

function setMcpShift(on) {
    mcpShiftEnabled = !!on;
    syncMcpShiftControls();
    renderArbitrageTab();
    // Το φίλτρο τιμής του Monthly tab χρησιμοποιεί την ίδια αντιστοίχιση ωρών
    if (typeof updateMonthlyDashboard === 'function') updateMonthlyDashboard();
    // Ο χωρισμός «σε ώρες πλεονάσματος / εκτός» και το ωριαίο προφίλ εξαρτώνται από την ίδια ευθυγράμμιση ωρών
    if (typeof updateSurplusDashboard === 'function') updateSurplusDashboard();
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
// Ημερομηνίες στη γλώσσα του επισκέπτη, όπως στο live και στο Flows: «21 Οκτ 2026 (σήμερα)», «Οκτώβριος 2026»
// Σε κινητό (< 640 px) το έτος παραλείπεται όταν όλες οι ημέρες είναι της ίδιας χρονιάς: το κουτί είναι μόλις 310 px (D31)
const PHONE_MQ = '(max-width: 639px)';
const isPhone = () => !!(window.matchMedia && window.matchMedia(PHONE_MQ).matches);
function fmtDay(iso, noYear) {
    const [y, m, d] = iso.split('-').map(Number);
    const opts = { day: 'numeric', month: 'short', timeZone: 'UTC' };
    if (!noYear) opts.year = 'numeric';
    return new Intl.DateTimeFormat(i18n[currentLang].locale, opts).format(new Date(Date.UTC(y, m - 1, d)));
}
function fmtMonth(ym) {
    const [y, m] = ym.split('-').map(Number);
    const s = new Intl.DateTimeFormat(i18n[currentLang].locale, { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(Date.UTC(y, m - 1, 1)));
    return s.charAt(0).toUpperCase() + s.slice(1);
}
function todayAthens() {
    return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Athens' }).format(new Date()); // YYYY-MM-DD
}

// Ένα κουτί επιλογής (D22): μία ημέρα για Daily + Arbitrage, ένας μήνας για Monthly + Surplus.
// Γεμίζει ξανά και όταν αλλάζει η γλώσσα, κρατώντας την τρέχουσα επιλογή. Πρώτη φορά: τελευταία ημέρα ΜΕ SCADA και τελευταίος μήνας.
var pickerNoYear = null;
function fillPickers() {
    if (!rawData || !rawData.isp || rawData.isp.length === 0) return;
    const t = i18n[currentLang], today = todayAthens();
    const dSel = document.getElementById('dateSelect'), mSel = document.getElementById('monthSelect');
    if (!dSel || !mSel) return;

    const datesSet = new Set();
    rawData.isp.forEach(d => datesSet.add(d.date));
    if (rawData.scada) rawData.scada.forEach(d => datesSet.add(d.date));
    const dates = Array.from(datesSet).sort().reverse();
    const hasScada = new Set((rawData.scada || []).filter(d => d.unit === 'TOTAL BESS').map(d => d.date));

    const noYear = isPhone() && new Set(dates.map(x => x.substring(0, 4))).size === 1;
    pickerNoYear = noYear;
    const keepDay = dates.includes(dSel.value) ? dSel.value : null;
    dSel.innerHTML = '';
    dates.forEach(date => {
        const pending = !hasScada.has(date);
        const opt = document.createElement('option');
        opt.value = date;
        opt.textContent = fmtDay(date, noYear) + (date === today ? ` (${t.today})` : '') + (pending ? ' ⚠' : '');
        opt.dataset.pending = pending;
        dSel.appendChild(opt);
    });
    dSel.value = keepDay || dates.find(d => hasScada.has(d)) || dates[0] || '';

    const mSet = new Set();
    [...(rawData.scada || []), ...(rawData.surplus || [])].forEach(d => { if (d.date) mSet.add(d.date.substring(0, 7)); });
    const months = Array.from(mSet).sort().reverse();
    const keepMonth = months.includes(mSel.value) ? mSel.value : null;
    mSel.innerHTML = '';
    months.forEach(m => {
        const opt = document.createElement('option');
        opt.value = m;
        opt.textContent = fmtMonth(m);
        mSel.appendChild(opt);
    });
    mSel.value = keepMonth || months[0] || '';
}

if (window.matchMedia) {
    const mq = window.matchMedia(PHONE_MQ);
    const onChange = () => { if (pickerNoYear !== null) { fillPickers(); updatePicker(); if (typeof switchTab === 'function') switchTab(currentTab); } };
    if (mq.addEventListener) mq.addEventListener('change', onChange); else if (mq.addListener) mq.addListener(onChange);
}

// Η ετικέτα και ο επιλογέας του κουτιού ακολουθούν το tab: «Ημέρα» (Daily, Arbitrage) ή «Μήνας» (Monthly, Surplus)
function updatePicker() {
    const t = i18n[currentLang], monthTab = (currentTab === 'monthly' || currentTab === 'surplus');
    const label = document.getElementById('pickerLabel');
    if (label) {
        label.textContent = monthTab ? t.monthLabel : t.dateLabel;
        label.setAttribute('for', monthTab ? 'monthSelect' : 'dateSelect');
    }
    const box = document.getElementById('pickerBox');
    if (box) box.classList.toggle('hidden', currentTab === 'capacity');   // το Capacity δείχνει την τρέχουσα εκτίμηση, χωρίς επιλογή ημέρας
    const dSel = document.getElementById('dateSelect'), mSel = document.getElementById('monthSelect');
    if (dSel) dSel.classList.toggle('hidden', monthTab);
    if (mSel) mSel.classList.toggle('hidden', !monthTab);
}

// Αλλαγή επιλογής: ξαναζωγραφίζεται μόνο το tab που φαίνεται (τα άλλα ζωγραφίζονται όταν τα ανοίξεις)
function onDateChange() { if (currentTab === 'arbitrage') renderArbitrageTab(); else updateDashboard(); }
function onMonthChange() { if (currentTab === 'surplus') updateSurplusDashboard(); else updateMonthlyDashboard(); }

function updateStatusBadge() {
    const badge = document.getElementById('dataStatusBadge');
    const textEl = document.getElementById('dataStatusText');
    if (!badge || !textEl) return;

    // Το pill περιγράφει την επιλεγμένη ΗΜΕΡΑ: κρύβεται στα tabs που έχουν μήνα
    if (currentTab !== 'daily' && currentTab !== 'arbitrage') { badge.classList.add('hidden'); return; }
    const sel = document.getElementById('dateSelect');
    const option = sel && sel.options[sel.selectedIndex];
    if (!option) { badge.classList.add('hidden'); return; }

    badge.classList.remove('hidden');
    const t = i18n[currentLang];
    const isPending = option.dataset.pending === 'true';
    const text = isPending ? t.pillPending : t.pillComplete;
    if (isPending) {
        // Πορτοκαλί όπως στο Flows και στο live (D26): το pill είναι στην κεφαλίδα, μακριά από τα δεδομένα της φόρτισης
        badge.className = "flex shrink-0 items-center gap-1.5 px-2 py-0.5 rounded border border-orange-500/30 bg-orange-500/10 text-[10px] md:text-xs font-bold text-orange-400 shadow-sm";
        badge.querySelector('div').className = "w-1.5 h-1.5 md:w-2 md:h-2 rounded-full bg-orange-500 animate-pulse shrink-0";
    } else {
        badge.className = "flex shrink-0 items-center gap-1.5 px-2 py-0.5 rounded border border-lime-500/30 bg-lime-500/10 text-[10px] md:text-xs font-bold text-lime-400 shadow-sm";
        badge.querySelector('div').className = "w-1.5 h-1.5 md:w-2 md:h-2 rounded-full bg-lime-500 shrink-0";
    }
    // Το κείμενο φαίνεται πάντα (D23, αναθεωρημένο στο D31): μικρή μορφή στο κινητό, πλήρης από 640 px και πάνω
    const sh = document.getElementById('dataStatusTextShort'), lg = document.getElementById('dataStatusTextLong');
    if (sh) sh.innerText = isPending ? t.pillPendingShort : t.pillCompleteShort;
    if (lg) lg.innerText = text;
    badge.title = text;
}

// ==========================================
// 0. TABS SWITCHING (Controller)
// ==========================================
// Tabs όπως στο Flows και στο live (D25): ένα accent για όλα. Ενεργό = γεμάτο accent με σκούρα γράμματα (κινητό)
// ή χρώμα accent με γραμμή από κάτω (υπολογιστής).
var currentTab = 'daily';
const TAB_BASE = 'tab-btn flex items-center justify-center text-xs md:text-base font-bold rounded-lg md:rounded-none h-12 w-full transition whitespace-nowrap px-2 border md:border-0 md:border-b-2 cursor-pointer ';
const TAB_ON = 'bg-acc-400 text-slate-900 border-acc-400 md:bg-transparent md:text-acc-400 md:border-b-acc-400';
const TAB_OFF = 'bg-slate-800 text-slate-400 border-slate-700 hover:text-white md:bg-transparent md:border-transparent md:hover:text-acc-200';
const TABS = { daily: ['tabBtnDaily', 'viewDaily'], monthly: ['tabBtnMonthly', 'viewMonthly'], surplus: ['tabBtnSurplus', 'viewSurplus'], arbitrage: ['tabBtnArbitrage', 'viewArbitrage'], capacity: ['tabBtnCapacity', 'viewCapacity'] };

function paintTabs() {
    hideChartTip();
    Object.entries(TABS).forEach(([key, [btn, view]]) => {
        const on = key === currentTab;
        const b = document.getElementById(btn);
        b.className = TAB_BASE + (on ? TAB_ON : TAB_OFF) + (key === 'capacity' ? ' col-span-2 md:col-span-1' : '');   // το πέμπτο tab πιάνει όλο το πλάτος στο κινητό
        b.setAttribute('aria-selected', on ? 'true' : 'false');
        document.getElementById(view).classList.toggle('hidden', !on);
    });
}

function switchTab(tabName) {
    if (!TABS[tabName]) return;
    currentTab = tabName;
    paintTabs();
    updatePicker();

    if (tabName === 'daily') updateDashboard();
    else if (tabName === 'monthly') updateMonthlyDashboard();
    else if (tabName === 'surplus') updateSurplusDashboard();
    else if (tabName === 'arbitrage') renderArbitrageTab();
    else if (tabName === 'capacity') renderCapacityTab();

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
                arbitrageDualChartInst.setDatasetVisibility(idx, ds.label === clickedUnit || (ds.units && ds.units.includes(clickedUnit)));
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
    paintArbitrageLegend();
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

    const hasIsp = ispDay.some(d => d.unit === "TOTAL BESS"), hasScada = scadaDay.some(d => d.unit === "TOTAL BESS");
    const shown = (id, text) => (id.includes('Scada') ? hasScada : hasIsp) ? text : '–';   // λείπει το αρχείο → «–», όχι 0 (D49)
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
        if (el) el.innerText = shown(id, formatMWh(val));
    }

    const rteMap = {
        'kpiRteIsp': ispTotal.rte,
        'kpiRteIsp_mob': ispTotal.rte,
        'kpiRteScada': scadaTotal.rte,
        'kpiRteScada_mob': scadaTotal.rte
    };

    for (const [id, val] of Object.entries(rteMap)) {
        const el = document.getElementById(id);
        if (el) el.innerText = shown(id, val);
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
    
    hideChartTip();

    const ctxDischarge = document.getElementById('dischargeChart').getContext('2d');
    if (dischargeChartInst) dischargeChartInst.destroy();
    
    dischargeChartInst = new Chart(ctxDischarge, { 
        type: 'bar', 
        data: { 
            labels: labels, 
            datasets: [
                { label: 'ISP (MWh)', data: ispDischarge, backgroundColor: COLORS.dischargeIsp, borderRadius: 4 }, 
                { label: 'SCADA (MWh)', data: scadaDischarge, backgroundColor: COLORS.discharge, borderRadius: 4 }
            ] 
        }, 
        options: { 
            responsive: true, maintainAspectRatio: false, 
            plugins: { legend: { position: 'top' }, tooltip: tipOff(i => unitTip(labels[i], ispDischarge[i], scadaDischarge[i], COLORS.dischargeIsp, COLORS.discharge)) }, 
            scales: { x: { grid: { display: false }, ticks: unitXTicks() }, y: { grid: { color: '#334155' }, ticks: yTicks } } 
        } 
    });

    const ctxCharge = document.getElementById('chargeChart').getContext('2d');
    if (chargeChartInst) chargeChartInst.destroy();
    
    chargeChartInst = new Chart(ctxCharge, { 
        type: 'bar', 
        data: { 
            labels: labels, 
            datasets: [
                { label: 'ISP (MWh)', data: ispCharge, backgroundColor: COLORS.chargeIsp, borderRadius: 4 }, 
                { label: 'SCADA (MWh)', data: scadaCharge, backgroundColor: COLORS.charge, borderRadius: 4 }
            ] 
        }, 
        options: { 
            responsive: true, maintainAspectRatio: false, 
            plugins: { legend: { position: 'top' }, tooltip: tipOff(i => unitTip(labels[i], ispCharge[i], scadaCharge[i], COLORS.chargeIsp, COLORS.charge)) }, 
            scales: { x: { grid: { display: false }, ticks: unitXTicks() }, y: { grid: { color: '#334155' }, ticks: yTicks } } 
        } 
    });
}

// ==========================================
// 2. MONTHLY DASHBOARD
// ==========================================
function updateMonthlyDashboard() {
    if (typeof syncMcpShiftControls === 'function') syncMcpShiftControls();
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

    renderMonthlyCharts(labels, chargeData, dischargeData, sortedDates);
}

function renderMonthlyCharts(labels, chargeData, dischargeData, dates) {
    hideChartTip();

    const ctxDischarge = document.getElementById('monthlyDischargeChart').getContext('2d');
    if (monthlyDischargeChartInst) monthlyDischargeChartInst.destroy();
    
    monthlyDischargeChartInst = new Chart(ctxDischarge, { 
        type: 'line', 
        data: { 
            labels: labels, 
            datasets: [{ 
                label: 'MWh', data: dischargeData, borderColor: COLORS.discharge, 
                backgroundColor: rgba(COLORS.discharge, 0.2), fill: true, tension: 0.3, pointRadius: 3, pointBackgroundColor: COLORS.discharge 
            }] 
        }, 
        options: { 
            responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false }, tooltip: tipOff(cumTip(dates, dischargeData, COLORS.discharge)) }, 
            scales: { x: { grid: { display: false } }, y: { grid: { color: '#334155' }, ticks: yTicks, title: { display: true, text: 'MWh' } } } 
        } 
    });

    const ctxCharge = document.getElementById('monthlyChargeChart').getContext('2d');
    if (monthlyChargeChartInst) monthlyChargeChartInst.destroy();
    
    monthlyChargeChartInst = new Chart(ctxCharge, { 
        type: 'line', 
        data: { 
            labels: labels, 
            datasets: [{ 
                label: 'MWh', data: chargeData, borderColor: COLORS.charge, 
                backgroundColor: rgba(COLORS.charge, 0.2), fill: true, tension: 0.3, pointRadius: 3, pointBackgroundColor: COLORS.charge 
            }] 
        }, 
        options: { 
            responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false }, tooltip: tipOff(cumTip(dates, chargeData, COLORS.charge)) }, 
            scales: { x: { grid: { display: false } }, y: { grid: { color: '#334155' }, ticks: yTicks, title: { display: true, text: 'MWh' } } } 
        } 
    });
}

// ==========================================
// 3. SURPLUS DASHBOARD
// ==========================================
// Χωρισμός της ημερήσιας φόρτισης BESS/PUMP σε «ώρες πλεονάσματος» και «εκτός ωρών πλεονάσματος».
// Ώρα πλεονάσματος = ώρα όπου το (ευθυγραμμισμένο στην ελληνική ώρα) residual του ISP είναι >= SURPLUS_HOUR_MIN_MWH.
// Επιστρέφει { 'YYYY-MM-DD': { bessIn, bessOut, pumpIn, pumpOut, hasBess, hasPump } } για ημέρες με ωριαίο surplus.
function computeSurplusHourSplit(selectedMonth) {
    const dateOf = r => String(r["Ημερομηνία"] || r["date"] || '').substring(0, 10);
    const marketShift = (typeof mcpShiftEnabled !== 'undefined' && mcpShiftEnabled) ? 1 : 0;

    const bessByDate = {};
    getHourlyData().forEach(r => {
        const date = dateOf(r);
        if (!date) return;
        if (!bessByDate[date]) bessByDate[date] = new Array(25).fill(0);
        for (let h = 1; h <= 25; h++) {
            const v = parseFloat(r[(h < 10 ? '0' + h : h) + ':00']);
            if (!isNaN(v) && v < 0) bessByDate[date][h - 1] += -v;
        }
    });
    const pumpByDate = {}, surpByDate = {};
    (rawData.pumpHourly || []).forEach(r => { pumpByDate[dateOf(r)] = hourlyRowToArray(r, 25); });
    (rawData.surplusHourly || []).forEach(r => { surpByDate[dateOf(r)] = hourlyRowToArray(r, 25); });

    // Ώρες της κάθε ημέρας: 24 κανονικά, 25 στην αλλαγή ώρας του φθινοπώρου (D55). Πριν, η 25η ώρα ταξινομούνταν πάντα «εκτός πλεονάσματος».
    const hoursOf = {};
    (rawData.surplusHourly || []).forEach(r => { hoursOf[dateOf(r)] = (r['25:00'] !== undefined && r['25:00'] !== null) ? 25 : 24; });

    const out = {};
    Object.keys(surpByDate).filter(d => d.startsWith(selectedMonth)).forEach(date => {
        const prevSurp = surpByDate[prevDateString(date)];
        const nL = hoursOf[date] || 24;
        const inS = [];
        for (let L = 0; L < nL; L++) inS.push(localHourValue(surpByDate[date], prevSurp, L, marketShift) >= SURPLUS_HOUR_MIN_MWH);
        const split = arr => {
            const total = arr.reduce((a, b) => a + b, 0);
            let inside = 0;
            for (let L = 0; L < nL; L++) if (inS[L]) inside += arr[L];   // SCADA: ώρα h -> L = h-1
            return { inside, outside: total - inside };
        };
        const r = { bessIn: 0, bessOut: 0, pumpIn: 0, pumpOut: 0, hasBess: false, hasPump: false };
        if (bessByDate[date]) { const x = split(bessByDate[date]); r.bessIn = x.inside; r.bessOut = x.outside; r.hasBess = true; }
        if (pumpByDate[date]) { const x = split(pumpByDate[date]); r.pumpIn = x.inside; r.pumpOut = x.outside; r.hasPump = true; }
        out[date] = r;
    });
    return out;
}

function updateSurplusDashboard() {
    if (typeof syncMcpShiftControls === 'function') syncMcpShiftControls();
    const selectedMonth = document.getElementById('monthSelect').value;
    if (!selectedMonth || !rawData || !rawData.surplus) return;
    const lang = typeof currentLang !== 'undefined' ? currentLang : 'en';

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

    const split = computeSurplusHourSplit(selectedMonth);
    const allDates = [...new Set([...Object.keys(scadaTotals), ...Object.keys(pumpTotals), ...Object.keys(surpTotals)])].sort();

    const labels = [];
    const dailyBess = [], dailyPump = [], dailySurp = [];      // «σε ώρες πλεονάσματος»
    const dailyOut = [], dailyBessOut = [], dailyPumpOut = []; // «εκτός ωρών πλεονάσματος» (arbitrage)
    const cumBess = [], cumPump = [], cumSurp = [], cumOut = [];
    let runBess = 0, runPump = 0, runSurp = 0, runOut = 0;

    // Συγκεντρωτικά για τα KPI (μόνο ημέρες με πλήρη ωριαία δεδομένα BESS, PUMP, ISP)
    const kpi = { n: 0, bessIn: 0, pumpIn: 0, res: 0 };
    let bigDays = 0;
    let peak = { res: -1, date: '', flexIn: 0 };

    allDates.forEach(date => {
        const parts = date.split('-');
        labels.push(parts.length >= 3 ? `${parts[2]}/${parts[1]}` : date);

        const bessTotal = scadaTotals[date] || 0;
        const pumpTotal = pumpTotals[date] || 0;
        const surpDay = Math.abs(surpTotals[date] || 0);
        const sp = split[date];

        // Χωρίς ωριαία δεδομένα για την ημέρα: δεν μπορούμε να χωρίσουμε, οπότε όλη η φόρτιση μετράει «σε ώρες πλεονάσματος»
        const bessIn = (sp && sp.hasBess) ? sp.bessIn : bessTotal;
        const bessOut = (sp && sp.hasBess) ? sp.bessOut : 0;
        const pumpIn = (sp && sp.hasPump) ? sp.pumpIn : pumpTotal;
        const pumpOut = (sp && sp.hasPump) ? sp.pumpOut : 0;

        dailyBess.push(bessIn);
        dailyPump.push(pumpIn);
        dailySurp.push(surpDay);
        dailyBessOut.push(bessOut);
        dailyPumpOut.push(pumpOut);
        dailyOut.push(bessOut + pumpOut);

        runBess += bessIn; runPump += pumpIn; runSurp += surpDay;
        runOut += bessOut + pumpOut;
        cumBess.push(runBess); cumPump.push(runPump); cumSurp.push(runSurp); cumOut.push(runOut);

        if (surpTotals[date] !== undefined) {
            if (surpDay > peak.res) peak = { res: surpDay, date: labels[labels.length - 1], flexIn: bessIn + pumpIn };
        }
        if (sp && sp.hasBess && sp.hasPump) {
            kpi.n++; kpi.bessIn += sp.bessIn; kpi.pumpIn += sp.pumpIn; kpi.res += surpDay;
            // Ημέρα όπου το residual ξεπέρασε όλη την ενέργεια που απορρόφησαν BESS+PUMP στις ώρες πλεονάσματος
            if (surpDay > sp.bessIn + sp.pumpIn) bigDays++;
        }
    });

    renderSurplusKpis(kpi, bigDays, kpi.n, peak, lang);
    renderSurplusCharts(labels, dailyBess, dailyPump, dailySurp, cumBess, cumPump, cumSurp, dailyOut, dailyBessOut, dailyPumpOut, cumOut, allDates);
    renderSurplusHourlyProfile();
}

// KPI πάνω από το ημερήσιο γράφημα: μηνιαία, ενεργειακά σταθμισμένα μεγέθη μόνο για τις ώρες πλεονάσματος
function renderSurplusKpis(kpi, bigDays, daysWithSurplus, peak, lang) {
    const box = document.getElementById('surplusKpiGrid');
    if (!box) return;
    const el = lang === 'el';
    const fmt = v => (typeof formatMWh === 'function') ? formatMWh(v) : Math.round(v).toLocaleString();
    const pct = v => (isFinite(v) ? v.toFixed(1) + '%' : '–');
    const total = kpi.res + kpi.bessIn + kpi.pumpIn;
    const half = (label, value, sub, color, subColor) => `
        <div class="w-1/2">
            <span class="text-[11px] ${subColor} block mb-1">${label}</span>
            <span class="text-xl font-bold ${color}">${value}</span>
            <span class="text-xs text-slate-400 block mt-0.5">${sub}</span>
        </div>`;
    const card = (cls, border, left, right) => `
        <div class="${cls} border ${border} rounded-lg p-3 flex justify-between items-center shadow-sm gap-4">${left}${right}</div>`;

    const perDay = v => kpi.n > 0 ? fmt(v / kpi.n) : '–';
    const nTxt = kpi.n > 0 ? `${kpi.n} ${el ? 'ημέρες' : 'days'}` : (el ? 'χωρίς δεδομένα' : 'no data');

    const bessCard = card('bg-orange-900/10', 'border-orange-500/20',
        half(el ? 'BESS σε ώρες πλεονάσματος' : 'BESS in surplus hours', perDay(kpi.bessIn), `MWh/${el ? 'ημέρα' : 'day'} · ${nTxt}`, 'text-orange-400', 'text-orange-400/70'),
        half(el ? 'Μερίδιο απορρόφησης' : 'Absorption share', total > 0 && kpi.n > 0 ? pct(kpi.bessIn / total * 100) : '–', el ? 'του πλεονάσματος των ωρών' : 'of surplus-hour energy', 'text-orange-400', 'text-orange-400/70'));
    const pumpCard = card('bg-blue-900/10', 'border-blue-500/20',
        half(el ? 'Άντληση σε ώρες πλεονάσματος' : 'PUMP in surplus hours', perDay(kpi.pumpIn), `MWh/${el ? 'ημέρα' : 'day'} · ${nTxt}`, 'text-blue-400', 'text-blue-400/70'),
        half(el ? 'Μερίδιο απορρόφησης' : 'Absorption share', total > 0 && kpi.n > 0 ? pct(kpi.pumpIn / total * 100) : '–', el ? 'του πλεονάσματος των ωρών' : 'of surplus-hour energy', 'text-blue-400', 'text-blue-400/70'));
    const peakTxt = peak.res > 0 ? `${(peak.res / 1000).toFixed(1)} GWh` : '–';
    const peakSub = peak.res > 0
        ? `${peak.date} · ${el ? 'ευελιξία' : 'flex'} ${(peak.flexIn / peak.res * 100).toFixed(0)}%`
        : '';
    const surpCard = card('bg-fuchsia-900/10', 'border-fuchsia-500/20',
        half(el ? 'Μέρες πλεονάσματος > ευελιξία' : 'Days residual > flex', daysWithSurplus > 0 ? `${bigDays} / ${daysWithSurplus}` : '–', el ? 'πάνω από BESS και άντληση' : 'above BESS and PUMP', 'text-fuchsia-400', 'text-fuchsia-400/70'),
        half(el ? 'Μέρα μέγιστου πλεονάσματος' : 'Peak surplus day', peakTxt, peakSub, 'text-fuchsia-400', 'text-fuchsia-400/70'));
    box.innerHTML = bessCard + pumpCard + surpCard;
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

// ---- Surplus & Flexibility: ωριαίο προφίλ, ημερήσιο, αθροιστικό
function hourlyTip(i, bessAvg, pumpAvg, surpAvg, mcpAvg, n) {
    const T = TT(), b = bessAvg[i], p = pumpAvg[i], r = surpAvg[i], m = mcpAvg[i], flex = b + p;
    let html = tipHead(hourRange(i + 1), `${T.tipMcp} ${fmtN(m, 1)} ${T.tipEur}`);
    const parts = [];
    if (!roundsToZero(b) || !roundsToZero(p)) {
        let g = tipGroup(T.tipFlexGrp);
        if (!roundsToZero(b)) g += tipRow(T.tipBess, fmtN(b), COLORS.charge);
        if (!roundsToZero(p)) g += tipRow(T.tipPump, fmtN(p), COLORS.pump);
        if (!roundsToZero(b) && !roundsToZero(p)) g += tipRow(T.tipFlexTot, fmtN(flex), null, { strong: true });
        parts.push(g);
    }
    if (!roundsToZero(r)) parts.push(tipRow(L('lblResidual', 'Residual Surplus (ISP)'), fmtN(r), COLORS.residual));
    if (!roundsToZero(r) && flex > 0) parts.push(tipRow(T.tipCover, fmtN(flex / r * 100) + '%', null, { unit: false }));
    if (!parts.length) return html + tipNote(T.tipNoMove);
    return html + parts.join(tipRule) + tipNote(T.tipAvg.replace('{n}', n));
}
function stackedTip(i, dates, bessIn, pumpIn, resid, bessOut, pumpOut) {
    const T = TT(), b = bessIn[i], p = pumpIn[i], r = resid[i], o = (bessOut[i] || 0) + (pumpOut[i] || 0);
    const theo = b + p + r, pc = (v) => fmtN(v / theo * 100, 1) + '%';
    let html = tipHead(fmtDay(dates[i]), theo > 0 ? `${T.tipTheo} ${fmtN(theo)} MWh` : '');
    const parts = [];
    if (!roundsToZero(theo)) {
        let g = tipGroup(T.tipIn);
        if (!roundsToZero(b)) g += tipRow(T.tipBess, fmtN(b), COLORS.charge, { pct: pc(b) });
        if (!roundsToZero(p)) g += tipRow(T.tipPump, fmtN(p), COLORS.pump, { pct: pc(p) });
        if (!roundsToZero(r)) g += tipRow(L('lblResidual', 'Residual Surplus (ISP)'), fmtN(r), COLORS.residual, { pct: pc(r) });
        else g += tipNote(T.tipZero);
        parts.push(g);
    }
    if (!roundsToZero(o)) parts.push(tipGroup(T.tipOut) + tipRow(T.tipOutBoth, fmtN(o), COLORS.offSurplus) + tipNote(T.tipOutNote));
    if (!parts.length) return html + tipNote(T.tipNoMove);
    return html + parts.join(tipRule);
}
function cumSurplusTip(i, dates, cumBess, cumPump, cumResid, cumOut) {
    const T = TT();
    let html = tipHead(fmtDay(dates[i]));
    const rows = [
        [L('lblCumBess', 'Cum. BESS Charge'), cumBess[i], COLORS.charge],
        [L('lblCumPump', 'Cum. PUMP Charge'), cumPump[i], COLORS.pump],
        [L('lblCumResidual', 'Cum. Residual Surplus'), cumResid[i], COLORS.residual],
        [L('lblCumOut', 'Cum. charging outside surplus hours (arbitrage)'), cumOut[i], COLORS.offSurplus]
    ].filter(r => !roundsToZero(r[1]));
    if (!rows.length) return html + tipNote(T.tipNoMove);
    return html + rows.map(r => tipRow(r[0], fmtN(r[1]), r[2])).join('');
}

function renderSurplusHourlyProfile() {
    const monthEl = document.getElementById('monthSelect');
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
            <div class="text-[11px] text-slate-400">${label}</div>
            <div class="text-xl font-bold ${color}">${value}</div>
            <div class="text-[10px] text-slate-500">${sub}</div>
        </div>`;
    const flexPerDay = (sumBess + sumPump) / n;
    if (kpiBox) {
        kpiBox.innerHTML =
            tile(t.surplusHourlyKpiResidual || 'Avg ISP residual / day', fmt(sumSurp / n) + ' MWh', n + (lang === 'el' ? ' ημέρες' : ' days'), 'text-fuchsia-400') +
            tile(t.surplusHourlyKpiRatio || 'Flex charging ÷ residual', pct(sumSurp > 0 ? (flexPerDay / (sumSurp / n)) * 100 : NaN), fmt(flexPerDay) + ' MWh / ' + (lang === 'el' ? 'ημέρα' : 'day'), 'text-slate-200') +
            tile(t.surplusHourlyKpiBess || 'BESS in surplus hours', pct(sumBess > 0 ? (bessIn / sumBess) * 100 : NaN), (lang === 'el' ? 'της φόρτισης BESS' : 'of BESS charging'), 'text-orange-400') +
            tile(t.surplusHourlyKpiPump || 'PUMP in surplus hours', pct(sumPump > 0 ? (pumpIn / sumPump) * 100 : NaN), (lang === 'el' ? 'της φόρτισης άντλησης' : 'of PUMP charging'), 'text-blue-400');
    }

    // --- Γράφημα ---
    const labels = []; for (let L = 0; L < 24; L++) labels.push(hourTick(L + 1));
    resetChart();
    hideChartTip();
    surplusHourlyChartInst = new Chart(canvas.getContext('2d'), {
        data: {
            labels: labels,
            datasets: [
                { type: 'bar', label: L('lblBessCharge', 'BESS Charge (SCADA)'), data: bessAvg, backgroundColor: COLORS.charge, stack: 'flex', yAxisID: 'y', order: 3 },
                { type: 'bar', label: L('lblPumpCharge', 'PUMP Charge (SCADA)'), data: pumpAvg, backgroundColor: COLORS.pump, stack: 'flex', yAxisID: 'y', order: 3 },
                { type: 'line', label: L('lblResidual', 'Residual Surplus (ISP)'), data: surpAvg, borderColor: COLORS.residual, backgroundColor: rgba(COLORS.residual, 0.15), fill: true, tension: 0.25, pointRadius: 2, yAxisID: 'y', order: 1 },
                { type: 'line', label: (lang === 'el' ? 'Τιμή MCP (€/MWh)' : 'MCP Price (€/MWh)'), data: mcpAvg, borderColor: COLORS.mcp, borderDash: [5, 4], borderWidth: 2, pointRadius: 0, tension: 0.2, yAxisID: 'y2', order: 2 },
                { type: 'line', label: (lang === 'el' ? 'Όριο 5 €/MWh' : '€5/MWh threshold'), data: new Array(24).fill(CURTAILMENT_PRICE_THRESHOLD), borderColor: rgba(COLORS.mcpThreshold, 0.7), borderDash: [2, 3], borderWidth: 1, pointRadius: 0, yAxisID: 'y2', order: 2 }
            ]
        },
        options: {
            responsive: true, maintainAspectRatio: false,
            interaction: { mode: 'index', intersect: false },
            plugins: {
                legend: { position: 'top' },
                tooltip: tipOff(i => hourlyTip(i, bessAvg, pumpAvg, surpAvg, mcpAvg, n))
            },
            scales: {
                x: { stacked: true, grid: { display: false }, title: { display: true, text: (lang === 'el' ? 'Ώρα ημέρας (ελληνική ώρα)' : 'Hour of day (Greek local time)') } },
                y: { stacked: true, grid: { color: '#334155' }, ticks: yTicks, title: { display: true, text: 'MWh / h' }, beginAtZero: true },
                y2: { position: 'right', grid: { display: false }, ticks: yTicks, title: { display: true, text: '€/MWh' } }
            }
        }
    });

    if (noteEl) {
        const first = usedDays[0], last = usedDays[n - 1];
        noteEl.textContent = (lang === 'el')
            ? `Μέσος όρος ${n} ημερών (${first} έως ${last}), μόνο ημέρες με δεδομένα BESS, άντλησης, ISP και MCP. Το ISP είναι προγραμματισμός (όχι μέτρηση) και δεν περιλαμβάνει εξαγωγές. ` +
              (marketShift ? 'Δεδομένα αγοράς (MCP, ISP) και SCADA ευθυγραμμίζονται με μετατόπιση μίας ώρας (CET → ελληνική ώρα), παραδοχή που δεν έχει επιβεβαιωθεί από τον ΑΔΜΗΕ.' : 'Χωρίς μετατόπιση ώρας ανάμεσα σε αγορά και SCADA.')
            : `Average of ${n} days (${first} to ${last}), only days with BESS, PUMP, ISP and MCP data. ISP is a schedule (not a measurement) and excludes exports. ` +
              (marketShift ? 'Market data (MCP, ISP) and SCADA are aligned with a one-hour shift (CET → Greek local time), an assumption not yet confirmed by IPTO.' : 'No hour shift applied between market data and SCADA.');
    }
}

function renderSurplusCharts(labels, dailyBess, dailyPump, dailySurplus, cumBess, cumPump, cumSurplus, dailyOut, dailyBessOut, dailyPumpOut, cumOut, dates) {
    hideChartTip();
    dailyOut = dailyOut || []; dailyBessOut = dailyBessOut || []; dailyPumpOut = dailyPumpOut || []; cumOut = cumOut || [];
    const ctxStacked = document.getElementById('surplusStackedChart').getContext('2d');
    if (surplusStackedChartInst) surplusStackedChartInst.destroy();
    
    const lang = typeof currentLang !== 'undefined' ? currentLang : 'en';

    surplusStackedChartInst = new Chart(ctxStacked, {
        type: 'bar',
        data: {
            labels: labels,
            datasets: [
                { label: (lang === 'el') ? 'Φόρτιση BESS σε ώρες πλεονάσματος' : 'BESS Charge in surplus hours', data: dailyBess, backgroundColor: COLORS.charge, stack: 'Stack 0' },
                { label: (lang === 'el') ? 'Φόρτιση άντλησης σε ώρες πλεονάσματος' : 'PUMP Charge in surplus hours', data: dailyPump, backgroundColor: COLORS.pump, stack: 'Stack 0' },
                { label: L('lblResidual', 'Residual Surplus (ISP)'), data: dailySurplus, backgroundColor: COLORS.residual, stack: 'Stack 0' },
                { label: (lang === 'el') ? 'Φόρτιση εκτός ωρών πλεονάσματος (arbitrage)' : 'Charging outside surplus hours (arbitrage)', data: dailyOut, backgroundColor: COLORS.offSurplus, stack: 'Stack 0' }
            ]
        },
        options: {
            responsive: true, maintainAspectRatio: false,
            plugins: {
                legend: { position: 'top' },
                tooltip: tipOff(i => stackedTip(i, dates, dailyBess, dailyPump, dailySurplus, dailyBessOut, dailyPumpOut))
            },
            scales: { 
                x: { stacked: true, grid: { display: false } }, 
                y: { stacked: true, grid: { color: '#334155' }, ticks: yTicks, title: { display: true, text: 'MWh' } } 
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
                { label: L('lblCumBess', 'Cum. BESS Charge'), data: cumBess, borderColor: COLORS.charge, backgroundColor: rgba(COLORS.charge, 0.1), fill: true, tension: 0.3 },
                { label: L('lblCumPump', 'Cum. PUMP Charge'), data: cumPump, borderColor: COLORS.pump, backgroundColor: rgba(COLORS.pump, 0.1), fill: true, tension: 0.3 },
                { label: L('lblCumResidual', 'Cum. Residual Surplus'), data: cumSurplus, borderColor: COLORS.residual, backgroundColor: 'transparent', fill: false, tension: 0.3 },
                { label: L('lblCumOut', 'Cum. charging outside surplus hours (arbitrage)'), data: cumOut, borderColor: COLORS.offSurplus, backgroundColor: 'transparent', borderDash: [6, 4], fill: false, tension: 0.3 }
            ]
        },
        options: {
            responsive: true, maintainAspectRatio: false,
            plugins: { 
                legend: { position: 'top' },
                tooltip: tipOff(i => cumSurplusTip(i, dates, cumBess, cumPump, cumSurplus, cumOut))
            },
            scales: { x: { grid: { display: false } }, y: { grid: { color: '#334155' }, ticks: yTicks, title: { display: true, text: 'MWh' } } }
        }
    });
}

// ==========================================
// 4. ARBITRAGE P&L & HOURLY OPERATIONS
// ==========================================
// Υπόμνημα του Arbitrage για κινητό (D46, D52). Διαβάζει τα ίδια τα δεδομένα του γραφήματος, άρα τα χρώματα δεν μπορούν να διαφέρουν:
//  • όλες οι μονάδες: ένα chip ανά σταθμό, με ένα κομμάτι για κάθε μονάδα του στην απόχρωσή της (π.χ. MYT ▮▮)
//  • μία μονάδα επιλεγμένη από τον πίνακα: ένα μόνο chip με το όνομά της και το ΑΚΡΙΒΕΣ χρώμα των μπαρών· πάτημα = επιστροφή στις όλες
function paintArbitrageLegend() {
    const box = document.getElementById('arbitrageSiteLegend'), ch = arbitrageDualChartInst;
    if (!box || !ch) return;
    const reg = getUnitRegistry(), T = TT();
    const dsAll = ch.data.datasets, bars = dsAll.filter(d => d.stack === 'bessStack'), mcpDs = dsAll.find(d => d.yAxisID === 'yMcp');
    const chip = (swatch, label, extra = '') => `<span class="inline-flex items-center gap-1.5 whitespace-nowrap"${extra}>${swatch}${escapeHtml(label)}</span>`;
    let html = '';
    const one = (reg.unitMode && currentlyIsolatedBess) ? bars.find(b => b.label === currentlyIsolatedBess) : null;
    if (one) {
        const safe = escapeHtml(one.label);
        html = `<button type="button" onclick="toggleBessIsolation('${safe}')" class="inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border border-slate-600 bg-slate-900/60 pl-2 pr-2.5 py-0.5 text-slate-100" aria-label="${escapeHtml(T.tipShowAll)}" title="${escapeHtml(T.tipShowAll)}">`
             + `<span class="w-2.5 h-2.5 rounded-sm shrink-0" style="background:${one.backgroundColor}"></span>${safe}<span class="text-slate-400 ml-0.5">✕</span></button>`;
    } else {
        const sites = new Map();
        bars.forEach(d => { const key = d.site || d.label; if (!sites.has(key)) sites.set(key, []); sites.get(key).push(d.backgroundColor); });
        html = [...sites.entries()].map(([key, cols]) => {
            const strip = `<span class="inline-flex rounded-sm overflow-hidden shrink-0">${cols.map(c => `<span class="${cols.length > 1 ? 'w-1.5' : 'w-2.5'} h-2.5" style="background:${c}"></span>`).join('')}</span>`;
            return chip(strip, key === '__others' ? T.tipOtherSites : key);
        }).join('');
    }
    if (mcpDs) html += chip(`<span class="w-3 h-0.5 shrink-0" style="background:${COLORS.mcp}"></span>`, mcpDs.label);
    box.innerHTML = html;
}

function renderArbitrageTab() {
    if (typeof syncMcpShiftControls === 'function') syncMcpShiftControls();
    updateStatusBadge();
    currentlyIsolatedBess = null; 

    const select = document.getElementById('dateSelect');
    if (!select) return;
    
    const selectedDate = select.value;
    const hourlyData = getHourlyData();
    const mcpData = getMcpData();

    if (!selectedDate || !hourlyData || hourlyData.length === 0) return;

    const lang = typeof currentLang !== 'undefined' ? currentLang : 'en';
    const mcpLegendLabel = (lang === 'en') ? 'MCP Price (€/MWh)' : 'Τιμή MCP (€/MWh)';
    const mcpLegendLabelFinal = mcpLegendLabel;   // η ευθυγράμμιση φαίνεται ήδη στον διακόπτη πάνω από το γράφημα· η μακριά ετικέτα κόβονταν στο κινητό (D44)
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
        chartLabels.push(hourTick(h));
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
    const reg = getUnitRegistry();
    const unitSeries = {};      // μονάδα -> ωριαίες τιμές της ημέρας
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
            color: reg.unitMode ? unitColour(unitName, reg) : siteColour(reg.siteOf(unitName), reg)
        };
        unitSeries[unitName] = dataPoints;
    });

    // Μέχρι 20 μονάδες: μία στήλη ανά μονάδα. Πέρα από αυτό: μία ανά σταθμό (άθροισμα των μονάδων του)· ο πίνακας κάτω δείχνει πάντα κάθε μονάδα.
    if (reg.unitMode) {
        Object.keys(unitSeries).forEach(u => datasets.push({
            label: u, data: unitSeries[u], backgroundColor: pnlSummary[u].color,
            stack: 'bessStack', borderRadius: 2, type: 'bar', yAxisID: 'y', units: [u], site: reg.siteOf(u)
        }));
    } else {
        const bySite = {};
        Object.keys(unitSeries).forEach(u => {
            const s = reg.hueOf[reg.siteOf(u)] === undefined ? '__others' : reg.siteOf(u);
            if (!bySite[s]) bySite[s] = { data: new Array(nH).fill(0), units: [] };
            unitSeries[u].forEach((v, i) => { bySite[s].data[i] += v; });
            bySite[s].units.push(u);
        });
        Object.keys(bySite).sort().forEach(s => datasets.push({
            label: s === '__others' ? ((lang === 'en') ? 'Other sites' : 'Λοιποί σταθμοί') : s,
            data: bySite[s].data.map(v => Math.round(v * 1000) / 1000),
            backgroundColor: s === '__others' ? SITE_OTHERS_COLOR : siteColour(s, reg),
            stack: 'bessStack', borderRadius: 2, type: 'bar', yAxisID: 'y', units: bySite[s].units, site: s
        }));
    }
    const modeNote = document.getElementById('arbitrageModeNote');
    if (modeNote) {
        modeNote.textContent = reg.unitMode ? '' : ((lang === 'en')
            ? `With more than ${UNIT_MODE_MAX_UNITS} units the chart shows one column per site (the sum of its units). The table below lists every unit.`
            : `Με περισσότερες από ${UNIT_MODE_MAX_UNITS} μονάδες το γράφημα δείχνει μία στήλη ανά σταθμό (το άθροισμα των μονάδων του). Ο πίνακας κάτω δείχνει κάθε μονάδα.`);
        modeNote.classList.toggle('hidden', reg.unitMode);
    }

    if (mcpRow) {
        datasets.push({
            label: mcpLegendLabelFinal,
            data: dailyMcp,
            borderColor: COLORS.mcp, 
            backgroundColor: COLORS.mcp,
            type: 'line',
            borderWidth: 2,
            pointRadius: 2,
            fill: false,
            yAxisID: 'yMcp'
        });
    }

    // Tooltip (D41): όλες οι μονάδες ομαδοποιημένες ανά σταθμό, π.χ. «MYT (1 & 2)»· όταν έχει επιλεγεί ΜΙΑ μονάδα από τον πίνακα,
    // μόνο τα στοιχεία της (ώρα, MWh, τιμή MCP και αξία της ώρας).
    const arbTip = (i) => {
        const T = TT(), ch = arbitrageDualChartInst;
        if (!ch) return '';
        const ds = ch.data.datasets;
        const mcpDs = ds.find(x => x.yAxisID === 'yMcp');
        const price = mcpDs ? mcpDs.data[i] : null;
        const hasPrice = price !== null && price !== undefined && !Number.isNaN(price);
        const range = hourRange(i + 1);
        const bars = [];
        ds.forEach((x, idx) => { if (x.stack === 'bessStack' && ch.isDatasetVisible(idx)) bars.push(x); });

        if (reg.unitMode && currentlyIsolatedBess) {
            const x = bars.find(b => b.label === currentlyIsolatedBess);
            if (x) {
                const v = x.data[i];
                let html = tipHead(x.label, range);
                if (roundsToZero(v)) return html + tipNote(T.tipNoMove);
                html += tipRow(v < 0 ? T.tipChg : T.tipDis, fmtN(v, 0, true), x.backgroundColor);
                if (hasPrice) {
                    html += tipRow(T.tipMcpLabel, fmtN(price, 1), COLORS.mcp, { unit: T.tipEur });
                    html += tipRule + tipRow(T.tipHourValue, fmtN(v * price, 0, true), null, { strong: true, unit: '€' });
                }
                return html;
            }
        }

        const groups = { chg: {}, dis: {} };
        const numOf = (u) => { const m = String(u).match(/_(\d+)/); return m ? parseInt(m[1], 10) : null; };
        bars.forEach(x => {
            const v = x.data[i];
            if (roundsToZero(v)) return;
            const g = v < 0 ? groups.chg : groups.dis, key = x.site || x.label;
            if (!g[key]) g[key] = { site: key, value: 0, nums: new Set(), color: key === '__others' ? SITE_OTHERS_COLOR : siteColour(key, reg) };
            g[key].value += v;
            (x.units || []).forEach(u => { const n = numOf(u); if (n !== null) g[key].nums.add(n); });
        });
        const siteLabel = (g) => g.site === '__others' ? T.tipOtherSites : (g.nums.size ? `${g.site} (${[...g.nums].sort((a, b) => a - b).join(' & ')})` : g.site);
        const block = (title, obj) => {
            const list = Object.values(obj).sort((a, b) => Math.abs(b.value) - Math.abs(a.value));
            if (!list.length) return '';
            const CAP = 8, shown = list.slice(0, CAP), rest = list.slice(CAP);
            let out = tipGroup(title) + shown.map(g => tipRow(siteLabel(g), fmtN(g.value, 0, true), g.color)).join('');
            if (rest.length) out += tipRow(`+${rest.length} ${T.tipMore}`, fmtN(rest.reduce((a, g) => a + g.value, 0), 0, true), null);
            if (list.length > 1) out += tipRow(T.tipTotal, fmtN(list.reduce((a, g) => a + g.value, 0), 0, true), null, { strong: true });
            return out;
        };
        const chg = block(T.tipChg, groups.chg), dis = block(T.tipDis, groups.dis);
        let html = tipHead(range, hasPrice ? `${T.tipMcp} ${fmtN(price, 1)} ${T.tipEur}` : '');
        if (!chg && !dis) return html + tipNote(T.tipNoMove);
        const net = [...Object.values(groups.chg), ...Object.values(groups.dis)].reduce((a, g) => a + g.value, 0);
        return html + chg + (chg && dis ? tipRule : '') + dis + (chg && dis ? tipRule + tipRow(T.tipNet, fmtN(net, 0, true), null, { strong: true }) : '') + tipNote(T.tipHint);
    };

    const canvasCtx = document.getElementById('arbitrageDualChart');
    if (!canvasCtx) return;
    const ctx = canvasCtx.getContext('2d');
    
    hideChartTip();
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
                    grid: { color: '#334155' }, ticks: yTicks, 
                    title: { display: true, text: yBessTitle },
                    position: 'left'
                },
                yMcp: {
                    type: 'linear',
                    display: true,
                    position: 'right',
                    grid: { display: false },
                    title: { display: true, text: yMcpTitle, color: COLORS.mcp },
                    ticks: { color: COLORS.mcpThreshold, callback: axisTick }
                }
            },
            plugins: { 
                legend: { display: !isPhone(), position: 'top', labels: { padding: 12 } },
                tooltip: tipOff(arbTip) 
            }
        }
    });
    paintArbitrageLegend();

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
            
            // Μονάδα χωρίς δραστηριότητα (μηδέν φόρτιση και αποφόρτιση): ξεθωριασμένη γραμμή και «–» αντί για μηδενικά (D43)
            const inactive = roundsToZero(item.charge) && roundsToZero(item.discharge);
            const zeroPnl = Math.abs(item.pnl) < 0.005;
            const chargeTxt = roundsToZero(item.charge) ? '–' : formatMWh(item.charge);
            const dischargeTxt = roundsToZero(item.discharge) ? '–' : formatMWh(item.discharge);
            const rteTxt = item.rte === 0 ? '–' : formatPct(item.rte);
            const pnlTxt = zeroPnl ? '–' : formatEur(item.pnl);
            const pnlClass = zeroPnl ? 'text-slate-500' : (item.pnl >= 0 ? 'text-lime-400' : 'text-rose-400');
            const profitZero = roundsToZero(item.unitProfit, 2);
            const profitTxt = profitZero ? '–' : `${formatEur(item.unitProfit)} / MWh`;
            const profitShort = profitZero ? '–' : formatEur(item.unitProfit);

            const trMain = document.createElement('tr');
            trMain.className = "bess-main-row hover:bg-slate-700/50 transition-all cursor-pointer group" + (inactive ? " opacity-30 hover:opacity-60" : "");
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
                <td class="p-3 text-right">${chargeTxt}</td>
                <td class="p-3 text-right">${dischargeTxt}</td>
                <td class="p-3 hidden md:table-cell text-right">
                    <span class="${rteColorClass} cursor-help border-b border-dotted border-slate-500" title="${rteTooltip}">
                        ${rteTxt}
                    </span>
                </td>
                <td class="p-3 font-semibold hidden md:table-cell text-right ${pnlClass}">${pnlTxt}</td>
                <td class="p-3 hidden md:table-cell text-right">${profitTxt}</td>
            `;
            
            trMain.onclick = () => toggleBessIsolation(unit);
            tbody.appendChild(trMain);

            const trExpand = document.createElement('tr');
            trExpand.className = "bess-expand-row hidden md:hidden bg-slate-800/30" + (inactive ? " opacity-30" : "");
            trExpand.id = "expand-" + safeUnitId;

            trExpand.innerHTML = `
                <td colspan="3" class="p-0 border-t-0">
                    <div class="flex flex-col bg-slate-900/40" style="border-left: 4px solid ${item.color};">
                        
                        <div class="flex justify-between items-center py-3 px-4 border-b border-slate-700/50">
                            <span class="text-xs font-semibold text-slate-500">${i18n[lang].thRte}</span>
                            <span class="${rteColorClass} text-sm font-semibold cursor-help" title="${rteTooltip}">${rteTxt}</span>
                        </div>
                        
                        <div class="flex justify-between items-center py-3 px-4 border-b border-slate-700/50">
                            <span class="text-xs font-semibold text-slate-500">${i18n[lang].thPnl}</span>
                            <span class="text-sm font-bold ${pnlClass}">${pnlTxt}</span>
                        </div>
                        
                        <div class="flex justify-between items-center py-3 px-4">
                            <span class="text-xs font-semibold text-slate-500">${i18n[lang].thProfit}</span>
                            <span class="text-sm font-bold text-slate-100">${profitShort}</span>
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
// ΟΘΟΝΗ ΦΟΡΤΩΣΗΣ & ΕΚΚΙΝΗΣΗ (D03, όπως live-greekpower D47 / Flows)
// ==========================================
// Πρώτα η δουλειά, μετά το γέμισμα της μπάρας, μετά το ✓. Χρόνοι ίδιοι με το live.
// Ό,τι έχει τελειώσει (✓, γεμάτη μπάρα, «έτοιμο») είναι emerald, το χρώμα του repo, όπως το πράσινο «τελείωσε» σε όλο το hub·
// τα βήματα σε εξέλιξη είναι lime ώστε η πρόοδος να ξεχωρίζει από το τέλος, αφού το accent του BESS είναι κι αυτό emerald (D02).
const REDUCE_MOTION = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
const LOAD_STEP = REDUCE_MOTION ? 120 : 350, LOAD_MIN_READ = REDUCE_MOTION ? 200 : 650, LOAD_READY = REDUCE_MOTION ? 200 : 650;
const pause = (ms) => (ms > 0 ? new Promise((r) => setTimeout(r, ms)) : Promise.resolve());
const loadRow = (i) => document.querySelector(`.load-row[data-step="${i}"]`);
function loadActivate(i) { const r = loadRow(i); if (r) r.classList.remove('opacity-50'); }
function loadSet(i, pct) { const b = loadRow(i) && loadRow(i).querySelector('[data-load-bar]'); if (b) b.style.width = `${pct}%`; }
function loadDone(i) {
    const r = loadRow(i); if (!r) return;
    const b = r.querySelector('[data-load-bar]');
    b.style.width = '100%'; b.classList.remove('bg-blue-500', 'bg-lime-500'); b.style.backgroundColor = window.ACCENT[500];   // το accent από το ένα σημείο ορισμού του index.html
    r.querySelector('[data-load-ck]').classList.remove('opacity-0');
}
async function loadStep(i, work) {          // βήματα 2…5: δουλειά → γέμισμα → ✓
    loadActivate(i);
    await pause(20);
    await work();
    const b = loadRow(i).querySelector('[data-load-bar]');
    b.style.transitionDuration = `${LOAD_STEP}ms`; b.style.transitionTimingFunction = 'linear'; b.style.width = '100%';
    await pause(LOAD_STEP);
    loadDone(i);
}

// Αν τα δεδομένα δεν φορτώσουν: η οθόνη μένει, σταματά το spinner και γράφει μήνυμα (όπως στο live).
function loadFailed(err) {
    console.error(err);
    const sp = document.getElementById('mainSpinner'); if (sp) sp.classList.add('hidden');
    const el = document.getElementById('loadError');
    if (el) { el.textContent = i18n[currentLang].load.error; el.classList.remove('hidden'); }
}

// Λήψη JSON. Και τα δύο αρχεία αλλάζουν κάθε μέρα, οπότε παίρνουν cache-busting.
async function getJSON(path, bust = false) {
    // «no-cache»: ο browser ρωτά τον server αν το αρχείο άλλαξε (ETag). Αν όχι, παίρνει την αντίγραφη από την cache (απάντηση 304, λίγα bytes).
    // Πριν, το ?v=<ώρα> έκανε το αρχείο «νέο» σε κάθε επίσκεψη και το ιστορικό κατέβαινε ολόκληρο κάθε φορά (D53).
    const r = await fetch(path, bust ? { cache: 'no-cache' } : undefined);
    if (!r.ok) throw new Error(`${path}: HTTP ${r.status}`);
    return r.json();
}

// Γεμίζει το κουτί επιλογής (ημέρες και μήνες) πριν ζωγραφιστεί οποιοδήποτε tab
function populateSelectors() {
    fillPickers();
    updatePicker();
}

// ==========================================
// 5. CAPACITY & DURATION (D56–D61)
// Οι εκτιμήσεις υπολογίζονται κάθε μέρα από το capacity.py (data/capacity.json)· η σελίδα μόνο τις δείχνει.
// Μόνο κωδικοί ΑΔΜΗΕ: δεν χρησιμοποιούνται ονόματα εταιρειών (D63).
// ==========================================
let capacityData = null, capSelectedUnit = null, capOpenUnit = null, capFleetChartInst = null, capUnitChartInst = null;

function applyCapacity(json) {
    capacityData = (json && Array.isArray(json.units) && json.units.length) ? json : null;
}
const classLabel = (n) => (n === null || n === undefined) ? '–' : (currentLang === 'el' ? `${n}ωρη` : `${n}h`);
const fillTpl = (txt, vars) => String(txt).replace(/\{(\w+)\}/g, (m, k) => (vars[k] !== undefined ? vars[k] : m));
const capColour = (unit) => { const reg = getUnitRegistry(); return reg.unitMode ? unitColour(unit, reg) : siteColour(reg.siteOf(unit), reg); };
const STATUS_TEXT_CLASS = { stable: 'text-lime-400', changing: 'text-orange-400', few_data: 'text-slate-400' };
const STATUS_DOT_CLASS = { stable: 'bg-lime-400', changing: 'bg-orange-400', few_data: 'bg-slate-500' };
const statusText = (st) => { const T = TT(); return st === 'stable' ? T.capStatusStable : st === 'changing' ? T.capStatusChanging : T.capStatusFew; };
const statusTip = (st) => { const T = TT(); return st === 'stable' ? T.capStatusTipStable : st === 'changing' ? T.capStatusTipChanging : T.capStatusTipFew; };
const capSortedUnits = () => [...capacityData.units].sort((a, b) => (b.energy_mwh || -1) - (a.energy_mwh || -1) || a.unit.localeCompare(b.unit));
const weekEnd = (w) => { const d = new Date(w + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + 6); return d.toISOString().substring(0, 10); };
const weekLabel = (w) => { const d = new Date(w + 'T00:00:00Z'); return pad2(d.getUTCDate()) + '/' + pad2(d.getUTCMonth() + 1); };

const capYear = () => String((capacityData && capacityData.as_of) || '').substring(0, 4);
const capDay = (iso) => fmtDay(iso, iso.substring(0, 4) === capYear());
const CHANGE_CLASS = { up: 'text-lime-400', down: 'text-orange-400', mixed: 'text-slate-300', dip: 'text-orange-400', surge: 'text-slate-300' };
const changeKindText = (k) => { const T = TT(); return { up: T.capChangeUp, down: T.capChangeDown, mixed: T.capChangeMixed, dip: T.capChangeDip, surge: T.capChangeSurge }[k] || k; };
function changeDetail(c) {
    const T = TT(), parts = [];
    if (c.power) parts.push(`${T.capChangePower}: ${fmtN(c.power.from)} → ${fmtN(c.power.to)} MW (${fmtN(c.power.pct, 0, true)}%)`);
    if (c.energy) parts.push(`${T.capChangeEnergy}: ${fmtN(c.energy.from)} → ${fmtN(c.energy.to)} MWh (${fmtN(c.energy.pct, 0, true)}%)`);
    if (c.kind === 'dip' || c.kind === 'surge') parts.push(fillTpl(T.capChangeLowest, { p: fmtN(c.extreme_power), e: fmtN(c.extreme_energy) }));
    else if (c.duration_from && c.duration_to) parts.push(`${fmtN(c.duration_from, 2)} → ${fmtN(c.duration_to, 2)} h`);
    return parts.join(' · ');
}
function changeHtml(c, withUnit) {
    const T = TT();
    const episode = c.kind === 'dip' || c.kind === 'surge';
    const when = episode ? `${capDay(c.date)} – ${capDay(c.date_to)}` : capDay(c.since || c.date);
    const cls = (c.class_from && c.class_to && c.class_from !== c.class_to)
        ? `<span class="rounded-full border border-acc-400/60 px-2 py-0.5 text-[11px] font-bold text-acc-300">${escapeHtml(classLabel(c.class_from))} → ${escapeHtml(classLabel(c.class_to))}</span>` : '';
    const pend = c.confirmed ? '' : `<span class="rounded border border-orange-500/40 bg-orange-500/10 px-1.5 py-0.5 text-[10px] font-bold text-orange-400">${escapeHtml(T.capPending)}</span>`;
    const unit = withUnit ? `<button type="button" data-cap-unit="${escapeHtml(c.unit)}" class="font-bold text-slate-100 hover:text-acc-300">${escapeHtml(c.unit)}</button>` : '';
    return `<li class="py-2"><div class="flex flex-wrap items-baseline gap-x-2 gap-y-1"><span class="text-slate-400 tabular-nums text-sm">${escapeHtml(when)}</span>${unit}<span class="text-xs font-semibold ${CHANGE_CLASS[c.kind] || 'text-slate-300'}">${escapeHtml(changeKindText(c.kind))}</span>${cls}${pend}</div><div class="text-xs text-slate-300 mt-0.5">${escapeHtml(changeDetail(c))}</div></li>`;
}

function capDetailHtml(u) {
    const T = TT();
    const row = (k, v) => `<div class="flex justify-between gap-4 py-0.5"><span class="text-slate-400">${escapeHtml(k)}</span><span class="text-slate-200 text-right">${v}</span></div>`;
    const pctTxt = (v) => (v === null || v === undefined) ? '–' : fmtN(v, 0, true) + '%';
    const left = row(T.capChargeEnergy, u.energy_charge_mwh ? fmtN(u.energy_charge_mwh) + ' MWh' : '–')
        + row(T.capFirstSeen, capDay(u.first_seen))
        + row(T.capCycles, `${u.valid_30} / ${u.cycles_30}`)
        + row(T.capTrend, `${pctTxt(u.trend_power_pct)} MW · ${pctTxt(u.trend_energy_pct)} MWh`)
        + row(T.capAnomalies, String(u.anomaly_days_30));
    const ch = (u.changes || []).slice().reverse();
    const right = `<div class="text-xs font-semibold text-slate-300 mb-1">${escapeHtml(T.capUnitChangesTitle)}</div>`
        + (ch.length ? `<ul class="divide-y divide-slate-700/40">${ch.map(c => changeHtml(c, false)).join('')}</ul>` : `<p class="text-slate-500">${escapeHtml(T.capUnitNoChanges)}</p>`);
    return `<div class="grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-3 text-xs"><div><div class="text-xs font-semibold text-slate-300 mb-1">${escapeHtml(T.capMeasured)}</div>${left}</div><div>${right}</div></div>`;
}

function renderCapacityChanges() {
    const T = TT(), ul = document.getElementById('capChangeList');
    if (!ul || !capacityData) return;
    const list = (capacityData.changes && capacityData.changes.latest) || [];
    ul.innerHTML = list.length ? list.map(c => changeHtml(c, true)).join('') : `<li class="py-3 text-sm text-slate-500">${escapeHtml(T.capChangesNone)}</li>`;
    ul.querySelectorAll('[data-cap-unit]').forEach(b => b.addEventListener('click', () => { capOpenUnit = null; capSelect(b.dataset.capUnit); const t = document.getElementById('capUnitChart'); if (t && t.scrollIntoView) t.scrollIntoView({ behavior: 'smooth', block: 'center' }); }));
}

function renderCapacityTable() {
    const T = TT(), tb = document.getElementById('capTbody');
    if (!tb || !capacityData) return;
    tb.innerHTML = '';
    capSortedUnits().forEach(u => {
        const prov = u.status !== 'stable', hasEst = !!(u.energy_mwh && u.power_mw);
        const badge = u.class_h
            ? `<span class="inline-block rounded-full border ${prov ? 'border-dashed border-slate-500 text-slate-300' : 'border-acc-400/60 text-acc-300'} px-2 py-0.5 text-[11px] font-bold"${prov ? ` title="${escapeHtml(T.capProvisional)}"` : ''}>${escapeHtml(classLabel(u.class_h))}${prov ? '*' : ''}</span>`
            : '<span class="text-slate-500">–</span>';
        const tr = document.createElement('tr');
        tr.className = 'cap-row cursor-pointer hover:bg-slate-700/40 transition-colors' + (u.unit === capSelectedUnit ? ' bg-slate-700/30' : '') + (u.status === 'few_data' ? ' text-slate-400' : '');
        tr.dataset.unit = u.unit;
        tr.innerHTML =
            `<td class="p-2 md:p-3 font-bold text-slate-100 whitespace-nowrap"><span class="inline-block w-2.5 h-2.5 rounded-sm mr-1.5 align-middle" style="background:${capColour(u.unit)}"></span>${escapeHtml(u.unit)}${u.status !== 'stable' ? `<div class="md:hidden text-[10px] font-semibold ${STATUS_TEXT_CLASS[u.status]} leading-tight mt-0.5">${escapeHtml(statusText(u.status))}</div>` : ''}</td>` +
            `<td class="p-2 md:p-3 text-right">${u.power_mw ? fmtN(u.power_mw) : '–'}</td>` +
            `<td class="p-2 md:p-3 text-right">${hasEst || u.energy_mwh ? fmtN(u.energy_mwh) : '–'}</td>` +
            `<td class="p-2 md:p-3 text-right">${badge}<div class="text-[11px] text-slate-400 mt-0.5">${u.duration_h ? fmtN(u.duration_h, 2) + ' h' : '–'}</div></td>` +
            `<td class="p-3 hidden md:table-cell"><span class="${STATUS_TEXT_CLASS[u.status]} text-xs font-semibold" title="${escapeHtml(statusTip(u.status))}">● ${escapeHtml(statusText(u.status))}</span></td>`;
        const detail = document.createElement('tr');
        detail.className = 'cap-detail bg-slate-800/30' + (capOpenUnit === u.unit ? '' : ' hidden');
        detail.innerHTML = `<td colspan="5" class="p-3 md:p-4">${capDetailHtml(u)}</td>`;
        tr.onclick = () => capSelect(u.unit);
        tb.appendChild(tr); tb.appendChild(detail);
    });
}

function capSelect(unit) {
    capOpenUnit = (capOpenUnit === unit) ? null : unit;
    capSelectedUnit = unit;
    renderCapacityTable();
    renderCapacityUnitChart();
}

function renderCapacityKpis() {
    const T = TT(), units = capSortedUnits(), box = document.getElementById('capKpis');
    if (!box) return;
    const est = units.filter(u => u.power_mw && u.energy_mwh);
    const mw = est.reduce((a, u) => a + u.power_mw, 0), mwh = est.reduce((a, u) => a + u.energy_mwh, 0);
    const cnt = (st) => units.filter(u => u.status === st).length;
    const tile = (label, value, unit, sub) => `<div class="bg-slate-900/50 border border-slate-700/60 rounded-lg p-3"><div class="text-xs text-slate-400">${escapeHtml(label)}</div><div class="text-xl font-bold text-slate-100 mt-0.5">${value}${unit ? ` <span class="text-xs font-normal text-slate-500">${escapeHtml(unit)}</span>` : ''}</div><div class="text-[11px] text-slate-500 mt-0.5">${escapeHtml(sub)}</div></div>`;
    box.innerHTML = tile(T.capKpiPower, fmtN(mw), 'MW', fillTpl(T.capKpiPowerSub, { n: est.length }))
        + tile(T.capKpiEnergy, fmtN(mwh), 'MWh', T.capKpiEnergySub)
        + tile(T.capKpiDuration, mw ? fmtN(mwh / mw, 2) : '–', 'h', T.capKpiDurationSub)
        + tile(T.capKpiUnits, String(units.length), '', fillTpl(T.capKpiUnitsSub, { s: cnt('stable'), c: cnt('changing'), f: cnt('few_data') }));
}

function renderCapacityFleetChart() {
    const T = TT(), cv = document.getElementById('capFleetChart');
    if (!cv || !capacityData) return;
    const wk = (capacityData.fleet && capacityData.fleet.weekly) || [];
    if (capFleetChartInst) capFleetChartInst.destroy();
    capFleetChartInst = new Chart(cv.getContext('2d'), {
        type: 'line',
        data: { labels: wk.map(w => weekLabel(w.w)), datasets: [
            { label: T.capSeriesEnergy, data: wk.map(w => w.mwh), borderColor: COLORS.fleetEnergy, backgroundColor: rgba(COLORS.fleetEnergy, 0.15), fill: true, tension: 0.25, pointRadius: 2, yAxisID: 'y' },
            { label: T.capSeriesPower, data: wk.map(w => w.mw), borderColor: COLORS.fleetPower, tension: 0.25, pointRadius: 2, yAxisID: 'y' },
            { label: T.capSeriesDuration, data: wk.map(w => w.h), borderColor: COLORS.duration, borderDash: [5, 4], tension: 0.25, pointRadius: 0, yAxisID: 'y2' }
        ] },
        options: {
            responsive: true, maintainAspectRatio: false, interaction: { mode: 'index', intersect: false },
            plugins: { legend: { position: 'top' }, tooltip: tipOff(i => {
                const w = wk[i]; if (!w) return '';
                return tipHead(`${fmtDay(w.w)} – ${fmtDay(weekEnd(w.w))}`, `${w.units} ${T.capUnitsWord}`)
                    + tipRow(T.capSeriesEnergy.replace(/ \(MWh\)$/, ''), fmtN(w.mwh), COLORS.fleetEnergy, { strong: true })
                    + tipRow(T.capSeriesPower.replace(/ \(MW\)$/, ''), fmtN(w.mw), COLORS.fleetPower, { unit: 'MW' })
                    + tipRule + tipRow(T.capKpiDuration, fmtN(w.h, 2), COLORS.duration, { unit: 'h' });
            }) },
            scales: {
                x: { grid: { display: false }, ticks: { autoSkip: true, maxRotation: 45, maxTicksLimit: isPhone() ? 7 : 14 } },
                y: { beginAtZero: true, grid: { color: '#334155' }, ticks: yTicks, title: { display: true, text: 'MW / MWh' } },
                y2: { position: 'right', min: 1, max: 4, grid: { display: false }, ticks: { callback: (v) => fmtN(v, 1) }, title: { display: true, text: 'h' } }
            }
        }
    });
}

function renderCapacityUnitChart() {
    const T = TT(), cv = document.getElementById('capUnitChart');
    if (!cv || !capacityData) return;
    const u = capacityData.units.find(x => x.unit === capSelectedUnit) || capSortedUnits()[0];
    if (!u) return;
    capSelectedUnit = u.unit;
    document.getElementById('capUnitTitle').textContent = `${fillTpl(T.capUnitTitle, { u: u.unit })} · ${statusText(u.status)}`;
    const sr = u.series || {};
    if (capUnitChartInst) { capUnitChartInst.destroy(); capUnitChartInst = null; }
    if (!sr.start || !sr.e || !sr.e.length) { document.getElementById('capUnitSub').textContent = T.capUnitNoSeries; return; }
    document.getElementById('capUnitSub').textContent = T.capUnitSub;
    const start = new Date(sr.start + 'T00:00:00Z'), n = sr.e.length;
    const isoAt = (i) => { const d = new Date(start.getTime() + i * 86400000); return d.toISOString().substring(0, 10); };
    const labels = Array.from({ length: n }, (_, i) => { const d = new Date(start.getTime() + i * 86400000); return pad2(d.getUTCDate()) + '/' + pad2(d.getUTCMonth() + 1); });
    // σημάδια: η αλλαγή στη θέση της πρώτης ημέρας ανίχνευσης (επεισόδια: στην αρχή τους)
    const marks = new Array(n).fill(null), markInfo = {};
    (u.changes || []).forEach(c => {
        const i = Math.round((new Date(c.date + 'T00:00:00Z').getTime() - start.getTime()) / 86400000);
        if (i >= 0 && i < n) { marks[i] = sr.e[i] || sr.p[i]; markInfo[i] = c; }
    });
    capUnitChartInst = new Chart(cv.getContext('2d'), {
        type: 'line',
        data: { labels, datasets: [
            { label: T.capSeriesUnitEnergy, data: sr.e, borderColor: COLORS.fleetEnergy, backgroundColor: rgba(COLORS.fleetEnergy, 0.15), fill: true, spanGaps: true, tension: 0, pointRadius: 0, borderWidth: 2 },
            { label: T.capSeriesUnitPower, data: sr.p, borderColor: COLORS.fleetPower, spanGaps: true, tension: 0, pointRadius: 0, borderWidth: 2 },
            { label: T.capSeriesMarker, data: marks, showLine: false, pointStyle: 'triangle', pointRadius: 7, pointHoverRadius: 8, borderColor: '#f1f5f9', backgroundColor: '#0f172a', borderWidth: 2 }
        ] },
        options: {
            responsive: true, maintainAspectRatio: false, interaction: { mode: 'index', intersect: false },
            plugins: { legend: { position: 'top' }, tooltip: tipOff(i => {
                const c = markInfo[i];
                let html = tipHead(capDay(isoAt(i)), u.unit)
                    + tipRow(T.capSeriesUnitEnergy.replace(/ \(MWh\)$/, ''), sr.e[i] ? fmtN(sr.e[i]) : '–', COLORS.fleetEnergy, { strong: true, unit: 'MWh' })
                    + tipRow(T.capSeriesUnitPower.replace(/ \(MW\)$/, ''), sr.p[i] ? fmtN(sr.p[i]) : '–', COLORS.fleetPower, { unit: 'MW' });
                if (c) html += tipRule + `<div class="text-[13px] font-semibold ${CHANGE_CLASS[c.kind] || 'text-slate-200'}">${escapeHtml(changeKindText(c.kind))}${c.confirmed ? '' : ' · ' + escapeHtml(T.capPending)}</div><div class="text-[11px] text-slate-300 mt-0.5">${escapeHtml(changeDetail(c))}</div>`
                    + ((c.class_from && c.class_to && c.class_from !== c.class_to) ? `<div class="text-[11px] text-acc-300 mt-0.5">${escapeHtml(classLabel(c.class_from))} → ${escapeHtml(classLabel(c.class_to))}</div>` : '');
                return html;
            }) },
            scales: {
                x: { grid: { display: false }, ticks: { autoSkip: true, maxRotation: 45, maxTicksLimit: isPhone() ? 7 : 14 } },
                y: { beginAtZero: true, grid: { color: '#334155' }, ticks: yTicks, title: { display: true, text: 'MW / MWh' } }
            }
        }
    });
}

function renderCapacityRecords() {
    const T = TT(), c = capacityData, rec = c && c.records, cards = document.getElementById('capRecCards'), ev = document.getElementById('capRecEvents');
    if (!rec || !cards || !ev) return;
    const first = c.data_from || null;
    document.getElementById('capRecSub').textContent = fillTpl(T.capRecSub, { d: first ? fmtDay(first) : '–' });
    const META = {
        fleet_dis_mw: [T.capRecFleetDisMw, 'MW', true], fleet_chg_mw: [T.capRecFleetChgMw, 'MW', true],
        fleet_dis_mwh: [T.capRecFleetDisMwh, 'MWh', false], fleet_chg_mwh: [T.capRecFleetChgMwh, 'MWh', false]
    };
    const asOf = new Date((c.as_of || '1970-01-01') + 'T00:00:00Z').getTime();
    const isNew = (d) => (asOf - new Date(d + 'T00:00:00Z').getTime()) / 86400000 <= 6;
    cards.innerHTML = rec.cards.map(r => {
        const m = META[r.metric]; if (!m) return '';
        const when = fmtDay(r.date) + (m[2] && r.hour ? ` · ${hourRange(r.hour)}` : '');
        const badge = isNew(r.date) ? `<span class="ml-1.5 rounded bg-lime-500/15 border border-lime-500/30 px-1.5 py-0.5 text-[10px] font-bold text-lime-400">${escapeHtml(T.capNew)}</span>` : '';
        return `<div class="bg-slate-900/50 border border-slate-700/60 rounded-lg p-3"><div class="text-xs text-slate-400">${escapeHtml(m[0])}</div><div class="text-xl font-bold text-slate-100 mt-0.5">${fmtN(r.value)} <span class="text-xs font-normal text-slate-500">${m[1]}</span></div><div class="text-[11px] text-slate-500 mt-0.5">${escapeHtml(when)}${badge}</div></div>`;
    }).join('');
    const sameYear = rec.events.every(e => e.date.substring(0, 4) === String(c.as_of).substring(0, 4));
    const dd = (iso) => fmtDay(iso, sameYear);
    ev.innerHTML = rec.events.slice(0, 10).map(e => {
        const m = META[e.metric]; if (!m) return '';
        const prev = e.prev ? ` <span class="text-slate-500">(${escapeHtml(fillTpl(T.capRecPrev, { v: fmtN(e.prev), d: dd(e.prev_date) }))})</span>` : '';
        return `<li class="py-1.5 flex flex-wrap items-baseline gap-x-2"><span class="text-slate-400 tabular-nums shrink-0">${escapeHtml(dd(e.date))}</span><span>${escapeHtml(m[0])}: <strong class="text-slate-100">${fmtN(e.value)} ${m[1]}</strong>${prev}</span></li>`;
    }).join('');
}

function renderCapacityTab() {
    const T = TT(), body = document.getElementById('capBody');
    if (!body) return;
    hideChartTip();
    const empty = document.getElementById('capEmpty'), charts = document.getElementById('capCharts'), rec = document.getElementById('capRecords');
    if (!capacityData) {
        empty.textContent = T.capEmpty; empty.classList.remove('hidden');
        [body, charts, rec, document.getElementById('capChanges')].forEach(el => { if (el) el.classList.add('hidden'); });
        document.getElementById('capSub').textContent = '';
        return;
    }
    const chg = document.getElementById('capChanges');
    if (chg) chg.classList.remove('hidden');
    empty.classList.add('hidden'); [body, charts, rec].forEach(el => el.classList.remove('hidden'));
    if (!capSelectedUnit || !capacityData.units.some(u => u.unit === capSelectedUnit)) capSelectedUnit = capSortedUnits()[0].unit;
    document.getElementById('capSub').textContent = fillTpl(T.capSub, { d: fmtDay(capacityData.as_of) });
    document.getElementById('capFootnote').textContent = T.capFootnote;
    renderCapacityKpis();
    renderCapacityTable();
    renderCapacityChanges();
    renderCapacityFleetChart();
    renderCapacityUnitChart();
    renderCapacityRecords();
}

async function boot() {
    applyChartDefaults();
    // Γλώσσα (kp_lang) και κουμπιά GR | EN
    try { changeLang(currentLang); } catch (e) { console.warn('Αποτυχία φόρτωσης μετάφρασης:', e); }
    try {
        // Βήμα 1: πραγματική πρόοδος (2 αρχεία: meta + ιστορικό), με ελάχιστο χρόνο ανάγνωσης
        loadActivate(1);
        const t0 = Date.now();
        const files = [
            getJSON('data/meta.json', true).catch((e) => { console.warn('meta.json', e); return null; }),   // όχι κρίσιμο
            getJSON(API_URL, true),
            getJSON('data/capacity.json', true).catch((e) => { console.warn('capacity.json', e); return null; })    // όχι κρίσιμο: το tab δείχνει «δεν υπάρχουν εκτιμήσεις»
        ];
        let done = 0;
        const [meta, json, capJson] = await Promise.all(files.map((p) => p.then((v) => { loadSet(1, Math.round(++done / files.length * 100)); return v; })));
        if (!json || !Array.isArray(json.isp) || json.isp.length === 0) throw new Error('historical.json is empty');
        applyData(json);
        applyCapacity(capJson);
        metaData = meta;
        updateHeader();
        await pause(Math.max(0, LOAD_MIN_READ - (Date.now() - t0)));
        loadDone(1);
        await pause(LOAD_STEP);

        // Βήματα 2…5: ένα ανά tab, με τη σειρά των tabs
        populateSelectors();
        await loadStep(2, async () => { switchTab('daily'); });
        await loadStep(3, async () => { updateMonthlyDashboard(); });
        await loadStep(4, async () => { updateSurplusDashboard(); });
        await loadStep(5, async () => { renderArbitrageTab(); });
        await loadStep(6, async () => { renderCapacityTab(); });

        document.getElementById('mainSpinner').classList.add('hidden');
        document.getElementById('loadRowFinal').classList.remove('opacity-0', 'translate-y-2');
        await pause(LOAD_READY);
        const ov = document.getElementById('loading-overlay');
        ov.classList.add('opacity-0');
        setTimeout(() => { ov.style.display = 'none'; }, 500);
    } catch (err) { loadFailed(err); }
}

// Τα scripts είναι defer, οπότε το Chart.js και το data.js έχουν ήδη φορτώσει εδώ.
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
else boot();
