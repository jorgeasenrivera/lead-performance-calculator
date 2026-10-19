#!/usr/bin/env bash
set -euo pipefail

usage() {
  printf '%s\n' 'Usage: scheduler-postgres-check.sh --run-local [--bin-dir /approved/postgres/bin]' \
    'Creates a disposable fictional Unix-socket-only cluster. No remote target, download or installation.' \
    'Only run after the test environment and binary source have been separately approved.'
}
if [[ $# -eq 0 || ${1:-} == --help ]]; then usage; exit 0; fi
[[ $1 == --run-local ]] || { usage >&2; exit 2; }
shift
bin=''
if [[ $# -gt 0 ]]; then
  [[ $# -eq 2 && $1 == --bin-dir && $2 == /* ]] || { usage >&2; exit 2; }
  bin=$2
  shift 2
fi
[[ $(id -u) -ne 0 ]] || { echo 'SQL checks not run: an unprivileged executor is required' >&2; exit 2; }
if [[ -z $bin ]]; then
  found=$(command -v initdb || true)
  [[ -n $found ]] && bin=$(dirname "$found")
fi
for tool in initdb pg_ctl psql postgres; do
  [[ -n $bin && -x $bin/$tool ]] || { echo "SQL checks not run: approved $tool binary is missing; no install attempted" >&2; exit 2; }
done
node=$(command -v node || true)
[[ -n $node ]] || { echo 'SQL checks not run: Node is missing' >&2; exit 2; }
version=$("$bin/postgres" --version | awk '{print $NF}')
for tool in initdb pg_ctl psql; do
  [[ $("$bin/$tool" --version | awk '{print $NF}') == "$version" ]] || { echo 'SQL checks not run: PostgreSQL binary versions differ' >&2; exit 2; }
done
repo=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)
umask 077
root=$(mktemp -d /tmp/sage-scheduler-pg.XXXXXXXX)
mkdir "$root/socket" "$root/home"
printf '%s' "$root" > "$root/runner-marker"
clean=(env -i PATH="$PATH" HOME="$root/home" LANG=C)
cleanup() {
  result=$?
  trap - EXIT INT TERM
  if [[ -f $root/data/postmaster.pid ]]; then
    if ! "${clean[@]}" "$bin/pg_ctl" -D "$root/data" -w -t 15 -m fast stop; then
      echo "Could not confirm this cluster stopped; preserving $root" >&2
      exit 1
    fi
  fi
  case "$root" in /tmp/sage-scheduler-pg.*) rm -rf -- "$root" ;; *) exit 1 ;; esac
  exit "$result"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
"${clean[@]}" "$bin/initdb" -D "$root/data" -U scheduler_fixture --auth-local=trust --auth-host=reject --no-instructions > "$root/initdb.log"
cat >> "$root/data/postgresql.conf" <<EOF
listen_addresses = ''
port = 5432
unix_socket_directories = '$root/socket'
unix_socket_permissions = 0700
fsync = on
synchronous_commit = on
EOF
"${clean[@]}" "$bin/pg_ctl" -D "$root/data" -l "$root/postgres.log" -w -t 15 start
psql=("${clean[@]}" "$bin/psql" -X -w -At -v ON_ERROR_STOP=1 -h "$root/socket" -p 5432 -U scheduler_fixture)
[[ $("${psql[@]}" -d postgres -c 'SHOW data_directory') == "$root/data" ]]
[[ -z $("${psql[@]}" -d postgres -c 'SHOW listen_addresses') ]]
"${psql[@]}" -d postgres -c 'CREATE DATABASE scheduler_fixture'
"${psql[@]}" -d scheduler_fixture -f "$repo/supabase/pending/scheduler-transaction.sql"
"${clean[@]}" SCHEDULER_POSTGRES_MODE=local SCHEDULER_POSTGRES_ROOT="$root" SCHEDULER_POSTGRES_BIN="$bin" \
  "$node" --test "$repo/test/scheduler-postgres.test.mjs"
echo 'Real disposable SQL checks completed. This is not live authorization, Supabase reachability or power-loss evidence.'
