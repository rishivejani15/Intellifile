import 'dart:async';
import 'dart:convert';

import 'package:flutter/foundation.dart';

import 'signaling_client.dart';
import 'sync_connection.dart';

/// WebSocket-relay sync transport for remote connections.
///
/// Instead of establishing a WebRTC DataChannel (which requires the remote
/// peer to also support WebRTC), this transport piggybacks all sync protocol
/// messages through the signaling server.
///
/// Both peers send JSON messages via the signaling WS, and the server relays
/// them to the other peer.  This works for any network topology as long as
/// both peers can reach the signaling server.
///
/// Supports auto-reconnection: when the signaling WebSocket drops, the
/// underlying SignalingClient reconnects automatically and this transport
/// re-joins the session, triggering a fresh handshake.
///
/// Message flow:
///   Mobile → SignalingServer → PC
///   PC → SignalingServer → Mobile
class SignalingRelaySyncTransport implements SyncConnection {
  final Future<void> Function(Map<String, dynamic>) onMessage;

  final SignalingClient _signaling = SignalingClient();
  final _stateController = StreamController<SyncConnectionState>.broadcast();

  StreamSubscription<Map<String, dynamic>>? _signalingSub;

  SyncConnectionState _state = SyncConnectionState.disconnected;
  String? _sessionId;
  bool _isInitiator = false;
  bool _peerJoined = false;
  bool _peerReconnecting = false; // true when peer disconnected but may return

  SignalingRelaySyncTransport({required this.onMessage});

  @override
  SyncConnectionState get state => _state;

  @override
  bool get isConnected => _state == SyncConnectionState.connected;

  @override
  Stream<SyncConnectionState> get stateStream => _stateController.stream;

  @override
  Future<void> connect(SyncConnectionTarget target) async {
    if (target is! P2PConnectionTarget) {
      throw ArgumentError(
        'SignalingRelaySyncTransport requires P2PConnectionTarget',
      );
    }

    await disconnect();

    _sessionId = target.sessionId;
    _isInitiator = target.isInitiator;
    _peerJoined = false;
    _peerReconnecting = false;
    _setState(SyncConnectionState.connecting);

    await _signaling.connect(target.signalingUri);

    _signalingSub = _signaling.messages.listen(_handleSignalingMessage);

    await _signaling.send({
      'type': 'join',
      'sessionId': _sessionId,
      'isInitiator': _isInitiator,
    });
  }

  @override
  Future<void> send(Map<String, dynamic> message) async {
    // Send sync messages directly through the signaling WS — they will be
    // relayed to the other peer by the signaling server.
    await _signaling.send(message);
  }

  @override
  Future<void> disconnect() async {
    final sub = _signalingSub;
    _signalingSub = null;
    await sub?.cancel();

    await _signaling.disconnect();
    _peerJoined = false;
    _peerReconnecting = false;
    _setState(SyncConnectionState.disconnected);
  }

  @override
  void dispose() {
    disconnect();
    _stateController.close();
    _signaling.dispose();
  }

  Future<void> _handleSignalingMessage(Map<String, dynamic> message) async {
    final type = message['type']?.toString() ?? '';
    final incomingSessionId = message['sessionId']?.toString();

    // Filter messages from other sessions
    if (incomingSessionId != null &&
        _sessionId != null &&
        incomingSessionId != _sessionId) {
      return;
    }

    // ── SignalingClient reconnection events ──────────────────────────
    if (type == 'signaling-reconnecting') {
      debugPrint('[relay-transport] Signaling WS reconnecting...');
      // Don't set disconnected — the client is auto-reconnecting
      // Keep _peerJoined as-is since the session may still be alive
      return;
    }

    if (type == 'signaling-reconnected') {
      debugPrint(
        '[relay-transport] Signaling WS reconnected, re-joining session',
      );
      // Re-join the session automatically after signaling reconnects
      await _signaling.send({
        'type': 'join',
        'sessionId': _sessionId,
        'isInitiator': _isInitiator,
      });
      return;
    }

    // ── Connection lifecycle events ──────────────────────────────────
    if (type == 'joined') {
      debugPrint('[relay-transport] Joined session ${message['sessionId']}');
      final peerCount = message['peerCount'] as int? ?? 0;
      if (peerCount >= 2) {
        _peerJoined = true;
        _peerReconnecting = false;
        _setState(SyncConnectionState.connected);
      }
      return;
    }

    if (type == 'peer-joined') {
      debugPrint('[relay-transport] Peer joined');
      _peerJoined = true;
      _peerReconnecting = false;
      _setState(SyncConnectionState.connected);
      return;
    }

    // Peer disconnected but may return within TTL — keep session alive
    if (type == 'peer-reconnecting') {
      final ttl = message['ttl'] ?? 300;
      debugPrint(
        '[relay-transport] Peer disconnected — may reconnect within ${ttl}s',
      );
      _peerReconnecting = true;
      // Don't set state to disconnected — peer may return
      // The SyncManager will see this via onMessage and can update UI
      await onMessage(message);
      return;
    }

    if (type == 'disconnected' || type == 'peer-disconnected') {
      debugPrint('[relay-transport] Peer disconnected (permanent)');
      _peerJoined = false;
      _peerReconnecting = false;
      _setState(SyncConnectionState.disconnected);
      return;
    }

    if (type == 'error') {
      debugPrint('[relay-transport] Server error: ${message['reason']}');
      return;
    }

    // All other messages are sync protocol — forward to SyncManager
    // Ignore WebRTC-specific signaling types that don't apply to relay mode
    if (type == 'offer' ||
        type == 'answer' ||
        type == 'ice-candidate' ||
        type == 'candidate') {
      return;
    }

    // This is a sync protocol message from the remote peer
    await onMessage(message);
  }

  void _setState(SyncConnectionState next) {
    if (_state == next) return;
    _state = next;
    _stateController.add(_state);
  }
}
