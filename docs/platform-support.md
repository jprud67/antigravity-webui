# Support multiplateforme — Linux · macOS · Windows

> **Dernière mise à jour** : 2026-09-15 — compatibilité multiplateforme du backend et des scripts de démarrage.

Antigravity WebUI fonctionne sur **Linux**, **macOS** et **Windows**.

## Matrice de support

| Fonctionnalité | Linux | macOS | Windows |
|---|:---:|:---:|:---:|
| Backend FastAPI + frontend (navigateur) | ✅ | ✅ | ✅ |
| Chat / streaming `agy` | ✅ | ✅* | ✅* |
| Terminal intégré (PTY) | ✅ | ✅ | ⚠️ via `pywinpty` |
| Connexion Google (OAuth, lecture PTY) | ✅ | ✅ | ⚠️ via `pywinpty` |
| Redémarrage auto après mise à jour | ✅ (systemd) | ➖ manuel | ➖ manuel |
| Script de démarrage | `./start.sh` | `./start.sh` | `start.bat` |

\* Nécessite un binaire `agy` disponible pour la plateforme concernée (voir Prérequis).

## Prérequis

- **Toutes plateformes** : Python 3.10+, Node.js 18+, CLI Antigravity (`agy`).
- **Windows** : Python et Node.js dans le `PATH` ; `pywinpty` (déclaré dans `requirements.txt` via le marqueur `sys_platform == "win32"`) pour le terminal intégré et la connexion Google.
- **macOS** : `brew install python node` recommandé ; CLI Antigravity macOS (`agy`).

Le chemin du CLI est résolu dans l'ordre : variable `AGY_BIN` → `~/.local/bin/agy` → `PATH` (`agy.exe` inclus sous Windows).

## Lancement

```bash
# Linux / macOS
./start.sh
```

```bat
:: Windows
start.bat
```

Variables utiles : `HOST`, `PORT`, `AGY_BIN`, `ANTIGRAVITY_DATA_DIR`, `ANTIGRAVITY_DEFAULT_WORKSPACE`.

## Différences d'exploitation (implémentation)

- **Processus** : POSIX = session dédiée + `SIGTERM` → `SIGKILL` sur le groupe ; Windows = `CREATE_NEW_PROCESS_GROUP` + `taskkill /T` → `taskkill /F /T`.
- **Terminal** : POSIX = `pty`/`fcntl`/`termios` (natif) ; Windows = `pywinpty`, avec dégradation propre (message explicite) si le paquet est absent.
- **Connexion Google** : POSIX = lecture PTY via `select` ; Windows = lecture `pywinpty` dans un thread.
- **Permissions de fichiers** : `0600` appliqué sous POSIX ; sous Windows, les ACL NTFS s'appliquent (no-op explicite).
- **Mises à jour** : redémarrage automatique via `systemctl` sous Linux uniquement ; sous macOS/Windows, relancer le script de démarrage.
- **Chemins par défaut** : le workspace par défaut est la racine utilisateur (`Path.home()`), plus de `/root` codé en dur.

## Limitations connues

- Le chat nécessite un binaire `agy` pour l'OS hôte — la disponibilité des builds macOS/Windows dépend de Google.
- Le terminal sous Windows est **expérimental** (`pywinpty`) : à valider sur une machine Windows réelle.
- Le service `systemd` (`deploy/`) est Linux uniquement ; un équivalent `launchd` pour macOS n'est pas fourni.
