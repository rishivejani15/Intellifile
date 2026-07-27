// lib/sync/merkle_tree.dart
//
// Merkle tree for fast O(1) change detection between devices.
// Pure Dart port of merkle.py.

import 'dart:convert';
import 'dart:io';
import 'package:crypto/crypto.dart';
import 'checksum_engine.dart';

/// Build a Merkle tree for all files under [folder].
///
/// Returns `{relativePath: md5Checksum, '__root__': rootHash}`.
/// The root hash changes if ANY file changes — enabling an O(1) in-sync check.
Future<Map<String, String>> buildMerkleTree(String folder) async {
  final tree = <String, String>{};
  final dir = Directory(folder);

  if (!await dir.exists()) {
    // Empty tree with a deterministic root
    tree['__root__'] = md5.convert(utf8.encode('')).toString();
    return tree;
  }

  final entities = <FileSystemEntity>[];
  await for (final entity in dir.list(recursive: true)) {
    if (entity is File) {
      entities.add(entity);
    }
  }

  // Sort for deterministic ordering
  entities.sort((a, b) => a.path.compareTo(b.path));

  for (final entity in entities) {
    final relPath = entity.path
        .replaceFirst('$folder${Platform.pathSeparator}', '')
        .replaceFirst('$folder/', '')
        .replaceAll('\\', '/');

    // Skip hidden/temp files
    if (relPath.startsWith('.') || relPath.endsWith('.tmp')) continue;

    tree[relPath] = await fileChecksum(entity.path);
  }

  // Root = hash of all (path:checksum) pairs sorted
  final entries = tree.entries.toList()..sort((a, b) => a.key.compareTo(b.key));
  final combined = entries.map((e) => '${e.key}:${e.value}').join();
  tree['__root__'] = md5.convert(utf8.encode(combined)).toString();

  return tree;
}

/// Compare two Merkle trees.
///
/// Returns `{filepath: changeType}` where changeType is one of:
/// - `modified`: file exists on both sides but content differs
/// - `added`: file exists on remote but not locally
/// - `deleted`: file exists locally but not on remote
Map<String, String> findChangedFiles(
  Map<String, dynamic> localTree,
  Map<String, dynamic> remoteTree,
) {
  // Quick root-hash comparison
  if (localTree['__root__'] == remoteTree['__root__']) {
    return {};
  }

  final changed = <String, String>{};

  final allPaths = <String>{...localTree.keys, ...remoteTree.keys}
    ..remove('__root__');

  for (final path in allPaths) {
    final localCs = localTree[path]?.toString();
    final remoteCs = remoteTree[path]?.toString();

    if (localCs == remoteCs) {
      continue;
    } else if (localCs != null && remoteCs != null) {
      changed[path] = 'modified';
    } else if (remoteCs != null && localCs == null) {
      changed[path] = 'remote_only'; // exists on remote, not local
    } else {
      changed[path] = 'local_only'; // exists locally, not on remote
    }
  }

  return changed;
}
