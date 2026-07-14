const TRACKING_PARAMS = ["utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content", "gclid", "fbclid"];

/** Canonicalizes a URL for deduplication: strips the fragment and
 * tracking parameters, lowercases the hostname, and removes a trailing
 * slash when safe. Never modifies meaningful query parameters. */
export function canonicalizeUrl(rawUrl: string): string {
  try {
    const url = new URL(rawUrl);
    url.hash = "";
    for (const param of TRACKING_PARAMS) url.searchParams.delete(param);
    url.hostname = url.hostname.toLowerCase();
    let pathname = url.pathname;
    if (pathname.length > 1 && pathname.endsWith("/")) pathname = pathname.slice(0, -1);
    url.pathname = pathname;
    return url.toString();
  } catch {
    return rawUrl;
  }
}

export function extractDomain(rawUrl: string): string {
  try {
    return new URL(rawUrl).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return "";
  }
}
