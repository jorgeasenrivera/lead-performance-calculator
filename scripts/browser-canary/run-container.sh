#!/usr/bin/env bash
set -euo pipefail
image='mcr.microsoft.com/playwright@sha256:bc6ab0d6d44ff4826e4cb8c1e6d801e185bfc42bb0753f8e2a30efc70db054c7'
: "${CANARY_STAGE:?}" "${CANARY_INPUT:?}"
docker pull --platform linux/amd64 "$image"
test "$(docker image inspect "$image" --format '{{.Os}}/{{.Architecture}}')" = linux/amd64
mkdir -p "$CANARY_STAGE/evidence"
chmod 0777 "$CANARY_STAGE/evidence"
docker image inspect "$image" --format '{{json .RepoDigests}}' > "$CANARY_STAGE/evidence/image-digests.json"
uname -sr > "$CANARY_STAGE/evidence/host-kernel.txt"
# Only synthetic tooling/dependencies and the verified runtime enter the container.
# No host home, Git checkout, credentials, socket, host network or host PID namespace.
id=$(docker create --platform linux/amd64 --network none --user pwuser --init --read-only --cap-drop ALL \
 --security-opt "seccomp=$CANARY_INPUT/seccomp.json" --shm-size 256m \
 --tmpfs /tmp:rw,nosuid,nodev,size=256m,mode=1777 \
 --mount "type=bind,src=$CANARY_INPUT,dst=/input,readonly" \
 --mount "type=bind,src=$CANARY_STAGE/node,dst=/node,readonly" \
 --mount "type=bind,src=$CANARY_STAGE/evidence,dst=/evidence" \
 --workdir /input --env HOME=/tmp --env PATH=/node/bin:/usr/bin:/bin \
 "$image" /node/bin/node /input/canary.mjs)
trap 'docker rm -f "$id" >/dev/null' EXIT
# Record effective isolation without dumping image environment or host state.
docker inspect "$id" --format '{{json .HostConfig.NetworkMode}} {{json .HostConfig.Privileged}} {{json .HostConfig.CapAdd}} {{json .HostConfig.SecurityOpt}} {{json .AppArmorProfile}}' > "$CANARY_STAGE/evidence/container-isolation.txt"
docker start --attach "$id"
code=$(docker inspect "$id" --format '{{.State.ExitCode}}')
test "$code" = 0
test -s "$CANARY_STAGE/evidence/result.json"
test -s "$CANARY_STAGE/evidence/synthetic-page.png"
