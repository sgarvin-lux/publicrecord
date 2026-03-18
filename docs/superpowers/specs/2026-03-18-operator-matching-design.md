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
| `scripts/ingest-ownership.ts` | Full pipeline orchestration (all 5 phases) |
| `.github/workflows/ingest-ownership.yml` | Monday 2am UTC schedule + manual dispatch |

### Modified

| File | Change |
|------|--------|
| `.github/workflows/compute-risk-scores.yml` | Add `Ingest Ownership` to `workflow_run.workflows` list |

No new migrations required — `operators`, `provider_ownership`, and `providers.operator_id` already exist.

---

## Pipeline Phases

### Phase 1 — Fetch

Call `fetchAllPages('y2hd-n93e')` via the existing CMS API utility. Returns all raw ownership records as `Record<string, string>[]`.

### Phase 2 — Build provider lookup

Fetch all `(id, cms_id)` pairs from `providers` into a `Map<string, string>` (cms_id → provider_id). Used to resolve FK references without per-row DB queries.

### Phase 3 — Full replace teardown

Execute in order (FK constraints require this sequence):

1. Delete all rows from `provider_ownership`
2. Set `providers.operator_id = null` for all providers (batched)
3. Delete all rows from `operators`

### Phase 4 — Transform and insert ownership rows

For each raw CMS record:
- Call `transformOwnership(raw)` to map fields → `OwnershipRow | null`
- Skip records where `cms_id` is missing or not found in the provider lookup map
- Resolve `provider_id` from lookup map
- Batch-insert into `provider_ownership` (`operator_id` is null at this stage)

Batch size: 500 rows (consistent with other ingest scripts).

### Phase 5 — Match and link

1. Fetch all `(id, owner_name, provider_id)` from `provider_ownership`
2. Normalize each `owner_name` using `normalizeEntityName()`
3. Group rows by normalized name; collect distinct `provider_id`s per group
4. For each group with **2+ distinct providers**:
   - Insert a row into `operators` (`name` = original owner name from first occurrence)
   - Batch-update `provider_ownership.operator_id` for all matching rows
   - Batch-update `providers.operator_id` for all providers in the group

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

export interface OwnershipRow {
  owner_name: string;
  owner_type: string | null;
  ownership_pct: number | null;
  effective_date: string | null; // ISO date string
}

// Resolved before insert (not part of transform output)
export interface OwnershipInsertRow extends OwnershipRow {
  provider_id: string;
  operator_id: null;
}
```

Raw CMS field names are resolved at implementation time by inspecting the live dataset response.

---

## Testing

**`transform-ownership.test.ts`** covers:

- `normalizeEntityName()`:
  - Strips LLC, Corp, Inc, Ltd, LP, LLP, Co suffixes (with and without punctuation)
  - Handles uppercase, mixed case
  - Collapses internal whitespace
  - No-ops on already-clean names
  - Returns empty string for empty input

- `transformOwnership()`:
  - Valid record maps all fields correctly
  - Returns `null` when `cms_id` is missing
  - Returns `null` when `owner_name` is missing
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

Add `Ingest Ownership` to the existing `workflow_run.workflows` list so operator aggregates recompute after ownership runs.

---

## Acceptance Criteria

- Ownership data ingested for all ~15,000 nursing homes
- Operators with 2+ facilities identified and linked
- `providers.operator_id` set for all linked providers
- `provider_ownership` populated with full-fidelity records
- Operator aggregates recomputed via downstream `compute-risk-scores` workflow
- Pipeline runs weekly on Monday 2am UTC; idempotent via full replace
