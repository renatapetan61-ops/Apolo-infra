# APOLO Polyglot Cloud

A single deployable cloud workload with four independent language services: Rust, Python, Go, and Ruby. It is designed for the APOLO INFRA dashboard's direct project-folder upload and Dockerfile build flow.

## Architecture

- **Rust**: Axum service on the private container network at `127.0.0.1:8101`.
- **Python**: FastAPI + Uvicorn on `127.0.0.1:8102`.
- **Ruby**: WEBrick service on `127.0.0.1:8103`.
- **Go**: public gateway on `:8080`, plus the Go API endpoint. It reverse-proxies the other language services.
- **Supervisor**: keeps the four processes running in one container.
- **Docker**: multi-stage build compiles Rust and Go, then assembles the runtime image.

The only public container port is 8080. The APOLO INFRA worker can allocate the host port automatically and route traffic through its Nginx gateway.

## Routes

| Route | Runtime |
|---|---|
| `/` | Service index |
| `/healthz` | Gateway health |
| `/rust` | Rust JSON service |
| `/python` | Python JSON service |
| `/go` | Go JSON service |
| `/ruby` | Ruby JSON service |

Each language service also exposes `/healthz` under its prefix.

## Build locally

```bash
docker build -t apolo-polyglot-cloud .
docker run --rm -p 8080:8080 apolo-polyglot-cloud
```

Then test:

```bash
curl http://localhost:8080/healthz
curl http://localhost:8080/rust
curl http://localhost:8080/python
curl http://localhost:8080/go
curl http://localhost:8080/ruby
```

## Deploy through APOLO INFRA

1. Open the APOLO INFRA dashboard and sign in.
2. Create a new infrastructure named `apolo-polyglot-cloud`.
3. Choose **Upload project folder** and select this `polyglot-cloud` folder.
4. The folder contains a root `Dockerfile`; the worker builds it and detects `EXPOSE 8080`.
5. Leave host port allocation automatic. The worker binds the allocated host port to loopback and installs the Nginx route.
6. Open the generated public URL and verify all five routes.

The dashboard currently limits direct folder uploads to 3 MB and 1,000 files. The first build downloads the Rust, Go, Python, and Debian dependencies, so allow several minutes. The Codespaces worker must be active during build and while the application is hosted.

## Operational note

This example runs four processes in one container so it fits the current single-container deployment model. It is a working starter workload, not a claim that APOLO INFRA already supports multi-container Compose orchestration. For durable production hosting, the worker host must remain online; a stopped or expired Codespace stops serving the workload.
