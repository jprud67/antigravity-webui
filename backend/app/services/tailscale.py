"""Tailscale Zero-Config Remote Access Service.
Adapted directly from Antigravity Core (`src/infra/tailscale.ts` & `src/shared/tailscale-status.ts`).

Enables secure remote access to Antigravity WebUI via Tailscale MagicDNS and Tailscale Serve
without opening router firewall ports.
"""

from __future__ import annotations

import json
import logging
import os
import shutil
import subprocess
from typing import Any, Dict, List, Optional

logger = logging.getLogger(__name__)

# Common paths where tailscale binary lives on Windows, macOS, Linux
_TAILSCALE_CANDIDATE_PATHS = [
    "tailscale",
    r"C:\Program Files\Tailscale IPN\tailscale.exe",
    r"C:\Program Files (x86)\Tailscale IPN\tailscale.exe",
    "/Applications/Tailscale.app/Contents/MacOS/Tailscale",
    "/usr/bin/tailscale",
    "/usr/local/bin/tailscale",
]


def _find_tailscale_binary() -> Optional[str]:
    """Locate the tailscale executable on the host system."""
    for candidate in _TAILSCALE_CANDIDATE_PATHS:
        found = shutil.which(candidate)
        if found:
            return found
        if os.path.isfile(candidate) and os.access(candidate, os.X_OK):
            return candidate
    return None


def _run_tailscale_command(args: List[str], timeout: int = 5) -> subprocess.CompletedProcess[str]:
    """Execute a tailscale CLI command with timeout."""
    bin_path = _find_tailscale_binary() or "tailscale"
    return subprocess.run(
        [bin_path, *args],
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
        timeout=timeout,
        stdin=subprocess.DEVNULL
    )


def get_tailscale_status() -> Dict[str, Any]:
    """Probe Tailscale status, MagicDNS hostname, and Tailscale IPs.
    
    Equivalent to Antigravity Core extractTailnetHostFromStatusJson & extractTailscaleServeGatewayUrls.
    """
    bin_path = _find_tailscale_binary()
    if not bin_path:
        return {
            "installed": False,
            "running": False,
            "magicdns": None,
            "tailscale_ip": None,
            "serve_active": False,
            "serve_url": None,
            "funnel_active": False,
            "message": "Tailscale n'est pas installé sur cette machine."
        }

    try:
        res = _run_tailscale_command(["status", "--json"], timeout=6)
        if res.returncode != 0:
            return {
                "installed": True,
                "running": False,
                "magicdns": None,
                "tailscale_ip": None,
                "serve_active": False,
                "serve_url": None,
                "funnel_active": False,
                "message": f"Tailscale arrêté ou déconnecté ({res.stderr.strip()[:100]})."
            }

        data = json.loads(res.stdout)
        self_info = data.get("Self") or {}
        dns_name = (self_info.get("DNSName") or "").rstrip(".")
        tailscale_ips = self_info.get("TailscaleIPs") or []
        primary_ip = tailscale_ips[0] if tailscale_ips else None

        # Check serve status
        serve_active = False
        serve_url = None
        funnel_active = False

        try:
            serve_res = _run_tailscale_command(["serve", "status", "--json"], timeout=4)
            if serve_res.returncode == 0 and serve_res.stdout.strip():
                serve_data = json.loads(serve_res.stdout)
                web_handlers = serve_data.get("Web") or {}
                allow_funnel = serve_data.get("AllowFunnel") or {}
                if web_handlers:
                    serve_active = True
                    serve_url = f"https://{dns_name}" if dns_name else f"http://{primary_ip}:8000"
                if any(allow_funnel.values()):
                    funnel_active = True
        except Exception:
            pass

        return {
            "installed": True,
            "running": True,
            "magicdns": dns_name or None,
            "tailscale_ip": primary_ip,
            "all_ips": tailscale_ips,
            "serve_active": serve_active,
            "serve_url": serve_url or (f"https://{dns_name}" if dns_name else None),
            "funnel_active": funnel_active,
            "message": "Tailscale connecté et actif."
        }
    except Exception as exc:
        logger.warning("tailscale: probe failed: %s", exc)
        return {
            "installed": True,
            "running": False,
            "magicdns": None,
            "tailscale_ip": None,
            "serve_active": False,
            "serve_url": None,
            "funnel_active": False,
            "message": f"Erreur de communication avec le démon Tailscale : {exc!s}"
        }


def toggle_tailscale_serve(enable: bool, port: int = 8000) -> Dict[str, Any]:
    """Enable or disable Tailscale Serve reverse proxy to local port."""
    bin_path = _find_tailscale_binary()
    if not bin_path:
        return {"success": False, "message": "Tailscale introuvable."}

    if enable:
        res = _run_tailscale_command(["serve", "--bg", f"http://127.0.0.1:{port}"], timeout=10)
    else:
        res = _run_tailscale_command(["serve", "reset"], timeout=10)

    success = res.returncode == 0
    return {
        "success": success,
        "action": "enable" if enable else "disable",
        "output": res.stdout.strip(),
        "error": res.stderr.strip() if not success else None,
        "status": get_tailscale_status()
    }
