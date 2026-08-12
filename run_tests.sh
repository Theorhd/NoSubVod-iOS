#!/bin/bash
set -euo pipefail

cd "$(dirname "$0")"

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  NoSubVod - Test Runner"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

# ── Inject secrets (placeholders si pas de .env) ──────────────────
echo "→ Injecting secrets (AppSecrets.swift)..."
scripts/generate_secrets.sh --allow-placeholders

# ── Generate project ──────────────────────────────────────────────
echo ""
echo "→ Generating Xcode project with XcodeGen..."
xcodegen generate

# ── Find available simulator ──────────────────────────────────────
echo ""
echo "→ Looking for available iOS simulator..."

# Priorité aux iPhone : ne démarre jamais un iPad quand un iPhone est ouvert.
pick_simulator() {
    xcodebuild -project NoSubVod.xcodeproj -scheme NoSubVod -showdestinations 2>&1 \
        | grep "platform:iOS Simulator" \
        | grep -v "placeholder" \
        | grep -i "$1" \
        | head -1 \
        | sed -E 's/.*name:([^}]+).*/\1/' \
        | xargs
}

SIMULATOR=$(pick_simulator "iphone")
if [ -z "$SIMULATOR" ]; then
    echo "   Aucun iPhone trouvé — fallback sur n'importe quel simulateur..."
    SIMULATOR=$(pick_simulator "ios")
fi

if [ -z "$SIMULATOR" ]; then
    echo "❌ No iOS Simulator found. Using 'Any iOS Simulator Device' as fallback."
    DESTINATION="platform=iOS Simulator,name=iPhone 17"
else
    echo "   Using: $SIMULATOR"
    DESTINATION="platform=iOS Simulator,name=$SIMULATOR"
fi

# ── Build for testing ─────────────────────────────────────────────
echo ""
echo "→ Building tests..."
if xcodebuild build-for-testing \
    -project NoSubVod.xcodeproj \
    -scheme NoSubVod \
    -destination "$DESTINATION" \
    2>&1 | tail -5; then
    echo "   ✓ Build succeeded"
else
    echo "   ❌ Build failed"
    exit 1
fi

# ── Run tests ─────────────────────────────────────────────────────
echo ""
echo "→ Running tests..."
echo ""

xcodebuild test \
    -project NoSubVod.xcodeproj \
    -scheme NoSubVod \
    -destination "$DESTINATION" \
    2>&1 | grep -E "Test Suite|Test Case.*passed|Test Case.*failed|Executed [0-9]+ tests|TEST SUCCEEDED|TEST FAILED|BUILD" || true

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
