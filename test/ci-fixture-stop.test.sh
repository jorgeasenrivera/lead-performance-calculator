#!/usr/bin/env bash
# Pure synthetic tests for the stop path of ci-fixture.sh.
#   usage: bash test-ci-fixture-stop.sh <path to the ci-fixture.sh under test> <new, non-existing work directory>
# What it does: reads the function section of the script as TEXT (everything before the top-level `case`), evaluates only
# those definitions, then REPLACES every primitive that could touch a process or /proc (probe_signal, probe_state,
# probe_absent, owned, send_signal, pause) and the node call with stubs that answer from a fixed sequence and write a log.
# What it never does: send a signal, read /proc, start a process, sleep, open a port, start a browser or the network.
# The only files it writes are small pid files under the new work directory it creates itself; nothing is deleted.
set -u
SCRIPT="${1:?path to ci-fixture.sh}"
BASE="${2:?new work directory}"
mkdir "$BASE" || { echo "work directory already exists or cannot be made: $BASE" >&2; exit 2; }

text="$(sed -n '1,/^case "/p' "$SCRIPT" | sed '$d')"
case "$text" in *"stop_owned()"*) ;; *) echo "function section not found in $SCRIPT" >&2; exit 2 ;; esac
eval "$text"
set +e

PASS=0; FAIL=0
declare -A IDX=()

pop() { # pop <queue>: value into REPLY; the last value of a queue repeats
  eval "local n=\${#Q_$1[@]}"
  if [ "$n" -eq 0 ]; then REPLY=""; LOG+=("pop-empty:$1"); return 0; fi
  local i="${IDX[$1]:-0}"
  [ "$i" -lt "$n" ] || i=$((n - 1))
  eval "REPLY=\${Q_$1[$i]}"
  IDX[$1]=$(( ${IDX[$1]:-0} + 1 ))
}
probe_signal() { pop sig; LOG+=("sig0"); [ "$REPLY" = ok ]; }
probe_state() { pop state; if [ "$REPLY" = "-" ]; then STATE=""; else STATE="$REPLY"; fi; LOG+=("state:$STATE"); }
probe_absent() { pop absent; LOG+=("absent"); [ "$REPLY" = yes ]; }
owned() { pop owned; LOG+=("owned"); [ "$REPLY" = yes ]; }
send_signal() { LOG+=("send:$1"); }
pause() { LOG+=("pause"); }
fake_node() { pop ports; LOG+=("ports"); [ "$REPLY" = free ]; }

finish() { local rc="$1"; local IFS=,; printf 'RC=%s\n' "$rc"; printf 'LOG=%s\n' "${LOG[*]}"; }

# scenario <name> <pid file text or MISSING> <ticks> <queue=values>...
scenario() {
  local name="$1" pidfile="$2" ticks="$3"; shift 3
  local d="$BASE/$name"
  mkdir "$d"
  [ "$pidfile" = MISSING ] || printf '%b' "$pidfile" > "$d/fixture.pid"
  OUT="$(
    (
      DIR="$d"; NODE=fake_node; STOP_TICKS="$ticks"
      LOG=(); IDX=()
      Q_sig=(); Q_state=(); Q_absent=(); Q_owned=(); Q_ports=()
      for kv in "$@"; do eval "Q_${kv%%=*}=(${kv#*=})"; done
      set -e
      trap 'finish $?' EXIT
      stop_owned
    ) 2>&1
  )"
  RC="${OUT%LOG=*}"; RC="${RC##*RC=}"; RC="${RC//$'\n'/}"
  LOGLINE="${OUT##*LOG=}"
}

ok() { PASS=$((PASS + 1)); printf 'ok   %s\n' "$1"; }
bad() { FAIL=$((FAIL + 1)); printf 'FAIL %s: %s\n' "$1" "$2"; printf '     output: %s\n' "${OUT//$'\n'/ | }"; }
# expect <name> <rc> <exact log> [message fragment that must appear] [text that must NOT appear in the log]
expect() {
  local name="$1" rc="$2" log="$3" msg="${4:-}" never="${5:-}"
  [ "$RC" = "$rc" ] || { bad "$name" "rc $RC, wanted $rc"; return; }
  [ "$LOGLINE" = "$log" ] || { bad "$name" "log '$LOGLINE', wanted '$log'"; return; }
  if [ -n "$msg" ]; then case "$OUT" in *"$msg"*) ;; *) bad "$name" "message '$msg' missing"; return ;; esac; fi
  if [ -n "$never" ]; then case ",$LOGLINE," in *",$never,"*) bad "$name" "'$never' must not happen"; return ;; esac; fi
  ok "$name"
}

P='4242\n9999\n/synthetic\n'
W='sig0,state:S,pause,sig0,state:S,pause,sig0,state:S'   # two waited ticks and the last sample, process still live

scenario normal "$P" 2 sig="ok ok" state="S Z" owned="yes" ports="free"
expect normal 0 "sig0,state:S,owned,send:TERM,sig0,state:Z,ports" "" "send:KILL"

# Live, TERM, then the wait sees it gone. The queues hold a reused pid and an unreadable status AFTER that point: if anything
# samples again, or re-checks identity, or escalates, the log differs.
scenario live-then-gone-then-trap "$P" 2 sig="ok fail ok ok" state="S - -" absent="yes no" owned="yes no" ports="free"
expect live-then-gone-then-trap 0 "sig0,state:S,owned,send:TERM,sig0,absent,ports" "" "send:KILL"

# Unreadable on the first sample while signalable: unknown, which is a failure. Nothing is signalled, no port check runs.
scenario unreadable-first "$P" 2 sig="ok ok" state="-" absent="no" owned="yes" ports="free"
expect unreadable-first 4 "sig0,state:,sig0" "cannot tell whether pid 4242" "send:TERM"

# Unreadable first because the process was reaped in between (the original race): now correctly gone, and ports decide.
scenario unreadable-reaped "$P" 2 sig="ok fail" state="-" absent="yes" owned="yes" ports="free"
expect unreadable-reaped 0 "sig0,state:,sig0,absent,ports" "" "send:TERM"

# Signal refused and /proc entry still present: unknown, not gone.
scenario refused-but-present "$P" 2 sig="fail" absent="no" owned="yes" ports="free"
expect refused-but-present 4 "sig0,absent" "cannot tell whether pid 4242" "ports"

# Unknown in the middle of the wait: stop, no KILL, no port check.
scenario unknown-mid-wait "$P" 2 sig="ok ok ok" state="S -" owned="yes" ports="free"
expect unknown-mid-wait 4 "sig0,state:S,owned,send:TERM,sig0,state:,sig0" "could not tell whether pid 4242 exited" "send:KILL"

# Stubborn live: TERM, waited, identity re-checked, KILL, waited, then the same failure. No port check hides it.
scenario stubborn "$P" 2 sig="ok" state="S" owned="yes yes" ports="busy"
expect stubborn 4 "sig0,state:S,owned,send:TERM,$W,owned,send:KILL,$W" "pid 4242 did not exit" "ports"

# Stubborn under TERM, gone after KILL.
scenario term-then-kill "$P" 2 sig="ok ok ok ok fail" state="S" absent="yes" owned="yes yes" ports="free"
expect term-then-kill 0 "sig0,state:S,owned,send:TERM,$W,owned,send:KILL,sig0,absent,ports"

# Identity changes while waiting (pid reused): no KILL, rc 3 stays the primary failure even though ports are busy.
scenario identity-changed "$P" 2 sig="ok" state="S" owned="yes no" ports="busy"
expect identity-changed 3 "sig0,state:S,owned,send:TERM,$W,owned" "changed identity before escalation" "send:KILL"

# Not the process we started, from the first look: untouched.
scenario not-owned "$P" 2 sig="ok" state="S" owned="no" ports="free"
expect not-owned 3 "sig0,state:S,owned" "is not the process that was started" "send:TERM"

# Already gone, port taken: the port check still decides.
scenario gone-ports-busy "$P" 2 sig="fail" absent="yes" ports="busy"
expect gone-ports-busy 4 "sig0,absent,ports" "a fixture port is not confirmed free"

# Live, exits on TERM, port still taken.
scenario term-ports-busy "$P" 2 sig="ok ok" state="S Z" owned="yes" ports="busy"
expect term-ports-busy 4 "sig0,state:S,owned,send:TERM,sig0,state:Z,ports" "a fixture port is not confirmed free" "send:KILL"

# Zombie on the first look counts as gone.
scenario zombie-first "$P" 2 sig="ok" state="Z" ports="free"
expect zombie-first 0 "sig0,state:Z,ports" "" "send:TERM"

scenario no-pid-file MISSING 2 ports="free"
expect no-pid-file 0 "" "nothing was started"

scenario malformed 'abc\n1\n/x\n' 2 ports="free"
expect malformed 3 "" "pid file is malformed"

# Production waits a fixed 25 ticks and has no environment control over it. The scenarios above override STOP_TICKS
# locally, after loading, for their synthetic sequences only.
for v in unset 7 0 abc; do
  if [ "$v" = unset ]; then got="$( (eval "$text"; printf '%s' "$STOP_TICKS") 2>&1 )"
  else got="$( (CI_FIXTURE_STOP_TICKS="$v"; eval "$text"; printf '%s' "$STOP_TICKS") 2>&1 )"; fi
  [ "$got" = 25 ] && ok "STOP_TICKS is 25 with CI_FIXTURE_STOP_TICKS $v" || { OUT="$got"; bad "STOP_TICKS with CI_FIXTURE_STOP_TICKS $v" "got '$got', wanted 25"; }
done
case "$text" in *CI_FIXTURE_STOP_TICKS*) bad "no environment surface" "the script text names CI_FIXTURE_STOP_TICKS" ;; *) ok "script text has no CI_FIXTURE_STOP_TICKS" ;; esac

printf '\n%s passed, %s failed\n' "$PASS" "$FAIL"
[ "$FAIL" -eq 0 ]
