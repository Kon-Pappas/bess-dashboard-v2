# Greek BESS Market Analytics

Public dashboard of battery energy storage (BESS) in the Greek electricity market: what the batteries were scheduled to do (ISP) against what they did (SCADA), their monthly impact, how much of the system surplus they and pumped hydro absorb, and the day-ahead arbitrage result of each unit.

**Live page:** https://kon-pappas.github.io/bess-dashboard-v2/
**Part of:** [Konstantinos Pappas Hub](https://kon-pappas.github.io/), with Gas-Power, Power Flows, BigHydro and Live Greek Power.

## What the page shows

| Tab | Content |
|---|---|
| Daily Analytics | Per unit and for the whole fleet: scheduled (ISP) against actual (SCADA) charge, discharge and round-trip efficiency for the selected day. |
| Monthly Impact | Cumulative month: thermal displacement as an upper bound (all discharge) and a net estimate (only energy charged from RES surplus, times the efficiency of the month), and potential avoided RES curtailment in two layers: core (charging at a price ≤ €5/MWh) and an additional layer with reservation (ISP residual surplus but price > €5). |
| Surplus & Flexibility | Hourly profile of the ISP residual surplus against BESS and pumped-hydro charging; daily and cumulative absorption, with charging outside the surplus hours shown apart as arbitrage. |
| Arbitrage P&L | Hourly day-ahead result per unit (volume × price), with an optional one-hour alignment between SCADA and market clocks. |
| Capacity & duration | The maximum power (MW) and the maximum energy of one cycle (MWh) of every ADMIE unit code from the hourly SCADA, **never decreasing** (using less is a choice), without the first 40 days of each unit (commissioning), and the class 2h / 3h / 4h: five KPIs, the fleet progression, and one card per unit (maxima with the date since, its own chart, its upgrades, its suspect data days, which are ignored); an accordion on a phone, a list with a side panel from 1024 px. |
| Changes & monitoring | The timeline of the upgrades of the units (a new maximum on 3 different days, or to be confirmed after 1–2 days), the counters and a short guide to the categories and the time margins. There are no decreases. |

The *Methodology & Assumptions* button opens a short and a detailed version of the assumptions behind every tab.

**Mobile layout (below 768 px).** One secondary box (date or month with the completeness badge; methodology and language) with a darker background, above the main tabs, which are lighter and sit in a 3 + 2 grid; no horizontal scroll; an up-arrow button returns to the top. The desktop layout is separate and unchanged. Rules and measurements: `docs/DECISIONS.md` D71–D74.

**Suspect readings.** When a day or a month has a flagged SCADA reading (for example a frozen value) a ⚠ bar appears with the switch "Without them" (off by default: the official figures). Rules: `docs/DECISIONS.md` D86–D91.

**Pipeline.** `update_data.py` runs from the workflow (started only from cron-job.org at 07:04); the Python packages are pinned in `requirements.txt` (D92). Checks: `python3 scripts/test_capacity.py` and `python3 scripts/test_update_dates.py`.

## Data sources

- **IPTO / ADMIE**: ISP results (scheduled) and System Realization SCADA (actual operation, files marked by IPTO as uncertified), daily files. Only BESS units on the Transmission System; units on the Distribution Network (HEDNO) are not included.
- **ENTSO-E Transparency Platform**: day-ahead prices (MCP) of Greece.

## How it updates

`update_data.py` runs once a day at **07:04 Athens time**, started by an external cron-job.org call to the GitHub Actions workflow `Daily BESS Data Update` (the workflow has no schedule of its own). Each run re-fetches the last five days and writes:

- `data/historical.json`: all days;
- `data/meta.json`: time of the run and of the next scheduled run, shown in the page header.

A run for a date range can be started by hand: *Actions → Daily BESS Data Update → Run workflow*, with a start and end date. The workflow needs the repository secret `ENTSOE_TOKEN`.

## Repository layout

```
index.html               page (Tailwind + Chart.js)
dashboard.js             page logic, charts, loading sequence
data.js                  texts in English and Greek, methodology, data loading
update_data.py           data pipeline (Python)
capacity.py              estimates power, energy per cycle and duration of each unit (SCADA only), runs after every update
scripts/data_size.py      measures data/historical.json (size, gzip, growth) and warns at the limit
scripts/test_capacity.py  self-test of capacity.py with synthetic units
scripts/check_curtailment_rule.py  compares the price rule with the ISP surplus hour by hour and gives the monthly layers (the page must give the same numbers)
data/                    data files written by the pipeline: historical.json, meta.json, capacity.json
docs/                    decisions, known issues, roadmap
.github/workflows/       the update workflow
```

## Documentation

- [docs/DECISIONS.md](docs/DECISIONS.md): what was decided and why
- [docs/KNOWN_ISSUES.md](docs/KNOWN_ISSUES.md): open problems
- [docs/ROADMAP.md](docs/ROADMAP.md): next steps

---
Konstantinos Pappas · Energy Market Analyst
