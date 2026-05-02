// lib/screens/home_screen.dart
//
// Main screen — shows connection status, pending sync banner,
// synced files with full actions, and sync activity log.

import 'package:flutter/material.dart';
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
                color: const Color(0xFF1A1A2E),
                borderRadius: BorderRadius.circular(12),
              ),
              child: TabBar(
                controller: _tabController,
                indicator: BoxDecoration(
                  color: const Color(0xFF6C5CE7),
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
      floatingActionButton: FloatingActionButton.extended(
        onPressed: () => _showConnectionSheet(context),
        backgroundColor: const Color(0xFF6C5CE7),
        foregroundColor: Colors.white,
        icon: const Icon(Icons.link),
        label: const Text('Connect'),
      ),
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
                colors: [Color(0xFF6C5CE7), Color(0xFFA29BFE)],
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
              color: const Color(0xFF1A1A2E),
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
          bgColor = const Color(0xFF1A1A2E);
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

  Future<void> _showConnectionSheet(BuildContext context) async {
    var isLanMode = true;
    var isInitiator = true;

    try {
      await showModalBottomSheet(
        context: context,
        isScrollControlled: true,
        backgroundColor: const Color(0xFF1A1A2E),
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
                            fillColor: const Color(0xFF6C5CE7),
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
                                fillColor: const Color(0xFF0D0D1A),
                                border: OutlineInputBorder(
                                  borderRadius: BorderRadius.circular(12),
                                  borderSide: BorderSide.none,
                                ),
                                prefixIcon: const Icon(
                                  Icons.computer,
                                  color: Color(0xFF6C5CE7),
                                ),
                              ),
                              keyboardType: TextInputType.url,
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
                                fillColor: const Color(0xFF0D0D1A),
                                border: OutlineInputBorder(
                                  borderRadius: BorderRadius.circular(12),
                                  borderSide: BorderSide.none,
                                ),
                                prefixIcon: const Icon(
                                  Icons.hub,
                                  color: Color(0xFF6C5CE7),
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
                                fillColor: const Color(0xFF0D0D1A),
                                border: OutlineInputBorder(
                                  borderRadius: BorderRadius.circular(12),
                                  borderSide: BorderSide.none,
                                ),
                                prefixIcon: const Icon(
                                  Icons.vpn_key,
                                  color: Color(0xFF6C5CE7),
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
                              fillColor: const Color(0xFF6C5CE7),
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
                                        sessionId.isEmpty)
                                      return;
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
                                backgroundColor: const Color(0xFF6C5CE7),
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
