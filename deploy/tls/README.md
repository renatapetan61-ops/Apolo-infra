# Local HTTPS certificates

The `internal/tls` package invokes mkcert to create a host-local certificate
and key. Trust installation is opt-in. Installing a local CA affects the host
trust store and must be an explicit administrator action. Android clients and
other devices do not automatically trust this CA; export and install the root
CA through the operating system's supported trust flow when appropriate.

Never expose generated private keys through the API or commit them to Git.
