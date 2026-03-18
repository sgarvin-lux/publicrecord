export type CmsRecord = Record<string, string | undefined>;

export interface OwnershipRow {
  cms_id: string;         // intermediate — used for provider_id lookup, not persisted
  owner_name: string;
  owner_type: string | null;
  ownership_pct: number | null;
  effective_date: string | null; // ISO date string or null
}

// Longer forms must come before shorter to avoid partial matches (e.g., "incorporated" before "inc")
const SUFFIX_RE =
  /[\s,]+(l\.l\.c\.?|l\.l\.p\.?|l\.p\.?|incorporated|corporation|limited|llc|llp|corp|ltd|lp|inc|co)\.?\s*$/i;

/**
 * Normalizes an owner entity name for matching:
 * 1. Lowercase
 * 2. Strip legal entity suffixes (whole word at end), repeated until stable
 * 3. Strip punctuation (commas, periods, apostrophes)
 * 4. Collapse whitespace
 */
export function normalizeEntityName(name: string): string {
  if (!name.trim()) return "";

  let s = name.toLowerCase();

  // Repeat to handle stacked suffixes like "Inc., LLC"
  let prev = "";
  while (s !== prev) {
    prev = s;
    s = s.replace(SUFFIX_RE, "");
  }

  // Strip remaining punctuation
  s = s.replace(/[,.']/g, " ");

  return s.replace(/\s+/g, " ").trim();
}

const CCN_FIELD = "cms_certification_number_ccn";
const OWNER_NAME_FIELD = "owner_name";
const OWNER_TYPE_FIELD = "owner_type";
const OWNERSHIP_PCT_FIELD = "ownership_percentage";
const ASSOCIATION_DATE_FIELD = "association_date";

function trimOrNull(value: string | undefined): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  return trimmed || null;
}

function parsePct(value: string | undefined): number | null {
  if (!value) return null;
  const parsed = parseFloat(value);
  return isNaN(parsed) ? null : parsed;
}

// CMS association_date format: "since MM/DD/YYYY" → ISO: YYYY-MM-DD
// Uses a non-anchored match to find the date anywhere in the string.
function parseDate(value: string | undefined): string | null {
  if (!value) return null;
  const match = value.match(/(\d{2})\/(\d{2})\/(\d{4})/);
  if (!match) return null;
  return `${match[3]}-${match[1]}-${match[2]}`;
}

export function transformOwnership(raw: CmsRecord): OwnershipRow | null {
  const cmsId = trimOrNull(raw[CCN_FIELD]);
  const ownerName = trimOrNull(raw[OWNER_NAME_FIELD]);
  if (!cmsId || !ownerName) return null;

  return {
    cms_id: cmsId,
    owner_name: ownerName,
    owner_type: trimOrNull(raw[OWNER_TYPE_FIELD]),
    ownership_pct: parsePct(raw[OWNERSHIP_PCT_FIELD]),
    effective_date: parseDate(raw[ASSOCIATION_DATE_FIELD]),
  };
}
