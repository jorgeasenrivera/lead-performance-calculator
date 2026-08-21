/**
 * Telling somebody a number is wrong, while it is still wrong.
 * -------------------------------------------------------------------------
 * A report that sits in a panel until the next time an administrator happens to
 * open it is not much better than no report. The whole value of somebody on the
 * floor saying "that is not what I sold" is that they said it TODAY — every hour
 * a wrong figure stands is an hour of decisions taken on it.
 *
 * ---- why an outbound webhook, and not email or push ----
 * Push needs the phone app, which is not built. Email needs a sending provider
 * and an account nobody has opened. A webhook needs neither: Slack, Teams and
 * every automation service hand one out in about a minute, they all accept a
 * plain JSON POST, and the destination belongs to whoever set it up rather than
 * to us. If no URL is set the report still lands in the panel and nothing here
 * runs at all, so the feature works without it and works better with it.
 *
 * Only https, and only a URL an administrator typed into their own settings.
 */

/* Dates as somebody says them out loud. A run of ISO strings in a notification
   is a thing to decode rather than read, and this is read on a phone. */
function sayDay(iso) {
  const d = new Date(String(iso) + "T12:00:00");
  if (isNaN(d)) return String(iso || "");
  return `${d.getDate()} ${d.toLocaleDateString("en-US", { month: "short" })}`;
}

/**
 * Somebody who kept missing the standard, and what they said was stopping them.
 *
 * This rides the same rail as a wrong number for one reason: it is the only rail
 * that reaches anybody. A note that lands in a panel until somebody happens to
 * open it is the void this feature was built to avoid — the person wrote it
 * today, about this week, and it is worth something today.
 *
 * The note leads. Everything else is context for it: a manager who reads only
 * the first two lines still has the whole point, which is what somebody said.
 */
function standardText(t) {
  const who = t.from && t.from !== "Not given" ? t.from : "Somebody";
  const where = t.store ? ` at ${t.store}` : "";
  const of = t.of ? ` of their last ${t.of}` : "";
  const lines = [`${who}${where} missed the standard on ${t.missed || "several"}${of} days.`];
  if (t.body) lines.push(`They say: ${t.body}`);
  if (Array.isArray(t.days) && t.days.length) lines.push(`Days: ${t.days.map(sayDay).join(", ")}`);
  if (t.bar) lines.push(`The bar: ${t.bar}`);
  /* Nobody is asked to act on this in the app. Saying so keeps it from being
     read as a task and left open for a week. */
  lines.push("Nothing to action here. They have written it down and their day is back.");
  return lines.join("\n");
}

/** A report as a few lines somebody can read on a phone. */
export function alertText(t) {
  if (!t) return "";
  if (t.kind === "standard") return standardText(t);
  const who = t.from && t.from !== "Not given" ? t.from : "Somebody";
  const where = t.store ? ` at ${t.store}` : "";
  const lines = [`${who}${where} says a number is wrong.`];

  const what = t.figure && t.figure !== "__other" ? t.figure : "A figure on their screen";
  /* The comparison first, because it is the whole report. Everything below it is
     there to help somebody chase it; this line is what decides whether they do. */
  let cmp = what;
  if (t.shown) cmp += `: showing ${t.shown}`;
  if (t.expected) cmp += `, should be ${t.expected}`;
  lines.push(cmp);

  if (t.basis) lines.push(`They know because: ${t.basis}`);
  if (t.body) lines.push(t.body);
  if (t.context) lines.push(`Screen: ${t.context}`);
  if (t.reach) lines.push(`Reach them: ${t.reach}`);
  return lines.join("\n");
}

/* Slack and Teams both accept { text }, and so does every automation service
   worth using. Anything richer would work in one and render as nothing in the
   other, and a notification that arrives empty is worse than a plain one. */
export function alertBody(t) {
  return { text: alertText(t), ticket: {
    id: t.id, at: t.at, kind: t.kind, store: t.store, from: t.from, reach: t.reach,
    figure: t.figure, shown: t.shown, expected: t.expected, basis: t.basis,
    body: t.body, context: t.context, page: t.page,
    /* The missed-standard fields, so anything richer than a line of text has the
       week in front of it rather than just the sentence about it. */
    who: t.who, forDay: t.forDay, missed: t.missed, of: t.of, days: t.days, bar: t.bar,
  } };
}

/* What is worth interrupting somebody for. A report that a figure is wrong is
   being read by the whole store while it stands; a note about a missed standard
   was written today about this week. Everything else waits in the panel. */
export const ALERTED_KINDS = ["figures", "standard"];
export const worthSending = (t) =>
  !!t && ALERTED_KINDS.includes(t.kind) && (!t.status || t.status === "open");

/** Whether this is a destination we are willing to post to. */
export function usableHook(url) {
  if (!url || typeof url !== "string") return null;
  let u;
  try { u = new URL(url.trim()); } catch { return null; }
  /* Plain http would put the report, and whatever a salesperson typed into it,
     across the wire in clear. */
  if (u.protocol !== "https:") return null;
  /* An address inside the network the server is sitting in is not a notification
     destination; it is a way to make this endpoint knock on doors on somebody
     else's behalf. */
  const h = u.hostname.toLowerCase();
  if (h === "localhost" || h.endsWith(".localhost") || h.endsWith(".internal")) return null;
  if (/^(\d{1,3}\.){3}\d{1,3}$/.test(h)) {
    const [a, b] = h.split(".").map(Number);
    if (a === 10 || a === 127 || a === 0 || (a === 192 && b === 168) ||
        (a === 172 && b >= 16 && b <= 31) || (a === 169 && b === 254)) return null;
  }
  if (h === "[::1]" || h === "::1") return null;
  return u.toString();
}

/**
 * Best effort by design. A notification that can fail an insert would mean a
 * broken webhook URL silently swallowing the very reports it exists to carry —
 * so the report is already saved by the time this runs, and this only ever adds.
 */
export async function sendAlert(url, ticket, fetchImpl = fetch) {
  const safe = usableHook(url);
  if (!safe) return { sent: false, why: "no usable webhook set" };
  try {
    const r = await fetchImpl(safe, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(alertBody(ticket)),
    });
    return r.ok ? { sent: true } : { sent: false, why: `webhook answered ${r.status}` };
  } catch (e) {
    return { sent: false, why: String((e && e.message) || e) };
  }
}
