"""IntelliFile Signaling Server — WebRTC session relay.

Lightweight WebSocket server that pairs two peers (PC ↔ Mobile) in a named
session and relays WebRTC signaling messages (offer/answer/ICE candidates)
between them.  Once the WebRTC DataChannel is established the signaling
connection can be dropped — all file-sync traffic flows peer-to-peer.

Run:
    python signaling_server.py          # default port 8787
    SIGNALING_PORT=9000 python signaling_server.py

Install dependency:
    pip install websockets
"""

from __future__ import annotations

import asyncio
import json
import logging
import os
from dataclasses import dataclass
from typing import Dict, Set

import websockets
from websockets.server import WebSocketServerProtocol

# ── Logging ──────────────────────────────────────────────────────────────────

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s — %(message)s",
    datefmt="%H:%M:%S",
)
log = logging.getLogger("intellifile.signaling")

# ── Data ─────────────────────────────────────────────────────────────────────

_RELAY_TYPES = frozenset({"offer", "answer", "ice-candidate", "candidate"})
_MAX_PEERS_PER_SESSION = 2


@dataclass(frozen=True)
class Peer:
    socket: WebSocketServerProtocol
    is_initiator: bool


# ── Hub ──────────────────────────────────────────────────────────────────────


class SignalingHub:
    """Manages sessions, peer join/leave, and message relay."""

    def __init__(self) -> None:
        self._sessions: Dict[str, Set[Peer]] = {}
        self._peer_session: Dict[WebSocketServerProtocol, str] = {}

    # ── Public entry point ───────────────────────────────────────────────

    async def handle(self, websocket: WebSocketServerProtocol) -> None:
        """Called once per new WebSocket connection."""
        log.info("New connection from %s", websocket.remote_address)
        try:
            async for raw in websocket:
                await self._on_message(websocket, raw)
        except websockets.exceptions.ConnectionClosed:
            pass
        finally:
            await self._on_disconnect(websocket)

    # ── Message routing ──────────────────────────────────────────────────

    async def _on_message(self, ws: WebSocketServerProtocol, raw: str) -> None:
        try:
            msg = json.loads(raw)
            if not isinstance(msg, dict):
                return
        except json.JSONDecodeError:
            await self._send(ws, {"type": "error", "reason": "invalid-json"})
            return

        msg_type = str(msg.get("type", ""))

        if msg_type == "join":
            await self._handle_join(ws, msg)
            return

        session_id = self._peer_session.get(ws)
        if not session_id:
            await self._send(ws, {"type": "error", "reason": "join-required"})
            return

        if msg_type in _RELAY_TYPES:
            relay = dict(msg)
            relay["sessionId"] = session_id
            await self._relay(session_id, ws, relay)
            return

        await self._send(ws, {"type": "error", "reason": "unknown-message"})

    # ── Join ─────────────────────────────────────────────────────────────

    async def _handle_join(self, ws: WebSocketServerProtocol, msg: dict) -> None:
        session_id = str(msg.get("sessionId", "")).strip()
        if not session_id:
            await self._send(ws, {"type": "error", "reason": "missing-sessionId"})
            return

        is_initiator = bool(msg.get("isInitiator", False))

        # Remove from any previous session
        prev = self._peer_session.get(ws)
        if prev:
            await self._remove_peer(ws, prev)

        peers = self._sessions.setdefault(session_id, set())

        if len(peers) >= _MAX_PEERS_PER_SESSION:
            await self._send(ws, {"type": "error", "reason": "session-full"})
            return

        peers.add(Peer(socket=ws, is_initiator=is_initiator))
        self._peer_session[ws] = session_id

        await self._send(ws, {
            "type": "joined",
            "sessionId": session_id,
            "isInitiator": is_initiator,
            "peerCount": len(peers),
        })

        log.info(
            "Peer joined session=%s initiator=%s peers=%d",
            session_id,
            is_initiator,
            len(peers),
        )

        # Notify the other peer that someone joined
        if len(peers) == 2:
            await self._relay(
                session_id, ws, {"type": "peer-joined", "sessionId": session_id}
            )

    # ── Disconnect ───────────────────────────────────────────────────────

    async def _on_disconnect(self, ws: WebSocketServerProtocol) -> None:
        session_id = self._peer_session.get(ws)
        if not session_id:
            return
        await self._remove_peer(ws, session_id)
        await self._relay(
            session_id,
            ws,
            {"type": "peer-disconnected", "sessionId": session_id},
        )
        log.info("Peer disconnected from session=%s", session_id)

    async def _remove_peer(self, ws: WebSocketServerProtocol, session_id: str) -> None:
        peers = self._sessions.get(session_id)
        if peers is not None:
            peers.discard(Peer(socket=ws, is_initiator=True))
            peers.discard(Peer(socket=ws, is_initiator=False))
            if not peers:
                self._sessions.pop(session_id, None)
                log.info("Session %s closed (empty)", session_id)
        self._peer_session.pop(ws, None)

    # ── Helpers ──────────────────────────────────────────────────────────

    async def _relay(
        self,
        session_id: str,
        sender: WebSocketServerProtocol,
        payload: dict,
    ) -> None:
        peers = self._sessions.get(session_id, set())
        tasks = [
            self._send(p.socket, payload)
            for p in peers
            if p.socket is not sender
        ]
        if tasks:
            await asyncio.gather(*tasks, return_exceptions=True)

    async def _send(self, ws: WebSocketServerProtocol, payload: dict) -> None:
        try:
            await ws.send(json.dumps(payload))
        except Exception:
            pass


# ── Entry point ──────────────────────────────────────────────────────────────


async def main() -> None:
    host = os.environ.get("SIGNALING_HOST", "0.0.0.0")
    port = int(os.environ.get("SIGNALING_PORT", "8787"))

    hub = SignalingHub()
    async with websockets.serve(hub.handle, host, port):
        log.info("Signaling server listening on ws://%s:%d", host, port)
        await asyncio.Future()  # run forever


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        log.info("Signaling server stopped")
