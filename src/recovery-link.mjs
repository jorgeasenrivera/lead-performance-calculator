/**
 * What the reset email's link says when it comes back (C97).
 * -------------------------------------------------------------------------
 * Supabase sends the person back to the site with the answer in the address's
 * fragment: `type=recovery` with a session when the link is good,
 * `error_code=otp_expired` (or an error that says expired or invalid) when it
 * has run out or was already used. Kept out of the app file so it can be tested
 * on its own; the app reads it once, at load, before Supabase clears it.
 */
export function readRecoveryHash(hash) {
  const h = new URLSearchParams(String(hash || "").replace(/^#/, ""));
  if (h.get("type") === "recovery") return "recovery";
  if (h.get("error_code") === "otp_expired") return "expired";
  if (h.get("error") && /expired|invalid/i.test(h.get("error_description") || "")) return "expired";
  return null;
}
