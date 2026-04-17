// lib/widgets/file_list_tile.dart
//
// Individual file tile in the synced files list.
// Tap to open, long-press for action sheet (Open, Edit, Share, Copy, Remove).

import 'dart:io';
import 'package:flutter/material.dart';
import 'package:path/path.dart' as p;
import 'package:open_filex/open_filex.dart';
import 'package:share_plus/share_plus.dart';
import '../sync/sync_manager.dart';
import '../screens/file_editor_screen.dart';

class FileListTile extends StatelessWidget {
  final SyncedFile file;
  final String syncFolder;
  final SyncManager? syncManager;

  const FileListTile({
    super.key,
    required this.file,
    required this.syncFolder,
    this.syncManager,
  });

  @override
  Widget build(BuildContext context) {
    return InkWell(
      onTap: () => _openFile(context),
      onLongPress: () => _showActionSheet(context),
      borderRadius: BorderRadius.circular(14),
      child: Container(
        margin: const EdgeInsets.only(bottom: 8),
        padding: const EdgeInsets.all(14),
        decoration: BoxDecoration(
          color: const Color(0xFF1A1A2E),
          borderRadius: BorderRadius.circular(14),
          border: file.status == 'conflict'
              ? Border.all(color: Colors.orange.withOpacity(0.3))
              : null,
        ),
        child: Row(
          children: [
            // File icon
            Container(
              width: 42,
              height: 42,
              decoration: BoxDecoration(
                color: _iconColor.withOpacity(0.12),
                borderRadius: BorderRadius.circular(10),
              ),
              child: Icon(_icon, color: _iconColor, size: 20),
            ),
            const SizedBox(width: 12),

            // File info
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    _fileName,
                    style: const TextStyle(
                      fontSize: 14,
                      fontWeight: FontWeight.w600,
                      color: Colors.white,
                    ),
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                  ),
                  const SizedBox(height: 2),
                  Text(
                    _subtitle,
                    style: TextStyle(
                      fontSize: 11,
                      color: Colors.white.withOpacity(0.4),
                    ),
                  ),
                ],
              ),
            ),

            // Action menu button
            Material(
              color: Colors.transparent,
              child: InkWell(
                onTap: () => _showActionSheet(context),
                borderRadius: BorderRadius.circular(8),
                child: Container(
                  width: 32,
                  height: 32,
                  decoration: BoxDecoration(
                    color: Colors.white.withOpacity(0.04),
                    borderRadius: BorderRadius.circular(8),
                  ),
                  child: Icon(
                    Icons.more_vert,
                    size: 16,
                    color: Colors.white.withOpacity(0.4),
                  ),
                ),
              ),
            ),

            const SizedBox(width: 4),

            // Status indicator
            _buildStatusChip(),
          ],
        ),
      ),
    );
  }

  // ─── Action Sheet ───────────────────────────────────────────────────────

  void _showActionSheet(BuildContext context) {
    final absPath = p.join(syncFolder, file.path);
    final canEdit = isTextEditable(file.path);

    showModalBottomSheet(
      context: context,
      backgroundColor: Colors.transparent,
      isScrollControlled: true,
      builder: (context) => Container(
        decoration: const BoxDecoration(
          color: Color(0xFF1A1A2E),
          borderRadius: BorderRadius.vertical(top: Radius.circular(20)),
        ),
        child: SafeArea(
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              // Handle bar
              Container(
                margin: const EdgeInsets.only(top: 12),
                width: 36,
                height: 4,
                decoration: BoxDecoration(
                  color: Colors.white.withOpacity(0.2),
                  borderRadius: BorderRadius.circular(2),
                ),
              ),

              // File header
              Padding(
                padding: const EdgeInsets.fromLTRB(20, 20, 20, 8),
                child: Row(
                  children: [
                    Container(
                      width: 48,
                      height: 48,
                      decoration: BoxDecoration(
                        color: _iconColor.withOpacity(0.12),
                        borderRadius: BorderRadius.circular(12),
                      ),
                      child: Icon(_icon, color: _iconColor, size: 24),
                    ),
                    const SizedBox(width: 14),
                    Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(
                            _fileName,
                            style: const TextStyle(
                              fontSize: 16,
                              fontWeight: FontWeight.w700,
                              color: Colors.white,
                            ),
                            maxLines: 2,
                            overflow: TextOverflow.ellipsis,
                          ),
                          const SizedBox(height: 2),
                          Text(
                            _subtitle,
                            style: TextStyle(
                              fontSize: 12,
                              color: Colors.white.withOpacity(0.4),
                            ),
                          ),
                        ],
                      ),
                    ),
                  ],
                ),
              ),

              const Divider(
                color: Colors.white10,
                height: 24,
                indent: 20,
                endIndent: 20,
              ),

              // Actions
              _ActionItem(
                icon: Icons.open_in_new,
                label: 'Open',
                subtitle: 'Open with default app',
                color: const Color(0xFF6C5CE7),
                onTap: () {
                  Navigator.pop(context);
                  _openFile(context);
                },
              ),

              if (canEdit)
                _ActionItem(
                  icon: Icons.edit_note,
                  label: 'Edit',
                  subtitle: 'Edit in-app text editor',
                  color: const Color(0xFF00B894),
                  onTap: () {
                    Navigator.pop(context);
                    _editFile(context);
                  },
                ),

              _ActionItem(
                icon: Icons.share,
                label: 'Share',
                subtitle: 'Send via other apps',
                color: const Color(0xFF0984E3),
                onTap: () {
                  Navigator.pop(context);
                  _shareFile(context, absPath);
                },
              ),

              _ActionItem(
                icon: Icons.file_copy_outlined,
                label: 'Copy to Downloads',
                subtitle: 'Save a copy outside sync folder',
                color: const Color(0xFFFFA62B),
                onTap: () {
                  Navigator.pop(context);
                  _copyToDownloads(context, absPath);
                },
              ),

              _ActionItem(
                icon: Icons.link_off,
                label: 'Remove from Sync',
                subtitle: 'Remove locally only — won\'t delete on PC',
                color: Colors.redAccent,
                onTap: () {
                  Navigator.pop(context);
                  _removeFromSync(context, absPath);
                },
              ),

              const SizedBox(height: 16),
            ],
          ),
        ),
      ),
    );
  }

  // ─── Actions ────────────────────────────────────────────────────────────

  Future<void> _openFile(BuildContext context) async {
    final absPath = p.join(syncFolder, file.path);
    debugPrint('[ui] Opening file: $absPath');

    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(
        content: Text('Opening ${file.path}...'),
        duration: const Duration(seconds: 1),
        backgroundColor: const Color(0xFF6C5CE7),
        behavior: SnackBarBehavior.floating,
      ),
    );

    final result = await OpenFilex.open(absPath);

    if (result.type != ResultType.done && context.mounted) {
      debugPrint('[ui] Error opening file: ${result.message}');
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text('Cannot open file: ${result.message}'),
          backgroundColor: Colors.redAccent,
          behavior: SnackBarBehavior.floating,
        ),
      );
    }
  }

  void _editFile(BuildContext context) {
    final absPath = p.join(syncFolder, file.path);

    Navigator.push(
      context,
      MaterialPageRoute(
        builder: (_) => FileEditorScreen(
          filePath: absPath,
          fileName: _fileName,
          syncManager: syncManager,
        ),
      ),
    );
  }

  Future<void> _shareFile(BuildContext context, String absPath) async {
    try {
      await Share.shareXFiles([XFile(absPath)], subject: _fileName);
    } catch (e) {
      if (context.mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text('Share failed: $e'),
            backgroundColor: Colors.redAccent,
            behavior: SnackBarBehavior.floating,
          ),
        );
      }
    }
  }

  Future<void> _copyToDownloads(BuildContext context, String absPath) async {
    try {
      // On Android, copy to the standard Downloads folder
      String destDir;
      if (Platform.isAndroid) {
        destDir = '/storage/emulated/0/Download';
      } else {
        destDir = p.join(Platform.environment['HOME'] ?? '/tmp', 'Downloads');
      }

      final destPath = p.join(destDir, _fileName);
      await File(absPath).copy(destPath);

      if (context.mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Row(
              children: [
                const Icon(Icons.check_circle, color: Colors.white, size: 18),
                const SizedBox(width: 8),
                Text('Copied to Downloads/$_fileName'),
              ],
            ),
            backgroundColor: const Color(0xFF00B894),
            behavior: SnackBarBehavior.floating,
          ),
        );
      }
    } catch (e) {
      if (context.mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text('Copy failed: $e'),
            backgroundColor: Colors.redAccent,
            behavior: SnackBarBehavior.floating,
          ),
        );
      }
    }
  }

  Future<void> _removeFromSync(BuildContext context, String absPath) async {
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        backgroundColor: const Color(0xFF1A1A2E),
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
        title: const Text(
          'Remove from Sync?',
          style: TextStyle(color: Colors.white, fontWeight: FontWeight.w700),
        ),
        content: Text(
          'This will remove "$_fileName" from your sync folder. The file on your PC will NOT be affected.',
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
            child: const Text('Remove'),
          ),
        ],
      ),
    );

    if (confirmed == true) {
      try {
        final file = File(absPath);
        if (await file.exists()) {
          await file.delete();
        }
        syncManager?.refreshFiles();
        if (context.mounted) {
          ScaffoldMessenger.of(context).showSnackBar(
            const SnackBar(
              content: Text('Removed from sync folder'),
              backgroundColor: Color(0xFF636e72),
              behavior: SnackBarBehavior.floating,
            ),
          );
        }
      } catch (e) {
        if (context.mounted) {
          ScaffoldMessenger.of(context).showSnackBar(
            SnackBar(
              content: Text('Remove failed: $e'),
              backgroundColor: Colors.redAccent,
              behavior: SnackBarBehavior.floating,
            ),
          );
        }
      }
    }
  }

  // ─── Computed properties ────────────────────────────────────────────────

  String get _fileName {
    final parts = file.path.split('/');
    return parts.last;
  }

  String get _subtitle {
    final folder = file.path.contains('/')
        ? file.path.substring(0, file.path.lastIndexOf('/'))
        : '';
    final size = _formatSize(file.size);
    final time = _formatTime(file.modified);
    return '${folder.isNotEmpty ? '$folder · ' : ''}$size · $time';
  }

  IconData get _icon {
    final ext = _fileName.split('.').last.toLowerCase();
    switch (ext) {
      case 'pdf':
        return Icons.picture_as_pdf;
      case 'doc':
      case 'docx':
        return Icons.description;
      case 'xls':
      case 'xlsx':
        return Icons.table_chart;
      case 'ppt':
      case 'pptx':
        return Icons.slideshow;
      case 'jpg':
      case 'jpeg':
      case 'png':
      case 'gif':
      case 'webp':
        return Icons.image;
      case 'mp4':
      case 'avi':
      case 'mov':
        return Icons.videocam;
      case 'mp3':
      case 'wav':
      case 'flac':
        return Icons.audiotrack;
      case 'zip':
      case 'rar':
      case '7z':
        return Icons.archive;
      case 'py':
      case 'js':
      case 'dart':
      case 'ts':
      case 'java':
      case 'cpp':
        return Icons.code;
      case 'txt':
      case 'md':
        return Icons.text_snippet;
      default:
        return Icons.insert_drive_file;
    }
  }

  Color get _iconColor {
    final ext = _fileName.split('.').last.toLowerCase();
    switch (ext) {
      case 'pdf':
        return const Color(0xFFE74C3C);
      case 'doc':
      case 'docx':
        return const Color(0xFF2980B9);
      case 'xls':
      case 'xlsx':
        return const Color(0xFF27AE60);
      case 'ppt':
      case 'pptx':
        return const Color(0xFFE67E22);
      case 'jpg':
      case 'jpeg':
      case 'png':
      case 'gif':
      case 'webp':
        return const Color(0xFF9B59B6);
      case 'mp4':
      case 'avi':
      case 'mov':
        return const Color(0xFFE74C3C);
      case 'mp3':
      case 'wav':
      case 'flac':
        return const Color(0xFFF39C12);
      case 'py':
      case 'js':
      case 'dart':
      case 'ts':
        return const Color(0xFF00B894);
      default:
        return const Color(0xFF6C5CE7);
    }
  }

  Widget _buildStatusChip() {
    switch (file.status) {
      case 'syncing':
        return const SizedBox(
          width: 16,
          height: 16,
          child: CircularProgressIndicator(
            strokeWidth: 2,
            color: Color(0xFF6C5CE7),
          ),
        );
      case 'conflict':
        return Container(
          padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
          decoration: BoxDecoration(
            color: Colors.orange.withOpacity(0.15),
            borderRadius: BorderRadius.circular(6),
          ),
          child: const Text(
            'CONFLICT',
            style: TextStyle(
              fontSize: 9,
              fontWeight: FontWeight.w700,
              color: Colors.orange,
              letterSpacing: 0.5,
            ),
          ),
        );
      case 'error':
        return const Icon(
          Icons.error_outline,
          size: 18,
          color: Colors.redAccent,
        );
      default:
        return Icon(
          Icons.check_circle,
          size: 18,
          color: const Color(0xFF00B894).withOpacity(0.7),
        );
    }
  }

  String _formatSize(int bytes) {
    if (bytes < 1024) return '$bytes B';
    if (bytes < 1024 * 1024) return '${(bytes / 1024).toStringAsFixed(1)} KB';
    if (bytes < 1024 * 1024 * 1024) {
      return '${(bytes / (1024 * 1024)).toStringAsFixed(1)} MB';
    }
    return '${(bytes / (1024 * 1024 * 1024)).toStringAsFixed(1)} GB';
  }

  String _formatTime(DateTime time) {
    final now = DateTime.now();
    final diff = now.difference(time);

    if (diff.inMinutes < 1) return 'Just now';
    if (diff.inMinutes < 60) return '${diff.inMinutes}m ago';
    if (diff.inHours < 24) return '${diff.inHours}h ago';
    if (diff.inDays < 7) return '${diff.inDays}d ago';
    return '${time.day}/${time.month}/${time.year}';
  }
}

// ─── Action item widget ─────────────────────────────────────────────────────

class _ActionItem extends StatelessWidget {
  final IconData icon;
  final String label;
  final String subtitle;
  final Color color;
  final VoidCallback onTap;

  const _ActionItem({
    required this.icon,
    required this.label,
    required this.subtitle,
    required this.color,
    required this.onTap,
  });

  @override
  Widget build(BuildContext context) {
    return Material(
      color: Colors.transparent,
      child: InkWell(
        onTap: onTap,
        child: Padding(
          padding: const EdgeInsets.symmetric(horizontal: 20, vertical: 12),
          child: Row(
            children: [
              Container(
                width: 40,
                height: 40,
                decoration: BoxDecoration(
                  color: color.withOpacity(0.1),
                  borderRadius: BorderRadius.circular(10),
                ),
                child: Icon(icon, color: color, size: 20),
              ),
              const SizedBox(width: 14),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      label,
                      style: const TextStyle(
                        fontSize: 15,
                        fontWeight: FontWeight.w600,
                        color: Colors.white,
                      ),
                    ),
                    Text(
                      subtitle,
                      style: TextStyle(
                        fontSize: 11,
                        color: Colors.white.withOpacity(0.4),
                      ),
                    ),
                  ],
                ),
              ),
              Icon(
                Icons.chevron_right,
                size: 20,
                color: Colors.white.withOpacity(0.2),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
