# SFF List Ingestion Design

**Goal:** Parse the CMS Special Focus Facility (SFF) PDF and update `is_sff` / `is_sff_candidate` flags on matched providers.

**Date:** 2026-03-18

---

## Overview

The CMS Special Focus Facility list identifies the ~88 nursing homes with the most serious quality problems and ~441 candidates. It is published quarterly as a PDF on cms.gov — no API exists. This script accepts a locally downloaded PDF path as a CLI argument, parses it, and updates provider flags in the database.

---

## Architecture

Three files, matching the established ingestion pattern:

- **`scripts/lib/sff.ts`** — pure functions: PDF text → parsed CCN sets. No I/O.
- **`scripts/ingest-sff.ts`** — orchestrator: reads PDF file, calls lib, does DB updates.
- **`scripts/lib/__tests__/sff.test.ts`** — unit tests for pure parse functions.

No migration required — `is_sff` and `is_sff_candidate` already exist on the `providers` table.

---

## Parse Logic (`sff.ts`)

`pdf-parse` (to be installed as a dev dependency) extracts full PDF text as a string.

### Type

```typescript
export interface SffParseResult {
  sffCcns: string[];
  candidateCcns: string[];
}
```

### `parseSffText(text: string): SffParseResult`

Scans lines for section headers matching `"Special Focus Facilit"` — this prefix covers both `"Special Focus Facilities"` and `"Special Focus Facility Candidates"`. Once inside a section, extracts 6-digit numeric CCNs via regex (`/\b\d{6}\b/`) from each line. Nursing home CCNs are always 6 digits.

Section detection logic:
- Line containing `"Special Focus Facility Candidates"` → switch to candidate section
- Line containing `"Special Focus Facilit"` (and not "Candidates") → switch to SFF section
- Check for the more specific header first to avoid misclassification

---

## DB Update Strategy (`ingest-sff.ts`)

Sequential steps:

1. Read PDF file path from `process.argv[2]` — exit with error if not provided or file not found
2. Extract text via `pdf-parse` → `parseSffText()` → `{ sffCcns, candidateCcns }`
3. `resolveProviders([...sffCcns, ...candidateCcns])` (reusing `hcris.ts`) → UUID lookup map
4. Log any CCNs from the PDF that didn't match an existing provider
5. **Clear all flags**: `UPDATE providers SET is_sff = false, is_sff_candidate = false WHERE is_sff = true OR is_sff_candidate = true`
6. **Set SFF flags**: `UPDATE providers SET is_sff = true WHERE id IN (sffIds)`
7. **Set candidate flags**: `UPDATE providers SET is_sff_candidate = true WHERE id IN (candidateIds)`
8. Print summary: CCNs in PDF / matched / unmatched / SFF updated / candidates updated

The clear-then-set approach is authoritative each run: providers that age off the list have their flags cleared. The risk of an interrupted run leaving all flags cleared is acceptable for a quarterly manual script.

### Invocation

```
npx tsx scripts/ingest-sff.ts ./sff-list-2026-q1.pdf
```

---

## Testing (`sff.test.ts`)

Unit tests on pure functions only — no I/O, no DB mocking.

**`parseSffText()`**

- Extracts CCNs from the SFF section
- Extracts CCNs from the candidate section
- Does not cross-contaminate sections (SFF CCN absent from candidates result, and vice versa)
- Ignores non-CCN numeric strings (e.g., page numbers, years that are not 6 digits)
- Returns empty arrays when a section is missing from the text

---

## No Schema Changes

`is_sff` and `is_sff_candidate` already exist as `BOOLEAN DEFAULT FALSE` columns on the `providers` table. No migration required.
