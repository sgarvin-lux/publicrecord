// scripts/lib/sff.ts

export interface SffParseResult {
  sffCcns: string[]; // deduplicated; SFF takes precedence over candidates
  candidateCcns: string[]; // deduplicated; excludes any CCN already in sffCcns
}

const CCN_REGEX = /\b\d{6}\b/g;

/**
 * Parses raw text extracted from the CMS SFF PDF into two deduplicated CCN sets.
 *
 * Section detection uses the real CMS PDF headers:
 *   - SFF section:       "Special Focus Facilit"  (matches "Special Focus Facility (SFF) Program")
 *   - Candidate section: "Table D:"               (matches "Table D: SFF Candidate List" per-page header)
 *
 * "Table D:" is checked first to avoid misclassifying it as the SFF section.
 * The preamble uses "Table D –" (em dash) for the candidate description, which does NOT
 * match "Table D:" so preamble text is safely ignored.
 *
 * CCN extraction uses /\b\d{6}\b/ — nursing home CCNs are always 6 digits.
 * False positives from other 6-digit numbers are an accepted risk for this quarterly script.
 *
 * If a CCN appears in both sections (malformed PDF), it is treated as SFF only.
 */
export function parseSffText(text: string): SffParseResult {
  const sffSet = new Set<string>();
  const rawCandidateSet = new Set<string>();
  let currentSection: "sff" | "candidate" | null = null;

  for (const line of text.split("\n")) {
    if (line.includes("Table D:")) {
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
