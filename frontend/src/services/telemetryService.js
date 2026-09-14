import { initializeApp, getApps } from 'firebase/app';
import {
  getDatabase,
  ref,
  onValue,
  onDisconnect,
  set,
  serverTimestamp,
  runTransaction,
} from 'firebase/database';

// ── Firebase Configuration ──────────────────────────────────────────────────
// Replace these values with your Firebase Console Project credentials:
// https://console.firebase.google.com -> Project Settings -> Web App Config
const defaultFirebaseConfig = {
  apiKey: process.env.REACT_APP_FIREBASE_API_KEY || 'AIzaSyAcpPfYWY4-HX-i0Nmmink076JQIpo2cWY',
  authDomain: process.env.REACT_APP_FIREBASE_AUTH_DOMAIN || 'intellifile-3b4ec.firebaseapp.com',
  databaseURL: process.env.REACT_APP_FIREBASE_DATABASE_URL || 'https://intellifile-3b4ec-default-rtdb.firebaseio.com',
  projectId: process.env.REACT_APP_FIREBASE_PROJECT_ID || 'intellifile-3b4ec',
  storageBucket: 'intellifile-3b4ec.firebasestorage.app',
  messagingSenderId: '547554569663',
  appId: '1:547554569663:web:cdf878ecb13a89549a450a',
};

let dbInstance = null;

function getFirebaseDb(customConfig = null) {
  if (dbInstance) return dbInstance;

  const config = customConfig || defaultFirebaseConfig;

  // Don't initialize if credentials are dummy placeholders
  if (!config.databaseURL || config.databaseURL.includes('YOUR_')) {
    console.warn('[Telemetry] Firebase credentials not configured yet. Telemetry in standby.');
    return null;
  }

  try {
    const app = getApps().length === 0 ? initializeApp(config) : getApps()[0];
    dbInstance = getDatabase(app);
    return dbInstance;
  } catch (err) {
    console.error('[Telemetry] Failed to initialize Firebase:', err);
    return null;
  }
}

// Generate or retrieve a persistent anonymous UUID for this app installation
function getOrCreateInstanceId() {
  const KEY = 'intellifile_instance_id';
  let id = localStorage.getItem(KEY);
  let isNew = false;

  if (!id) {
    // Generate simple compliant random UUID v4
    id = 'idx_' + Math.random().toString(36).substring(2, 11) + '_' + Date.now().toString(36);
    try {
      localStorage.setItem(KEY, id);
    } catch (_) {}
    isNew = true;
  }

  return { id, isNew };
}

/**
 * Initializes telemetry tracking:
 * 1. Increments total download/install count on first launch.
 * 2. Connects to Firebase Presence system to track real-time online status.
 */
export async function initTelemetry(customConfig = null) {
  // Only run telemetry inside the Electron desktop app, ignore standard Chrome browser tabs opened during dev
  const isElectron = Boolean(window.electron || window.electron?.ipcRenderer || window.process?.type === 'renderer');
  if (!isElectron) {
    console.log('[Telemetry] Running in browser window — telemetry skipped.');
    return;
  }

  const db = getFirebaseDb(customConfig);
  if (!db) return;

  const { id: instanceId, isNew } = getOrCreateInstanceId();

  // Fetch PC details from Electron main process
  let sysInfo = { hostname: 'Unknown PC', username: 'Unknown User', platform: 'Unknown' };
  try {
    const ipcRenderer = window.electron?.ipcRenderer;
    if (ipcRenderer) {
      const res = await ipcRenderer.invoke('get-system-info');
      if (res) sysInfo = res;
    }
  } catch (_) {}

  // 1. Install Record (ensure installation details are recorded in Firebase)
  const installRef = ref(db, `installs/${instanceId}`);
  set(installRef, {
    computerName: sysInfo.hostname || 'Unknown PC',
    username: sysInfo.username || 'Unknown User',
    appVersion: sysInfo.appVersion || '1.0.4',
    installedAt: serverTimestamp(),
    platform: sysInfo.platform || window.navigator?.platform || 'Unknown',
    language: window.navigator?.language || 'en-US',
    screen: `${window.screen?.width || 0}x${window.screen?.height || 0}`,
    timeZone: Intl?.DateTimeFormat?.().resolvedOptions?.().timeZone || 'Unknown',
    userAgent: window.navigator?.userAgent || 'Unknown',
  }).catch((err) => console.warn('[Telemetry] install set failed:', err));

  if (isNew) {
    const totalRef = ref(db, 'metrics/total_downloads');
    runTransaction(totalRef, (current) => (current || 0) + 1).catch((err) => {
      console.warn('[Telemetry] Transaction failed:', err);
    });
  }

  // 2. Track Live Active Status (Firebase Presence)
  const userStatusRef = ref(db, `online_users/${instanceId}`);

  const updateOnlineStatus = () => {
    set(userStatusRef, {
      online: true,
      computerName: sysInfo.hostname || 'Unknown PC',
      username: sysInfo.username || 'Unknown User',
      appVersion: sysInfo.appVersion || '1.0.4',
      lastSeen: serverTimestamp(),
      platform: sysInfo.platform || window.navigator?.platform || 'Unknown',
      timeZone: Intl?.DateTimeFormat?.().resolvedOptions?.().timeZone || 'Unknown',
    }).catch((err) => console.warn('[Telemetry] online status failed:', err));

    onDisconnect(userStatusRef).remove().catch(() => {});
  };

  // Immediately set online status
  updateOnlineStatus();

  // Re-apply on socket reconnect
  const connectedRef = ref(db, '.info/connected');
  onValue(connectedRef, (snap) => {
    if (snap.val() === true) {
      updateOnlineStatus();
    }
  });
}
