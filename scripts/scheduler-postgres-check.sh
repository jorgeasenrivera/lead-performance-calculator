#!/usr/bin/env bash
set -euo pipefail

usage() {
  printf '%s\n' 'Usage: scheduler-postgres-check.sh --run-local [--bin-dir /approved/postgres/bin] --c113-root /verified/extracted --c113-archive /verified/source.tar.gz' \
    '       scheduler-postgres-check.sh --check-artifacts --c113-root /verified/extracted --c113-archive /verified/source.tar.gz' \
    'Creates a disposable fictional Unix-socket-only cluster. No remote target, download or installation.' \
    'Only run after the test environment and binary source have been separately approved.'
}
if [[ $# -eq 0 || ${1:-} == --help ]]; then usage; exit 0; fi
[[ $1 == --run-local || $1 == --check-artifacts ]] || { usage >&2; exit 2; }
mode=$1
shift
bin=''; c113_root=''; c113_archive=''
while [[ $# -gt 0 ]]; do
  [[ $# -ge 2 && $2 == /* ]] || { usage >&2; exit 2; }
  case "$1" in
    --bin-dir) [[ -z $bin ]] || exit 2; bin=$2 ;;
    --c113-root) [[ -z $c113_root ]] || exit 2; c113_root=$2 ;;
    --c113-archive) [[ -z $c113_archive ]] || exit 2; c113_archive=$2 ;;
    *) usage >&2; exit 2 ;;
  esac
  shift 2
done
[[ -n $c113_root && -n $c113_archive ]] || { echo 'SQL checks not run: pinned original artifact paths are required; no fallback or download' >&2; exit 2; }
node=$(command -v node || true)
[[ -n $node ]] || { echo 'SQL checks not run: Node is missing' >&2; exit 2; }
repo=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)
# Verify the complete pinned import graph before any cluster/files are created.
# These are explicit CLI paths, never inherited credentials or ambient PG vars.
artifacts=(SCHEDULER_POSTGRES_ARTIFACTS=original-r1 SCHEDULER_C113_ROOT="$c113_root" SCHEDULER_C113_ARCHIVE="$c113_archive")
env -i PATH="$PATH" LANG=C "${artifacts[@]}" SCHEDULER_POSTGRES_VERIFY_ARTIFACTS=1 \
  "$node" "$repo/test/scheduler-postgres.test.mjs"
[[ $mode != --check-artifacts ]] || exit 0
[[ $(id -u) -ne 0 ]] || { echo 'SQL checks not run: an unprivileged executor is required' >&2; exit 2; }
if [[ -z $bin ]]; then
  found=$(command -v initdb || true)
  [[ -n $found ]] && bin=$(dirname "$found")
fi
for tool in initdb pg_ctl psql postgres; do
  [[ -n $bin && -x $bin/$tool ]] || { echo "SQL checks not run: approved $tool binary is missing; no install attempted" >&2; exit 2; }
done
version=$("$bin/postgres" --version | awk '{print $NF}')
for tool in initdb pg_ctl psql; do
  [[ $("$bin/$tool" --version | awk '{print $NF}') == "$version" ]] || { echo 'SQL checks not run: PostgreSQL binary versions differ' >&2; exit 2; }
done
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
"${psql[@]}" -d scheduler_fixture -f "$repo/test/matching-profile-fixture.sql"
# Synthetic hosted installer: database/profile owner, CREATEROLE, BYPASSRLS,
# explicitly not superuser. No preexisting scheduler role membership.
"${psql[@]}" -d scheduler_fixture -c 'CREATE ROLE postgres LOGIN NOSUPERUSER CREATEROLE NOCREATEDB BYPASSRLS; ALTER DATABASE scheduler_fixture OWNER TO postgres; ALTER TABLE public.profiles OWNER TO postgres; ALTER TABLE public.app_data OWNER TO postgres'
"${clean[@]}" SCHEDULER_POSTGRES_ROOT="$root" SCHEDULER_POSTGRES_BIN="$bin" "$node" --test "$repo/scripts/scheduler-verification/installer.mjs"
# Local socket-only test connections. No login or credential is added by proposal.
"${psql[@]}" -d scheduler_fixture -c 'ALTER ROLE scheduler_runtime LOGIN; ALTER ROLE authenticated LOGIN; ALTER ROLE anon LOGIN; ALTER ROLE service_role LOGIN; REVOKE CREATE, TEMPORARY ON DATABASE scheduler_fixture FROM PUBLIC; REVOKE CREATE ON SCHEMA public FROM PUBLIC; GRANT CONNECT ON DATABASE scheduler_fixture TO scheduler_runtime,authenticated,anon,service_role'
"${clean[@]}" "${artifacts[@]}" SCHEDULER_POSTGRES_ROOT="$root" SCHEDULER_POSTGRES_BIN="$bin" "$node" --test "$repo/scripts/scheduler-verification/matching-schema-sql.mjs"
echo 'Matching verified profile-shape checks complete; no production or real-credential evidence.'
