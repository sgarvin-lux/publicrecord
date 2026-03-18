import { describe, it, expect } from "vitest";
import { normalizeEntityName, transformOwnership } from "../transform-ownership";

describe("normalizeEntityName", () => {
  it("strips LLC suffix", () =>
    expect(normalizeEntityName("Sunrise Senior Living, LLC")).toBe("sunrise senior living"));

  it("strips Corp. suffix with trailing period", () =>
    expect(normalizeEntityName("GENESIS HEALTHCARE CORP.")).toBe("genesis healthcare"));

  it("strips Inc suffix", () =>
    expect(normalizeEntityName("ABC Management Inc")).toBe("abc management"));

  it("strips L.L.C. suffix", () =>
    expect(normalizeEntityName("ABC Health Services, L.L.C.")).toBe("abc health services"));

  it("strips L.L.C without trailing dot", () =>
    expect(normalizeEntityName("ABC Health Services, L.L.C")).toBe("abc health services"));

  it("strips Ltd suffix", () =>
    expect(normalizeEntityName("Smith Holdings Ltd")).toBe("smith holdings"));

  it("strips LP suffix", () =>
    expect(normalizeEntityName("Acme Partners LP")).toBe("acme partners"));

  it("strips LLP suffix", () =>
    expect(normalizeEntityName("Brown Associates LLP")).toBe("brown associates"));

  it("strips L.L.P. suffix", () =>
    expect(normalizeEntityName("Brown Associates L.L.P.")).toBe("brown associates"));

  it("strips L.P. suffix", () =>
    expect(normalizeEntityName("Acme Partners L.P.")).toBe("acme partners"));

  it("strips Limited suffix", () =>
    expect(normalizeEntityName("Smith Holdings Limited")).toBe("smith holdings"));

  it("strips Co suffix", () =>
    expect(normalizeEntityName("Acme Co")).toBe("acme"));

  it("strips Incorporated suffix", () =>
    expect(normalizeEntityName("Sunrise Care Incorporated")).toBe("sunrise care"));

  it("strips Corporation suffix", () =>
    expect(normalizeEntityName("National Health Corporation")).toBe("national health"));

  it("lowercases the result", () =>
    expect(normalizeEntityName("SENIOR CARE INC")).toBe("senior care"));

  it("collapses internal whitespace", () =>
    expect(normalizeEntityName("Acme   Health  Inc")).toBe("acme health"));

  it("trims leading and trailing whitespace", () =>
    expect(normalizeEntityName("  Acme Inc  ")).toBe("acme"));

  it("does not strip suffix words that appear mid-name", () =>
    expect(normalizeEntityName("Incorporated Care LLC")).toBe("incorporated care"));

  it("does not strip Co from mid-word (e.g., Costco)", () =>
    expect(normalizeEntityName("Costco Health LLC")).toBe("costco health"));

  it("returns empty string for empty input", () =>
    expect(normalizeEntityName("")).toBe(""));

  it("returns empty string for whitespace-only input", () =>
    expect(normalizeEntityName("   ")).toBe(""));

  it("handles already-clean names with no changes", () =>
    expect(normalizeEntityName("sunrise senior living")).toBe("sunrise senior living"));

  it("strips commas and periods from names", () =>
    expect(normalizeEntityName("Smith, John A.")).toBe("smith john a"));
});

describe("transformOwnership", () => {
  const baseRecord: Record<string, string> = {
    cms_certification_number_ccn: "015001",
    owner_name: "Sunrise Senior Living, LLC",
    owner_type: "Organization",
    ownership_percentage: "100",
    association_date: "since 01/15/2020",
  };

  it("maps a valid record correctly", () => {
    expect(transformOwnership(baseRecord)).toEqual({
      cms_id: "015001",
      owner_name: "Sunrise Senior Living, LLC",
      owner_type: "Organization",
      ownership_pct: 100,
      effective_date: "2020-01-15",
    });
  });

  it("returns null when cms_id is missing", () => {
    const { cms_certification_number_ccn: _, ...rest } = baseRecord;
    expect(transformOwnership(rest)).toBeNull();
  });

  it("returns null when cms_id is blank", () => {
    expect(transformOwnership({ ...baseRecord, cms_certification_number_ccn: "   " })).toBeNull();
  });

  it("returns null when owner_name is missing", () => {
    const { owner_name: _, ...rest } = baseRecord;
    expect(transformOwnership(rest)).toBeNull();
  });

  it("returns null when owner_name is blank/whitespace", () => {
    expect(transformOwnership({ ...baseRecord, owner_name: "  " })).toBeNull();
  });

  it("returns null ownership_pct for non-numeric value", () => {
    expect(
      transformOwnership({ ...baseRecord, ownership_percentage: "N/A" })?.ownership_pct
    ).toBeNull();
  });

  it("returns null ownership_pct when field is absent", () => {
    const { ownership_percentage: _, ...rest } = baseRecord;
    expect(transformOwnership(rest)?.ownership_pct).toBeNull();
  });

  it("returns null effective_date for invalid date", () => {
    expect(
      transformOwnership({ ...baseRecord, association_date: "not-a-date" })?.effective_date
    ).toBeNull();
  });

  it("returns null effective_date when field is absent", () => {
    const { association_date: _, ...rest } = baseRecord;
    expect(transformOwnership(rest)?.effective_date).toBeNull();
  });

  it("parses ownership percentage with percent sign", () => {
    expect(
      transformOwnership({ ...baseRecord, ownership_percentage: "5%" })?.ownership_pct
    ).toBe(5);
  });

  it("parses association_date with 'since' prefix", () => {
    expect(
      transformOwnership({ ...baseRecord, association_date: "since 03/15/2019" })?.effective_date
    ).toBe("2019-03-15");
  });
});
