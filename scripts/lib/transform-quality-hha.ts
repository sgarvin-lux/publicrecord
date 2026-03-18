import {
  type CmsRecord,
  type QualityMeasureRow,
  parseScore,
} from "./quality-measures";

/**
 * Maps provider-level column names in dataset 6jpm-sxkc to stable measure
 * codes, human-readable names, and the corresponding column name in the
 * national averages dataset 97z8-de96.
 *
 * NOTE: This list is derived from the CMS API as of March 2026. If CMS adds
 * or renames columns, update this list. Verify by fetching a sample row:
 *   curl "https://data.cms.gov/provider-data/api/1/datastore/query/6jpm-sxkc/0?limit=1"
 */
const HHA_MEASURES = [
  {
    col: "quality_of_patient_care_star_rating",
    code: "HHA_QUALITY_STAR",
    name: "Quality of patient care star rating",
    national_col: "quality_of_patient_care_star_rating",
  },
  {
    col: "dtc_riskstandardized_rate",
    code: "HHA_DTC",
    name: "Discharged to community (risk-standardized rate)",
    national_col: "dtc_national_observed_rate",
  },
  {
    col: "pph_riskstandardized_rate",
    code: "HHA_PPH",
    name: "Potentially preventable hospitalizations (risk-standardized rate)",
    national_col: "pph_national_observed_rate",
  },
  {
    col: "covid19_vaccine_percent_of_patients_who_are_up_to_date",
    code: "HHA_COVID_VAX",
    name: "COVID-19 vaccine: patients up to date (%)",
    national_col: "covid19_vaccine_percent_of_patients_who_are_up_to_date",
  },
  {
    col: "how_much_medicare_spends_on_an_episode_of_care_at_this_agen_56e6",
    code: "HHA_SPENDING_RATIO",
    name: "Medicare spending per episode (ratio to national average)",
    national_col:
      "how_much_medicare_spends_on_an_episode_of_care_at_this_agen_56e6",
  },
] as const;

export function transformQualityHha(
  providerRows: CmsRecord[],
  nationalRow: CmsRecord | null,
  lookup: Map<string, string>,
): QualityMeasureRow[] {
  const result: QualityMeasureRow[] = [];

  for (const row of providerRows) {
    const ccn = row.cms_certification_number_ccn?.trim();
    if (!ccn) continue;
    const providerId = lookup.get(ccn);
    if (!providerId) continue;

    for (const m of HHA_MEASURES) {
      result.push({
        provider_id: providerId,
        measure_code: m.code,
        measure_name: m.name,
        score: parseScore(row[m.col]),
        national_avg: nationalRow
          ? parseScore(nationalRow[m.national_col])
          : null,
        state_avg: null,
        period: null,
        data_source: "cms-hha",
      });
    }
  }

  return result;
}
