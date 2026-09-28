#!/bin/bash
# C92: proves supabase/pending/01-doorbell.sql and 02-lock.sql on a real
# Postgres before either reaches the live project. Throwaway cluster, stand-ins
# for Supabase's auth.uid() and realtime.send(), the baseline's tables and
# its open policies; then the two files, then every kind of visitor.
#
#   sudo -u postgres scripts/c92-lock-check.sh      (needs Postgres 16 binaries)
#
# Prints one line per fact, "ok" or "FAIL", and exits non-zero on any FAIL.
set -euo pipefail
BIN=${PGBIN:-/usr/lib/postgresql/16/bin}
HERE=$(cd "$(dirname "$0")/.." && pwd)
PENDING=${PENDING:-$HERE/supabase/pending}   # point it elsewhere to prove a bad lock fails
DIR=$(mktemp -d)
PORT=${PGPORT:-5499}
trap '"$BIN/pg_ctl" -D "$DIR" -m immediate stop >/dev/null 2>&1 || true; rm -rf "$DIR"' EXIT
"$BIN/initdb" -D "$DIR" -A trust -U postgres >/dev/null
"$BIN/pg_ctl" -D "$DIR" -o "-p $PORT -k $DIR -c listen_addresses=''" -l "$DIR/log" start >/dev/null
q() { psql -X -q -v ON_ERROR_STOP=1 -h "$DIR" -p "$PORT" -U postgres -d postgres "$@"; }

q <<'SQL'
create role anon nologin; create role authenticated nologin;
create schema auth; create schema realtime; create schema supabase_functions;
create table auth.users (id uuid primary key);
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
grant usage on schema auth to anon, authenticated;
grant execute on function auth.uid() to anon, authenticated;
create table realtime.rang (topic text, event text, payload jsonb, private boolean);
create function realtime.send(payload jsonb, event text, topic text, private boolean default true) returns void
  language sql as $$ insert into realtime.rang values (topic, event, payload, private) $$;
grant usage on schema public to anon, authenticated;
SQL
# The baseline's own tables, grants and open policies, lifted from the file
# rather than retyped, so this checks against what is really there.
python3 - "$HERE/supabase/migrations/00000000000000_baseline.sql" > "$DIR/base.sql" <<'PY'
import re, sys
s = open(sys.argv[1]).read()
out = []
for t in ["profiles", "floor_people", "floor_public", "queue_public"]:
    m = re.search(r"create table if not exists public\.%s \(.*?\n\);" % t, s, re.S)
    out.append(m.group(0))
    out.append("alter table public.%s enable row level security;" % t)
out += [l for l in s.splitlines() if re.match(r'create policy .* on public\.(floor_public|queue_public) ', l)]
out.append("grant select, insert, update, delete on public.profiles, public.floor_people, public.floor_public, public.queue_public to anon, authenticated;")
print("\n".join(out))
PY
q -f "$DIR/base.sql"

q <<'SQL'
insert into auth.users select ('00000000-0000-0000-0000-0000000000' || x)::uuid from unnest(array['0a','a1','a2','a3','a4','a5']) x;
insert into profiles (id, role, stores, active, pending) values
  ('00000000-0000-0000-0000-00000000000a', 'admin',   '{}',     true, false),
  ('00000000-0000-0000-0000-0000000000a1', 'manager', '{dm}',   true, false),
  ('00000000-0000-0000-0000-0000000000a2', 'manager', '{xx}',   true, false),
  ('00000000-0000-0000-0000-0000000000a3', 'manager', '{}',     true, true),
  ('00000000-0000-0000-0000-0000000000a4', 'manager', '{dm}',   true, true),
  ('00000000-0000-0000-0000-0000000000a5', 'manager', '{dm}',   false, false);
insert into floor_people (id, user_id, store, person_id) values ('l1', '00000000-0000-0000-0000-0000000000a3', 'dm', 'p1');
insert into floor_public (id, store, fdate, data) values ('dm:2026-09-28', 'dm', '2026-09-28', '{"token":"abc123"}');
insert into queue_public (id, store, qdate, data) values ('dm:2026-09-28', 'dm', '2026-09-28', '{"token":"line99"}');
insert into queue_public (id, store, qdate, data) values ('ticket:t1', 'dm', '2026-09-28', '{"store":"dm","body":"x"}'), ('ticket:t2', 'xx', '2026-09-28', '{"store":"xx","body":"y"}');
SQL

fails=0
ok()   { echo "ok    $*"; }
fail() { echo "FAIL  $*"; fails=$((fails+1)); }
# as ROLE [USER] SQL: run SQL as that role (and that auth.uid()), print the result or ERR
as() {
  local role=$1 user=$2; shift 2
  q -tA -c "set role $role; set request.jwt.claim.sub = '$user'; $*" 2>&1 || true
}
expect() { local want=$1 got=$2 what=$3; if [ "$got" = "$want" ]; then ok "$what"; else fail "$what (got: $got)"; fi; }

# Before: the gap C92 is about.
expect 1 "$(as anon '' "select count(*) from floor_public")" "before: the public key reads the floor row"
expect abc123 "$(as anon '' "select data->>'token' from floor_public")" "before: and its sign-in code"
# C98, as the live table is today: the app's saveTicket sends only id and data,
# and the table refuses it for want of its store. The reason no ticket exists.
case "$(as anon '' "insert into queue_public (id, data) values ('ticket:t9','{}')")" in *"not-null"*) ok "C98: a ticket as the app sends it today is refused (store is NOT NULL)";; *) fail "C98 did not reproduce";; esac

for f in 01-doorbell.sql 02-lock.sql; do
  if ! q -f "$PENDING/$f" >/dev/null 2>"$DIR/err"; then cat "$DIR/err"; fail "$f did not apply"; echo; echo "1 check(s) failed."; exit 1; fi
done
ok "both pending files apply cleanly"
if q -f "$PENDING/01-doorbell.sql" >/dev/null 2>&1 && q -f "$PENDING/02-lock.sql" >/dev/null 2>&1; then ok "and apply again without error (safe to re-run)"; else fail "a second run errors"; fi

A=00000000-0000-0000-0000-00000000000a M=00000000-0000-0000-0000-0000000000a1 O=00000000-0000-0000-0000-0000000000a2
L=00000000-0000-0000-0000-0000000000a3 P=00000000-0000-0000-0000-0000000000a4 I=00000000-0000-0000-0000-0000000000a5

# The public key: nothing at all.
case "$(as anon '' "select count(*) from floor_public")" in *"permission denied"*) ok "after: the public key cannot read the floor";; *) fail "after: the public key still reads the floor";; esac
case "$(as anon '' "select count(*) from queue_public")" in *"permission denied"*) ok "after: nor the phone line, nor tickets";; *) fail "after: the public key still reads queue_public";; esac
case "$(as anon '' "update floor_public set data='{}'")" in *"permission denied"*) ok "after: nor write to it";; *) fail "after: the public key can still write";; esac

# Staff, the three ways in, and the ways that are not.
expect 1 "$(as authenticated $M "select count(*) from floor_public where store='dm'")" "manager of dm reads dm"
expect 0 "$(as authenticated $O "select count(*) from floor_public where store='dm'")" "manager of another store sees none of dm"
expect 1 "$(as authenticated $A "select count(*) from floor_public")" "admin reads every store"
expect 1 "$(as authenticated $L "select count(*) from floor_public")" "pending account linked to dm's floor reads dm"
expect 0 "$(as authenticated $P "select count(*) from floor_public")" "pending account with dm on its profile but no link: nothing"
expect 0 "$(as authenticated $I "select count(*) from floor_public")" "inactive account: nothing"
expect 0 "$(as authenticated '' "select count(*) from floor_public")" "signed-in role with no user: nothing"
expect UPDATE "$(as authenticated $M "update floor_public set data = jsonb_set(data,'{line}','[1]') where id='dm:2026-09-28' returning 'UPDATE'")" "manager of dm writes dm"
expect "" "$(as authenticated $O "update floor_public set data='{}' where id='dm:2026-09-28' returning 'UPDATE'")" "manager of another store writes nothing (0 rows)"
case "$(as authenticated $O "insert into floor_public (id, store, fdate, data) values ('dm:2026-09-29','dm','2026-09-29','{}')")" in *"row-level security"*) ok "nor opens a room at dm";; *) fail "another store's manager opened a dm room";; esac
case "$(as authenticated $M "update floor_public set store='xx' where id='dm:2026-09-28'")" in *"row-level security"*) ok "a row cannot be moved to a store the writer does not have";; *) fail "a row was moved to another store";; esac
expect INSERT "$(as authenticated $M "insert into queue_public (id, store, qdate, data) values ('dm:2026-09-28:online','dm','2026-09-28','{}') returning 'INSERT'")" "the desk opens the online line"

# Tickets follow their store column.
expect "ticket:t1" "$(as authenticated $M "select string_agg(id, ',') from queue_public where id like 'ticket:%'")" "a manager sees their store's tickets only"
expect 2 "$(as authenticated $A "select count(*) from queue_public where id like 'ticket:%'")" "admin sees every ticket"
expect INSERT "$(as authenticated $M "insert into queue_public (id, store, qdate, data) values ('ticket:t3','dm','2026-09-28','{}') returning 'INSERT'")" "a manager files a ticket for their store"
case "$(as authenticated $M "insert into queue_public (id, store, qdate, data) values ('ticket:t4','xx','2026-09-28','{}')")" in *"row-level security"*) ok "but not for another store";; *) fail "a ticket was filed for another store";; esac

# The doorbell: every write rings, with the time and nothing of the row.
n=$(q -tA -c "select count(*) from realtime.rang")
body=$(q -tA -c "select payload::text from realtime.rang where topic='row:floor_public:dm:2026-09-28' order by 1 desc limit 1")
priv=$(q -tA -c "select bool_or(private) from realtime.rang")
tickets=$(q -tA -c "select count(*) from realtime.rang where topic like '%ticket:%'")
[ "$n" -ge 2 ] && ok "writes ring the doorbell ($n rings)" || fail "no rings"
case "$body" in '{"stamp": "'*'"}') ok "the ring carries the time and nothing else";; *) fail "the ring carries more: $body";; esac
expect f "$priv" "on a public topic, so a phone with no account can hear it"
expect 0 "$tickets" "tickets ring nothing"

echo
if [ "$fails" = 0 ]; then echo "All checks passed."; else echo "$fails check(s) failed."; fi
exit "$fails"
