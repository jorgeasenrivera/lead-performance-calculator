# Sage's SFTP server

PromptPath delivers its analytics exports here (C96). The server is a
DigitalOcean machine in New York; the files stay on it for 30 days and are
then deleted, and Sage records only that each one arrived (name, size, time,
fingerprint) in `sftp_arrivals`. Sage's database is in Canada, which is why
the files themselves never go there.

## What is on the server

| Piece | What it does |
|---|---|
| `sshd-sage.conf` | Keys only, no root, each account shut in `/srv/sftp/<account>` with one writable folder, `incoming/`, and SFTP only (no shell, no tunnels). |
| `sage-watch`, `sage-notify` | The moment an upload finishes, tell Sage (`/api/sftp-arrival`); every ten minutes, catch up on any notice that did not get through. |
| `sage-keysync` | Every five minutes, make each account's keys match `keys/<account>.pub` on `main`. Deleting the file removes access. |
| `sage-prune` | Daily, delete files older than 30 days. |
| `sage-check-expire` | Removes the check account an hour after the server first boots. |
| unattended upgrades, fail2ban | Security updates install themselves, restarting at 09:00 UTC (5 AM Eastern) when one needs it; repeated failed sign-ins are blocked. |

`render.mjs` turns those files into the server's first-boot setup, so the
server runs exactly what is here. `check.sh` proves it from outside: nine
checks, from "passwords are refused" to "Sage recorded the file".

Port 22 is shut to everybody unless an address is in `allowed-ips.txt`.

## Jorge's part, once

1. **DigitalOcean account.** Sign up at digitalocean.com with the card it
   bills. It will email a root password for the server when it is made:
   keep it, it only works in DigitalOcean's own web console, never over the
   internet.
2. **An API key, limited.** DigitalOcean → API → Tokens → Generate New Token.
   Name `sage-github`, expiry 90 days, **Custom Scopes**, and tick only:
   account read; actions read; droplet create and read; firewall create,
   read and update; image read; regions read; reserved_ip create and read;
   sizes read; tag create and read. DigitalOcean then asks to add three it
   needs for those (snapshot, vpc and project, read only): accept. That is
   17 in all. If a run stops on a missing scope, its error names the one
   to add.
3. **Two GitHub secrets** (repository Settings → Secrets and variables →
   Actions → New repository secret):
   - `DIGITALOCEAN_TOKEN`: the key from step 2.
   - `SFTP_NOTIFY_SECRET`: 48 random letters and numbers, from a password
     manager's generator.
4. **The same `SFTP_NOTIFY_SECRET` in Vercel** (project → Settings →
   Environment Variables, for Production), then redeploy so the site picks it
   up.
5. **Tell Claude.** The server is then made and checked from GitHub:
   Actions → SFTP server → Run workflow → `create`.
6. **One DNS record in Cloudflare**, from the run's summary: an A record,
   name `sftp`, pointing at the server's address, proxy **off** (grey cloud).
   SFTP does not pass through Cloudflare's proxy.

## When PromptPath replies

Send Chris: host `sftp.sageonline.io`, port 22, user `promptpath`, key
authentication, upload into `incoming/`. Ask for their SSH **public** key
and the IP addresses they deliver from. Then:

- their key goes in `keys/promptpath.pub` (a commit; the server picks it up
  within five minutes);
- their addresses go in `allowed-ips.txt`, then run the workflow with
  `firewall`.

Their first real upload shows in `sftp_arrivals` within seconds.

## Cost

About $7.20 a month: the $6 server and weekly backups (20%). The firewall is
free, and the fixed address is free while it is attached.
