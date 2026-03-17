# HCRIS Quarterly Runbook

This document describes the steps to update Medicare payment data from CMS HCRIS cost reports.
Run this process once per quarter. It takes approximately 30–60 minutes including download time.

Cost reports lag ~18 months from the fiscal year end. This is expected.

---

## Overview

CMS publishes HCRIS cost reports as CSV files. Each provider type has its own download page.
The scripts accept a directory containing the CSV files and process all years found there.

Each directory contains per-year files:
- `*_rpt.csv` — report metadata (provider, dates, status)
- `*_nmrc.csv` — numeric worksheet values (the financial data)
- `*_alpha.csv` — alpha-numeric values (not used)
- `*_rollup.csv` — rollup summaries (not used)

---

## Step 1: Download the data

Each provider type has its own CMS page. Download the data zip from each:

| Provider Type | Form | URL |
|---|---|---|
| Skilled Nursing Facility (SNF) | CMS-2540-10 | https://www.cms.gov/data-research/statistics-trends-and-reports/cost-reports/skilled-nursing-facility-2540-2010-form |
| Home Health Agency (HHA) | CMS-1728-20 | https://www.cms.gov/data-research/statistics-trends-reports/cost-reports/home-health-agency-1728-2020-form |
| Hospice | CMS-1984-14 | https://www.cms.gov/data-research/statistics-trends-and-reports/cost-reports/hospice-1984-2014-form |

**What to download:**
- SNF and HHA pages: look for "SNF 10 Data files zip" / "HHA 20 Data files zip" — these are annual releases (one year per download).
- Hospice page: look for "Hospice 14 Data files" — this is a single download covering all years (FY2015–present).

Extract each zip to its own directory under `~/Downloads/hcris/`. Example structure:

```
~/Downloads/hcris/
  SNF24FY2025/
    SNF24_2025_rpt.csv
    SNF24_2025_nmrc.csv
    ...
  HHA20FY2025/
    HHA20_2025_rpt.csv
    HHA20_2025_nmrc.csv
    ...
  HOSPC14-ALL-YEARS/
    HOSPC14_2015_rpt.csv
    HOSPC14_2015_nmrc.csv
    ...
    HOSPC14_2025_rpt.csv
    HOSPC14_2025_nmrc.csv
    ...
```

---

## Step 2: Verify the file contents

Check that each directory has the expected `_rpt.csv` and `_nmrc.csv` files:

```bash
ls ~/Downloads/hcris/SNF24FY2025/
ls ~/Downloads/hcris/HHA20FY2025/
ls ~/Downloads/hcris/HOSPC14-ALL-YEARS/
```

Each directory should have at least one `*_rpt.csv` and matching `*_nmrc.csv`.

---

## Step 3: Verify worksheet coordinates (first run or after CMS form changes)

> **Skip this step** after you have run successfully before. Repeat only if CMS updates the form version.

The scripts extract specific worksheet coordinates from the NMRC files. CMS sometimes changes the exact codes between form versions. Verify with:

**SNF — check medicare_payments coordinate (E00A18A/01400/00100):**
```bash
grep -m5 ',E00A18A,01400,00100,' ~/Downloads/hcris/SNF24FY2025/SNF24_2025_nmrc.csv
```
Expected: several rows with large dollar amounts ($100K–$10M range per provider).

**HHA — check medicare_payments coordinate (B000000/10000/01000):**
```bash
grep -m5 ',B000000,10000,01000,' ~/Downloads/hcris/HHA20FY2025/HHA20_2025_nmrc.csv
```

**Hospice — check medicare_payments coordinate (B000000/10100/03A00):**
```bash
grep -m5 ',B000000,10100,03A00,' ~/Downloads/hcris/HOSPC14-ALL-YEARS/HOSPC14_2024_nmrc.csv
```

If these return no results, the worksheet codes have changed. Check the CMS data dictionary and update the constants in `scripts/lib/transform-hcris-*.ts`.

---

## Step 4: Set environment variables

```bash
export $(grep -v '^#' .env.local | xargs)
```

---

## Step 5: Run the three scripts

Pass the path to each directory (not an individual file).

**SNF:**
```bash
npx tsx scripts/parse-hcris-snf.ts ~/Downloads/hcris/SNF24FY2025
```

**HHA:**
```bash
npx tsx scripts/parse-hcris-hha.ts ~/Downloads/hcris/HHA20FY2025
```

**Hospice:**
```bash
npx tsx scripts/parse-hcris-hospice.ts ~/Downloads/hcris/HOSPC14-ALL-YEARS
```

Each script will print progress per year file and a summary at the end. Expected runtime: 5–20 minutes each (Hospice is slowest since it processes all years).

---

## Step 6: Interpret the summary log

A successful run looks like:

```
--- HCRIS SNF Ingestion Summary ---
Fiscal years found:            2025
Reports processed:             15,204
Providers matched:             14,891  (found in DB)
Providers missing:                313  (CCN not found)
payment_history rows upserted: 14,891
providers updated:             14,891
Total Medicare revenue:        $38,421,093,882

Ingestion complete.
```

**What to check:**
- `Providers missing` — CCNs in HCRIS that don't match our database. 1–5% is normal (closed providers, new providers not yet ingested). A large number (>10%) may mean a CCN format mismatch.
- `Total Medicare revenue` — compare against the prior quarter. A dramatic change warrants investigation.
- `providers skipped (null pay)` — providers whose highest fiscal year had no extractable payment amount. Investigate if unexpectedly high.

---

## Step 7: If a script fails mid-run

The scripts are **idempotent** — re-running is safe. `payment_history` upserts on `provider_id + fiscal_year` and `providers` updates by UUID, so no duplicate data is created.

---

## Quarterly checklist

- [ ] Downloaded SNF data zip and extracted to `~/Downloads/hcris/SNF24FY<YEAR>/`
- [ ] Downloaded HHA data zip and extracted to `~/Downloads/hcris/HHA20FY<YEAR>/`
- [ ] Downloaded Hospice data zip and extracted to `~/Downloads/hcris/HOSPC14-ALL-YEARS/` (replace if newer all-years bundle available)
- [ ] Ran `parse-hcris-snf.ts` — reviewed summary, checked providers missing count
- [ ] Ran `parse-hcris-hha.ts` — reviewed summary
- [ ] Ran `parse-hcris-hospice.ts` — reviewed summary
- [ ] Confirmed `providers.annual_medicare_payments` is populated in the database
