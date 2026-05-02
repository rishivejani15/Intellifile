// lib/widgets/pending_sync_banner.dart
//
// Displays pending sync changes from PC with approve/reject controls.
// Appears as an animated banner above the file list when changes are waiting.

import 'package:flutter/material.dart';
import '../sync/sync_manager.dart';

class PendingSyncBanner extends StatelessWidget {
  final List<PendingChange> pendingChanges;
  final Future<void> Function(String filepath) onApprove;
  final Future<void> Function(String filepath) onReject;
  final Future<void> Function() onApproveAll;
  final Future<void> Function() onRejectAll;

  const PendingSyncBanner({
    super.key,
    required this.pendingChanges,
    required this.onApprove,
    required this.onReject,
    required this.onApproveAll,
    required this.onRejectAll,
  });

  @override
  Widget build(BuildContext context) {
    if (pendingChanges.isEmpty) return const SizedBox.shrink();

    return Container(
      margin: const EdgeInsets.symmetric(horizontal: 16, vertical: 6),
      decoration: BoxDecoration(
        gradient: const LinearGradient(
          colors: [Color(0xFF2D1B69), Color(0xFF1A1A2E)],
          begin: Alignment.topLeft,
          end: Alignment.bottomRight,
        ),
        borderRadius: BorderRadius.circular(16),
        border: Border.all(
          color: const Color(0xFF6C5CE7).withOpacity(0.3),
          width: 1,
        ),
        boxShadow: [
          BoxShadow(
            color: const Color(0xFF6C5CE7).withOpacity(0.15),
            blurRadius: 16,
            offset: const Offset(0, 4),
          ),
        ],
      ),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          // ── Header ──────────────────────────────────────────────────────
          Padding(
            padding: const EdgeInsets.fromLTRB(16, 14, 16, 0),
            child: Row(
              children: [
                Container(
                  width: 32,
                  height: 32,
                  decoration: BoxDecoration(
                    color: const Color(0xFF6C5CE7).withOpacity(0.2),
                    borderRadius: BorderRadius.circular(8),
                  ),
                  child: const Icon(
                    Icons.sync_problem,
                    color: Color(0xFFA29BFE),
                    size: 18,
                  ),
                ),
                const SizedBox(width: 10),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        pendingChanges.length == 1
                            ? 'Incoming Change'
                            : '${pendingChanges.length} Incoming Changes',
                        style: const TextStyle(
                          fontSize: 14,
                          fontWeight: FontWeight.w700,
                          color: Colors.white,
                        ),
                      ),
                      Text(
                        'Changes detected on PC',
                        style: TextStyle(
                          fontSize: 11,
                          color: Colors.white.withOpacity(0.5),
                        ),
                      ),
                    ],
                  ),
                ),
              ],
            ),
          ),

          const SizedBox(height: 10),

          // ── File list (show up to 3, collapse rest) ─────────────────────
          ...pendingChanges.take(3).map((change) => _buildChangeItem(change)),
          if (pendingChanges.length > 3)
            Padding(
              padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 4),
              child: Text(
                '+${pendingChanges.length - 3} more changes',
                style: TextStyle(
                  fontSize: 11,
                  color: Colors.white.withOpacity(0.4),
                  fontStyle: FontStyle.italic,
                ),
              ),
            ),

          const SizedBox(height: 8),

          // ── Action buttons ──────────────────────────────────────────────
          Padding(
            padding: const EdgeInsets.fromLTRB(12, 0, 12, 12),
            child: Row(
              children: [
                // Skip All
                Expanded(
                  child: _ActionButton(
                    label: 'Skip All',
                    icon: Icons.close,
                    color: Colors.white.withOpacity(0.5),
                    backgroundColor: Colors.white.withOpacity(0.06),
                    onTap: onRejectAll,
                  ),
                ),
                const SizedBox(width: 8),
                // Sync All
                Expanded(
                  flex: 2,
                  child: _ActionButton(
                    label: pendingChanges.length == 1
                        ? 'Sync Now'
                        : 'Sync All (${pendingChanges.length})',
                    icon: Icons.sync,
                    color: Colors.white,
                    backgroundColor: const Color(0xFF6C5CE7),
                    onTap: onApproveAll,
                  ),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildChangeItem(PendingChange change) {
    final fileName = change.filepath.split('/').last;
    final ext = fileName.contains('.')
        ? fileName.split('.').last.toLowerCase()
        : '';
    final icon = _iconForExtension(ext);
    final iconColor = _colorForExtension(ext);

    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 3),
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
        decoration: BoxDecoration(
          color: Colors.white.withOpacity(0.04),
          borderRadius: BorderRadius.circular(10),
        ),
        child: Row(
          children: [
            // File icon
            Container(
              width: 32,
              height: 32,
              decoration: BoxDecoration(
                color: iconColor.withOpacity(0.12),
                borderRadius: BorderRadius.circular(8),
              ),
              child: Icon(icon, color: iconColor, size: 16),
            ),
            const SizedBox(width: 10),
            // File info
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    fileName,
                    style: const TextStyle(
                      fontSize: 13,
                      fontWeight: FontWeight.w600,
                      color: Colors.white,
                    ),
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                  ),
                  Text(
                    '${_formatChangeType(change.changeType)} · ${_formatSize(change.fileSize)}',
                    style: TextStyle(
                      fontSize: 10,
                      color: Colors.white.withOpacity(0.4),
                    ),
                  ),
                ],
              ),
            ),
            // Individual file actions
            if (pendingChanges.length > 1) ...[
              _SmallIconButton(
                icon: Icons.close,
                color: Colors.white.withOpacity(0.3),
                onTap: () => onReject(change.filepath),
                tooltip: 'Skip',
              ),
              const SizedBox(width: 4),
              _SmallIconButton(
                icon: Icons.check,
                color: const Color(0xFF00B894),
                onTap: () => onApprove(change.filepath),
                tooltip: 'Sync',
              ),
            ],
          ],
        ),
      ),
    );
  }

  String _formatChangeType(String type) {
    switch (type) {
      case 'modified':
        return 'Modified';
      case 'added':
        return 'New file';
      case 'deleted':
        return 'Deleted';
      default:
        return 'Changed';
    }
  }

  String _formatSize(int bytes) {
    if (bytes <= 0) return 'Unknown size';
    if (bytes < 1024) return '$bytes B';
    if (bytes < 1024 * 1024) return '${(bytes / 1024).toStringAsFixed(1)} KB';
    return '${(bytes / (1024 * 1024)).toStringAsFixed(1)} MB';
  }

  IconData _iconForExtension(String ext) {
    switch (ext) {
      case 'txt':
      case 'md':
        return Icons.text_snippet;
      case 'pdf':
        return Icons.picture_as_pdf;
      case 'doc':
      case 'docx':
        return Icons.description;
      case 'jpg':
      case 'jpeg':
      case 'png':
      case 'gif':
        return Icons.image;
      case 'py':
      case 'js':
      case 'dart':
      case 'ts':
      case 'java':
        return Icons.code;
      default:
        return Icons.insert_drive_file;
    }
  }

  Color _colorForExtension(String ext) {
    switch (ext) {
      case 'txt':
      case 'md':
        return const Color(0xFFA29BFE);
      case 'pdf':
        return const Color(0xFFE74C3C);
      case 'doc':
      case 'docx':
        return const Color(0xFF2980B9);
      case 'jpg':
      case 'jpeg':
      case 'png':
        return const Color(0xFF9B59B6);
      case 'py':
      case 'js':
      case 'dart':
        return const Color(0xFF00B894);
      default:
        return const Color(0xFF6C5CE7);
    }
  }
}

// ─── Supporting widgets ─────────────────────────────────────────────────────

class _ActionButton extends StatelessWidget {
  final String label;
  final IconData icon;
  final Color color;
  final Color backgroundColor;
  final VoidCallback onTap;

  const _ActionButton({
    required this.label,
    required this.icon,
    required this.color,
    required this.backgroundColor,
    required this.onTap,
  });

  @override
  Widget build(BuildContext context) {
    return Material(
      color: Colors.transparent,
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(10),
        child: Container(
          padding: const EdgeInsets.symmetric(vertical: 10),
          decoration: BoxDecoration(
            color: backgroundColor,
            borderRadius: BorderRadius.circular(10),
          ),
          child: Row(
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              Icon(icon, size: 16, color: color),
              const SizedBox(width: 6),
              Text(
                label,
                style: TextStyle(
                  fontSize: 13,
                  fontWeight: FontWeight.w600,
                  color: color,
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _SmallIconButton extends StatelessWidget {
  final IconData icon;
  final Color color;
  final VoidCallback onTap;
  final String tooltip;

  const _SmallIconButton({
    required this.icon,
    required this.color,
    required this.onTap,
    required this.tooltip,
  });

  @override
  Widget build(BuildContext context) {
    return Tooltip(
      message: tooltip,
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(6),
        child: Container(
          width: 28,
          height: 28,
          decoration: BoxDecoration(
            color: color.withOpacity(0.1),
            borderRadius: BorderRadius.circular(6),
          ),
          child: Icon(icon, size: 14, color: color),
        ),
      ),
    );
  }
}
