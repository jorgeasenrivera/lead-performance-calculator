import { handle } from "./scheduler.mjs";
import { ATOMIC_SCHEDULER_CAPABILITY, SchedulerError } from "./_scheduler-store.mjs";
import { createSchedulerPostgres, SCHEDULER_POSTGRES_RPC_CAPABILITY } from "./_scheduler-postgres.mjs";

const fail = (code) => { throw new SchedulerError(code); };
const actorId = (id) => typeof id === "string" && /^[A-Za-z0-9][A-Za-z0-9._:@-]{0,79}$/.test(id);
async function provider(call) {
  try { return await call(); } catch { fail("storage-unavailable"); }
}

// Reuse the repository's verified getUser/profile lookup pattern. The caller
// injects an already configured server client; this module reads no credentials.
export function createSchedulerIdentityReader(db) {
  if (typeof db?.auth?.getUser !== "function" || typeof db?.from !== "function") fail("storage-not-configured");
  return Object.freeze({
    verifyToken: async (token) => {
      const { data, error } = await db.auth.getUser(token);
      if (error) {
        if (error.status === 401 || error.status === 403) return null;
        fail("storage-unavailable");
      }
      return actorId(data?.user?.id) ? Object.freeze({ id: data.user.id }) : null;
    },
    profileOf: async (id) => {
      const { data, error } = await db.from("profiles")
        .select("id,role,stores,active,pending").eq("id", id).maybeSingle();
      if (error) fail("storage-unavailable");
      return data;
    },
  });
}

// This is a trusted server port decision, not a new grant table or inferred
// role permission. Missing explicit privileged-action grants always deny.
export async function resolveSchedulerAuthority({ actor, request, profile, grantFor, storeScope = "profile" } = {}) {
  if (!actorId(actor?.id)) fail("unauthenticated");
  if (!request || !/^[a-z0-9][a-z0-9_-]{0,63}$/.test(request.storeId) ||
      typeof request.storeId !== "string" || typeof request.month !== "string" ||
      !/^(20[1-9][0-9]|2100)-(0[1-9]|1[0-2])$/.test(request.month) || request.month < "2014-01") fail("invalid-request");
  const readKind = request.op === "read" ? request.input?.kind : null;
  if (!["read", "save", "publish"].includes(request.op) ||
      (request.op === "read" && !["draft", "published"].includes(readKind))) fail("invalid-request");
  if (!["profile", "explicit-draft-pilot"].includes(storeScope)) fail("forbidden");
  const explicitDraft = storeScope === "explicit-draft-pilot";
  if (explicitDraft && !(request.op === "save" || (request.op === "read" && readKind === "draft"))) fail("forbidden");
  // Current profiles schema has these three roles. No admin global-store or
  // linked-floor pending-account exception is imported into scheduler policy.
  if (!profile || profile.id !== actor.id || profile.active !== true || profile.pending !== false ||
      !["admin", "manager", "overseer"].includes(profile.role) || !Array.isArray(profile.stores) ||
      !profile.stores.every(s => typeof s === "string") || (!explicitDraft && !profile.stores.includes(request.storeId))) fail("forbidden");
  const authority = Object.freeze({ actorId: actor.id, action: request.op,
    storeId: request.storeId, month: request.month, readKind });
  if (request.op !== "read" || readKind !== "published") {
    if (!["manager", "admin"].includes(profile.role) || typeof grantFor !== "function") fail("forbidden");
    if (await provider(() => grantFor(authority)) !== true) fail("forbidden");
  }
  return authority;
}

function bearer(headers) {
  const value = headers?.authorization;
  // Reject duplicate/ambiguous headers. Never accept body identity or JWT claims.
  if (typeof value !== "string" || value.length > 16384) return null;
  return /^Bearer\x20([^\s]+)$/i.exec(value)?.[1] || null;
}

// Opt-in injected handler only. scheduler.mjs's default export stays dormant.
// Recheck immediately before each RPC, including receipt replay reconfirmation.
// This narrows revocation windows but cannot make policy reads atomic with SQL.
export function createAuthorizedSchedulerHandler({ identity, grantFor, contract, c113, transport, now, storeScope = "profile" } = {}) {
  if (typeof identity?.verifyToken !== "function" || typeof identity?.profileOf !== "function" ||
      transport?.capabilities?.[SCHEDULER_POSTGRES_RPC_CAPABILITY] !== true || typeof transport.rpc !== "function") fail("storage-not-configured");
  return async (req, res) => {
    const token = bearer(req.headers);
    let persistence;
    const verify = async () => {
      if (!token) fail("unauthenticated");
      const user = await provider(() => identity.verifyToken(token));
      if (!actorId(user?.id)) fail("unauthenticated");
      return Object.freeze({ id: user.id });
    };
    return handle(req, res, {
      contract, now,
      authenticate: verify,
      persistence: {
        capabilities: { [ATOMIC_SCHEDULER_CAPABILITY]: true },
        read: (scope) => { if (!persistence) fail("storage-not-configured"); return persistence.read(scope); },
        transaction: (scope, callback) => { if (!persistence) fail("storage-not-configured"); return persistence.transaction(scope, callback); },
      },
      authorize: async ({ actor, request }) => {
        const profile = await provider(() => identity.profileOf(actor.id));
        const authority = await resolveSchedulerAuthority({ actor, request, profile, grantFor, storeScope });
        // Policy may authorize publication, but this storage capability cannot.
        if (authority.action === "publish") fail("storage-not-configured");
        const checkedTransport = {
          capabilities: { [SCHEDULER_POSTGRES_RPC_CAPABILITY]: true },
          rpc: async (name, args) => {
            const current = await verify();
            if (current.id !== actor.id) fail("forbidden");
            const currentProfile = await provider(() => identity.profileOf(current.id));
            const checked = await resolveSchedulerAuthority({ actor: current, request, profile: currentProfile, grantFor, storeScope });
            if (Object.keys(authority).some(k => checked[k] !== authority[k])) fail("forbidden");
            return transport.rpc(name, args);
          },
        };
        persistence = createSchedulerPostgres({ transport: checkedTransport, authority, c113 });
        return persistence.authorize({ actor, request });
      },
    });
  };
}
