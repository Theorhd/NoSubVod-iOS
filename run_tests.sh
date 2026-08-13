#!/bin/bash
set -euo pipefail

cd "$(dirname "$0")"

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  NoSubVod - Test Runner (headless)"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

# ── Inject secrets (placeholders si pas de .env) ──────────────────
echo "→ Injecting secrets (AppSecrets.swift)..."
scripts/generate_secrets.sh --allow-placeholders

# ── Generate project ──────────────────────────────────────────────
echo ""
echo "→ Generating Xcode project with XcodeGen..."
xcodegen generate

# ── Simulateur headless ───────────────────────────────────────────
# On boote UN simulateur via `simctl` — jamais de Simulator.app, aucune
# UI, aucun coût graphique. On l'arrête systématiquement en sortie
# (trap) pour ne laisser aucune ressource occupée.
echo ""
echo "→ Shutting down running simulators (freeing resources)..."
xcrun simctl shutdown all 2>/dev/null || true

echo "→ Looking for an available iPhone simulator..."
SIM_UDID=$(xcrun simctl list devices available \
    | grep -i "iphone" \
    | grep -oE "[0-9A-Fa-f]{8}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{12}" \
    | head -1 || true)

if [ -z "$SIM_UDID" ]; then
    echo "❌ No iPhone simulator available."
    exit 1
fi

SIM_NAME=$(xcrun simctl list devices | grep "$SIM_UDID" | sed -E 's/^[[:space:]]*(.*) \('$SIM_UDID'\) \(.*\)/\1/')
echo "   Using: $SIM_NAME ($SIM_UDID)"

xcrun simctl boot "$SIM_UDID" 2>/dev/null || true
xcrun simctl bootstatus "$SIM_UDID" -b >/dev/null
echo "   ✓ Simulator booted (headless, no UI)"

# On arrête toujours le simulateur en quittant le script.
trap 'xcrun simctl shutdown "$SIM_UDID" 2>/dev/null || true' EXIT

DESTINATION="platform=iOS Simulator,id=$SIM_UDID"

# ── Build for testing ─────────────────────────────────────────────
echo ""
echo "→ Building tests..."
if xcodebuild build-for-testing \
    -project NoSubVod.xcodeproj \
    -scheme NoSubVod \
    -destination "$DESTINATION" \
    -parallel-testing-enabled NO \
    2>&1 | tail -5; then
    echo "   ✓ Build succeeded"
else
    echo "   ❌ Build failed"
    exit 1
fi

# ── Run tests (sans recompiler) ───────────────────────────────────
echo ""
echo "→ Running tests..."
echo ""

LOG_FILE="/tmp/nsv_tests_$$.log"
xcodebuild test-without-building \
    -project NoSubVod.xcodeproj \
    -scheme NoSubVod \
    -destination "$DESTINATION" \
    -parallel-testing-enabled NO \
    > "$LOG_FILE" 2>&1 || true

# ── Résumé ────────────────────────────────────────────────────────
if grep -qE "Test Case .* failed" "$LOG_FILE"; then
    echo "❌ Tests failed:"
    grep -E "Test Case .* failed" "$LOG_FILE"
    echo "   Full log: $LOG_FILE"
    exit 1
fi

# test-without-building imprime "TEST EXECUTE SUCCEEDED"; les deux formes sont acceptées.
if grep -qE "TEST (EXECUTE )?SUCCEEDED" "$LOG_FILE"; then
    grep -E "Executed [0-9]+ tests" "$LOG_FILE" | tail -1
    echo "   ✓ All tests passed"
else
    echo "❌ Tests did not complete — see full log: $LOG_FILE"
    exit 1
fi

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
