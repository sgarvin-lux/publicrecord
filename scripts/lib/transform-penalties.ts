export function parseCmsDate(dateStr: string | undefined): string | null {
  if (!dateStr) return null;
  const parts = dateStr.split("/");
  if (parts.length !== 3) return null;
  const [month, day, year] = parts;
  return `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
}

export function parseAmount(amountStr: string | undefined): number {
  if (!amountStr) return 0;
  const cleaned = amountStr.replace(/[$,]/g, "");
  const parsed = parseFloat(cleaned);
  return isNaN(parsed) ? 0 : parsed;
}

function formatUsd(amount: number): string {
  const rounded = Math.round(amount);
  const formatted = rounded.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return "$" + formatted;
}

export function composeDescription(
  raw: Record<string, string | undefined>,
): string {
  const type = raw.penalty_type ?? "";

  if (type === "Fine") {
    const amount = parseAmount(raw.fine_amount);
    return `Civil money penalty: ${formatUsd(amount)}`;
  }

  if (type === "Payment Denial") {
    const days = raw.payment_denial_length_in_days;
    const startDate = parseCmsDate(raw.payment_denial_start_date);

    if (days && startDate) {
      return `Payment denial: ${days} days starting ${startDate}`;
    }
    return "Payment denial";
  }

  return type;
}

export interface PenaltyRow {
  provider_id: string;
  penalty_date: string;
  penalty_type: string;
  amount: number;
  description: string;
}

export function transformPenaltyRecord(
  raw: Record<string, string | undefined>,
  providerMap: Map<string, string>,
): PenaltyRow | null {
  const cmsId = raw.cms_certification_number_ccn;
  const penaltyDate = parseCmsDate(raw.penalty_date);
  const penaltyType = raw.penalty_type;

  if (!cmsId || !penaltyDate || !penaltyType) return null;

  const providerId = providerMap.get(cmsId);
  if (!providerId) return null;

  const isFine = penaltyType === "Fine";
  const amount = isFine ? parseAmount(raw.fine_amount) : 0;
  const description = composeDescription(raw);

  return {
    provider_id: providerId,
    penalty_date: penaltyDate,
    penalty_type: penaltyType,
    amount,
    description,
  };
}
