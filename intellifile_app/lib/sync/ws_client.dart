// lib/sync/ws_client.dart
//
// Robust WebSocket client with:
// - Exponential backoff reconnection
// - Message queuing during disconnection
// - Connection state stream for UI updates

import 'dart:async';
import 'dart:convert';
import 'dart:math';
import 'package:web_socket_channel/web_socket_channel.dart';
import 'package:web_socket_channel/io.dart';
import 'package:flutter/foundation.dart';

enum WsConnectionState { disconnected, connecting, connected }

class WsClient {
  WebSocketChannel? _channel;
  final Future<void> Function(Map<String, dynamic> message) onMessage;

  WsConnectionState _state = WsConnectionState.disconnected;
  String? _address;
  Timer? _reconnectTimer;
  int _reconnectAttempts = 0;
  bool _shouldReconnect = true;

  /// Messages queued while disconnected — sent on reconnect.
  final _pendingMessages = <Map<String, dynamic>>[];

  /// Stream of connection state changes for UI binding.
  final _stateController = StreamController<WsConnectionState>.broadcast();
  Stream<WsConnectionState> get stateStream => _stateController.stream;

  WsConnectionState get state => _state;
  bool get isConnected => _state == WsConnectionState.connected;

  static const int _maxReconnectAttempts = 999999;
  static const Duration _baseDelay = Duration(milliseconds: 500);
  static const Duration _maxDelay = Duration(seconds: 30);

  WsClient({required this.onMessage});

  /// Connect to the PC sync server.
  Future<void> connect(String address) async {
    if (_state == WsConnectionState.connected && _address == address) return;

    _address = address;
    _shouldReconnect = true;
    _reconnectAttempts = 0;
    await _doConnect();
  }

  Future<void> _doConnect() async {
    if (_address == null) return;

    _setState(WsConnectionState.connecting);

    try {
      String target = _address!;
      if (!target.contains(':')) {
        target = '$target:8765';
      }
      final uri = Uri.parse('ws://$target/sync');
      debugPrint('[ws] Connecting to $uri ...');

      _channel = IOWebSocketChannel.connect(
        uri,
        pingInterval: const Duration(seconds: 15),
      );

      // Wait for the connection to be ready
      await _channel!.ready;

      _setState(WsConnectionState.connected);
      _reconnectAttempts = 0;
      debugPrint('[ws] Connected to PC');

      // Flush any pending messages
      await _flushPendingMessages();

      // Listen for incoming messages
      _channel!.stream.listen(
        (raw) {
          try {
            final data = jsonDecode(raw as String) as Map<String, dynamic>;
            onMessage(data);
          } catch (e) {
            debugPrint('[ws] Failed to parse message: $e');
          }
        },
        onError: (error) {
          debugPrint('[ws] Stream error: $error');
          _handleDisconnect();
        },
        onDone: () {
          debugPrint('[ws] Connection closed');
          _handleDisconnect();
        },
      );
    } catch (e) {
      debugPrint('[ws] Connection failed: $e');
      _handleDisconnect();
    }
  }

  /// Send a message. If disconnected, queues it for later.
  Future<void> send(Map<String, dynamic> data) async {
    if (_state == WsConnectionState.connected && _channel != null) {
      try {
        _channel!.sink.add(jsonEncode(data));
      } catch (e) {
        debugPrint('[ws] Send failed, queuing: $e');
        _pendingMessages.add(data);
        _handleDisconnect();
      }
    } else {
      _pendingMessages.add(data);
      debugPrint('[ws] Queued message (${_pendingMessages.length} pending)');
    }
  }

  /// Disconnect and stop reconnecting.
  Future<void> disconnect() async {
    _shouldReconnect = false;
    _reconnectTimer?.cancel();
    _reconnectTimer = null;
    await _channel?.sink.close();
    _channel = null;
    _setState(WsConnectionState.disconnected);
    debugPrint('[ws] Disconnected (manual)');
  }

  void _handleDisconnect() {
    _channel = null;
    _setState(WsConnectionState.disconnected);

    if (_shouldReconnect && _reconnectAttempts < _maxReconnectAttempts) {
      _scheduleReconnect();
    } else if (_reconnectAttempts >= _maxReconnectAttempts) {
      debugPrint('[ws] Reconnect attempt $_reconnectAttempts - still retrying');
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
      '[ws] Reconnecting in ${delay.inSeconds}s '
      '(attempt $_reconnectAttempts/$_maxReconnectAttempts)',
    );

    _reconnectTimer = Timer(delay, () async {
      await _doConnect();
    });
  }

  Future<void> _flushPendingMessages() async {
    if (_pendingMessages.isEmpty) return;
    debugPrint('[ws] Flushing ${_pendingMessages.length} pending messages');

    final messages = List<Map<String, dynamic>>.from(_pendingMessages);
    _pendingMessages.clear();

    for (final msg in messages) {
      await send(msg);
    }
  }

  void _setState(WsConnectionState newState) {
    if (_state != newState) {
      _state = newState;
      _stateController.add(newState);
    }
  }

  void dispose() {
    _shouldReconnect = false;
    _reconnectTimer?.cancel();
    _channel?.sink.close();
    _stateController.close();
  }
}
