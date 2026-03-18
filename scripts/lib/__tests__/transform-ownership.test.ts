import { describe, it, expect } from "vitest";
import { normalizeEntityName } from "../transform-ownership";

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
