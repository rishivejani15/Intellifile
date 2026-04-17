// lib/sync/mdns_browser.dart
//
// mDNS/Zeroconf browser for discovering the PC sync server on LAN.
// Uses the nsd package for Android/iOS network service discovery.

import 'dart:async';
import 'package:flutter/foundation.dart';
import 'package:nsd/nsd.dart';

const String _serviceType = '_intellifil._tcp';

class MdnsBrowser {
  Discovery? _discovery;
  final _controller = StreamController<String>.broadcast();
  final _discoveredAddresses = <String>{};

  /// Stream emits PC's address as 'ip:port' when found on LAN.
  /// De-duplicated — each address is only emitted once.
  Stream<String> get onPcFound => _controller.stream;

  /// The last discovered address (null if none found yet).
  String? get lastAddress =>
      _discoveredAddresses.isEmpty ? null : _discoveredAddresses.last;

  Future<void> start() async {
    try {
      _discovery = await startDiscovery(_serviceType);

      _discovery!.addListener(() {
        for (final service in _discovery!.services) {
          final host = service.host;
          final port = service.port;

          if (host != null && port != null) {
            final address = '$host:$port';

            // Only emit new addresses
            if (_discoveredAddresses.add(address)) {
              debugPrint('[mdns] Found PC at $address');
              _controller.add(address);
            }
          }
        }
      });

      debugPrint('[mdns] Browsing for IntelliFile on LAN...');
    } catch (e) {
      debugPrint('[mdns] Start failed: $e');
      // Fall back to manual connection if mDNS fails
    }
  }

  Future<void> stop() async {
    try {
      if (_discovery != null) {
        await stopDiscovery(_discovery!);
        _discovery = null;
      }
    } catch (e) {
      debugPrint('[mdns] Stop error: $e');
    }
    _discoveredAddresses.clear();
  }

  void dispose() {
    stop();
    _controller.close();
  }
}
