# Operator Matching & Ownership Data Ingestion — Design Spec

**Linear:** PUB-11
**Date:** 2026-03-18
**Milestone:** M3: Payment Data & Scoring

---

## Overview

Ingest CMS nursing home ownership data (dataset `y2hd-n93e`) and build operator matching to link facilities under common operators. All ownership record types (individual, corporate, partnership) are considered for matching. The pipeline runs weekly, performing a full replace on each run.

---

## Files

### New

| File | Purpose |
|------|---------|
| `scripts/lib/transform-ownership.ts` | `OwnershipRow` type, `normalizeEntityName()`, `transformOwnership()` |
| `scripts/lib/__tests__/transform-ownership.test.ts` | Unit tests for normalization and transform |
| `scripts/__tests__/ingest-ownership.test.ts` | Integration-style tests for Phase 5 matching logic |
| `scripts/ingest-ownership.ts` | Full pipeline orchestration (all 5 phases) |
| `.github/workflows/ingest-ownership.yml` | Monday 2am UTC schedule + manual dispatch |

### Modified

| File | Change |
|------|--------|
| `.github/workflows/compute-risk-scores.yml` | Add `Ingest Ownership` to `workflow_run.workflows` list |

No new migrations required — `operators`, `provider_ownership`, and `providers.operator_id` already exist.

---

## FK Schema Reference

Both `provider_ownership.operator_id` and `providers.operator_id` are **nullable FK columns** (no `NOT NULL` constraint, no `ON DELETE CASCADE` on the operator side). This means:
- Rows in these tables can exist with `operator_id = null`
- Operators can be deleted only after all FK references are cleared to null

`provider_ownership.provider_id` is `NOT NULL REFERENCES providers(id) ON DELETE CASCADE`. This cascade does not affect the teardown sequence (we delete `provider_ownership` rows directly in Phase 3 step 1), but it means that if a `providers` row is ever deleted outside this pipeline, its `provider_ownership` rows are automatically removed. This does not require any special handling in this pipeline.

---

## Pipeline Phases

### Phase 1 — Fetch

Call `fetchAllPages('y2hd-n93e')` via the existing CMS API utility. Returns all raw ownership records as `Record<string, string>[]`.

### Phase 2 — Build provider lookup

Fetch all `(id, cms_id)` pairs from `providers` into a `Map<string, string>` (cms_id → provider_id). Used to resolve FK references without per-row DB queries. Providers that no longer exist in the DB (e.g., deleted between runs) will simply have no matching key; Phase 4 will skip those records silently, which is the correct behavior.

### Phase 3 — Full replace teardown

Execute in this order (required by nullable FK constraints):

1. Delete all rows from `provider_ownership`
2. Set `providers.operator_id = null` for all providers (batched updates)
3. Delete all rows from `operators`

Steps 1 and 2 clear all FK references to `operators` before step 3 deletes them. `provider_ownership.operator_id` references are eliminated by step 1 (row deletion); `providers.operator_id` references are cleared in step 2 (null update). Any Supabase error in these steps throws immediately and aborts the pipeline.

### Phase 4 — Transform and insert ownership rows

For each raw CMS record:
- Call `transformOwnership(raw)` → `OwnershipRow | null` (includes `cms_id` as an intermediate field for lookup, not persisted)
- Skip records where `transformOwnership` returns null
- Resolve `provider_id` from the lookup map using `row.cms_id`; skip if not found (provider not yet ingested)
- Build an insert object: all `OwnershipRow` fields except `cms_id`, plus `provider_id` and `operator_id: null`
- Batch-insert into `provider_ownership`

Batch size: 500 rows (consistent with other ingest scripts).

**Zero-insert guard:** After all batches complete, if zero rows were inserted, log an error and `process.exit(1)`. This prevents a CMS API outage from silently wiping `provider_ownership`.

### Phase 5 — Match and link

Phase 5 re-fetches from the database (rather than using in-memory records from Phase 4) because `provider_ownership.id` — the UUID assigned by Postgres on insert — is needed for the operator backfill updates and is not available in the in-memory transform output.

1. Fetch all `(id, owner_name, provider_id)` from `provider_ownership`
2. Normalize each `owner_name` using `normalizeEntityName()`
3. Group rows by normalized name; collect distinct `provider_id`s per group
4. For each group with **2+ distinct providers**:
   - Select the `operators.name` as the **alphabetically first raw `owner_name`** in the group (sort applied to raw strings, not normalized form; deterministic across runs)
   - Insert a row into `operators` with that name and `facility_count` set to the number of distinct `provider_id`s in the group
   - Batch-update `provider_ownership.operator_id` for all rows in the group
   - Batch-update `providers.operator_id` for all distinct providers in the group
   - Any Supabase error in these updates throws immediately and aborts the pipeline
5. Groups with exactly **1 distinct provider** receive no `operators` record. Their `provider_ownership` rows remain with `operator_id = null`. This is the correct terminal state — a facility whose owners do not operate any other facility in the dataset is not linked to an operator. `providers.operator_id` remains null for these facilities.

---

## Name Normalization

`normalizeEntityName(name: string): string` — applied before grouping in Phase 5.

Steps applied in order:

1. **Lowercase** the entire string
2. **Strip legal entity suffixes** as whole words at the end of the string:
   `inc`, `incorporated`, `llc`, `l.l.c.`, `corp`, `corporation`, `ltd`, `limited`, `lp`, `l.p.`, `llp`, `l.l.p.`, `co`
3. **Strip punctuation** (commas, periods, apostrophes)
4. **Collapse whitespace** (trim + normalize internal spaces to single space)

**Examples:**

| Input | Output |
|-------|--------|
| `"Sunrise Senior Living, LLC"` | `"sunrise senior living"` |
| `"GENESIS HEALTHCARE CORP."` | `"genesis healthcare"` |
| `"Smith, John A."` | `"smith john a"` |
| `"ABC Health Services, L.L.C."` | `"abc health services"` |

Matching is exact-match-after-normalization. Fuzzy matching is post-MVP.

---

## Data Shapes

```typescript
// transform-ownership.ts

// Returned by transformOwnership() — includes cms_id for provider_id resolution in Phase 4 (not persisted)
export interface OwnershipRow {
  cms_id: string;          // intermediate only — used for provider_id lookup, not inserted
  owner_name: string;
  owner_type: string | null;
  ownership_pct: number | null;
  effective_date: string | null; // ISO date string or null
}
```

Raw CMS field names are resolved at implementation time by inspecting the live dataset response (dataset `y2hd-n93e` at `https://data.cms.gov/provider-data/dataset/y2hd-n93e`). Field-name discovery is an implementation responsibility; expected fields include a provider CCN identifier, owner name, owner type, ownership percentage, and effective date.

---

## Script Structure

`ingest-ownership.ts` must follow the established codebase pattern:

```typescript
export async function main() {
  // all 5 phases
}

const isDirectRun = import.meta.url === new URL(process.argv[1], 'file://').href;
if (isDirectRun) {
  main().catch((error) => {
    console.error('Ownership ingestion failed:', error);
    process.exit(1);
  });
}
```

The `export async function main()` + `isDirectRun` guard is required for test isolation — tests import `main` directly without auto-executing it.

---

## Testing

**`ingest-ownership.test.ts`** covers Phase 5 matching logic (using a test Supabase client or in-memory stubs):

- Two providers with matching normalized owner names are grouped → one `operators` record created, both `providers.operator_id` set, both `provider_ownership.operator_id` set
- A provider whose owner matches no other provider remains with `operator_id = null` (single-facility owner — correct terminal state)
- Zero-insert guard: if Phase 4 inserts zero rows, `process.exit(1)` is called

**`transform-ownership.test.ts`** covers:

- `normalizeEntityName()`:
  - Strips LLC, Corp, Inc, Ltd, LP, LLP, Co suffixes (with and without punctuation)
  - Handles uppercase, mixed case
  - Collapses internal whitespace
  - No-ops on already-clean names
  - Returns empty string for empty input

- `transformOwnership()`:
  - Valid record maps all fields correctly, including `cms_id` in output
  - Returns `null` when `cms_id` is missing or blank/whitespace-only
  - Returns `null` when `owner_name` is missing or blank/whitespace-only (empty string from CMS response must not produce a row)
  - Numeric fields (`ownership_pct`) parse correctly; non-numeric → `null`
  - Date fields normalize correctly; invalid date → `null`

---

## GitHub Actions

### `ingest-ownership.yml`

```yaml
name: Ingest Ownership

on:
  schedule:
    - cron: '0 2 * * 1'  # Monday 2am UTC
  workflow_dispatch:

jobs:
  ingest:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: npm
      - run: npm ci
      - run: npx tsx scripts/ingest-ownership.ts
        env:
          SUPABASE_URL: ${{ secrets.SUPABASE_URL }}
          SUPABASE_SERVICE_ROLE_KEY: ${{ secrets.SUPABASE_SERVICE_ROLE_KEY }}
```

### `compute-risk-scores.yml` update

Add `Ingest Ownership` to the existing `workflow_run.workflows` list. **The string must exactly match the `name:` field in `ingest-ownership.yml`** — a mismatch silently prevents the downstream trigger from firing. The existing `branches: [main]` filter on the `workflow_run` trigger will apply to this entry as well, meaning ownership ingest runs on feature branches will not trigger risk score recomputation. This is intentional and consistent with all other ingestion workflows.

---

## Acceptance Criteria

- Ownership data ingested for all ~15,000 nursing homes
- Operators with 2+ facilities identified and linked
- `providers.operator_id` set for all linked providers
- `provider_ownership` populated with full-fidelity records (all owner types, all ownership percentages)
- Single-facility owners leave `provider_ownership.operator_id = null` — correct terminal state, not a bug
- Zero-insert guard detects and surfaces CMS API failures that would otherwise result in a silent data wipe
- Operator aggregates recomputed via downstream `compute-risk-scores` workflow
- Pipeline runs weekly on Monday 2am UTC; idempotent via full replace
