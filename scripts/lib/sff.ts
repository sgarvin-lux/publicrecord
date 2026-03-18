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
