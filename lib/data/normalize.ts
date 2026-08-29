const SUFFIXES = new Set([
  "ALLEY", "ALY", "AVENUE", "AVE", "BOULEVARD", "BLVD", "CIRCLE", "CIR",
  "COURT", "CT", "DRIVE", "DR", "EXPRESSWAY", "EXPY", "HIGHWAY", "HWY",
  "LANE", "LN", "PARKWAY", "PKWY", "PLACE", "PL", "PLAZA", "PLZ", "ROAD",
  "RD", "STREET", "ST", "TERRACE", "TER", "TRAIL", "TRL", "WAY",
]);

const ORDINAL_WORDS: Record<string, string> = {
  FIRST: "1ST",
  SECOND: "2ND",
  THIRD: "3RD",
  FOURTH: "4TH",
  FIFTH: "5TH",
  SIXTH: "6TH",
  SEVENTH: "7TH",
  EIGHTH: "8TH",
  NINTH: "9TH",
  TENTH: "10TH",
};

export function normalizeStreetName(value: string): string {
  let normalized = value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .replace(/^ST[.]?\s+/, "SAINT ")
    .replace(/\bMOUNT\b/g, "MT")
    .replace(/['’]/g, "")
    .replace(/[^A-Z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");

  normalized = normalized.replace(/\b0+(\d+(?:ST|ND|RD|TH))\b/g, "$1");
  const words = normalized.split(" ").filter(Boolean);
  if (words[0] && ORDINAL_WORDS[words[0]]) words[0] = ORDINAL_WORDS[words[0]];
  if (words.length > 1 && SUFFIXES.has(words.at(-1)!)) words.pop();
  return words.join(" ");
}

export function uniqueNonEmpty(values: Array<string | null | undefined>): string[] {
  return [...new Set(values.map((value) => value?.trim()).filter((value): value is string => Boolean(value)))];
}

export function normalizeStreetSet(values: string[]): string[] {
  return uniqueNonEmpty(values.map(normalizeStreetName));
}

export function splitCrossStreetLabel(value: string): string[] {
  return uniqueNonEmpty(
    value
      .replace(/\s+(?:AT|AND)\s+/gi, " & ")
      .split(/\s*(?:&|\/|@|\b(?:AT|AND)\b)\s*/i),
  );
}

export function canonicalCnn(value: unknown): string | null {
  if (typeof value !== "string" && typeof value !== "number") return null;
  const cnn = String(value).trim().replace(/\.0+$/, "");
  return /^\d+$/.test(cnn) ? cnn : null;
}

export function optionalString(value: unknown): string | null {
  if (typeof value !== "string" && typeof value !== "number") return null;
  const result = String(value).trim();
  return result ? result : null;
}

export function optionalDate(value: unknown): Date | null {
  const raw = optionalString(value);
  if (!raw) return null;
  const date = new Date(raw);
  return Number.isNaN(date.valueOf()) ? null : date;
}

export function inventoryBoolean(value: unknown): boolean | null {
  const raw = optionalString(value)?.toUpperCase();
  if (!raw || /^(?:N[./ ]*A[./ ]*|UNKNOWN|PENDING|TBD)$/.test(raw)) return null;
  if (/^(?:N|NO|NONE|FALSE|0)$/.test(raw)) return false;
  if (/^(?:Y|YES|TRUE|1|X)$/.test(raw)) return true;
  // Equipment model/type text in these inventory columns means equipment is present.
  return true;
}

export function textContains(value: unknown, pattern: RegExp): boolean | null {
  const raw = optionalString(value);
  return raw === null ? null : pattern.test(raw);
}

export function maxDate(values: Array<Date | null>): Date | null {
  const valid = values.filter((value): value is Date => value !== null);
  return valid.length ? new Date(Math.max(...valid.map((value) => value.valueOf()))) : null;
}
