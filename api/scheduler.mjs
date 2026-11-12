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

// A warm instance shares initialization/pool ownership, never request identity.
export function createSchedulerDraftEndpoint({enabled=false,env,serverFactory,maxRequests=8}={}) {
  let pending=null,closed=false,active=0,closePromise;
  const reject=(res,status,error)=>{res.setHeader?.('Cache-Control','no-store');return res.status(status).json({error});};
  const acquire=()=>{
    if(!pending){
      const attempt=Promise.resolve().then(async()=>{
        const create=serverFactory || (await import('./_scheduler-draft-server.mjs')).createDraftOnlySchedulerServer;
        const server=await create({enabled:true,env});
        if(typeof server?.handler!=='function'||typeof server?.close!=='function'){
          if(typeof server?.close==='function')await server.close();
          throw new SchedulerError('storage-not-configured');
        }
        return server;
      });
      pending=attempt;
      attempt.catch(()=>{if(pending===attempt)pending=null;});
    }
    return pending;
  };
  return Object.freeze({
    async handler(req,res){
      if(enabled!==true||closed)return reject(res,503,'storage-not-configured');
      if(req.method!=='POST'){res.setHeader?.('Allow','POST');return reject(res,405,'method-not-allowed');}
      if(!Number.isInteger(maxRequests)||maxRequests<1||maxRequests>16||active>=maxRequests)return reject(res,503,'storage-unavailable');
      active++;
      try{const server=await acquire();if(closed)return reject(res,503,'storage-not-configured');return await server.handler(req,res);}
      catch{return reject(res,503,'storage-not-configured');}
      finally{active--;}
    },
    close(){
      if(closePromise)return closePromise;
      closed=true;const captured=pending;
      closePromise=(async()=>{if(captured){let server;try{server=await captured;}catch{return;}await server.close();}})();
      return closePromise;
    },
  });
}
let pilotEndpoint;
export default async function handler(req, res) {
  if(process.env.SCHEDULER_DRAFT_PILOT_ENABLED!=='1'){
    res.setHeader?.('Cache-Control','no-store');
    return res.status(503).json({error:'storage-not-configured'});
  }
  pilotEndpoint ||= createSchedulerDraftEndpoint({enabled:true,env:process.env});
  return pilotEndpoint.handler(req,res);
}
