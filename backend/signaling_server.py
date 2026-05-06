"""IntelliFile Signaling Server — WebRTC + Sync message relay.

Lightweight WebSocket server that pairs two peers (PC ↔ Mobile) in a named
session and relays ALL messages between them — both WebRTC signaling
(offer/answer/ICE) and sync protocol messages (handshake/delta/ack/etc).

Cloud-ready: exposes /health HTTP endpoint, supports persistent sessions
with 5-minute reconnect window, and basic rate limiting (10 join attempts
per IP per minute).

Join token:
    token = hmac.new(SESSION_SECRET.encode(), session_id.encode(), hashlib.sha256).hexdigest()

Run:
    python signaling_server.py          # default port 8080

Install dependency:
    pip install websockets
"""

from __future__ import annotations

import asyncio
import hashlib
import hmac
import json
import logging
import os
import time
from collections import defaultdict
from dataclasses import dataclass, field
from http import HTTPStatus
from typing import Dict, Optional, Set, Tuple

import websockets
from websockets.server import WebSocketServerProtocol

# ── Logging ──────────────────────────────────────────────────────────────────

logging.basicConfig(
    level=logging.DEBUG,
    format="%(asctime)s [%(levelname)s] %(name)s — %(message)s",
    datefmt="%H:%M:%S",
)
log = logging.getLogger("intellifile.signaling")


class _HealthProbeFilter(logging.Filter):
    """Suppress websockets errors caused by HEAD health probes."""

    def filter(self, record: logging.LogRecord) -> bool:
        msg = record.getMessage()
        return not (
            "expected GET; got HEAD" in msg
            or "stream ends after 0 bytes" in msg
            or "connection closed while reading HTTP request line" in msg
            or "did not receive a valid HTTP request" in msg
            or "opening handshake failed" in msg
        )

_DEFAULT_SESSION_SECRET = "s7Jw1r9xH3mV5qZ2Kp8fX0cA4nE6tB9u"
SESSION_SECRET = os.environ.get("SESSION_SECRET", _DEFAULT_SESSION_SECRET)
if SESSION_SECRET == _DEFAULT_SESSION_SECRET:
    log.warning("SESSION_SECRET not set; using built-in default (change for production)")

SIGNALING_HOST = os.environ.get("SIGNALING_HOST", "0.0.0.0")
SIGNALING_PORT = int(os.environ.get("PORT", "8080"))

# ── Data ─────────────────────────────────────────────────────────────────────

_MAX_PEERS_PER_SESSION = 10
_SESSION_TTL_SECONDS = 300  # Keep session alive 5 min after a peer disconnects

# ── Rate Limiting ────────────────────────────────────────────────────────────

_RATE_LIMIT_WINDOW = 60   # 1 minute
_RATE_LIMIT_MAX_JOINS = 10  # max join attempts per IP per window


@dataclass(frozen=True)
class Peer:
    socket: WebSocketServerProtocol
    is_initiator: bool


@dataclass
class SessionInfo:
    """Tracks a session's connected peers and TTL for reconnection."""
    peers: Set[Peer] = field(default_factory=set)
    # Track disconnected slots by IP so peers can rejoin within TTL
    # Maps IP string → expiry timestamp
    reserved_slots: Dict[str, float] = field(default_factory=dict)


# ── Hub ──────────────────────────────────────────────────────────────────────


class SignalingHub:
    """Manages sessions, peer join/leave, and message relay."""

    def __init__(self) -> None:
        self._sessions: Dict[str, SessionInfo] = {}
        self._peer_session: Dict[WebSocketServerProtocol, str] = {}
        self._cleanup_task: Optional[asyncio.Task] = None

        # Rate limiting: ip_string → list of timestamps
        self._join_attempts: Dict[str, list] = defaultdict(list)

    async def start_cleanup_loop(self) -> None:
        """Periodically garbage-collect expired session reservations."""
        self._cleanup_task = asyncio.create_task(self._cleanup_loop())

    async def _cleanup_loop(self) -> None:
        while True:
            await asyncio.sleep(60)  # Check every minute
            now = time.time()
            expired_sessions = []
            for sid, info in self._sessions.items():
                # Remove expired slot reservations
                expired_ips = [
                    ip for ip, expiry in info.reserved_slots.items()
                    if now >= expiry
                ]
                for ip in expired_ips:
                    del info.reserved_slots[ip]
                    log.info("Session %s: reservation for IP=%s expired", sid, ip)
                # If session has no peers and no reservations, delete it
                if not info.peers and not info.reserved_slots:
                    expired_sessions.append(sid)
            for sid in expired_sessions:
                del self._sessions[sid]
                log.info("Session %s expired and removed", sid)

            # Clean up old rate limiting entries
            cutoff = now - _RATE_LIMIT_WINDOW
            for ip in list(self._join_attempts.keys()):
                self._join_attempts[ip] = [
                    t for t in self._join_attempts[ip] if t > cutoff
                ]
                if not self._join_attempts[ip]:
                    del self._join_attempts[ip]

    # ── Rate limiting ────────────────────────────────────────────────────

    def _get_ip(self, ws: WebSocketServerProtocol) -> str:
        """Extract exact IP, parsing X-Forwarded-For if behind a reverse proxy."""
        headers = getattr(ws, "request_headers", None)
        if not headers and hasattr(ws, "request"):
            headers = getattr(ws.request, "headers", None)

        if headers and "X-Forwarded-For" in headers:
            return headers["X-Forwarded-For"].split(",")[0].strip()

        if getattr(ws, "remote_address", None):
            return str(ws.remote_address[0])
            
        return "unknown"

    def _check_rate_limit(self, ip: str) -> bool:
        """Returns True if the join attempt is allowed, False if rate-limited."""
        now = time.time()
        cutoff = now - _RATE_LIMIT_WINDOW

        # Prune old entries
        self._join_attempts[ip] = [
            t for t in self._join_attempts[ip] if t > cutoff
        ]

        if len(self._join_attempts[ip]) >= _RATE_LIMIT_MAX_JOINS:
            return False

        self._join_attempts[ip].append(now)
        return True

    # ── Public entry point ───────────────────────────────────────────────

    async def handle(self, websocket: WebSocketServerProtocol) -> None:
        """Called once per new WebSocket connection."""
        log.info("New connection from %s", websocket.remote_address)
        try:
            async for raw in websocket:
                await self._on_message(websocket, raw)
        except websockets.exceptions.ConnectionClosed:
            log.debug("Connection closed: %s", websocket.remote_address)
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
        log.debug(
            "← [%s] type=%s (keys: %s)",
            ws.remote_address,
            msg_type,
            list(msg.keys()),
        )

        # ── Join handling ────────────────────────────────────────────
        if msg_type == "join":
            await self._handle_join(ws, msg)
            return

        # ── All other messages: must be joined first ─────────────────
        session_id = self._peer_session.get(ws)
        if not session_id:
            log.warning("Message from unjoined peer: type=%s", msg_type)
            await self._send(ws, {"type": "error", "reason": "join-required"})
            return

        # ── Relay ALL messages to the other peer(s) in the session ───
        # This covers both WebRTC signaling (offer/answer/ice-candidate)
        # AND sync protocol messages (handshake/delta/ack/change_pending/etc).
        # We do NOT inject sessionId into the relayed payload — the receiving
        # peer already knows its session, and adding sessionId to sync messages
        # (handshake, delta, etc.) confuses the JS message parser.
        relay = dict(msg)
        relay.pop("sessionId", None)  # strip any client-sent field too
        peer_count = await self._relay(session_id, ws, relay)
        log.debug(
            "-> Relayed type=%s from %s to %d peer(s) in session=%s",
            msg_type,
            ws.remote_address,
            peer_count,
            session_id,
        )

    # ── Join ─────────────────────────────────────────────────────────────

    async def _handle_join(self, ws: WebSocketServerProtocol, msg: dict) -> None:
        session_id = str(msg.get("sessionId", "")).strip()
        if not session_id:
            await self._send(ws, {"type": "error", "reason": "missing-sessionId"})
            return

        is_initiator = bool(msg.get("isInitiator", False))

        # -- Auth disabled for now to allow local clients without tokens to join --
        # token = str(msg.get("token", ""))
        # expected = hmac.new(
        #     SESSION_SECRET.encode(),
        #     session_id.encode(),
        #     hashlib.sha256,
        # ).hexdigest()
        # if not hmac.compare_digest(token, expected):
        #     ip = self._get_ip(ws)
        #     log.warning("[auth] rejected unauthorized join from %s", ip)
        #     await self._send(ws, {"type": "error", "reason": "unauthorized"})
        #     return

        # Rate limiting: check join attempts per IP
        ip = self._get_ip(ws)
        if not self._check_rate_limit(ip):
            log.warning("Rate limited: %s (too many join attempts)", ip)
            await self._send(ws, {"type": "error", "reason": "rate-limited"})
            return

        # Remove from any previous session
        prev = self._peer_session.get(ws)
        if prev:
            await self._remove_peer(ws, prev)

        info = self._sessions.setdefault(session_id, SessionInfo())

        # Clear any reservation for this IP (peer is reconnecting)
        if ip in info.reserved_slots:
            del info.reserved_slots[ip]
            log.info(
                "Session %s: peer reconnected (IP=%s), reservation cleared",
                session_id, ip,
            )

        # Check capacity (active peers only)
        if len(info.peers) >= _MAX_PEERS_PER_SESSION:
            log.warning("Session %s is full, rejecting %s", session_id, ws.remote_address)
            await self._send(ws, {"type": "error", "reason": "session-full"})
            return

        info.peers.add(Peer(socket=ws, is_initiator=is_initiator))
        self._peer_session[ws] = session_id

        await self._send(ws, {
            "type": "joined",
            "sessionId": session_id,
            "isInitiator": is_initiator,
            "peerCount": len(info.peers),
        })

        log.info(
            "Peer joined session=%s initiator=%s peers=%d addr=%s",
            session_id,
            is_initiator,
            len(info.peers),
            ws.remote_address,
        )

        # Notify other peers that someone joined
        if len(info.peers) > 1:
            await self._relay(
                session_id, ws, {"type": "peer-joined", "sessionId": session_id}
            )
            log.info("Session %s has active peers — new peer joined", session_id)

    # ── Disconnect ───────────────────────────────────────────────────────

    async def _on_disconnect(self, ws: WebSocketServerProtocol) -> None:
        session_id = self._peer_session.get(ws)
        if not session_id:
            return

        info = self._sessions.get(session_id)
        # Figure out the IP of the disconnecting peer for TTL reservation
        disconnected_ip = self._get_ip(ws)

        await self._remove_peer(ws, session_id)

        # If there are still active peers, tell them about the disconnect
        # and whether the disconnected peer has a reservation (may return)
        has_reservation = (
            info is not None
            and disconnected_ip in info.reserved_slots
        )

        if has_reservation:
            # Peer might come back — send "reconnecting" instead of "disconnected"
            await self._relay(
                session_id, ws,
                {
                    "type": "peer-reconnecting",
                    "sessionId": session_id,
                    "ttl": _SESSION_TTL_SECONDS,
                },
            )
            log.info(
                "Peer disconnected from session=%s addr=%s (reservation kept %ds)",
                session_id, ws.remote_address, _SESSION_TTL_SECONDS,
            )
        else:
            await self._relay(
                session_id, ws,
                {"type": "peer-disconnected", "sessionId": session_id},
            )
            log.info("Peer disconnected from session=%s addr=%s", session_id, ws.remote_address)

    async def _remove_peer(self, ws: WebSocketServerProtocol, session_id: str) -> None:
        info = self._sessions.get(session_id)
        if info is not None:
            # Find and remove the peer, reserving their slot
            removed_peer = None
            for peer in list(info.peers):
                if peer.socket is ws:
                    removed_peer = peer
                    break
            if removed_peer:
                info.peers.discard(removed_peer)
                # Reserve the slot so the peer can reconnect within TTL
                ip = self._get_ip(ws)
                info.reserved_slots[ip] = (
                    time.time() + _SESSION_TTL_SECONDS
                )
            # Only delete session if no peers AND no reservations
            if not info.peers and not info.reserved_slots:
                self._sessions.pop(session_id, None)
                log.info("Session %s closed (empty, no reservations)", session_id)
        self._peer_session.pop(ws, None)

    # ── Helpers ──────────────────────────────────────────────────────────

    async def _relay(
        self,
        session_id: str,
        sender: WebSocketServerProtocol,
        payload: dict,
    ) -> int:
        """Relay a message to all peers in the session except the sender.
        Returns the number of peers the message was sent to."""
        info = self._sessions.get(session_id)
        if info is None:
            return 0
        targets = [p for p in info.peers if p.socket is not sender]
        tasks = [self._send(p.socket, payload) for p in targets]
        if tasks:
            await asyncio.gather(*tasks, return_exceptions=True)
        return len(targets)

    async def _send(self, ws: WebSocketServerProtocol, payload: dict) -> None:
        try:
            data = json.dumps(payload)
            await ws.send(data)
            log.debug(
                "-> [%s] type=%s (%d bytes)",
                ws.remote_address,
                payload.get("type", "?"),
                len(data),
            )
        except Exception as e:
            log.debug("Send failed to %s: %s", ws.remote_address, e)


# ── HTTP health endpoint ─────────────────────────────────────────────────────

# Suppress noisy websockets debug/info logs from health probe failures
# (Render sends HEAD requests that the websockets library can't handle)
_health_filter = _HealthProbeFilter()
for _logger_name in ("websockets", "websockets.server", "websockets.asyncio.server"):
    _logger = logging.getLogger(_logger_name)
    _logger.addFilter(_health_filter)
    _logger.setLevel(logging.WARNING)
    _logger.propagate = False
    if not _logger.handlers:
        _logger.addHandler(logging.NullHandler())


async def health_check(connection, request=None):
    """Handle plain HTTP health probes from cloud platforms.

    Render/Railway/etc send GET and HEAD requests to / and /health.
    We must respond with HTTP 200 here, otherwise websockets tries
    a WebSocket upgrade handshake and logs errors.
    """
    path = ""
    headers = None
    if isinstance(connection, str):
        path = connection
        headers = request
    elif hasattr(request, "path"):
        path = request.path
        headers = request.headers

    if headers:
        upgrade = ""
        try:
            if hasattr(headers, "get"):
                upgrade = headers.get("Upgrade", "")
            elif isinstance(headers, list):
                for k, v in headers:
                    if str(k).lower() == "upgrade":
                        upgrade = v
                        break
        except Exception:
            pass
        if str(upgrade).lower() == "websocket":
            return None

    if path in ("/", "/health"):
        try:
            from websockets.http11 import Response
            from websockets.datastructures import Headers
            # We must provide Headers or a list for the `headers` argument.
            return Response(200, "OK", Headers(), b"OK\n")
        except ImportError:
            return HTTPStatus.OK, [], b"OK\n"
    # Return None to let websockets handle the connection as a WebSocket
    return None


# ── Entry point ──────────────────────────────────────────────────────────────


async def main() -> None:
    hub = SignalingHub()

    # Increase max message size for large file deltas
    async with websockets.serve(
        hub.handle,
        SIGNALING_HOST,
        SIGNALING_PORT,
        max_size=10 * 1024 * 1024,  # 10 MB max message to protect server heap
        ping_interval=30,
        ping_timeout=10,
        process_request=health_check,
    ):
        log.info("═══════════════════════════════════════════════════")
        log.info("  IntelliFile Signaling Server")
        log.info("  Listening on ws://%s:%d", SIGNALING_HOST, SIGNALING_PORT)
        log.info("  Health check: http://%s:%d/health", SIGNALING_HOST, SIGNALING_PORT)
        log.info("  Session TTL: %ds (peers can reconnect)", _SESSION_TTL_SECONDS)
        log.info("  Rate limit: %d joins/IP/min", _RATE_LIMIT_MAX_JOINS)
        log.info("═══════════════════════════════════════════════════")
        await hub.start_cleanup_loop()
        await asyncio.Future()  # run forever


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        log.info("Signaling server stopped")

