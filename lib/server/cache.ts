export const CACHE_CONTROL =
  "public, max-age=60, s-maxage=300, stale-while-revalidate=3600";

export const LONG_CACHE_CONTROL =
  "public, max-age=300, s-maxage=3600, stale-while-revalidate=86400";

export const PROVENANCE_HEADERS = {
  "X-Glossa-Live-Data": "false",
  Link: '</api/v1/sources>; rel="describedby"',
} as const;
