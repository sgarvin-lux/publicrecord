import { supabaseAdmin } from "./lib/supabase-admin";
import {
  computeStarRatingComponent,
  computeDeficiencyComponent,
  computePenaltyComponent,
  computeSffComponent,
  computeChargeRatioComponent,
  computeRiskScore,
  computeEte,
} from "./lib/risk-score";

const CONCURRENT = 50;

interface ProviderData {
  id: string;
  provider_type: string | null;
  star_rating_overall: number | null;
  is_sff: boolean | null;
  is_sff_candidate: boolean | null;
  annual_medicare_payments: number | null;
  charge_to_payment_ratio: number | null;
  operator_id: string | null;
}

async function fetchProviders(): Promise<ProviderData[]> {
  const providers: ProviderData[] = [];
  let from = 0;
  const pageSize = 1000;

  while (true) {
    const { data, error } = await supabaseAdmin
      .from("providers")
      .select(
        "id, provider_type, star_rating_overall, is_sff, is_sff_candidate, annual_medicare_payments, charge_to_payment_ratio, operator_id",
      )
      .range(from, from + pageSize - 1);

    if (error) throw new Error(`Fetch providers failed: ${error.message}`);
    if (!data || data.length === 0) break;
    providers.push(...data);
    if (data.length < pageSize) break;
    from += pageSize;
  }

  return providers;
}

function computeMediansByType(providers: ProviderData[]): Map<string, number> {
  const byType = new Map<string, number[]>();
  for (const p of providers) {
    if (p.provider_type && p.charge_to_payment_ratio !== null) {
      const arr = byType.get(p.provider_type);
      if (arr) arr.push(p.charge_to_payment_ratio);
      else byType.set(p.provider_type, [p.charge_to_payment_ratio]);
    }
  }

  const medians = new Map<string, number>();
  for (const [type, values] of byType) {
    values.sort((a, b) => a - b);
    const mid = Math.floor(values.length / 2);
    const median =
      values.length % 2 === 0
        ? (values[mid - 1] + values[mid]) / 2
        : values[mid];
    medians.set(type, median);
  }
  return medians;
}

async function fetchDeficiencySeverities(
  providerIds: string[],
): Promise<Map<string, string[]>> {
  const map = new Map<string, string[]>();
  const pageSize = 1000;
  for (let i = 0; i < providerIds.length; i += 1000) {
    const chunk = providerIds.slice(i, i + 1000);
    let from = 0;
    while (true) {
      const { data, error } = await supabaseAdmin
        .from("deficiencies")
        .select("provider_id, scope_severity")
        .in("provider_id", chunk)
        .range(from, from + pageSize - 1);

      if (error)
        throw new Error(`Fetch deficiencies failed: ${error.message}`);
      if (!data || data.length === 0) break;
      for (const row of data) {
        if (!row.scope_severity) continue;
        const existing = map.get(row.provider_id);
        if (existing) {
          existing.push(row.scope_severity);
        } else {
          map.set(row.provider_id, [row.scope_severity]);
        }
      }
      if (data.length < pageSize) break;
      from += pageSize;
    }
  }
  return map;
}

async function fetchPenaltySummaries(
  providerIds: string[],
): Promise<Map<string, { totalAmount: number; count: number }>> {
  const map = new Map<string, { totalAmount: number; count: number }>();
  const pageSize = 1000;
  for (let i = 0; i < providerIds.length; i += 1000) {
    const chunk = providerIds.slice(i, i + 1000);
    let from = 0;
    while (true) {
      const { data, error } = await supabaseAdmin
        .from("penalties")
        .select("provider_id, amount")
        .in("provider_id", chunk)
        .range(from, from + pageSize - 1);

      if (error)
        throw new Error(`Fetch penalties failed: ${error.message}`);
      if (!data || data.length === 0) break;
      for (const row of data) {
        const existing = map.get(row.provider_id);
        const amount = row.amount ?? 0;
        if (existing) {
          existing.totalAmount += amount;
          existing.count += 1;
        } else {
          map.set(row.provider_id, { totalAmount: amount, count: 1 });
        }
      }
      if (data.length < pageSize) break;
      from += pageSize;
    }
  }
  return map;
}

async function updateProviderScores(
  updates: Array<{ id: string; risk_score: number; ete: number }>,
): Promise<number> {
  let total = 0;
  for (let i = 0; i < updates.length; i += CONCURRENT) {
    const batch = updates.slice(i, i + CONCURRENT);
    await Promise.all(
      batch.map(async (u) => {
        const { error } = await supabaseAdmin
          .from("providers")
          .update({ risk_score: u.risk_score, ete: u.ete })
          .eq("id", u.id);
        if (error)
          throw new Error(`Provider score update failed: ${error.message}`);
      }),
    );
    total += batch.length;
  }
  return total;
}

interface OperatorAggregate {
  operator_id: string;
  facility_count: number;
  avg_risk_score: number | null;
  total_ete: number;
  total_medicare_payments: number;
}

async function computeOperatorAggregates(): Promise<OperatorAggregate[]> {
  const providers: Array<{
    operator_id: string;
    risk_score: number | null;
    ete: number | null;
    annual_medicare_payments: number | null;
  }> = [];

  let from = 0;
  const pageSize = 1000;
  while (true) {
    const { data, error } = await supabaseAdmin
      .from("providers")
      .select("operator_id, risk_score, ete, annual_medicare_payments")
      .not("operator_id", "is", null)
      .range(from, from + pageSize - 1);

    if (error)
      throw new Error(`Fetch provider aggregates failed: ${error.message}`);
    if (!data || data.length === 0) break;
    providers.push(...(data as typeof providers));
    if (data.length < pageSize) break;
    from += pageSize;
  }

  const byOperator = new Map<string, typeof providers>();
  for (const p of providers) {
    const arr = byOperator.get(p.operator_id);
    if (arr) arr.push(p);
    else byOperator.set(p.operator_id, [p]);
  }

  const aggregates: OperatorAggregate[] = [];
  for (const [operatorId, ops] of byOperator) {
    const scored = ops.filter((p) => p.risk_score !== null);
    aggregates.push({
      operator_id: operatorId,
      facility_count: ops.length,
      avg_risk_score:
        scored.length > 0
          ? Math.round(
              (scored.reduce((s, p) => s + (p.risk_score ?? 0), 0) /
                scored.length) *
                100,
            ) / 100
          : null,
      total_ete: ops.reduce((s, p) => s + (p.ete ?? 0), 0),
      total_medicare_payments: ops.reduce(
        (s, p) => s + (p.annual_medicare_payments ?? 0),
        0,
      ),
    });
  }
  return aggregates;
}

async function updateOperatorAggregates(): Promise<number> {
  const aggregates = await computeOperatorAggregates();
  let updated = 0;
  for (let i = 0; i < aggregates.length; i += CONCURRENT) {
    const batch = aggregates.slice(i, i + CONCURRENT);
    await Promise.all(
      batch.map(async (agg) => {
        const { error } = await supabaseAdmin
          .from("operators")
          .update({
            facility_count: agg.facility_count,
            avg_risk_score: agg.avg_risk_score,
            total_ete: agg.total_ete,
            total_medicare_payments: agg.total_medicare_payments,
          })
          .eq("id", agg.operator_id);
        if (error) throw new Error(`Operator update failed: ${error.message}`);
        updated++;
      }),
    );
  }
  return updated;
}

export async function main() {
  console.log("Computing risk scores and ETE...\n");

  const providers = await fetchProviders();
  console.log(`Fetched ${providers.length} providers`);

  const providerIds = providers.map((p) => p.id);

  const [deficiencyMap, penaltyMap] = await Promise.all([
    fetchDeficiencySeverities(providerIds),
    fetchPenaltySummaries(providerIds),
  ]);
  const chargeMedians = computeMediansByType(providers);
  console.log(
    `Fetched deficiencies for ${deficiencyMap.size} providers, penalties for ${penaltyMap.size} providers`,
  );
  console.log(
    `Charge-to-payment medians: ${[...chargeMedians.entries()].map(([t, m]) => `${t}=${m.toFixed(2)}`).join(", ")}`,
  );

  const updates: Array<{ id: string; risk_score: number; ete: number }> = [];
  for (const provider of providers) {
    // HHA and hospice providers don't have meaningful overall star ratings;
    // force null so the star weight is redistributed per spec.
    const hasStarRating = provider.provider_type === "nursing_home";
    const starComponent = computeStarRatingComponent(
      hasStarRating ? provider.star_rating_overall : null,
    );
    const deficiencyComponent = computeDeficiencyComponent(
      deficiencyMap.get(provider.id) ?? [],
    );
    const penaltySummary = penaltyMap.get(provider.id) ?? {
      totalAmount: 0,
      count: 0,
    };
    const penaltyComponent = computePenaltyComponent(
      Math.max(0, penaltySummary.totalAmount),
      penaltySummary.count,
    );
    const sffComponent = computeSffComponent(
      provider.is_sff ?? false,
      provider.is_sff_candidate ?? false,
    );

    let relativeChargeRatio: number | null = null;
    if (provider.charge_to_payment_ratio !== null && provider.provider_type) {
      const median = chargeMedians.get(provider.provider_type);
      if (median && median > 0) {
        relativeChargeRatio = provider.charge_to_payment_ratio / median;
      }
    }
    const chargeRatioComponent =
      computeChargeRatioComponent(relativeChargeRatio);

    const riskScore = computeRiskScore({
      starRatingComponent: starComponent,
      deficiencyComponent,
      penaltyComponent,
      sffComponent,
      chargeRatioComponent,
    });

    const ete = computeEte(provider.annual_medicare_payments, riskScore);

    updates.push({ id: provider.id, risk_score: riskScore, ete });
  }

  const updatedProviders = await updateProviderScores(updates);
  console.log(`Updated ${updatedProviders} provider risk scores`);

  const updatedOperators = await updateOperatorAggregates();
  console.log(`Updated ${updatedOperators} operator aggregates`);

  const scored = updates.filter((u) => u.risk_score > 0).length;
  const withEte = updates.filter((u) => u.ete > 0).length;
  console.log("\n--- Risk Score Summary ---");
  console.log(`Total providers scored: ${updates.length}`);
  console.log(`Providers with risk > 0: ${scored}`);
  console.log(`Providers with ETE > 0: ${withEte}`);
  const avg =
    updates.length > 0
      ? (
          updates.reduce((s, u) => s + u.risk_score, 0) / updates.length
        ).toFixed(1)
      : "N/A";
  console.log(`Average risk score: ${avg}`);
  console.log(
    `Total ETE: $${updates.reduce((s, u) => s + u.ete, 0).toLocaleString()}`,
  );
}

const isDirectRun =
  import.meta.url === new URL(process.argv[1], "file://").href;
if (isDirectRun) {
  main().catch((error) => {
    console.error("Risk score computation failed:", error);
    process.exit(1);
  });
}
