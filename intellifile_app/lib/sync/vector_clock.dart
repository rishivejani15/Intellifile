// lib/sync/vector_clock.dart
//
// Vector clock for conflict resolution.
// Tracks which device last edited a file and detects concurrent edits.
// Uses sqflite for persistence on mobile.

import 'dart:convert';
import 'package:sqflite/sqflite.dart';
import 'package:path/path.dart' as p;
import 'package:path_provider/path_provider.dart';

const String kDeviceId = 'mobile';

// ─── VectorClock data class ─────────────────────────────────────────────────

class VectorClock {
  final String deviceId;
  Map<String, double> clock;

  VectorClock({required this.deviceId, Map<String, double>? clock})
      : clock = clock ?? {};

  /// Tick this device's entry — call after every local file edit.
  void tick() {
    clock[deviceId] =
        DateTime.now().millisecondsSinceEpoch / 1000.0;
  }

  /// Merge a remote clock into this one — take max per device.
  void merge(Map<String, dynamic> other) {
    for (final entry in other.entries) {
      final remoteTs = (entry.value as num).toDouble();
      clock[entry.key] = (clock[entry.key] ?? 0) > remoteTs
          ? clock[entry.key]!
          : remoteTs;
    }
  }

  /// Compare against a remote clock.
  ///
  /// Returns one of:
  /// - `local_wins`  — our clock is strictly ahead
  /// - `remote_wins` — remote clock is strictly ahead
  /// - `identical`   — both clocks are equal
  /// - `conflict`    — both sides have edits since last sync
  String compare(Map<String, dynamic> other) {
    final allDevices = <String>{...clock.keys, ...other.keys};

    bool localNewer = false;
    bool remoteNewer = false;

    for (final device in allDevices) {
      final localTs = clock[device] ?? 0.0;
      final remoteTs = (other[device] as num?)?.toDouble() ?? 0.0;

      if (localTs > remoteTs) localNewer = true;
      if (remoteTs > localTs) remoteNewer = true;
    }

    if (localNewer && !remoteNewer) return 'local_wins';
    if (remoteNewer && !localNewer) return 'remote_wins';
    if (!localNewer && !remoteNewer) return 'identical';
    return 'conflict';
  }

  Map<String, dynamic> toJson() => Map<String, dynamic>.from(clock);

  factory VectorClock.fromJson(String deviceId, Map<String, dynamic> json) {
    return VectorClock(
      deviceId: deviceId,
      clock: json.map((k, v) => MapEntry(k, (v as num).toDouble())),
    );
  }
}

// ─── SQLite persistence ─────────────────────────────────────────────────────

class VectorClockStore {
  static Database? _db;

  static Future<Database> _getDb() async {
    if (_db != null) return _db!;
    final dir = await getApplicationDocumentsDirectory();
    final dbPath = p.join(dir.path, 'intellifil_mobile.db');
    _db = await openDatabase(
      dbPath,
      version: 1,
      onCreate: (db, version) async {
        await db.execute('''
          CREATE TABLE IF NOT EXISTS vector_clocks (
            filepath    TEXT PRIMARY KEY,
            clock_json  TEXT NOT NULL,
            updated_at  REAL NOT NULL
          )
        ''');
      },
    );
    return _db!;
  }

  /// Load the vector clock for a file. Returns a fresh clock if not found.
  static Future<VectorClock> loadClock(String filepath) async {
    final db = await _getDb();
    final rows = await db.query(
      'vector_clocks',
      where: 'filepath = ?',
      whereArgs: [filepath],
    );

    if (rows.isNotEmpty) {
      final clockJson =
          jsonDecode(rows.first['clock_json'] as String) as Map<String, dynamic>;
      return VectorClock.fromJson(kDeviceId, clockJson);
    }
    return VectorClock(deviceId: kDeviceId);
  }

  /// Save a vector clock for a file.
  static Future<void> saveClock(String filepath, VectorClock vc) async {
    final db = await _getDb();
    await db.insert(
      'vector_clocks',
      {
        'filepath': filepath,
        'clock_json': jsonEncode(vc.clock),
        'updated_at': DateTime.now().millisecondsSinceEpoch / 1000.0,
      },
      conflictAlgorithm: ConflictAlgorithm.replace,
    );
  }

  /// Load all vector clocks — sent during handshake.
  static Future<Map<String, dynamic>> loadAllClocks() async {
    final db = await _getDb();
    final rows = await db.query('vector_clocks');
    final result = <String, dynamic>{};
    for (final row in rows) {
      result[row['filepath'] as String] =
          jsonDecode(row['clock_json'] as String);
    }
    return result;
  }

  /// Close the database (call on app dispose).
  static Future<void> close() async {
    await _db?.close();
    _db = null;
  }
}
