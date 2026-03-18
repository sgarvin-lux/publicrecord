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
- **`scripts/lib/__tests__/sff.test.ts`** — unit tests for pure parse functions in `sff.ts`.

Test placement follows the existing convention: `scripts/lib/__tests__/` is for tests of lib-level pure functions (e.g., `hcris.test.ts`, `transform-*.test.ts`), while `scripts/__tests__/` is for orchestrator-level tests. `sff.test.ts` belongs in `lib/__tests__/` because it tests `sff.ts`.

No migration required — `is_sff` and `is_sff_candidate` already exist on the `providers` table.

---

## Dependencies

Install both as dev dependencies:

```
npm install --save-dev pdf-parse @types/pdf-parse
```

Both are devDependencies, consistent with all other ingestion tooling (`tsx`, `adm-zip`, etc.). Ingestion scripts are manual admin runs, not deployed application code.

**Import pattern:** `tsx` (esbuild) handles CJS interop; with `esModuleInterop: true` in tsconfig:

```typescript
import pdfParse from "pdf-parse";
```

**No `package.json` script entry.** The convention for ingestion scripts in this project is direct `npx tsx` invocation — there are no `ingest:*` entries in `package.json`.

---

## Parse Logic (`sff.ts`)

### Type

```typescript
export interface SffParseResult {
  sffCcns: string[]; // deduplicated; SFF takes precedence over candidates
  candidateCcns: string[]; // deduplicated; excludes any CCN already in sffCcns
}
```

### `parseSffText(text: string): SffParseResult`

Scans lines for section headers. Section detection uses an if/else chain — the more specific header is checked first:

```
if line contains "Special Focus Facility Candidates" → enter candidate section
else if line contains "Special Focus Facilit"         → enter SFF section
```

This order prevents "Special Focus Facility Candidates" from being misclassified as the SFF section.

Once inside a section, extracts 6-digit numeric CCNs via regex (`/\b\d{6}\b/`) from each line. Nursing home CCNs are always 6 digits.

**CCN regex caveat:** The regex will match any 6-digit number on a line (e.g., enrollment counts, zip codes). CMS PDFs present CCNs in a structured table column; in practice false positives are unlikely. This is an accepted risk for a manually verified quarterly document. If a future PDF format change causes false positives, the regex can be tightened to positional column parsing.

**Deduplication:** Each section accumulates CCNs into a `Set<string>` internally. `sffCcns` and `candidateCcns` are returned as deduplicated arrays. If a CCN appears in both sections (malformed input), it appears only in `sffCcns`:

```typescript
const candidateCcns = [...rawCandidateSet].filter((ccn) => !sffSet.has(ccn));
```

---

## DB Update Strategy (`ingest-sff.ts`)

### Imports

```typescript
import { resolveProviders } from "./lib/hcris";
```

`resolveProviders(ccns: string[]): Promise<Map<string, string>>` — confirmed generic implementation: `SELECT id, cms_id FROM providers WHERE cms_id IN (ccns)`. Returns `Map<cms_id, provider_uuid>`.

A top-level import is safe — `resolveProviders` does not access the database at import time; it calls `getSupabaseAdmin()` lazily at call time. The `supabaseAdmin` import in `main()` (see below) is still required for the flag-update steps.

### Supabase client import

Use the lazy dynamic import pattern (matching `ingest-puf.ts`) to avoid errors when the module is imported in test environments:

```typescript
export async function main() {
  const { supabaseAdmin } = await import("./lib/supabase-admin");
  // ...
}
```

Do NOT import `supabaseAdmin` at the top level.

### `isDirectRun` guard

Required to prevent `main()` from firing when the module is imported:

```typescript
const isDirectRun =
  import.meta.url === new URL(process.argv[1], "file://").href;
if (isDirectRun) {
  main().catch((err) => {
    console.error("Fatal error:", err);
    process.exit(1);
  });
}
```

### Chunk size

UUID-based `.in()` queries use URL query params in PostgREST. Each UUID is ~37 chars with separator. With ~441 candidate IDs (~16KB) this exceeds the 8KB URL limit that causes "fetch failed" errors. Use `CHUNK_SIZE = 100` for steps 6 and 7 (matching `ingest-puf.ts`). The SFF set (~88 IDs) is safely under the limit, but chunk both for consistency.

### Error handling

All Supabase calls must check the returned `error` object and throw immediately:

```typescript
const { error } = await supabaseAdmin.from("providers").update(...).or(...);
if (error) throw new Error(`Failed to clear SFF flags: ${error.message}`);
```

Apply this pattern to every Supabase call (steps 5, 6, 7).

### Sequential steps

1. Read PDF file path from `process.argv[2]` — exit with error if not provided or file not found
2. Read file from disk → `pdfParse(buffer)` → extract `.text` → `parseSffText(text)` → `{ sffCcns, candidateCcns }`
3. `resolveProviders([...sffCcns, ...candidateCcns])` → UUID lookup map
4. Map CCNs to UUIDs; log any CCNs from the PDF that didn't match an existing provider — informational only, no exit failure (a new facility may not yet be ingested)
5. **Clear all flags** — check `error`, throw if set:
   ```typescript
   await supabaseAdmin
     .from("providers")
     .update({ is_sff: false, is_sff_candidate: false })
     .or("is_sff.eq.true,is_sff_candidate.eq.true");
   ```
   `is_sff` and `is_sff_candidate` have `DEFAULT FALSE` in the migration — NULLs are not expected from standard ingestion and the filter is correct in practice. If NULLs are present from a non-standard insert path, those rows would be missed; this is an accepted risk for a manual quarterly script.
6. **Set SFF flags** — skip if `sffIds` is empty; otherwise chunk in groups of 100:
   ```typescript
   await supabaseAdmin
     .from("providers")
     .update({ is_sff: true })
     .in("id", chunk);
   ```
7. **Set candidate flags** — skip if `candidateIds` is empty; otherwise chunk in groups of 100:
   ```typescript
   await supabaseAdmin
     .from("providers")
     .update({ is_sff_candidate: true })
     .in("id", chunk);
   ```
8. Print summary: CCNs in PDF / matched / unmatched / SFF updated / candidates updated

**Empty array guard:** Steps 6 and 7 must skip the DB call if the ID array is empty — `WHERE id IN ()` is a Postgres syntax error via the Supabase client.

**Atomicity:** No transaction. Design decision: re-run is the recovery path for any failure window. Re-running is always safe — step 5 re-clears all flags before any are set.

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
- Deduplicates within each section (duplicate CCN in PDF → appears once in result)
- Ignores non-CCN numeric strings (e.g., page numbers, 4-digit years — not 6 digits)
- Returns empty arrays when a section is missing from the text
- When a CCN appears in both sections, it appears only in `sffCcns`

---

## No Schema Changes

`is_sff` and `is_sff_candidate` already exist as `BOOLEAN DEFAULT FALSE` columns on the `providers` table. No migration required.
