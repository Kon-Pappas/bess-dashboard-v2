// Πλέον διαβάζουμε το τοπικό αρχείο που παράγει το Python script!
const API_URL = "data/historical.json";

let rawData = { isp: [], scada: [], surplus: [], pump: [], bessHourly: [], mcpHourly: [], surplusHourly: [], pumpHourly: [] };
let currentLang = 'en';
// D04 (όπως live D10 / Flows): αγγλικά από προεπιλογή· η τελευταία επιλογή του επισκέπτη κρατιέται στον browser του,
// στο κοινό κλειδί kp_lang, οπότε η γλώσσα τον ακολουθεί σε όλο το hub.
try { const l = localStorage.getItem('kp_lang'); if (l === 'el' || l === 'en') currentLang = l; } catch (e) { /* ιδιωτική περιήγηση */ }
let metaData = null;   // data/meta.json: πότε έγινε η τελευταία λήψη και πότε η επόμενη (D06)

// Μεθοδολογία: δύο εκδόσεις κειμένου (σύντομη / αναλυτική)
let methodologyView = 'short';
function renderMethodologyBody() {
    const t = i18n[currentLang] || i18n.en;
    const body = document.getElementById('modalBody');
    if (body) body.innerHTML = (methodologyView === 'full') ? t.modalBodyFull : t.modalBodyShort;
    const on = 'flex-1 px-3 py-1.5 rounded-md text-xs font-semibold bg-acc-400 text-slate-900 transition';
    const off = 'flex-1 px-3 py-1.5 rounded-md text-xs font-semibold text-slate-400 hover:text-slate-200 transition';
    const bs = document.getElementById('methodTabShort'), bf = document.getElementById('methodTabFull');
    if (bs) { bs.className = (methodologyView === 'short') ? on : off; bs.setAttribute('aria-pressed', methodologyView === 'short'); }
    if (bf) { bf.className = (methodologyView === 'full') ? on : off; bf.setAttribute('aria-pressed', methodologyView === 'full'); }
}
function setMethodologyView(view) {
    methodologyView = (view === 'full') ? 'full' : 'short';
    renderMethodologyBody();
    const body = document.getElementById('modalBody');
    if (body) body.scrollTop = 0;
}

const i18n = {
    el: {
        title: "Greek BESS Market Analytics",
        source: "Πηγή δεδομένων: Επίσημα αρχεία ISP & SCADA - ΑΔΜΗΕ (IPTO)",
        scopeTooltip: "Αφορά αποκλειστικά τις μονάδες BESS στο Σύστημα Μεταφοράς (ΑΔΜΗΕ). Δεν περιλαμβάνονται τα συστήματα στο Δίκτυο Διανομής (ΔΕΔΔΗΕ).",
        locale: "el-GR",
        today: "σήμερα",
        pillComplete: "Πλήρη δεδομένα",
        pillPending: "Εκκρεμεί SCADA",
        btnMethodologyShort: "Μεθοδολογία",
        methodLink: "Μεθοδολογία →",
        load: { title: "Εκκίνηση", g1: "Λήψη δεδομένων", g2: "Προετοιμασία προβολών", s1: "Ανάγνωση δεδομένων", ready: "Το dashboard είναι έτοιμο!", error: "Τα δεδομένα δεν φορτώθηκαν. Ανανεώστε τη σελίδα σε λίγα λεπτά." },
        lastUpdate: "Τελευταία ενημέρωση:",
        lastUpdateShort: "Ενημέρωση:",
        nextUpdateShort: "Επόμενη:",
        nextUpdate: "Επόμενη ενημέρωση:",
        dateLabel: "Ημερομηνία:",
        monthLabel: "Μήνας:",
        tabDaily: "Ημερήσια Ανάλυση",
        tabMonthly: "Μηνιαίος Αντίκτυπος",
        tabSurplus: "Πλεόνασμα & Ευελιξία",
        tabArbitrage: "Arbitrage P&L",
        btnMethodology: "Μεθοδολογία & Παραδοχές",
        modalTitle: "Μεθοδολογία & Βασικές Παραδοχές",
        modalBodyShort: `
            <p class="mb-1 text-slate-300">Ανεξάρτητο εργαλείο πάνω σε ανοιχτά δεδομένα. Τα νούμερα είναι εκτιμήσεις και ενδείξεις, όχι επίσημα στοιχεία.</p>
            <h3 class="mt-4 mb-2 text-[11px] font-bold uppercase tracking-wider text-acc-400" data-sec="all" style="scroll-margin-top:8px">Όλα τα tabs</h3>
            <ul class="list-disc pl-5 space-y-2 text-slate-400">
                <li><strong class="text-slate-200">Εύρος:</strong> μόνο οι μονάδες BESS του Συστήματος Μεταφοράς (ΑΔΜΗΕ). Δεν περιλαμβάνονται συστήματα στο Δίκτυο Διανομής (ΔΕΔΔΗΕ).</li>
                <li><strong class="text-slate-200">Πηγές:</strong> ΑΔΜΗΕ (ISP = πρόγραμμα, SCADA = πραγματική λειτουργία, μη πιστοποιημένο) και ENTSO-E (τιμές MCP). Ενημέρωση καθημερινά. Μετρήσεις SCADA για BESS υπάρχουν από 18/6.</li>
                <li><strong class="text-slate-200">⏱ Ευθυγράμμιση ωρών:</strong> το SCADA είναι μία ώρα μπροστά από την αγορά. Με το checkbox ενεργό (προεπιλογή), η ώρα SCADA h αντιστοιχεί στην ώρα MCP h−1. Στηρίζεται σε στατιστική συσχέτιση, όχι σε τεκμηρίωση του ΑΔΜΗΕ.</li>
            </ul>
            <h3 class="mt-4 mb-2 text-[11px] font-bold uppercase tracking-wider text-acc-400" data-sec="daily" style="scroll-margin-top:8px">Ημερήσια Ανάλυση</h3>
            <ul class="list-disc pl-5 space-y-2 text-slate-400">
                <li><strong class="text-slate-200">Σύνολα &amp; RTE:</strong> το «TOTAL BESS» είναι το άθροισμα των μονάδων. Το ημερήσιο RTE αλλοιώνεται από μεταφορά φόρτισης στην επόμενη μέρα, οπότε διάβασέ το σε μεγαλύτερα διαστήματα.</li>
            </ul>
            <h3 class="mt-4 mb-2 text-[11px] font-bold uppercase tracking-wider text-acc-400" data-sec="monthly" style="scroll-margin-top:8px">Μηνιαίος Αντίκτυπος</h3>
            <ul class="list-disc pl-5 space-y-2 text-slate-400">
                <li><strong class="text-slate-200">Αποφυγή περικοπών:</strong> μετράει μόνο φόρτιση όταν η τιμή MCP είναι ≤ 5 €/MWh. Η υποκατάσταση θερμικών μονάδων είναι θεωρητική.</li>
            </ul>
            <h3 class="mt-4 mb-2 text-[11px] font-bold uppercase tracking-wider text-acc-400" data-sec="surplus" style="scroll-margin-top:8px">Πλεόνασμα &amp; Ευελιξία</h3>
            <ul class="list-disc pl-5 space-y-2 text-slate-400">
                <li><strong class="text-slate-200">Residual &amp; απορρόφηση:</strong> το residual προέρχεται από το ISP (πρόγραμμα, χωρίς εξαγωγές). Μετράει μόνο η φόρτιση BESS και PUMP στις ώρες πλεονάσματος· η υπόλοιπη (γκρι) θεωρείται arbitrage. Η εικόνα είναι ενδεικτική.</li>
            </ul>
            <h3 class="mt-4 mb-2 text-[11px] font-bold uppercase tracking-wider text-acc-400" data-sec="arbitrage" style="scroll-margin-top:8px">Arbitrage P&amp;L</h3>
            <ul class="list-disc pl-5 space-y-2 text-slate-400">
                <li><strong class="text-slate-200">Έσοδα:</strong> μόνο Αγορά Επόμενης Ημέρας, στο MCP. Δεν περιλαμβάνονται εξισορρόπηση, επικουρικές υπηρεσίες, χρεώσεις και φόροι. Είναι ακαθάριστη εκτίμηση, όχι λογιστικό αποτέλεσμα.</li>
            </ul>
        `,
        modalBodyFull: `
            <p class="mb-1 text-slate-300">Το Dashboard είναι ένα ανεξάρτητο εργαλείο παρακολούθησης των μονάδων αποθήκευσης (BESS) στην ελληνική αγορά, βασισμένο σε ανοιχτά δεδομένα. Τα νούμερα είναι εκτιμήσεις και ενδείξεις, όχι επίσημα στοιχεία.</p>
            <h3 class="mt-4 mb-2 text-[11px] font-bold uppercase tracking-wider text-acc-400" data-sec="all" style="scroll-margin-top:8px">Όλα τα tabs</h3>
            <ul class="list-disc pl-5 space-y-2 text-slate-400">
                <li><strong class="text-slate-200">Εύρος:</strong> αφορά αποκλειστικά τις μονάδες BESS που είναι συνδεδεμένες στο Σύστημα Μεταφοράς (ΑΔΜΗΕ) και εμφανίζονται στα αρχεία του. Δεν περιλαμβάνονται συστήματα στο Δίκτυο Διανομής (ΔΕΔΔΗΕ).</li>
                <li><strong class="text-slate-200">Πηγές:</strong> ΑΔΜΗΕ ISP (προγραμματισμός), ΑΔΜΗΕ System Realization SCADA (πραγματική λειτουργία, με στοιχεία που ο ΑΔΜΗΕ χαρακτηρίζει μη πιστοποιημένα) και ENTSO-E (τιμές Αγοράς Επόμενης Ημέρας, MCP).</li>
                <li><strong class="text-slate-200">Ενημέρωση:</strong> καθημερινά το πρωί. Οι τελευταίες 5 ημέρες ελέγχονται ξανά, ώστε να πιάνονται καθυστερημένες δημοσιεύσεις και διορθώσεις.</li>
                <li><strong class="text-slate-200">Διαθεσιμότητα:</strong> ISP και MCP από 1/6/2026. SCADA για τις μονάδες BESS από 18/6/2026 (πριν από αυτή την ημερομηνία δεν υπάρχουν μετρήσεις). SCADA για την άντληση (PUMP) από 1/6/2026.</li>
                <li><strong class="text-slate-200">Ώρες και τιμές:</strong> η αγορά (MCP, ISP) χρησιμοποιεί την ώρα CET, ενώ το SCADA την ελληνική ώρα (μία ώρα μπροστά). Η αγορά λειτουργεί με 15λεπτα και η τιμή κάθε ώρας είναι ο μέσος όρος των τεσσάρων τετάρτων.</li>
                <li><strong class="text-slate-200">⏱ Ευθυγράμμιση ωρών:</strong> όταν είναι ενεργή, που είναι και η προεπιλογή, η ώρα SCADA h αντιστοιχεί στην ώρα MCP h−1, και το ISP ακολουθεί το ρολόι της αγοράς. Η παραδοχή στηρίζεται σε στατιστική συσχέτιση: οι ώρες πλεονάσματος του ISP συμπίπτουν με τις ώρες χαμηλής τιμής χωρίς μετατόπιση, ενώ η φόρτιση BESS και η άντληση ταιριάζουν καλύτερα με την τιμή της προηγούμενης ώρας. Δεν έχει επιβεβαιωθεί από τεκμηρίωση του ΑΔΜΗΕ. Επηρεάζει τα tabs Μηνιαίος Αντίκτυπος, Πλεόνασμα &amp; Ευελιξία και Arbitrage P&amp;L.</li>
            </ul>
            <h3 class="mt-4 mb-2 text-[11px] font-bold uppercase tracking-wider text-acc-400" data-sec="daily" style="scroll-margin-top:8px">Ημερήσια Ανάλυση</h3>
            <ul class="list-disc pl-5 space-y-2 text-slate-400">
                <li><strong class="text-slate-200">ISP και SCADA:</strong> το ISP δείχνει τι προγραμματίστηκε και το SCADA τι πραγματοποιήθηκε. Διαφορές ανάμεσά τους είναι αναμενόμενες.</li>
                <li><strong class="text-slate-200">Σύνολα:</strong> η ημερήσια φόρτιση και αποφόρτιση κάθε μονάδας είναι το άθροισμα των ωριαίων τιμών (στο ISP, των τετάρτων). Το «TOTAL BESS» είναι το άθροισμα των μονάδων, δηλαδή η πραγματική φυσική φόρτιση και αποφόρτιση. Δεν είναι η γραμμή TOTAL του ΑΔΜΗΕ, που συμψηφίζει τις μονάδες ανά ώρα και δίνει χαμηλότερες τιμές.</li>
                <li><strong class="text-slate-200">Απόδοση κύκλου (RTE):</strong> ημερήσιο AC-to-AC, δηλαδή αποφόρτιση ÷ φόρτιση. Ακραίες τιμές (πάνω από ~92% ή κάτω από ~83%, και μερικές φορές πάνω από 100% σε μία μονάδα) οφείλονται συχνά στο φαινόμενο <em>Inter-day SoC Carryover</em>, όπου η μπαταρία κρατά ενέργεια για την επόμενη μέρα. Το RTE είναι πιο αξιόπιστο σε μεγαλύτερα διαστήματα ή στο σύνολο του στόλου.</li>
            </ul>
            <h3 class="mt-4 mb-2 text-[11px] font-bold uppercase tracking-wider text-acc-400" data-sec="monthly" style="scroll-margin-top:8px">Μηνιαίος Αντίκτυπος</h3>
            <ul class="list-disc pl-5 space-y-2 text-slate-400">
                <li><strong class="text-slate-200">Αποφόρτιση και θερμική υποκατάσταση:</strong> θεωρητική μετρική. Υποθέτει ότι κάθε MWh αποφόρτισης BESS υποκαθιστά ακριβότερη θερμική παραγωγή (φυσικό αέριο ή λιγνίτη). Δεν μετράται η πραγματική υποκατάσταση.</li>
                <li><strong class="text-slate-200">Φόρτιση και αποφυγή περικοπών ΑΠΕ:</strong> μετράει μόνο η φόρτιση σε ώρες με τιμή MCP ≤ 5 €/MWh, δηλαδή όταν οι ΑΠΕ κορέννυνται και η τιμή πέφτει περίπου στο μηδέν. Η φόρτιση σε υψηλότερες τιμές (π.χ. νυχτερινό arbitrage) δεν μετράει. Το όριο των 5 € είναι σταθερό.</li>
            </ul>
            <h3 class="mt-4 mb-2 text-[11px] font-bold uppercase tracking-wider text-acc-400" data-sec="surplus" style="scroll-margin-top:8px">Πλεόνασμα &amp; Ευελιξία</h3>
            <ul class="list-disc pl-5 space-y-2 text-slate-400">
                <li><strong class="text-slate-200">Residual surplus:</strong> προέρχεται από τη γραμμή <em>Energy Surplus</em> του ISP και είναι το πλεόνασμα που απομένει μετά τον προγραμματισμό. Είναι πρόγραμμα και όχι μέτρηση, και δεν λαμβάνει υπόψη τις εξαγωγές.</li>
                <li><strong class="text-slate-200">Θεωρητικό πλεόνασμα:</strong> residual + φόρτιση BESS + φόρτιση PUMP στις ώρες πλεονάσματος. «Ώρα πλεονάσματος» είναι κάθε ώρα με residual ISP τουλάχιστον 1 MWh, με τις ώρες ευθυγραμμισμένες στην ελληνική ώρα.</li>
                <li><strong class="text-slate-200">Φόρτιση εκτός ωρών πλεονάσματος (γκρι):</strong> θεωρείται arbitrage και δεν μετράει ως απορρόφηση πλεονάσματος.</li>
                <li><strong class="text-slate-200">Μερίδια απορρόφησης:</strong> το μερίδιο του BESS ή της άντλησης στο θεωρητικό πλεόνασμα, ανά μήνα στα KPI και ανά ημέρα στο tooltip. Τα KPI υπολογίζονται μόνο σε ημέρες με πλήρη δεδομένα BESS, PUMP και ISP.</li>
                <li><strong class="text-slate-200">«Μέρες residual &gt; ευελιξία»:</strong> ημέρες όπου το residual ξεπέρασε όση ενέργεια απορρόφησαν BESS και PUMP στις ώρες πλεονάσματος. Δεν σημαίνει ότι η ευελιξία είχε εξαντλήσει τη δυναμικότητά της.</li>
                <li><strong class="text-slate-200">Ωριαίο προφίλ:</strong> μέση ημέρα του μήνα σε ελληνική ώρα, μόνο από ημέρες με δεδομένα και από τις τέσσερις πηγές (BESS, PUMP, ISP, MCP). «Μέρες υψηλού πλεονάσματος» είναι το ανώτερο 25% του μήνα με βάση το ημερήσιο residual.</li>
                <li><strong class="text-slate-200">Πώς να διαβάζεται:</strong> ενδεικτικά. Οι εξαγωγές δεν περιλαμβάνονται, άρα η απορρόφηση υποτιμάται. Η φόρτιση arbitrage που πέφτει σε ώρες πλεονάσματος μετράει ως απορρόφηση, άρα υπερτιμάται.</li>
            </ul>
            <h3 class="mt-4 mb-2 text-[11px] font-bold uppercase tracking-wider text-acc-400" data-sec="arbitrage" style="scroll-margin-top:8px">Arbitrage P&amp;L</h3>
            <ul class="list-disc pl-5 space-y-2 text-slate-400">
                <li><strong class="text-slate-200">Έσοδα:</strong> αποκλειστικά από την Αγορά Επόμενης Ημέρας (DAM). Ως price-taker, κάθε μονάδα αγοράζει και πουλά στο MCP: ωριαίο καθαρό ποσό (αποφόρτιση − φόρτιση) × MCP. Δεν περιλαμβάνονται έσοδα από την Αγορά Εξισορρόπησης, τις Επικουρικές Υπηρεσίες (FCR, aFRR) ή μηχανισμούς ισχύος.</li>
                <li><strong class="text-slate-200">Αντιστοίχιση ωρών:</strong> με ενεργή την ευθυγράμμιση, η ώρα SCADA h αποτιμάται με την τιμή της ώρας h−1 (η ώρα 1 με την ώρα 24 της προηγούμενης ημέρας). Χωρίς αυτήν, με την ίδια ώρα. Η διαφορά στο συνολικό P&amp;L Ιουνίου–Σεπτεμβρίου είναι ενδεικτικά περίπου 10%.</li>
                <li><strong class="text-slate-200">Τι δεν περιλαμβάνεται:</strong> χρεώσεις δικτύου, φόροι, κόστος λειτουργίας και φθοράς, χρηματοδοτικό κόστος. Το P&amp;L είναι ακαθάριστη εκτίμηση αξίας ενέργειας, όχι λογιστικό αποτέλεσμα.</li>
            </ul>
            <h3 class="mt-4 mb-2 text-[11px] font-bold uppercase tracking-wider text-acc-400" data-sec="limits" style="scroll-margin-top:8px">Περιορισμοί</h3>
            <ul class="list-disc pl-5 space-y-2 text-slate-400">
                <li><strong class="text-slate-200">Δεδομένα:</strong> τα στοιχεία SCADA είναι μη πιστοποιημένα και μπορεί να αναθεωρηθούν. Το ISP είναι προγραμματισμός.</li>
                <li><strong class="text-slate-200">Αλλαγή ώρας:</strong> οι ημέρες αλλαγής ώρας (25 ώρες στις 25/10, 23 ώρες τον Μάρτιο) χειρίζονται ειδικά, αλλά δεν έχουν ακόμα δοκιμαστεί με πραγματικά δεδομένα.</li>
                <li><strong class="text-slate-200">Χαρακτήρας:</strong> ανεξάρτητη ανάλυση πάνω σε ανοιχτά δεδομένα. Δεν αποτελεί επίσημη θέση κάποιου φορέα.</li>
            </ul>
        `,
        methodTabShort: "Σύντομη",
        methodTabFull: "Αναλυτική",
        modalClose: "Κλείσιμο",
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
        monthlyChargeSub: "SCADA Data - Μόνο φόρτιση σε ώρες με τιμή MCP ≤ 5 €/MWh (κορεσμός ΑΠΕ). Η φόρτιση σε υψηλότερες τιμές (π.χ. νυχτερινό arbitrage) δεν μετράει ως αποφυγή περικοπής.",
        kpiLabelAvoided: "Μηνιαια Αποφυγη",
        kpiLabelDisplaced: "Μηνιαια Υποκατασταση",
        surplusStackedTitle: "Ημερήσιο Πλεόνασμα & Απορρόφηση Ευελιξίας (GWh)",
        surplusStackedSub: "Απόλυτες τιμές. Πορτοκαλί/μπλε: φόρτιση BESS/PUMP στις ώρες που το ISP δείχνει πλεόνασμα. Γκρι: φόρτιση εκτός αυτών των ωρών (arbitrage), που δεν μετράει ως απορρόφηση πλεονάσματος.",
        surplusBadgeTip: "Το % απορρόφησης υπολογίζεται επί του Θεωρητικού Αρχικού Πλεονάσματος (Surplus + BESS + PUMP σε ώρες πλεονάσματος). Η φόρτιση εκτός αυτών των ωρών (γκρι) δεν περιλαμβάνεται.",
        surplusCumulativeTitle: "Αθροιστική Εξέλιξη Ευελιξίας (Cumulative BESS & PUMP vs Surplus)",
        surplusCumulativeSub: "Σύγκριση της αθροιστικής φόρτισης SCADA σε ώρες πλεονάσματος (Μπαταρίες + Αντλησιοταμίευση) με το αθροιστικό υπολειπόμενο ISP Surplus. Η γκρι διακεκομμένη δείχνει την αθροιστική φόρτιση εκτός ωρών πλεονάσματος (arbitrage).",
        surplusHourlyTitle: "Ωριαίο Προφίλ: Πλεόνασμα (ISP) vs Φόρτιση BESS & PUMP",
        surplusHourlySub: "Μέσος όρος ημέρας του επιλεγμένου μήνα (MWh ανά ώρα). Δείχνει αν η φόρτιση της ευελιξίας συμπίπτει με τις ώρες του πλεονάσματος.",
        surplusHourlyAll: "Όλες οι μέρες",
        surplusHourlyHigh: "Μέρες υψηλού πλεονάσματος (άνω 25%)",
        surplusHourlyKpiResidual: "Μέσο residual ISP / ημέρα",
        surplusHourlyKpiRatio: "Φόρτιση ευελιξίας ÷ residual",
        surplusHourlyKpiBess: "BESS σε ώρες πλεονάσματος",
        surplusHourlyKpiPump: "PUMP σε ώρες πλεονάσματος",
        surplusHourlyEmpty: "Δεν υπάρχουν αρκετά ωριαία δεδομένα για τον επιλεγμένο μήνα.",
        arbitrageMainTitle: "Arbitrage P&L & Ωριαίο Προφίλ Λειτουργίας",
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
        locale: "en-GB",
        today: "today",
        pillComplete: "Complete data",
        pillPending: "Pending SCADA",
        btnMethodologyShort: "Methodology",
        methodLink: "Methodology →",
        load: { title: "System Initialization", g1: "Data fetching", g2: "Building views", s1: "Reading the data", ready: "Dashboard is ready!", error: "The data could not be loaded. Reload the page in a few minutes." },
        lastUpdate: "Last update:",
        lastUpdateShort: "Updated:",
        nextUpdateShort: "Next:",
        nextUpdate: "Next update:",
        dateLabel: "Date:",
        monthLabel: "Month:",
        tabDaily: "Daily Analytics",
        tabMonthly: "Monthly Impact",
        tabSurplus: "Surplus & Flexibility",
        tabArbitrage: "Arbitrage P&L",
        btnMethodology: "Methodology & Assumptions",
        modalTitle: "Methodology & Core Assumptions",
        modalBodyShort: `
            <p class="mb-1 text-slate-300">An independent tool built on open data. Figures are estimates and indications, not official statistics.</p>
            <h3 class="mt-4 mb-2 text-[11px] font-bold uppercase tracking-wider text-acc-400" data-sec="all" style="scroll-margin-top:8px">All tabs</h3>
            <ul class="list-disc pl-5 space-y-2 text-slate-400">
                <li><strong class="text-slate-200">Scope:</strong> only BESS units on the Transmission System (IPTO/ADMIE). Systems on the Distribution Network (HEDNO) are not included.</li>
                <li><strong class="text-slate-200">Sources:</strong> IPTO/ADMIE (ISP = schedule, SCADA = actual operation, uncertified) and ENTSO-E (MCP prices). Updated daily. BESS SCADA measurements exist from 18/6.</li>
                <li><strong class="text-slate-200">⏱ Hour alignment:</strong> SCADA runs one hour ahead of the market. With the checkbox on (default), SCADA hour h is matched with MCP hour h−1. Based on statistical correlation, not on IPTO documentation.</li>
            </ul>
            <h3 class="mt-4 mb-2 text-[11px] font-bold uppercase tracking-wider text-acc-400" data-sec="daily" style="scroll-margin-top:8px">Daily Analytics</h3>
            <ul class="list-disc pl-5 space-y-2 text-slate-400">
                <li><strong class="text-slate-200">Totals &amp; RTE:</strong> “TOTAL BESS” is the sum of the units. Daily RTE is distorted by energy carried over to the next day, so read it over longer periods.</li>
            </ul>
            <h3 class="mt-4 mb-2 text-[11px] font-bold uppercase tracking-wider text-acc-400" data-sec="monthly" style="scroll-margin-top:8px">Monthly Impact</h3>
            <ul class="list-disc pl-5 space-y-2 text-slate-400">
                <li><strong class="text-slate-200">Avoided curtailment:</strong> counts only charging when the MCP price is ≤ €5/MWh. Thermal displacement is theoretical.</li>
            </ul>
            <h3 class="mt-4 mb-2 text-[11px] font-bold uppercase tracking-wider text-acc-400" data-sec="surplus" style="scroll-margin-top:8px">Surplus &amp; Flexibility</h3>
            <ul class="list-disc pl-5 space-y-2 text-slate-400">
                <li><strong class="text-slate-200">Residual &amp; absorption:</strong> residual comes from the ISP (a schedule, excluding exports). Only BESS and PUMP charging in surplus hours counts; the rest (grey) is treated as arbitrage. The picture is indicative.</li>
            </ul>
            <h3 class="mt-4 mb-2 text-[11px] font-bold uppercase tracking-wider text-acc-400" data-sec="arbitrage" style="scroll-margin-top:8px">Arbitrage P&amp;L</h3>
            <ul class="list-disc pl-5 space-y-2 text-slate-400">
                <li><strong class="text-slate-200">Revenue:</strong> Day-Ahead Market only, at the MCP. Balancing, ancillary services, charges and taxes are excluded. It is a gross estimate, not an accounting result.</li>
            </ul>
        `,
        modalBodyFull: `
            <p class="mb-1 text-slate-300">This Dashboard is an independent tool for monitoring battery energy storage (BESS) in the Greek market, built on open data. Figures are estimates and indications, not official statistics.</p>
            <h3 class="mt-4 mb-2 text-[11px] font-bold uppercase tracking-wider text-acc-400" data-sec="all" style="scroll-margin-top:8px">All tabs</h3>
            <ul class="list-disc pl-5 space-y-2 text-slate-400">
                <li><strong class="text-slate-200">Scope:</strong> refers exclusively to BESS units connected to the Transmission System (IPTO/ADMIE) that appear in its files. Systems on the Distribution Network (HEDNO) are not included.</li>
                <li><strong class="text-slate-200">Sources:</strong> IPTO/ADMIE ISP (scheduling), IPTO/ADMIE System Realization SCADA (actual operation, data that IPTO labels as uncertified) and ENTSO-E (Day-Ahead prices, MCP).</li>
                <li><strong class="text-slate-200">Updates:</strong> daily in the morning. The last 5 days are re-checked to catch late publications and corrections.</li>
                <li><strong class="text-slate-200">Availability:</strong> ISP and MCP from 1/6/2026. SCADA for BESS units from 18/6/2026 (no measurements exist before that date). SCADA for pumping (PUMP) from 1/6/2026.</li>
                <li><strong class="text-slate-200">Hours and prices:</strong> the market (MCP, ISP) uses CET, while SCADA uses Greek local time (one hour ahead). The market runs on 15-minute intervals and each hourly price is the average of its four quarters.</li>
                <li><strong class="text-slate-200">⏱ Hour alignment:</strong> when on, which is the default, SCADA hour h is matched with MCP hour h−1, and the ISP follows the market clock. The assumption rests on statistical correlation: ISP surplus hours coincide with low-price hours without any shift, while BESS charging and pumping fit the price of the previous hour better. It has not been confirmed by IPTO documentation. It affects the Monthly Impact, Surplus &amp; Flexibility and Arbitrage P&amp;L tabs.</li>
            </ul>
            <h3 class="mt-4 mb-2 text-[11px] font-bold uppercase tracking-wider text-acc-400" data-sec="daily" style="scroll-margin-top:8px">Daily Analytics</h3>
            <ul class="list-disc pl-5 space-y-2 text-slate-400">
                <li><strong class="text-slate-200">ISP and SCADA:</strong> the ISP shows what was scheduled and SCADA what actually happened. Differences between them are expected.</li>
                <li><strong class="text-slate-200">Totals:</strong> a unit’s daily charge and discharge is the sum of its hourly values (quarter-hourly in the ISP). “TOTAL BESS” is the sum of the units, i.e. the actual physical charge and discharge. It is not IPTO’s TOTAL row, which nets the units hour by hour and gives lower values.</li>
                <li><strong class="text-slate-200">Round-trip efficiency (RTE):</strong> daily AC-to-AC, i.e. discharge ÷ charge. Extreme values (above ~92% or below ~83%, and sometimes above 100% for a single unit) are often caused by <em>Inter-day SoC Carryover</em>, where the battery holds energy for the next day. RTE is more reliable over longer periods or for the whole fleet.</li>
            </ul>
            <h3 class="mt-4 mb-2 text-[11px] font-bold uppercase tracking-wider text-acc-400" data-sec="monthly" style="scroll-margin-top:8px">Monthly Impact</h3>
            <ul class="list-disc pl-5 space-y-2 text-slate-400">
                <li><strong class="text-slate-200">Discharge and thermal displacement:</strong> a theoretical metric. It assumes every MWh of BESS discharge displaces more expensive thermal generation (gas or lignite). Actual displacement is not measured.</li>
                <li><strong class="text-slate-200">Charging and avoided RES curtailment:</strong> only charging in hours with an MCP price ≤ €5/MWh counts, i.e. when RES saturate the market and the price drops to about zero. Charging at higher prices (e.g. overnight arbitrage) does not count. The €5 threshold is fixed.</li>
            </ul>
            <h3 class="mt-4 mb-2 text-[11px] font-bold uppercase tracking-wider text-acc-400" data-sec="surplus" style="scroll-margin-top:8px">Surplus &amp; Flexibility</h3>
            <ul class="list-disc pl-5 space-y-2 text-slate-400">
                <li><strong class="text-slate-200">Residual surplus:</strong> comes from the <em>Energy Surplus</em> row of the ISP and is the surplus left after scheduling. It is a schedule, not a measurement, and it ignores exports.</li>
                <li><strong class="text-slate-200">Theoretical surplus:</strong> residual + BESS charging + PUMP charging in surplus hours. A “surplus hour” is any hour with ISP residual of at least 1 MWh, with hours aligned to Greek local time.</li>
                <li><strong class="text-slate-200">Charging outside surplus hours (grey):</strong> treated as arbitrage and not counted as surplus absorption.</li>
                <li><strong class="text-slate-200">Absorption shares:</strong> the share of BESS or pumping in the theoretical surplus, monthly in the KPIs and daily in the tooltip. KPIs use only days with complete BESS, PUMP and ISP data.</li>
                <li><strong class="text-slate-200">“Days residual &gt; flex”:</strong> days when the residual exceeded the energy absorbed by BESS and PUMP in surplus hours. It does not mean flexibility had used up its capacity.</li>
                <li><strong class="text-slate-200">Hourly profile:</strong> average day of the month in Greek local time, using only days with data from all four sources (BESS, PUMP, ISP, MCP). “High-surplus days” are the top 25% of the month by daily residual.</li>
                <li><strong class="text-slate-200">How to read it:</strong> indicative. Exports are not included, so absorption is understated. Arbitrage charging that falls in surplus hours counts as absorption, so it is overstated.</li>
            </ul>
            <h3 class="mt-4 mb-2 text-[11px] font-bold uppercase tracking-wider text-acc-400" data-sec="arbitrage" style="scroll-margin-top:8px">Arbitrage P&amp;L</h3>
            <ul class="list-disc pl-5 space-y-2 text-slate-400">
                <li><strong class="text-slate-200">Revenue:</strong> exclusively from the Day-Ahead Market (DAM). As a price-taker, each unit buys and sells at the MCP: hourly net amount (discharge − charge) × MCP. Revenue from the Balancing Market, Ancillary Services (FCR, aFRR) or capacity mechanisms is not included.</li>
                <li><strong class="text-slate-200">Hour matching:</strong> with alignment on, SCADA hour h is valued at the price of hour h−1 (hour 1 uses hour 24 of the previous day). Without it, the same hour is used. The difference in total June–September P&amp;L is roughly 10%, indicatively.</li>
                <li><strong class="text-slate-200">What is not included:</strong> network charges, taxes, operating and degradation costs, financing costs. P&amp;L is a gross estimate of energy value, not an accounting result.</li>
            </ul>
            <h3 class="mt-4 mb-2 text-[11px] font-bold uppercase tracking-wider text-acc-400" data-sec="limits" style="scroll-margin-top:8px">Limitations</h3>
            <ul class="list-disc pl-5 space-y-2 text-slate-400">
                <li><strong class="text-slate-200">Data:</strong> SCADA data is uncertified and may be revised. The ISP is a schedule.</li>
                <li><strong class="text-slate-200">Clock changes:</strong> clock-change days (25 hours on 25/10, 23 hours in March) are handled specifically but have not yet been tested with real data.</li>
                <li><strong class="text-slate-200">Nature:</strong> independent analysis of open data. It is not the official position of any organisation.</li>
            </ul>
        `,
        methodTabShort: "Short",
        methodTabFull: "Detailed",
        modalClose: "Close",
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
        monthlyChargeSub: "SCADA Data - Only charging in hours with MCP ≤ €5/MWh (RES saturation). Charging at higher prices (e.g. overnight arbitrage) is not counted as avoided curtailment.",
        kpiLabelAvoided: "Monthly Avoided",
        kpiLabelDisplaced: "Monthly Displaced",
        surplusStackedTitle: "Daily Energy Surplus & Flexibility Absorption (GWh)",
        surplusStackedSub: "Absolute values. Orange/blue: BESS/PUMP charging in the hours where the ISP shows surplus. Grey: charging outside those hours (arbitrage), not counted as surplus absorption.",
        surplusBadgeTip: "Absorption % is calculated on the Theoretical Initial Surplus (ISP Surplus + BESS + PUMP in surplus hours). Charging outside those hours (grey) is excluded.",
        surplusCumulativeTitle: "Cumulative Flexibility Evolution (BESS & PUMP vs Surplus)",
        surplusCumulativeSub: "Comparison of cumulative SCADA charging in surplus hours (Batteries + Pumped Hydro) vs cumulative residual ISP Surplus. The dashed grey line shows cumulative charging outside surplus hours (arbitrage).",
        surplusHourlyTitle: "Hourly Profile: Surplus (ISP) vs BESS & PUMP Charging",
        surplusHourlySub: "Average day of the selected month (MWh per hour). Shows whether flexibility charging coincides with the surplus hours.",
        surplusHourlyAll: "All days",
        surplusHourlyHigh: "High-surplus days (top 25%)",
        surplusHourlyKpiResidual: "Avg ISP residual / day",
        surplusHourlyKpiRatio: "Flex charging ÷ residual",
        surplusHourlyKpiBess: "BESS in surplus hours",
        surplusHourlyKpiPump: "PUMP in surplus hours",
        surplusHourlyEmpty: "Not enough hourly data for the selected month.",
        arbitrageMainTitle: "Arbitrage P&L & Hourly Operation Profile",
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
    // Ένα στοιχείο που λείπει δεν πρέπει ποτέ να διακόπτει την αλλαγή γλώσσας: το γράφουμε στο console και συνεχίζουμε
    const setT = (id, txt) => { const el = document.getElementById(id); if (el) el.innerText = txt; else console.warn('setLang: λείπει το στοιχείο #' + id); };
    if (lang !== 'el' && lang !== 'en') return;
    currentLang = lang;
    try { localStorage.setItem('kp_lang', lang); } catch (e) { /* ιδιωτική περιήγηση */ }
    const t = i18n[lang];

    // Οθόνη φόρτωσης: τα βήματα 2…5 παίρνουν τα ονόματα των tabs, με τη σειρά τους
    const L = t.load;
    const stepText = { 1: L.s1, 2: t.tabDaily, 3: t.tabMonthly, 4: t.tabSurplus, 5: t.tabArbitrage };
    const loadIds = { loadTitle: L.title, loadGroup1: L.g1, loadGroup2: L.g2, loadReady: L.ready };
    Object.entries(loadIds).forEach(([id, txt]) => { const el = document.getElementById(id); if (el) el.textContent = txt; });
    document.querySelectorAll('.load-row').forEach(r => { const lb = r.querySelector('[data-load-label]'); if (lb) lb.textContent = stepText[r.dataset.step] || ''; });
    
    setT('mainTitle', t.title);
    setT('lastUpdateLabel', t.lastUpdate);
    const lus = document.getElementById('lastUpdateLabelShort'); if (lus) lus.innerText = t.lastUpdateShort;
    const nus = document.getElementById('nextUpdateLabelShort'); if (nus) nus.innerText = t.nextUpdateShort;
    setT('nextUpdateLabel', t.nextUpdate);
    updateHeader();
    
    if(document.getElementById('btnMethodologyText')) document.getElementById('btnMethodologyText').innerText = t.btnMethodology;
    const bms = document.getElementById('btnMethodologyTextShort'); if (bms) bms.innerText = t.btnMethodologyShort;
    document.querySelectorAll('.meth-link').forEach(el => { el.textContent = t.methodLink; });
    const xb = document.getElementById('modalXBtn'); if (xb) xb.setAttribute('aria-label', t.modalClose);
    if(document.getElementById('modalTitle')) document.getElementById('modalTitle').innerText = t.modalTitle;
    if (typeof renderMethodologyBody === 'function') renderMethodologyBody();
    const mtShort = document.getElementById('methodTabShort'); if (mtShort) mtShort.innerText = t.methodTabShort;
    const mtFull = document.getElementById('methodTabFull'); if (mtFull) mtFull.innerText = t.methodTabFull;
    const mClose = document.getElementById('modalCloseBtn'); if (mClose) mClose.innerText = t.modalClose;

    setT('tabBtnDaily', t.tabDaily);
    setT('tabBtnMonthly', t.tabMonthly);
    setT('tabBtnSurplus', t.tabSurplus);
    setT('tabBtnArbitrage', t.tabArbitrage);
    
    setT('dischargeTitle', t.dischargeTitle);
    setT('dischargeTitle', t.dischargeTitle);
    setT('chargeTitle', t.chargeTitle);

    // Ετικέτες των KPI του Daily (υπολογιστής: pc…, κινητό: mob…). Πριν, το setLang έγραφε σε 7 παλιά id που δεν υπάρχουν πια
    // και η αλλαγή σε ελληνικά διακοπτόταν στη μέση (D27).
    const kpiTexts = {
        pcLblDisp: t.totalDischarge, mobLblDisp: t.totalDischarge,
        pcLblChg: t.totalCharge, mobLblChg: t.totalCharge,
        pcLblRte: t.rte, mobLblRte: t.rte,
        pcDispIspText: t.schedIsp, mobDispIspText: t.schedIsp, pcChgIspText: t.schedIsp, mobChgIspText: t.schedIsp,
        pcRteIspText: t.schedIsp, mobRteIspText: t.schedIsp,
        pcDispScadaText: t.actScada, mobDispScadaText: t.actScada, pcChgScadaText: t.actScada, mobChgScadaText: t.actScada,
        pcRteScadaText: t.actScada, mobRteScadaText: t.actScada
    };
    Object.entries(kpiTexts).forEach(([id, txt]) => { const el = document.getElementById(id); if (el) el.innerText = txt; });

    setT('monthlyDischargeTitle', t.monthlyDischargeTitle);
    setT('monthlyDischargeSub', t.monthlyDischargeSub);
    setT('monthlyChargeTitle', t.monthlyChargeTitle);
    setT('monthlyChargeSub', t.monthlyChargeSub);
    setT('kpiLabelAvoided', t.kpiLabelAvoided);
    setT('kpiLabelDisplaced', t.kpiLabelDisplaced);

    setT('surplusStackedTitle', t.surplusStackedTitle);
    setT('surplusStackedSub', t.surplusStackedSub);
    document.getElementById('surplusBadge').title = t.surplusBadgeTip;
    setT('surplusCumulativeTitle', t.surplusCumulativeTitle);
    setT('surplusCumulativeSub', t.surplusCumulativeSub);

    const setTxt = (id, txt) => { const e = document.getElementById(id); if (e && txt !== undefined) e.innerText = txt; };
    setTxt('surplusHourlyTitle', t.surplusHourlyTitle);
    setTxt('surplusHourlySub', t.surplusHourlySub);
    setTxt('optHourlyAll', t.surplusHourlyAll);
    setTxt('optHourlyHigh', t.surplusHourlyHigh);

    setT('arbitrageMainTitle', t.arbitrageMainTitle);
    setT('arbitrageChartTitle', t.arbitrageChartTitle);
    setT('arbitrageChartSub', t.arbitrageChartSub);
    setT('arbitrageTableTitle', t.arbitrageTableTitle);
    setT('thUnit', t.thUnit);
    setT('thCharge', t.thCharge);
    setT('thDischarge', t.thDischarge);
    setT('thRte', t.thRte);
    setT('thPnl', t.thPnl);
    setT('thProfit', t.thProfit);

    // GR | EN όπως στο live και στο Flows (D25): ενεργό σε accent με σκούρα γράμματα
    [['btnGr', 'el'], ['btnEn', 'en']].forEach(([id, l]) => {
        const on = l === lang, b = document.getElementById(id);
        if (!b) return;
        b.className = `flex items-center justify-center px-4 rounded transition ${on ? 'bg-acc-400 text-slate-900' : 'text-slate-400 hover:text-white'}`;
        b.setAttribute('aria-pressed', on ? 'true' : 'false');
    });

    // Το κουτί επιλογής ξαναγεμίζει στη νέα γλώσσα (ημερομηνίες, «σήμερα»), κρατώντας την επιλογή
    if (typeof fillPickers === "function") fillPickers();
    if (typeof updatePicker === "function") updatePicker();

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

// Ώρα Αθήνας, όποια κι αν είναι η ζώνη ώρας του επισκέπτη (όπως στο live / Flows).
function fmtTimeAthens(isoTs) {
    if (!isoTs) return '–';
    const dt = new Date(isoTs);
    if (Number.isNaN(dt.getTime())) return '–';
    return new Intl.DateTimeFormat(i18n[currentLang].locale, {
        day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone: 'Europe/Athens'
    }).format(dt);
}

// Τελευταία ενημέρωση = πότε έτρεξε πραγματικά η λήψη· Επόμενη = η επόμενη προγραμματισμένη (cron-job.org, 07:04 Αθήνας).
// Και οι δύο τιμές γράφονται από το update_data.py στο data/meta.json (D06)· η σελίδα μόνο τις δείχνει.
// Στο κινητό χρησιμοποιούνται οι ίδιες τιμές (χωρίς έτος), ώστε η ένδειξη να χωράει σε μία γραμμή.
function updateHeader() {
    const m = metaData;
    const last = m ? fmtTimeAthens(m.fetched) : '–';
    const next = m ? fmtTimeAthens(m.next_update) : '–';
    ['lastUpdateVal', 'lastUpdateValShort'].forEach(id => { const el = document.getElementById(id); if (el) el.innerText = last; });
    ['nextUpdateVal', 'nextUpdateValShort'].forEach(id => { const el = document.getElementById(id); if (el) el.innerText = next; });
}

// Περνά το ιστορικό JSON στο rawData. Η εμφάνιση (επιλογείς, tabs) γίνεται από το boot() στο dashboard.js.
function applyData(json) {
    rawData.isp = normalizeData(json.isp);
    rawData.scada = normalizeData(json.scada);
    rawData.bessHourly = json.bessHourly || [];
    rawData.mcpHourly = json.mcpHourly || [];
    rawData.surplusHourly = json.surplusHourly || [];
    rawData.pumpHourly = json.pumpHourly || [];

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
}
