# Build the Rust service.
FROM rust:1.85-bookworm AS rust-build
WORKDIR /src/rust
COPY services/rust/Cargo.toml ./
COPY services/rust/src ./src
RUN cargo build --release

# Build the Go gateway (also exposes the Go service).
FROM golang:1.24-bookworm AS go-build
WORKDIR /src/go
COPY services/go/go.mod ./
COPY services/go/main.go ./
RUN CGO_ENABLED=0 GOOS=linux go build -trimpath -ldflags="-s -w" -o /out/apolo-gateway .

# Runtime: Python + Ruby + the compiled Rust and Go services.
FROM python:3.12-slim
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends ruby ruby-webrick supervisor ca-certificates \
    && rm -rf /var/lib/apt/lists/*
COPY services/python/requirements.txt /app/python/requirements.txt
RUN pip install --no-cache-dir -r /app/python/requirements.txt
COPY services/python/main.py /app/python/main.py
COPY services/ruby/main.rb /app/ruby/main.rb
COPY --from=rust-build /src/rust/target/release/polyglot-rust /usr/local/bin/polyglot-rust
COPY --from=go-build /out/apolo-gateway /usr/local/bin/apolo-gateway
COPY deploy/supervisord.conf /etc/supervisor/conf.d/apolo.conf
EXPOSE 8080
HEALTHCHECK --interval=15s --timeout=3s --start-period=30s --retries=5 CMD python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8080/healthz', timeout=2)"
ENTRYPOINT ["/usr/bin/supervisord", "-n", "-c", "/etc/supervisor/supervisord.conf"]
