# sync/server.py

import asyncio
import json
import os
import time
import logging
import uvicorn
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.responses import JSONResponse

try:
    from sync.merkle import build_merkle_tree, find_changed_files, load_merkle_cache, init_merkle_db, save_merkle_cache
    from sync.checksum import get_block_checksums, compute_delta, apply_delta, file_checksum
    from sync.vector_clock import load_clock, save_clock, load_all_clocks, init_clock_db
    from sync.watcher import start_watcher
    from sync.mdns import start_mdns, stop_mdns
except ModuleNotFoundError:
    from merkle import build_merkle_tree, find_changed_files, load_merkle_cache, init_merkle_db, save_merkle_cache
    from checksum import get_block_checksums, compute_delta, apply_delta, file_checksum
    from vector_clock import load_clock, save_clock, load_all_clocks, init_clock_db
    from watcher import start_watcher
    from mdns import start_mdns, stop_mdns

# ─── Configuration ─────────────────────────────────────────────────────────────

DB_PATH     = os.environ.get("INTELLIFIL_DB", "intellifil.db")
SYNC_FOLDER = os.environ.get("INTELLIFIL_SYNC", "./intellifil_files")

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    datefmt="%H:%M:%S",
)
log = logging.getLogger("intellifil")

app = FastAPI(title="IntelliFile Sync Server")
connected_clients: list[WebSocket] = []
_event_loop: asyncio.AbstractEventLoop | None = None

# ─── Pending Changes Store ─────────────────────────────────────────────────────
# Tracks changes detected locally that are awaiting mobile approval.
# Key: filepath, Value: {event_type, timestamp, file_size}

_pending_changes: dict[str, dict] = {}

# Tracks changes mobile reported, awaiting PC approval (auto-approved for now).
_pending_mobile_changes: dict[str, dict] = {}


# ─── REST endpoints ───────────────────────────────────────────────────────────

@app.get("/status")
async def status():
    """Health check + connection info."""
    return JSONResponse({
        "status": "running",
        "connected_devices": len(connected_clients),
        "sync_folder": os.path.abspath(SYNC_FOLDER),
        "pending_changes": len(_pending_changes),
    })


@app.get("/files")
async def list_files():
    """List all files in the sync folder with metadata."""
    files = []
    if os.path.isdir(SYNC_FOLDER):
        for root, _, filenames in os.walk(SYNC_FOLDER):
            for fname in sorted(filenames):
                abs_path = os.path.join(root, fname)
                rel_path = os.path.relpath(abs_path, SYNC_FOLDER).replace("\\", "/")
                stat = os.stat(abs_path)
                files.append({
                    "path": rel_path,
                    "size": stat.st_size,
                    "modified": stat.st_mtime,
                })
    return JSONResponse({"files": files, "count": len(files)})


# ─── WebSocket endpoint ───────────────────────────────────────────────────────

@app.websocket("/sync")
async def sync_endpoint(ws: WebSocket):
    await ws.accept()
    connected_clients.append(ws)
    log.info("Mobile connected (%d total)", len(connected_clients))

    try:
        # ── Step 1: Send our handshake ────────────────────────────────────
        local_tree   = build_merkle_tree(SYNC_FOLDER)
        local_clocks = load_all_clocks(DB_PATH)

        await ws.send_json({
            "type":   "handshake",
            "tree":   local_tree,
            "clocks": local_clocks,
        })

        # ── Step 2: Receive mobile's handshake ────────────────────────────
        msg           = await ws.receive_json()
        mobile_tree   = msg.get("tree", {})
        mobile_clocks = msg.get("clocks", {})
        mobile_block_checksums = msg.get("block_checksums", {})

        # ── Step 3: Find what changed ─────────────────────────────────────
        changed = find_changed_files(mobile_tree, local_tree)

        if not changed:
            await ws.send_json({"type": "in_sync"})
            log.info("All files in sync")
        else:
            for filepath, change_type in changed.items():
                await _resolve_and_send(
                    ws, filepath, change_type,
                    mobile_clocks, mobile_block_checksums,
                )

            # Signal that initial sync batch is complete
            await ws.send_json({"type": "sync_complete"})

        # ── Step 4: Stay alive, handle incoming messages ──────────────────
        while True:
            data = await ws.receive_json()
            await _handle_mobile_message(ws, data)

    except WebSocketDisconnect:
        connected_clients.remove(ws)
        log.info("Mobile disconnected (%d remaining)", len(connected_clients))
    except Exception as exc:
        log.error("WebSocket error: %s", exc, exc_info=True)
        if ws in connected_clients:
            connected_clients.remove(ws)


async def _resolve_and_send(
    ws: WebSocket,
    filepath: str,
    change_type: str,
    mobile_clocks: dict,
    mobile_block_checksums: dict,
):
    """Resolve a single changed file and send appropriate message."""
    local_clock  = load_clock(DB_PATH, filepath)
    remote_clock = mobile_clocks.get(filepath, {})
    verdict      = local_clock.compare(remote_clock)

    if change_type == "deleted":
        # File exists on mobile but was deleted on PC
        if verdict in ("local_wins", "identical"):
            await ws.send_json({
                "type":     "delete",
                "filepath": filepath,
                "clock":    local_clock.clock,
            })
            log.info("Sent delete: %s", filepath)
        return

    if verdict in ("local_wins", "identical"):
        # Mobile needs our version → send delta
        remote_cs = mobile_block_checksums.get(filepath, {})
        local_path = os.path.join(SYNC_FOLDER, filepath)
        if os.path.exists(local_path):
            deltas = compute_delta(local_path, remote_cs)
            await ws.send_json({
                "type":     "delta",
                "filepath": filepath,
                "deltas":   deltas,
                "clock":    local_clock.clock,
                "change":   change_type,
            })
            log.info("Sent delta: %s (%s)", filepath, change_type)

    elif verdict == "remote_wins":
        # We need mobile's version → ask for it
        local_path = os.path.join(SYNC_FOLDER, filepath)
        local_block_cs = get_block_checksums(local_path)
        await ws.send_json({
            "type":            "request_delta",
            "filepath":        filepath,
            "block_checksums": local_block_cs,
        })
        log.info("Requested delta: %s", filepath)

    elif verdict == "conflict":
        await ws.send_json({
            "type":     "conflict",
            "filepath": filepath,
        })
        log.info("Conflict detected: %s", filepath)


async def _handle_mobile_message(ws: WebSocket, data: dict):
    """Handle an incoming message from a connected mobile client."""
    msg_type = data.get("type")

    if msg_type == "delta":
        # Mobile pushed a delta to us
        filepath = data["filepath"]
        local_path = os.path.join(SYNC_FOLDER, filepath)
        os.makedirs(os.path.dirname(local_path), exist_ok=True)

        apply_delta(local_path, data["deltas"])

        vc = load_clock(DB_PATH, filepath)
        vc.merge(data["clock"])
        save_clock(DB_PATH, filepath, vc)

        # Update merkle cache so watcher ignores this change
        cached_tree = load_merkle_cache(DB_PATH)
        cached_tree[filepath] = file_checksum(local_path)
        save_merkle_cache(DB_PATH, cached_tree)

        log.info("Applied delta from mobile: %s", filepath)

        # Send acknowledgment
        await ws.send_json({
            "type":     "ack",
            "filepath": filepath,
        })

    elif msg_type == "delete":
        # Mobile deleted a file
        filepath = data["filepath"]
        local_path = os.path.join(SYNC_FOLDER, filepath)
        if os.path.exists(local_path):
            os.remove(local_path)
            log.info("Deleted file from mobile request: %s", filepath)

        vc = load_clock(DB_PATH, filepath)
        vc.merge(data.get("clock", {}))
        save_clock(DB_PATH, filepath, vc)

        # Update merkle cache so watcher ignores this delete
        cached_tree = load_merkle_cache(DB_PATH)
        if filepath in cached_tree:
            del cached_tree[filepath]
            save_merkle_cache(DB_PATH, cached_tree)

        await ws.send_json({
            "type":     "ack",
            "filepath": filepath,
        })

    elif msg_type == "change_pending":
        # Mobile reports a file changed — auto-approve and request the delta
        filepath = data["filepath"]
        change_type = data.get("change_type", "modified")
        log.info("Mobile reports change pending: %s (%s)", filepath, change_type)

        # Auto-approve: tell mobile to send the actual delta
        _pending_mobile_changes[filepath] = {
            "change_type": change_type,
            "timestamp": time.time(),
        }

        await ws.send_json({
            "type":     "sync_approved",
            "filepath": filepath,
        })
        log.info("Auto-approved mobile change: %s", filepath)

    elif msg_type == "sync_approved":
        # Mobile approved a pending change from PC — send the full delta
        filepath = data["filepath"]
        pending = _pending_changes.pop(filepath, None)
        if pending is None:
            log.warning("sync_approved for unknown pending change: %s", filepath)
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
            else:
                if os.path.exists(local_path):
                    deltas = compute_delta(local_path, {})
                    vc     = load_clock(DB_PATH, filepath)
                    await ws.send_json({
                        "type":     "delta",
                        "filepath": filepath,
                        "deltas":   deltas,
                        "clock":    vc.clock,
                        "change":   event_type,
                    })
                    log.info("Sent approved delta: %s (%s)", filepath, event_type)
                else:
                    log.warning("File disappeared before approval: %s", filepath)
        except Exception as exc:
            log.error("Error sending approved delta for %s: %s", filepath, exc)

    elif msg_type == "sync_rejected":
        # Mobile rejected a pending change from PC — discard it
        filepath = data["filepath"]
        removed = _pending_changes.pop(filepath, None)
        if removed:
            log.info("Mobile rejected change: %s (discarded)", filepath)
        else:
            log.warning("sync_rejected for unknown pending change: %s", filepath)

    elif msg_type == "ack":
        log.info("Mobile acknowledged: %s", data.get("filepath"))

    else:
        log.warning("Unknown message type: %s", msg_type)


# ─── Push changes to all connected mobile clients ─────────────────────────────

async def push_change_pending_to_clients(filepath: str, event_type: str):
    """
    Called by watcher when a file changes on PC.
    Instead of immediately pushing the delta, we send a lightweight
    'change_pending' notification. The mobile must approve before we send data.
    """
    if not connected_clients:
        log.debug("No clients connected, skipping push for %s", filepath)
        return

    local_path = os.path.join(SYNC_FOLDER, filepath)

    # Gather file metadata for the notification
    file_size = 0
    modified_at = time.time()
    if event_type != "deleted" and os.path.exists(local_path):
        stat = os.stat(local_path)
        file_size = stat.st_size
        modified_at = stat.st_mtime

    # Store pending change so we can fulfil it on approval
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


# ─── Startup ──────────────────────────────────────────────────────────────────

@app.on_event("startup")
async def startup():
    global _event_loop
    _event_loop = asyncio.get_running_loop()

    os.makedirs(SYNC_FOLDER, exist_ok=True)
    init_clock_db(DB_PATH)
    init_merkle_db(DB_PATH)

    # Start file watcher — callback comes from a background thread,
    # so we must use run_coroutine_threadsafe instead of create_task.
    def on_change(filepath: str, event_type: str):
        if _event_loop is not None and _event_loop.is_running():
            asyncio.run_coroutine_threadsafe(
                push_change_pending_to_clients(filepath, event_type),
                _event_loop,
            )

    start_watcher(on_change)

    # Advertise on LAN via mDNS
    try:
        start_mdns()
    except Exception as exc:
        log.warning("mDNS startup skipped: %s", exc)

    log.info("IntelliFile sync server running on 0.0.0.0:8765")
    log.info("Sync folder: %s", os.path.abspath(SYNC_FOLDER))


if __name__ == "__main__":
    uvicorn.run("server:app", host="0.0.0.0", port=8765, reload=False)