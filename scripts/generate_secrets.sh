#!/bin/bash
# Génère Sources/Secrets/AppSecrets.swift depuis .env.
# Le fichier généré est gitignoré et régénéré à chaque build — jamais commité.
#
# Usage:
#   scripts/generate_secrets.sh                 → exige TWITCH_CLIENT_ID (build IPA)
#   scripts/generate_secrets.sh --allow-placeholders → placeholders si .env absent (tests)
set -euo pipefail

cd "$(dirname "$0")/.."

ALLOW_PLACEHOLDERS="${1:-}"

# Charge .env s'il existe (secrets locaux, hors git)
if [ -f .env ]; then
    set -a
    # shellcheck disable=SC1091
    . ./.env
    set +a
fi

TWITCH_REDIRECT_URI="${TWITCH_REDIRECT_URI:-http://localhost:8142/oauth/callback}"
TWITCH_CLIENT_SECRET="${TWITCH_CLIENT_SECRET:-}"

if [ -z "${TWITCH_CLIENT_ID:-}" ]; then
    if [ "$ALLOW_PLACEHOLDERS" = "--allow-placeholders" ]; then
        TWITCH_CLIENT_ID=""
    else
        echo "❌ TWITCH_CLIENT_ID manquant (fichier .env absent ou client id vide)" >&2
        echo "   1. Crée une app sur https://dev.twitch.tv/console/apps" >&2
        echo "   2. Ajoute « nosubvod://auth » aux OAuth Redirect URLs" >&2
        echo "   3. Renseigne TWITCH_CLIENT_ID=<client-id> dans le fichier .env" >&2
        echo "      (modèle : .env.example)" >&2
        exit 1
    fi
fi

mkdir -p Sources/Secrets

# Échappe les valeurs pour une insertion sûre dans le Swift (guillemets, backslash).
escape_swift() {
    printf '%s' "$1" | sed 's/\\/\\\\/g; s/"/\\"/g'
}

CLIENT_ID_SWIFT="$(escape_swift "$TWITCH_CLIENT_ID")"
REDIRECT_SWIFT="$(escape_swift "$TWITCH_REDIRECT_URI")"
SECRET_SWIFT="$(escape_swift "$TWITCH_CLIENT_SECRET")"

cat > Sources/Secrets/AppSecrets.swift <<EOF
// Généré automatiquement par scripts/generate_secrets.sh — NE PAS COMMITER.
// Ce fichier contient des valeurs injectées au build depuis .env (gitignoré).
enum AppSecrets {
    static let twitchClientId: String = "$CLIENT_ID_SWIFT"
    static let twitchRedirectURI: String = "$REDIRECT_SWIFT"
    // Client Confidential uniquement : envoyé à l'échange de code OAuth.
    static let twitchClientSecret: String = "$SECRET_SWIFT"
}
EOF

if [ -n "$TWITCH_CLIENT_ID" ]; then
    echo "✓ AppSecrets.swift généré (client id: ${TWITCH_CLIENT_ID:0:8}…)"
else
    echo "⚠️  AppSecrets.swift généré avec des placeholders (pas de .env)"
fi
