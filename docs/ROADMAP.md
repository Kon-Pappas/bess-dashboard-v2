# Roadmap

Order of work for aligning this dashboard with the hub house style (live-greekpower, Flows) while keeping its own analyses. One batch at a time; each batch is recorded in `DECISIONS.md`.

## Phase 1: loading overlay and basics (batch 1, 21 Oct 2026) — done

- Loading overlay paced as in live-greekpower D47, with real progress in step 1 (D03)
- Language remembered with `kp_lang` (D04)
- Update only through cron-job.org at 07:04; workflow `schedule:` removed; Actions updated (D05, D08)
- Real *Last / Next update* from `data/meta.json` (D06); short labels on mobile (D09)
- Emerald accent defined in one place (D02); Tailwind pinned (D07)
- README and `docs/`

## Phase 2: data colours (batch 4, 21 Oct 2026) — done

- One colour per entity across all tabs; no data colour equal to the accent, red or yellow (D18, D19)
- Unit colours by site, with a switch to one column per site beyond 20 units (D20)
- Green means "complete / positive" and is lime (D21); status colours left for Phase 3 (K12)

## Phase 3: house shell and accent (batches 5 and 6, 21 Oct 2026) — done

- Accent wherever it is decoration; tabs painted as in Flows (D25)
- One picker box with shared day and month, dates in the visitor's language (D22); pill inside the box (D23); Methodology and GR | EN on one row on mobile (D24); pending pill stays orange (D26)
- Language switch repaired (D27)
- Methodology modal as in live: boxed X, focus handling (D28); "Methodology →" in every tab (D29); footer (D30)

## Phase 4: texts (batch 8, 21 Oct 2026) — done

- No all-caps; casing rule for Greek and English (D32)
- Greek page fully Greek, with the glossary and the Greek title (D33)
- Legends, axis texts, mobile captions and tab title translated (D34); the (GWh) title corrected (D35)

## Phase 5: charts (batch 10, 21 Oct 2026) — done

- Chart.js 4.5.1 pinned, shared defaults, no plugins (D38)
- Hours 00 … 23 on the axes and 12–13 in the tooltips (D39)
- Own HTML tooltips on all 8 charts (D40); Arbitrage tooltip by site or one unit alone (D41)
- Follow-up (batch 11): repeated title removed, inactive units faded with "–" for zeros, shorter price legend, "5k" ticks on phones (D42–D45)

## Phase 6: mobile (batch 12, 21 Oct 2026) — done

The four tabs were opened in a real Chromium at 360 px (Greek and English) and measured: no horizontal overflow, one divider line under the header (H01), and these fixes:

- Arbitrage: legend per site on a phone, fitted table, same hour-alignment chip as the other tabs (D46–D48)
- Daily: every unit name on the axis (D49); "–" when the SCADA file is missing (D50); shorter red tile (D51)
- Follow-up (batch 13): the phone legend follows the chosen unit (D52)

## Phase 7: data files (batch 14, 25 Oct 2026) — measured, one file kept

- Measured in a real browser (D54): 106 KB gzip today, first chart after 3.7 s on Slow 4G; the network is the limit
- Revisits cost 183 bytes instead of 104 KB (D53)
- `scripts/data_size.py` measures the file and tells how far the limit is

**Trigger:** gzip above 250 KB, or more than 5 s to the first chart on Slow 4G. At the pace of today's data this is about 190 days away, sooner if the number of units grows faster.

**Plan when the trigger is reached** (not started): every view of the page is one day or one month, so the history can be cut by month.
1. `data/index.json`: the list of days with their completeness flag, the units and the last update (a few KB).
2. `data/2026-10.json`, `data/2026-11.json`, …: the rows of one month each, written by `update_data.py` with the same atomic write.
3. The page loads the index and the month it shows (the latest at first); other months are fetched when the visitor picks them and kept in memory.
4. The one-hour alignment needs the last hour of the previous day: each month file also carries that one day from the month before.
5. Old files never change, so the browser caches them for good; only the current month is revalidated.

## Checks with a date

- 22 Oct 2026: first 07:04 run after batch 1; check that `data/meta.json` appears (K09), that there is one run per day, and that the previous day's SCADA file was already there (K08)
- 26 Oct 2026 (after the 07:04 run): the real SCADA of the 25-hour day (K06). In `data/historical.json` the rows of `bessHourly` for 2026-10-25 must have `25:00`; the log of the run must show no "⚠ SCADA … SUM" lines for that day; the Arbitrage tab for 25 Oct shows 25 columns (00 … 24). Spring 2027 (28 Mar) is the 23-hour day: repeat this check then
- First day with more than 20 units (now 16): check the Arbitrage chart switches to sites and reads well (K14)

## Later

- `ARCHITECTURE.md`, `DATA_DICTIONARY.md`, `METHODS.md` (the source text of the methodology modal)
