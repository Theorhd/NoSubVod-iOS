#!/usr/bin/env python3
"""
Génère et met à jour le fichier apps.json pour SideStore / LiveContainer / AltStore
à partir des releases du dépôt GitHub.
"""

import os
import sys
import json
import ssl
import urllib.request

REPO_OWNER = "Theorhd"
REPO_NAME = "NoSubVod-iOS"
OUTPUT_FILE = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "apps.json")

def fetch_github_releases():
    url = f"https://api.github.com/repos/{REPO_OWNER}/{REPO_NAME}/releases"
    req = urllib.request.Request(url)
    req.add_header("Accept", "application/vnd.github+json")
    req.add_header("User-Agent", "NoSubVod-SourceGenerator")

    token = os.environ.get("GITHUB_TOKEN")
    if token:
        req.add_header("Authorization", f"Bearer {token}")

    ctx = ssl.create_default_context()
    try:
        with urllib.request.urlopen(req, context=ctx) as response:
            if response.status == 200:
                data = response.read().decode("utf-8")
                return json.loads(data)
    except Exception:
        try:
            unverified_ctx = ssl._create_unverified_context()
            with urllib.request.urlopen(req, context=unverified_ctx) as response:
                if response.status == 200:
                    data = response.read().decode("utf-8")
                    return json.loads(data)
        except Exception as e:
            print(f"⚠️ Warning: Impossible de contacter l'API GitHub: {e}", file=sys.stderr)

    return []

def build_source_json(releases):
    versions = []

    for rel in releases:
        if rel.get("draft", False):
            continue

        tag_name = rel.get("tag_name", "1.0.0")
        clean_version = tag_name.lstrip("vV").strip()
        pub_date = rel.get("published_at", "2026-08-13T00:00:00Z")
        body = rel.get("body") or f"Release NoSubVod {clean_version}"

        # Cherche un asset .ipa
        ipa_url = f"https://github.com/{REPO_OWNER}/{REPO_NAME}/releases/download/{tag_name}/NoSubVod.ipa"
        ipa_size = 15000000

        for asset in rel.get("assets", []):
            name = asset.get("name", "")
            if name.endswith(".ipa"):
                ipa_url = asset.get("browser_download_url", ipa_url)
                ipa_size = asset.get("size", ipa_size)
                break

        versions.append({
            "version": clean_version,
            "date": pub_date,
            "localizedDescription": body,
            "downloadURL": ipa_url,
            "size": ipa_size,
            "minOSVersion": "17.0"
        })

    # Si aucune release GitHub (ex: hors ligne), version fallback
    if not versions:
        versions.append({
            "version": "1.2.0",
            "date": "2026-08-13T10:00:00Z",
            "localizedDescription": "Release NoSubVod 1.2.0",
            "downloadURL": f"https://github.com/{REPO_OWNER}/{REPO_NAME}/releases/download/v1.2.0/NoSubVod.ipa",
            "size": 15400000,
            "minOSVersion": "17.0"
        })

    icon_url = f"https://raw.githubusercontent.com/{REPO_OWNER}/{REPO_NAME}/main/NoSubVod-iOS/Sources/Assets.xcassets/AppIcon.appiconset/icon.png"

    source_data = {
        "name": "NoSubVod Source",
        "identifier": f"com.{REPO_OWNER.lower()}.nosubvod.source",
        "subtitle": "Client iOS natif Twitch sans pub",
        "description": "Source officielle NoSubVod pour SideStore, LiveContainer et AltStore.",
        "iconURL": icon_url,
        "website": f"https://github.com/{REPO_OWNER}/{REPO_NAME}",
        "apps": [
            {
                "name": "NoSubVod",
                "bundleIdentifier": f"com.{REPO_OWNER.lower()}.NoSubVod",
                "developerName": REPO_OWNER,
                "subtitle": "Lecteur Twitch VOD & Live",
                "localizedDescription": "Regardez des lives et VODs Twitch sans publicités avec support PiP, chat et téléchargement hors-ligne.",
                "iconURL": icon_url,
                "tintColor": "9146FF",
                "versions": versions
            }
        ]
    }

    return source_data

def main():
    print(f"🔄 Interrogation des releases GitHub pour {REPO_OWNER}/{REPO_NAME}...")
    releases = fetch_github_releases()
    print(f"📦 {len(releases)} release(s) trouvée(s). Génération de apps.json...")

    source_json = build_source_json(releases)

    output_path = OUTPUT_FILE
    if len(sys.argv) > 1:
        output_path = sys.argv[1]

    with open(output_path, "w", encoding="utf-8") as f:
        json.dump(source_json, f, indent=2, ensure_ascii=False)

    print(f"✅ Fichier apps.json généré avec succès dans : {output_path}")

if __name__ == "__main__":
    main()
