#!/usr/bin/env bash
# Hosted CI only: preinstalled PG16, private cluster, no service or package changes.
set -euo pipefail
[[ "${GITHUB_ACTIONS:-}" == true ]] || exit 2
engine="$1"
[[ "$engine" == chromium || "$engine" == webkit ]] || exit 2
preflight=$(node scripts/scheduler-manual/browser-postgres.mjs)
bin=$(node -e 'console.log(JSON.parse(process.argv[1]).bin)' "$preflight")
version=$(node -e 'console.log(JSON.parse(process.argv[1]).version)' "$preflight")
browser="sage-manual-${GITHUB_RUN_ID}-${GITHUB_RUN_ATTEMPT}-${engine}"
containers=$(docker ps -a --format '{{.Names}}')
if printf '%s\n' "$containers" | grep -Fx "$browser" >/dev/null; then exit 2; fi
root=$(mktemp -d /tmp/sage-manual-XXXXXX)
started=false
mkdir -p manual-browser-evidence
cleanup() {
 status=$?
 cleanup_ok=true
 trap - EXIT
 docker rm -f -v "$browser" >/dev/null 2>&1 || true
 if ! containers=$(docker ps -a --format '{{.Names}}'); then cleanup_ok=false
 elif printf '%s\n' "$containers" | grep -Fx "$browser" >/dev/null; then cleanup_ok=false; fi
 if [[ "$started" == true ]]; then
  env -i PATH=/usr/bin:/bin LANG=C HOME="$root/home" "$bin/pg_ctl" -D "$root/data" -w -t 15 -m fast stop >/dev/null 2>&1 || true
  pg_status=0
  env -i PATH=/usr/bin:/bin LANG=C HOME="$root/home" "$bin/pg_ctl" -D "$root/data" status >/dev/null 2>&1 || pg_status=$?
  [[ "$pg_status" == 3 ]] || cleanup_ok=false
 fi
 cp -R "$root/evidence"/. manual-browser-evidence/ 2>/dev/null || true
 if [[ "$cleanup_ok" == true ]]; then rm -rf -- "$root"; [[ ! -e "$root" ]] || cleanup_ok=false; fi
 [[ "$cleanup_ok" == true ]] || status=1
 printf '{"clusterAndContainerCleanupVerified":%s,"postgresVersion":%s}\n' "$cleanup_ok" "$version" | tee manual-browser-evidence/cleanup.json
 exit "$status"
}
trap cleanup EXIT
trap 'exit 143' TERM
trap 'exit 130' INT
mkdir -m 700 "$root/socket" "$root/evidence" "$root/home"
printf '%s\n' "$preflight" > "$root/evidence/postgres-preflight.json"
# Each PG command receives an allowlisted synthetic environment, never PG* defaults.
# The host owns data. Only its socket directory and output folder enter the browser container.
env -i PATH=/usr/bin:/bin LANG=C HOME="$root/home" "$bin/initdb" -D "$root/data" -U delivery_fixture --auth-local=trust --auth-host=reject --no-instructions >/dev/null
printf "listen_addresses=''\nunix_socket_directories='%s/socket'\nunix_socket_permissions=0700\nfsync=on\nsynchronous_commit=on\n" "$root" >> "$root/data/postgresql.conf"
started=true
env -i PATH=/usr/bin:/bin LANG=C HOME="$root/home" "$bin/pg_ctl" -D "$root/data" -l "$root/postgres.log" -w -t 15 start >/dev/null
actual=$(env -i PATH=/usr/bin:/bin LANG=C HOME="$root/home" "$bin/psql" -X -w -qAt -h "$root/socket" -U delivery_fixture -d postgres -c "SELECT current_setting('listen_addresses') || '|' || current_setting('data_directory') || '|' || current_setting('unix_socket_directories') || '|' || current_setting('server_version_num')")
[[ "$actual" == "|$root/data|$root/socket|$version" ]]
docker pull mcr.microsoft.com/playwright:v1.63.0-noble
# Same numeric unprivileged host UID/GID can traverse its own0700 socket; no chmod/chown.
# No DB data mount, Docker socket, host network, privileged flag, or browser security override.
docker run --name "$browser" --network none --user "$(id -u):$(id -g)" --mount "type=bind,src=$PWD,dst=/work,readonly" --mount "type=bind,src=$root/socket,dst=$root/socket" --mount "type=bind,src=$root/evidence,dst=/evidence" -w /work -e GITHUB_ACTIONS=true -e HOME=/tmp mcr.microsoft.com/playwright:v1.63.0-noble node scripts/probe-scheduler-manual.mjs "$root/socket" "$root/data" /evidence "$engine" "$version"
