# SFF List Ingestion Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Parse the CMS Special Focus Facility PDF (passed as a CLI arg) and update `is_sff` / `is_sff_candidate` flags on matched providers in the database.

**Architecture:** Pure parse logic lives in `scripts/lib/sff.ts` (no I/O, fully testable). The orchestrator `scripts/ingest-sff.ts` handles file reading, provider UUID resolution, and DB updates. No schema changes — `is_sff` and `is_sff_candidate` already exist on the `providers` table.

**Tech Stack:** TypeScript, `pdf-parse`, `@types/pdf-parse`, `@supabase/supabase-js` v2, Vitest, `tsx`

---

## File Structure

| File | Action | Responsibility |
|------|--------|----------------|
| `package.json` | Modify | Add `pdf-parse`, `@types/pdf-parse` as devDependencies |
| `scripts/lib/sff.ts` | Create | `SffParseResult` type + `parseSffText()` pure function |
| `scripts/lib/__tests__/sff.test.ts` | Create | Unit tests for `parseSffText()` |
| `scripts/ingest-sff.ts` | Create | Orchestrator: reads PDF, resolves CCNs, updates DB flags |

---

## Chunk 1: Parse library (`sff.ts`) and tests

### Task 1: Install dependencies

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Install pdf-parse and types**

```bash
npm install --save-dev pdf-parse @types/pdf-parse
```

Expected: `package.json` devDependencies gains `pdf-parse` and `@types/pdf-parse`.

- [ ] **Step 2: Verify types are available**

```bash
npx tsc --noEmit
```

Expected: No errors related to pdf-parse types.

- [ ] **Step 3: Commit**

```bash
git add package.json package-lock.json
git commit -m "chore: add pdf-parse and @types/pdf-parse for SFF ingestion"
```

---

### Task 2: Write failing tests for `parseSffText`

**Files:**
- Create: `scripts/lib/__tests__/sff.test.ts`

- [ ] **Step 1: Create the test file**

```typescript
// scripts/lib/__tests__/sff.test.ts
import { describe, it, expect } from "vitest";
import { parseSffText } from "../sff";

// Builds a synthetic PDF text string with two sections
function buildPdfText(sffCcns: string[], candidateCcns: string[]): string {
  const lines: string[] = [];
  if (sffCcns.length > 0 || candidateCcns.length === 0) {
    lines.push("Special Focus Facilities");
    for (const ccn of sffCcns) {
      lines.push(`Provider Name                     ${ccn}    TX`);
    }
  }
  if (candidateCcns.length > 0) {
    lines.push("Special Focus Facility Candidates");
    for (const ccn of candidateCcns) {
      lines.push(`Provider Name                     ${ccn}    TX`);
    }
  }
  return lines.join("\n");
}

describe("parseSffText", () => {
  it("extracts CCNs from the SFF section", () => {
    const text = buildPdfText(["123456", "234567"], []);
    const { sffCcns } = parseSffText(text);
    expect(sffCcns).toHaveLength(2);
    expect(sffCcns).toEqual(expect.arrayContaining(["123456", "234567"]));
  });

  it("extracts CCNs from the candidate section", () => {
    const text = buildPdfText([], ["345678", "456789"]);
    const { candidateCcns } = parseSffText(text);
    expect(candidateCcns).toHaveLength(2);
    expect(candidateCcns).toEqual(expect.arrayContaining(["345678", "456789"]));
  });

  it("does not cross-contaminate sections", () => {
    const text = buildPdfText(["123456"], ["234567"]);
    const { sffCcns, candidateCcns } = parseSffText(text);
    expect(sffCcns).toContain("123456");
    expect(sffCcns).not.toContain("234567");
    expect(candidateCcns).toContain("234567");
    expect(candidateCcns).not.toContain("123456");
  });

  it("deduplicates CCNs within the SFF section", () => {
    const text = "Special Focus Facilities\n123456 123456 123456";
    const { sffCcns } = parseSffText(text);
    expect(sffCcns).toHaveLength(1);
    expect(sffCcns).toEqual(["123456"]);
  });

  it("deduplicates CCNs within the candidate section", () => {
    const text = "Special Focus Facility Candidates\n234567 234567";
    const { candidateCcns } = parseSffText(text);
    expect(candidateCcns).toHaveLength(1);
    expect(candidateCcns).toEqual(["234567"]);
  });

  it("ignores non-6-digit numeric strings", () => {
    // 4-digit year, 5-digit, 7-digit should all be ignored
    const text = "Special Focus Facilities\n2026 12345 1234567 123456";
    const { sffCcns } = parseSffText(text);
    expect(sffCcns).toEqual(["123456"]);
  });

  it("returns empty arrays when both sections are missing", () => {
    const { sffCcns, candidateCcns } = parseSffText("Some unrelated content");
    expect(sffCcns).toHaveLength(0);
    expect(candidateCcns).toHaveLength(0);
  });

  it("returns empty sffCcns when only candidate section is present", () => {
    const text = "Special Focus Facility Candidates\n345678";
    const { sffCcns, candidateCcns } = parseSffText(text);
    expect(sffCcns).toHaveLength(0);
    expect(candidateCcns).toEqual(["345678"]);
  });

  it("when a CCN appears in both sections, it appears only in sffCcns", () => {
    const text = buildPdfText(["123456"], ["123456", "234567"]);
    const { sffCcns, candidateCcns } = parseSffText(text);
    expect(sffCcns).toContain("123456");
    expect(candidateCcns).not.toContain("123456");
    expect(candidateCcns).toContain("234567");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npx vitest run scripts/lib/__tests__/sff.test.ts
```

Expected: All tests FAIL with "Cannot find module '../sff'" or similar — the module doesn't exist yet.

- [ ] **Step 3: Commit the test file**

```bash
git add scripts/lib/__tests__/sff.test.ts
git commit -m "test: add failing tests for parseSffText (PUB-6)"
```

---

### Task 3: Implement `parseSffText` to make tests pass

**Files:**
- Create: `scripts/lib/sff.ts`

- [ ] **Step 1: Create the library file**

```typescript
// scripts/lib/sff.ts

export interface SffParseResult {
  sffCcns: string[]; // deduplicated; SFF takes precedence over candidates
  candidateCcns: string[]; // deduplicated; excludes any CCN already in sffCcns
}

const CCN_REGEX = /\b\d{6}\b/g;

/**
 * Parses raw text extracted from the CMS SFF PDF into two deduplicated CCN sets.
 *
 * Section detection checks the more-specific "Candidates" header first to avoid
 * misclassifying it as the SFF section. CCN extraction uses /\b\d{6}\b/ — nursing
 * home CCNs are always 6 digits. False positives from other 6-digit numbers
 * (zip codes, enrollment counts) are an accepted risk for this quarterly manual script.
 *
 * If a CCN appears in both sections (malformed PDF), it is treated as SFF only.
 */
export function parseSffText(text: string): SffParseResult {
  const sffSet = new Set<string>();
  const rawCandidateSet = new Set<string>();
  let currentSection: "sff" | "candidate" | null = null;

  for (const line of text.split("\n")) {
    if (line.includes("Special Focus Facility Candidates")) {
      currentSection = "candidate";
    } else if (line.includes("Special Focus Facilit")) {
      currentSection = "sff";
    } else if (currentSection !== null) {
      const matches = line.match(CCN_REGEX) ?? [];
      for (const ccn of matches) {
        if (currentSection === "sff") {
          sffSet.add(ccn);
        } else {
          rawCandidateSet.add(ccn);
        }
      }
    }
  }

  // SFF takes precedence: remove any candidate CCN already in the SFF set
  const candidateCcns = [...rawCandidateSet].filter((ccn) => !sffSet.has(ccn));

  return {
    sffCcns: [...sffSet],
    candidateCcns,
  };
}
```

- [ ] **Step 2: Run tests to verify they pass**

```bash
npx vitest run scripts/lib/__tests__/sff.test.ts
```

Expected: All 9 tests PASS.

- [ ] **Step 3: Run the full test suite to check for regressions**

```bash
npm test
```

Expected: All tests pass, no regressions.

- [ ] **Step 4: Commit**

```bash
git add scripts/lib/sff.ts
git commit -m "feat: add parseSffText pure function (PUB-6)"
```

---

## Chunk 2: Ingest orchestrator (`ingest-sff.ts`)

### Task 4: Write the ingest orchestrator

**Files:**
- Create: `scripts/ingest-sff.ts`

There are no unit tests for the orchestrator — all I/O and DB calls are not mocked per project convention. The script is verified by a dry-run type-check only.

- [ ] **Step 1: Create the orchestrator**

```typescript
// scripts/ingest-sff.ts
import { readFileSync } from "fs";
import pdfParse from "pdf-parse";
import { resolveProviders } from "./lib/hcris";
import { parseSffText } from "./lib/sff";

// UUID-based .in() queries use URL params in PostgREST (~37 chars/UUID).
// 100 UUIDs ≈ 3.7KB — safely under the 8KB limit that causes "fetch failed" errors.
const CHUNK_SIZE = 100;

export async function main() {
  const { supabaseAdmin } = await import("./lib/supabase-admin");

  // ── Step 1: Validate CLI arg ─────────────────────────────────────────────
  const filePath = process.argv[2];
  if (!filePath) {
    console.error("Usage: npx tsx scripts/ingest-sff.ts <path-to-pdf>");
    process.exit(1);
  }

  let buffer: Buffer;
  try {
    buffer = readFileSync(filePath);
  } catch {
    console.error(`Error: could not read file at path: ${filePath}`);
    process.exit(1);
  }

  // ── Step 2: Parse PDF ────────────────────────────────────────────────────
  console.log(`Parsing PDF: ${filePath}`);
  const parsed = await pdfParse(buffer);
  const { sffCcns, candidateCcns } = parseSffText(parsed.text);
  console.log(
    `Found ${sffCcns.length} SFF CCNs and ${candidateCcns.length} candidate CCNs in PDF`,
  );

  // ── Step 3: Resolve CCNs to provider UUIDs ───────────────────────────────
  const allCcns = [...sffCcns, ...candidateCcns];
  console.log(`\nResolving ${allCcns.length} CCNs to provider UUIDs...`);
  const lookup = await resolveProviders(allCcns);
  console.log(`  Matched ${lookup.size} / ${allCcns.length} CCNs`);

  // ── Step 4: Log unmatched CCNs (informational) ───────────────────────────
  const unmatchedCcns = allCcns.filter((ccn) => !lookup.has(ccn));
  if (unmatchedCcns.length > 0) {
    console.warn(`\nUnmatched CCNs (not found in providers table):`);
    for (const ccn of unmatchedCcns) {
      console.warn(`  ${ccn}`);
    }
  }

  const sffIds = sffCcns
    .map((ccn) => lookup.get(ccn))
    .filter((id): id is string => id !== undefined);
  const candidateIds = candidateCcns
    .map((ccn) => lookup.get(ccn))
    .filter((id): id is string => id !== undefined);

  // ── Step 5: Clear all existing SFF flags ─────────────────────────────────
  // is_sff and is_sff_candidate default to false — NULLs not expected from
  // standard ingestion. Filter targets rows that actually need clearing.
  console.log("\nClearing existing SFF flags...");
  const { error: clearError } = await supabaseAdmin
    .from("providers")
    .update({ is_sff: false, is_sff_candidate: false })
    .or("is_sff.eq.true,is_sff_candidate.eq.true");
  if (clearError) {
    throw new Error(`Failed to clear SFF flags: ${clearError.message}`);
  }

  // ── Step 6: Set SFF flags ────────────────────────────────────────────────
  let sffUpdated = 0;
  if (sffIds.length > 0) {
    for (let i = 0; i < sffIds.length; i += CHUNK_SIZE) {
      const chunk = sffIds.slice(i, i + CHUNK_SIZE);
      const { error } = await supabaseAdmin
        .from("providers")
        .update({ is_sff: true })
        .in("id", chunk);
      if (error) throw new Error(`Failed to set SFF flags: ${error.message}`);
      sffUpdated += chunk.length;
    }
  }

  // ── Step 7: Set candidate flags ──────────────────────────────────────────
  let candidatesUpdated = 0;
  if (candidateIds.length > 0) {
    for (let i = 0; i < candidateIds.length; i += CHUNK_SIZE) {
      const chunk = candidateIds.slice(i, i + CHUNK_SIZE);
      const { error } = await supabaseAdmin
        .from("providers")
        .update({ is_sff_candidate: true })
        .in("id", chunk);
      if (error) {
        throw new Error(`Failed to set SFF candidate flags: ${error.message}`);
      }
      candidatesUpdated += chunk.length;
    }
  }

  // ── Step 8: Summary ───────────────────────────────────────────────────────
  console.log("\n--- SFF Ingestion Summary ---");
  console.log(
    `CCNs in PDF:       ${sffCcns.length} SFF + ${candidateCcns.length} candidates = ${allCcns.length} total`,
  );
  console.log(`Matched:           ${lookup.size}`);
  console.log(`Unmatched:         ${unmatchedCcns.length}`);
  console.log(`SFF updated:       ${sffUpdated}`);
  console.log(`Candidates updated: ${candidatesUpdated}`);
  console.log("Ingestion complete.");
}

const isDirectRun =
  import.meta.url === new URL(process.argv[1], "file://").href;
if (isDirectRun) {
  main().catch((err) => {
    console.error("Fatal error:", err);
    process.exit(1);
  });
}
```

- [ ] **Step 2: Type-check the new file**

```bash
npx tsc --noEmit
```

Expected: No type errors.

- [ ] **Step 3: Run the full test suite to verify nothing broke**

```bash
npm test
```

Expected: All tests pass.

- [ ] **Step 4: Commit**

```bash
git add scripts/ingest-sff.ts
git commit -m "feat: add SFF list ingest orchestrator (PUB-6)"
```

---

## Invocation

Once implemented, run with a locally downloaded SFF PDF:

```bash
npx tsx scripts/ingest-sff.ts ./sff-list-2026-q1.pdf
```

The script is safe to re-run — step 5 re-clears all flags before setting, so a partial previous run leaves no incorrect state after a re-run.
