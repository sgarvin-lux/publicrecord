import { describe, it, expect } from "vitest";
import {
  computeStarRatingComponent,
  computeDeficiencyComponent,
  computePenaltyComponent,
  computeSffComponent,
  computeChargeRatioComponent,
  computeRiskScore,
  computeEte,
  riskScoreColor,
  type RiskScoreComponents,
  type RiskColor,
} from "../risk-score";

describe("computeStarRatingComponent", () => {
  it("returns 20 for 1-star rating", () => {
    expect(computeStarRatingComponent(1)).toBe(20);
  });
  it("returns 15 for 2-star rating", () => {
    expect(computeStarRatingComponent(2)).toBe(15);
  });
  it("returns 10 for 3-star rating", () => {
    expect(computeStarRatingComponent(3)).toBe(10);
  });
  it("returns 5 for 4-star rating", () => {
    expect(computeStarRatingComponent(4)).toBe(5);
  });
  it("returns 0 for 5-star rating", () => {
    expect(computeStarRatingComponent(5)).toBe(0);
  });
  it("returns null for null input", () => {
    expect(computeStarRatingComponent(null)).toBeNull();
  });
});

describe("computeDeficiencyComponent", () => {
  it("returns 0 for empty array", () => {
    expect(computeDeficiencyComponent([])).toBe(0);
  });
  it("returns 1 for [A, B, C]", () => {
    expect(computeDeficiencyComponent(["A", "B", "C"])).toBe(1);
  });
  it("returns 3 for [D, E]", () => {
    expect(computeDeficiencyComponent(["D", "E"])).toBe(3);
  });
  it("returns 5 for [G]", () => {
    expect(computeDeficiencyComponent(["G"])).toBe(5);
  });
  it("returns 8 for [J]", () => {
    expect(computeDeficiencyComponent(["J"])).toBe(8);
  });
  it("caps at 30 for [J, K, L, J, K]", () => {
    expect(computeDeficiencyComponent(["J", "K", "L", "J", "K"])).toBe(30);
  });
  it("returns 14 for [A, D, G, J]", () => {
    expect(computeDeficiencyComponent(["A", "D", "G", "J"])).toBe(14);
  });
  it("returns 0 for [null, empty string, unknown]", () => {
    expect(computeDeficiencyComponent([null, "", "Z"])).toBe(0);
  });
  it("handles lowercase codes by uppercasing", () => {
    expect(computeDeficiencyComponent(["a", "b", "c"])).toBe(1);
  });
});

describe("computePenaltyComponent", () => {
  it("returns 0 for (0, 0)", () => {
    expect(computePenaltyComponent(0, 0)).toBe(0);
  });
  it("returns 7 for (50000, 1)", () => {
    expect(computePenaltyComponent(50000, 1)).toBe(7);
  });
  it("returns 12 for (2000000, 1)", () => {
    expect(computePenaltyComponent(2000000, 1)).toBe(12);
  });
  it("returns 10 for (0, 10)", () => {
    expect(computePenaltyComponent(0, 10)).toBe(10);
  });
  it("returns 20 for (5000000, 50)", () => {
    expect(computePenaltyComponent(5000000, 50)).toBe(20);
  });
});

describe("computeSffComponent", () => {
  it("returns 15 for SFF=true, candidate=false", () => {
    expect(computeSffComponent(true, false)).toBe(15);
  });
  it("returns 8 for SFF=false, candidate=true", () => {
    expect(computeSffComponent(false, true)).toBe(8);
  });
  it("returns 0 for neither", () => {
    expect(computeSffComponent(false, false)).toBe(0);
  });
  it("returns 15 when both true (SFF takes priority)", () => {
    expect(computeSffComponent(true, true)).toBe(15);
  });
});

describe("computeChargeRatioComponent", () => {
  it("returns 0 for null", () => {
    expect(computeChargeRatioComponent(null)).toBe(0);
  });
  it("returns 0 for ratio 1.2 (<=1.5)", () => {
    expect(computeChargeRatioComponent(1.2)).toBe(0);
  });
  it("returns 0 for ratio 1.5 (boundary, <=1.5)", () => {
    expect(computeChargeRatioComponent(1.5)).toBe(0);
  });
  it("returns 5 for ratio 1.7 (1.5-2.0)", () => {
    expect(computeChargeRatioComponent(1.7)).toBe(5);
  });
  it("returns 5 for ratio 2.0 (boundary, 1.5-2.0)", () => {
    expect(computeChargeRatioComponent(2.0)).toBe(5);
  });
  it("returns 10 for ratio 2.5 (2.0-3.0)", () => {
    expect(computeChargeRatioComponent(2.5)).toBe(10);
  });
  it("returns 10 for ratio 3.0 (boundary, 2.0-3.0)", () => {
    expect(computeChargeRatioComponent(3.0)).toBe(10);
  });
  it("returns 15 for ratio 3.1 (>3.0)", () => {
    expect(computeChargeRatioComponent(3.1)).toBe(15);
  });
  it("returns 15 for ratio 10.0 (>3.0)", () => {
    expect(computeChargeRatioComponent(10.0)).toBe(15);
  });
});

describe("computeRiskScore", () => {
  it("computes weighted composite with all components", () => {
    const components: RiskScoreComponents = {
      starRatingComponent: 20,
      deficiencyComponent: 15,
      penaltyComponent: 10,
      sffComponent: 15,
      chargeRatioComponent: 5,
    };
    // 20*0.20 + 15*0.30 + 10*0.20 + 15*0.15 + 5*0.15
    // = 4 + 4.5 + 2 + 2.25 + 0.75 = 13.5 → 14
    expect(computeRiskScore(components)).toBe(14);
  });

  it("redistributes star weight when starRatingComponent is null", () => {
    const components: RiskScoreComponents = {
      starRatingComponent: null,
      deficiencyComponent: 15,
      penaltyComponent: 10,
      sffComponent: 15,
      chargeRatioComponent: 5,
    };
    // Without star (weight 0.20 removed), remaining 0.80 scaled by 1.25:
    // def: 0.30*1.25=0.375, pen: 0.20*1.25=0.25, sff: 0.15*1.25=0.1875, charge: 0.15*1.25=0.1875
    // 15*0.375 + 10*0.25 + 15*0.1875 + 5*0.1875
    // = 5.625 + 2.5 + 2.8125 + 0.9375 = 11.875 → 12
    expect(computeRiskScore(components)).toBe(12);
  });

  it("returns 0 for all zero components", () => {
    const components: RiskScoreComponents = {
      starRatingComponent: 0,
      deficiencyComponent: 0,
      penaltyComponent: 0,
      sffComponent: 0,
      chargeRatioComponent: 0,
    };
    expect(computeRiskScore(components)).toBe(0);
  });

  it("clamps to 100 for maximum components", () => {
    const components: RiskScoreComponents = {
      starRatingComponent: 20,
      deficiencyComponent: 30,
      penaltyComponent: 20,
      sffComponent: 15,
      chargeRatioComponent: 15,
    };
    expect(computeRiskScore(components)).toBeLessThanOrEqual(100);
  });
});

describe("computeEte", () => {
  it("returns 0 when riskScore is 10 (0-20 bucket)", () => {
    expect(computeEte(1_000_000, 10)).toBe(0);
  });
  it("returns 0 when riskScore is 20 (0-20 bucket boundary)", () => {
    expect(computeEte(1_000_000, 20)).toBe(0);
  });
  it("returns 250000 when riskScore is 30 (21-40 bucket)", () => {
    expect(computeEte(1_000_000, 30)).toBe(250000);
  });
  it("returns 250000 when riskScore is 40 (21-40 bucket boundary)", () => {
    expect(computeEte(1_000_000, 40)).toBe(250000);
  });
  it("returns 500000 when riskScore is 50 (41-60 bucket)", () => {
    expect(computeEte(1_000_000, 50)).toBe(500000);
  });
  it("returns 750000 when riskScore is 70 (61-80 bucket)", () => {
    expect(computeEte(1_000_000, 70)).toBe(750000);
  });
  it("returns 1000000 when riskScore is 90 (81-100 bucket)", () => {
    expect(computeEte(1_000_000, 90)).toBe(1000000);
  });
  it("returns 1000000 when riskScore is 100 (81-100 bucket boundary)", () => {
    expect(computeEte(1_000_000, 100)).toBe(1000000);
  });
  it("returns 0 when payments is null", () => {
    expect(computeEte(null, 50)).toBe(0);
  });
  it("returns 0 when riskScore is null", () => {
    expect(computeEte(1_000_000, null)).toBe(0);
  });
  it("returns 83333.25 for (333333, 30)", () => {
    expect(computeEte(333333, 30)).toBe(83333.25);
  });
});

describe("riskScoreColor", () => {
  it("returns green for score 0", () => {
    expect(riskScoreColor(0)).toBe<RiskColor>("green");
  });
  it("returns green for score 20", () => {
    expect(riskScoreColor(20)).toBe<RiskColor>("green");
  });
  it("returns yellow for score 21", () => {
    expect(riskScoreColor(21)).toBe<RiskColor>("yellow");
  });
  it("returns yellow for score 40", () => {
    expect(riskScoreColor(40)).toBe<RiskColor>("yellow");
  });
  it("returns orange for score 41", () => {
    expect(riskScoreColor(41)).toBe<RiskColor>("orange");
  });
  it("returns orange for score 60", () => {
    expect(riskScoreColor(60)).toBe<RiskColor>("orange");
  });
  it("returns red for score 61", () => {
    expect(riskScoreColor(61)).toBe<RiskColor>("red");
  });
  it("returns red for score 80", () => {
    expect(riskScoreColor(80)).toBe<RiskColor>("red");
  });
  it("returns black for score 81", () => {
    expect(riskScoreColor(81)).toBe<RiskColor>("black");
  });
  it("returns black for score 100", () => {
    expect(riskScoreColor(100)).toBe<RiskColor>("black");
  });
  it("returns green for null score", () => {
    expect(riskScoreColor(null)).toBe<RiskColor>("green");
  });
});
