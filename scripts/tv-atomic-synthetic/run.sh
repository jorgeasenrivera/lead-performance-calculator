#!/usr/bin/env bash
set -euo pipefail
# Dedicated local daemon, network disabled, no published ports or real credentials.
unset DOCKER_HOST DOCKER_CONTEXT DOCKER_TLS DOCKER_TLS_VERIFY DOCKER_CERT_PATH
docker_cmd=(docker --host=unix:///var/run/docker.sock)
root="$(cd "$(dirname "$0")" && pwd)"
name="sage-tv-synthetic-$(date +%s)-$$"
export TV_TEST_CONTAINER="$name"
cleanup() { "${docker_cmd[@]}" rm -f "$name" >/dev/null 2>&1 || true; }
trap cleanup EXIT
"${docker_cmd[@]}" run -d --rm --name "$name" --network none -e POSTGRES_HOST_AUTH_METHOD=trust postgres:16 >/dev/null
ready=0
for _ in {1..120}; do
  count="$("${docker_cmd[@]}" logs "$name" 2>&1 | rg -c 'database system is ready to accept connections' || true)"
  if [[ "${count:-0}" -ge 2 ]] && "${docker_cmd[@]}" exec "$name" pg_isready -U postgres >/dev/null 2>&1; then ready=1; break; fi
  sleep .25
done
if [[ "$ready" != 1 ]]; then echo 'Isolated Postgres did not become ready' >&2; exit 1; fi
"${docker_cmd[@]}" exec -i "$name" psql -X -q -v ON_ERROR_STOP=1 -U postgres -d postgres < "$root/setup.sql"
"${docker_cmd[@]}" exec "$name" psql -X -q -v ON_ERROR_STOP=1 -U postgres -d postgres -c 'grant update on private_store to tv_rpc_owner'
"${docker_cmd[@]}" exec -i "$name" psql -X -q -v ON_ERROR_STOP=1 -U postgres -d postgres < "$root/projection.sql"
"${docker_cmd[@]}" exec -i "$name" psql -X -q -v ON_ERROR_STOP=1 -U postgres -d postgres < "$root/validated-revision.sql"
python3 "$root/derived-test.py"
"${docker_cmd[@]}" exec -i "$name" psql -X -q -v ON_ERROR_STOP=1 -U postgres -d postgres < "$root/patch.sql"
"${docker_cmd[@]}" exec "$name" psql -X -q -v ON_ERROR_STOP=1 -U postgres -d postgres -c 'revoke execute on function save_settings(text,bigint,jsonb,jsonb) from client,service_role'
python3 "$root/patch-test.py"

python3 "$root/transaction-test.py"

python3 "$root/validated-revision-test.py"
