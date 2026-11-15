#!/usr/bin/env bash
# Checks the HTTPS setup of the live site from the outside: security headers,
# redirects, protocols and certificates.
#
#   bash scripts/check-tls.sh www.exoatlas.space
#
# Needs bash, curl and OpenSSL 3. GitHub Actions runs it once a month
# (.github/workflows/tls.yml); see docs/DEPLOYMENT.md, "TLS check".
#
# The TLS setup itself comes from Vercel, not from this code, so a push does
# not change it. What a push can change, the headers, is also checked by the
# smoke test after every deployment.
#
# It makes about a dozen requests. More, in a short time, can make Vercel's
# DDoS protection challenge the address the check runs from; the script then
# says so instead of reporting missing headers.

set -uo pipefail

host="${1:?usage: check-tls.sh <host>, for example www.exoatlas.space}"
apex="${host#www.}"
min_days="${MIN_CERT_DAYS:-21}"
failures=0

ok() { echo "ok    $*"; }
fail() {
  echo "FAIL  $*"
  # Shown as an error in the summary of a GitHub Actions run.
  if [ -n "${GITHUB_ACTIONS:-}" ]; then echo "::error::$*"; fi
  failures=$((failures + 1))
}

echo "Checking $host (apex $apex), certificates must be valid for $min_days more days"
echo

# 1. Security headers on the start page.
headers=$(curl -sS -D - -o /dev/null --max-time 30 "https://$host/" 2>&1 | tr -d '\r')
header() { grep -i "^$1:" <<<"$headers" | head -1; }
status=$(head -1 <<<"$headers")
if [ -n "$(header x-vercel-mitigated)" ]; then
  fail "Vercel's firewall challenged this check ($(header x-vercel-mitigated)); headers not checked. Run it again later."
elif ! grep -q " 200" <<<"$status"; then
  fail "https://$host/ did not answer 200: ${status:-no answer}"
else
  age=$(header strict-transport-security | grep -oiE 'max-age=[0-9]+' | cut -d= -f2)
  if [ -n "$age" ] && [ "$age" -ge 31536000 ]; then
    ok "header strict-transport-security (max-age $age)"
  else
    fail "HSTS is missing or shorter than one year: $(header strict-transport-security)"
  fi
  expect_header() {
    local line
    line=$(header "$1")
    if [ -z "$line" ]; then
      fail "header $1 is missing"
    elif ! grep -qi -- "$2" <<<"$line"; then
      fail "header $1 is not as expected: $line"
    else
      ok "header $1"
    fi
  }
  expect_header content-security-policy "default-src 'self'"
  expect_header x-frame-options "DENY"
  expect_header x-content-type-options "nosniff"
  expect_header referrer-policy "strict-origin"
  expect_header permissions-policy "camera=()"
fi

# 2. Every way in ends on https://<host>/ with status 200.
for start in "http://$host/" "http://$apex/" "https://$apex/"; do
  if [ "$start" = "https://$host/" ]; then continue; fi
  result=$(curl -sSL -o /dev/null -w '%{http_code} %{url_effective}' --max-redirs 5 --max-time 30 "$start" 2>&1)
  if [ "$result" = "200 https://$host/" ]; then
    ok "$start leads to https://$host/"
  else
    fail "$start should lead to https://$host/ with status 200, got: $result"
  fi
done

# 3. Protocols. A handshake counts only when it agreed on a cipher: OpenSSL
# also prints the attempted protocol when the server refuses it.
# SECLEVEL=0 lets OpenSSL 3 still offer TLS 1.0 and 1.1, so that refusing
# them is the server's decision, not ours.
handshake() {
  echo | timeout 30 openssl s_client -connect "$host:443" -servername "$host" "-$1" \
    -cipher 'DEFAULT:@SECLEVEL=0' 2>&1
}
accepted() { grep -q "Cipher is " <<<"$1" && ! grep -q "Cipher is (NONE)" <<<"$1"; }
for version in tls1_2 tls1_3; do
  if accepted "$(handshake "$version")"; then
    ok "${version/_/.} is accepted"
  else
    fail "${version/_/.} is not accepted"
  fi
done
for version in tls1 tls1_1; do
  out=$(handshake "$version")
  if accepted "$out"; then
    fail "${version/_/.} is still accepted"
  elif grep -qiE "alert protocol version|unsupported protocol|wrong version number|handshake failure" <<<"$out"; then
    ok "${version/_/.} is refused"
  else
    fail "${version/_/.} could not be tested: $(grep -iE 'error|alert' <<<"$out" | head -1)"
  fi
done

# 4. Certificates: trusted, for the right name, valid long enough.
for name in $(printf '%s\n' "$host" "$apex" | sort -u); do
  cert=$(echo | timeout 30 openssl s_client -connect "$name:443" -servername "$name" -verify_return_error 2>/dev/null |
    openssl x509 2>/dev/null)
  if [ -z "$cert" ]; then
    fail "$name has no certificate that a browser would trust"
    continue
  fi
  end=$(openssl x509 -noout -enddate <<<"$cert" | cut -d= -f2)
  if ! openssl x509 -noout -checkhost "$name" <<<"$cert" | grep -q "does match"; then
    fail "the certificate of $name is not issued for $name"
  elif openssl x509 -noout -checkend $((min_days * 86400)) <<<"$cert" >/dev/null; then
    ok "certificate of $name is valid until $end"
  else
    fail "the certificate of $name expires within $min_days days ($end)"
  fi
done

echo
if [ "$failures" -gt 0 ]; then
  echo "$failures check(s) failed."
  exit 1
fi
echo "All checks passed."
