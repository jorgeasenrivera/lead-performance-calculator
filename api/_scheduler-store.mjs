import { createHash } from "node:crypto";

/* Source-only boundary. C113 owns schedule validation and planning; an adapter
   supplies those functions only after its exact artifacts have been reviewed.
   A transaction promise must resolve after the plan AND receipt commit. */
export const ATOMIC_SCHEDULER_CAPABILITY = "scheduler-plan-and-receipt-v1";
export const SCHEDULER_TRANSPORT_LIMITS = Object.freeze({ bytes: 1_048_576, depth: 64, nodes: 50_000 });

const statuses = Object.freeze({
  "invalid-request": 400,
  unauthenticated: 401,
  forbidden: 403,
  conflict: 409,
  "idempotency-conflict": 409,
  "request-too-large": 413,
  "contract-rejected": 422,
  "storage-not-configured": 503,
  "contract-not-configured": 503,
  "storage-unavailable": 503,
});

export function SchedulerError(code) {
  const safe = Object.hasOwn(statuses, code) ? code : "storage-unavailable";
  const error = new Error(safe);
  Object.setPrototypeOf(error, SchedulerError.prototype);
  error.name = "SchedulerError";
  error.code = safe;
  error.status = statuses[safe];
  return error;
}
Object.setPrototypeOf(SchedulerError.prototype, Error.prototype);

const fail = (code) => { throw new SchedulerError(code); };
const record = (value) => value !== null && typeof value === "object" &&
  !Array.isArray(value) && [Object.prototype, null].includes(Object.getPrototypeOf(value));

/* Sort object keys, never array entries. This is a request identity, not a
   replacement for C113 serialization, review fingerprints, or audit hashes. */
function canonicalJson(value, budget = { seen: new Set(), nodes: 0, bytes: 0 }, depth = 0) {
  if (++budget.nodes > SCHEDULER_TRANSPORT_LIMITS.nodes || depth > SCHEDULER_TRANSPORT_LIMITS.depth) fail("request-too-large");
  const charge = (text) => {
    budget.bytes += Buffer.byteLength(text, "utf8");
    if (budget.bytes > SCHEDULER_TRANSPORT_LIMITS.bytes) fail("request-too-large");
    return text;
  };
  const string = (text) => {
    if (text.length > SCHEDULER_TRANSPORT_LIMITS.bytes || Buffer.byteLength(text, "utf8") > SCHEDULER_TRANSPORT_LIMITS.bytes) fail("request-too-large");
    return charge(JSON.stringify(text));
  };
  if (typeof value === "string") return string(value);
  if (value === null || typeof value === "boolean") return charge(JSON.stringify(value));
  if (typeof value === "number" && Number.isFinite(value)) return charge(JSON.stringify(value));
  if (!Array.isArray(value) && !record(value)) fail("invalid-request");
  if (budget.seen.has(value)) fail("invalid-request");
  budget.seen.add(value);
  let encoded;
  if (Array.isArray(value)) {
    if (value.length + budget.nodes > SCHEDULER_TRANSPORT_LIMITS.nodes) fail("request-too-large");
    charge("[]" + ",".repeat(Math.max(0, value.length - 1)));
    const items = [];
    for (let i = 0; i < value.length; i++) {
      const descriptor = Object.getOwnPropertyDescriptor(value, i);
      if (!descriptor || !Object.hasOwn(descriptor, "value")) fail("invalid-request");
      items.push(canonicalJson(descriptor.value, budget, depth + 1));
    }
    encoded = `[${items.join(",")}]`;
  } else {
    const keys = [];
    for (const key in value) {
      if (!Object.hasOwn(value, key)) continue;
      if (keys.length + 1 + budget.nodes > SCHEDULER_TRANSPORT_LIMITS.nodes) fail("request-too-large");
      keys.push(key);
    }
    charge("{}" + ":".repeat(keys.length) + ",".repeat(Math.max(0, keys.length - 1)));
    encoded = `{${keys.sort().map((key) => {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!descriptor || !Object.hasOwn(descriptor, "value")) fail("invalid-request");
      return `${string(key)}:${canonicalJson(descriptor.value, budget, depth + 1)}`;
    }).join(",")}}`;
  }
  budget.seen.delete(value);
  return encoded;
}

function copyJson(value, failure = "storage-unavailable") {
  try { return JSON.parse(canonicalJson(value)); }
  catch (error) {
    if (failure === "invalid-request" && error instanceof SchedulerError && error.code === "request-too-large") throw error;
    fail(failure);
  }
}

function requestCopy(value) {
  const keys = ["op", "storeId", "month", "input", "requestId"];
  if (!record(value)) fail("invalid-request");
  for (const key in value) if (Object.hasOwn(value, key) && !keys.includes(key)) fail("invalid-request");
  const request = copyJson(value, "invalid-request");
  if (!["read", "save", "publish"].includes(request.op) ||
      typeof request.storeId !== "string" || typeof request.month !== "string" ||
      !record(request.input)) fail("invalid-request");
  if (request.op === "read") {
    if (Object.hasOwn(request, "requestId")) fail("invalid-request");
  } else if (typeof request.requestId !== "string" || !request.requestId.trim()) fail("invalid-request");
  return request;
}

function requirePorts({ contract, persistence, authorize, now }) {
  if (!contract || ["validateRequest", "plan", "projectRead", "projectResult"]
    .some((name) => typeof contract[name] !== "function")) fail("contract-not-configured");
  if (!persistence || persistence.capabilities?.[ATOMIC_SCHEDULER_CAPABILITY] !== true ||
      typeof persistence.read !== "function" || typeof persistence.transaction !== "function" ||
      typeof authorize !== "function" || typeof now !== "function") fail("storage-not-configured");
}

function requireTransaction(tx) {
  if (!tx || ["snapshot", "getReceipt", "apply", "putReceipt"]
    .some((name) => typeof tx[name] !== "function")) fail("storage-not-configured");
}

function requirePlan(plan, request) {
  if (!record(plan) || plan.atomic !== true || plan.authorization !== "not-checked" ||
      plan.storeId !== request.storeId || plan.month !== request.month ||
      !Array.isArray(plan.ops) || !record(plan.auditEntry) || !record(plan.resultingHead)) {
    fail("contract-rejected");
  }
}

export function createSchedulerBoundary({ contract, persistence, authorize, now = () => new Date().toISOString() } = {}) {
  async function execute(rawRequest, rawActor) {
      try {
        requirePorts({ contract, persistence, authorize, now });
        if (!record(rawActor) || typeof rawActor.id !== "string" || !rawActor.id.trim()) fail("unauthenticated");
        const actor = copyJson(rawActor);
        const request = requestCopy(rawRequest);
        if (await contract.validateRequest(copyJson(request)) !== true) fail("invalid-request");
        // Authorization covers this exact command and requested read projection.
        // Neither role names nor a client-supplied actor grant a capability here.
        if (await authorize({ actor: copyJson(actor), request: copyJson(request) }) !== true) fail("forbidden");
        const scope = { storeId: request.storeId, month: request.month };
        if (request.op === "read") {
          const snapshot = await persistence.read(scope);
          const result = await contract.projectRead({ request, actor, snapshot });
          return copyJson({ result });
        }

        const { requestId, ...command } = request;
        const key = JSON.stringify([actor.id, request.storeId, request.month, requestId]);
        const fingerprint = createHash("sha256").update(canonicalJson(actor.id)).update("\n").update(canonicalJson(command)).digest("hex");
        const committed = await persistence.transaction(scope, async (tx) => {
          requireTransaction(tx);
          const receipt = await tx.getReceipt(key);
          if (receipt !== null && receipt !== undefined) {
            if (!record(receipt) || receipt.key !== key || typeof receipt.fingerprint !== "string" ||
                !Object.hasOwn(receipt, "result")) fail("storage-unavailable");
            if (receipt.fingerprint !== fingerprint) fail("idempotency-conflict");
            return copyJson({ result: receipt.result, replayed: true });
          }

          const snapshot = await tx.snapshot();
          const plan = await contract.plan({ request, actor, now: now(), snapshot });
          requirePlan(plan, request);
          // Keep the C113 object unchanged. The wrapper checks capability;
          // changing its authorization marker would misrepresent its contract.
          const result = copyJson(await contract.projectResult({ request, actor, plan }));
          // Check the complete response before staging a mutation. A result at
          // the limit must not commit and then fail forever on its framing.
          const response = copyJson({ result, replayed: false });
          if (await tx.apply(plan) !== true) fail("conflict");
          if (await tx.putReceipt({ key, fingerprint, result: copyJson(result) }) !== true) fail("storage-unavailable");
          return response;
        });
        if (!record(committed) || typeof committed.replayed !== "boolean" || !Object.hasOwn(committed, "result")) {
          fail("storage-unavailable");
        }
        return copyJson({ result: committed.result, replayed: committed.replayed });
      } catch (error) {
        if (error instanceof SchedulerError) throw error;
        fail("storage-unavailable");
      }
  }
  return { execute };
}
