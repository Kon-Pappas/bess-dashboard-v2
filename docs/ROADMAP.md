# Roadmap

Order of work for aligning this dashboard with the hub house style (live-greekpower, Flows) while keeping its own analyses. One batch at a time; each batch is recorded in `DECISIONS.md`.

## Phase 1: loading overlay and basics (batch 1, 21 Oct 2026) — done

- Loading overlay paced as in live-greekpower D47, with real progress in step 1 (D03)
- Language remembered with `kp_lang` (D04)
- Update only through cron-job.org at 07:04; workflow `schedule:` removed; Actions updated (D05, D08)
- Real *Last / Next update* from `data/meta.json` (D06); short labels on mobile (D09)
- Emerald accent defined in one place (D02); Tailwind pinned (D07)
- README and `docs/`

## Phase 2: data colours

- One colour per entity across all tabs; no data colour equal to the accent
- Greens that mean "complete / positive / ✓" become lime (K02)

## Phase 3: house shell and accent

- Accent (`acc-*`) wherever it is decoration: title, active tab, GR | EN, buttons, focus (K02)
- One picker box that changes label per tab; dates in the visitor's language; status pill next to *Last / Next update*
- Methodology modal as in live: boxed X, bordered Close button, focus handling; footer rule; Methodology links in context

## Phase 4: texts

- Greek page fully in Greek; Greek casing; no all-caps labels (K03, K04, C01, C02)

## Phase 5: charts

- Pin Chart.js 4.5.1; remove unused plugins (K01)
- Hour labels `00–01` … `23–24` from the hour's number; own HTML tooltips

## Phase 6: mobile

- Tables that do not fit become cards; "–" instead of 0; one divider line (K11, H01)

## Phase 7: data files — later, not urgent

Measured on 21 Oct 2026 (K05): ≈ 93 KB gzipped for 143 days. When the history reaches about a year, or loading becomes noticeably slow, consider one file per month plus a manifest (list of days, last / next update; replaces `meta.json`); step 1 of the loading overlay would then follow several real files. Decide with a new measurement first.

## Checks with a date

- 22 Oct 2026: first 07:04 run after batch 1; check that `data/meta.json` appears (K09), that there is one run per day, and that the previous day's SCADA file was already there (K08)
- 26 Oct 2026: verify the 25-hour day of 25 Oct (K06)

## Later

- `ARCHITECTURE.md`, `DATA_DICTIONARY.md`, `METHODS.md` (the source text of the methodology modal)
