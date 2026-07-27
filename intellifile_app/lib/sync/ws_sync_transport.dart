import 'dart:async';

import 'sync_connection.dart';
import 'ws_client.dart';

class WsSyncTransport implements SyncConnection {
  final WsClient _client;
  final _stateController = StreamController<SyncConnectionState>.broadcast();
  StreamSubscription<WsConnectionState>? _stateSubscription;

  SyncConnectionState _state = SyncConnectionState.disconnected;
  bool _isDisposed = false;

  WsSyncTransport({
    required Future<void> Function(Map<String, dynamic>) onMessage,
  }) : _client = WsClient(onMessage: onMessage) {
    _stateSubscription = _client.stateStream.listen((wsState) {
      _setState(_mapState(wsState));
    });
  }

  @override
  SyncConnectionState get state => _state;

  @override
  bool get isConnected => _state == SyncConnectionState.connected;

  @override
  Stream<SyncConnectionState> get stateStream => _stateController.stream;

  @override
  Future<void> connect(SyncConnectionTarget target) async {
    if (target is! LanConnectionTarget) {
      throw ArgumentError('WsSyncTransport requires LanConnectionTarget');
    }
    await _client.connect(target.address);
  }

  @override
  Future<void> send(Map<String, dynamic> message) => _client.send(message);

  @override
  Future<void> disconnect() => _client.disconnect();

  @override
  void dispose() {
    _isDisposed = true;
    _stateSubscription?.cancel();
    _stateSubscription = null;
    _client.dispose();
    _stateController.close();
  }

  SyncConnectionState _mapState(WsConnectionState state) {
    switch (state) {
      case WsConnectionState.disconnected:
        return SyncConnectionState.disconnected;
      case WsConnectionState.connecting:
        return SyncConnectionState.connecting;
      case WsConnectionState.connected:
        return SyncConnectionState.connected;
    }
  }

  void _setState(SyncConnectionState next) {
    if (_state == next) return;
    _state = next;
    if (_isDisposed || _stateController.isClosed) return;
    _stateController.add(_state);
  }
}