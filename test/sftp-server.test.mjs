/* Sage's SFTP server, as the repository describes it (C96).
   The server itself was proved on a real sshd with these exact files before
   any of it reached DigitalOcean (infra/sftp/check.sh, nine checks); these
   hold the properties that proof depended on, so a later edit cannot quietly
   undo one. */
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { render, ACCOUNTS } from "../infra/sftp/render.mjs";

const read = (p) => fs.readFileSync(new URL("../" + p, import.meta.url), "utf8");
const wf = read(".github/workflows/sftp-server.yml");
const sshd = read("infra/sftp/sshd-sage.conf");
const KEY = "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIGRldiBrZXkgZm9yIHRlc3RzIG9ubHkgZG8gbm90IHVzZQ sage-check";
const args = { sageUrl: "https://www.sageonline.io", notifySecret: "x".repeat(40), checkPubkey: KEY };

test("sign-in is keys only, never root, and each account is shut in its own folder", () => {
  assert.match(sshd, /^PasswordAuthentication no$/m);
  assert.match(sshd, /^KbdInteractiveAuthentication no$/m);
  assert.match(sshd, /^PermitRootLogin no$/m);
  assert.match(sshd, /ChrootDirectory \/srv\/sftp\/%u/);
  assert.match(sshd, /ForceCommand internal-sftp/);
  assert.match(sshd, /AllowTcpForwarding no/);
  const cfg = render(args);
  const drop = cfg.write_files.find((f) => f.path.startsWith("/etc/ssh/sshd_config.d/"));
  assert.equal(drop.path, "/etc/ssh/sshd_config.d/10-sage.conf", "sorts before the image's 50-cloud-init.conf, and sshd keeps the first value");
  assert.equal(drop.content, sshd, "the server runs the file in the repository, not a copy");
});

test("the setup refuses what it should not be given", () => {
  assert.throws(() => render({ ...args, sageUrl: "http://www.sageonline.io" }), /https/);
  assert.throws(() => render({ ...args, notifySecret: "short" }), /32/);
  assert.throws(() => render({ ...args, checkPubkey: "ssh-rsa AAAA" }), /ed25519/);
  assert.throws(() => render({ ...args, accounts: ["Bad Name"] }), /account/);
});

test("the secret stays in root-only files and never in the key-sync list or the scripts", () => {
  const cfg = render(args);
  const holding = cfg.write_files.filter((f) => f.content.includes(args.notifySecret));
  assert.deepEqual(holding.map((f) => [f.path, f.permissions]), [["/etc/sage-sftp/secret-header", "0600"]]);
  assert.ok(!read("infra/sftp/sage-notify").includes("SAGE_SECRET"), "the notice reads its header from the file, not a variable on a command line");
});

test("the watcher is listening before any account can sign in", () => {
  const steps = render(args).runcmd[0][2];
  const watch = steps.indexOf("sage-watch.service"), firstUser = steps.indexOf("useradd"), restart = steps.indexOf("systemctl restart ssh");
  assert.ok(watch > 0 && watch < firstUser && firstUser < restart, "watcher, then accounts, then sshd picks up the config");
  assert.match(steps, /systemd-run --on-active=3600 --unit=sage-check-expire/, "the check account removes itself after an hour");
});

test("only the vendor accounts sync keys; the check account is never on that list", () => {
  const cfg = render(args);
  const list = cfg.write_files.find((f) => f.path === "/etc/sage-sftp/accounts").content;
  assert.equal(list, ACCOUNTS.join("\n") + "\n");
  assert.ok(!list.includes("sagecheck"), "keysync would wipe the check account's key within five minutes");
});

test("the workflow puts the server behind its firewall from the first second, and never opens port 22 to everyone", () => {
  assert.ok(wf.indexOf("doctl compute firewall create") < wf.indexOf("doctl compute droplet create"));
  assert.ok(!/ports:22,address:0\.0\.0\.0\/0/.test(wf), "port 22 is never open to the whole internet");
  assert.match(wf, /if: always\(\) && steps\.letin\.outputs\.fw/, "the runner's own rule comes out however the run ends");
  assert.match(wf, /--enable-backups/);
  assert.match(wf, /REGION: nyc3/);
  const allowed = read("infra/sftp/allowed-ips.txt").split("\n").map((l) => l.replace(/#.*/, "").trim()).filter(Boolean);
  assert.deepEqual(allowed, [], "nobody from outside until PromptPath's addresses are known");
});

test("an empty allowed list does not leave a trailing space in the firewall's rules", () => {
  // doctl reads "rule " as a rule followed by an empty one and refuses the
  // whole create (the first real run, 25 September). Nothing was made.
  assert.ok(!/address:\$\{\{ steps\.allow\.outputs\.runner \}\}\/32 \$\{\{/.test(wf), "the runner's rule and the list are never joined unconditionally");
  assert.match(wf, /\[ -z "\$allowed" \] \|\| inbound="\$inbound \$allowed"/);
});

test("the tag exists before the firewall that follows it, and a half-made run can be picked up", () => {
  // DigitalOcean refuses a firewall for a tag that does not exist yet (422,
  // the second real run). Servers make their own tags; firewalls do not.
  assert.ok(wf.indexOf("doctl compute tag create") > 0 && wf.indexOf("doctl compute tag create") < wf.indexOf("doctl compute firewall create"));
  assert.match(wf, /A \$NAME server already exists/, "only an existing server stops a create");
  assert.match(wf, /if \[ -n "\$fw" \]; then\n\s*doctl compute firewall update/, "an existing firewall is reused, not duplicated");
});
