# 🚀 NoSubVOD iOS v0.3.7 - Pré-release

NoSubVOD iOS est le client mobile de NoSubVOD, basé sur Tauri v2 avec un backend Rust embarqué pour lire des VODs et des lives Twitch depuis une interface React adaptée au mobile.
NoSubVOD iOS est dérivé de NoSubVOD-Desktop. La version 0.3.7 de NSV iOS est le fruit d'un travail de refactorisation d'un code initialement prévu pour des machines Linux et Windows vers la plateforme iOS.

## 🆕 v0.3.7 — Auth Twitch, robustesse streaming et CI IPA fiabilisée

La version 0.3.7 se concentre sur la fiabilité, la stabilité du player/chat et la reproductibilité des builds iOS en CI.

### Points clés v0.3.7

- **Auth Twitch renforcée** : flux OAuth avec polling/popup et gestion de token plus robuste côté middleware.
- **Chat VOD stabilisé** : alignement sur la contrainte Twitch API (`first` entre `1` et `100`) pour éviter les erreurs de replay.
- **Streaming/serveur mobile** : normalisation des playlists HLS et ajustements d'URL serveur local.
- **Build IPA CI durci** : no-signing forcé, sélection Xcode résiliente et collecte d'artefact avec fallback.
- **Maintenance iOS** : suppression de plugins/dépendances Tauri inutilisés et nettoyage global du code.

Voir la note complète: [releasenotes/0.3.7.md](releasenotes/0.3.7.md)

---

## ✨ Fonctionnalités

### 🔓 VOD + Live Twitch

- Lecture des VODs via un proxy HLS du backend local.
- Lecture des lives via des endpoints API locaux.
- Navigation complète: Home, Live, Search, Trends, Channel, Player, Multi-View.

### 🎬 Expérience player

- Contrôles playback complets (play/pause, seek, volume, fullscreen selon contexte).
- Gestion de la qualité vidéo (Auto + sélection manuelle).
- Comportement optimisé pour un usage iPhone/iPad.

### 💬 Chat, historique et données

- Replay chat pour VOD.
- Historique de lecture avec reprise.
- Watchlist et données locales persistantes.

### 🖥️ Fonctionnalités LAN / pairing

- Backend local iOS accessible en HTTP `23400` et HTTPS `23401`.
- Mode pairé avec Desktop: découverte via `23456` et routage ciblé de certaines APIs (screen share/downloads).

### 🧩 Modules intégrés

- Screen Share.
- Downloads.
- Auth Twitch.

---

## 🧱 Stack technique

- **Shell mobile**: Tauri v2
- **Backend local**: Rust (`src-tauri/src/server`)
- **Frontend portal**: React + Vite + TypeScript (`src/portal`)
- **Code partagé**: TypeScript (`src/shared`)

---

## 📁 Architecture du repo

- `src/portal/` : interface web principale (mobile-first)
- `src/shared/` : types, hooks et utilitaires partagés
- `src-tauri/src/` : coeur Rust (serveur local, routes API, auth, history, download, screenshare)
- `src-tauri/tauri.conf.json` : configuration app/build Tauri

---

## 🛠 Développement

### Prérequis

- Node.js 20+
- Rust stable
- npm
- Xcode (pour build iOS local)

### Installation

```bash
npm ci
```

### Lancer en dev

```bash
npm run dev
```

Le portail tourne en HTTPS sur `https://localhost:5173` en mode dev.

### Qualité du code

```bash
npm run lint
npm run type-check
```

### Build iOS local

```bash
npm run build:portal
npx tauri ios init
npx tauri ios build --export-method debugging
```

---

## 🍎 IPA CI (unsigned)

Le workflow [.github/workflows/ios-ipa.yml](.github/workflows/ios-ipa.yml) produit une IPA non signée destinée à être re-signée via SideStore/AltStore.

### Prérequis CI

- Secrets GitHub obligatoires: `TWITCH_CLIENT_ID` et `TWITCH_CLIENT_SECRET`.

### Artefact

- Artifact GitHub: `nosubvod-ios-<run>-<sha>`
- Fichier principal: `NoSubVOD-iOS.ipa`

Avec un compte Apple gratuit, la signature SideStore/AltStore doit être renouvelée périodiquement.

---

## ⚠️ Notes

- Certaines fonctionnalités dépendent des endpoints Twitch et de leurs limites API.
- En mode pairé, garder le même réseau local entre l'app iOS et l'instance Desktop.

---

## 👤 Auteur

Développé avec ❤️ par Theorhd
