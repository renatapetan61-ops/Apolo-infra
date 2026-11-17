#!/usr/bin/env bash
set -Eeuo pipefail
IMAGE="apolo-infra-hello:${GITHUB_SHA:-local}"
NAME="apolo-infra-hello-${GITHUB_RUN_ID:-local}"
cleanup(){ docker rm -f "$NAME" >/dev/null 2>&1 || true; docker image rm "$IMAGE" >/dev/null 2>&1 || true; }
trap cleanup EXIT
docker build -t "$IMAGE" examples/hello
docker run -d --name "$NAME" -p 127.0.0.1:18080:80 "$IMAGE"
for _ in $(seq 1 30); do
  if curl --fail --silent http://127.0.0.1:18080/ | grep -q "APOLO INFRA"; then
    echo "Real Docker deployment passed on 127.0.0.1:18080"
    exit 0
  fi
  sleep 1
done
docker logs "$NAME"
echo "Container did not serve the expected page" >&2
exit 1
