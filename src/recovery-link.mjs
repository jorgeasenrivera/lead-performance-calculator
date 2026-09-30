/**
 * What the reset email's link says when it comes back (C97).
 * -------------------------------------------------------------------------
 * Supabase sends the person back to the site with the answer in the address's
 * fragment: `type=recovery` with tokens when the link is good,
 * `error_code=otp_expired` (or an error that says expired or invalid) when it
 * has run out or was already used. Kept out of the app file so it can be tested
 * on its own; the app reads it once, at load, before Supabase clears it.
 *
 * This reads INTENT, never proof. A fragment is text anybody can write, and
 * Supabase's client only accepts a recovery when the token in it checks out
 * (and then emits PASSWORD_RECOVERY, which is what recovery-session.mjs waits
 * for). So "recovery" here means "this looks like a real link and Supabase is
 * about to decide", and nothing is allowed to rest on it alone.
 *
 * Three shapes are not a link at all and read as expired, which is what the
 * person sees ("send yourself a new one"): an error in the address, even one
 * that also says type=recovery (the client takes the error and stops); and a
 * bare `type=recovery` with no tokens, which is what an email client leaves of
 * a link it cut short.
 */
export function readRecoveryHash(hash) {
  const h = new URLSearchParams(String(hash || "").replace(/^#/, ""));
  if (h.get("error_code") === "otp_expired") return "expired";
  if (h.get("error") && /expired|invalid/i.test(h.get("error_description") || "")) return "expired";
  if (h.get("error") || h.get("error_code")) return "expired";
  if (h.get("type") === "recovery") return h.get("access_token") && h.get("refresh_token") ? "recovery" : "expired";
  return null;
}
