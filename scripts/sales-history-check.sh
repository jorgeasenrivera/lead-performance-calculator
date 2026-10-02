#!/bin/bash
# C111: proves supabase/pending/03-sales-history.sql on a real Postgres, the
# way scripts/c92-lock-check.sh proves the floor lock. Throwaway cluster, a
# stand-in for auth.uid(), the baseline's profiles and floor_people tables;
# then the file, then every kind of visitor and every kind of bad row.
#
#   sudo -u postgres scripts/sales-history-check.sh     (needs Postgres 16 binaries)
#
# Prints one line per fact, "ok" or "FAIL", and exits non-zero on any FAIL.
set -euo pipefail
BIN=${PGBIN:-/usr/lib/postgresql/16/bin}
HERE=$(cd "$(dirname "$0")/.." && pwd)
SQL=${SQL:-$HERE/supabase/pending/03-sales-history.sql}
[ -f "$SQL" ] || SQL=$(ls "$HERE"/supabase/migrations/*_sales_history.sql | head -1)   # once it has moved
DIR=$(mktemp -d)
PORT=${PGPORT:-5498}
trap '"$BIN/pg_ctl" -D "$DIR" -m immediate stop >/dev/null 2>&1 || true; rm -rf "$DIR"' EXIT
"$BIN/initdb" -D "$DIR" -A trust -U postgres >/dev/null
"$BIN/pg_ctl" -D "$DIR" -o "-p $PORT -k $DIR -c listen_addresses=''" -l "$DIR/log" start >/dev/null
q() { psql -X -q -v ON_ERROR_STOP=1 -h "$DIR" -p "$PORT" -U postgres -d postgres "$@"; }

q <<'SQL'
create role anon nologin; create role authenticated nologin;
create schema auth;
create table auth.users (id uuid primary key);
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
grant usage on schema auth to anon, authenticated;
grant execute on function auth.uid() to anon, authenticated;
grant usage on schema public to anon, authenticated;
SQL
# The baseline's own profiles table and its read policy, lifted from the file
# rather than retyped. is_admin() is the project's own, written out here.
python3 - "$HERE/supabase/reference/2026-09-12-baseline.sql" > "$DIR/base.sql" <<'PY'
import re, sys
s = open(sys.argv[1]).read()
m = re.search(r"create table if not exists public\.profiles \(.*?\n\);", s, re.S)
print(m.group(0))
print("alter table public.profiles enable row level security;")
print("create function public.is_admin() returns boolean language sql stable security definer set search_path to 'public' as $$ select exists (select 1 from profiles where id = auth.uid() and role = 'admin' and active) $$;")
print([l for l in s.splitlines() if re.match(r'create policy "profiles read"', l)][0])
print("grant select on public.profiles to authenticated;")
PY
q -f "$DIR/base.sql"
q <<'SQL'
insert into auth.users select ('00000000-0000-0000-0000-0000000000' || x)::uuid from unnest(array['0a','a1','a2','a3','a4','a5','a6']) x;
insert into public.profiles (id, role, stores, active, pending) values
  ('00000000-0000-0000-0000-00000000000a', 'admin',    '{}',       true, false),
  ('00000000-0000-0000-0000-0000000000a1', 'manager',  '{dm}',     true, false),
  ('00000000-0000-0000-0000-0000000000a2', 'manager',  '{xx}',     true, false),
  ('00000000-0000-0000-0000-0000000000a3', 'manager',  '{}',       true, true),
  ('00000000-0000-0000-0000-0000000000a4', 'manager',  '{dm}',     true, true),
  ('00000000-0000-0000-0000-0000000000a5', 'manager',  '{dm}',     false, false),
  ('00000000-0000-0000-0000-0000000000a6', 'overseer', '{dm,xx}',  true, false);
SQL

fails=0
ok()   { echo "ok    $*"; }
fail() { echo "FAIL  $*"; fails=$((fails+1)); }
as() { local role=$1 user=$2; shift 2; q -tA -c "set role $role; set request.jwt.claim.sub = '$user'; $*" 2>&1 || true; }
expect() { local want=$1 got=$2 what=$3; if [ "$got" = "$want" ]; then ok "$what"; else fail "$what (got: $got)"; fi; }
refused() { local pat=$1 got=$2 what=$3; case "$got" in *"$pat"*) ok "$what";; *) fail "$what (got: $got)";; esac; }

if ! q -f "$SQL" >/dev/null 2>"$DIR/err"; then cat "$DIR/err"; fail "the file did not apply"; echo; echo "1 check(s) failed."; exit 1; fi
ok "the file applies cleanly"

A=00000000-0000-0000-0000-00000000000a M=00000000-0000-0000-0000-0000000000a1 O=00000000-0000-0000-0000-0000000000a2
L=00000000-0000-0000-0000-0000000000a3 P=00000000-0000-0000-0000-0000000000a4 I=00000000-0000-0000-0000-0000000000a5 V=00000000-0000-0000-0000-0000000000a6

# The server writes (the service role bypasses row security; here, the owner).
q <<'SQL'
insert into sales_daily (store, day, units, closed, source) values
  ('dm', '2026-09-26', 12, false, 'workbook-2026-10'),
  ('dm', '2026-09-27', null, true, 'workbook-2026-10'),
  ('dm', '2026-09-28', 0, false, 'workbook-2026-10'),
  ('xx', '2026-09-26', 7, false, 'workbook-2026-10');
insert into schedule_rules (store, effective_from, rules, set_by) values
  ('dm', '2026-01-01', '{"minPeople":{"sat":6}}', '00000000-0000-0000-0000-0000000000a1'),
  ('xx', '2026-01-01', '{"minPeople":{"sat":4}}', '00000000-0000-0000-0000-0000000000a2');
SQL
ok "the server's writes land"
expect 3 "$(as postgres '' "select count(*) from sales_daily where store='dm'")" "a day of zero, a closed day and a counted day are three different rows"

# Who reads.
expect 3 "$(as authenticated $M "select count(*) from sales_daily where store='dm'")" "a manager of dm reads dm's history"
expect 0 "$(as authenticated $M "select count(*) from sales_daily where store='xx'")" "and none of another store's"
expect 4 "$(as authenticated $A "select count(*) from sales_daily")" "an admin reads every store"
expect 4 "$(as authenticated $V "select count(*) from sales_daily")" "an overseer reads the stores on their profile"
expect 0 "$(as authenticated $O "select count(*) from sales_daily where store='dm'")" "a manager of another store sees none of dm"
expect 0 "$(as authenticated $L "select count(*) from sales_daily")" "an unapproved account with no store: nothing"
expect 0 "$(as authenticated $P "select count(*) from sales_daily")" "a salesperson's pending account that names dm: nothing"
expect 0 "$(as authenticated $I "select count(*) from sales_daily")" "an inactive account: nothing"
expect 0 "$(as authenticated '' "select count(*) from sales_daily")" "signed in with no user: nothing"
refused "permission denied" "$(as anon '' "select count(*) from sales_daily")" "the public key cannot read it"
expect 1 "$(as authenticated $M "select count(*) from schedule_rules")" "a manager reads their store's rules only"
expect 2 "$(as authenticated $A "select count(*) from schedule_rules")" "an admin reads every store's"
refused "permission denied" "$(as anon '' "select count(*) from schedule_rules")" "the public key cannot read the rules"

# Nobody but the server writes.
refused "permission denied" "$(as authenticated $M "insert into sales_daily (store, day, units, source) values ('dm','2026-10-01',3,'x')")" "a manager cannot add a day"
refused "permission denied" "$(as authenticated $A "insert into sales_daily (store, day, units, source) values ('dm','2026-10-01',3,'x')")" "nor an admin"
refused "permission denied" "$(as authenticated $M "update sales_daily set units = 99 where store='dm'")" "a manager cannot change a past delivery"
refused "permission denied" "$(as authenticated $M "delete from sales_daily where store='dm'")" "nor delete it"
refused "permission denied" "$(as authenticated $M "insert into schedule_rules (store, effective_from, rules) values ('dm','2026-10-01','{}')")" "a manager cannot write the rules directly (they save through the server)"
refused "permission denied" "$(as authenticated $M "delete from schedule_rules")" "nor delete them"
refused "permission denied" "$(as anon '' "insert into sales_daily (store, day, units, source) values ('dm','2026-10-01',3,'x')")" "the public key cannot write"

# Bad rows are refused by the table itself.
refused "sales_daily_known" "$(as postgres '' "insert into sales_daily (store, day, units, closed, source) values ('dm','2026-10-02',5,true,'x')")" "a closed day with a count is refused"
refused "sales_daily_known" "$(as postgres '' "insert into sales_daily (store, day, units, closed, source) values ('dm','2026-10-02',null,false,'x')")" "an open day with no count is refused (unknown has no row)"
refused "violates check" "$(as postgres '' "insert into sales_daily (store, day, units, source) values ('dm','2026-10-02',-1,'x')")" "a negative count is refused"
refused "violates check" "$(as postgres '' "insert into sales_daily (store, day, units, source) values ('dm','2026-10-02',5000,'x')")" "so is a typo of 5,000"
refused "violates check" "$(as postgres '' "insert into sales_daily (store, day, units, source) values ('Not A Store','2026-10-02',5,'x')")" "and a store id that is not one"
refused "violates check" "$(as postgres '' "insert into sales_daily (store, day, units, source) values ('dm','2026-10-02',5,'')")" "and a number with no source"
refused "duplicate key" "$(as postgres '' "insert into sales_daily (store, day, units, source) values ('dm','2026-09-26',5,'x')")" "one row per store per day"
refused "violates check" "$(as postgres '' "insert into schedule_rules (store, effective_from, rules) values ('dm','2026-10-01','[1]')")" "rules must be an object"
refused "violates check" "$(as postgres '' "insert into schedule_rules (store, effective_from, rules) values ('dm','2026-10-01', jsonb_build_object('x', repeat('a', 30000)))")" "and not enormous"

# A change of rules is a new row, so the past stays readable.
q -c "insert into schedule_rules (store, effective_from, rules, set_at) values ('dm','2026-01-01','{\"minPeople\":{\"sat\":8}}', now() + interval '1 second')" >/dev/null
expect '{"minPeople": {"sat": 8}}' "$(as authenticated $M "select rules from schedule_rules where store='dm' and effective_from <= '2026-09-30' order by effective_from desc, set_at desc limit 1")" "the latest save for a date wins"
expect 2 "$(as authenticated $M "select count(*) from schedule_rules where store='dm'")" "and the earlier one is still there"

# Deleting an account keeps the rules and drops the link to the person.
q -c "delete from auth.users where id = '$M'" >/dev/null 2>&1 || q -c "delete from public.profiles where id = '$M'; delete from auth.users where id = '$M'" >/dev/null
expect 2 "$(as postgres '' "select count(*) from schedule_rules where store='dm'")" "deleting the manager's account keeps the rules"
expect 0 "$(as postgres '' "select count(*) from schedule_rules where set_by = '$M'")" "and no row still names them"

# Safe to run again?
if q -f "$SQL" >/dev/null 2>&1; then fail "a second run should refuse (tables exist); the migration is run once"; else ok "a second run is refused, not silently doubled"; fi

echo
if [ "$fails" = 0 ]; then echo "All checks passed."; else echo "$fails check(s) failed."; exit 1; fi
