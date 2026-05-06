import 'dart:async';
import 'dart:convert';
import 'dart:math';

import 'package:flutter/foundation.dart';
import 'package:web_socket_channel/io.dart';
import 'package:web_socket_channel/web_socket_channel.dart';

/// Signaling client with auto-reconnection and message queuing.
///
/// When the WebSocket drops, the client will automatically reconnect using
/// exponential backoff (500ms → 1s → 2s → … → 30s max), then re-emit a
/// synthetic 'reconnected' message so the transport layer can re-join the
/// session.
class SignalingClient {
  WebSocketChannel? _channel;
  StreamSubscription<dynamic>? _subscription;
  final _messagesController =
      StreamController<Map<String, dynamic>>.broadcast();
  bool _isDisposed = false;

  // ── Reconnection state ────────────────────────────────────────────
  String? _uri;
  bool _shouldReconnect = false;
  int _reconnectAttempts = 0;
  Timer? _reconnectTimer;
  final List<Map<String, dynamic>> _pendingMessages = [];

  static const int _maxReconnectAttempts = 100; // effectively unlimited
  static const Duration _baseDelay = Duration(milliseconds: 500);
  static const Duration _maxDelay = Duration(seconds: 30);

  Stream<Map<String, dynamic>> get messages => _messagesController.stream;
  bool get isConnected => _channel != null;

  Future<void> connect(String uri) async {
    _uri = uri;
    _shouldReconnect = true;
    _reconnectAttempts = 0;
    await _doConnect();
  }

  Future<void> _doConnect() async {
    if (_uri == null) return;

    // Close any existing connection cleanly
    await _subscription?.cancel();
    _subscription = null;
    final oldChannel = _channel;
    _channel = null;
    try {
      await oldChannel?.sink.close();
    } catch (_) {}

    try {
      final parsed = Uri.parse(_uri!);
      final wsScheme = parsed.scheme == 'https' ? 'wss' : 'ws';
      final wsUri = parsed.replace(scheme: wsScheme);

      debugPrint('[signaling] Connecting to $wsUri ...');
      _channel = IOWebSocketChannel.connect(wsUri);
      await _channel!.ready;

      _reconnectAttempts = 0;
      debugPrint('[signaling] Connected');

      // Flush any pending messages
      _flushPendingMessages();

      _subscription = _channel!.stream.listen(
        (raw) {
          try {
            final data = jsonDecode(raw as String);
            if (data is Map<String, dynamic>) {
              if (!_isDisposed && !_messagesController.isClosed) {
                _messagesController.add(data);
              }
            }
          } catch (e) {
            debugPrint('[signaling] Failed to parse signaling message: $e');
          }
        },
        onDone: () {
          debugPrint('[signaling] Connection closed');
          _channel = null;
          _handleDisconnect();
        },
        onError: (error) {
          debugPrint('[signaling] Socket error: $error');
          _channel = null;
          _handleDisconnect();
        },
      );
    } catch (e) {
      debugPrint('[signaling] Connection failed: $e');
      _channel = null;
      _handleDisconnect();
    }
  }

  void _handleDisconnect() {
    if (_shouldReconnect && _reconnectAttempts < _maxReconnectAttempts) {
      // Notify listeners that we're reconnecting (not permanently dead)
      if (!_isDisposed && !_messagesController.isClosed) {
        _messagesController.add({'type': 'signaling-reconnecting'});
      }
      _scheduleReconnect();
    } else {
      if (!_isDisposed && !_messagesController.isClosed) {
        _messagesController.add({'type': 'disconnected'});
      }
    }
  }

  void _scheduleReconnect() {
    _reconnectTimer?.cancel();

    // Exponential backoff with jitter
    final delay = Duration(
      milliseconds: min(
        _maxDelay.inMilliseconds,
        _baseDelay.inMilliseconds * pow(2, _reconnectAttempts).toInt() +
            Random().nextInt(500),
      ),
    );

    _reconnectAttempts++;
    debugPrint(
      '[signaling] Reconnecting in ${delay.inSeconds}s '
      '(attempt $_reconnectAttempts/$_maxReconnectAttempts)',
    );

    _reconnectTimer = Timer(delay, () async {
      await _doConnect();
      // If reconnected successfully, notify listeners so they can re-join
      if (_channel != null) {
        if (!_isDisposed && !_messagesController.isClosed) {
          _messagesController.add({'type': 'signaling-reconnected'});
        }
      }
    });
  }

  Future<void> send(Map<String, dynamic> message) async {
    if (_channel != null) {
      try {
        _channel!.sink.add(jsonEncode(message));
      } catch (e) {
        debugPrint('[signaling] Send failed, queuing: $e');
        _pendingMessages.add(message);
      }
    } else if (_shouldReconnect) {
      // Queue messages while disconnected — will flush on reconnect
      _pendingMessages.add(message);
      debugPrint(
        '[signaling] Queued message (${_pendingMessages.length} pending)',
      );
    }
  }

  void _flushPendingMessages() {
    if (_pendingMessages.isEmpty) return;
    debugPrint(
      '[signaling] Flushing ${_pendingMessages.length} pending messages',
    );

    final messages = List<Map<String, dynamic>>.from(_pendingMessages);
    _pendingMessages.clear();

    for (final msg in messages) {
      send(msg);
    }
  }

  Future<void> disconnect() async {
    _shouldReconnect = false;
    _reconnectTimer?.cancel();
    _reconnectTimer = null;

    await _subscription?.cancel();
    _subscription = null;

    final channel = _channel;
    _channel = null;
    await channel?.sink.close();

    _pendingMessages.clear();
    if (!_isDisposed && !_messagesController.isClosed) {
      _messagesController.add({'type': 'disconnected'});
    }
  }

  Future<void> dispose() async {
    _isDisposed = true;
    _shouldReconnect = false;
    _reconnectTimer?.cancel();
    await disconnect();
    await _messagesController.close();
  }
}