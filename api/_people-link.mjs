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
