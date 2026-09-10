// lib/screens/home_screen.dart
//
// Main screen — shows connection status, pending sync banner,
// synced files with full actions, and sync activity log.

import 'package:flutter/material.dart';
import 'package:mobile_scanner/mobile_scanner.dart';
import 'package:file_picker/file_picker.dart';
import '../sync/sync_manager.dart';
import '../widgets/sync_status_bar.dart';
import '../widgets/file_list_tile.dart';
import '../widgets/pending_sync_banner.dart';

class HomeScreen extends StatefulWidget {
  final SyncManager syncManager;

  const HomeScreen({super.key, required this.syncManager});

  @override
  State<HomeScreen> createState() => _HomeScreenState();
}

class _HomeScreenState extends State<HomeScreen>
    with SingleTickerProviderStateMixin {
  late TabController _tabController;
  final _manualIpController = TextEditingController();
  final _signalingUrlController = TextEditingController(
    text: 'https://intellifile-signaling.onrender.com',
  );
  final _sessionIdController = TextEditingController();

  @override
  void initState() {
    super.initState();
    _tabController = TabController(length: 2, vsync: this);
    final lastLan = widget.syncManager.lastLanAddress;
    if (lastLan != null && lastLan.isNotEmpty) {
      _manualIpController.text = lastLan;
    }
    widget.syncManager.addListener(_onSyncUpdate);
  }

  @override
  void dispose() {
    widget.syncManager.removeListener(_onSyncUpdate);
    _tabController.dispose();
    _manualIpController.dispose();
    _signalingUrlController.dispose();
    _sessionIdController.dispose();
    super.dispose();
  }

  void _onSyncUpdate() {
    if (mounted) setState(() {});
  }

  String? _extractLanAddress(String raw) {
    final trimmed = raw.trim();
    if (trimmed.isEmpty) return null;

    // 1. Custom scheme: intellifile://connect?addr=IP:PORT&v=1
    final uri = Uri.tryParse(trimmed);
    if (uri != null && uri.scheme == 'intellifile') {
      final addr = uri.queryParameters['addr'];
      if (addr != null && addr.isNotEmpty) {
        debugPrint('[qr] Parsed intellifile:// addr=$addr');
        return addr;
      }
    }

    // 2. Legacy http:// format: http://IP:PORT
    if (uri != null && (uri.scheme == 'http' || uri.scheme == 'https')) {
      final host = uri.host;
      if (host.isNotEmpty) {
        final port = uri.hasPort ? uri.port : 8765;
        return '$host:$port';
      }
    }

    // 3. Raw IP:PORT
    final ipPort = RegExp(r'^(\d{1,3}\.){3}\d{1,3}:\d{2,5}$');
    if (ipPort.hasMatch(trimmed)) return trimmed;

    // 4. Raw IP without port
    final ipOnly = RegExp(r'^(\d{1,3}\.){3}\d{1,3}$');
    if (ipOnly.hasMatch(trimmed)) return '$trimmed:8765';

    return null;
  }

  Future<String?> _scanLanQr(BuildContext context) async {
    final raw = await Navigator.of(
      context,
    ).push<String>(MaterialPageRoute(builder: (_) => const QrScanScreen()));
    if (raw == null) return null;
    debugPrint('[qr] Raw QR value: $raw');
    return _extractLanAddress(raw);
  }

  @override
  Widget build(BuildContext context) {
    final sm = widget.syncManager;

    return Scaffold(
      body: SafeArea(
        child: Column(
          children: [
            // ── Header ───────────────────────────────────────────────────
            _buildHeader(sm),

            // ── Connection Status ────────────────────────────────────────
            SyncStatusBar(
              status: sm.status,
              message: sm.statusMessage,
              address: sm.connectedAddress,
              pendingSyncs: sm.pendingSyncs,
            ),

            // ── Connected Device Info ─────────────────────────────────────
            if (sm.isConnected && sm.connectedAddress != null)
              Container(
                margin: const EdgeInsets.symmetric(horizontal: 16, vertical: 4),
                padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
                decoration: BoxDecoration(
                  color: const Color(0xFF18181B),
                  borderRadius: BorderRadius.circular(12),
                  border: Border.all(
                    color: const Color(0xFF3FA372).withOpacity(0.2),
                  ),
                ),
                child: Row(
                  children: [
                    Container(
                      width: 36,
                      height: 36,
                      decoration: BoxDecoration(
                        color: const Color(0xFF3FA372).withOpacity(0.12),
                        borderRadius: BorderRadius.circular(10),
                      ),
                      child: const Icon(
                        Icons.computer,
                        color: Color(0xFF3FA372),
                        size: 18,
                      ),
                    ),
                    const SizedBox(width: 12),
                    Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          const Text(
                            'Connected Device',
                            style: TextStyle(
                              fontSize: 12,
                              fontWeight: FontWeight.w700,
                              color: Colors.white,
                            ),
                          ),
                          const SizedBox(height: 2),
                          Text(
                            sm.connectedAddress!,
                            style: TextStyle(
                              fontSize: 11,
                              fontFamily: 'monospace',
                              color: Colors.white.withOpacity(0.5),
                            ),
                          ),
                        ],
                      ),
                    ),
                    Container(
                      padding: const EdgeInsets.symmetric(
                        horizontal: 8,
                        vertical: 4,
                      ),
                      decoration: BoxDecoration(
                        color: const Color(0xFF3FA372).withOpacity(0.15),
                        borderRadius: BorderRadius.circular(6),
                      ),
                      child: Row(
                        mainAxisSize: MainAxisSize.min,
                        children: [
                          Container(
                            width: 6,
                            height: 6,
                            decoration: const BoxDecoration(
                              color: Color(0xFF3FA372),
                              shape: BoxShape.circle,
                            ),
                          ),
                          const SizedBox(width: 4),
                          const Text(
                            'LIVE',
                            style: TextStyle(
                              fontSize: 9,
                              fontWeight: FontWeight.w700,
                              color: Color(0xFF3FA372),
                              letterSpacing: 0.5,
                            ),
                          ),
                        ],
                      ),
                    ),
                  ],
                ),
              ),

            // ── Pending Sync Banner ──────────────────────────────────────
            if (sm.hasPendingChanges)
              PendingSyncBanner(
                pendingChanges: sm.pendingChanges,
                onApprove: (filepath) => sm.approvePendingChange(filepath),
                onReject: (filepath) => sm.rejectPendingChange(filepath),
                onApproveAll: () => sm.approveAllPending(),
                onRejectAll: () => sm.rejectAllPending(),
              ),

            // ── Tabs ─────────────────────────────────────────────────────
            Container(
              margin: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
              decoration: BoxDecoration(
                color: const Color(0xFF18181B),
                borderRadius: BorderRadius.circular(12),
              ),
              child: TabBar(
                controller: _tabController,
                indicator: BoxDecoration(
                  color: const Color(0xFF3FA372),
                  borderRadius: BorderRadius.circular(12),
                ),
                indicatorSize: TabBarIndicatorSize.tab,
                dividerColor: Colors.transparent,
                labelColor: Colors.white,
                unselectedLabelColor: Colors.white54,
                labelStyle: const TextStyle(
                  fontSize: 13,
                  fontWeight: FontWeight.w600,
                ),
                tabs: [
                  Tab(text: 'Files (${sm.files.length})'),
                  Tab(text: 'Activity (${sm.syncLog.length})'),
                ],
              ),
            ),

            // ── Tab content ──────────────────────────────────────────────
            Expanded(
              child: TabBarView(
                controller: _tabController,
                children: [_buildFilesTab(sm), _buildLogTab(sm)],
              ),
            ),
          ],
        ),
      ),
      floatingActionButton: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          FloatingActionButton.extended(
            heroTag: 'addFiles',
            onPressed: () => _handleAddFiles(context),
            backgroundColor: const Color(0xFF3FA372),
            foregroundColor: Colors.white,
            icon: const Icon(Icons.add),
            label: const Text('Add Files'),
          ),
          const SizedBox(width: 12),
          if (sm.isConnected)
            FloatingActionButton.extended(
              heroTag: 'disconnect',
              onPressed: () => _handleDisconnect(context),
              backgroundColor: Colors.redAccent,
              foregroundColor: Colors.white,
              icon: const Icon(Icons.link_off),
              label: const Text('Disconnect'),
            )
          else
            FloatingActionButton.extended(
              heroTag: 'connect',
              onPressed: () => _showConnectionSheet(context),
              backgroundColor: const Color(0xFF3FA372).withOpacity(0.85),
              foregroundColor: Colors.white,
              icon: const Icon(Icons.link),
              label: const Text('Connect'),
            ),
        ],
      ),
      floatingActionButtonLocation: FloatingActionButtonLocation.centerFloat,
    );
  }

  Widget _buildHeader(SyncManager sm) {
    return Padding(
      padding: const EdgeInsets.fromLTRB(20, 16, 20, 4),
      child: Row(
        children: [
          Container(
            width: 44,
            height: 44,
            decoration: BoxDecoration(
              gradient: const LinearGradient(
                colors: [Color(0xFF3FA372), Color(0xFF5DC08C)],
                begin: Alignment.topLeft,
                end: Alignment.bottomRight,
              ),
              borderRadius: BorderRadius.circular(12),
            ),
            child: const Icon(Icons.sync, color: Colors.white, size: 24),
          ),
          const SizedBox(width: 12),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                const Text(
                  'IntelliFile',
                  style: TextStyle(
                    fontSize: 22,
                    fontWeight: FontWeight.bold,
                    color: Colors.white,
                    letterSpacing: -0.5,
                  ),
                ),
                Text(
                  'Cross-Device File Sync',
                  style: TextStyle(
                    fontSize: 12,
                    color: Colors.white.withOpacity(0.5),
                  ),
                ),
              ],
            ),
          ),
          // Pending badge + file count
          if (sm.hasPendingChanges)
            Container(
              margin: const EdgeInsets.only(right: 8),
              padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
              decoration: BoxDecoration(
                color: const Color(0xFFFFA62B).withOpacity(0.15),
                borderRadius: BorderRadius.circular(8),
              ),
              child: Row(
                mainAxisSize: MainAxisSize.min,
                children: [
                  const Icon(
                    Icons.sync_problem,
                    size: 12,
                    color: Color(0xFFFFA62B),
                  ),
                  const SizedBox(width: 4),
                  Text(
                    '${sm.pendingChangeCount}',
                    style: const TextStyle(
                      fontSize: 11,
                      fontWeight: FontWeight.w700,
                      color: Color(0xFFFFA62B),
                    ),
                  ),
                ],
              ),
            ),
          Container(
            padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
            decoration: BoxDecoration(
              color: const Color(0xFF18181B),
              borderRadius: BorderRadius.circular(8),
            ),
            child: Row(
              mainAxisSize: MainAxisSize.min,
              children: [
                Icon(
                  Icons.folder,
                  size: 14,
                  color: Colors.white.withOpacity(0.5),
                ),
                const SizedBox(width: 4),
                Text(
                  '${sm.files.length}',
                  style: const TextStyle(
                    fontSize: 12,
                    fontWeight: FontWeight.w600,
                    color: Colors.white70,
                  ),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildFilesTab(SyncManager sm) {
    if (sm.files.isEmpty) {
      return Center(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(
              Icons.cloud_off,
              size: 64,
              color: Colors.white.withOpacity(0.2),
            ),
            const SizedBox(height: 16),
            Text(
              'No files synced yet',
              style: TextStyle(
                fontSize: 16,
                color: Colors.white.withOpacity(0.4),
              ),
            ),
            const SizedBox(height: 8),
            Text(
              'Add files to the sync folder on your PC\nand they will appear here.',
              textAlign: TextAlign.center,
              style: TextStyle(
                fontSize: 13,
                color: Colors.white.withOpacity(0.25),
              ),
            ),
          ],
        ),
      );
    }

    return ListView.builder(
      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 4),
      itemCount: sm.files.length,
      itemBuilder: (context, index) => FileListTile(
        file: sm.files[index],
        syncFolder: sm.syncFolder,
        syncManager: sm,
      ),
    );
  }

  Widget _buildLogTab(SyncManager sm) {
    if (sm.syncLog.isEmpty) {
      return Center(
        child: Text(
          'No sync activity yet',
          style: TextStyle(fontSize: 14, color: Colors.white.withOpacity(0.4)),
        ),
      );
    }

    return ListView.builder(
      padding: const EdgeInsets.all(16),
      itemCount: sm.syncLog.length,
      itemBuilder: (context, index) {
        final log = sm.syncLog[index];
        final isError = log.contains('Error') || log.contains('⚠');
        final isPending = log.contains('pending') || log.contains('Notified');
        final isApproved = log.contains('Approved') || log.contains('Synced');

        Color bgColor;
        Color textColor;
        if (isError) {
          bgColor = Colors.redAccent.withOpacity(0.08);
          textColor = Colors.redAccent.withOpacity(0.9);
        } else if (isPending) {
          bgColor = const Color(0xFFFFA62B).withOpacity(0.06);
          textColor = const Color(0xFFFFA62B).withOpacity(0.8);
        } else if (isApproved) {
          bgColor = const Color(0xFF00B894).withOpacity(0.06);
          textColor = const Color(0xFF00B894).withOpacity(0.8);
        } else {
          bgColor = const Color(0xFF18181B);
          textColor = Colors.white.withOpacity(0.7);
        }

        return Container(
          margin: const EdgeInsets.only(bottom: 4),
          padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
          decoration: BoxDecoration(
            color: bgColor,
            borderRadius: BorderRadius.circular(8),
          ),
          child: Text(
            log,
            style: TextStyle(
              fontSize: 12,
              fontFamily: 'monospace',
              color: textColor,
            ),
          ),
        );
      },
    );
  }

  Future<void> _handleDisconnect(BuildContext context) async {
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        backgroundColor: const Color(0xFF18181B),
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
        title: const Text(
          'Disconnect?',
          style: TextStyle(color: Colors.white, fontWeight: FontWeight.w700),
        ),
        content: Text(
          'Disconnect from ${widget.syncManager.connectedAddress ?? 'the current device'}? You can reconnect later.',
          style: TextStyle(color: Colors.white.withOpacity(0.7)),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(context, false),
            child: Text(
              'Cancel',
              style: TextStyle(color: Colors.white.withOpacity(0.5)),
            ),
          ),
          ElevatedButton(
            onPressed: () => Navigator.pop(context, true),
            style: ElevatedButton.styleFrom(
              backgroundColor: Colors.redAccent,
              foregroundColor: Colors.white,
              shape: RoundedRectangleBorder(
                borderRadius: BorderRadius.circular(8),
              ),
            ),
            child: const Text('Disconnect'),
          ),
        ],
      ),
    );

    if (confirmed == true) {
      await widget.syncManager.disconnect();
      if (!context.mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(
          content: Row(
            children: [
              Icon(Icons.link_off, color: Colors.white, size: 18),
              SizedBox(width: 8),
              Text('Disconnected from device'),
            ],
          ),
          backgroundColor: Color(0xFF636e72),
          behavior: SnackBarBehavior.floating,
        ),
      );
    }
  }

  Future<void> _handleAddFiles(BuildContext context) async {
    try {
      final result = await FilePicker.platform.pickFiles(
        allowMultiple: true,
        type: FileType.any,
      );

      if (result == null || result.files.isEmpty) return;

      final paths = result.files
          .where((f) => f.path != null)
          .map((f) => f.path!)
          .toList();

      if (paths.isEmpty) return;

      final added = await widget.syncManager.addFilesToSync(paths);

      if (!context.mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Row(
            children: [
              const Icon(Icons.check_circle, color: Colors.white, size: 18),
              const SizedBox(width: 8),
              Text(added > 0
                  ? 'Added $added file${added != 1 ? 's' : ''} to sync'
                  : 'No files were added'),
            ],
          ),
          backgroundColor: added > 0
              ? const Color(0xFF3FA372)
              : const Color(0xFF636e72),
          behavior: SnackBarBehavior.floating,
        ),
      );
    } catch (e) {
      if (!context.mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text('Failed to add files: $e'),
          backgroundColor: Colors.redAccent,
          behavior: SnackBarBehavior.floating,
        ),
      );
    }
  }

  Future<void> _showConnectionSheet(BuildContext context) async {
    var isLanMode = true;
    var isInitiator = true;

    try {
      await showModalBottomSheet(
        context: context,
        isScrollControlled: true,
        backgroundColor: const Color(0xFF18181B),
        shape: const RoundedRectangleBorder(
          borderRadius: BorderRadius.vertical(top: Radius.circular(20)),
        ),
        builder: (context) {
          return StatefulBuilder(
            builder: (context, setModalState) {
              final bottomInset = MediaQuery.viewInsetsOf(context).bottom;
              return SafeArea(
                top: false,
                child: AnimatedPadding(
                  duration: const Duration(milliseconds: 180),
                  curve: Curves.easeOut,
                  padding: EdgeInsets.only(bottom: bottomInset),
                  child: SingleChildScrollView(
                    child: Padding(
                      padding: const EdgeInsets.fromLTRB(24, 24, 24, 24),
                      child: Column(
                        mainAxisSize: MainAxisSize.min,
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          const Text(
                            'Connect',
                            style: TextStyle(
                              fontSize: 18,
                              fontWeight: FontWeight.bold,
                              color: Colors.white,
                            ),
                          ),
                          const SizedBox(height: 12),
                          ToggleButtons(
                            isSelected: [isLanMode, !isLanMode],
                            onPressed: (index) {
                              setModalState(() {
                                isLanMode = index == 0;
                              });
                            },
                            borderRadius: BorderRadius.circular(10),
                            fillColor: const Color(0xFF3FA372),
                            selectedColor: Colors.white,
                            color: Colors.white70,
                            constraints: const BoxConstraints(
                              minHeight: 40,
                              minWidth: 96,
                            ),
                            children: const [Text('LAN'), Text('Remote')],
                          ),
                          const SizedBox(height: 16),
                          if (isLanMode) ...[
                            Text(
                              'Enter your PC address (shown in server console)',
                              style: TextStyle(
                                fontSize: 13,
                                color: Colors.white.withOpacity(0.5),
                              ),
                            ),
                            const SizedBox(height: 12),
                            TextField(
                              controller: _manualIpController,
                              style: const TextStyle(color: Colors.white),
                              textInputAction: TextInputAction.done,
                              decoration: InputDecoration(
                                hintText: '192.168.1.100:8765',
                                hintStyle: TextStyle(
                                  color: Colors.white.withOpacity(0.3),
                                ),
                                filled: true,
                                fillColor: const Color(0xFF09090B),
                                border: OutlineInputBorder(
                                  borderRadius: BorderRadius.circular(12),
                                  borderSide: BorderSide.none,
                                ),
                                prefixIcon: const Icon(
                                  Icons.computer,
                                  color: Color(0xFF3FA372),
                                ),
                              ),
                              keyboardType: TextInputType.url,
                            ),
                            const SizedBox(height: 10),
                            SizedBox(
                              width: double.infinity,
                              height: 44,
                              child: OutlinedButton.icon(
                                onPressed: () async {
                                  final address = await _scanLanQr(context);
                                  if (address == null || address.isEmpty) {
                                    if (!context.mounted) return;
                                    ScaffoldMessenger.of(context).showSnackBar(
                                      const SnackBar(
                                        content: Text('Could not read a valid address from QR code'),
                                        backgroundColor: Colors.redAccent,
                                      ),
                                    );
                                    return;
                                  }

                                  _manualIpController.text = address;

                                  if (!context.mounted) return;
                                  ScaffoldMessenger.of(context).showSnackBar(
                                    SnackBar(
                                      content: Text('Connecting to $address...'),
                                      backgroundColor: const Color(0xFF3FA372),
                                      duration: const Duration(seconds: 2),
                                    ),
                                  );

                                  try {
                                    await widget.syncManager.connectManually(
                                      address,
                                    );
                                    if (context.mounted) {
                                      Navigator.pop(context);
                                    }
                                  } catch (e) {
                                    if (!context.mounted) return;
                                    ScaffoldMessenger.of(context).showSnackBar(
                                      SnackBar(
                                        content: Text('Connection failed: ${e.toString().length > 80 ? '${e.toString().substring(0, 80)}…' : e}'),
                                        backgroundColor: Colors.redAccent,
                                        duration: const Duration(seconds: 4),
                                      ),
                                    );
                                  }
                                },
                                style: OutlinedButton.styleFrom(
                                  side: const BorderSide(
                                    color: Color(0xFF3FA372),
                                  ),
                                  foregroundColor: Colors.white,
                                  backgroundColor: const Color(0xFF0F0F12),
                                  shape: RoundedRectangleBorder(
                                    borderRadius: BorderRadius.circular(12),
                                  ),
                                ),
                                icon: const Icon(Icons.qr_code_scanner),
                                label: const Text('Scan QR'),
                              ),
                            ),
                          ] else ...[
                            TextField(
                              controller: _signalingUrlController,
                              style: const TextStyle(color: Colors.white),
                              textInputAction: TextInputAction.next,
                              decoration: InputDecoration(
                                labelText: 'Signaling URL',
                                labelStyle: TextStyle(
                                  color: Colors.white.withOpacity(0.6),
                                ),
                                hintText:
                                    'https://intellifile-signaling.onrender.com',
                                hintStyle: TextStyle(
                                  color: Colors.white.withOpacity(0.3),
                                ),
                                filled: true,
                                fillColor: const Color(0xFF09090B),
                                border: OutlineInputBorder(
                                  borderRadius: BorderRadius.circular(12),
                                  borderSide: BorderSide.none,
                                ),
                                prefixIcon: const Icon(
                                  Icons.hub,
                                  color: Color(0xFF3FA372),
                                ),
                              ),
                              keyboardType: TextInputType.url,
                            ),
                            const SizedBox(height: 12),
                            TextField(
                              controller: _sessionIdController,
                              style: const TextStyle(color: Colors.white),
                              textInputAction: TextInputAction.done,
                              decoration: InputDecoration(
                                labelText: 'Session Code',
                                labelStyle: TextStyle(
                                  color: Colors.white.withOpacity(0.6),
                                ),
                                hintText: 'room-123',
                                hintStyle: TextStyle(
                                  color: Colors.white.withOpacity(0.3),
                                ),
                                filled: true,
                                fillColor: const Color(0xFF09090B),
                                border: OutlineInputBorder(
                                  borderRadius: BorderRadius.circular(12),
                                  borderSide: BorderSide.none,
                                ),
                                prefixIcon: const Icon(
                                  Icons.vpn_key,
                                  color: Color(0xFF3FA372),
                                ),
                              ),
                            ),
                            const SizedBox(height: 12),
                            ToggleButtons(
                              isSelected: [isInitiator, !isInitiator],
                              onPressed: (index) {
                                setModalState(() {
                                  isInitiator = index == 0;
                                });
                              },
                              borderRadius: BorderRadius.circular(10),
                              fillColor: const Color(0xFF3FA372),
                              selectedColor: Colors.white,
                              color: Colors.white70,
                              constraints: const BoxConstraints(
                                minHeight: 40,
                                minWidth: 96,
                              ),
                              children: const [Text('Host'), Text('Join')],
                            ),
                          ],
                          const SizedBox(height: 16),
                          SizedBox(
                            width: double.infinity,
                            height: 48,
                            child: ElevatedButton(
                              onPressed: () async {
                                try {
                                  if (isLanMode) {
                                    final address = _manualIpController.text
                                        .trim();
                                    if (address.isEmpty) return;
                                    await widget.syncManager.connectManually(
                                      address,
                                    );
                                  } else {
                                    final signalingUri = _signalingUrlController
                                        .text
                                        .trim();
                                    final sessionId = _sessionIdController.text
                                        .trim();
                                    if (signalingUri.isEmpty ||
                                        sessionId.isEmpty) {
                                      return;
                                    }
                                    await widget.syncManager.connectRemotely(
                                      signalingUri,
                                      sessionId,
                                      isInitiator,
                                    );
                                  }

                                  if (context.mounted) {
                                    Navigator.pop(context);
                                  }
                                } catch (_) {
                                  if (!context.mounted) return;
                                  ScaffoldMessenger.of(context).showSnackBar(
                                    const SnackBar(
                                      content: Text('Connection failed'),
                                    ),
                                  );
                                }
                              },
                              style: ElevatedButton.styleFrom(
                                backgroundColor: const Color(0xFF3FA372),
                                foregroundColor: Colors.white,
                                shape: RoundedRectangleBorder(
                                  borderRadius: BorderRadius.circular(12),
                                ),
                              ),
                              child: const Text(
                                'Connect',
                                style: TextStyle(fontWeight: FontWeight.w600),
                              ),
                            ),
                          ),
                        ],
                      ),
                    ),
                  ),
                ),
              );
            },
          );
        },
      );
    } finally {
      _manualIpController.clear();
      _sessionIdController.clear();
    }
  }
}

class QrScanScreen extends StatefulWidget {
  const QrScanScreen({super.key});

  @override
  State<QrScanScreen> createState() => _QrScanScreenState();
}

class _QrScanScreenState extends State<QrScanScreen> {
  final MobileScannerController _controller = MobileScannerController();
  bool _handled = false;

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('Scan QR'),
        backgroundColor: const Color(0xFF1A1A2E),
      ),
      body: Stack(
        children: [
          MobileScanner(
            controller: _controller,
            onDetect: (capture) {
              if (_handled) return;
              final barcode = capture.barcodes.isNotEmpty
                  ? capture.barcodes.first
                  : null;
              final raw = barcode?.rawValue;
              if (raw == null || raw.isEmpty) return;
              _handled = true;
              Navigator.of(context).pop(raw);
            },
          ),
          Positioned(
            left: 16,
            right: 16,
            bottom: 24,
            child: Container(
              padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
              decoration: BoxDecoration(
                color: Colors.black.withOpacity(0.6),
                borderRadius: BorderRadius.circular(12),
              ),
              child: const Text(
                'Point the camera at the QR code on your PC',
                textAlign: TextAlign.center,
                style: TextStyle(color: Colors.white),
              ),
            ),
          ),
        ],
      ),
    );
  }
}