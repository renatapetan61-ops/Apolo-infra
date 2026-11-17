# Nginx reverse proxy

The Go package `internal/proxy` writes one site file atomically and exposes
`ValidateAndReload`, which runs `nginx -t` before `nginx -s reload`.
Configure `ConfigDir` to a directory included by the host's nginx.conf.
Do not point this at the global configuration directory until permissions,
ownership and backup/rollback policy are configured.

The daemon does not currently expose Nginx changes over its HTTP API. This
keeps privileged host configuration out of an unauthenticated local endpoint.
