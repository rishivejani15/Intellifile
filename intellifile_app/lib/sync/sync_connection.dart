import 'dart:async';

enum SyncConnectionState { disconnected, connecting, connected }

abstract class SyncConnectionTarget {
  const SyncConnectionTarget();
}

class LanConnectionTarget extends SyncConnectionTarget {
  final String address;

  const LanConnectionTarget(this.address);
}

class P2PConnectionTarget extends SyncConnectionTarget {
  final String signalingUri;
  final String sessionId;
  final bool isInitiator;

  const P2PConnectionTarget({
    required this.signalingUri,
    required this.sessionId,
    required this.isInitiator,
  });
}

abstract class SyncConnection {
  Future<void> connect(SyncConnectionTarget target);
  Future<void> send(Map<String, dynamic> message);
  Future<void> disconnect();
  void dispose();

  SyncConnectionState get state;
  bool get isConnected;
  Stream<SyncConnectionState> get stateStream;
}
