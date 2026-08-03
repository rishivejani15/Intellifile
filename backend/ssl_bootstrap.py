"""
ssl_bootstrap.py — Run once at frozen-exe startup to configure SSL correctly.

Must be imported before any network calls to huggingface_hub / requests / urllib.

Three layers of defence:
  1. Point certifi at the bundled CA bundle (critical inside PyInstaller frozen exe
     where certifi.where() would otherwise resolve to a dev-venv path that does not
     exist on the end-user's machine).
  2. Disable the xet-bridge CDN (hf_xet not installed; avoids a secondary TLS
     failure surface that corporate firewalls block more often than huggingface.co).
  3. Inject the Windows Certificate Store via the `truststore` package so that
     corporate / IT-managed root CAs (used by TLS-intercepting proxies / antivirus)
     are automatically trusted.
"""

import os
import sys


def bootstrap_ssl() -> dict:
    """
    Configure SSL for the current process.

    Returns a status dict for diagnostic logging:
      {
        "certifi_path": str | None,   # path to CA bundle that was set
        "truststore_ok": bool,        # True if Windows trust store was injected
        "xet_disabled": bool,         # True if HF_HUB_DISABLE_XET was set
      }
    """
    status = {
        "certifi_path": None,
        "truststore_ok": False,
        "xet_disabled": False,
    }

    # ── 1. certifi CA bundle ──────────────────────────────────────────────────
    # Inside a PyInstaller one-dir bundle, certifi.where() normally resolves to
    # something like  <_MEIPASS>/certifi/cacert.pem  only when the datas entry
    # is present in the .spec file.  If certifi is available, unconditionally
    # set the env vars so requests / urllib3 / http.client all see the same path.
    try:
        import certifi
        ca_bundle = certifi.where()
        if os.path.isfile(ca_bundle):
            # Use setdefault so a user-supplied value in the environment wins.
            os.environ.setdefault("SSL_CERT_FILE", ca_bundle)
            os.environ.setdefault("REQUESTS_CA_BUNDLE", ca_bundle)
            status["certifi_path"] = ca_bundle
        else:
            # The .pem file is missing even though certifi is importable —
            # this happens when the frozen spec is missing the datas entry.
            sys.stderr.write(
                f"[ssl_bootstrap] WARNING: certifi.where() returned '{ca_bundle}' "
                "but the file does not exist. Check your .spec datas entry.\n"
            )
    except ImportError:
        sys.stderr.write(
            "[ssl_bootstrap] WARNING: certifi not available — "
            "SSL certificate verification may fail on the frozen build.\n"
        )

    # ── 2. Disable HuggingFace xet-bridge CDN ────────────────────────────────
    # hf_xet is not installed in this build, so huggingface_hub should never
    # attempt to route through us.aws.cdn.hf.co.  This CDN endpoint is a
    # separate TLS failure surface that corporate firewalls often block even
    # when huggingface.co itself is reachable.
    os.environ.setdefault("HF_HUB_DISABLE_XET", "1")
    status["xet_disabled"] = True

    # ── 3. Windows trust store (corporate proxy / TLS interception) ───────────
    # truststore patches the stdlib ssl module to read from the Windows
    # Certificate Store, so IT-managed root CAs installed by corporate policy
    # are automatically trusted without any manual cert import by the user.
    try:
        import truststore
        truststore.inject_into_ssl()
        status["truststore_ok"] = True
    except ImportError:
        # truststore is optional; certifi + env-var fix is the primary defence.
        pass
    except Exception as exc:
        sys.stderr.write(
            f"[ssl_bootstrap] WARNING: truststore.inject_into_ssl() failed: {exc}\n"
        )

    return status


def log_ssl_status(status: dict) -> None:
    """Write a one-line diagnostic summary to stderr."""
    parts = []
    if status["certifi_path"]:
        parts.append(f"certifi={os.path.basename(status['certifi_path'])}")
    else:
        parts.append("certifi=MISSING")
    parts.append("xet=disabled" if status["xet_disabled"] else "xet=enabled")
    parts.append("truststore=ok" if status["truststore_ok"] else "truststore=unavailable")
    sys.stderr.write(f"[ssl_bootstrap] {', '.join(parts)}\n")
    sys.stderr.flush()