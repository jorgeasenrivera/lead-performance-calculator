/**
 * What the SFTP server may tell Sage about a file, checked (C96).
 * -------------------------------------------------------------------------
 * PromptPath delivers its analytics exports to Sage's SFTP server, a
 * DigitalOcean machine in New York. The files stay there: Sage's database is
 * in Canada, and Jorge decided on 24 September that the reports stay in the
 * US. So all Sage keeps is that a file arrived: its name, its size, when, and
 * a SHA-256 fingerprint, which is enough to see deliveries land and to spot
 * the same file sent twice, and nothing a report says.
 *
 * Pure, so every refusal is tested without a network.
 */
import { timingSafeEqual } from "node:crypto";

export const SECRET_HEADER = "x-sage-sftp-secret";

/* A shared secret, compared in constant time so a wrong one cannot be guessed
   a character at a time from how long the refusal takes. Missing on either
   side is a refusal, never a pass: an unset variable must not open the door. */
export function secretOk(given, expected) {
  if (!given || !expected) return false;
  const a = Buffer.from(String(given)), b = Buffer.from(String(expected));
  return a.length === b.length && timingSafeEqual(a, b);
}

const SHA = /^[0-9a-f]{64}$/;
/* A name as the vendor gave it, not a path: the server sends the file's own
   name, and a slash or a control character would mean something is wrong. */
const NAME = /^[^/\\\u0000-\u001f]{1,200}$/;

export function cleanArrival(body) {
  if (!body || typeof body !== "object") return { ok: false, why: "no body" };
  const filename = String(body.filename || "");
  if (!NAME.test(filename) || filename === "." || filename === "..") return { ok: false, why: "bad filename" };
  const size = Number(body.size);
  if (!Number.isSafeInteger(size) || size < 0) return { ok: false, why: "bad size" };
  const sha256 = String(body.sha256 || "").toLowerCase();
  if (!SHA.test(sha256)) return { ok: false, why: "bad sha256" };
  const account = String(body.account || "");
  if (!/^[a-z][a-z0-9_-]{0,31}$/.test(account)) return { ok: false, why: "bad account" };
  return { ok: true, row: { filename, size_bytes: size, sha256, account } };
}
