#!/usr/bin/env bash
set -Eeuo pipefail
command -v mkcert >/dev/null
command -v openssl >/dev/null
if [[ "${MKCERT_SKIP_INSTALL:-0}" != "1" ]]; then mkcert -install; fi
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
mkcert -cert-file "$TMP/apolo-infra.test.pem" -key-file "$TMP/apolo-infra.test-key.pem" apolo-infra.test
# Verify against the host OS CA directory (not mkcert's private CAROOT).
openssl verify -CApath /etc/ssl/certs -verify_hostname apolo-infra.test "$TMP/apolo-infra.test.pem"
echo "mkcert certificate is trusted by the host system CA store"
