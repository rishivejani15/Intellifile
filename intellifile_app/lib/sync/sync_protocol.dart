// lib/sync/sync_protocol.dart
//
// Type-safe message models for the WebSocket sync protocol.
// Each class maps to a JSON message sent/received over the wire.

// ─── Incoming message parsing ───────────────────────────────────────────────

/// Parse a raw JSON message from the server into a typed [SyncMessage].
SyncMessage parseSyncMessage(Map<String, dynamic> json) {
  switch (json['type']) {
    case 'handshake':
      return HandshakeMessage(
        tree: Map<String, dynamic>.from(json['tree'] as Map),
        clocks: Map<String, dynamic>.from(json['clocks'] as Map),
      );
    case 'delta':
      return DeltaMessage(
        filepath: json['filepath'] as String,
        deltas: json['deltas'] as List,
        clock: Map<String, dynamic>.from(json['clock'] as Map),
        change: json['change'] as String,
        size: (json['size'] as num?)?.toInt(),
      );
    case 'delete':
      return DeleteMessage(
        filepath: json['filepath'] as String,
        clock: Map<String, dynamic>.from(json['clock'] as Map),
      );
    case 'request_delta':
      return RequestDeltaMessage(
        filepath: json['filepath'] as String,
        blockChecksums: Map<String, dynamic>.from(
          json['block_checksums'] as Map,
        ),
      );
    case 'conflict':
      return ConflictMessage(filepath: json['filepath'] as String);
    case 'in_sync':
      return const InSyncMessage();
    case 'sync_complete':
      return const SyncCompleteMessage();
    case 'ack':
      return AckMessage(filepath: json['filepath'] as String);
    case 'change_pending':
      return ChangePendingMessage(
        filepath: json['filepath'] as String,
        changeType: json['change_type'] as String? ?? 'modified',
        fileSize: (json['file_size'] as num?)?.toInt() ?? 0,
        modifiedAt: (json['modified_at'] as num?)?.toDouble() ?? 0.0,
      );
    case 'sync_approved':
      return SyncApprovedMessage(filepath: json['filepath'] as String);
    case 'sync_rejected':
      return SyncRejectedMessage(filepath: json['filepath'] as String);
    case 'peer-reconnecting':
      return PeerReconnectingMessage(
        ttl: (json['ttl'] as num?)?.toInt() ?? 300,
      );
    default:
      return UnknownMessage(type: json['type']?.toString() ?? 'null');
  }
}

// ─── Message types ──────────────────────────────────────────────────────────

sealed class SyncMessage {
  const SyncMessage();
}

class HandshakeMessage extends SyncMessage {
  final Map<String, dynamic> tree;
  final Map<String, dynamic> clocks;
  const HandshakeMessage({required this.tree, required this.clocks});
}

class DeltaMessage extends SyncMessage {
  final String filepath;
  final List deltas;
  final Map<String, dynamic> clock;
  final String change;
  final int? size;
  const DeltaMessage({
    required this.filepath,
    required this.deltas,
    required this.clock,
    required this.change,
    this.size,
  });
}

class DeleteMessage extends SyncMessage {
  final String filepath;
  final Map<String, dynamic> clock;
  const DeleteMessage({required this.filepath, required this.clock});
}

class RequestDeltaMessage extends SyncMessage {
  final String filepath;
  final Map<String, dynamic> blockChecksums;
  const RequestDeltaMessage({
    required this.filepath,
    required this.blockChecksums,
  });
}

class ConflictMessage extends SyncMessage {
  final String filepath;
  const ConflictMessage({required this.filepath});
}

class InSyncMessage extends SyncMessage {
  const InSyncMessage();
}

class SyncCompleteMessage extends SyncMessage {
  const SyncCompleteMessage();
}

class AckMessage extends SyncMessage {
  final String filepath;
  const AckMessage({required this.filepath});
}

/// PC reports a file changed — requires user approval before syncing.
class ChangePendingMessage extends SyncMessage {
  final String filepath;
  final String changeType; // 'modified' | 'added' | 'deleted'
  final int fileSize;
  final double modifiedAt;
  const ChangePendingMessage({
    required this.filepath,
    required this.changeType,
    required this.fileSize,
    required this.modifiedAt,
  });
}

/// Approval to proceed with syncing a pending change.
class SyncApprovedMessage extends SyncMessage {
  final String filepath;
  const SyncApprovedMessage({required this.filepath});
}

/// Rejection — skip syncing a pending change.
class SyncRejectedMessage extends SyncMessage {
  final String filepath;
  const SyncRejectedMessage({required this.filepath});
}

class UnknownMessage extends SyncMessage {
  final String type;
  const UnknownMessage({required this.type});
}

/// Peer temporarily disconnected but may reconnect within TTL.
class PeerReconnectingMessage extends SyncMessage {
  final int ttl; // seconds
  const PeerReconnectingMessage({required this.ttl});
}
