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
