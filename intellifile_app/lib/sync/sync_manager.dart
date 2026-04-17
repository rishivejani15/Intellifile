// lib/sync/sync_manager.dart
//
// Core sync orchestrator — manages the entire sync lifecycle:
// 1. Discovers PC on LAN via mDNS
// 2. Connects via WebSocket
// 3. Performs handshake (exchange Merkle trees + vector clocks)
// 4. Applies incoming deltas / sends outgoing deltas
// 5. Watches local files for changes and notifies PC (with approval flow)
//
// Uses pure Dart engines — no Python dependency.

import 'dart:async';
import 'dart:io';
import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:path_provider/path_provider.dart';
import 'package:path/path.dart' as p;
import 'package:permission_handler/permission_handler.dart';
import 'package:external_path/external_path.dart';

import 'checksum_engine.dart';
import 'merkle_tree.dart';
import 'vector_clock.dart';
import 'sync_connection.dart';
import 'sync_protocol.dart';
import 'mdns_browser.dart';
import 'webrtc_sync_transport.dart';
import 'ws_sync_transport.dart';

// ─── Sync state exposed to UI ───────────────────────────────────────────────

enum SyncStatus { idle, discovering, connecting, syncing, synced, error }

class SyncedFile {
  final String path;
  final int size;
  final DateTime modified;
  final String status; // 'synced' | 'syncing' | 'conflict' | 'error'

  const SyncedFile({
    required this.path,
    required this.size,
    required this.modified,
    this.status = 'synced',
  });
}

/// Represents a change detected on PC that is awaiting user approval.
class PendingChange {
  final String filepath;
  final String changeType; // 'modified' | 'added' | 'deleted'
  final int fileSize;
  final DateTime receivedAt;
  final double modifiedAt;

  const PendingChange({
    required this.filepath,
    required this.changeType,
    required this.fileSize,
    required this.receivedAt,
    required this.modifiedAt,
  });
}

// ─── SyncManager ────────────────────────────────────────────────────────────

class SyncManager extends ChangeNotifier {
  final MdnsBrowser _mdns = MdnsBrowser();
  SyncConnection? _connection;
  StreamSubscription<SyncConnectionState>? _connectionStateSub;
  late String _syncFolder;

  // Observable state
  SyncStatus _status = SyncStatus.idle;
  String _statusMessage = 'Initializing...';
  String? _connectedAddress;
  final List<SyncedFile> _files = [];
  final List<String> _syncLog = [];
  int _pendingSyncs = 0;

  // Pending changes from PC awaiting user approval
  final List<PendingChange> _pendingChanges = [];

  // Pending local changes awaiting PC approval (tracked for UI feedback)
  final Set<String> _awaitingPcApproval = {};

  SyncStatus get status => _status;
  String get statusMessage => _statusMessage;
  String? get connectedAddress => _connectedAddress;
  List<SyncedFile> get files => List.unmodifiable(_files);
  List<String> get syncLog => List.unmodifiable(_syncLog);
  int get pendingSyncs => _pendingSyncs;
  String get syncFolder => _syncFolder;
  List<PendingChange> get pendingChanges => List.unmodifiable(_pendingChanges);
  bool get hasPendingChanges => _pendingChanges.isNotEmpty;
  int get pendingChangeCount => _pendingChanges.length;

  // File watcher
  Timer? _watchTimer;

  Map<String, String> _lastLocalTree = {};
  bool _isProcessingSync = false;
  bool _isProcessingQueue = false;
  final List<Map<String, dynamic>> _messageQueue = [];
  _ConnectionProfile _connectionProfile = _ConnectionProfile.lan;

  /// Initialize the sync system.
  Future<void> init() async {
    if (Platform.isAndroid) {
      // Request permissions for public storage access
      await [Permission.storage, Permission.manageExternalStorage].request();

      final downloadPath = await ExternalPath.getExternalStoragePublicDirectory(
        ExternalPath.DIRECTORY_DOWNLOAD,
      );
      _syncFolder = p.join(downloadPath, 'IntelliFile');
    } else {
      final dir = await getApplicationDocumentsDirectory();
      _syncFolder = p.join(dir.path, 'intellifil_files');
    }

    await Directory(_syncFolder).create(recursive: true);
    debugPrint('[sync-proof] Sync Folder Absolute Path: $_syncFolder');

    await _rebindTransport(WsSyncTransport(onMessage: _handleRawMessage));

    // Discover PC on LAN
    _connectionProfile = _ConnectionProfile.lan;
    _setStatus(SyncStatus.discovering, _disconnectedMessageForProfile());
    _mdns.onPcFound.listen((address) async {
      if (_connectionProfile != _ConnectionProfile.lan) return;
      if (!(_connection?.isConnected ?? false)) {
        _connectedAddress = address;
        await _connection?.connect(LanConnectionTarget(address));
        // Handshake is initiated after receiving server's handshake message
      }
    });

    await _mdns.start();

    // Start local file watcher (poll every 3 seconds)
    _startLocalWatcher();

    _addLog('Sync initialized, looking for PC...');
  }

  /// Connect to a specific address manually (fallback if mDNS fails).
  Future<void> connectManually(String address) async {
    _connectionProfile = _ConnectionProfile.lan;
    await _rebindTransport(WsSyncTransport(onMessage: _handleRawMessage));
    _connectedAddress = address;
    await _connection?.connect(LanConnectionTarget(address));
  }

  /// Connect to a remote peer via WebRTC P2P through a signaling server.
  ///
  /// Uses WebRTC DataChannel for true peer-to-peer file sync.
  /// The signaling server only handles the initial offer/answer/ICE exchange
  /// (~1 KB) — zero file data ever touches it.
  Future<void> connectRemotely(
    String signalingUri,
    String sessionId,
    bool isInitiator,
  ) async {
    _connectionProfile = _ConnectionProfile.remote;
    await _rebindTransport(
      WebRtcSyncTransport(onMessage: _handleRawMessage),
    );

    final signalingHost = Uri.tryParse(signalingUri)?.host;
    final hostDisplay = (signalingHost == null || signalingHost.isEmpty)
        ? signalingUri
        : signalingHost;
    _connectedAddress = '$hostDisplay:$sessionId';

    await _connection?.connect(
      P2PConnectionTarget(
        signalingUri: signalingUri,
        sessionId: sessionId,
        isInitiator: isInitiator,
      ),
    );
  }

  // ─── Pending Change Approval API ───────────────────────────────────────

  /// Approve a single pending change from PC — tells server to send the delta.
  Future<void> approvePendingChange(String filepath) async {
    await _connection?.send({'type': 'sync_approved', 'filepath': filepath});
    _pendingChanges.removeWhere((c) => c.filepath == filepath);
    _addLog('Approved sync: $filepath');
    notifyListeners();
  }

  /// Reject a single pending change from PC — tells server to discard.
  Future<void> rejectPendingChange(String filepath) async {
    await _connection?.send({'type': 'sync_rejected', 'filepath': filepath});
    _pendingChanges.removeWhere((c) => c.filepath == filepath);
    _addLog('Skipped sync: $filepath');
    notifyListeners();
  }

  /// Approve all pending changes at once.
  Future<void> approveAllPending() async {
    final filepaths = _pendingChanges.map((c) => c.filepath).toList();
    for (final fp in filepaths) {
      await _connection?.send({'type': 'sync_approved', 'filepath': fp});
    }
    _pendingChanges.clear();
    _addLog('Approved all ${filepaths.length} pending changes');
    notifyListeners();
  }

  /// Reject all pending changes at once.
  Future<void> rejectAllPending() async {
    final filepaths = _pendingChanges.map((c) => c.filepath).toList();
    for (final fp in filepaths) {
      await _connection?.send({'type': 'sync_rejected', 'filepath': fp});
    }
    _pendingChanges.clear();
    _addLog('Skipped all ${filepaths.length} pending changes');
    notifyListeners();
  }

  // ─── Message handling ───────────────────────────────────────────────────

  Future<void> _handleRawMessage(Map<String, dynamic> raw) async {
    _messageQueue.add(raw);
    _processQueue();
  }

  Future<void> _processQueue() async {
    if (_isProcessingQueue) return;
    _isProcessingQueue = true;
    _isProcessingSync = true;

    try {
      while (_messageQueue.isNotEmpty) {
        final raw = _messageQueue.removeAt(0);
        await _processSingleMessage(raw);
      }
    } catch (e, stack) {
      debugPrint('[sync-debug] Error in queue: $e\n$stack');
    } finally {
      // Refresh tree so watcher doesn't think incoming syncs are local edits
      _lastLocalTree = await buildMerkleTree(_syncFolder);
      debugPrint(
        '[sync-debug] post-queue _lastLocalTree rebuilt. Keys: ${_lastLocalTree.keys.toList()}',
      );
      _isProcessingSync = false;
      _isProcessingQueue = false;
    }
  }

  Future<void> _processSingleMessage(Map<String, dynamic> raw) async {
    try {
      final msg = parseSyncMessage(raw);

      switch (msg) {
        case HandshakeMessage():
          await _handleHandshake(msg);
        case DeltaMessage():
          await _handleDelta(msg);
        case DeleteMessage():
          await _handleDelete(msg);
        case RequestDeltaMessage():
          await _handleRequestDelta(msg);
        case ConflictMessage():
          _handleConflict(msg);
        case InSyncMessage():
          _setStatus(SyncStatus.synced, 'All files in sync');
          _addLog('Already in sync with PC');
        case SyncCompleteMessage():
          _setStatus(SyncStatus.synced, 'Sync complete');
          _addLog('Initial sync complete');
          await _refreshFileList();
        case AckMessage():
          _addLog('PC confirmed: ${msg.filepath}');
          _pendingSyncs = (_pendingSyncs - 1).clamp(0, 999);
          notifyListeners();
        case ChangePendingMessage():
          _handleChangePending(msg);
        case SyncApprovedMessage():
          await _handleSyncApproved(msg);
        case SyncRejectedMessage():
          _handleSyncRejected(msg);
        case PeerReconnectingMessage():
          final mins = (msg.ttl / 60).round();
          _setStatus(
            SyncStatus.syncing,
            'PC disconnected — may reconnect (${mins}m window)…',
          );
          _addLog('PC temporarily disconnected (TTL: ${msg.ttl}s)');
        case UnknownMessage():
          debugPrint('[sync] Unknown message type: ${msg.type}');
      }
    } catch (e) {
      debugPrint('[sync] Message processing error: $e');
    }
  }

  Future<void> _handleHandshake(HandshakeMessage msg) async {
    _setStatus(SyncStatus.syncing, 'Exchanging file state...');

    // Build our local state
    final localTree = await buildMerkleTree(_syncFolder);
    final localClocks = await VectorClockStore.loadAllClocks();
    final blockChecksums = await getAllBlockChecksums(_syncFolder);

    // Convert block checksums to serializable format
    final serializedChecksums = <String, dynamic>{};
    for (final entry in blockChecksums.entries) {
      serializedChecksums[entry.key] = entry.value.map(
        (k, v) => MapEntry(k.toString(), v),
      );
    }

    // Send our handshake response
    await _connection?.send({
      'type': 'handshake',
      'tree': localTree,
      'clocks': localClocks,
      'block_checksums': serializedChecksums,
    });

    _lastLocalTree = localTree;
    _addLog('Handshake sent to PC');
  }

  Future<void> _handleDelta(DeltaMessage msg) async {
    _setStatus(SyncStatus.syncing, 'Syncing: ${msg.filepath}');

    try {
      final localPath = p.join(_syncFolder, msg.filepath);

      if (msg.change == 'deleted') {
        // USER REQUEST: Disable all physical deletion
        _addLog('Ignored remote delete info for: ${msg.filepath}');
      } else {
        // Create parent directories
        await Directory(p.dirname(localPath)).create(recursive: true);
        // Apply delta
        await applyDelta(localPath, msg.deltas);
        _addLog('Synced: ${msg.filepath}');
        debugPrint('[sync-proof] FILE PHYSICALLY SAVED TO: $localPath');
      }

      // Update vector clock
      final vc = await VectorClockStore.loadClock(msg.filepath);
      vc.merge(msg.clock);
      await VectorClockStore.saveClock(msg.filepath, vc);

      // Send acknowledgment
      await _connection?.send({'type': 'ack', 'filepath': msg.filepath});

      await _refreshFileList();
      _setStatus(SyncStatus.synced, 'Sync complete');
    } catch (e) {
      _addLog('Error syncing ${msg.filepath}: $e');
      debugPrint('[sync] Delta apply error: $e');
    }
  }

  Future<void> _handleDelete(DeleteMessage msg) async {
    try {
      final localPath = p.join(_syncFolder, msg.filepath);
      final file = File(localPath);
      if (await file.exists()) {
        // USER REQUEST: Disable all physical deletion
        _addLog(
          'Ignored PC delete request for: ${msg.filepath} (deletion disabled)',
        );
      }

      final vc = await VectorClockStore.loadClock(msg.filepath);
      vc.merge(msg.clock);
      await VectorClockStore.saveClock(msg.filepath, vc);

      await _connection?.send({'type': 'ack', 'filepath': msg.filepath});

      await _refreshFileList();
    } catch (e) {
      _addLog('Error deleting ${msg.filepath}: $e');
    }
  }

  Future<void> _handleRequestDelta(RequestDeltaMessage msg) async {
    try {
      final localPath = p.join(_syncFolder, msg.filepath);

      if (!await File(localPath).exists()) {
        debugPrint('[sync] Requested file not found: ${msg.filepath}');
        return;
      }

      final deltas = await computeDelta(localPath, msg.blockChecksums);
      final vc = await VectorClockStore.loadClock(msg.filepath);

      await _connection?.send({
        'type': 'delta',
        'filepath': msg.filepath,
        'deltas': deltas.map((d) => d.toJson()).toList(),
        'clock': vc.toJson(),
        'change': 'modified',
      });

      _pendingSyncs++;
      notifyListeners();
      _addLog('Sent to PC: ${msg.filepath}');
    } catch (e) {
      _addLog('Error sending ${msg.filepath}: $e');
    }
  }

  void _handleConflict(ConflictMessage msg) {
    _addLog('⚠ Conflict: ${msg.filepath}');
    // Update file status in list
    final idx = _files.indexWhere((f) => f.path == msg.filepath);
    if (idx >= 0) {
      _files[idx] = SyncedFile(
        path: msg.filepath,
        size: _files[idx].size,
        modified: _files[idx].modified,
        status: 'conflict',
      );
      notifyListeners();
    }
  }

  /// PC reports a file changed — add to pending queue for user approval.
  void _handleChangePending(ChangePendingMessage msg) {
    // Remove any existing pending change for the same file (replace with latest)
    _pendingChanges.removeWhere((c) => c.filepath == msg.filepath);

    _pendingChanges.add(
      PendingChange(
        filepath: msg.filepath,
        changeType: msg.changeType,
        fileSize: msg.fileSize,
        receivedAt: DateTime.now(),
        modifiedAt: msg.modifiedAt,
      ),
    );

    _addLog('Change pending: ${msg.filepath} (${msg.changeType})');
    notifyListeners();
  }

  /// PC approved our local change — now send the actual delta.
  Future<void> _handleSyncApproved(SyncApprovedMessage msg) async {
    final filepath = msg.filepath;
    _awaitingPcApproval.remove(filepath);

    try {
      final localPath = p.join(_syncFolder, filepath);

      if (!await File(localPath).exists()) {
        debugPrint('[sync] Approved file no longer exists: $filepath');
        return;
      }

      // Tick vector clock
      final vc = await VectorClockStore.loadClock(filepath);
      vc.tick();
      await VectorClockStore.saveClock(filepath, vc);

      // Compute and send delta
      final deltas = await computeDelta(localPath, {});
      await _connection?.send({
        'type': 'delta',
        'filepath': filepath,
        'deltas': deltas.map((d) => d.toJson()).toList(),
        'clock': vc.toJson(),
        'change': 'modified',
      });

      _pendingSyncs++;
      _addLog('Sent approved change to PC: $filepath');
      notifyListeners();
    } catch (e) {
      _addLog('Error sending approved change $filepath: $e');
    }
  }

  /// PC rejected our local change — discard.
  void _handleSyncRejected(SyncRejectedMessage msg) {
    _awaitingPcApproval.remove(msg.filepath);
    _addLog('PC rejected change: ${msg.filepath}');
    notifyListeners();
  }

  // ─── Local file watcher ─────────────────────────────────────────────────

  void _startLocalWatcher() {
    _watchTimer = Timer.periodic(
      const Duration(seconds: 3),
      (_) => _checkLocalChanges(),
    );
  }

  Future<void> _checkLocalChanges() async {
    if (!(_connection?.isConnected ?? false) || _isProcessingSync) return;

    try {
      final currentTree = await buildMerkleTree(_syncFolder);

      if (_lastLocalTree.isEmpty) {
        _lastLocalTree = currentTree;
        return;
      }

      // Quick root check
      if (currentTree['__root__'] == _lastLocalTree['__root__']) return;

      final changed = findChangedFiles(currentTree, _lastLocalTree);

      if (changed.isNotEmpty) {
        debugPrint('[sync-debug] _checkLocalChanges Found differences!');
        debugPrint(
          '[sync-debug] lastLocalTree keys: ${_lastLocalTree.keys.toList()}',
        );
        debugPrint(
          '[sync-debug] currentTree keys: ${currentTree.keys.toList()}',
        );
        debugPrint('[sync-debug] Computed changes: $changed');
      }

      for (final entry in changed.entries) {
        final filepath = entry.key;
        final changeType = entry.value;

        // --- DOUBLE CHECK VFS INDEX OMISSION ---
        final localPath = p.join(_syncFolder, filepath);
        if (changeType == 'deleted') {
          if (File(localPath).existsSync()) {
            debugPrint(
              '[BUG CATCH] VFS Omission! $filepath physically exists but was omitted by tree. Skipping phantom delete.',
            );

            // Re-inject it into _lastLocalTree to avoid recursive triggers
            final cs = await fileChecksum(localPath);
            if (cs.isNotEmpty) _lastLocalTree[filepath] = cs;
            continue;
          }
        }

        if (changeType == 'deleted') {
          // USER REQUEST: Disable all physical deletion
          _addLog('Ignored local delete for: $filepath (deletion disabled)');
          continue;
        }

        // Skip if we're already waiting for PC approval on this file
        if (_awaitingPcApproval.contains(filepath)) continue;

        // Send change_pending notification to PC instead of immediate delta
        _awaitingPcApproval.add(filepath);
        await _connection?.send({
          'type': 'change_pending',
          'filepath': filepath,
          'change_type': changeType,
          'file_size': await File(localPath).length(),
          'modified_at':
              (await File(localPath).lastModified()).millisecondsSinceEpoch /
              1000.0,
        });

        _addLog('Notified PC: $filepath ($changeType)');
      }

      _lastLocalTree = currentTree;
    } catch (e) {
      debugPrint('[sync] Local watch error: $e');
    }
  }

  // ─── Helpers ────────────────────────────────────────────────────────────

  Future<void> _refreshFileList() async {
    _files.clear();
    final dir = Directory(_syncFolder);
    if (!await dir.exists()) return;

    await for (final entity in dir.list(recursive: true)) {
      if (entity is File) {
        final stat = await entity.stat();
        final relPath = entity.path
            .replaceFirst('$_syncFolder${Platform.pathSeparator}', '')
            .replaceFirst('$_syncFolder/', '')
            .replaceAll('\\', '/');

        _files.add(
          SyncedFile(path: relPath, size: stat.size, modified: stat.modified),
        );
      }
    }

    _files.sort((a, b) => b.modified.compareTo(a.modified));
    notifyListeners();
  }

  /// Force refresh the file list (callable from UI after edits).
  Future<void> refreshFiles() async {
    await _refreshFileList();
  }

  void _setStatus(SyncStatus newStatus, String message) {
    _status = newStatus;
    _statusMessage = message;
    notifyListeners();
  }

  void _addLog(String message) {
    final timestamp = DateTime.now().toIso8601String().substring(11, 19);
    _syncLog.insert(0, '[$timestamp] $message');
    if (_syncLog.length > 100) _syncLog.removeLast();
    debugPrint('[sync] $message');
    notifyListeners();
  }

  Future<void> _rebindTransport(SyncConnection transport) async {
    await _connection?.disconnect();
    await _connectionStateSub?.cancel();
    _connection?.dispose();

    _connection = transport;
    _connectionStateSub = _connection!.stateStream.listen((state) {
      switch (state) {
        case SyncConnectionState.disconnected:
          _setStatus(SyncStatus.discovering, _disconnectedMessageForProfile());
          if (_connectionProfile == _ConnectionProfile.lan) {
            _connectedAddress = null;
          }
          // Clear pending changes on disconnect — they're no longer valid
          _pendingChanges.clear();
          _awaitingPcApproval.clear();
          notifyListeners();
        case SyncConnectionState.connecting:
          _setStatus(SyncStatus.connecting, _connectingMessageForProfile());
        case SyncConnectionState.connected:
          _setStatus(SyncStatus.syncing, _syncingMessageForProfile());
      }
    });
  }

  String _disconnectedMessageForProfile() {
    switch (_connectionProfile) {
      case _ConnectionProfile.lan:
        return 'Searching for PC on WiFi...';
      case _ConnectionProfile.remote:
        return 'Waiting for remote peer...';
    }
  }

  String _connectingMessageForProfile() {
    switch (_connectionProfile) {
      case _ConnectionProfile.lan:
        return 'Connecting to PC...';
      case _ConnectionProfile.remote:
        return 'Connecting to remote peer...';
    }
  }

  String _syncingMessageForProfile() {
    switch (_connectionProfile) {
      case _ConnectionProfile.lan:
        return 'Performing handshake...';
      case _ConnectionProfile.remote:
        return 'Establishing remote sync...';
    }
  }

  @override
  void dispose() {
    _watchTimer?.cancel();
    _mdns.dispose();
    _connectionStateSub?.cancel();
    _connection?.dispose();
    VectorClockStore.close();
    super.dispose();
  }
}

enum _ConnectionProfile { lan, remote }
