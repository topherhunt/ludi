#!/bin/bash
# Creates the self-signed "Ludi Signing" code signing certificate and imports it
# into your login keychain. Run once, yourself:   bash scripts/make-signing-cert.sh
#
# Why: macOS ties permission grants (Accessibility, which the media keys need) to
# the app's code signature. An ad-hoc signature changes with every build, so each
# update would lose them. Signed with this cert, every release keeps the same
# identity. No Apple developer account needed.
#
# Keep the key: releases signed by a different cert lose the grants once more.
# Back it up by exporting "Ludi Signing" from Keychain Access as a .p12.
#
# This writes to your login keychain, which is why it is not run automatically.
# To undo: delete "Ludi Signing" in Keychain Access.
set -euo pipefail

NAME="Ludi Signing"
PASS="ludi"  # only protects the temporary .p12 below
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

if security find-identity -p codesigning | grep -q "\"$NAME\""; then
  echo "!! a \"$NAME\" identity already exists; delete it in Keychain Access first if you really want a new one" >&2
  exit 1
fi

echo "==> generating self-signed code signing certificate"
openssl req -x509 -newkey rsa:2048 -keyout "$TMP/key.pem" -out "$TMP/cert.pem" \
  -days 7300 -nodes -subj "/CN=$NAME" \
  -addext "extendedKeyUsage=codeSigning" \
  -addext "basicConstraints=critical,CA:false" \
  -addext "keyUsage=critical,digitalSignature" 2>/dev/null

# Apple's Security framework rejects OpenSSL 3.x's default PKCS#12 MAC, so pin
# the legacy algorithms it can read.
openssl pkcs12 -export -out "$TMP/id.p12" -inkey "$TMP/key.pem" -in "$TMP/cert.pem" \
  -name "$NAME" -keypbe PBE-SHA1-3DES -certpbe PBE-SHA1-3DES -macalg sha1 \
  -passout "pass:$PASS"

echo "==> importing into login keychain (may prompt for your password)"
security import "$TMP/id.p12" -k ~/Library/Keychains/login.keychain-db \
  -P "$PASS" -T /usr/bin/codesign

echo "==> trusting it for code signing"
security add-trusted-cert -d -r trustRoot -p codeSign \
  -k ~/Library/Keychains/login.keychain-db "$TMP/cert.pem"

echo
security find-identity -v -p codesigning | grep "\"$NAME\""
