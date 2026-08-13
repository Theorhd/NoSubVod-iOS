# 🚀 NoSubVOD iOS

NoSubVOD iOS est le client mobile natif de NoSubVOD, écrit entièrement en Swift. Il permet de lire des VODs et des lives Twitch depuis une interface iOS optimisée, fluide et sans publicités.
Initialement basé sur Tauri et Rust, le projet a été intégralement migré vers une architecture native iOS avec Swift 6 pour offrir les meilleures performances et la meilleure intégration possible avec l'écosystème Apple.

---

## 🆕 Version 1.2.0 — Connexion Twitch, Anti-Pub Avancé, Système de MAJ & Source SideStore

La version 1.2.0 est une mise à jour majeure apportant de nouvelles fonctionnalités clés d'interactivité, de personnalisation anti-pub et de gestion des déploiements.

### 🌟 Points clés de la v1.2.0

- **🔐 Connexion au compte Twitch (OAuth PKCE)** : Connectez votre compte pour synchroniser automatiquement vos chaînes suivies (« Your Subs ») et envoyer des messages directement dans le chat des lives. Stockage sécurisé dans le **Keychain** avec rafraîchissement automatique de session.
- **🛡️ Anti-Pub Étendu & Mode Proxy HTTP Externe** : Ajout d'un nouveau mode de proxy HTTP externe qui dérive le trafic HLS vers un pays sans pub. Inclut un outil d'auto-scraping (`ProxyScraperService`) et de test de proxy intégré dans les réglages.
- **🔔 Système de Détection de Mise à Jour** : Détection automatique des nouvelles versions publiées sur GitHub grâce à un comparateur SemVer (`UpdateManager`). Affichage d'un encart violet interactif dans les réglages redirigeant vers la release.
- **📲 Source SideStore / LiveContainer / AltStore (Zero-Infra)** : Intégration d'un workflow GitHub Actions + Pages générant un fichier `apps.json` à chaque release pour importer NoSubVod comme source dans SideStore/LiveContainer/AltStore (`https://theorhd.github.io/NoSubVod-iOS/apps.json`).
- **🎬 Optimisation du Lecteur & Centre de Contrôle** : Re-parenting dynamique d'un `AVPlayerViewController` unique pour éliminer les régressions d'écran noir lors des transitions plein écran, et intégration du contrôleur média natif iOS (`NowPlayingManager`).
- **🧪 Qualité & Tests** : Remplacement des logs par `AppLogger`, centralisation de `FileManager`, et suite de 228 tests unitaires validant l'ensemble de l'application.

---

## ✨ Fonctionnalités

### 🔓 VOD, Live, Clips & Mode Hors Ligne

- Lecture des VODs avec support des segments HLS.
- Lecture des lives Twitch fluides.
- **Clips Twitch** : Prise en charge de la lecture et navigation des clips.
- **Mode Hors Ligne** : Interface dédiée pour accéder et visionner vos vidéos téléchargées localement sans connexion Internet.
- Navigation complète : Accueil, Live, Recherche, Tendances, Chaînes, Lecteur.

### 🛡️ Anti-Pub Twitch & Proxies

- **Mode Proxy Local** : Blocage natif des pubs pre-roll et mid-roll sans dépendance externe.
- **Mode Proxy TTV** : Redirection via un serveur communautaire (ex: `api.ttv.lol`).
- **Mode Proxy HTTP Externe (Nouveau)** : Routage des requêtes HLS via un proxy HTTP personnalisé dans un pays exempt de pubs, avec auto-découverte et validation des proxys gratuits.
- **Détection intelligente** : Tags SCTE35/CUE, patterns d'URL, heuristiques de durée.

### 🔐 Connexion Twitch & Chat Interactif

- **Connexion OAuth PKCE** : Authentification sécurisée via le navigateur web éphémère de l'application.
- **« Your Subs » synchronisé** : Importation et déduplication automatique des chaînes suivies sur la page d'accueil.
- **Participation au Chat Live** : Envoi de messages en direct sur le chat des lives avec gestion des erreurs IRC (NOTICE, slow mode, etc.).
- **Sécurité Keychain** : Stockage sécurisé des tokens et renouvellement automatique.

### 🔔 Alertes de Mise à Jour & Source AltStore / SideStore

- **Vérification automatique** : Détection des nouvelles releases GitHub et affichage d'une bannière d'alerte violette dans les réglages.
- **Source SideStore / LiveContainer** : Importation directe de l'application dans SideStore, LiveContainer ou AltStore via l'URL :
  `https://theorhd.github.io/NoSubVod-iOS/apps.json`

### 🎬 Expérience Player & Audio-Only

- Lecteur basé sur `AVFoundation` avec contrôles natifs et personnalisés (play/pause, seek, volume).
- Support du **Picture in Picture (PiP)** natif d'iOS.
- Intégration du **Centre de Contrôle iOS** (`MPNowPlayingInfoCenter`) pour contrôler la lecture depuis l'écran de verrouillage.
- Qualité adaptative (HLS) et possibilité de basculer en mode audio pour économiser les données.
- Prise en charge des **Safe Areas**, de l'encoche et de la Dynamic Island.

---

## 🧱 Stack Technique

- **Langage** : Swift 6
- **Interface** : SwiftUI
- **Base de données** : SwiftData
- **Réseau** : Apollo GraphQL & API REST Twitch (`URLSession`)
- **Média** : AVFoundation (`AVPlayer`, `AVPlayerViewController`) + TSPlayerKit 1.2.0 (proxy HLS local)
- **Anti-pub** : `AdStrippingProxy` & `ExternalProxyService`
- **Source & Distribution** : GitHub Actions, GitHub Pages (`apps.json`)
- **Architecture** : MVVM (Model-View-ViewModel)
- **Déploiement** : iOS 17.0+

---

## 📁 Architecture du Repo

- `Sources/` : Code source de l'application (SwiftUI, Modèles, Managers, Services, Views).
- `Tests/` : Suite de tests unitaires (228 tests).
- `scripts/` : Scripts d'automatisation (`generate_secrets.sh`, `update_source_json.py`).
- `.github/workflows/` : Workflows CI/CD (`deploy_source.yml`).
- `apps.json` : Fichier de source SideStore / LiveContainer / AltStore.
- `Info.plist` & `project.yml` : Configuration et génération XcodeGen.
- `build_ipa.sh` & `run_tests.sh` : Scripts de build d'IPA et de test headless.

---

## 🛠 Développement

### Prérequis

- **macOS** avec **Xcode** 16.0+ (pour Swift 6)
- **xcodegen** (`brew install xcodegen`)
- **Python 3** (pour le générateur de source `apps.json`)

### Installation et Compilation

1. Générez le projet Xcode à l'aide de XcodeGen :
   ```bash
   xcodegen generate
   ```
2. Ouvrez le projet généré dans Xcode :
   ```bash
   open NoSubVod.xcodeproj
   ```
3. Sélectionnez le simulateur ou votre appareil physique.
4. Lancez l'application avec `Cmd + R`.

### Exécution des Tests Unitaires

Pour exécuter l'ensemble de la suite de tests en mode headless :
```bash
./run_tests.sh
```

---

## 🍎 Build et Installation IPA

Le script `build_ipa.sh` permet de générer une archive `.ipa` non signée, destinée à être installée via SideStore, LiveContainer, AltStore ou TrollStore :

```bash
./build_ipa.sh
```

L'artefact sera généré dans `build/NoSubVod.ipa`.

---

## 👤 Auteur

Développé par **Theorhd** ([GitHub](https://github.com/Theorhd))
