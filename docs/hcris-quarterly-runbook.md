# HCRIS Quarterly Runbook

This document describes the steps to update Medicare payment data from CMS HCRIS cost reports.
Run this process once per quarter. It takes approximately 30–60 minutes including download time.

Cost reports lag ~18 months from the fiscal year end. This is expected.

---

## Step 1: Download the HCRIS zip files

Each provider type has its own CMS page. Each download is a single zip containing **all available fiscal years** — the scripts will select the best report per provider per year automatically.

Download the "Data files" zip from each page:

| Provider Type | Form | URL |
|---|---|---|
| Skilled Nursing Facility (SNF) | CMS-2540-10 | https://www.cms.gov/data-research/statistics-trends-and-reports/cost-reports/skilled-nursing-facility-2540-2010-form |
| Home Health Agency (HHA) | CMS-1728-20 | https://www.cms.gov/data-research/statistics-trends-reports/cost-reports/home-health-agency-1728-2020-form |
| Hospice | CMS-1984-14 | https://www.cms.gov/data-research/statistics-trends-and-reports/cost-reports/hospice-1984-2014-form |

On each page, look for a link labeled something like "SNF 10 Data files" / "HHA 20 Data files" / "Hospice 14 Data files" and download that zip.

Save the files somewhere accessible, e.g. `~/Downloads/hcris/`.

---

## Step 2: Verify the zip contents

Each zip should contain exactly three files. Check with:

```bash
unzip -l ~/Downloads/hcris/snf_fy2023.zip
```

You should see files with these suffixes in their names:
- `_RPT_` — report metadata (tens of thousands of rows)
- `_NMRC_` — numeric values (millions of rows — this is normal)
- `_ALPHNMRC_` — alpha-numeric values (not used by our scripts)

If you don't see these suffixes, the file structure may have changed. Check the CMS data dictionary and update the suffix constants in `scripts/lib/hcris.ts` if needed.

---

## Step 3: Verify worksheet coordinates (one-time setup or after form changes)

> **Skip this step** if you have already run HCRIS ingestion successfully before. Only repeat if CMS updates the form version.

The scripts look up specific `(WKSHT_CD, LINE_NUM, CLMN_NUM)` values in the NMRC file. These coordinates are defined as constants in `scripts/lib/transform-hcris-*.ts`. CMS form instructions sometimes use different notation than the raw file values (e.g. the form says `E` but the file contains `E00001`).

To verify, extract the zip and inspect the NMRC file:

```bash
# Extract the zip
unzip ~/Downloads/hcris/snf_fy2023.zip -d /tmp/hcris-snf/

# View the NMRC file header and first 5 data rows
head -6 /tmp/hcris-snf/*_NMRC_*
```

The NMRC file is pipe-delimited (`|`). Columns are:
`RPT_REC_NUM|WKSHT_CD|LINE_NUM|CLMN_NUM|ITM_VAL_NUM`

Look at the actual `WKSHT_CD` values in the file. If they differ from the constants in `transform-hcris-snf.ts` (e.g. file has `E00001` instead of `E`), update the constants in that file before running.

To spot-check a specific coordinate:

```bash
# Find rows for worksheet E, line 1, column 1 in the SNF NMRC file
grep -m5 '|E|1|1|' /tmp/hcris-snf/*_NMRC_*
```

---

## Step 4: Set environment variables

The scripts require the same env vars as all other ingestion scripts:

```bash
export SUPABASE_URL="your-supabase-url"
export SUPABASE_SERVICE_ROLE_KEY="your-service-role-key"
```

These are in your `.env.local` file. Load them with:

```bash
export $(grep -v '^#' .env.local | xargs)
```

---

## Step 5: Run the three scripts

Run each script, passing the path to the corresponding zip file.

**SNF:**
```bash
npx tsx scripts/parse-hcris-snf.ts ~/Downloads/hcris/snf_fy2023.zip
```

**HHA:**
```bash
npx tsx scripts/parse-hcris-hha.ts ~/Downloads/hcris/hha_fy2023.zip
```

**Hospice:**
```bash
npx tsx scripts/parse-hcris-hospice.ts ~/Downloads/hcris/hospice_fy2023.zip
```

Each script will print progress and a summary at the end. Expected runtime: 5–15 minutes each.

---

## Step 6: Interpret the summary log

A successful run looks like:

```
--- HCRIS SNF Ingestion Summary ---
Fiscal years found:            2021, 2022, 2023
Reports processed:             14,802
Providers matched:             14,650  (found in DB)
Providers missing:                152  (CCN not found)
payment_history rows upserted: 14,650
providers updated:             14,650
Total Medicare revenue:        $42,847,203,441

Ingestion complete.
```

**What to check:**
- `Providers missing` — CCNs in HCRIS that don't match any provider in our database. A small number (1–5%) is normal (closed providers or providers not yet in our dataset). A large number may indicate a CCN format mismatch — compare the raw `PRVDR_NUM` values in the RPT file against our `providers.cms_id` column.
- `Total Medicare revenue` — Cross-reference against prior quarter. A dramatic change warrants investigation.
- `providers skipped (null pay)` — Providers whose highest fiscal year had no extractable payment amount. Investigate if unexpectedly high.

---

## Step 7: If a script fails mid-run

The scripts are **idempotent** — re-running is safe. Both `payment_history` (upserted on `provider_id + fiscal_year`) and `providers` (updated by UUID) will overwrite existing values with the same data. No duplicate rows will be created.

If the script fails early (e.g. during zip extraction), no data will have been written — just fix the issue and re-run.

---

## Quarterly checklist

- [ ] Downloaded all three HCRIS zip files for the most recent fiscal year
- [ ] Verified zip contents (three files per zip with expected suffixes)
- [ ] Ran `parse-hcris-snf.ts` — reviewed summary, checked providers missing count
- [ ] Ran `parse-hcris-hha.ts` — reviewed summary
- [ ] Ran `parse-hcris-hospice.ts` — reviewed summary
- [ ] Confirmed `providers.annual_medicare_payments` is populated in the database
