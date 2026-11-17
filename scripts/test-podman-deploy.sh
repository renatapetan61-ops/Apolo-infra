#!/usr/bin/env bash
set -Eeuo pipefail
ENGINE="${CONTAINER_ENGINE:-podman}"
IMAGE="apolo-infra-hello:${GITHUB_SHA:-local}"
NAME="apolo-infra-podman-${GITHUB_RUN_ID:-local}"
cleanup(){ "$ENGINE" rm -f "$NAME" >/dev/null 2>&1 || true; "$ENGINE" image rm "$IMAGE" >/dev/null 2>&1 || true; }
trap cleanup EXIT
"$ENGINE" info
"$ENGINE" build -t "$IMAGE" examples/hello
"$ENGINE" run -d --name "$NAME" -p 127.0.0.1:18081:80 "$IMAGE"
for _ in $(seq 1 30); do
  if curl --fail --silent http://127.0.0.1:18081/ | grep -q "APOLO INFRA"; then
    echo "Real Podman deployment passed on 127.0.0.1:18081"
    exit 0
  fi
  sleep 1
done
"$ENGINE" logs "$NAME"
echo "Podman container did not serve the expected page" >&2
exit 1
