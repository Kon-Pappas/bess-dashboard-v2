# Known issues

Open problems found in the review of 21 October 2026, when the alignment with the other hub dashboards began. Each item says what is wrong, why it matters and where it is planned (see `ROADMAP.md`). Resolved items are moved to `DECISIONS.md`.

| # | Issue | Why it matters | Plan |
|---|---|---|---|
| K05 | All data live in one file, `historical.json`, downloaded whole on every visit. **Measured 21 Oct 2026:** 143 days = 1.34 MB on disk, ≈ **93 KB** gzipped (estimate; the size on the wire was not measured); ≈ 9.4 KB per day, so about 3.4 MB on disk / ≈ 230 KB gzipped after a year | Not a problem today; it would become one only with a year or more of history | Measure again at about a year of history, then decide (Phase 7) |
| K06 | Daylight-saving days (25 Oct 2026: 25 hours; 28 Mar 2027: 23 hours) are handled by design in the pipeline (hour columns, the day window of the market) and in the page (hour 25), but have not been tested on real data | A 25th hour could be dropped or shifted in SCADA, ISP or prices | Check the data of 25–26 Oct 2026 |
| K07 | The one-hour alignment between SCADA and the market clock (D10) is a statistical assumption, not confirmed by IPTO documentation | It changes the P&L by roughly 10%; the page says so and offers a switch | Look for documentation; keep the switch |
| K08 | With the two GitHub crons removed (D05), the only run of the day is the cron-job.org one at 07:04 Athens time; the earlier backup runs at 08:00 and 08:30 no longer exist. If the previous day's SCADA or ISP file is not published by 07:04, that day is completed by the next day's run | The day would be missing for up to 24 hours (the last five days are re-fetched, so nothing is lost for good) | Check the first days after batch 1; move the time later in cron-job.org if needed |
| K09 | Right after batch 1 is uploaded, `data/meta.json` does not exist until the first run, so the header shows "–" | Cosmetic, one day at most | Resolved by one manual run of the workflow |
| K10 | `data.js` holds the texts, the methodology, the data loading and the header, while its name suggests only data | Misleading when looking for code | Decide with the data files phase (Phase 7) |
| K11 | Mobile (≈ 342 px) has not been reviewed against the hub rules: tables that do not fit, "–" instead of 0, one divider line | Same issues as Flows had before its batches 8–9 | Phase 6 |
| K12 | The RTE warnings use hub-reserved hues (yellow below 83%, rose above 92%) | Yellow and red mean imports and exports across the hub; a warning could be misread as data (the orange *pending* pill was accepted in D26) | Decide with the other repositories (hub-wide pass) |
| K13 | Colour space is nearly used up: emerald (accent), lime (OK), red and yellow are reserved, so units have only about eight families (sky, pink, indigo, purple, orange, neutral, cyan, magenta). The newest site (ENW, since 6 Oct) took cyan, which is close to SUS sky | Beyond roughly six sites the colours of neighbouring sites get hard to tell apart; the per-site mode takes over only after 20 units | Look at the chart on real days; if needed move the switch to per-site earlier or darken the new sites' shades |
| K14 | 16 units on 21 Oct 2026 (7 sites), so the per-site switch (20 units) is 4 units away | The first day with a 21st unit changes the chart from units to sites | Check the chart on that day (see `ROADMAP.md`) |

Resolved: K01 → D38; K02 → D25; K03 → D32; K04 → D33, D34.

## Hub-wide issues

Same structure in every hub page, so a fix here alone would make this page differ from the others. To be fixed in one pass across all repositories (the same IDs are used in every repository's docs).

| # | Issue | Seen in | BESS status |
|---|---|---|---|
| H01 | Mobile: two divider lines between the header and the tabs | live-greekpower; Flows fixed it as pilot (D25) | To check (Phase 6) |
| H02 | Header labels on mobile: short labels ("Updated:" / "Next:", "Ενημέρωση:" / "Επόμενη:") | Flows, live-greekpower (only "Next") | **Done in batch 1 (D09)** |
| H05 | Mobile height: the status pill sits on its own line; it could live inside the picker box, next to the date (owner's idea, 20 Oct 2026) | Flows, live-greekpower | **BESS ✓ pilot (batch 5, D23, D24)**; Flows, live and the others in the hub-wide pass |

## Hub conventions

Rules that every hub page should follow; checked in each repository during the hub-wide pass.

| # | Convention | BESS status |
|---|---|---|
| C01 | **Main title** is the dashboard's name: a capital on every word except articles and conjunctions; **everything else** in Greek has a capital on the first word only | **BESS ✓ (batch 8, D32, D33)** |
| C02 | **No all-caps labels.** Captions are written normally, small and grey; numbers carry the colour and weight; units are never uppercased | **BESS ✓ (batch 8, D32)** |