// lib/widgets/sync_status_bar.dart
//
// Animated connection status indicator.

import 'package:flutter/material.dart';
import '../sync/sync_manager.dart';

class SyncStatusBar extends StatelessWidget {
  final SyncStatus status;
  final String message;
  final String? address;
  final int pendingSyncs;

  const SyncStatusBar({
    super.key,
    required this.status,
    required this.message,
    this.address,
    this.pendingSyncs = 0,
  });

  @override
  Widget build(BuildContext context) {
    return Container(
      margin: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        gradient: LinearGradient(
          colors: _gradientColors,
          begin: Alignment.topLeft,
          end: Alignment.bottomRight,
        ),
        borderRadius: BorderRadius.circular(16),
        boxShadow: [
          BoxShadow(
            color: _gradientColors.first.withOpacity(0.3),
            blurRadius: 12,
            offset: const Offset(0, 4),
          ),
        ],
      ),
      child: Row(
        children: [
          _buildIcon(),
          const SizedBox(width: 14),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  _title,
                  style: const TextStyle(
                    fontSize: 14,
                    fontWeight: FontWeight.w700,
                    color: Colors.white,
                  ),
                ),
                const SizedBox(height: 2),
                Text(
                  message,
                  style: TextStyle(
                    fontSize: 12,
                    color: Colors.white.withOpacity(0.7),
                  ),
                ),
                if (address != null) ...[
                  const SizedBox(height: 2),
                  Text(
                    address!,
                    style: TextStyle(
                      fontSize: 11,
                      fontFamily: 'monospace',
                      color: Colors.white.withOpacity(0.5),
                    ),
                  ),
                ],
              ],
            ),
          ),
          if (pendingSyncs > 0)
            Container(
              padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
              decoration: BoxDecoration(
                color: Colors.white.withOpacity(0.2),
                borderRadius: BorderRadius.circular(12),
              ),
              child: Text(
                '$pendingSyncs',
                style: const TextStyle(
                  fontSize: 12,
                  fontWeight: FontWeight.bold,
                  color: Colors.white,
                ),
              ),
            ),
        ],
      ),
    );
  }

  Widget _buildIcon() {
    final isAnimating =
        status == SyncStatus.syncing ||
        status == SyncStatus.connecting ||
        status == SyncStatus.discovering;

    Widget icon = Container(
      width: 40,
      height: 40,
      decoration: BoxDecoration(
        color: Colors.white.withOpacity(0.15),
        borderRadius: BorderRadius.circular(12),
      ),
      child: Icon(_iconData, color: Colors.white, size: 20),
    );

    if (isAnimating) {
      return _AnimatedSyncIcon(child: icon);
    }
    return icon;
  }

  String get _title {
    switch (status) {
      case SyncStatus.idle:
        return 'Initializing';
      case SyncStatus.discovering:
        return 'Discovering';
      case SyncStatus.connecting:
        return 'Connecting';
      case SyncStatus.syncing:
        return 'Syncing';
      case SyncStatus.synced:
        return 'Connected';
      case SyncStatus.error:
        return 'Error';
    }
  }

  IconData get _iconData {
    switch (status) {
      case SyncStatus.idle:
        return Icons.hourglass_empty;
      case SyncStatus.discovering:
        return Icons.wifi_find;
      case SyncStatus.connecting:
        return Icons.wifi;
      case SyncStatus.syncing:
        return Icons.sync;
      case SyncStatus.synced:
        return Icons.cloud_done;
      case SyncStatus.error:
        return Icons.error_outline;
    }
  }

  List<Color> get _gradientColors {
    switch (status) {
      case SyncStatus.idle:
      case SyncStatus.discovering:
        return [const Color(0xFF636e72), const Color(0xFF2d3436)];
      case SyncStatus.connecting:
        return [const Color(0xFFFFA62B), const Color(0xFFCC7A00)];
      case SyncStatus.syncing:
        return [const Color(0xFF6C5CE7), const Color(0xFF4834D4)];
      case SyncStatus.synced:
        return [const Color(0xFF00B894), const Color(0xFF00896B)];
      case SyncStatus.error:
        return [const Color(0xFFE74C3C), const Color(0xFFC0392B)];
    }
  }
}

// Pulsing animation for active sync states
class _AnimatedSyncIcon extends StatefulWidget {
  final Widget child;
  const _AnimatedSyncIcon({required this.child});

  @override
  State<_AnimatedSyncIcon> createState() => _AnimatedSyncIconState();
}

class _AnimatedSyncIconState extends State<_AnimatedSyncIcon>
    with SingleTickerProviderStateMixin {
  late AnimationController _controller;

  @override
  void initState() {
    super.initState();
    _controller = AnimationController(
      vsync: this,
      duration: const Duration(milliseconds: 1500),
    )..repeat();
  }

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return AnimatedBuilder(
      animation: _controller,
      builder: (context, child) {
        return Opacity(
          opacity: 0.5 + 0.5 * _controller.value,
          child: Transform.scale(
            scale: 0.95 + 0.05 * _controller.value,
            child: child,
          ),
        );
      },
      child: widget.child,
    );
  }
}
