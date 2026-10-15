export const MAIN_POLICY = "default-src 'self'; connect-src 'none'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; object-src 'none'; base-uri 'none'";
export const PLANNER_POLICY = "default-src 'self'; connect-src 'none'; style-src 'self' 'unsafe-inline'; object-src 'none'; base-uri 'none'";
// Fail closed on unexpected document structure instead of silently dropping the boundary.
export function finalizeHtml(html, policy) {
  if (![MAIN_POLICY, PLANNER_POLICY].includes(policy)) throw Error("Unknown preview CSP policy");
  const heads = [...html.matchAll(/<head\b[^>]*>/gi)];
  const ends = [...html.matchAll(/<\/head\s*>/gi)];
  if (heads.length !== 1 || ends.length !== 1 || heads[0].index >= ends[0].index)
    throw Error("Preview requires exactly one complete document head");
  if (!/^<head(?:\s+[^\s"'<>/=]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s"'=<>`]+))?)*\s*>$/i.test(heads[0][0]))
    throw Error("Malformed preview head");
  const start = heads[0].index + heads[0][0].length, end = ends[0].index;
  if (/<(?:body|script)\b/i.test(html.slice(0, heads[0].index))) throw Error("Preview head must precede body and scripts");
  const meta = `<meta http-equiv="Content-Security-Policy" content="${policy}">`;
  const content = html.slice(start, end);
  const policies = content.match(/<meta\b[^>]*http-equiv=["']Content-Security-Policy["'][^>]*>/gi) || [];
  if (policies.some(p => p !== meta)) throw Error("Unexpected existing preview CSP");
  if (policies.length > 1) throw Error("Duplicate preview CSP");
  const clean = policies.length ? html.slice(0,start) + content.replace(meta, "") + html.slice(end) : html;
  const result = clean.slice(0,start) + meta + clean.slice(start);
  const policyAt = result.indexOf(meta), scriptAt = result.search(/<script\b/i);
  if (!policy.includes("connect-src 'none'") || (scriptAt >= 0 && policyAt > scriptAt))
    throw Error("Preview network boundary must precede scripts");
  return result;
}
