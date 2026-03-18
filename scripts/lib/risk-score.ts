export type RiskColor = "green" | "yellow" | "orange" | "red" | "black";

export interface RiskScoreComponents {
  starRatingComponent: number | null;
  deficiencyComponent: number;
  penaltyComponent: number;
  sffComponent: number;
  chargeRatioComponent: number;
}

export const WEIGHTS = {
  star: 0.2,
  deficiency: 0.3,
  penalty: 0.2,
  sff: 0.15,
  chargeRatio: 0.15,
} as const;

const DEFICIENCY_WEIGHTS: Record<string, number> = {
  A: 1,
  B: 1,
  C: 1,
  D: 5,
  E: 5,
  F: 5,
  G: 15,
  H: 15,
  I: 15,
  J: 25,
  K: 25,
  L: 25,
};

export function computeStarRatingComponent(
  starRatingOverall: number | null,
): number | null {
  if (starRatingOverall === null) return null;
  return (5 - starRatingOverall) * 5;
}

export function computeDeficiencyComponent(
  severityCodes: (string | null)[],
): number {
  const rawSum = severityCodes.reduce<number>((sum, code) => {
    if (code === null || code === "") return sum;
    const weight = DEFICIENCY_WEIGHTS[code.toUpperCase()] ?? 0;
    return sum + weight;
  }, 0);
  return Math.round(Math.min((rawSum / 100) * 30, 30));
}

export function computePenaltyComponent(
  totalPenaltyAmount: number,
  penaltyCount: number,
): number {
  const amountPart = Math.min(totalPenaltyAmount / 100_000, 10);
  const countPart = Math.min(penaltyCount * 2, 10);
  return Math.round(Math.min(amountPart + countPart, 20));
}

export function computeSffComponent(
  isSff: boolean,
  isSffCandidate: boolean,
): number {
  if (isSff) return 15;
  if (isSffCandidate) return 8;
  return 0;
}

export function computeChargeRatioComponent(
  relativeChargeRatio: number | null,
): number {
  if (relativeChargeRatio === null) return 0;
  if (relativeChargeRatio <= 1.5) return 0;
  if (relativeChargeRatio <= 2.0) return 5;
  if (relativeChargeRatio <= 3.0) return 10;
  return 15;
}

export function computeRiskScore(components: RiskScoreComponents): number {
  const {
    starRatingComponent,
    deficiencyComponent,
    penaltyComponent,
    sffComponent,
    chargeRatioComponent,
  } = components;

  let score: number;
  if (starRatingComponent === null) {
    // Redistribute star weight (0.20) proportionally to remaining components
    const scale = 1 / (1 - WEIGHTS.star); // 1/0.80 = 1.25
    score =
      deficiencyComponent * WEIGHTS.deficiency * scale +
      penaltyComponent * WEIGHTS.penalty * scale +
      sffComponent * WEIGHTS.sff * scale +
      chargeRatioComponent * WEIGHTS.chargeRatio * scale;
  } else {
    score =
      starRatingComponent * WEIGHTS.star +
      deficiencyComponent * WEIGHTS.deficiency +
      penaltyComponent * WEIGHTS.penalty +
      sffComponent * WEIGHTS.sff +
      chargeRatioComponent * WEIGHTS.chargeRatio;
  }

  return Math.round(Math.min(Math.max(score, 0), 100));
}

function riskMultiplier(riskScore: number): number {
  if (riskScore <= 20) return 0.0;
  if (riskScore <= 40) return 0.25;
  if (riskScore <= 60) return 0.5;
  if (riskScore <= 80) return 0.75;
  return 1.0;
}

export function computeEte(
  annualMedicarePayments: number | null,
  riskScore: number | null,
): number {
  if (annualMedicarePayments === null || riskScore === null) return 0;
  const result = annualMedicarePayments * riskMultiplier(riskScore);
  return Math.round(result * 100) / 100;
}

export function riskScoreColor(riskScore: number | null): RiskColor {
  if (riskScore === null) return "green";
  if (riskScore <= 20) return "green";
  if (riskScore <= 40) return "yellow";
  if (riskScore <= 60) return "orange";
  if (riskScore <= 80) return "red";
  return "black";
}
