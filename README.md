# Greek BESS Market Analytics

Public dashboard of battery energy storage (BESS) in the Greek electricity market: what the batteries were scheduled to do (ISP) against what they did (SCADA), their monthly impact, how much of the system surplus they and pumped hydro absorb, and the day-ahead arbitrage result of each unit.

**Live page:** https://kon-pappas.github.io/bess-dashboard-v2/
**Part of:** [Konstantinos Pappas Hub](https://kon-pappas.github.io/), with Gas-Power, Power Flows, BigHydro and Live Greek Power.

## What the page shows

| Tab | Content |
|---|---|
| Daily Analytics | Per unit and for the whole fleet: scheduled (ISP) against actual (SCADA) charge, discharge and round-trip efficiency for the selected day. |
| Monthly Impact | Monthly discharge (theoretical thermal displacement) and charging in hours with a day-ahead price of at most 5 €/MWh (possible avoided curtailment of renewables). |
| Surplus & Flexibility | Hourly profile of the ISP residual surplus against BESS and pumped-hydro charging; daily and cumulative absorption, with charging outside the surplus hours shown apart as arbitrage. |
| Arbitrage P&L | Hourly day-ahead result per unit (volume × price), with an optional one-hour alignment between SCADA and market clocks. |

The *Methodology & Assumptions* button opens a short and a detailed version of the assumptions behind every tab.

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
scripts/data_size.py      measures data/historical.json (size, gzip, growth) and warns at the limit
data/                    data files written by the pipeline
docs/                    decisions, known issues, roadmap
.github/workflows/       the update workflow
```

## Documentation

- [docs/DECISIONS.md](docs/DECISIONS.md): what was decided and why
- [docs/KNOWN_ISSUES.md](docs/KNOWN_ISSUES.md): open problems
- [docs/ROADMAP.md](docs/ROADMAP.md): next steps

---
Konstantinos Pappas · Energy Market Analyst
