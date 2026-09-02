/**
 * Which person on the floor an account belongs to.
 * -------------------------------------------------------------------------
 * There are two different ids for a salesperson in this system and they are not
 * interchangeable:
 *
 *   auth.users.id     the account they sign in with — a uuid
 *   roster person id  the id the LINE uses, published from the store's roster
 *
 * The queue writes the roster id into every line entry, so anything that wants
 * to reach the person standing at position 3 has to speak roster ids. An account
 * is how we know it is really them; the roster id is who they are on the floor.
 * Joining the two is a decision a manager makes once, and it is recorded rather
 * than guessed — matching on name would put a customer in the wrong hands the
 * first time a store hires a second Chris.
 */

/** The person this account is, at this store. Null when nobody has linked it. */
export function personIdFor(links, userId, store) {
  if (!links || !userId || !store) return null;
  const hit = links.find((l) => l && l.user_id === userId && l.store === store);
  return hit ? hit.person_id : null;
}

/** Everything wrong with a proposed link, in words a manager can act on. */
export function checkLink({ links = [], userId, store, personId, roster = null }) {
  if (!userId) return "No account was given.";
  if (!store) return "No store was given.";
  if (!personId) return "No person was given.";

  /* Two accounts pointing at one person on the floor means two phones both
     believing they are up. Whichever answers second finds the customer gone. */
  const takenBy = links.find((l) => l.store === store && l.person_id === personId && l.user_id !== userId);
  if (takenBy) return "Somebody else's account is already linked to that person. Unlink it first.";

  /* And one account pointing at two people in the same store is the same
     problem from the other end. */
  const already = links.find((l) => l.store === store && l.user_id === userId && l.person_id !== personId);
  if (already) return "That account is already linked to a different person at this store.";

  /* A roster id that is not on the roster reaches nobody: the line will never
     contain it, so the phone would simply go quiet forever. */
  if (roster && !roster.some((r) => r && r.id === personId)) {
    return "That person is not on this store's roster.";
  }
  return null;
}

/* ---- the account door ----
   A signed-in salesperson opens the app and should land on their own corner
   without a daily code: the link IS the identity. This picks which link is home
   when an account is joined at more than one store (a floater, or somebody who
   moved rooftops and was never unlinked from the old one): the store they were
   on last, if it is still linked, otherwise the first link there is. Null means
   nobody has linked this account anywhere, and the waiting screen is right. */
export function homeLinkFor(links, remembered = null) {
  const list = (links || []).filter((l) => l && l.store && l.person_id);
  if (!list.length) return null;
  const last = remembered ? list.find((l) => l.store === remembered) : null;
  return last || list[0];
}

/* ---- claim your name ----
   At sign-up a salesperson says which store they work at and which name on its
   roster is theirs. That is a CLAIM, not a link: it rides in the account's own
   metadata, where the person can write it and nobody else can act on it, and a
   manager turns it into a link with one tap. Same rule as before about who
   decides; the claim just means the manager no longer has to guess which of
   thirty email addresses is the new hire.

   users: auth users as the admin API lists them (id, email, user_metadata).
   The claims for this store are the ones not already linked here. */
export function claimsFor(users, links, store) {
  if (!store) return [];
  const linked = new Set((links || []).filter((l) => l && l.store === store).map((l) => l.user_id));
  const out = [];
  for (const u of users || []) {
    const m = (u && u.user_metadata) || {};
    if (!u || !u.id || m.claim_store !== store) continue;
    if (linked.has(u.id)) continue;
    out.push({
      user_id: u.id,
      email: u.email || "",
      name: m.name || "",
      person_id: m.claim_person || null,
      claim_name: m.claim_name || "",
      at: m.claim_at || u.created_at || null,
    });
  }
  return out.sort((a, b) => String(a.at || "").localeCompare(String(b.at || "")));
}
