# sync/server.py — Local Sync WebSocket Server

import asyncio
import json
import os
import sys
import time
import logging
import uvicorn
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.responses import JSONResponse

try:
    from sync.merkle import build_merkle_tree, find_changed_files, load_merkle_cache, init_merkle_db, save_merkle_cache
    from sync.checksum import BLOCK_SIZE, get_block_checksums, compute_delta, apply_delta, file_checksum
    from sync.vector_clock import load_clock, save_clock, load_all_clocks, init_clock_db
    from sync.watcher import start_watcher
    from sync.mdns import start_mdns, stop_mdns
except ModuleNotFoundError:
    from merkle import build_merkle_tree, find_changed_files, load_merkle_cache, init_merkle_db, save_merkle_cache
    from checksum import BLOCK_SIZE, get_block_checksums, compute_delta, apply_delta, file_checksum
    from vector_clock import load_clock, save_clock, load_all_clocks, init_clock_db
    from watcher import start_watcher
    from mdns import start_mdns, stop_mdns

# ─── Configuration ─────────────────────────────────────────────────────────────

if getattr(sys, 'frozen', False):
    # Frozen executable mode: paths are relative to the parent of the server/ directory
    # (i.e. resources/sync/ relative to resources/sync/server/server.exe)
    BASE_DIR = os.path.dirname(os.path.dirname(sys.executable))
else:
    BASE_DIR = os.path.dirname(os.path.abspath(__file__))

DB_PATH     = os.path.join(BASE_DIR, "intellifil.db")
SYNC_FOLDER = os.path.join(BASE_DIR, "intellifil_files")

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    datefmt="%H:%M:%S",
)
log = logging.getLogger("intellifil")

app = FastAPI(title="IntelliFile Local Sync Server")
connected_clients: list[WebSocket] = []
_event_loop: asyncio.AbstractEventLoop | None = None


def friendly_error(exc: Exception, reason: str, solution: str) -> dict:
    return {
        "error": str(exc),
        "reason": reason,
        "solution": solution,
    }

# mDNS handles (stored so stop_mdns can be called on shutdown)
_zeroconf = None
_zeroconf_info = None

# ─── Pending Changes Store ─────────────────────────────────────────────────────
# Tracks local file changes awaiting mobile approval.
# Key: relative filepath, Value: {event_type, timestamp, file_size}
_pending_changes: dict[str, dict] = {}

# Tracks changes mobile reported; key: filepath.
_pending_mobile_changes: dict[str, dict] = {}


# ─── REST endpoints ────────────────────────────────────────────────────────────

@app.get("/status")
async def status():
    """Health check + connection info."""
    try:
        return JSONResponse({
            "status": "running",
            "connected_devices": len(connected_clients),
            "sync_folder": os.path.abspath(SYNC_FOLDER),
            "pending_changes": len(_pending_changes),
        })
    except Exception as exc:
        log.error("status endpoint failed: %s", exc, exc_info=True)
        return JSONResponse({"status": "error", **friendly_error(exc, "Could not read sync status.", "Restart the sync server and try again.")}, status_code=500)


@app.get("/files")
async def list_files():
    """List all files in the sync folder with metadata."""
    try:
        files = []
        if os.path.isdir(SYNC_FOLDER):
            for root, _, filenames in os.walk(SYNC_FOLDER):
                for fname in sorted(filenames):
                    abs_path = os.path.join(root, fname)
                    rel_path = os.path.relpath(abs_path, SYNC_FOLDER).replace("\\", "/")
                    stat = os.stat(abs_path)
                    files.append({
                        "path":     rel_path,
                        "size":     stat.st_size,
                        "modified": stat.st_mtime,
                    })
        return JSONResponse({"files": files, "count": len(files)})
    except Exception as exc:
        log.error("list_files endpoint failed: %s", exc, exc_info=True)
        return JSONResponse({"files": [], "count": 0, **friendly_error(exc, "Could not list sync files.", "Check the sync folder permissions and try again.")}, status_code=500)


# ─── WebSocket endpoint ────────────────────────────────────────────────────────

@app.websocket("/sync")
async def sync_endpoint(ws: WebSocket):
    await ws.accept()
    connected_clients.append(ws)
    log.info("Mobile connected (%d total)", len(connected_clients))

    try:
        # ── Step 1: Send our handshake ────────────────────────────────────────
        local_tree   = build_merkle_tree(SYNC_FOLDER)
        local_clocks = load_all_clocks(DB_PATH)
        local_block_checksums = {}
        for rel in (k for k in local_tree if k != "__root__"):
            abs_p = os.path.join(SYNC_FOLDER, rel)
            if os.path.exists(abs_p):
                local_block_checksums[rel] = get_block_checksums(abs_p)

        await ws.send_json({
            "type":             "handshake",
            "tree":             local_tree,
            "clocks":           local_clocks,
            "block_checksums":  local_block_checksums,
        })

        # ── Step 2: Receive mobile's handshake ────────────────────────────────
        msg                   = await ws.receive_json()
        mobile_tree           = msg.get("tree", {})
        mobile_clocks         = msg.get("clocks", {})
        mobile_block_checksums = msg.get("block_checksums", {})

        # ── Step 3: Diff the trees ─────────────────────────────────────────────
        # find_changed_files(a, b):
        #   'deleted'  → in a but NOT in b  → we call with (local, mobile)
        #                so 'deleted' = on PC but not on mobile → push to mobile
        #   'added'    → in b (mobile) but not in a (local PC) → pull from mobile
        #   'modified' → in both, checksums differ              → use vector clock
        changed = find_changed_files(local_tree, mobile_tree)

        if not changed:
            await ws.send_json({"type": "in_sync"})
            log.info("All files in sync")
        else:
            for filepath, change_type in changed.items():
                await _resolve_and_send(
                    ws, filepath, change_type,
                    mobile_clocks, mobile_block_checksums,
                    local_block_checksums,
                )
            await ws.send_json({"type": "sync_complete"})

        # ── Step 4: Stay alive, handle subsequent messages ─────────────────────
        while True:
            data = await ws.receive_json()
            await _handle_mobile_message(ws, data)

    except WebSocketDisconnect:
        pass
    except Exception as exc:
        log.error("WebSocket error: %s", exc, exc_info=True)
    finally:
        if ws in connected_clients:
            connected_clients.remove(ws)
        log.info("Mobile disconnected (%d remaining)", len(connected_clients))


async def _resolve_and_send(
    ws: WebSocket,
    filepath: str,
    change_type: str,
    mobile_clocks: dict,
    mobile_block_checksums: dict,
    local_block_checksums: dict,
):
    """
    Resolve a single changed file and send the appropriate message.

    Called with find_changed_files(local_tree, mobile_tree) semantics:
      'deleted'  → file is on PC but NOT on mobile → send it to mobile
      'added'    → file is on mobile but NOT on PC → request it from mobile
      'modified' → both have it, content differs  → vector clock decides
    """
    local_clock  = load_clock(DB_PATH, filepath)
    remote_clock = mobile_clocks.get(filepath, {})
    verdict      = local_clock.compare(remote_clock)

    local_path = os.path.join(SYNC_FOLDER, filepath)

    if change_type == "deleted":
        # File exists on PC but not on mobile — decide with vector clocks
        remote_clock = mobile_clocks.get(filepath, {})
        verdict = local_clock.compare(remote_clock)

        if verdict == "remote_wins":
            # Mobile deletion is newer — delete locally
            if os.path.exists(local_path):
                os.remove(local_path)

            local_clock.merge(remote_clock)
            save_clock(DB_PATH, filepath, local_clock)

            cached_tree = load_merkle_cache(DB_PATH)
            if filepath in cached_tree:
                del cached_tree[filepath]
                save_merkle_cache(DB_PATH, cached_tree)

            log.info("Accepted mobile delete (local removed): %s", filepath)
            return

        if verdict == "conflict":
            await ws.send_json({
                "type": "conflict",
                "filepath": filepath,
            })
            log.info("Conflict detected: %s", filepath)
            return

        # Local wins or identical — send file to mobile
        if os.path.exists(local_path):
            remote_cs = mobile_block_checksums.get(filepath, {})
            local_clock.tick()
            save_clock(DB_PATH, filepath, local_clock)
            await send_delta_chunked(
                ws, filepath, local_path, remote_cs,
                local_clock.clock, "added",
            )
            log.info("Sent new file to mobile: %s", filepath)
        return

    if change_type == "added":
        # File exists on mobile but not on PC — decide with vector clocks
        remote_clock = mobile_clocks.get(filepath, {})
        verdict = local_clock.compare(remote_clock)

        if verdict == "local_wins":
            await ws.send_json({
                "type":     "delete",
                "filepath": filepath,
                "clock":    local_clock.clock,
            })
            log.info("Sent delete to mobile (local delete wins): %s", filepath)
            return

        if verdict == "conflict":
            await ws.send_json({
                "type": "conflict",
                "filepath": filepath,
            })
            log.info("Conflict detected: %s", filepath)
            return

        # Remote wins or identical — request it
        local_cs = local_block_checksums.get(filepath, {})
        await ws.send_json({
            "type":             "request_delta",
            "filepath":         filepath,
            "block_checksums":  local_cs,
        })
        log.info("Requested file from mobile: %s", filepath)
        return

    # change_type == 'modified'
    if verdict in ("local_wins", "identical"):
        # PC has the newer version — send to mobile
        if os.path.exists(local_path):
            remote_cs = mobile_block_checksums.get(filepath, {})
            local_clock.tick()
            save_clock(DB_PATH, filepath, local_clock)
            await send_delta_chunked(
                ws, filepath, local_path, remote_cs,
                local_clock.clock, "modified",
            )
            log.info("Sent delta to mobile: %s (%s)", filepath, change_type)
        else:
            # File vanished between tree-build and send — treat as delete
            await ws.send_json({
                "type":     "delete",
                "filepath": filepath,
                "clock":    local_clock.clock,
            })
            log.warning("File vanished mid-handshake, sent delete: %s", filepath)

    elif verdict == "remote_wins":
        # Mobile has the newer version — request delta from mobile
        local_cs = get_block_checksums(local_path) if os.path.exists(local_path) else {}
        await ws.send_json({
            "type":             "request_delta",
            "filepath":         filepath,
            "block_checksums":  local_cs,
        })
        log.info("Requested delta from mobile: %s", filepath)

    else:  # conflict
        await ws.send_json({
            "type":     "conflict",
            "filepath": filepath,
        })
        log.info("Conflict detected: %s", filepath)


async def _handle_mobile_message(ws: WebSocket, data: dict):
    """Handle an incoming message from a connected mobile client."""
    msg_type = data.get("type")

    if msg_type == "delta":
        filepath   = data["filepath"]
        local_path = os.path.join(SYNC_FOLDER, filepath)
        os.makedirs(os.path.dirname(local_path), exist_ok=True)

        expected_size = data.get("size")
        apply_delta(local_path, data.get("deltas", []), expected_size)

        vc = load_clock(DB_PATH, filepath)
        vc.merge(data.get("clock", {}))
        save_clock(DB_PATH, filepath, vc)

        # Update Merkle cache so watcher ignores this change
        cached_tree = load_merkle_cache(DB_PATH)
        if os.path.exists(local_path):
            cached_tree[filepath] = file_checksum(local_path)
        save_merkle_cache(DB_PATH, cached_tree)

        log.info("Applied delta from mobile: %s", filepath)
        await ws.send_json({"type": "ack", "filepath": filepath})

    elif msg_type == "handshake":
        mobile_tree = data.get("tree", {})
        mobile_clocks = data.get("clocks", {})
        mobile_block_checksums = data.get("block_checksums", {})

        local_tree = build_merkle_tree(SYNC_FOLDER)
        local_block_checksums = {}
        for rel in (k for k in local_tree if k != "__root__"):
            abs_p = os.path.join(SYNC_FOLDER, rel)
            if os.path.exists(abs_p):
                local_block_checksums[rel] = get_block_checksums(abs_p)

        changed = find_changed_files(local_tree, mobile_tree)
        log.info("[reconnect-handshake] %d file(s) differ after reconnect", len(changed))

        if not changed:
            await ws.send_json({"type": "in_sync"})
        else:
            for filepath, change_type in changed.items():
                await _resolve_and_send(
                    ws, filepath, change_type,
                    mobile_clocks, mobile_block_checksums,
                    local_block_checksums,
                )
            await ws.send_json({"type": "sync_complete"})

    elif msg_type == "delete":
        filepath   = data["filepath"]
        local_path = os.path.join(SYNC_FOLDER, filepath)
        if os.path.exists(local_path):
            os.remove(local_path)
            log.info("Deleted (mobile request): %s", filepath)

        vc = load_clock(DB_PATH, filepath)
        vc.merge(data.get("clock", {}))
        save_clock(DB_PATH, filepath, vc)

        cached_tree = load_merkle_cache(DB_PATH)
        if filepath in cached_tree:
            del cached_tree[filepath]
            save_merkle_cache(DB_PATH, cached_tree)

        await ws.send_json({"type": "ack", "filepath": filepath})

    elif msg_type == "change_pending":
        # Mobile reports a file changed — auto-approve and request the delta
        filepath    = data["filepath"]
        change_type = data.get("change_type", "modified")
        log.info("Mobile change_pending: %s (%s)", filepath, change_type)

        _pending_mobile_changes[filepath] = {
            "change_type": change_type,
            "timestamp":   time.time(),
        }

        await ws.send_json({"type": "sync_approved", "filepath": filepath})
        log.info("Auto-approved mobile change: %s", filepath)

    elif msg_type == "sync_approved":
        # Mobile approved a PC-initiated change — send the full delta
        filepath = data["filepath"]
        pending  = _pending_changes.pop(filepath, None)
        if pending is None:
            log.warning("sync_approved for unknown pending: %s", filepath)
            return

        event_type = pending["event_type"]
        local_path = os.path.join(SYNC_FOLDER, filepath)

        try:
            if event_type == "deleted":
                vc = load_clock(DB_PATH, filepath)
                await ws.send_json({
                    "type":     "delete",
                    "filepath": filepath,
                    "clock":    vc.clock,
                })
                log.info("Sent approved delete: %s", filepath)
            elif os.path.exists(local_path):
                vc     = load_clock(DB_PATH, filepath)
                vc.tick()
                save_clock(DB_PATH, filepath, vc)
                await send_delta_chunked(
                    ws, filepath, local_path, {},
                    vc.clock, event_type,
                )
                log.info("Sent approved delta: %s (%s)", filepath, event_type)
            else:
                vc = load_clock(DB_PATH, filepath)
                await ws.send_json({
                    "type":     "delete",
                    "filepath": filepath,
                    "clock":    vc.clock,
                })
                log.warning("File gone by approval time, sent delete: %s", filepath)
        except Exception as exc:
            log.error("Error sending approved change for %s: %s", filepath, exc)

    elif msg_type == "sync_rejected":
        filepath = data["filepath"]
        _pending_changes.pop(filepath, None)
        log.info("Mobile rejected change: %s", filepath)

    elif msg_type == "ack":
        log.info("Mobile ack: %s", data.get("filepath"))

    elif msg_type == "in_sync":
        log.info("Mobile reports in_sync")

    else:
        log.warning("Unknown message type from mobile: %s", msg_type)


# ─── Push changes to all connected mobile clients ──────────────────────────────

async def push_change_pending_to_clients(filepath: str, event_type: str):
    """
    Called by the file watcher when a file changes on PC.
    Sends a lightweight 'change_pending' notification; mobile must approve
    before the actual delta is sent.
    """
    if not connected_clients:
        log.debug("No clients connected, skipping push for %s", filepath)
        return

    local_path  = os.path.join(SYNC_FOLDER, filepath)
    file_size   = 0
    modified_at = time.time()
    if event_type != "deleted" and os.path.exists(local_path):
        stat        = os.stat(local_path)
        file_size   = stat.st_size
        modified_at = stat.st_mtime

    _pending_changes[filepath] = {
        "event_type":  event_type,
        "timestamp":   time.time(),
        "file_size":   file_size,
        "modified_at": modified_at,
    }

    for client in list(connected_clients):
        try:
            await client.send_json({
                "type":        "change_pending",
                "filepath":    filepath,
                "change_type": event_type,
                "file_size":   file_size,
                "modified_at": modified_at,
            })
            log.info("Sent change_pending to mobile: %s (%s)", filepath, event_type)
        except Exception as exc:
            log.error("Push change_pending failed for %s: %s", filepath, exc)


async def send_delta_chunked(
    ws: WebSocket,
    filepath: str,
    local_path: str,
    remote_cs: dict,
    clock: dict,
    change: str,
):
    try:
        deltas = compute_delta(local_path, remote_cs)
        total_chunks = max(1, (len(deltas) + 49) // 50)
        size = os.path.getsize(local_path)

        for idx in range(total_chunks):
            start = idx * 50
            end = start + 50
            chunk = deltas[start:end]
            log.info("[chunked-delta] sending chunk %d/%d for %s per chunk", idx + 1, total_chunks, filepath)
            await ws.send_json({
                "type":     "delta",
                "filepath": filepath,
                "deltas":   chunk,
                "clock":    clock,
                "change":   change,
                "size":     size,
            })
    except Exception as exc:
        log.error("Chunked delta send failed for %s: %s", filepath, exc, exc_info=True)
        raise


# ─── Startup ───────────────────────────────────────────────────────────────────

@app.on_event("startup")
async def startup():
    global _event_loop, _zeroconf, _zeroconf_info
    _event_loop = asyncio.get_running_loop()

    os.makedirs(SYNC_FOLDER, exist_ok=True)
    init_clock_db(DB_PATH)
    init_merkle_db(DB_PATH)

    log.info("Active BLOCK_SIZE: %d", BLOCK_SIZE)
    if BLOCK_SIZE != 128 * 1024:
        log.warning("BLOCK_SIZE mismatch detected: %d", BLOCK_SIZE)

    def on_change(filepath: str, event_type: str):
        if _event_loop is not None and _event_loop.is_running():
            asyncio.run_coroutine_threadsafe(
                push_change_pending_to_clients(filepath, event_type),
                _event_loop,
            )

    # Pass explicit paths so watcher never uses wrong module-level defaults
    start_watcher(on_change, db_path=DB_PATH, sync_folder=SYNC_FOLDER)

    try:
        _zeroconf, _zeroconf_info = start_mdns()
    except Exception as exc:
        log.warning("mDNS startup skipped: %s", exc)

    log.info("IntelliFile local sync server running on 0.0.0.0:8765")
    log.info("Sync folder : %s", os.path.abspath(SYNC_FOLDER))
    log.info("Database    : %s", os.path.abspath(DB_PATH))


@app.on_event("shutdown")
async def shutdown():
    global _zeroconf, _zeroconf_info
    if _zeroconf is not None and _zeroconf_info is not None:
        try:
            stop_mdns(_zeroconf, _zeroconf_info)
        except Exception as exc:
            log.warning("mDNS shutdown error: %s", exc)
        _zeroconf = None
        _zeroconf_info = None


if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=8765, reload=False)