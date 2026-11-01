# Known issues

Open problems found in the review of 21 October 2026, when the alignment with the other hub dashboards began. Each item says what is wrong, why it matters and where it is planned (see `ROADMAP.md`). Resolved items are moved to `DECISIONS.md`.

| # | Issue | Why it matters | Plan |
|---|---|---|---|
| K05 | All data live in one file, `historical.json`, which a visitor downloads whole on the first visit of each day (D53). **Measured 25 Oct 2026 (D54):** 147 days = 1.37 MB raw, **106 KB gzipped**, growing 9.7 KB/day raw (≈ 0.76 KB/day gzip, and faster as units are added). The limit is **250 KB gzipped** (about 190 days at today's pace, less if the units multiply) or **more than 5 s to the first chart on Slow 4G** | Not a problem today (first chart after 3.7 s on a simulated mid-range phone on Slow 4G). Past the limit, a visitor on a poor connection waits for the download, not for the processor | Run `python3 scripts/data_size.py` now and then (and after every batch of new units). At the limit: monthly files, plan in `docs/ROADMAP.md` |
| K06 | The 25-hour day of 25 Oct 2026. **Checked:** real ENTSO-E prices and ISP surplus have 25 values; the SCADA parser on a synthetic 25-column file gives 25 hourly values and correct sums; the page, with a simulated SCADA, shows 25 columns in Arbitrage and splits the Surplus correctly (D55). **Not yet seen:** the real SCADA file of 25 Oct, which is published on 26 Oct | If ADMIE writes the extra hour in a different place than the 25th column, the day would be incomplete | Check the 26 Oct run (see the dated check in `docs/ROADMAP.md`) |
| K07 | The one-hour alignment between SCADA and the market clock (D10) is a statistical assumption, not confirmed by IPTO documentation | It changes the P&L by roughly 10%; the page says so and offers a switch | Look for documentation; keep the switch |
| K08 | With the two GitHub crons removed (D05), the only run of the day is the cron-job.org one at 07:04 Athens time; the earlier backup runs at 08:00 and 08:30 no longer exist. If the previous day's SCADA or ISP file is not published by 07:04, that day is completed by the next day's run | The day would be missing for up to 24 hours (the last five days are re-fetched, so nothing is lost for good) | Check the first days after batch 1; move the time later in cron-job.org if needed |
| K09 | Right after batch 1 is uploaded, `data/meta.json` does not exist until the first run, so the header shows "–" | Cosmetic, one day at most | Resolved by one manual run of the workflow |
| K10 | `data.js` holds the texts, the methodology, the data loading and the header, while its name suggests only data | Misleading when looking for code | Decide with the data files phase (Phase 7) |
| K12 | The RTE warnings use hub-reserved hues (yellow below 83%, rose above 92%) | Yellow and red mean imports and exports across the hub; a warning could be misread as data (the orange *pending* pill was accepted in D26) | Decide with the other repositories (hub-wide pass) |
| K13 | Colour space is nearly used up: emerald (accent), lime (OK), red and yellow are reserved, so units have only about eight families (sky, pink, indigo, purple, orange, neutral, cyan, magenta). The newest site (ENW, since 6 Oct) took cyan, which is close to SUS sky | Beyond roughly six sites the colours of neighbouring sites get hard to tell apart; the per-site mode takes over only after 20 units | Look at the chart on real days; if needed move the switch to per-site earlier or darken the new sites' shades |
| K14 | 16 units on 21 Oct 2026 (7 sites), so the per-site switch (20 units) is 4 units away | The first day with a 21st unit changes the chart from units to sites | Check the chart on that day (see `ROADMAP.md`) |
| K15 | **STO_02SP** gives 18 MW, 59 MWh, 3.28 h, class 3h, and this **does not come from the frozen days** (D86–D87): without them the same values remain. The capacity estimates are still **lower bounds**, from hourly averages, at the meter (AC): a unit that has never run a full cycle looks smaller; the AC discharge is about 10% below a nameplate | A unit that is run in an unusual way may not reflect its size | Resolved for STO_02SP; the change detector (D80–D81) shows if it moves |
| K16 | A new maximum is confirmed on the **3rd different day** and the upgrade has the date of the first of the three, so an upgrade shows as "to be confirmed" after 1–2 days and is confirmed after 3. A change that never repeats is never a maximum, but it stays "to be confirmed" for up to 14 days. A SCADA error that lasts 3+ days cannot be told from a real upgrade | A long error looks like an upgrade | By design (D80–D81); "likely file error" helps when several units change together |
| K17 | **Why does the ISP show a residual surplus when the price is above 5 €?** (538 hours, D67). The data cannot tell. Two plausible causes: the ISP runs *after* the Day-Ahead Market with updated forecasts, so a surplus that appears later cannot be in the previous day's price; or local grid constraints (congestion). Neither is checked | The additional layer is labelled "with reservation" and is shown apart from the core | Only external information (the ISP and DAM forecast files, constraint reports) could separate the two |
| K18 | The price rule (core) also counts 3 hours with a price ≤ 5 € and no ISP surplus (0.9 GWh of 84 GWh) | About 1% of the core | Left as it is (the page keeps the same rule as before) |
| K19 | **Upgrade or recovery of use?** The maximum only rises, so a unit that worked at a low use during its base and later shows its normal power gets an "upgrade". Real case: **STO_01SP** (14 Aug, 18 → 41 MWh, "upgrade") comes after a period of low use (16 Jul – 19 Aug); the data cannot tell it from a real upgrade. Units that were already working when our SCADA began (18 Jun) have an unknown commissioning, so their ramp-ups after 28 Jul can also show as upgrades | A few events of the timeline may be recoveries of use | Documented in the methodology. The owner may decide to hide an upgrade by hand if he knows better |
| K20 | **Frozen readings in the source.** The SCADA files of ADMIE hold runs of identical values (STO_02SP: 12 days in 4.5 months) and ADMIE did not correct them (D90). The detector needs 6 hours in a row (D86): a shorter freeze, or the 1–5 hours at the border of a longer one, stays in the data; a legitimate run of 6 or more identical hours would be flagged (none exists in the record) | A few hours of a freeze can remain in the totals | Watch the flags for a few weeks; `FROZEN_HOURS` is one constant. The switch of D89 gives the clean view |

Resolved: K01 → D38; K11 → D46–D51; K02 → D25; K03 → D32; K04 → D33, D34.

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