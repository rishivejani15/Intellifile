import { initializeApp, getApps } from 'firebase/app';
import {
  getDatabase,
  ref,
  onValue,
  onDisconnect,
  set,
  update,
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
let heartbeatInterval = null;
let isTelemetryInitialized = false;

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
function getOrCreateInstanceId(persistentDeviceId = null, isNewFromDisk = false) {
  const KEY = 'intellifile_instance_id';
  let id = persistentDeviceId || localStorage.getItem(KEY);
  let isNew = false;

  if (!id) {
    id = 'idx_' + Math.random().toString(36).substring(2, 11) + '_' + Date.now().toString(36);
    isNew = true;
  } else if (isNewFromDisk || !localStorage.getItem(KEY)) {
    isNew = isNewFromDisk;
  }

  try {
    localStorage.setItem(KEY, id);
  } catch (_) {}

  return { id, isNew };
}

/**
 * Initializes telemetry tracking:
 * 1. Increments total download/install count on first launch.
 * 2. Preserves first-install timestamp while updating last-launched info.
 * 3. Connects to Firebase Presence system to track real-time online status with heartbeat.
 */
export async function initTelemetry(customConfig = null) {
  if (isTelemetryInitialized) return;
  isTelemetryInitialized = true;

  // Only run telemetry inside the Electron desktop app, ignore standard Chrome browser tabs opened during dev
  const isElectron = Boolean(
    window.electron ||
    window.electron?.ipcRenderer ||
    window.intellifile ||
    window.process?.type === 'renderer' ||
    window.navigator?.userAgent?.toLowerCase()?.includes('electron')
  );

  if (!isElectron) {
    console.log('[Telemetry] Running in browser window — telemetry skipped.');
    return;
  }

  const db = getFirebaseDb(customConfig);
  if (!db) return;

  const ipcRenderer = window.electron?.ipcRenderer || window.intellifile;

  // Respect user privacy setting for telemetry
  try {
    if (ipcRenderer?.invoke) {
      const setting = await ipcRenderer.invoke('settings:get', 'telemetry_enabled');
      if (setting && setting.value === false) {
        console.log('[Telemetry] Telemetry is disabled in User Settings — skipping initialization.');
        return;
      }
    }
  } catch (_) {}

  // Fetch PC details & persistent deviceId from Electron main process
  let sysInfo = { hostname: 'Unknown PC', username: 'Unknown User', platform: 'Unknown', deviceId: null, isNewDevice: false };
  try {
    if (ipcRenderer?.invoke) {
      const res = await ipcRenderer.invoke('get-system-info');
      if (res) sysInfo = res;
    }
  } catch (_) {}

  const { id: instanceId, isNew } = getOrCreateInstanceId(sysInfo.deviceId, sysInfo.isNewDevice);

  // 1. Install Record (ensure installation details are recorded in Firebase)
  const installRef = ref(db, `installs/${instanceId}`);
  const payload = {
    computerName: sysInfo.hostname || 'Unknown PC',
    username: sysInfo.username || 'Unknown User',
    appVersion: sysInfo.appVersion || '1.0.4',
    lastLaunchedAt: serverTimestamp(),
    platform: sysInfo.platform || window.navigator?.platform || 'Unknown',
    language: window.navigator?.language || 'en-US',
    screen: `${window.screen?.width || 0}x${window.screen?.height || 0}`,
    timeZone: Intl?.DateTimeFormat?.().resolvedOptions?.().timeZone || 'Unknown',
    userAgent: window.navigator?.userAgent || 'Unknown',
  };

  if (isNew) {
    payload.installedAt = serverTimestamp();
    set(installRef, payload).catch((err) => console.warn('[Telemetry] install set failed:', err));

    const totalRef = ref(db, 'metrics/total_downloads');
    runTransaction(totalRef, (current) => (current || 0) + 1).catch((err) => {
      console.warn('[Telemetry] Transaction failed:', err);
    });
  } else {
    // For returning users, update launch stats while keeping original installedAt date intact
    update(installRef, payload).catch((err) => console.warn('[Telemetry] install update failed:', err));
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

  // 3. Periodic Presence Heartbeat (every 5 minutes while running)
  if (heartbeatInterval) clearInterval(heartbeatInterval);
  heartbeatInterval = setInterval(() => {
    updateOnlineStatus();
  }, 5 * 60 * 1000);
}
