/**
 * Who may delete which account, decided without touching anything.
 * -------------------------------------------------------------------------
 * C91, decided by Jorge on 23 September: a person can delete their own account
 * from inside the app, which Apple requires of any app with sign-up, and an
 * admin's Delete removes the login as well as the profile, which it never did.
 *
 * What goes is the account: the login (the profile goes with it, by the
 * database's own cascade), the links from the account to a name on a floor,
 * every phone's notification details for those names, and the account's error
 * reports. What stays is the store's: a name on past floor days and in the
 * numbers, which comes from the store's own reports and would come back with
 * the next one anyway. The privacy policy says the same.
 *
 * Pure, so every refusal is tested without a database.
 */

/* Typed, not tapped: Jorge chose typing DELETE over a button on a sheet. The
   phone sends what was typed, and the server is the one that checks it, so a
   page that skipped the box still cannot delete anybody. */
export const CONFIRM_WORD = "DELETE";

/**
 * @param {object} a
 * @param {string} a.callerId        from the session, never the body
 * @param {object|null} a.caller     the caller's profile { role, active }
 * @param {string|undefined} a.targetId   the body's user_id; missing means "me"
 * @param {object|null} a.target     the target's profile, if it has one
 * @param {string} a.confirm         what was typed
 * @param {number} a.otherAdmins     active admins other than the target
 * @returns {{ ok: true, targetId: string, self: boolean } | { ok: false, code: number, error: string }}
 */
export function decideDelete({ callerId, caller, targetId, target, confirm, otherAdmins }) {
  if (String(confirm || "").trim() !== CONFIRM_WORD) {
    return { ok: false, code: 400, error: `Type ${CONFIRM_WORD} to confirm.` };
  }
  const id = targetId || callerId;
  const self = id === callerId;

  /* Somebody else's account is an admin's to delete and nobody else's, the
     same as the admin list it replaces. An inactive admin is not an admin. */
  if (!self && !(caller && caller.role === "admin" && caller.active !== false)) {
    return { ok: false, code: 403, error: "Only an admin can delete somebody else's account." };
  }

  /* The rule the admin list already has for taking admin rights away: the
     last admin leaves nobody who can manage accounts, and there is no way back
     in that does not involve the database by hand. */
  if (target && target.role === "admin" && otherAdmins < 1) {
    return { ok: false, code: 409, error: self
      ? "You are the last admin. Make somebody else an admin first."
      : "That is the last admin. Make somebody else an admin first." };
  }

  return { ok: true, targetId: id, self };
}
