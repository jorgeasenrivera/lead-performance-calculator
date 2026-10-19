import { createSchedulerBoundary, SchedulerError, SCHEDULER_TRANSPORT_LIMITS } from "./_scheduler-store.mjs";

/* No live adapter is installed. Tests inject every authority and storage port;
   importing this endpoint never reads credentials or initializes a service. */
export async function handle(req, res, deps = {}) {
  res.setHeader?.("Cache-Control", "no-store");
  if (req.method !== "POST") {
    res.setHeader?.("Allow", "POST");
    return res.status(405).json({ error: "method-not-allowed" });
  }
  if (typeof deps.authenticate !== "function") return res.status(503).json({ error: "storage-not-configured" });
  try {
    // Authentication gets headers, not body fields pretending to be identity.
    const actor = await deps.authenticate({ headers: req.headers || {} });
    if (!actor) return res.status(401).json({ error: "unauthenticated" });
    if (typeof req.body === "string" && (req.body.length > SCHEDULER_TRANSPORT_LIMITS.bytes ||
        Buffer.byteLength(req.body, "utf8") > SCHEDULER_TRANSPORT_LIMITS.bytes)) {
      return res.status(413).json({ error: "request-too-large" });
    }
    let request;
    try { request = typeof req.body === "string" ? JSON.parse(req.body) : req.body; }
    catch { return res.status(400).json({ error: "invalid-request" }); }
    const boundary = createSchedulerBoundary(deps);
    return res.status(200).json(await boundary.execute(request, actor));
  } catch (error) {
    if (error instanceof SchedulerError) return res.status(error.status).json({ error: error.code });
    return res.status(503).json({ error: "storage-unavailable" });
  }
}

export default async function handler(_req, res) {
  res.setHeader?.("Cache-Control", "no-store");
  return res.status(503).json({ error: "storage-not-configured" });
}
