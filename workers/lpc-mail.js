/* =========================================================================
   LPC report forwarder — Cloudflare Email Worker
   =========================================================================
   Bound to your Email Routing rules, this catches mail sent to the
   lpc-<store>@yourdomain addresses and forwards the RAW message to the
   Vercel ingest endpoint. All parsing happens server-side; this stays tiny.

   Setup (Cloudflare dashboard):
   1. Workers & Pages → Create Worker → paste this file → Deploy.
   2. Worker → Settings → Variables:
        INGEST_URL    = https://<your-vercel-app>.vercel.app/api/ingest
        INGEST_SECRET = the same long random string set in Vercel
   3. Email → Email Routing → enable for the domain, then add a routing rule
      per store:  lpc-classicmazda@yourdomain  →  Send to Worker → this worker.
      (A catch-all rule to the worker also works; unknown addresses are
      ignored safely by the endpoint.)
   ========================================================================= */

const MAX_BYTES = 15 * 1024 * 1024;

export default {
  async email(message, env, ctx) {
    // Missing configuration used to look exactly like a quiet success: the fetch
    // failed, the catch swallowed it, and the day's report was gone.
    if (!env.INGEST_URL || !env.INGEST_SECRET) {
      console.error("lpc-mail: INGEST_URL or INGEST_SECRET is not set; nothing was forwarded", message.to);
      return;   // accept: see the note on rejecting at the foot of this file
    }

    // stream the raw MIME body into a buffer
    const reader = message.raw.getReader();
    const chunks = [];
    let size = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value); size += value.length;
      if (size > MAX_BYTES) {
        // Dropping a report on the floor is a real failure, not a note.
        console.error("lpc-mail: message over 15MB, dropped without forwarding", message.to, size);
        return;   // a resend of the same oversized message will be oversized too

      }
    }
    const raw = new Uint8Array(size);
    let off = 0;
    for (const c of chunks) { raw.set(c, off); off += c.length; }

    let r, body;
    try {
      r = await fetch(env.INGEST_URL, {
        method: "POST",
        headers: {
          "content-type": "message/rfc822",
          "x-ingest-secret": env.INGEST_SECRET,
          "x-envelope-to": message.to,     // survives even if the To: header is odd
        },
        body: raw,
      });
      body = await r.text();
    } catch (err) {
      /* Genuinely retryable: the endpoint was unreachable. This is the one case
         where rejecting earns its keep, because the very same message delivered
         ten minutes later may well succeed. */
      console.error("lpc-mail: could not reach the ingest endpoint", message.to, String(err));
      throw err;
    }

    // A 2xx from the endpoint is not on its own proof that anything was written.
    // The endpoint answers with ok:false when it parsed a report and then had
    // nowhere to put it, which is the case that used to disappear.
    let wroteNothing = false;
    try {
      const parsed = JSON.parse(body);
      wroteNothing = parsed && parsed.ok === false;
    } catch (e) { /* not JSON: fall back to the status code alone */ }

    if (!r.ok || wroteNothing) {
      console.error("lpc-mail: INGEST FAILED", message.to, r.status, body.slice(0, 2000));
      /* A 5xx is the endpoint having a bad moment, so let it be retried. Anything
         else is the endpoint having read the message and decided it cannot be
         filed: an unrecognised PDF layout, a store that matches nothing, a report
         for a store with no document yet. No number of retries changes any of
         those, and each retry costs a delivery failure against the address. */
      if (r.status >= 500) throw new Error(`ingest failed with ${r.status}`);
      return;
    }

    console.log("ingest", message.to, r.status, body.slice(0, 2000));
  },
};

/* =========================================================================
   WHY THIS WORKER ALMOST NEVER REJECTS A MESSAGE
   =========================================================================
   It used to throw on any failure, on the reasoning that a throw shows up red
   in the dashboard and a silent gap does not. That reasoning is right about
   visibility and wrong about the mechanism, and it cost three days of reports.

   Throwing inside an email handler does not simply log a failure. Cloudflare
   rejects the message at SMTP level, and the sending service is told the
   mailbox would not take it. DriveCentric sends through Mandrill, Mandrill
   retries a rejected message, the retry hits the same unparseable PDF and is
   rejected again, and repeated hard delivery failures against one address are
   exactly how an ESP decides that address is dead and suppresses it.

   Observed: one Classic Honda Daily Activity from Aug 11 was retried for three
   days, the same Mandrill message id over and over, every attempt logged as
   "Delivery failed", and eventually mail to the address stopped arriving at all,
   including a hand-sent test.

   So rejection is reserved for the only case where a retry can succeed: the
   ingest endpoint being unreachable or answering 5xx. Everything else is
   accepted and logged loudly, because the message is fine and it is our parser
   that cannot read it. The failure is still visible in Observability, the
   endpoint still records the diagnosis, and the mailbox stays healthy.

   If reports stop arriving again, check the sending side's suppression list
   before anything else. An address on it will silently swallow every send.
   ========================================================================= */
