/**
 * A reset link may choose a new password only for the account it was sent to
 * (C97). Independent review of the first version found the hole: the reset form
 * opened from the address alone, and saving called updateUser on whoever was
 * signed in. A bare or broken recovery link opened on a phone where somebody
 * else was already signed in would have changed THEIR password. Supabase's
 * client leaves an existing session alone when a callback fails to validate
 * (auth-js 2.112.3, `_initialize`: "Don't remove existing session on URL login
 * failure"), so nothing else would have stopped it.
 *
 * So the address only starts a wait. The form opens on proof: Supabase's
 * PASSWORD_RECOVERY event, which it sends only after it has checked the token,
 * carrying the session it made. That session's user is who the password is
 * for, and saving is allowed only while the signed-in user is still that one,
 * checked again immediately before the write.
 *
 *   idle     no link, nothing to do
 *   pending  the address looks like a link; Supabase has not said yes
 *   ready    Supabase said yes, for `userId`, with `accessToken`
 *   failed   the link is expired, broken, never confirmed, or the account it
 *            was for has gone (signed out, or somebody else signed in); left
 *            only by dismiss() (the person pressed Back) or a fresh good link
 *
 * The write is bound by TOKEN, not by a look at who is signed in. A second
 * review (30 September) reproduced what a look cannot close: auth-js's
 * updateUser re-reads whichever session is stored at that instant, so a sign-in
 * landing between the look and the write is authorized as the wrong account.
 * setPasswordAs sends the same PUT the SDK would, with the token Supabase
 * issued for the recovery, so it cannot be authorized as anyone else however
 * the storage moves underneath it.
 *
 * Kept apart from the app file so the whole lifecycle can be run in node.
 */
export const LINK_FAILED_NOTICE = "That link has run out or was already used. Send yourself a new one.";
export const PENDING_LIMIT_MS = 10000;

export function createRecoveryGuard(intent, { limitMs = PENDING_LIMIT_MS, setTimer = setTimeout, clearTimer = clearTimeout } = {}) {
  let st = intent === "recovery" ? { status: "pending", userId: null }
    : intent === "expired" ? { status: "failed", userId: null }
    : { status: "idle", userId: null };
  /* The token is kept out of the state the screens subscribe to: nothing that
     draws needs it, and it is a credential. */
  let token = null;
  const subs = new Set();
  let timer = null;
  const set = (next) => {
    if (next.status === st.status && next.userId === st.userId) return;
    if (next.status !== "pending" && timer != null) { clearTimer(timer); timer = null; }
    st = next;
    if (next.status !== "ready") token = null;
    subs.forEach((f) => { try { f(st); } catch (e) {} });
  };
  /* Supabase decides within a moment of loading; if it never does, the link was
     not one it would take, and waiting longer helps nobody. */
  if (st.status === "pending") timer = setTimer(() => { timer = null; if (st.status === "pending") set({ status: "failed", userId: null }); }, limitMs);
  const userOf = (session) => (session && session.user && session.user.id) || null;
  return {
    snapshot: () => st,
    subscribe(fn) { subs.add(fn); return () => subs.delete(fn); },
    /* Every auth event, in order. */
    onAuthEvent(event, session) {
      const uid = userOf(session);
      if (event === "PASSWORD_RECOVERY" && uid && session.access_token) { token = session.access_token; set({ status: "ready", userId: uid }); return; }
      if (st.status === "ready") {
        if (event === "SIGNED_OUT") set({ status: "failed", userId: null });
        else if (uid && uid !== st.userId) set({ status: "failed", userId: null });   // somebody else is in
      } else if (st.status === "pending" && event === "SIGNED_OUT") {
        set({ status: "failed", userId: null });
      }
    },
    /* Supabase has finished reading the address and has not said yes: the link
       was not one it would take (tokens that do not check out). Called a moment
       after its client reports ready, which is after PASSWORD_RECOVERY would
       have come, so the person is told at once and not after the backstop. */
    settle() { if (st.status === "pending") set({ status: "failed", userId: null }); },
    /* The last check before the write: ready, and the session now in place is
       still the one the link was for. */
    canSave(currentUserId) { return st.status === "ready" && !!currentUserId && currentUserId === st.userId; },
    /* What the write is bound to: the user Supabase confirmed and the token it
       issued for that recovery. Null unless the link is confirmed right now. */
    binding() { return st.status === "ready" && token ? { userId: st.userId, accessToken: token } : null; },
    /* The person left a failed link (Back). Only a failed one is dismissed: a
       ready form has no Back, and a pending one is still being decided. */
    dismiss() { if (st.status === "failed") set({ status: "idle", userId: null }); },
    /* The binding was found broken at the moment of saving. */
    invalidate() { if (st.status === "ready" || st.status === "pending") set({ status: "failed", userId: null }); },
    /* The new password is saved. */
    done() { set({ status: "idle", userId: null }); },
  };
}

/* The one write. PUT /auth/v1/user with the recovery session's own token, the
   request auth-js's updateUser makes, minus the step that re-reads the stored
   session. A token Supabase no longer accepts (an hour on, or a session ended
   elsewhere) comes back 401 or 403 and is `lost`: the link is gone, say so. */
export async function setPasswordAs({ url, apikey, accessToken, password }, fetchImpl = globalThis.fetch) {
  if (!accessToken) return { error: LINK_FAILED_NOTICE, lost: true };
  let res;
  try {
    res = await fetchImpl(String(url).replace(/\/$/, "") + "/auth/v1/user", {
      method: "PUT",
      headers: { apikey, Authorization: "Bearer " + accessToken, "Content-Type": "application/json;charset=UTF-8" },
      body: JSON.stringify({ password }),
    });
  } catch (e) { return { error: "Couldn't reach sign-in. Check your connection and try again." }; }
  if (res.ok) return { error: null };
  if (res.status === 401 || res.status === 403) return { error: LINK_FAILED_NOTICE, lost: true };
  let said = "";
  try { const j = await res.json(); said = j.msg || j.message || j.error_description || j.error || ""; } catch (e) {}
  return { error: said || "That password could not be saved. Try another." };
}
