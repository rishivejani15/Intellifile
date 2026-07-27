import 'dart:async';
import 'dart:convert';

import 'package:flutter/foundation.dart';
import 'package:flutter_webrtc/flutter_webrtc.dart';

import 'signaling_client.dart';
import 'sync_connection.dart';

class WebRtcSyncTransport implements SyncConnection {
  final Future<void> Function(Map<String, dynamic>) onMessage;

  final SignalingClient _signaling = SignalingClient();
  final _stateController = StreamController<SyncConnectionState>.broadcast();

  StreamSubscription<Map<String, dynamic>>? _signalingSub;
  RTCPeerConnection? _peerConnection;
  RTCDataChannel? _dataChannel;

  final List<Map<String, dynamic>> _pendingMessages = [];

  SyncConnectionState _state = SyncConnectionState.disconnected;
  bool _isDisposed = false;
  String? _sessionId;
  String? _signalingUri;
  bool _isInitiator = false;

  // ICE restart tracking
  int _iceRestartFailures = 0;
  static const int _maxIceRestartFailures = 3;
  bool _usingRelay = false;
  Timer? _iceRestartTimer;

  WebRtcSyncTransport({required this.onMessage});

  @override
  SyncConnectionState get state => _state;

  @override
  bool get isConnected => _state == SyncConnectionState.connected;

  @override
  Stream<SyncConnectionState> get stateStream => _stateController.stream;

  @override
  Future<void> connect(SyncConnectionTarget target) async {
    if (target is! P2PConnectionTarget) {
      throw ArgumentError('WebRtcSyncTransport requires P2PConnectionTarget');
    }

    await disconnect();

    _sessionId = target.sessionId;
    _signalingUri = target.signalingUri;
    _isInitiator = target.isInitiator;
    _iceRestartFailures = 0;
    _usingRelay = false;
    _setState(SyncConnectionState.connecting);

    await _createPeerConnection();
    await _signaling.connect(target.signalingUri);

    _signalingSub = _signaling.messages.listen(_handleSignalingMessage);

    await _signaling.send({
      'type': 'join',
      'sessionId': _sessionId,
      'isInitiator': _isInitiator,
    });

    if (_isInitiator) {
      await _createAndAttachDataChannel();
      await _createAndSendOffer();
    }
  }

  @override
  Future<void> send(Map<String, dynamic> message) async {
    // 1. Prefer DataChannel (true P2P) when available
    final channel = _dataChannel;
    if (channel != null &&
        channel.state == RTCDataChannelState.RTCDataChannelOpen) {
      channel.send(RTCDataChannelMessage(jsonEncode(message)));
      return;
    }

    // 2. Fall back to signaling WebSocket relay
    if (_signaling.isConnected) {
      await _signaling.send(message);
      return;
    }

    // 3. Neither available — queue for later
    _pendingMessages.add(message);
  }

  @override
  Future<void> disconnect() async {
    _iceRestartTimer?.cancel();
    _iceRestartTimer = null;

    final signalingSub = _signalingSub;
    _signalingSub = null;
    await signalingSub?.cancel();

    await _dataChannel?.close();
    _dataChannel = null;

    await _peerConnection?.close();
    _peerConnection = null;

    await _signaling.disconnect();

    _pendingMessages.clear();
    _usingRelay = false;
    _iceRestartFailures = 0;
    _setState(SyncConnectionState.disconnected);
  }

  @override
  void dispose() {
    _isDisposed = true;
    _iceRestartTimer?.cancel();
    disconnect();
    _stateController.close();
    _signaling.dispose();
  }

  Future<void> _createPeerConnection() async {
    _peerConnection = await createPeerConnection({
      'iceServers': [
        {
          'urls': [
            'stun:stun.l.google.com:19302',
            'stun:stun1.l.google.com:19302',
          ],
        },
      ],
    });

    _peerConnection!.onIceCandidate = (candidate) {
      if (candidate.candidate == null || candidate.candidate!.isEmpty) return;
      _signaling.send({
        'type': 'ice-candidate',
        'sessionId': _sessionId,
        'candidate': candidate.candidate,
        'sdpMid': candidate.sdpMid,
        'sdpMLineIndex': candidate.sdpMLineIndex,
      });
    };

    _peerConnection!.onDataChannel = (channel) {
      _attachDataChannel(channel);
    };

    _peerConnection!.onConnectionState = (state) {
      debugPrint('[webrtc] Connection state: $state');
      if (state == RTCPeerConnectionState.RTCPeerConnectionStateConnected) {
        _iceRestartFailures = 0;
        _usingRelay = false;
        _setState(SyncConnectionState.connected);
      } else if (state == RTCPeerConnectionState.RTCPeerConnectionStateFailed) {
        _attemptIceRestart();
      } else if (state ==
          RTCPeerConnectionState.RTCPeerConnectionStateDisconnected) {
        // Brief disconnections are normal — wait for ICE to recover
        debugPrint('[webrtc] Peer disconnected, waiting for recovery...');
      } else if (state == RTCPeerConnectionState.RTCPeerConnectionStateClosed) {
        if (!_usingRelay) {
          _setState(SyncConnectionState.disconnected);
        }
      }
    };
  }

  Future<void> _createAndAttachDataChannel() async {
    final channel = await _peerConnection!.createDataChannel(
      'sync',
      RTCDataChannelInit()..ordered = true,
    );
    _attachDataChannel(channel);
  }

  void _attachDataChannel(RTCDataChannel channel) {
    _dataChannel = channel;

    channel.onDataChannelState = (state) {
      if (state == RTCDataChannelState.RTCDataChannelOpen) {
        _setState(SyncConnectionState.connected);
        _flushPendingMessages();
      } else if (state == RTCDataChannelState.RTCDataChannelClosed) {
        _setState(SyncConnectionState.disconnected);
      }
    };

    channel.onMessage = (RTCDataChannelMessage message) {
      if (message.isBinary) return;
      try {
        final parsed = jsonDecode(message.text);
        if (parsed is Map<String, dynamic>) {
          unawaited(onMessage(parsed));
        }
      } catch (e) {
        debugPrint('[webrtc] Failed to parse channel message: $e');
      }
    };
  }

  Future<void> _createAndSendOffer({bool iceRestart = false}) async {
    final Map<String, dynamic> offerConstraints = {};
    if (iceRestart) {
      offerConstraints['iceRestart'] = true;
    }
    final offer = await _peerConnection!.createOffer(offerConstraints);
    await _peerConnection!.setLocalDescription(offer);

    await _signaling.send({
      'type': 'offer',
      'sessionId': _sessionId,
      'sdp': offer.sdp,
      'sdpType': offer.type,
    });
  }

  Future<void> _createAndSendAnswer() async {
    final answer = await _peerConnection!.createAnswer();
    await _peerConnection!.setLocalDescription(answer);

    await _signaling.send({
      'type': 'answer',
      'sessionId': _sessionId,
      'sdp': answer.sdp,
      'sdpType': answer.type,
    });
  }

  /// Attempt ICE restart or fall back to WebSocket relay mode.
  void _attemptIceRestart() {
    _iceRestartFailures++;
    debugPrint(
      '[webrtc] P2P failure #$_iceRestartFailures/$_maxIceRestartFailures',
    );

    if (_iceRestartFailures >= _maxIceRestartFailures) {
      // Fall back to relay mode — send sync messages through signaling WS
      _usingRelay = true;
      debugPrint('[webrtc] Falling back to WebSocket relay mode');

      // Close the failed peer connection to free resources
      _dataChannel?.close();
      _dataChannel = null;
      _peerConnection?.close();
      _peerConnection = null;

      // Still "connected" — just routing through the signaling server
      _setState(SyncConnectionState.connected);
    } else {
      // Exponential backoff: 1s, 2s, 4s
      final delay = Duration(
        milliseconds: 1000 * (1 << (_iceRestartFailures - 1)),
      );
      debugPrint('[webrtc] Scheduling ICE restart in ${delay.inSeconds}s');

      _iceRestartTimer?.cancel();
      _iceRestartTimer = Timer(delay, () async {
        if (_isInitiator && _peerConnection != null) {
          await _createAndSendOffer(iceRestart: true);
        }
      });
    }
  }

  Future<void> _handleSignalingMessage(Map<String, dynamic> message) async {
    final type = message['type'];
    final incomingSessionId = message['sessionId']?.toString();

    if (incomingSessionId != null &&
        _sessionId != null &&
        incomingSessionId != _sessionId) {
      return;
    }

    // ── Signaling reconnection events ─────────────────────────────
    if (type == 'signaling-reconnected') {
      debugPrint('[webrtc] Signaling reconnected — re-joining session');
      await _signaling.send({
        'type': 'join',
        'sessionId': _sessionId,
        'isInitiator': _isInitiator,
      });
      return;
    }

    if (type == 'signaling-reconnecting') {
      debugPrint('[webrtc] Signaling reconnecting...');
      return;
    }

    // ── Peer lifecycle events ─────────────────────────────────────
    if (type == 'joined') {
      debugPrint('[webrtc] Joined session, peerCount=${message['peerCount']}');
      final peerCount = message['peerCount'] is int
          ? message['peerCount']
          : int.tryParse(message['peerCount']?.toString() ?? '1');
      if (peerCount != null && peerCount >= 2) {
        _setState(SyncConnectionState.connected);
      }
      return;
    }

    if (type == 'peer-reconnecting') {
      debugPrint('[webrtc] Peer may reconnect within ${message['ttl']}s');
      // Don't disconnect — peer may come back
      return;
    }

    if (type == 'peer-joined') {
      debugPrint('[webrtc] Peer joined — re-establishing P2P if needed');
      _setState(SyncConnectionState.connected);
      if (!_usingRelay && _peerConnection == null) {
        await _createPeerConnection();
        if (_isInitiator) {
          await _createAndAttachDataChannel();
          await _createAndSendOffer();
        }
      }
      return;
    }

    if (type == 'disconnected' || type == 'peer-disconnected') {
      _setState(SyncConnectionState.disconnected);
      return;
    }

    // ── WebRTC signaling ──────────────────────────────────────────
    if (type == 'offer' && !_isInitiator) {
      final sdp = message['sdp']?.toString();
      final sdpType = message['sdpType']?.toString() ?? 'offer';
      if (sdp == null || sdp.isEmpty) return;

      // If we don't have a peer connection, create one (e.g. after ICE restart)
      if (_peerConnection == null) {
        await _createPeerConnection();
      }

      await _peerConnection!.setRemoteDescription(
        RTCSessionDescription(sdp, sdpType),
      );
      await _createAndSendAnswer();
      return;
    }

    if (type == 'answer' && _isInitiator) {
      final sdp = message['sdp']?.toString();
      final sdpType = message['sdpType']?.toString() ?? 'answer';
      if (sdp == null || sdp.isEmpty) return;

      await _peerConnection!.setRemoteDescription(
        RTCSessionDescription(sdp, sdpType),
      );
      return;
    }

    if (type == 'ice-candidate' || type == 'candidate') {
      final candidate = message['candidate']?.toString();
      if (candidate == null || candidate.isEmpty) return;

      final sdpMid = message['sdpMid']?.toString();
      final sdpMLineIndex = message['sdpMLineIndex'];
      final index = sdpMLineIndex is int
          ? sdpMLineIndex
          : int.tryParse(sdpMLineIndex?.toString() ?? '0');

      await _peerConnection?.addCandidate(
        RTCIceCandidate(candidate, sdpMid, index),
      );
      return;
    }

    // ── Sync protocol messages (via relay) ──────────────────────────
    // Always forward non-signaling messages to the sync handler.
    // The peer may send sync messages via WS relay even before P2P
    // is established (e.g. if the Electron side has no wrtc).
    unawaited(onMessage(message));
  }

  void _flushPendingMessages() {
    if (_pendingMessages.isEmpty) return;

    final toSend = List<Map<String, dynamic>>.from(_pendingMessages);
    _pendingMessages.clear();

    for (final message in toSend) {
      send(message);
    }
  }

  void _setState(SyncConnectionState next) {
    if (_state == next) return;
    _state = next;
    if (_isDisposed || _stateController.isClosed) return;
    _stateController.add(_state);
  }
}