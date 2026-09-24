#!/bin/bash
# Proves Sage's SFTP server works, from outside, as a vendor would meet it
# (C96). Run by the workflow against a new server, and against a local sshd
# with the same settings before any of it reached DigitalOcean.
#
#   check.sh HOST PORT CHECK_KEY SAGE_URL
#   SAGE_SECRET in the environment, never on the command line.
#
# Every line it prints is one fact, "ok" or "FAIL", and it exits non-zero if
# any failed.
set -uo pipefail
HOST=$1 PORT=$2 KEY=$3 SAGE_URL=$4
fails=0
ok()   { echo "ok    $*"; }
fail() { echo "FAIL  $*"; fails=$((fails+1)); }
SSH_OPTS=(-p "$PORT" -o StrictHostKeyChecking=accept-new -o UserKnownHostsFile=/tmp/sage-check-known -o ConnectTimeout=15 -o BatchMode=yes)
SFTP_OPTS=(-P "$PORT" -o StrictHostKeyChecking=accept-new -o UserKnownHostsFile=/tmp/sage-check-known -o ConnectTimeout=15 -o BatchMode=yes)

# 1. Passwords are not offered at all, only keys.
out=$(ssh "${SSH_OPTS[@]}" -o PubkeyAuthentication=no -o PreferredAuthentications=password,keyboard-interactive promptpath@"$HOST" true 2>&1)
if echo "$out" | grep -q "Permission denied (publickey)"; then ok "passwords are refused; only keys are accepted"
else fail "password sign-in was not refused as expected: $out"; fi

# 2. Nobody signs in as root, key or not.
out=$(ssh "${SSH_OPTS[@]}" -i "$KEY" root@"$HOST" true 2>&1)
if echo "$out" | grep -q "Permission denied"; then ok "root cannot sign in"; else fail "root sign-in was not refused: $out"; fi

# 3. The vendor's account without its key in the repository cannot sign in.
out=$(ssh "${SSH_OPTS[@]}" -i "$KEY" promptpath@"$HOST" true 2>&1)
if echo "$out" | grep -q "Permission denied"; then ok "promptpath refuses a key that is not theirs"; else fail "promptpath accepted the wrong key: $out"; fi

# 4. A signed-in account gets no shell.
out=$(ssh "${SSH_OPTS[@]}" -i "$KEY" sagecheck@"$HOST" 'echo SHELL-OPEN' 2>&1)
if echo "$out" | grep -q "SHELL-OPEN"; then fail "the check account got a shell"; else ok "no shell, SFTP only"; fi

# 5. Upload, and see nothing of the machine beyond the account's own folder.
probe=$(mktemp); printf 'Sage SFTP check %s %s\n' "$(date -u +%FT%TZ)" "$RANDOM$RANDOM" > "$probe"
name="sage-check-$(date -u +%Y%m%dT%H%M%SZ).txt"
# Batch sftp prints no progress, so success is its exit status and the file
# being there afterwards; and it lists the root as "/incoming".
out=$(sftp "${SFTP_OPTS[@]}" -i "$KEY" -b - sagecheck@"$HOST" 2>&1 <<EOF
put $probe incoming/$name
ls -1 incoming
ls -1 /
EOF
)
code=$?
if [ "$code" = 0 ] && echo "$out" | grep -q "incoming/$name"; then ok "a file uploads to incoming/"; else fail "upload failed ($code): $out"; fi
listing=$(echo "$out" | sed -n '/^sftp> ls -1 \/$/,$p' | tail -n +2 | tr -d ' ')
if [ "$listing" = "/incoming" ]; then ok "the account sees only its incoming folder"; else fail "the account sees more than incoming: $listing"; fi

# 6. It cannot write anywhere but incoming, or leave its folder.
out=$(sftp "${SFTP_OPTS[@]}" -i "$KEY" -b - sagecheck@"$HOST" 2>&1 <<EOF
-put $probe /escaped.txt
-cd /etc
-ls /etc
EOF
)
if echo "$out" | grep -Eqi "permission denied|failure"; then ok "nothing can be written outside incoming"; else fail "a write outside incoming was not refused: $out"; fi
if echo "$out" | grep -q "passwd"; then fail "the account can see /etc"; else ok "the rest of the machine is out of sight"; fi

# 7. Sage heard about the upload, end to end.
sha=$(sha256sum "$probe" | cut -d' ' -f1)
seen=""
for i in $(seq 1 24); do
  code=$(curl -sS -o /tmp/sage-check-arrival -w '%{http_code}' --max-time 15 -H "x-sage-sftp-secret: $SAGE_SECRET" "$SAGE_URL/api/sftp-arrival?sha256=$sha") || code=000
  if [ "$code" = 200 ]; then seen=1; break; fi
  sleep 5
done
if [ -n "$seen" ]; then ok "Sage recorded the file: $(cat /tmp/sage-check-arrival)"; else fail "Sage never recorded the file (last answer $code)"; fi

rm -f "$probe"
echo
if [ "$fails" = 0 ]; then echo "All checks passed."; else echo "$fails check(s) failed."; fi
exit "$fails"
