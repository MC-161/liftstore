# tests/lib.sh -- shared grpcurl harness. Source it; don't execute it.
HOST=${HOST:-localhost:50051}
G=(grpcurl -plaintext -emit-defaults -import-path proto -proto engine.proto)

FAILED=0
TMP=$(mktemp)
trap 'rm -f "$TMP" "$TMP.err"' EXIT

call()   { "${G[@]}" -d "$2" "$HOST" "engine.v1.Engine/$1" >"$TMP" 2>"$TMP.err"; }

check() {   # $1 label, $2 jq predicate -- grades the MOST RECENT call
    if jq -e "$2" "$TMP" >/dev/null 2>&1; then
        printf '  PASS  %s\n' "$1"
    else
        printf '  FAIL  %s\n' "$1"
        printf '        got: %s\n' "$(jq -c . "$TMP" 2>/dev/null || cat "$TMP.err")"
        FAILED=$((FAILED + 1))
    fi
}

reject() {  # $1 label, $2 method, $3 payload -- expects INVALID_ARGUMENT
    if "${G[@]}" -d "$3" "$HOST" "engine.v1.Engine/$2" >/dev/null 2>"$TMP.err"; then
        printf '  FAIL  %s (accepted)\n' "$1"; FAILED=$((FAILED + 1))
    elif grep -q 'InvalidArgument' "$TMP.err"; then
        printf '  PASS  %s\n' "$1"
    else
        printf '  FAIL  %s (wrong status)\n' "$1"
        sed 's/^/        /' "$TMP.err"; FAILED=$((FAILED + 1))
    fi
}

summary() {
    echo
    if [ "$FAILED" -eq 0 ]; then echo "all passed"; else echo "$FAILED failed"; fi
    exit "$FAILED"
}