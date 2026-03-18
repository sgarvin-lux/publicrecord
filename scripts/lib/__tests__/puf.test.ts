import { describe, it, expect } from "vitest";
import {
  parseAmount,
  transformPufRows,
  buildPufProviderUpdates,
  type PufPaymentHistoryRow,
} from "../puf";

const lookup = new Map([
  ["010001", "uuid-provider-1"],
  ["010002", "uuid-provider-2"],
]);

const baseRow: Record<string, string> = {
  SMRY_CTGRY: "PROVIDER",
  PRVDR_ID: "010001",
  YEAR: "2023",
  TOT_MDCR_PYMT_AMT: "797586",
  TOT_CHRG_AMT: "9659610",
  TOT_SRVC_DAYS: "1202",
  BENE_DSTNCT_CNT: "83",
};

const basePufRow: PufPaymentHistoryRow = {
  provider_id: "uuid-provider-1",
  fiscal_year: 2023,
  medicare_payments: 797586,
  total_charges: 9659610,
  total_days: 1202,
  total_patients: 83,
  data_source: "utilization_puf",
};

describe("parseAmount", () => {
  it("returns null for *", () => expect(parseAmount("*")).toBeNull());
  it("returns null for empty string", () => expect(parseAmount("")).toBeNull());
  it("returns null for non-numeric", () =>
    expect(parseAmount("abc")).toBeNull());
  it("returns null for partially-numeric (trailing chars)", () =>
    expect(parseAmount("123abc")).toBeNull());
  it("parses large integer", () =>
    expect(parseAmount("25968510365")).toBe(25968510365));
  it("parses regular integer", () =>
    expect(parseAmount("797586")).toBe(797586));
  it("returns null for undefined", () =>
    expect(parseAmount(undefined)).toBeNull());
});

describe("transformPufRows", () => {
  it("transforms a complete provider row", () => {
    const result = transformPufRows([baseRow], lookup);
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({
      provider_id: "uuid-provider-1",
      fiscal_year: 2023,
      medicare_payments: 797586,
      total_charges: 9659610,
      total_days: 1202,
      total_patients: 83,
      data_source: "utilization_puf",
    });
  });

  it("skips non-PROVIDER rows", () => {
    const result = transformPufRows(
      [{ ...baseRow, SMRY_CTGRY: "NATION" }],
      lookup,
    );
    expect(result).toHaveLength(0);
  });

  it("skips STATE rows", () => {
    const result = transformPufRows(
      [{ ...baseRow, SMRY_CTGRY: "STATE" }],
      lookup,
    );
    expect(result).toHaveLength(0);
  });

  it("skips rows with unknown CCN", () => {
    const result = transformPufRows(
      [{ ...baseRow, PRVDR_ID: "UNKNOWN" }],
      lookup,
    );
    expect(result).toHaveLength(0);
  });

  it("returns null for suppressed (*) amounts", () => {
    const result = transformPufRows(
      [{ ...baseRow, TOT_CHRG_AMT: "*" }],
      lookup,
    );
    expect(result[0].total_charges).toBeNull();
  });

  it("returns null for empty amounts", () => {
    const result = transformPufRows(
      [{ ...baseRow, TOT_MDCR_PYMT_AMT: "" }],
      lookup,
    );
    expect(result[0].medicare_payments).toBeNull();
  });
});

describe("buildPufProviderUpdates", () => {
  it("returns update when payment_data_source is null", () => {
    const dataSources = new Map<string, string | null>([
      ["uuid-provider-1", null],
    ]);
    const result = buildPufProviderUpdates([basePufRow], dataSources);
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      provider_id: "uuid-provider-1",
      annual_medicare_payments: 797586,
      payment_data_year: 2023,
      payment_data_source: "utilization_puf",
    });
  });

  it("skips provider when payment_data_source is already set", () => {
    const dataSources = new Map<string, string | null>([
      ["uuid-provider-1", "hcris"],
    ]);
    const result = buildPufProviderUpdates([basePufRow], dataSources);
    expect(result).toHaveLength(0);
  });

  it("picks highest fiscal year for same provider across datasets", () => {
    const older = {
      ...basePufRow,
      fiscal_year: 2022,
      medicare_payments: 500000,
    };
    const newer = {
      ...basePufRow,
      fiscal_year: 2023,
      medicare_payments: 797586,
    };
    const dataSources = new Map<string, string | null>([
      ["uuid-provider-1", null],
    ]);
    const result = buildPufProviderUpdates([older, newer], dataSources);
    expect(result).toHaveLength(1);
    expect(result[0].payment_data_year).toBe(2023);
    expect(result[0].annual_medicare_payments).toBe(797586);
  });

  it("skips provider when medicare_payments is null", () => {
    const row = { ...basePufRow, medicare_payments: null };
    const dataSources = new Map<string, string | null>([
      ["uuid-provider-1", null],
    ]);
    const result = buildPufProviderUpdates([row], dataSources);
    expect(result).toHaveLength(0);
  });

  it("falls back to lower fiscal year when latest year has suppressed payments", () => {
    // Latest year is suppressed; earlier year has valid data — earlier should win.
    const suppressed = {
      ...basePufRow,
      fiscal_year: 2023,
      medicare_payments: null,
    };
    const valid = {
      ...basePufRow,
      fiscal_year: 2022,
      medicare_payments: 500000,
    };
    const dataSources = new Map<string, string | null>([
      ["uuid-provider-1", null],
    ]);
    const result = buildPufProviderUpdates([suppressed, valid], dataSources);
    expect(result).toHaveLength(1);
    expect(result[0].payment_data_year).toBe(2022);
    expect(result[0].annual_medicare_payments).toBe(500000);
  });

  it("computes charge_to_payment_ratio", () => {
    const dataSources = new Map<string, string | null>([
      ["uuid-provider-1", null],
    ]);
    const result = buildPufProviderUpdates([basePufRow], dataSources);
    // 9659610 / 797586 ≈ 12.11
    expect(result[0].charge_to_payment_ratio).toBeCloseTo(12.11, 1);
  });

  it("sets charge_to_payment_ratio to null when total_charges is null", () => {
    const row = { ...basePufRow, total_charges: null };
    const dataSources = new Map<string, string | null>([
      ["uuid-provider-1", null],
    ]);
    const result = buildPufProviderUpdates([row], dataSources);
    expect(result[0].charge_to_payment_ratio).toBeNull();
  });
});
