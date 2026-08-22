/**
 * Where the server's Supabase credentials come from.
 * -------------------------------------------------------------------------
 * There are two names for each of these and only one of them is required to
 * exist. The browser's copies are VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY,
 * because that prefix is what Vite inlines into the bundle at build time — but
 * nothing needs the prefix at RUNTIME, and a serverless function reads whatever
 * the project has set, prefixed or not.
 *
 * So a deployment very easily has the VITE_ pair and not the bare pair, and then
 * createClient(undefined, undefined) throws "supabaseUrl is required" before a
 * single line of a handler runs. That is a bare 500 with no JSON in it, which is
 * the least diagnosable failure this codebase can produce: a manager sees a
 * number, and so does everybody who reads the logs afterwards.
 *
 * It went unnoticed for as long as it did because the only endpoints the browser
 * calls are the three account ones. /api/ingest is an outside feed with its own
 * secret and nothing in the app has ever called it.
 *
 * The service-role key is the exception and has no fallback on purpose: it must
 * never carry a VITE_ prefix, because that would compile a key that bypasses
 * every row-level policy straight into a file anybody can download.
 */

export function supabaseUrl() {
  return process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || "";
}
export function anonKey() {
  return process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY || "";
}
export function serviceKey() {
  return process.env.SUPABASE_SERVICE_ROLE_KEY || "";
}

/** What is missing, in words that name the variable to go and set. Null when
    everything asked for is present. */
export function envGap({ anon = false } = {}) {
  if (!supabaseUrl()) return "SUPABASE_URL is not set on the server (VITE_SUPABASE_URL works too)";
  if (!serviceKey()) {
    return "SUPABASE_SERVICE_ROLE_KEY is not set on the server. "
      + "It is in Supabase under Project Settings, API, service_role. "
      + "Do not give it a VITE_ prefix: that would publish it to every browser.";
  }
  if (anon && !anonKey()) return "SUPABASE_ANON_KEY is not set on the server (VITE_SUPABASE_ANON_KEY works too)";
  return null;
}
