# Data Audit System

Independent verification system for [whatchanged.us](https://www.whatchanged.us). Runs weekly, tests 10 random zip codes, compares every displayed number against the original government sources, and produces an HTML report with pass/fail verdicts and screenshots.

**Read [AUDIT_RULES.md](AUDIT_RULES.md) before touching any audit code.**

---

## Quick Start

```bash
cd audit
python -m venv venv && source venv/bin/activate
pip install -r requirements.txt
playwright install chromium

# Run against production (default)
PYTHONPATH=. python src/main.py --zips 98683 --sequential

# Run against local dev server
PYTHONPATH=. python src/main.py --zips 98683 --url http://localhost:3000 --sequential

# Full 10-zip audit
PYTHONPATH=. python src/main.py

# Run tests
PYTHONPATH=. python -m pytest tests/ -v
```

Reports are saved to `audit/reports/` (gitignored).

---

## How It Works

The audit is a Python application that acts as an external observer. It fetches data from the whatchanged.us public API, independently queries the same government sources, and compares the results.

### What gets checked (5 layers)

| Layer | What | How |
|-------|------|-----|
| **API Correctness** | Do the numbers match the source? | Query BLS, EIA, Census APIs directly and compare |
| **Display Accuracy** | Does the page show what the API returns? | Playwright scrapes the rendered DOM and compares to API |
| **Internal Math** | Are % changes and $ impacts computed correctly? | Re-derive every calculation from raw series data |
| **Cross-checks** | Is the data in the right ballpark? | Compare gas prices against AAA (independent source) |
| **Structural** | Is the data fresh? Are metro mappings correct? | Check timestamps, verify BLS series IDs map to claimed areas |

### Strict isolation rule

The audit **does not import, reference, or read any code from the main codebase**. It interacts with whatchanged.us exclusively through the public API and Playwright screenshots. This prevents circular verification — the audit can only catch real bugs because it doesn't share assumptions with the code under test.

The only shared resource is environment variables for API keys (`BLS_API_KEY`, `EIA_API_KEY`, `CENSUS_API_KEY`, `FRED_API_KEY`).

---

## Project Structure

```
audit/
  config/
    zip_pools.json        # Zip codes by region for random selection
    tolerances.json       # Tolerance thresholds per data category
  src/
    main.py               # Orchestrator — ties everything together
    utils.py              # Shared: retry_request, compare_values, CheckResult
    zip_selector.py       # Geographically diverse random zip selection
    fetchers/             # API clients (one per source)
      whatchanged.py      #   whatchanged.us public API (?audit=true)
      eia.py              #   EIA gas prices (petroleum/pri/gnd)
      bls.py              #   BLS CPI + LAUS (v2 API with catalog metadata)
      fred.py             #   FRED (Layer 1 cross-check, not independent)
      census.py           #   Census ACS median income (B19013)
      scrapers.py         #   AAA gas prices (Playwright, best-effort)
    browser/
      session.py          #   Single Playwright session per zip:
                          #   screenshot + DOM scrape + link extraction
    comparators/          # Value comparisons (each returns CheckResult)
      gas.py              #   EIA exact match + AAA cross-check
      cpi.py              #   BLS CPI index + % change verification
      unemployment.py     #   BLS LAUS exact match
      tariff.py           #   Census income + Yale methodology
      rendered_vs_api.py  #   DOM values vs API response
      computation.py      #   Re-derive all computed values
    validators/           # Structural checks
      series_metro.py     #   BLS series ID → metro area (most critical check)
      freshness.py        #   Data staleness detection
      link_checker.py     #   Source attribution links resolve
      baseline.py         #   Jan 2025 baseline values correct
    report/
      generator.py        #   Build HTML report from results
      template.html       #   Jinja2 template (self-contained, inline CSS)
  tests/                  # 141 unit tests (pytest)
  reports/                # Generated HTML reports (gitignored)
  screenshots/            # Playwright screenshots (gitignored)
```

---

## CLI Options

```
PYTHONPATH=. python src/main.py [OPTIONS]

Options:
  --zips ZIP [ZIP ...]   Specific zip codes to audit (overrides random selection)
  --num-zips N           Number of random zips (default: 10)
  --workers N            Max parallel workers (default: 3)
  --url URL              Base URL to audit (default: https://whatchanged.us)
  --no-browser           Skip Playwright browser sessions (faster, fewer checks)
  --sequential           Run one zip at a time (useful for debugging)
```

---

## Tolerances

| Check | Tolerance | Rationale |
|-------|-----------|-----------|
| Gas price vs EIA | $0.05/gal | Weekly timing differences |
| Gas price vs AAA | $0.15/gal | Different methodology (best-effort) |
| CPI index value | 0.01 points | Should be near-exact match |
| CPI % change | 0.1 pp | Rounding differences |
| Unemployment rate | 0.005 pp | Float precision margin |
| Median income vs Census | $2,000 | ACS margin of error |
| Tariff estimate | $200 | Estimate uncertainty |
| Metro area name | Exact | Must match precisely |

---

## Scheduling

The audit runs automatically every Wednesday at 9:00 AM Eastern via GitHub Actions (`.github/workflows/weekly-audit.yml`). Reports and screenshots are uploaded as artifacts with 90-day retention.

To trigger manually: go to [Actions](https://github.com/cgreenberg/whatchanged/actions/workflows/weekly-audit.yml) and click "Run workflow".

---

## Bugs Found by This Audit

During development, the audit system caught several real issues:

1. **census-acs.json was a 3-entry stub** — 99.99% of zip codes were using a $74,580 national fallback for tariff estimates. Fixed by building a script that populates real Census data for 30,618 ZCTAs.

2. **EIA endpoint was wrong** — The audit instructions had `petroleum/pri/grd` but the correct path is `petroleum/pri/gnd`. Discovered via 400 errors.

3. **Gas baseline used wrong January date** — Weekly gas series has 4 Jan 2025 entries; the site uses Jan 20 (inauguration day) but the audit initially matched Jan 6.

4. **AAA scraper returned national price instead of state price** — The first dollar amount on the page is national ($3.942), not state ($3.842). Fixed by targeting the `.price-text--blue` CSS class.
