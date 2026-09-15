"""
Utilitaires multiplateformes (Linux / macOS / Windows) — Antigravity WebUI.

Centralise les différences d'exploitation :
- détection de plateforme ;
- lancement de processus enfants isolés (groupe de processus) ;
- terminaison fiable d'un processus et de tous ses descendants ;
- permissions de fichiers (POSIX uniquement) ;
- résolution d'exécutables compatibles Windows (npm.cmd, git.exe, ...).

Aucun import POSIX ici : ce module doit rester importable partout.
"""
import asyncio
import logging
import os
import shutil
import signal
import subprocess
import sys
from typing import List, Optional

logger = logging.getLogger("antigravity.platform")

IS_WINDOWS = sys.platform.startswith("win")
IS_MACOS = sys.platform == "darwin"
IS_POSIX = not IS_WINDOWS


def platform_name() -> str:
    """Nom lisible de la plateforme courante (logs et messages utilisateur)."""
    if IS_WINDOWS:
        return "Windows"
    if IS_MACOS:
        return "macOS"
    return "Linux"


def spawn_group_kwargs() -> dict:
    """
    Arguments à passer au spawn d'un sous-processus pour l'isoler dans son
    propre groupe (POSIX : nouvelle session ; Windows : nouveau groupe de
    processus), afin de pouvoir le terminer proprement avec ses enfants.
    """
    if IS_WINDOWS:
        return {"creationflags": subprocess.CREATE_NEW_PROCESS_GROUP}
    return {"start_new_session": True}


def _killpg(pid: int, sig: int) -> None:
    """Envoie un signal au groupe de processus POSIX (no-op si déjà terminé)."""
    if IS_WINDOWS:
        return
    try:
        os.killpg(os.getpgid(pid), sig)
    except ProcessLookupError:
        pass  # le processus est déjà terminé
    except Exception as exc:  # pragma: no cover - défensif
        logger.debug(f"killpg({pid}, {sig}) a échoué : {exc}")


def _taskkill(pid: int, force: bool) -> None:
    """Termine l'arbre de processus sous Windows via taskkill."""
    argv = ["taskkill"]
    if force:
        argv.append("/F")
    argv += ["/T", "/PID", str(pid)]
    try:
        subprocess.run(argv, capture_output=True, check=False)
    except Exception as exc:  # pragma: no cover - défensif
        logger.debug(f"taskkill {argv[1:]} a échoué : {exc}")


async def terminate_process_group_async(proc, grace: float = 0.8) -> None:
    """
    Termine un sous-processus et ses descendants.
    POSIX : SIGTERM au groupe, puis SIGKILL après `grace` secondes.
    Windows : taskkill /T, puis taskkill /F /T.
    """
    if proc is None or proc.returncode is not None:
        return

    if IS_WINDOWS:
        _taskkill(proc.pid, force=False)
    else:
        _killpg(proc.pid, signal.SIGTERM)

    try:
        await asyncio.wait_for(proc.wait(), timeout=grace)
        return
    except (asyncio.TimeoutError, asyncio.CancelledError):
        pass

    if IS_WINDOWS:
        _taskkill(proc.pid, force=True)
    else:
        _killpg(proc.pid, signal.SIGKILL)

    try:
        await asyncio.wait_for(proc.wait(), timeout=2.0)
    except (asyncio.TimeoutError, asyncio.CancelledError):
        logger.warning(f"Le processus {proc.pid} ne répond toujours pas après terminaison forcée.")


def restrict_file_permissions(path) -> None:
    """Restreint un fichier à son propriétaire (POSIX). No-op explicite sous Windows."""
    if IS_WINDOWS:
        return
    try:
        os.chmod(path, 0o600)
    except OSError as exc:
        logger.warning(f"Impossible de restreindre les permissions de {path} : {exc}")


def which_command(*names: str) -> Optional[str]:
    """Retourne le premier exécutable trouvé dans le PATH (gère .exe/.cmd sous Windows)."""
    for name in names:
        found = shutil.which(name)
        if found:
            return found
    return None


def npm_argv(*args: str) -> List[str]:
    """
    Construit la ligne de commande npm compatible Windows (npm.cmd doit
    passer par `cmd /c`) et POSIX (Linux/macOS).
    """
    npm = which_command("npm") or "npm"
    if IS_WINDOWS:
        return ["cmd", "/c", npm, *args]
    return [npm, *args]
