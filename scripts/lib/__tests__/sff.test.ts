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
    lines.push("Table D: SFF Candidate List");
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
    const text = "Table D: SFF Candidate List\n234567 234567";
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
    const text = "Table D: SFF Candidate List\n345678";
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
