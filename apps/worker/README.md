# APOLO INFRA Codespaces worker

This worker is a long-running process inside an active GitHub Codespace. It polls the Vercel control plane over HTTPS; the control plane never needs an inbound connection to the Codespace.

## Required Codespaces secrets

Configure these as repository or Codespaces secrets (do not commit values):

- `APOLO_CONTROL_URL`: deployed Vercel URL, e.g. `https://apolo-infra.vercel.app`.
- `APOLO_WORKER_TOKEN`: same random secret configured in Vercel.
- `APOLO_WORKER_ID`: stable name, e.g. `apolo-codespace-01`.

## Start

In the Codespace terminal:

```bash
npm --prefix apps/worker start
```

Keep the process running in a terminal or a process manager while the Codespace is active. Codespaces may stop due to inactivity or lifecycle limits; this is not a 24/7 production host.

The devcontainer installs Docker CLI/socket integration, Podman and Nginx. The worker prefers Docker when available, otherwise Podman. Application ports are bound to loopback. Nginx exposes each app under `/apps/<name>/` on port 8080; the worker returns the public Codespaces URL when `CODESPACE_NAME` is available.

## Supported worker operations

- create: pull image, create and start a container, return engine/container/port metadata.
- inspect: inspect a named container.
- delete: remove a container and its matching Nginx configuration.

Do not expose arbitrary shell commands through this worker. Only allow-listed operations and validated names/images/ports are accepted.