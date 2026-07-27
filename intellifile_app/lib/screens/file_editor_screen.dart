// lib/screens/file_editor_screen.dart
//
// In-app text editor for synced files (.txt, .md, .json, etc.).
// Changes are saved locally and trigger the sync change detection flow.

import 'dart:io';
import 'package:flutter/material.dart';
import 'package:path/path.dart' as p;
import '../sync/sync_manager.dart';

/// File extensions that can be edited in the in-app text editor.
const editableTextExtensions = {
  '.txt',
  '.md',
  '.json',
  '.xml',
  '.csv',
  '.py',
  '.js',
  '.ts',
  '.dart',
  '.java',
  '.cpp',
  '.c',
  '.h',
  '.go',
  '.rs',
  '.html',
  '.css',
  '.yaml',
  '.yml',
  '.toml',
  '.ini',
  '.cfg',
  '.conf',
  '.sh',
  '.bat',
  '.ps1',
  '.sql',
  '.env',
  '.log',
};

/// Check if a file can be opened in the in-app text editor.
bool isTextEditable(String filepath) {
  final ext = p.extension(filepath).toLowerCase();
  return editableTextExtensions.contains(ext);
}

class FileEditorScreen extends StatefulWidget {
  final String filePath;
  final String fileName;
  final SyncManager? syncManager;

  const FileEditorScreen({
    super.key,
    required this.filePath,
    required this.fileName,
    this.syncManager,
  });

  @override
  State<FileEditorScreen> createState() => _FileEditorScreenState();
}

class _FileEditorScreenState extends State<FileEditorScreen> {
  late TextEditingController _controller;
  final FocusNode _focusNode = FocusNode();
  bool _isLoading = true;
  bool _hasChanges = false;
  bool _isSaving = false;
  String? _error;
  String _originalContent = '';

  @override
  void initState() {
    super.initState();
    _controller = TextEditingController();
    _loadFile();
  }

  @override
  void dispose() {
    _controller.dispose();
    _focusNode.dispose();
    super.dispose();
  }

  Future<void> _loadFile() async {
    try {
      final file = File(widget.filePath);
      if (!await file.exists()) {
        setState(() {
          _error = 'File not found';
          _isLoading = false;
        });
        return;
      }

      final content = await file.readAsString();
      _originalContent = content;
      _controller.text = content;
      _controller.addListener(_onTextChanged);

      setState(() => _isLoading = false);
    } catch (e) {
      setState(() {
        _error = 'Failed to load file: $e';
        _isLoading = false;
      });
    }
  }

  void _onTextChanged() {
    final changed = _controller.text != _originalContent;
    if (changed != _hasChanges) {
      setState(() => _hasChanges = changed);
    }
  }

  Future<void> _saveFile() async {
    if (!_hasChanges || _isSaving) return;

    setState(() => _isSaving = true);

    try {
      final file = File(widget.filePath);
      await file.writeAsString(_controller.text);
      _originalContent = _controller.text;

      // Trigger sync refresh so the watcher picks up the change
      await widget.syncManager?.refreshFiles();

      setState(() {
        _hasChanges = false;
        _isSaving = false;
      });

      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(
            content: Row(
              children: [
                Icon(Icons.check_circle, color: Colors.white, size: 18),
                SizedBox(width: 8),
                Text('File saved — sync will detect the change'),
              ],
            ),
            backgroundColor: Color(0xFF00B894),
            duration: Duration(seconds: 2),
            behavior: SnackBarBehavior.floating,
          ),
        );
      }
    } catch (e) {
      setState(() => _isSaving = false);
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text('Save failed: $e'),
            backgroundColor: Colors.redAccent,
          ),
        );
      }
    }
  }

  Future<bool> _onWillPop() async {
    if (!_hasChanges) return true;

    final result = await showDialog<String>(
      context: context,
      builder: (context) => AlertDialog(
        backgroundColor: const Color(0xFF1A1A2E),
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
        title: const Text(
          'Unsaved Changes',
          style: TextStyle(color: Colors.white, fontWeight: FontWeight.w700),
        ),
        content: Text(
          'You have unsaved changes in ${widget.fileName}. What would you like to do?',
          style: TextStyle(color: Colors.white.withOpacity(0.7)),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(context, 'discard'),
            child: Text(
              'Discard',
              style: TextStyle(color: Colors.white.withOpacity(0.5)),
            ),
          ),
          TextButton(
            onPressed: () => Navigator.pop(context, 'cancel'),
            child: const Text(
              'Cancel',
              style: TextStyle(color: Color(0xFFA29BFE)),
            ),
          ),
          ElevatedButton(
            onPressed: () => Navigator.pop(context, 'save'),
            style: ElevatedButton.styleFrom(
              backgroundColor: const Color(0xFF6C5CE7),
              foregroundColor: Colors.white,
              shape: RoundedRectangleBorder(
                borderRadius: BorderRadius.circular(8),
              ),
            ),
            child: const Text('Save'),
          ),
        ],
      ),
    );

    if (result == 'save') {
      await _saveFile();
      return true;
    } else if (result == 'discard') {
      return true;
    }
    return false; // cancel
  }

  @override
  Widget build(BuildContext context) {
    final ext = p.extension(widget.fileName).toLowerCase();

    return PopScope(
      canPop: !_hasChanges,
      onPopInvokedWithResult: (didPop, _) async {
        if (!didPop) {
          final shouldPop = await _onWillPop();
          if (shouldPop && context.mounted) {
            Navigator.of(context).pop();
          }
        }
      },
      child: Scaffold(
        backgroundColor: const Color(0xFF0D0D1A),
        appBar: AppBar(
          backgroundColor: const Color(0xFF0D0D1A),
          surfaceTintColor: Colors.transparent,
          leading: IconButton(
            icon: const Icon(Icons.arrow_back, color: Colors.white),
            onPressed: () async {
              if (_hasChanges) {
                final shouldPop = await _onWillPop();
                if (shouldPop && context.mounted) {
                  Navigator.of(context).pop();
                }
              } else {
                Navigator.of(context).pop();
              }
            },
          ),
          title: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                widget.fileName,
                style: const TextStyle(
                  fontSize: 16,
                  fontWeight: FontWeight.w600,
                  color: Colors.white,
                ),
              ),
              Row(
                children: [
                  Container(
                    padding: const EdgeInsets.symmetric(
                      horizontal: 6,
                      vertical: 1,
                    ),
                    decoration: BoxDecoration(
                      color: _languageColor(ext).withOpacity(0.15),
                      borderRadius: BorderRadius.circular(4),
                    ),
                    child: Text(
                      ext.replaceFirst('.', '').toUpperCase(),
                      style: TextStyle(
                        fontSize: 9,
                        fontWeight: FontWeight.w700,
                        color: _languageColor(ext),
                        letterSpacing: 0.5,
                      ),
                    ),
                  ),
                  if (_hasChanges) ...[
                    const SizedBox(width: 6),
                    Container(
                      width: 6,
                      height: 6,
                      decoration: const BoxDecoration(
                        color: Color(0xFFFFA62B),
                        shape: BoxShape.circle,
                      ),
                    ),
                    const SizedBox(width: 4),
                    Text(
                      'Modified',
                      style: TextStyle(
                        fontSize: 10,
                        color: Colors.white.withOpacity(0.4),
                      ),
                    ),
                  ],
                ],
              ),
            ],
          ),
          actions: [
            // Undo
            IconButton(
              icon: Icon(
                Icons.undo,
                color: _controller.text != _originalContent
                    ? Colors.white
                    : Colors.white.withOpacity(0.2),
              ),
              onPressed: _controller.text != _originalContent
                  ? () {
                      _controller.text = _originalContent;
                      _controller.selection = TextSelection.collapsed(
                        offset: _originalContent.length,
                      );
                    }
                  : null,
              tooltip: 'Revert changes',
            ),
            // Save
            if (_hasChanges)
              Padding(
                padding: const EdgeInsets.only(right: 8),
                child: _isSaving
                    ? const Padding(
                        padding: EdgeInsets.all(12),
                        child: SizedBox(
                          width: 20,
                          height: 20,
                          child: CircularProgressIndicator(
                            strokeWidth: 2,
                            color: Color(0xFF6C5CE7),
                          ),
                        ),
                      )
                    : IconButton(
                        icon: const Icon(Icons.save, color: Color(0xFF00B894)),
                        onPressed: _saveFile,
                        tooltip: 'Save file',
                      ),
              ),
          ],
        ),
        body: _buildBody(),
      ),
    );
  }

  Widget _buildBody() {
    if (_isLoading) {
      return const Center(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            CircularProgressIndicator(color: Color(0xFF6C5CE7), strokeWidth: 2),
            SizedBox(height: 16),
            Text(
              'Loading file...',
              style: TextStyle(color: Colors.white54, fontSize: 14),
            ),
          ],
        ),
      );
    }

    if (_error != null) {
      return Center(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            const Icon(Icons.error_outline, size: 48, color: Colors.redAccent),
            const SizedBox(height: 12),
            Text(
              _error!,
              style: const TextStyle(color: Colors.redAccent, fontSize: 14),
              textAlign: TextAlign.center,
            ),
          ],
        ),
      );
    }

    return Container(
      margin: const EdgeInsets.fromLTRB(0, 4, 0, 0),
      decoration: const BoxDecoration(
        color: Color(0xFF12121F),
        borderRadius: BorderRadius.vertical(top: Radius.circular(16)),
      ),
      child: ClipRRect(
        borderRadius: const BorderRadius.vertical(top: Radius.circular(16)),
        child: TextField(
          controller: _controller,
          focusNode: _focusNode,
          maxLines: null,
          expands: true,
          textAlignVertical: TextAlignVertical.top,
          style: const TextStyle(
            fontFamily: 'monospace',
            fontSize: 14,
            color: Color(0xFFE0E0E0),
            height: 1.6,
          ),
          decoration: const InputDecoration(
            contentPadding: EdgeInsets.all(16),
            border: InputBorder.none,
            hintText: 'Start typing...',
            hintStyle: TextStyle(
              color: Colors.white24,
              fontFamily: 'monospace',
            ),
          ),
          cursorColor: const Color(0xFF6C5CE7),
          cursorWidth: 2,
        ),
      ),
    );
  }

  Color _languageColor(String ext) {
    switch (ext) {
      case '.py':
        return const Color(0xFF3776AB);
      case '.js':
      case '.ts':
        return const Color(0xFFF7DF1E);
      case '.dart':
        return const Color(0xFF00B4AB);
      case '.java':
        return const Color(0xFFB07219);
      case '.html':
        return const Color(0xFFE34C26);
      case '.css':
        return const Color(0xFF563D7C);
      case '.json':
        return const Color(0xFF292929);
      case '.md':
        return const Color(0xFF083FA1);
      case '.txt':
        return const Color(0xFFA29BFE);
      default:
        return const Color(0xFF6C5CE7);
    }
  }
}
