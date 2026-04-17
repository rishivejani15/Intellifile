// lib/main.dart
//
// IntelliFile mobile app entry point.
// Sets up the SyncManager and launches the UI.
// 10.38.33.201:8765

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'sync/sync_manager.dart';
import 'screens/home_screen.dart';

void main() async {
  WidgetsFlutterBinding.ensureInitialized();

  // Lock to portrait for mobile
  await SystemChrome.setPreferredOrientations([DeviceOrientation.portraitUp]);

  // Set status bar style
  SystemChrome.setSystemUIOverlayStyle(
    const SystemUiOverlayStyle(
      statusBarColor: Colors.transparent,
      statusBarIconBrightness: Brightness.light,
    ),
  );

  runApp(const IntelliFileApp());
}

class IntelliFileApp extends StatefulWidget {
  const IntelliFileApp({super.key});

  @override
  State<IntelliFileApp> createState() => _IntelliFileAppState();
}

class _IntelliFileAppState extends State<IntelliFileApp> {
  final SyncManager _syncManager = SyncManager();
  bool _initialized = false;
  String? _error;

  @override
  void initState() {
    super.initState();
    _initSync();
  }

  Future<void> _initSync() async {
    try {
      await _syncManager.init();
      if (mounted) setState(() => _initialized = true);
    } catch (e) {
      if (mounted) setState(() => _error = e.toString());
    }
  }

  @override
  void dispose() {
    _syncManager.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'IntelliFile',
      debugShowCheckedModeBanner: false,
      theme: _buildTheme(),
      home: _error != null
          ? _ErrorScreen(error: _error!)
          : !_initialized
          ? const _SplashScreen()
          : HomeScreen(syncManager: _syncManager),
    );
  }

  ThemeData _buildTheme() {
    return ThemeData(
      useMaterial3: true,
      brightness: Brightness.dark,
      colorSchemeSeed: const Color(0xFF6C5CE7),
      fontFamily: 'Roboto',
      scaffoldBackgroundColor: const Color(0xFF0D0D1A),
      appBarTheme: const AppBarTheme(
        backgroundColor: Color(0xFF0D0D1A),
        surfaceTintColor: Colors.transparent,
        elevation: 0,
      ),
      cardTheme: CardThemeData(
        color: const Color(0xFF1A1A2E),
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
        elevation: 0,
      ),
    );
  }
}

// ─── Splash screen ──────────────────────────────────────────────────────────

class _SplashScreen extends StatelessWidget {
  const _SplashScreen();

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: Center(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Container(
              width: 80,
              height: 80,
              decoration: BoxDecoration(
                gradient: const LinearGradient(
                  colors: [Color(0xFF6C5CE7), Color(0xFFA29BFE)],
                ),
                borderRadius: BorderRadius.circular(20),
              ),
              child: const Icon(Icons.sync, size: 40, color: Colors.white),
            ),
            const SizedBox(height: 24),
            const Text(
              'IntelliFile',
              style: TextStyle(
                fontSize: 28,
                fontWeight: FontWeight.bold,
                color: Colors.white,
              ),
            ),
            const SizedBox(height: 8),
            Text(
              'Initializing sync engine...',
              style: TextStyle(
                fontSize: 14,
                color: Colors.white.withOpacity(0.6),
              ),
            ),
            const SizedBox(height: 32),
            const SizedBox(
              width: 24,
              height: 24,
              child: CircularProgressIndicator(
                strokeWidth: 2,
                color: Color(0xFF6C5CE7),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

// ─── Error screen ───────────────────────────────────────────────────────────

class _ErrorScreen extends StatelessWidget {
  final String error;
  const _ErrorScreen({required this.error});

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: Center(
        child: Padding(
          padding: const EdgeInsets.all(32),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              const Icon(
                Icons.error_outline,
                size: 64,
                color: Colors.redAccent,
              ),
              const SizedBox(height: 16),
              const Text(
                'Initialization Failed',
                style: TextStyle(
                  fontSize: 20,
                  fontWeight: FontWeight.bold,
                  color: Colors.white,
                ),
              ),
              const SizedBox(height: 8),
              Text(
                error,
                textAlign: TextAlign.center,
                style: TextStyle(color: Colors.white.withOpacity(0.6)),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
