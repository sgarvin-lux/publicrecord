import { describe, it, expect } from "vitest";
import {
  parseCmsDate,
  parseAmount,
  composeDescription,
  transformPenaltyRecord,
} from "../transform-penalties";

describe("parseCmsDate", () => {
  it("parses MM/DD/YYYY to YYYY-MM-DD", () => {
    expect(parseCmsDate("01/15/2025")).toBe("2025-01-15");
  });

  it("returns null for empty string", () => {
    expect(parseCmsDate("")).toBeNull();
  });

  it("returns null for undefined", () => {
    expect(parseCmsDate(undefined)).toBeNull();
  });
});

describe("parseAmount", () => {
  it("parses a plain number string", () => {
    expect(parseAmount("12500")).toBe(12500);
  });

  it("strips dollar sign and commas", () => {
    expect(parseAmount("$12,500.00")).toBe(12500);
  });

  it("returns 0 for empty string", () => {
    expect(parseAmount("")).toBe(0);
  });

  it("returns 0 for undefined", () => {
    expect(parseAmount(undefined)).toBe(0);
  });
});

describe("composeDescription", () => {
  it("composes fine description with formatted amount", () => {
    expect(
      composeDescription({
        penalty_type: "Fine",
        fine_amount: "12500",
      }),
    ).toBe("Civil money penalty: $12,500");
  });

  it("composes payment denial with days and start date", () => {
    expect(
      composeDescription({
        penalty_type: "Payment Denial",
        payment_denial_length_in_days: "30",
        payment_denial_start_date: "01/15/2025",
      }),
    ).toBe("Payment denial: 30 days starting 2025-01-15");
  });

  it("falls back for payment denial without details", () => {
    expect(
      composeDescription({
        penalty_type: "Payment Denial",
      }),
    ).toBe("Payment denial");
  });

  it("handles unknown penalty type", () => {
    expect(
      composeDescription({
        penalty_type: "State Monitor",
      }),
    ).toBe("State Monitor");
  });
});

describe("transformPenaltyRecord", () => {
  const providerMap = new Map([["015001", "uuid-abc-123"]]);

  it("transforms a Fine record correctly", () => {
    const raw = {
      cms_certification_number_ccn: "015001",
      penalty_date: "03/15/2025",
      penalty_type: "Fine",
      fine_amount: "5000",
      payment_denial_start_date: "",
      payment_denial_length_in_days: "",
    };

    const result = transformPenaltyRecord(raw, providerMap);

    expect(result).toEqual({
      provider_id: "uuid-abc-123",
      penalty_date: "2025-03-15",
      penalty_type: "Fine",
      amount: 5000,
      description: "Civil money penalty: $5,000",
    });
  });

  it("transforms a Payment Denial with amount defaulted to 0", () => {
    const raw = {
      cms_certification_number_ccn: "015001",
      penalty_date: "03/15/2025",
      penalty_type: "Payment Denial",
      fine_amount: "",
      payment_denial_start_date: "03/20/2025",
      payment_denial_length_in_days: "15",
    };

    const result = transformPenaltyRecord(raw, providerMap);

    expect(result).toEqual({
      provider_id: "uuid-abc-123",
      penalty_date: "2025-03-15",
      penalty_type: "Payment Denial",
      amount: 0,
      description: "Payment denial: 15 days starting 2025-03-20",
    });
  });

  it("returns null for unknown CMS ID", () => {
    const raw = {
      cms_certification_number_ccn: "999999",
      penalty_date: "03/15/2025",
      penalty_type: "Fine",
      fine_amount: "1000",
    };

    const result = transformPenaltyRecord(raw, providerMap);
    expect(result).toBeNull();
  });

  it("returns null for missing penalty_date", () => {
    const raw = {
      cms_certification_number_ccn: "015001",
      penalty_date: "",
      penalty_type: "Fine",
      fine_amount: "1000",
    };

    const result = transformPenaltyRecord(raw, providerMap);
    expect(result).toBeNull();
  });

  it("returns null for missing penalty_type", () => {
    const raw = {
      cms_certification_number_ccn: "015001",
      penalty_date: "03/15/2025",
      penalty_type: "",
      fine_amount: "1000",
    };

    const result = transformPenaltyRecord(raw, providerMap);
    expect(result).toBeNull();
  });
});
