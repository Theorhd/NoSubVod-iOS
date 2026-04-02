# 🚀 NoSubVOD Desktop

NoSubVOD Desktop est une application locale pour regarder des VODs et des lives Twitch depuis n’importe quel appareil du réseau local (mobile, tablette, TV, PC), avec historique, watchlist et portail web intégré.

## 🆕 v0.3.5 — Extensions, Multi-View, Chat Search et Auto-Update

La version 0.3.5 introduit un système d'extensions intégré, une première extension DevTool Explorer, le mode Multi-View avec recherche chat, ainsi que l'intégration des mises à jour automatiques de l'application.

### Points clés v0.3.5

- **Système d'extensions** : architecture d'extensions complète (manager, contexte, API), activation/désactivation dans les settings.
- **DevTool Explorer** : nouvelle extension intégrée pour le monitoring avec UI/UX améliorée.
- **Multi-View + Chat Search** : navigation enrichie avec vue multiple et recherche chat intégrée.
- **Auto-Update** : plugin updater intégré avec configuration de clé publique pour les releases desktop.
- **Qualité & CI** : améliorations backend/tests et exclusion de `extensions/**` des checks CI/CodeQL.

## 🆕 v0.3.4 — Remote Control, qualité player renforcée et Screen Share Windows amélioré

La version 0.3.4 améliore le pilotage à distance du player, la stabilité de lecture HLS, la sélection de qualité vidéo, et la robustesse du mode Screen Share sur Windows.

### Points clés v0.3.4

- **Contrôle distant playback** : ajout des commandes Play/Pause/Seek/Volume/Mute et d'un panneau de contrôle avec infos de session.
- **Player plus stable** : gestion des événements distants fiabilisée dans NSVPlayer pour un comportement plus constant.
- **Qualité vidéo optimisée** : tri/sélection des qualités amélioré avec configuration HLS orientée stabilité.
- **Screen Share Windows renforcé** : compatibilité améliorée côté service + ajustements CSS responsives.
- **Maintenance** : refactors structurels, nettoyage de styles et bump de version global vers 0.3.4.

## 🆕 v0.3.3 — Fiabilite streaming, optimisations Rust et backend durci

La version 0.3.3 se concentre sur la stabilite de lecture VOD/Live, l'optimisation du backend Rust et l'amelioration de la maintenabilite globale.

### Points clés v0.3.3

- **Streaming plus fiable** : correction des 404 intermittents sur le proxy HLS (`/api/stream/variant.*`) avec support du proxy segment via URL directe validee.
- **Perf backend Rust** : regex lazy, selection proxy optimisee, client HTTP partage dans TwitchService/routes, taches async harmonisees.
- **Memoire et I/O** : optimisations `Arc`/`Cow`, download manager avec verrouillage granulaire, historique en buffered I/O.
- **Pagination et etat** : pagination history/watchlist backend+frontend, state management consolide (ScreenShareService, OAuth pending cleanup).
- **Securite et robustesse** : middleware/validation renforces, refactor global de la gestion d'erreurs.
- **Qualite projet** : compression async, tracing/logging etendus, tests unitaires supplementaires, lint cleanup.

## 🆕 v0.3.2 — Screen Share WebRTC, PlayerRTC immersif & navigation dock

La version 0.3.2 introduit le partage d'ecran en temps reel via WebRTC, rapproche l'experience PlayerRTC du player principal, et modernise la navigation sur tablette/desktop avec un rendu dock flottant.

### Points clés v0.3.2

- **Screen Share WebRTC (Windows)** : nouveau module de partage d'ecran local avec roles host/viewer et signalisation WebSocket.
- **Controle distant interactif** : transmission souris/clavier vers l'hote selon les permissions de session.
- **PlayerRTC ameliore** : plein ecran immersif, controle du son (mute + volume) et masquage automatique des controles apres inactivite.
- **Navigation modernisee** : navbar mobile conservee et adaptation tablette/desktop/laptop en dock centre type macOS.
- **Portail LAN HTTPS** : support HTTPS via certificats auto-signes et parcours de connexion mobile ameliore (QR code).
- **Stabilite & qualite** : nettoyage lint, corrections UI/UX et harmonisation des composants Screen Share / PlayerRTC / Player.
- **Versioning** : montee de version globale en `0.3.2`.

## 🆕 v0.2.2 — Contrôle Qualité, Raccourcis & Chat Amélioré

La version 0.2.2 transforme l'expérience de visionnage avec un contrôle total sur la qualité vidéo, des raccourcis clavier et une intégration du chat plus robuste.

### Points clés v0.2.2

- **Contrôle Qualité**: Sélection manuelle, qualité préférée et qualité minimale garanties (même sur iOS/iPadOS).
- **Raccourcis Clavier**: Contrôle complet au clavier (F pour plein écran, Espace pour pause, flèches pour volume/seek).
- **Chat Relais**: Intégration du chat Twitch sur Desktop et système de secours intelligent pour les connexions via IP locale (réseau local).
- **Infos Streamer**: Nouvel encart dynamique avec titre, catégorie, viewers, uptime et profil.
- **Adblock Renforcé**: Proxy GQL, spoofing iOS et gestion des discontinuités pour éviter les freezes d'écran.
- **Fiabilité**: Correction des erreurs 500 sur les flux longs et fallback automatique si les proxys échouent.

## 🆕 v0.2.1 — Adblocking live + fiabilité Search/Channel

La version 0.2.0 migre le desktop vers **Tauri**.

- **Poids de l’ancienne installation**: `701 Mo`
- **Poids de la nouvelle installation**: `16,3 Mo`
- **Économie mémoire**: consommation RAM **divisée par 8**

Résultat: démarrage plus rapide, binaire bien plus léger et meilleure stabilité générale.

---

## ✨ Fonctionnalités

### 🔓 VOD + Live Twitch

- Lecture des VOD via HLS généré côté serveur local.
- Lecture des lives via endpoint local `/api/live/:login/master.m3u8`.
- Sélecteur de qualité (Auto + niveaux manuels) dans le player.
- Adblocking live expérimental (configurable dans Settings).

### 🏠 Portail local multi-appareils

- Serveur local accessible sur le LAN.
- QR code affiché côté desktop pour ouverture rapide du portail.
- Navigation: Home, Live, Search, Trends, Channel, Player, Multi-View, History, Settings.

### 🧩 Extensions

- Système d'extensions local intégré avec activation/désactivation depuis les settings.
- Extension DevTool Explorer incluse pour le monitoring et l'exploration d'outils.

### 🖥️ Screen Share local

- Diffusion d'ecran/fenetre en temps reel via WebRTC (Windows).
- Session partagee sur le reseau local avec etat host/viewer.
- Mode interactif pour piloter l'ecran distant (souris + clavier) selon configuration.

### 🎬 Expérience player

- Player desktop complet (lecture, seek, volume, vitesse, qualité, fullscreen).
- Fallback natif iOS/iPadOS.
- Contrôles auto-masqués après inactivité, réaffichage au mouvement.

### 💾 Données utilisateur

- Historique de lecture avec reprise.
- Watchlist.
- Synchronisation locale optionnelle (OneSync).
- Paramètres serveur persistants (dont adblock proxy/mode).

### ⬆️ Mise à jour application

- Intégration d'un mécanisme d'auto-update desktop via plugin updater.

---

## 🧱 Stack technique

- **Desktop shell**: Tauri v2 (Rust)
- **Backend local**: Rust (`src-tauri/src/server`)
- **Portail LAN**: React + Vite + TypeScript (`src/portal`)
- **UI desktop**: React + Vite + TypeScript (`src/renderer`)

---

## 📁 Architecture du repo

- `src/portal/` : application web servie aux appareils du réseau local
- `src/renderer/` : interface desktop (fenêtre principale)
- `src/shared/` : types partagés TypeScript
- `src-tauri/src/` : cœur Rust (commands Tauri, serveur local, routes Twitch, historique)
- `src-tauri/tauri.conf.json` : configuration packaging/resources

---

## 🛠 Développement

### Prérequis SideStore/AltStore

- Node.js 20+
- Rust stable
- npm

### Installation

```bash
npm ci
```

### Lancer en dev

```bash
npm run dev
```

Le portail LAN tourne en **HTTPS** sur le port `5173` pour autoriser l'acces camera sur mobile (iOS/Android).
Au premier acces, le navigateur peut afficher un avertissement de certificat local: acceptez-le pour continuer.

URL type a ouvrir sur mobile:

```text
https://<ip-locale-du-pc>:5173
```

### Qualité code

```bash
npm run lint
npm run type-check
```

### Build desktop

```bash
npm run build
```

### Build iOS (local)

```bash
npm run build:portal
npx tauri ios init
npx tauri ios build --export-method ad-hoc
```

## 🍎 iOS IPA (CI) — modes de build

Le workflow [NoSubVod-IOS/.github/workflows/ios-ipa.yml](.github/workflows/ios-ipa.yml) produit une **IPA non signée** (unsigned) destinée a etre re-signee par SideStore/AltStore.

### Prérequis

- Aucun compte Apple Developer payant requis pour generer l'artefact CI.
- Pour installation sur iPhone/iPad, la signature finale est faite via SideStore/AltStore avec ton compte Apple personnel.

### Artefacts CI

- Unsigned IPA: `NoSubVOD-iOS-unsigned.ipa` (pour SideStore/AltStore)
- Unsigned app zip: `NoSubVOD-iOS-unsigned-app.zip` (debug)
- Artifact GitHub: `nosubvod-ios-unsigned-<run>-<sha>`

Avec un compte Apple gratuit, la signature doit etre renouvelee periodiquement (limitation Apple).

---

## ⚠️ Notes

- Le portail local doit être accessible sur le même réseau local que l’appareil client.
- Certaines disponibilités de contenus dépendent des endpoints Twitch.
- En build desktop (.exe), le portail public mobile est servi en HTTPS sur `23456` et l'API interne reste en HTTP sur `23455`.

---

## 👤 Auteur

Développé avec ❤️ par Theorhd
