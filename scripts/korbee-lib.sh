#!/usr/bin/env bash
###############################################################################
# Shared library for korbee.app authorized black-box pentest section runners.
# Each section script sets OUT=<fragment file> then sources this lib.
###############################################################################
set -u

BASE="https://www.korbee.app"
APEX="https://korbee.app"
DOMAIN="korbee.app"
UA="korbee-authorized-pentest/1.0 (owner-consented; contact owner)"

: "${OUT:?set OUT to a fragment path before sourcing}"
TMP="/tmp/korbee/work"
FIND="/tmp/korbee/findings.tsv"
mkdir -p "$TMP"; touch "$FIND"
: > "$OUT"

# Short timeouts so no single section stalls the runner.
CT=6      # connect timeout
MT=12     # max total per request

emit(){ printf '%s\n' "$*" >> "$OUT"; }
sev(){ printf '%s\t%s\t%s\n' "$1" "$2" "$3" >> "$FIND"; }

# do_req METHOD URL DATA [extra curl args...]  -> $CODE, $TMP/h, $TMP/b
do_req(){
  local method="$1" url="$2" data="$3"; shift 3
  if [ -n "$data" ]; then
    CODE=$(curl -sS -k --connect-timeout "$CT" --max-time "$MT" -A "$UA" -X "$method" \
       -H 'Content-Type: application/json' --data "$data" \
       -D "$TMP/h" -o "$TMP/b" -w '%{http_code}' "$@" "$url" 2>"$TMP/err") || CODE="ERR"
  else
    CODE=$(curl -sS -k --connect-timeout "$CT" --max-time "$MT" -A "$UA" -X "$method" \
       -D "$TMP/h" -o "$TMP/b" -w '%{http_code}' "$@" "$url" 2>"$TMP/err") || CODE="ERR"
  fi
}

emit_req(){ # method-and-url-string [data]
  emit '```http'
  emit "$1"
  if [ -n "${2:-}" ]; then emit "Content-Type: application/json"; emit ""; emit "$2"; fi
  emit '```'
}
emit_resp(){ # bytes
  local n="${1:-450}"
  emit '```'
  echo "HTTP status: $CODE" >> "$OUT"
  grep -iE '^(HTTP/|location:|set-cookie:|content-type:|access-control-allow|access-control-expose|www-authenticate:|allow:|x-frame-options|x-content-type|strict-transport|content-security-policy|referrer-policy|permissions-policy|x-vercel-(id|cache|error)|server:|cache-control:|retry-after:|x-ratelimit)' "$TMP/h" 2>/dev/null | tr -d '\r' | sed 's/^/  /' >> "$OUT"
  echo "  --- body (first ${n}B) ---" >> "$OUT"
  head -c "$n" "$TMP/b" 2>/dev/null | tr -d '\000' >> "$OUT"; echo >> "$OUT"
  emit '```'
}
