#!/usr/bin/env bash
# The candidate-branch backend for feel and shots (see checks.yml).
#   up       refuses unless a reviewed strict browser path is wired for CI_ENGINE; checks both ports are free;
#            makes the seed file, hashes it and the dist BEFORE the fixture starts; starts the fixture; checks the
#            listener is the process it started. Any failure after the start stops that process first.
#   collect  reads what the fixture says about itself. Does not stop anything.
#   stop     stops only the process `up` started (its PID, and only while its command line is the fixture's),
#            waits for it, and fails if either port is still taken. Idempotent. Safe to run in an always() step.
# None of them changes the exit status of the run they surround: callers keep that in their own variable.
set -euo pipefail
DIR="${CI_FIXTURE_DIR:-fixture-run}"
TICK="${CI_FIXTURE_TICK:-0.2}"
TICKS="${CI_FIXTURE_WAIT_TICKS:-100}"
NODE="${CI_FIXTURE_NODE:-node}"
ID_CMD="${CI_FIXTURE_ID_CMD:-id}"   # a stand-in for tests only; the workflow never sets it

STOP_TICKS=25   # fixed; not read from the environment

# Liveness has three answers, not two: live, gone, unknown. A zombie (exited, not yet reaped by a parent that is busy) is
# gone for our purposes. Unknown means we could not tell, and it is never read as gone: a status file that cannot be read
# is not the same as a process that is not a zombie. The probes below are the only places that touch /proc or signal 0.
probe_signal() { kill -0 "$1" 2>/dev/null; }
probe_state() {
  local l s=
  { while IFS= read -r l; do case "$l" in State:*) s="${l#State:}"; break ;; esac; done; } 2>/dev/null < "/proc/$1/status" || true
  s="${s#"${s%%[![:space:]]*}"}"
  STATE="${s:0:1}"
}
probe_absent() { [ -r /proc/self/status ] && [ ! -e "/proc/$1" ]; }
# Sets VERDICT to live, gone or unknown. No subshell, so a caller sees exactly one sample.
sample() {
  if probe_signal "$1"; then
    probe_state "$1"
    case "$STATE" in
      Z|X) VERDICT=gone ;;
      "") if probe_signal "$1"; then VERDICT=unknown; elif probe_absent "$1"; then VERDICT=gone; else VERDICT=unknown; fi ;;
      *) VERDICT=live ;;
    esac
  elif probe_absent "$1"; then VERDICT=gone
  else VERDICT=unknown; fi
}
alive() { sample "$1"; [ "$VERDICT" = live ]; }
send_signal() { kill -"$1" "$2" 2>/dev/null || true; }
pause() { sleep "$TICK"; }
# Waits a bounded number of ticks for the process to be gone. 0 gone, 1 still live, 2 unknown. The last sample taken here
# is the answer: nothing samples again afterwards, so a later reused or unreadable pid cannot contradict it.
wait_gone() {
  local i
  for ((i = 0; i < STOP_TICKS; i++)); do
    sample "$1"
    case "$VERDICT" in gone) return 0 ;; unknown) return 2 ;; esac
    pause
  done
  sample "$1"
  case "$VERDICT" in gone) return 0 ;; unknown) return 2 ;; *) return 1 ;; esac
}
# Start time (clock ticks since boot, field 22 of /proc/PID/stat, read after the last ")" because the name may hold spaces) and working directory.
starttime() { sed 's/^.*) //' "/proc/$1/stat" 2>/dev/null | awk '{print $20}'; }
workdir() { readlink "/proc/$1/cwd" 2>/dev/null; }
# The process is the one `up` started: same start time, same directory, and the fixture's command line.
owned() {
  [ -r "/proc/$1/cmdline" ] && tr '\0' ' ' < "/proc/$1/cmdline" | grep -q 'shots-fixture\.mjs' || return 1
  [ "$(starttime "$1")" = "$2" ] && [ "$(workdir "$1")" = "$3" ]
}
# What went wrong at start-up, as one fixed word. The log itself is never printed.
reason() {
  local f="$DIR/fixture.log"
  if [ ! -s "$f" ]; then echo no-output
  elif grep -q 'EADDRINUSE' "$f"; then echo port-in-use
  elif grep -q 'cannot be pinned' "$f"; then echo dist-refused
  elif grep -qi 'room module' "$f"; then echo room-modules-refused
  elif grep -qi 'seed' "$f"; then echo seed-refused
  else echo other; fi
}

stop_owned() {
  [ -f "$DIR/fixture.pid" ] || { echo "ci-fixture: nothing was started" >&2; return 0; }
  local pid st cwd r
  { read -r pid; read -r st; read -r cwd; } < "$DIR/fixture.pid" || true
  [[ "$pid" =~ ^[0-9]+$ ]] && [[ "$st" =~ ^[0-9]+$ ]] && [ -n "$cwd" ] || { echo "ci-fixture: pid file is malformed" >&2; return 3; }
  sample "$pid"
  case "$VERDICT" in
    unknown) echo "ci-fixture: cannot tell whether pid $pid is still running; that is a failure, not a pass" >&2; return 4 ;;
    live)
      owned "$pid" "$st" "$cwd" || { echo "ci-fixture: pid $pid is not the process that was started; not touching it" >&2; return 3; }
      send_signal TERM "$pid"
      wait_gone "$pid" && r=0 || r=$?
      if [ "$r" = 1 ]; then
        # The pid may have been reused while we waited: the same identity check, immediately before the harder signal.
        owned "$pid" "$st" "$cwd" || { echo "ci-fixture: pid $pid changed identity before escalation; not touching it" >&2; return 3; }
        send_signal KILL "$pid"
        wait_gone "$pid" && r=0 || r=$?
      fi
      case "$r" in
        0) ;;
        2) echo "ci-fixture: could not tell whether pid $pid exited; that is a failure, not a pass" >&2; return 4 ;;
        *) echo "ci-fixture: pid $pid did not exit" >&2; return 4 ;;
      esac ;;
  esac
  "$NODE" scripts/shots-fixture-verdict.mjs ports-free 5433 5178 || { echo "ci-fixture: a fixture port is not confirmed free after stop" >&2; return 4; }
}

case "${1:-}" in
  up)
    case "${CI_ENGINE:-}" in
      chromium)
        # Before the adapter or any launch: a non-root user, and no root-helper route. Not inferred from the VM.
        # The exit status is taken first: output from a command that then failed is not a uid.
        if ! UID_NOW="$("$ID_CMD" -u 2>/dev/null)"; then echo "ci-fixture: could not read the uid; refusing before the adapter or any launch." >&2; exit 5; fi
        { [[ "$UID_NOW" =~ ^[0-9]+$ ]] && [ "$UID_NOW" -gt 0 ] && [ -z "${STRICT_BROWSER_RUN_AS:-}" ]; } || { echo "ci-fixture: the strict Chromium path needs a non-root user and no STRICT_BROWSER_RUN_AS; refusing before the adapter or any launch." >&2; exit 5; }
        [ -n "${FEEL_PLAYWRIGHT:-}" ] && [ -n "${ADAPTER_KIT:-}" ] || { echo "ci-fixture: no reviewed strict adapter is wired for Chromium (FEEL_PLAYWRIGHT, ADAPTER_KIT); refusing. Root with the sandbox off is not accepted." >&2; exit 5; }
        "$NODE" scripts/shots-fixture-verdict.mjs adapter-check "$FEEL_PLAYWRIGHT" "$ADAPTER_KIT" || { echo "ci-fixture: the strict adapter, kit or pins are not the reviewed ones; refusing." >&2; exit 5; } ;;
      webkit) echo "ci-fixture: WebKit has no reviewed fail-closed path for this candidate. This is not a pass and not a skip." >&2; exit 5 ;;
      *) echo "ci-fixture: CI_ENGINE must be chromium or webkit" >&2; exit 2 ;;
    esac
    mkdir -p "$DIR"
    "$NODE" scripts/shots-fixture-verdict.mjs ports-free 5433 5178 || { echo "ci-fixture: a fixture port is not confirmed free; not starting" >&2; exit 6; }
    # Pins that do not come from the fixture process: written before it exists.
    SEED_SHA=$(SEED_FILE="$DIR/seed.json" "$NODE" --input-type=module -e '
      import { loadOrCreateSeed } from "./scripts/shots-fixture.mjs";
      const r = loadOrCreateSeed(process.env.SEED_FILE, { managerActor: true });
      if (!r.created) throw new Error("seed file already existed");
      process.stdout.write(r.sha256);')
    "$NODE" scripts/shots-fixture-verdict.mjs pins "$DIR" dist "$SEED_SHA"
    SHOTS_FIXTURE_MODE=compatible SHOTS_DIST=dist SHOTS_FIXTURE_API=on SHOTS_ROOM_MODULES_DIR=api \
      SHOTS_FIXTURE_MANAGER_ACTOR=1 SHOTS_FIXTURE_NORMALIZE_SEED_IDENTITY=1 \
      SHOTS_FIXTURE_SEED_FILE="$DIR/seed.json" SHOTS_FIXTURE_SEED_SHA256="$SEED_SHA" \
      "$NODE" scripts/shots-fixture.mjs > "$DIR/fixture.log" 2>&1 &
    PID=$!
    printf '%s\n%s\n%s\n' "$PID" "$(starttime "$PID")" "$(workdir "$PID")" > "$DIR/fixture.pid"
    fail_up() { echo "ci-fixture: start-up failed ($1); the log is not printed" >&2; stop_owned || true; exit 1; }
    for _ in $(seq 1 "$TICKS"); do
      alive "$PID" || fail_up "$(reason)"
      if grep -q '"fixture":true' "$DIR/fixture.log"; then
        grep -q "\"pid\":$PID[,}]" "$DIR/fixture.log" || fail_up "start-line-pid-mismatch"
        if curl -sf http://127.0.0.1:5433/rest/v1/ > /dev/null && curl -sf http://127.0.0.1:5178/ > /dev/null; then
          "$NODE" scripts/shots-fixture-verdict.mjs listeners "$PID" 5433 5178 || fail_up "listener-not-owned"
          exit 0
        fi
      fi
      sleep "$TICK"
    done
    fail_up "did-not-come-up" ;;
  collect)
    curl -sf --max-time 5 http://127.0.0.1:5178/__fixture/report -o "$DIR/fixture-report.json" || echo "fixture report unreachable" >&2
    curl -sf --max-time 5 http://127.0.0.1:5178/__fixture/expected -o "$DIR/fixture-expected.json" || echo "fixture expected unreachable" >&2
    head -n 1 "$DIR/fixture.log" > "$DIR/fixture-start.json" 2>/dev/null || true ;;
  stop) stop_owned ;;
  *) echo "usage: ci-fixture.sh up|collect|stop" >&2; exit 2 ;;
esac
