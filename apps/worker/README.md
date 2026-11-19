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

## Image catalog, source upload and automatic ports

The dashboard queries the public Docker Hub catalog and displays a recent compatible tag for each result. The selected reference is pulled by Docker or Podman on the Codespaces worker at create time; registry availability is therefore verified by the actual pull, not by the catalog alone.

You can select and upload a complete project folder directly from the dashboard (no ZIP/archive step; maximum 3 MB and 1,000 files). The selected folder must contain a Dockerfile at its root, or one of the supported layouts:
- Node.js: `package.json` with a `scripts.start` entry (and optional `package-lock.json`).
- Python ASGI: `requirements.txt` plus `main.py` or `app.py` exposing an ASGI variable named `app`.
- Static site: `index.html`.

The browser sends each file with its relative path; the API and worker validate paths, reconstruct the project tree in a temporary build context, and build an image. The worker detects the first TCP port declared with `EXPOSE` (fallback: 80 for common web server images, otherwise 8080), and asks the container runtime to allocate a free host port. The selected host port is then registered in Nginx. No container port is entered in the dashboard.

Folders above 3 MB or 1,000 files are currently rejected. A Git-based source integration is the next option for larger projects.