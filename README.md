# 🚀 NoSubVOD iOS

NoSubVOD iOS est le client mobile natif de NoSubVOD, écrit entièrement en Swift. Il permet de lire des VODs et des lives Twitch depuis une interface iOS optimisée et fluide.
Initialement basé sur Tauri et Rust, le projet a été intégralement migré vers une architecture native iOS avec Swift 6 pour offrir les meilleures performances et la meilleure intégration possible avec l'écosystème Apple.

## 🆕 Version 1.1.1 — Bloqueur de pubs Twitch

La version 1.1.1 introduit un système hybride de blocage des publicités sur les streams live.

### Points clés 1.1.1

- **Proxy HLS local (mode par défaut)** : Serveur HTTP local intégré qui intercepte le flux HLS, détecte et retire les segments publicitaires avant AVPlayer. Zéro dépendance externe.
- **Proxy TTV externe (mode optionnel)** : Délégation à un serveur proxy communautaire type ttv.lol. URL configurable.
- **Détection multi-stratégies** : Tags SCTE35/CUE, patterns d'URL de CDN pub, heuristiques de durée — conservatrice, zéro faux positif.
- **Interface de paramètres** : Nouvelle section Ad Blocking avec sélecteur de mode et champ URL proxy.

---

## 🆕 Version 1.1.0 — Qualité de code et maintenabilité

La version 1.1.0 est une release de consolidation centrée sur la qualité interne du code.

### Points clés 1.1.0

- **Refactoring du DownloadManager** : Extraction de `DownloadFileMerger` et `DownloadPlaylistBuilder` depuis `VODDownloadManager` (778 → 670 lignes).
- **Gestion d'erreurs renforcée** : Tous les `try?` silencieux de `DownloadModelActor` remplacés par une gestion d'erreur avec logs.
- **Optimisation du dispatch** : 17 classes marquées `final` pour éviter la résolution dynamique inutile.
- **Logique métier centralisée** : Déplacement de l'état de sélection des segments et des callbacks de download de `PlayerView` vers `PlayerViewModel`.
- **Tests GQL fiabilisés** : Utilisation des vrais types de production dans `GQLResponseParsingTests` (suppression des structs inline).
- **Nettoyage du code** : Suppression des commentaires redondants et du code mort.

---

## ✨ Fonctionnalités

### 🔓 VOD, Live, Clips & Mode Hors Ligne

- Lecture des VODs avec support des segments HLS.
- Lecture des lives Twitch fluides.
- **Clips Twitch** : Prise en charge de la lecture et navigation des clips.
- **Mode Hors Ligne** : Interface dédiée pour accéder et visionner vos vidéos téléchargées localement sans connexion Internet.
- Navigation complète : Accueil, Live, Recherche, Tendances, Chaînes, Lecteur.

### 🛡️ Anti-Pub Twitch

- **Proxy local intégré** : Blocage des pubs pre-roll et mid-roll sans dépendance externe.
- **Mode proxy TTV** : Alternative via un serveur proxy communautaire (ex: ttv.lol).
- **Détection intelligente** : Tags SCTE35/CUE, patterns d'URL, heuristiques de durée.
- **Paramètres accessibles** : Choix du mode et URL du proxy dans les réglages.

### 🎬 Expérience Player & Audio-Only

- Lecteur basé sur `AVFoundation` avec contrôles natifs et personnalisés (play/pause, seek, volume).
- Support du **Picture in Picture (PiP)** natif d'iOS.
- Qualité adaptative (HLS) et possibilité de basculer en mode audio pour économiser les données.
- Prise en charge parfaite des **Safe Areas** et de l'encoche/Dynamic Island de l'iPhone/iPad.

### 💬 Chat, Historique et Données

- Replay de chat synchronisé pour les VODs.
- Historique de lecture intelligent pour reprendre vos vidéos là où vous vous étiez arrêté.
- Suivi des chaînes et persistance des données via SwiftData asynchrone.

---

## 🧱 Stack Technique

- **Langage** : Swift 6
- **Interface** : SwiftUI
- **Base de données** : SwiftData
- **Réseau** : Apollo GraphQL & API REST Twitch (`URLSession`)
- **Média** : AVFoundation (`AVPlayer`, `AVPlayerViewController`) + TSPlayerKit (proxy HLS local)
- **Anti-pub** : `AdStrippingProxy` (TSPlayerKit ≥ 1.1.0)
- **Architecture** : MVVM (Model-View-ViewModel)
- **Déploiement** : iOS 17.0+

---

## 📁 Architecture du Repo

- `Sources/` : Code source de l'application (SwiftUI, Modèles, Managers, etc.)
- `Info.plist` : Fichier de configuration de l'application
- `project.yml` : Configuration XcodeGen pour la génération du projet Xcode
- `build_ipa.sh` : Script de build CI/CD

---

## 🛠 Développement

### Prérequis

- **macOS** avec **Xcode** 16.0+ (pour le support complet de Swift 6)
- **xcodegen** (installable via Homebrew : `brew install xcodegen`)
- **Compte Développeur Apple** (optionnel, pour l'installation sur un appareil physique sans AltStore)

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
4. Cliquez sur le bouton "Run" (▶️) ou utilisez le raccourci `Cmd + R`.

### Configuration OAuth Twitch

Dans la console développeur Twitch, configurez votre application et récupérez les identifiants nécessaires pour permettre l'authentification des utilisateurs.

---

## 🍎 Build et Installation IPA

Le script `build_ipa.sh` permet de générer une archive `.ipa` non signée, destinée à être installée via des outils tiers (AltStore, SideStore, TrollStore).

```bash
./build_ipa.sh
```

L'artefact sera généré dans le répertoire `build/`.

---

## ⚠️ Notes

- L'application communique avec l'API de Twitch et peut être sujette à des limites de taux de requêtes (rate limiting).
- L'architecture `ModelActor` est utilisée pour déporter les tâches lourdes de la base de données hors du `MainActor`.

---

## 👤 Auteur

Développé avec ❤️ par Theorhd
