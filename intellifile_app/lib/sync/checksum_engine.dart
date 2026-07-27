// lib/sync/checksum_engine.dart
//
// Block-level checksum computation + delta calculation/application.
// Pure Dart port of the Python checksum.py — no native dependencies.

import 'dart:io';
import 'package:crypto/crypto.dart';
import 'package:flutter/foundation.dart';

/// Block size for chunking files: 128 KB
const int kBlockSize = 128 * 1024;

/// Compute MD5 checksum for each block of a file.
/// Returns `{blockIndex: checksumHex}`.
Future<Map<int, String>> getBlockChecksums(String filepath) async {
  final file = File(filepath);
  if (!await file.exists()) return {};

  final checksums = <int, String>{};
  final raf = await file.open(mode: FileMode.read);
  try {
    int index = 0;
    while (true) {
      final chunk = await raf.read(kBlockSize);
      if (chunk.isEmpty) break;
      checksums[index] = md5.convert(chunk).toString();
      index++;
    }
  } finally {
    await raf.close();
  }
  return checksums;
}

/// Compute all block checksums for every file in [syncFolder].
/// Returns `{relativePath: {blockIndex: checksumHex}}`.
Future<Map<String, Map<int, String>>> getAllBlockChecksums(
  String syncFolder,
) async {
  final result = <String, Map<int, String>>{};
  final dir = Directory(syncFolder);
  if (!await dir.exists()) return result;

  await for (final entity in dir.list(recursive: true)) {
    if (entity is File) {
      final relPath = entity.path
          .replaceFirst('$syncFolder/', '')
          .replaceAll('\\', '/');
      result[relPath] = await getBlockChecksums(entity.path);
    }
  }
  return result;
}

/// A single block delta — contains the block index, its checksum, and its
/// raw data encoded as a hex string (for JSON serialization).
class BlockDelta {
  final int block;
  final String checksum;
  final String data; // hex-encoded bytes

  const BlockDelta({
    required this.block,
    required this.checksum,
    required this.data,
  });

  Map<String, dynamic> toJson() => {
    'block': block,
    'checksum': checksum,
    'data': data,
  };

  factory BlockDelta.fromJson(Map<String, dynamic> json) => BlockDelta(
    block: json['block'] as int,
    checksum: json['checksum'] as String,
    data: json['data'] as String,
  );
}

/// Compare local file blocks against [remoteChecksums].
/// Returns only the blocks that differ — the delta.
Future<List<BlockDelta>> computeDelta(
  String filepath,
  Map<dynamic, dynamic> remoteChecksums,
) async {
  final file = File(filepath);
  if (!await file.exists()) return [];

  final deltas = <BlockDelta>[];
  final raf = await file.open(mode: FileMode.read);
  try {
    int index = 0;
    while (true) {
      final chunk = await raf.read(kBlockSize);
      if (chunk.isEmpty) break;

      final localChecksum = md5.convert(chunk).toString();
      final remoteChecksum =
          remoteChecksums[index]?.toString() ??
          remoteChecksums[index.toString()]?.toString();

      if (remoteChecksum != localChecksum) {
        deltas.add(
          BlockDelta(
            block: index,
            checksum: localChecksum,
            data: _bytesToHex(chunk),
          ),
        );
      }
      index++;
    }
  } finally {
    await raf.close();
  }
  return deltas;
}

/// Apply received block deltas to a local file.
/// Only the changed blocks are overwritten.
Future<void> applyDelta(
  String filepath,
  List<dynamic> deltasRaw, {
  int? expectedSize,
}) async {
  try {
    final file = File(filepath);
    await file.parent.create(recursive: true);
    await file.writeAsBytes([], mode: FileMode.append);

    final raf = await file.open(mode: FileMode.append);
    try {
      for (final delta in deltasRaw) {
        final d = delta is BlockDelta
            ? delta
            : BlockDelta.fromJson(Map<String, dynamic>.from(delta as Map));
        await raf.setPosition(d.block * kBlockSize);
        await raf.writeFrom(_hexToBytes(d.data));
      }

      if (expectedSize != null && expectedSize > 0) {
        await raf.truncate(expectedSize);
      }
    } finally {
      await raf.close();
    }
  } catch (e) {
    debugPrint('[applyDelta] failed on $filepath: $e');
    rethrow;
  }
}

/// Compute MD5 of an entire file — used by the Merkle tree.
Future<String> fileChecksum(String filepath) async {
  final file = File(filepath);
  if (!await file.exists()) return '';

  final sink = _DigestSink();
  final digestOutput = md5.startChunkedConversion(sink);

  final raf = await file.open(mode: FileMode.read);
  try {
    while (true) {
      final chunk = await raf.read(kBlockSize);
      if (chunk.isEmpty) break;
      digestOutput.add(chunk);
    }
  } finally {
    await raf.close();
  }
  digestOutput.close();
  return sink.digest!.toString();
}

/// Simple sink that captures the final Digest from a chunked conversion.
/// Each instance holds its own result — safe for concurrent calls.
class _DigestSink implements Sink<Digest> {
  Digest? digest;

  @override
  void add(Digest data) {
    digest = data;
  }

  @override
  void close() {}
}

// ── Hex conversion helpers ──────────────────────────────────────────────────

String _bytesToHex(List<int> bytes) {
  final buffer = StringBuffer();
  for (final b in bytes) {
    buffer.write(b.toRadixString(16).padLeft(2, '0'));
  }
  return buffer.toString();
}

List<int> _hexToBytes(String hex) {
  final result = <int>[];
  for (int i = 0; i < hex.length; i += 2) {
    result.add(int.parse(hex.substring(i, i + 2), radix: 16));
  }
  return result;
}
