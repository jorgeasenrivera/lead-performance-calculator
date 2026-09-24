#!/usr/bin/env node
/**
 * The first-boot setup for Sage's SFTP server (C96), as cloud-init reads it.
 * -------------------------------------------------------------------------
 * Built here rather than written by hand so the scripts and the sshd file in
 * this folder are the single copy: the server runs exactly what is in the
 * repository. Written as JSON, which is valid YAML, so there is no
 * indentation to get wrong.
 *
 *   SAGE_URL=https://www.sageonline.io NOTIFY_SECRET=… CHECK_PUBKEY="ssh-ed25519 …" \
 *     node infra/sftp/render.mjs > user-data
 *
 * NOTIFY_SECRET and CHECK_PUBKEY come from the workflow and are never
 * committed. The output carries the secret, so it is never printed to a log.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const read = (f) => fs.readFileSync(path.join(HERE, f), "utf8");

/* The accounts PromptPath or anybody else may be given. Keys come from
   infra/sftp/keys/<account>.pub on main; an account without that file
   exists but nobody can sign in to it. */
export const ACCOUNTS = ["promptpath"];
export const KEYS_BASE = "https://raw.githubusercontent.com/jorgeasenrivera/lead-performance-calculator/main/infra/sftp/keys";

const unit = (description, body) => `[Unit]\nDescription=${description}\n\n${body}\n`;

export function render({ sageUrl, notifySecret, checkPubkey, accounts = ACCOUNTS, keysBase = KEYS_BASE }) {
  if (!/^https:\/\/[^\s/]+$/.test(sageUrl || "")) throw new Error("SAGE_URL must be https://host with no path");
  if (!notifySecret || notifySecret.length < 32) throw new Error("NOTIFY_SECRET must be at least 32 characters");
  if (!/^ssh-ed25519 [A-Za-z0-9+/=]+( .*)?$/.test(checkPubkey || "")) throw new Error("CHECK_PUBKEY must be one ssh-ed25519 public key");
  for (const a of accounts) if (!/^[a-z][a-z0-9_-]{0,31}$/.test(a)) throw new Error("bad account " + a);

  const script = (name) => ({ path: `/usr/local/sbin/${name}`, permissions: "0755", owner: "root:root", content: read(name) });
  const all = [...accounts, "sagecheck"];

  return {
    package_update: true,
    package_upgrade: true,
    packages: ["fail2ban", "inotify-tools", "unattended-upgrades", "curl", "psmisc"],
    groups: ["sftponly"],
    write_files: [
      { path: "/etc/ssh/sshd_config.d/10-sage.conf", permissions: "0644", owner: "root:root", content: read("sshd-sage.conf") },
      { path: "/etc/sage-sftp/env", permissions: "0600", owner: "root:root", content: `SAGE_URL=${sageUrl}\nKEYS_BASE=${keysBase}\n` },
      { path: "/etc/sage-sftp/secret-header", permissions: "0600", owner: "root:root", content: `x-sage-sftp-secret: ${notifySecret}\n` },
      { path: "/etc/sage-sftp/accounts", permissions: "0644", owner: "root:root", content: accounts.join("\n") + "\n" },
      { path: "/etc/ssh/authorized_keys/sagecheck", permissions: "0644", owner: "root:root", content: checkPubkey.trim() + "\n" },
      script("sage-notify"), script("sage-watch"), script("sage-keysync"), script("sage-prune"), script("sage-check-expire"),
      { path: "/etc/systemd/system/sage-watch.service", content: unit("Tell Sage when an SFTP upload finishes", "[Service]\nExecStart=/usr/local/sbin/sage-watch\nRestart=always\nRestartSec=5\n\n[Install]\nWantedBy=multi-user.target") },
      { path: "/etc/systemd/system/sage-notify.service", content: unit("Catch up on SFTP notices to Sage", "[Service]\nType=oneshot\nExecStart=/usr/local/sbin/sage-notify") },
      { path: "/etc/systemd/system/sage-notify.timer", content: unit("Every ten minutes", "[Timer]\nOnBootSec=2min\nOnUnitActiveSec=10min\n\n[Install]\nWantedBy=timers.target") },
      { path: "/etc/systemd/system/sage-keysync.service", content: unit("Sync SFTP keys from the repository", "[Service]\nType=oneshot\nExecStart=/usr/local/sbin/sage-keysync") },
      { path: "/etc/systemd/system/sage-keysync.timer", content: unit("Every five minutes", "[Timer]\nOnBootSec=1min\nOnUnitActiveSec=5min\n\n[Install]\nWantedBy=timers.target") },
      { path: "/etc/systemd/system/sage-prune.service", content: unit("Delete SFTP files older than 30 days", "[Service]\nType=oneshot\nExecStart=/usr/local/sbin/sage-prune") },
      { path: "/etc/systemd/system/sage-prune.timer", content: unit("Daily", "[Timer]\nOnCalendar=*-*-* 08:30:00\nPersistent=true\n\n[Install]\nWantedBy=timers.target") },
      /* Security updates install themselves, and the machine restarts for
         them at 09:00 UTC, five in the morning Eastern, when nobody delivers. */
      { path: "/etc/apt/apt.conf.d/20auto-upgrades", content: 'APT::Periodic::Update-Package-Lists "1";\nAPT::Periodic::Unattended-Upgrade "1";\n' },
      { path: "/etc/apt/apt.conf.d/52sage-reboot", content: 'Unattended-Upgrade::Automatic-Reboot "true";\nUnattended-Upgrade::Automatic-Reboot-Time "09:00";\n' },
    ],
    runcmd: [
      ["bash", "-c", [
        "set -euo pipefail",
        // The watcher first, so it is already listening when the first
        // account can sign in: an upload that closes before anybody watches
        // would wait ten minutes for the catch-up pass.
        "install -d -m 0755 -o root -g root /srv/sftp",
        "install -d -m 0700 /var/lib/sage-sftp/notified",
        "systemctl daemon-reload",
        "systemctl enable --now fail2ban sage-watch.service sage-notify.timer sage-keysync.timer sage-prune.timer",
        "chmod 0755 /etc/ssh/authorized_keys",
        ...all.map((a) => [
          `id ${a} >/dev/null 2>&1 || useradd --no-create-home --home-dir / --shell /usr/sbin/nologin --gid sftponly ${a}`,
          // The chroot must be root's and not writable by the account; the
          // one folder inside it is the account's.
          `install -d -m 0755 -o root -g root /srv/sftp/${a}`,
          `install -d -m 0750 -o ${a} -g sftponly /srv/sftp/${a}/incoming`,
          `touch /etc/ssh/authorized_keys/${a}`,
        ].join(" && ")),
        "sshd -t",
        "systemctl restart ssh",
        "/usr/local/sbin/sage-keysync",
        "systemd-run --on-active=3600 --unit=sage-check-expire /usr/local/sbin/sage-check-expire",
        "touch /var/lib/sage-sftp/ready",
      ].join("\n")],
    ],
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const cfg = render({ sageUrl: process.env.SAGE_URL, notifySecret: process.env.NOTIFY_SECRET, checkPubkey: process.env.CHECK_PUBKEY });
  process.stdout.write("#cloud-config\n" + JSON.stringify(cfg, null, 1) + "\n");
}
