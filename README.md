# 🚀 NoSubVOD iOS

NoSubVOD iOS est le client mobile de NoSubVOD, basé sur Tauri v2 avec un backend Rust embarqué pour lire des VODs et des lives Twitch depuis une interface React adaptée au mobile.
NoSubVOD iOS est dérivé de NoSubVOD-Desktop. La version 0.5.0 de NSV iOS stabilise l'application pour l'utilisation en mobilité et sur le plein écran iOS natif.

## 🆕 v0.5.0 — Mode Hors Ligne, Clips, Audio-Only et Plein Écran iOS Natif

La version 0.5.0 apporte des fonctionnalités majeures pour l'utilisation nomade de l'application et améliore grandement le confort et la stabilité visuelle sur iOS.

### Points clés v0.5.0

- **Mode Hors Ligne & Clips** : Accès à l'application sans connexion Internet (Offline Home) avec gestion des fichiers locaux téléchargés et intégration des Clips Twitch.
- **Plein Écran iOS Natif Fiabilisé** : Détection robuste de l'état de plein écran (événements `webkitbeginfullscreen`) pour empêcher les fausses coupures de flux et assurer la synchronisation continue de l'historique de lecture.
- **Support Audio-Only & Deep Linking** : Possibilité d'écouter uniquement l'audio pour économiser la bande passante et intégration de schémas de liens personnalisés pour ouvrir l'application directement.
- **UI Ergonomique Adaptée** : Intégration complète des Safe Areas d'iOS, sélecteurs de qualité simplifiés sous forme de boutons d'accès rapide, et menu de téléchargement en feuille de style animée (Bottom Sheet).
- **Maintenance & Refactorisation** : Remplacement de styles spécifiques par une feuille commune (`Common.css`), suppression du code mort et mise à jour globale des dépendances Tauri v2 / npm.

Voir la note complète : [releasenotes/0.5.0.md](releasenotes/0.5.0.md)

---

## ✨ Fonctionnalités

### 🔓 VOD, Live, Clips & Mode Hors Ligne

- Lecture des VODs via un proxy HLS du backend local.
- Lecture des lives via des endpoints API locaux.
- **Clips Twitch** : Prise en charge de la lecture et navigation des clips.
- **Mode Hors Ligne** : Interface d'accueil dédiée (`OfflineHome`) pour accéder aux fonctionnalités et visionner ses vidéos téléchargées localement sans connexion.
- Navigation complète : Home, Live, Search, Trends, Channel, Player, Multi-View.

### 🎬 Expérience player & Audio-Only

- Contrôles playback complets (play/pause, seek, volume, plein écran iOS natif robuste).
- Gestion de la qualité vidéo (Auto, sélection manuelle par boutons d'accès rapide, et **Audio-Only** pour économiser la bande passante).
- Support des **Safe Areas** d'iOS pour éviter les coupures de l'encoche de l'iPhone/iPad.

### 💬 Chat, historique et données

- Replay chat pour VOD et gestion robuste du polling.
- Historique de lecture avec reprise intelligente (même en plein écran natif).
- Watchlist et données locales persistantes.

### 🖥️ Fonctionnalités LAN, pairing & Deep Linking

- Backend local iOS accessible en HTTP `23400` et HTTPS `23401`.
- **Deep Linking** : Ouverture automatique de l'application depuis des liens ou partages externes.
- Mode pairé avec Desktop : découverte via `23456` et routage ciblé de certaines APIs (screen share/downloads).

### 🧩 Modules intégrés

- Screen Share.
- Downloads avec menu Bottom Sheet animé.
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

### Configuration OAuth Twitch (iOS + fallback desktop)

Dans la console Twitch (`Applications > Manage`), configure un Redirect URL loopback:

- `http://localhost:23400/api/auth/twitch/callback`

Note: selon ton compte/app, Twitch peut imposer des Redirect URLs en HTTPS.
Si c'est ton cas, utilise une URL HTTPS supportée par ton app et configure-la via
`TWITCH_REDIRECT_URI` / `TWITCH_REDIRECT_URI_IOS`.

Puis configure `src-tauri/.env` (voir `src-tauri/.env.example`):

```bash
TWITCH_CLIENT_ID=...
TWITCH_CLIENT_SECRET=...
```

Optionnel: surcharge des redirects si nécessaire (`TWITCH_REDIRECT_URI`, `TWITCH_REDIRECT_URI_IOS`).

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
