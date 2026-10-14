import fs from "node:fs/promises";
import path from "node:path";

// Opt in only for the fictional local fixture. Never collect storage, headers,
// request bodies or response bodies, which are unnecessary to diagnose a crash.
export function watchFeelEvidence(page, { directory, fixture = false, url, log = console.error } = {}) {
  if (!directory) return null;
  const target = new URL(url);
  if (!fixture || !["127.0.0.1", "localhost", "[::1]"].includes(target.hostname)) {
    throw new Error("feel evidence requires the fictional loopback fixture");
  }
  const clean = (value) => String(value).replace(/https?:\/\/[^\s)"'<>]+/g, (raw) => {
    try { const u = new URL(raw); return u.origin + u.pathname; } catch { return "[url]"; }
  }).slice(0, 12000);
  const events = [];
  let dropped = 0;
  const record = (event) => {
    if (events.length === 100) { events.shift(); dropped++; }
    events.push({ at: new Date().toISOString(), ...event });
  };
  page.on("pageerror", (error) => record({ type: "pageerror", error: clean(error.stack || error) }));
  page.on("console", (message) => {
    if (message.type() === "error") record({ type: "console", error: clean(message.text()) });
  });
  page.on("requestfailed", (request) => record({ type: "requestfailed", url: clean(request.url()),
    method: request.method(), resource: request.resourceType(), error: clean(request.failure()?.errorText) }));
  page.on("response", (response) => {
    if (response.status() >= 400) record({ type: "http", url: clean(response.url()), status: response.status() });
  });
  return async (error) => {
    // Write the event log first: even a dead page still has its Node-side errors.
    log(`feel: failure evidence: ${events.length} events retained, ${dropped} older events dropped`);
    try {
      await fs.mkdir(directory, { recursive: true });
      const failures = [];
      const save = async (name, work) => {
        try { await work(path.join(directory, name)); }
        catch (e) { failures.push({ artifact: name, error: clean(e.message || e) }); }
      };
      await save("events.json", (file) => fs.writeFile(file, JSON.stringify({ error: clean(error.stack || error), dropped, events }, null, 2)));
      await save("failure.html", async (file) => {
        let timer;
        try {
          const html = await Promise.race([page.content(), new Promise((_, reject) => {
            timer = setTimeout(() => reject(new Error("DOM capture exceeded 5 s")), 5000);
          })]);
          await fs.writeFile(file, html);
        } finally { clearTimeout(timer); }
      });
      await save("failure.png", (file) => page.screenshot({ path: file, timeout: 5000 }));
      await fs.writeFile(path.join(directory, "capture.json"), JSON.stringify({ failures }, null, 2));
      if (failures.length) log("feel: incomplete evidence: " + JSON.stringify(failures));
    } catch (e) { log("feel: could not save evidence: " + clean(e.message || e)); }
  };
}
