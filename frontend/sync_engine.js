/**
 * sync_engine.js — WebRTC P2P file sync engine for the Electron desktop app.
 *
 * Connects to the cloud signaling server, establishes a WebRTC DataChannel
 * with the mobile peer, then exchanges Merkle trees / block-level deltas to
 * keep the sync folder in lockstep.
 *
 * Transport priority:
 *   1. WebRTC DataChannel (true P2P — zero server involvement for file data)
 *   2. WebSocket relay fallback (if P2P fails after 3 ICE restart attempts)
 *
 * Protocol matches the Flutter mobile client exactly:
 *   join → offer/answer → ice-candidate → (DataChannel) handshake → delta/ack
 *
 * NOTE: The `wrtc` npm package requires native compilation via node-gyp.
 * On Windows, you may need:
 *   npm install --global --production windows-build-tools
 * Or install Visual Studio Build Tools with the C++ workload.
 */

const WebSocket = require('ws');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { EventEmitter } = require('events');

// ── WebRTC — use the `wrtc` package for Node.js ────────────────────────────
// This provides RTCPeerConnection / RTCSessionDescription / RTCIceCandidate
// in a Node.js environment (normally only available in browsers).
let wrtc;
try {
  wrtc = require('wrtc');
} catch (e) {
  console.warn(
    '[sync-engine] wrtc package not available — WebRTC P2P disabled, relay-only mode.\n' +
    '  Install with: npm install wrtc\n' +
    '  On Windows you may also need: npm install --global --production windows-build-tools'
  );
}

// ── Constants ───────────────────────────────────────────────────────────────

const BLOCK_SIZE = 128 * 1024; // MUST match Python BLOCK_SIZE
const DEVICE_ID = 'pc';
const POLL_INTERVAL_MS = 3000;

const STUN_SERVERS = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
];

const MAX_ICE_RESTART_FAILURES = 3;

// ── Helpers ─────────────────────────────────────────────────────────────────

function md5(buffer) {
  return crypto.createHash('md5').update(buffer).digest('hex');
}

function bytesToHex(buf) {
  return buf.toString('hex');
}

function hexToBytes(hex) {
  return Buffer.from(hex, 'hex');
}

// ── Checksum / Merkle / Delta Engine ────────────────────────────────────────

/** Return { blockIndex: md5hex } for a single file. */
function getBlockChecksums(filepath) {
  const checksums = {};
  try {
    const fd = fs.openSync(filepath, 'r');
    let index = 0;
    const buf = Buffer.alloc(BLOCK_SIZE);
    while (true) {
      const bytesRead = fs.readSync(fd, buf, 0, BLOCK_SIZE, null);
      if (bytesRead === 0) break;
      checksums[index] = md5(buf.slice(0, bytesRead));
      index++;
    }
    fs.closeSync(fd);
  } catch (e) {
    // file may not exist
  }
  return checksums;
}

/** Return all block checksums for every file in syncFolder. */
function getAllBlockChecksums(syncFolder) {
  const result = {};
  if (!fs.existsSync(syncFolder)) return result;
  walkDir(syncFolder, (abs) => {
    const rel = path.relative(syncFolder, abs).replace(/\\/g, '/');
    result[rel] = getBlockChecksums(abs);
  });
  return result;
}

/** Build a Merkle tree for syncFolder: { relPath: md5, __root__: rootHash } */
function buildMerkleTree(syncFolder) {
  const tree = {};
  console.log(`[MerkleTree] Trying to build tree for folder: ${syncFolder}`);
  if (!fs.existsSync(syncFolder)) {
    console.log(`[MerkleTree] Folder DOES NOT EXIST: ${syncFolder}`);
    tree['__root__'] = md5(Buffer.from(''));
    return tree;
  }
  let fileCount = 0;
  walkDir(syncFolder, (abs) => {
    fileCount++;
    const rel = path.relative(syncFolder, abs).replace(/\\/g, '/');
    if (rel.startsWith('.') || rel.endsWith('.tmp')) return;
    tree[rel] = md5File(abs);
  });
  console.log(`[MerkleTree] Found ${fileCount} files in ${syncFolder}`);
  const entries = Object.entries(tree).sort((a, b) => a[0].localeCompare(b[0]));
  const combined = entries.map(([k, v]) => `${k}:${v}`).join('');
  tree['__root__'] = md5(Buffer.from(combined));
  return tree;
}

/** Walk a directory recursively, calling fn(absPath) on every file. */
function walkDir(dir, fn) {
  try {
    const items = fs.readdirSync(dir);
    for (const item of items) {
      if (item.startsWith('.')) continue;
      const abs = path.join(dir, item);
      try {
        const stat = fs.statSync(abs);
        if (stat.isDirectory()) {
          walkDir(abs, fn);
        } else if (stat.isFile()) {
          fn(abs);
        }
      } catch (_) { /* permission error */ }
    }
  } catch (_) { /* dir not readable */ }
}

/** MD5 of entire file. */
function md5File(filepath) {
  try {
    const hash = crypto.createHash('md5');
    const fd = fs.openSync(filepath, 'r');
    const buf = Buffer.alloc(BLOCK_SIZE);
    while (true) {
      const bytesRead = fs.readSync(fd, buf, 0, BLOCK_SIZE, null);
      if (bytesRead === 0) break;
      hash.update(buf.slice(0, bytesRead));
    }
    fs.closeSync(fd);
    return hash.digest('hex');
  } catch (_) {
    return '';
  }
}

/** Compute changed blocks between local file and remote checksums and stream them in chunks. */
function computeDeltaStream(filepath, remoteChecksums, onChunk) {
  try {
    const fd = fs.openSync(filepath, 'r');
    let index = 0;
    const buf = Buffer.alloc(BLOCK_SIZE);
    let chunkBuffer = [];
    
    while (true) {
      const bytesRead = fs.readSync(fd, buf, 0, BLOCK_SIZE, null);
      if (bytesRead === 0) break;
      
      const chunk = buf.slice(0, bytesRead);
      const localCs = md5(chunk);
      const remoteCs = (remoteChecksums[index] || remoteChecksums[String(index)]) || null;
      
      if (remoteCs !== localCs) {
        chunkBuffer.push({
          block: index,
          checksum: localCs,
          data: bytesToHex(chunk),
        });
        
        // 50 blocks = 6.4MB per packet, safe for WebRTC DataChannels and WS
        if (chunkBuffer.length >= 50) {
          onChunk([...chunkBuffer]);
          chunkBuffer = [];
        }
      }
      index++;
    }
    
    if (chunkBuffer.length > 0) {
      onChunk(chunkBuffer);
    }
    
    fs.closeSync(fd);
  } catch (e) {
    console.warn('[sync-engine] computeDeltaStream error:', e.message);
  }
}

/** Apply incoming delta blocks to a local file. */
function applyDelta(filepath, deltasRaw, expectedSize) {
  // Fix RAM bloat + Destructive overwrite
  console.log(`[sync-engine] applyDelta: processing ${deltasRaw.length} chunks for ${filepath}`);
  
  const dir = path.dirname(filepath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

  let fd = null;
  try {
    const createFd = fs.openSync(filepath, 'a');
    fs.closeSync(createFd);
    fd = fs.openSync(filepath, 'r+');
    for (const d of deltasRaw) {
      const position = d.block * BLOCK_SIZE;
      const buf = hexToBytes(d.data);
      fs.writeSync(fd, buf, 0, buf.length, position);
    }
    
    if (expectedSize !== undefined && expectedSize !== null) {
      fs.ftruncateSync(fd, expectedSize);
    }

    const stat = fs.fstatSync(fd);
    console.log(`[sync-engine] applyDelta: applied successfully to ${filepath} (size: ${stat.size}b)`);
  } catch (e) {
    console.error(`[applyDelta] failed on ${filepath}: ${e.message}`);
    throw e;
  } finally {
    if (fd !== null) fs.closeSync(fd);
  }
}

/** Compare two Merkle trees. */
function findChangedFiles(localTree, remoteTree) {
  if (localTree['__root__'] === remoteTree['__root__']) return {};
  const allPaths = new Set([...Object.keys(localTree), ...Object.keys(remoteTree)]);
  allPaths.delete('__root__');
  const changed = {};
  for (const p of allPaths) {
    const localCs = localTree[p] || null;
    const remoteCs = remoteTree[p] || null;
    if (localCs === remoteCs) continue;
    if (localCs && remoteCs) changed[p] = 'modified';
    else if (remoteCs && !localCs) changed[p] = 'remote_only';
    else changed[p] = 'local_only';
  }
  return changed;
}


// ── Simple Vector Clock ─────────────────────────────────────────────────────

class VectorClockStore {
  constructor() {
    this._clocks = {};
  }

  load(filepath) {
    return this._clocks[filepath] || {};
  }

  save(filepath, clock) {
    this._clocks[filepath] = { ...clock };
  }

  loadAll() {
    return { ...this._clocks };
  }

  tick(filepath) {
    const clock = this.load(filepath);
    clock[DEVICE_ID] = (clock[DEVICE_ID] || 0) + 1;
    this.save(filepath, clock);
    return clock;
  }

  merge(filepath, remoteClock) {
    const clock = this.load(filepath);
    for (const [k, v] of Object.entries(remoteClock)) {
      const localVal = Math.floor(clock[k] || 0);
      const remoteVal = Math.floor(v || 0);
      clock[k] = Math.max(localVal, remoteVal);
    }
    this.save(filepath, clock);
    return clock;
  }
}


// ── SyncEngine ──────────────────────────────────────────────────────────────

/**
 * Manages one sync session between this PC and a remote mobile peer.
 *
 * Events emitted:
 *   'status'  → { status, message }
 *   'log'     → string
 *   'files'   → [{ name, path, size, modified }]          — sync folder contents
 *   'pending' → [{ filepath, changeType, fileSize }]      — pending remote changes
 */
class SyncEngine extends EventEmitter {
  constructor(syncFolder) {
    super();
    this._log(`SyncEngine initialized with folder: ${syncFolder}`);
    if (!require('fs').existsSync(syncFolder)) {
      this._log(`Warning: syncFolder does not exist at init: ${syncFolder}`);
    }
    this.syncFolder = syncFolder;
    this._vcStore = new VectorClockStore();
    this._ws = null;
    this._pc = null;           // RTCPeerConnection
    this._dc = null;           // RTCDataChannel
    this._lastLocalTree = {};
    this._watchInterval = null;
    this._processingSync = false;
    this._messageQueue = [];
    this._processingQueue = false;
    this._pendingChanges = [];
    this._awaitingRemoteApproval = new Map();
    // Tracks mobile-reported changes keyed by filepath, for use in _handleSyncApproved
    this._pendingMobileChanges = {};

    // ── Reconnection state ──────────────────────────────────────────
    this._reconnectAttempt = 0;
    this._reconnectTimer = null;
    this._shouldReconnect = false;  // true when user has connected (auto-reconnect enabled)
    this._connParams = null;        // { signalingUrl, sessionId, isInitiator }
    this._outgoingQueue = [];       // messages queued while WS is down
    this._peerReconnecting = false; // true when peer disconnected but has TTL reservation

    // ── WebRTC state ────────────────────────────────────────────────
    this._iceRestartFailures = 0;
    this._usingRelay = false;       // true = fallback to WS relay mode
    this._webrtcAvailable = !!wrtc; // false if wrtc module not installed

    // ensure sync folder exists
    if (!fs.existsSync(this.syncFolder)) {
      fs.mkdirSync(this.syncFolder, { recursive: true });
    }
  }

  // ── Public API ──────────────────────────────────────────────────────

  /**
   * Connect to the signaling server and join a session.
   *
   * After joining, the engine will attempt to establish a WebRTC P2P
   * DataChannel with the mobile peer.  All sync messages (handshake,
   * delta, ack, change_pending) are routed through the DataChannel
   * for true peer-to-peer transfer with zero server involvement.
   *
   * If WebRTC fails after 3 ICE restart attempts, the engine silently
   * falls back to WebSocket relay mode through the signaling server.
   */
  async connect(signalingUrl, sessionId, isInitiator) {
    this._cleanup();

    // Store connection params for auto-reconnect
    this._connParams = { signalingUrl, sessionId, isInitiator };
    this._shouldReconnect = true;
    this._reconnectAttempt = 0;
    this._peerReconnecting = false;
    this._iceRestartFailures = 0;
    this._usingRelay = false;

    this._connectWs();
  }

  /** Internal: create WebSocket and wire up events. Called by connect() and _scheduleReconnect(). */
  _connectWs() {
    const { signalingUrl, sessionId, isInitiator } = this._connParams;
    const isReconnect = this._reconnectAttempt > 0;

    if (isReconnect) {
      this._emit('status', {
        status: 'reconnecting',
        message: `Reconnecting… (attempt ${this._reconnectAttempt})`,
      });
      this._log(`Reconnect attempt #${this._reconnectAttempt}`);
    } else {
      this._emit('status', { status: 'connecting', message: 'Connecting to signaling server…' });
      this._log(`Connecting to ${signalingUrl} session=${sessionId} initiator=${isInitiator}`);
    }

    try {
      // Normalize URL to ws(s)://
      let wsUrl = signalingUrl.trim();
      if (wsUrl.startsWith('http://')) wsUrl = 'ws://' + wsUrl.slice(7);
      else if (wsUrl.startsWith('https://')) wsUrl = 'wss://' + wsUrl.slice(8);
      else if (!wsUrl.startsWith('ws://') && !wsUrl.startsWith('wss://')) {
        const isLocalhost = wsUrl.includes('localhost') || wsUrl.includes('127.0.0.1');
        wsUrl = isLocalhost ? 'ws://' + wsUrl : 'wss://' + wsUrl;
      }

      this._ws = new WebSocket(wsUrl);

      this._ws.on('open', () => {
        this._reconnectAttempt = 0; // Reset backoff on successful connect
        this._log('WebSocket connected, joining session…');
        this._wsSend({
          type: 'join',
          sessionId,
          isInitiator,
        });
        // Flush any messages queued while disconnected
        this._flushOutgoingQueue();
      });

      this._ws.on('message', (raw) => {
        try {
          const rawStr = raw.toString();
          const msg = JSON.parse(rawStr);
          this._log(`⬅ RECV type=${msg.type} keys=[${Object.keys(msg).join(',')}] size=${rawStr.length}b`);
          this._onSignalingMessage(msg, sessionId, isInitiator);
        } catch (e) {
          console.warn('[sync-engine] bad message:', e.message);
        }
      });

      this._ws.on('close', () => {
        this._log('WebSocket disconnected');
        this._ws = null;
        this._stopWatcher();
        
        // Fix: Clean up WebRTC to prevent dangling ICE gatherers hanging in background
        console.log('[sync-engine] WebSocket closed, cleaning up WebRTC resources');
        try { if (this._dc) this._dc.close(); } catch (_) { }
        try { if (this._pc) this._pc.close(); } catch (_) { }
        this._dc = null;
        this._pc = null;

        if (this._shouldReconnect) {
          this._scheduleReconnect();
        } else {
          this._emit('status', { status: 'disconnected', message: 'Disconnected from signaling server' });
        }
      });

      this._ws.on('error', (err) => {
        this._log('WebSocket error: ' + err.message);
        // The 'close' event will fire after this and handle reconnection
      });
    } catch (e) {
      this._log('Connection failed: ' + e.message);
      if (this._shouldReconnect) {
        this._scheduleReconnect();
      } else {
        this._emit('status', { status: 'error', message: e.message });
      }
    }
  }

  /** Schedule a reconnect with exponential backoff: 500ms → 1s → 2s → 4s → ... → 30s max. */
  _scheduleReconnect() {
    if (!this._shouldReconnect || !this._connParams) return;

    this._reconnectAttempt++;
    // Exponential backoff: 500, 1000, 2000, 4000, 8000, 16000, 30000 (capped)
    const baseDelay = 500;
    const delay = Math.min(baseDelay * Math.pow(2, this._reconnectAttempt - 1), 30000);

    this._log(`Scheduling reconnect in ${delay}ms (attempt #${this._reconnectAttempt})`);
    this._emit('status', {
      status: 'reconnecting',
      message: `Reconnecting in ${Math.round(delay / 1000)}s… (attempt ${this._reconnectAttempt})`,
    });

    this._reconnectTimer = setTimeout(() => {
      this._reconnectTimer = null;
      this._connectWs();
    }, delay);
  }

  /** Flush messages queued while WebSocket was down. */
  _flushOutgoingQueue() {
    if (this._outgoingQueue.length === 0) return;
    this._log(`Flushing ${this._outgoingQueue.length} queued messages`);
    const toSend = [...this._outgoingQueue];
    this._outgoingQueue = [];
    for (const payload of toSend) {
      this._sendSyncMessage(payload);
    }
  }

  disconnect() {
    this._shouldReconnect = false; // Disable auto-reconnect on manual disconnect
    this._connParams = null;
    this._cleanup();
    this._emit('status', { status: 'idle', message: 'Disconnected' });
  }

  approvePendingChange(filepath) {
    this._sendSyncMessage({ type: 'sync_approved', filepath });
    this._pendingChanges = this._pendingChanges.filter(c => c.filepath !== filepath);
    this._log(`Approved sync: ${filepath}`);
    this._emitPending();
  }

  rejectPendingChange(filepath) {
    this._sendSyncMessage({ type: 'sync_rejected', filepath });
    this._pendingChanges = this._pendingChanges.filter(c => c.filepath !== filepath);
    this._log(`Rejected sync: ${filepath}`);
    this._emitPending();
  }

  approveAllPending() {
    for (const c of this._pendingChanges) {
      this._sendSyncMessage({ type: 'sync_approved', filepath: c.filepath });
    }
    this._log(`Approved all ${this._pendingChanges.length} pending changes`);
    this._pendingChanges = [];
    this._emitPending();
  }

  rejectAllPending() {
    for (const c of this._pendingChanges) {
      this._sendSyncMessage({ type: 'sync_rejected', filepath: c.filepath });
    }
    this._log(`Rejected all ${this._pendingChanges.length} pending changes`);
    this._pendingChanges = [];
    this._emitPending();
  }

  getFiles() {
    return this._listSyncFiles();
  }

  getPendingChanges() {
    return [...this._pendingChanges];
  }

  // ── WebRTC P2P Setup ─────────────────────────────────────────────

  /** Create RTCPeerConnection with STUN servers and wire up events. */
  _createPeerConnection() {
    if (!this._webrtcAvailable) return;

    try {
      this._pc = new wrtc.RTCPeerConnection({ iceServers: STUN_SERVERS });

      this._pc.onicecandidate = (event) => {
        if (event.candidate) {
          this._wsSend({
            type: 'ice-candidate',
            candidate: event.candidate.candidate,
            sdpMid: event.candidate.sdpMid,
            sdpMLineIndex: event.candidate.sdpMLineIndex,
          });
        }
      };

      this._pc.ondatachannel = (event) => {
        this._log('📡 Received DataChannel from peer');
        this._attachDataChannel(event.channel);
      };

      this._pc.onconnectionstatechange = () => {
        const state = this._pc?.connectionState;
        this._log(`🔌 WebRTC connection state: ${state}`);

        if (state === 'connected') {
          this._iceRestartFailures = 0;
          this._usingRelay = false;
          this._emit('status', { status: 'connected_p2p', message: 'Connected (P2P)' });
          this._log('✅ WebRTC P2P connection established');
        } else if (state === 'failed' || state === 'disconnected') {
          this._handleP2PFailure();
        }
      };

      this._log('🔧 RTCPeerConnection created');
    } catch (e) {
      this._log(`🚨 Failed to create RTCPeerConnection: ${e.message}`);
      this._webrtcAvailable = false;
    }
  }

  /** Create DataChannel (initiator only) and attach event handlers. */
  _createDataChannel() {
    if (!this._pc) return;

    try {
      const dc = this._pc.createDataChannel('sync', { ordered: true });
      this._attachDataChannel(dc);
      this._log('📡 Created DataChannel "sync"');
    } catch (e) {
      this._log(`🚨 Failed to create DataChannel: ${e.message}`);
    }
  }

  /** Attach message/state handlers to a DataChannel. */
  _attachDataChannel(channel) {
    this._dc = channel;

    channel.onopen = () => {
      this._log('✅ DataChannel open — routing sync messages via P2P');
      this._usingRelay = false;
      this._iceRestartFailures = 0;
      this._emit('status', { status: 'connected_p2p', message: 'Connected (P2P)' });
      // Flush any messages that were queued during negotiation
      this._flushOutgoingQueue();
    };

    channel.onclose = () => {
      this._log('📡 DataChannel closed');
      this._dc = null;
    };

    channel.onerror = (err) => {
      this._log(`🚨 DataChannel error: ${err.message || err}`);
    };

    channel.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        this._log(`⬅ P2P RECV type=${msg.type} size=${event.data.length}b`);
        this._handleSyncMessage(msg);
      } catch (e) {
        console.warn('[sync-engine] bad DataChannel message:', e.message);
      }
    };
  }

  /** Create SDP offer and send via signaling WebSocket. */
  async _createAndSendOffer(iceRestart = false) {
    if (!this._pc) return;

    try {
      const offerOptions = iceRestart ? { iceRestart: true } : {};
      const offer = await this._pc.createOffer(offerOptions);
      await this._pc.setLocalDescription(offer);

      this._wsSend({
        type: 'offer',
        sdp: offer.sdp,
        sdpType: offer.type,
      });
      this._log(`📤 Sent ${iceRestart ? 'ICE restart ' : ''}offer`);
    } catch (e) {
      this._log(`🚨 Failed to create offer: ${e.message}`);
    }
  }

  /** Handle incoming SDP offer (joiner side). */
  async _handleOffer(msg) {
    if (!this._pc) return;

    try {
      await this._pc.setRemoteDescription(
        new wrtc.RTCSessionDescription({ type: msg.sdpType || 'offer', sdp: msg.sdp })
      );

      const answer = await this._pc.createAnswer();
      await this._pc.setLocalDescription(answer);

      this._wsSend({
        type: 'answer',
        sdp: answer.sdp,
        sdpType: answer.type,
      });
      this._log('📤 Sent answer');
    } catch (e) {
      this._log(`🚨 Failed to handle offer: ${e.message}`);
    }
  }

  /** Handle incoming SDP answer (initiator side). */
  async _handleAnswer(msg) {
    if (!this._pc) return;

    try {
      await this._pc.setRemoteDescription(
        new wrtc.RTCSessionDescription({ type: msg.sdpType || 'answer', sdp: msg.sdp })
      );
      this._log('📥 Applied answer');
    } catch (e) {
      this._log(`🚨 Failed to handle answer: ${e.message}`);
    }
  }

  /** Handle incoming ICE candidate. */
  async _handleIceCandidate(msg) {
    if (!this._pc) return;

    try {
      await this._pc.addIceCandidate(
        new wrtc.RTCIceCandidate({
          candidate: msg.candidate,
          sdpMid: msg.sdpMid,
          sdpMLineIndex: msg.sdpMLineIndex,
        })
      );
    } catch (e) {
      this._log(`🚨 Failed to add ICE candidate: ${e.message}`);
    }
  }

  /** Handle P2P connection failure — attempt ICE restart or fall back to relay. */
  _handleP2PFailure() {
    this._iceRestartFailures++;
    this._log(`⚠ P2P failure #${this._iceRestartFailures}/${MAX_ICE_RESTART_FAILURES}`);

    if (this._iceRestartFailures >= MAX_ICE_RESTART_FAILURES) {
      // Fall back to WebSocket relay mode
      this._usingRelay = true;
      this._log('🔄 Falling back to WebSocket relay mode');
      this._emit('status', { status: 'connected_relay', message: 'Connected (Relay Fallback)' });
      // Close the failed peer connection to free resources
      try { this._pc?.close(); } catch (_) { }
      this._pc = null;
      this._dc = null;
    } else {
      // Attempt ICE restart with exponential backoff
      const delay = 1000 * Math.pow(2, this._iceRestartFailures - 1);
      this._log(`🔄 Scheduling ICE restart in ${delay}ms`);
      this._emit('status', { status: 'reconnecting', message: 'Reconnecting P2P…' });

      setTimeout(() => {
        if (this._connParams?.isInitiator && this._pc) {
          this._createAndSendOffer(true); // ICE restart
        }
      }, delay);
    }
  }

  // ── Signaling message handling ────────────────────────────────────

  _onSignalingMessage(msg, sessionId, isInitiator) {
    const type = msg.type;

    // ── WebRTC signaling messages ───────────────────────────────
    if (type === 'offer' && !isInitiator && this._webrtcAvailable) {
      this._handleOffer(msg);
      return;
    }

    if (type === 'answer' && isInitiator && this._webrtcAvailable) {
      this._handleAnswer(msg);
      return;
    }

    if ((type === 'ice-candidate' || type === 'candidate') && this._webrtcAvailable) {
      this._handleIceCandidate(msg);
      return;
    }

    // ── Session lifecycle messages ──────────────────────────────
    if (type === 'joined') {
      this._emit('status', { status: 'waiting', message: `Joined session ${msg.sessionId}. Waiting for peer…` });
      this._log(`✅ Joined session ${msg.sessionId}, peer count: ${msg.peerCount || '?'}`);
      if (msg.peerCount >= 2) {
        this._log(`Both peers present — isInitiator=${isInitiator}`);

        // Set up WebRTC P2P if available
        if (this._webrtcAvailable && !this._usingRelay) {
          this._createPeerConnection();
          if (isInitiator) {
            this._createDataChannel();
            this._createAndSendOffer();
          }
        }

        // Start sync handshake (works via either transport)
        this._log('Both peers present, sending handshake (PC always initiates sync)...');
        this._sendHandshake();
      }
      return;
    }

    if (type === 'peer-joined') {
      this._log('🔗 Remote peer joined — starting sync');
      this._emit('status', { status: 'syncing', message: 'Peer connected, syncing…' });

      // Set up WebRTC P2P if available
      if (this._webrtcAvailable && !this._usingRelay && !this._pc) {
        this._createPeerConnection();
        if (isInitiator) {
          this._createDataChannel();
          this._createAndSendOffer();
        }
      }

      this._log('Peer joined, sending handshake (PC always initiates sync)...');
      this._sendHandshake();
      return;
    }

    if (type === 'peer-reconnecting') {
      this._peerReconnecting = true;
      const ttl = msg.ttl || 300;
      this._log(`⏳ Remote peer disconnected — may reconnect within ${ttl}s`);
      this._emit('status', { status: 'waiting', message: `Peer disconnected — may reconnect (${Math.round(ttl / 60)}m window)…` });
      // Don't clear pending changes or stop watcher — peer may return
      return;
    }

    if (type === 'peer-disconnected') {
      this._peerReconnecting = false;
      this._log('❌ Remote peer disconnected (session expired)');
      this._emit('status', { status: 'waiting', message: 'Peer disconnected. Waiting…' });
      this._pendingChanges = [];
      this._awaitingRemoteApproval.clear();
      this._emitPending();
      this._stopWatcher();
      // Clean up WebRTC
      try { this._dc?.close(); } catch (_) { }
      try { this._pc?.close(); } catch (_) { }
      this._dc = null;
      this._pc = null;
      return;
    }

    if (type === 'error') {
      this._log(`🚨 Server error: ${msg.reason}`);
      this._emit('status', { status: 'error', message: msg.reason });
      return;
    }

    // All other messages are sync protocol — from the mobile peer, relayed by signaling server
    // (These arrive via WS relay when DataChannel is not yet established or in fallback mode)
    this._log(`📨 Sync message received (via relay): type=${type}`);
    this._handleSyncMessage(msg);
  }

  // ── Sync protocol handling ────────────────────────────────────────

  _handleSyncMessage(msg) {
    this._messageQueue.push(msg);
    this._processQueue();
  }

  async _processQueue() {
    if (this._processingQueue) return;
    this._processingQueue = true;
    this._processingSync = true;

    try {
      while (this._messageQueue.length > 0) {
        const msg = this._messageQueue.shift();
        await this._processSingle(msg);
      }
    } catch (e) {
      console.error('[sync-engine] queue error:', e);
    } finally {
      this._lastLocalTree = buildMerkleTree(this.syncFolder);
      this._processingSync = false;
      this._processingQueue = false;
    }
  }

  async _processSingle(msg) {
    const type = msg.type;
    this._log(`🔄 Processing: type=${type}`);

    switch (type) {
      case 'handshake':
        this._log(`  handshake has tree=${!!msg.tree} clocks=${!!msg.clocks} block_checksums=${!!msg.block_checksums}`);
        await this._handleHandshake(msg);
        break;
      case 'delta':
        this._log(`  delta: filepath=${msg.filepath} blocks=${(msg.deltas || []).length} change=${msg.change}`);
        await this._handleDelta(msg);
        break;
      case 'delete':
        await this._handleDelete(msg);
        break;
      case 'request_delta':
        this._log(`  request_delta: filepath=${msg.filepath}`);
        await this._handleRequestDelta(msg);
        break;
      case 'conflict':
        this._log(`⚠ Conflict: ${msg.filepath}`);
        break;
      case 'in_sync':
        this._emit('status', { status: 'synced', message: 'All files in sync' });
        this._log('✅ Already in sync');
        this._startWatcher();
        break;
      case 'sync_complete':
        this._emit('status', { status: 'synced', message: 'Sync complete' });
        this._log('✅ Initial sync complete');
        this._emitFiles();
        this._startWatcher();
        break;
      case 'ack':
        this._log(`✅ Mobile confirmed: ${msg.filepath}`);
        break;
      case 'change_pending':
        this._handleChangePending(msg);
        break;
      case 'sync_approved':
        await this._handleSyncApproved(msg);
        break;
      case 'sync_rejected':
        this._handleSyncRejected(msg);
        break;
      default:
        this._log(`⏭ Ignoring unhandled message type: ${type}`);
        break;
    }
  }

  // ── Handshake ─────────────────────────────────────────────────────

  _sendHandshake() {
    this._emit('status', { status: 'syncing', message: 'Exchanging file state…' });
    const tree = buildMerkleTree(this.syncFolder);
    const treeFiles = Object.keys(tree).filter(k => k !== '__root__');
    const clocks = this._vcStore.loadAll();
    const blockChecksums = getAllBlockChecksums(this.syncFolder);

    this._log(`📤 Building handshake: ${treeFiles.length} files, root=${tree['__root__']?.substring(0, 8)}...`);
    this._log(`   files: [${treeFiles.join(', ')}]`);

    this._sendSyncMessage({
      type: 'handshake',
      tree,
      clocks,
      block_checksums: blockChecksums,
    });

    this._lastLocalTree = tree;
    this._log('📤 Handshake sent to peer');
  }

  async _handleHandshake(msg) {
    this._emit('status', { status: 'syncing', message: 'Processing handshake…' });

    const remoteTree = msg.tree || {};
    const remoteClocks = msg.clocks || {};
    const remoteBlockChecksums = msg.block_checksums || {};

    const remoteFiles = Object.keys(remoteTree).filter(k => k !== '__root__');
    this._log(`📥 Remote handshake: ${remoteFiles.length} files, root=${(remoteTree['__root__'] || '').substring(0, 8)}...`);
    this._log(`   remote files: [${remoteFiles.join(', ')}]`);

    // Build our local state
    const localTree = buildMerkleTree(this.syncFolder);
    const localClocks = this._vcStore.loadAll();
    const localBlockChecksums = getAllBlockChecksums(this.syncFolder);

    const localFiles = Object.keys(localTree).filter(k => k !== '__root__');
    this._log(`📤 Local state: ${localFiles.length} files, root=${localTree['__root__']?.substring(0, 8)}...`);
    this._log(`   local files: [${localFiles.join(', ')}]`);

    // ── BUG FIX: Never send a second handshake from _handleHandshake. ──────────
    // The PC sends exactly ONE handshake in _sendHandshake() (called from peer-joined).
    // Responding to an incoming handshake with another handshake created an infinite
    // ping-pong loop.  Instead, the PC simply uses the remote tree it just received
    // to diff and send deltas — the protocol is initiator-driven, not echo-based.
    // ────────────────────────────────────────────────────────────────────────────

    this._lastLocalTree = localTree;

    // Diff the trees — figure out what needs syncing
    // findChangedFiles(a, b):
    //   'local_only'  → in a (local) but NOT in b (remote) → push to remote
    //   'remote_only' → in b (remote) but NOT in a (local) → request from remote
    //   'modified'    → in both, checksums differ           → vector clock decides
    const changes = findChangedFiles(localTree, remoteTree);
    const changeEntries = Object.entries(changes);

    if (changeEntries.length === 0) {
      this._sendSyncMessage({ type: 'in_sync' });
      this._emit('status', { status: 'synced', message: 'All files in sync' });
      this._log('✅ Already in sync');
      this._startWatcher();
      return;
    }

    this._log(`Found ${changeEntries.length} difference(s)`);

    for (const [filepath, changeType] of changeEntries) {
      if (changeType === 'remote_only') {
        // File exists on remote (mobile) but not locally — request it
        this._log(`Requesting remote-only file from mobile: ${filepath}`);
        const localCs = localBlockChecksums[filepath] || {};
        this._sendSyncMessage({
          type: 'request_delta',
          filepath,
          block_checksums: localCs,
        });

      } else if (changeType === 'modified') {
        // Both sides have it — use vector clocks to decide the winner
        const localClock  = this._vcStore.load(filepath);
        const remoteClock = remoteClocks[filepath] || {};
        const result      = this._compareClock(localClock, remoteClock);

        if (result === 'remote_wins') {
          // Request updated content from remote
          this._sendSyncMessage({
            type: 'request_delta',
            filepath,
            block_checksums: localBlockChecksums[filepath] || {},
          });
          this._log(`  ${filepath}: remote_wins → request_delta`);

        } else if (result === 'local_wins' || result === 'identical') {
          // Push our version to remote
          const localPath = path.join(this.syncFolder, filepath);
          if (fs.existsSync(localPath)) {
            const fileSize = fs.statSync(localPath).size;
            const vc = this._vcStore.tick(filepath);
            computeDeltaStream(localPath, remoteBlockChecksums[filepath] || {}, (deltasChunk) => {
              this._sendSyncMessage({
                type: 'delta',
                filepath,
                deltas: deltasChunk,
                clock: vc,
                change: 'modified',
                size: fileSize,
              });
            });
            this._log(`  ${filepath}: local_wins → sent delta`);
          }

        } else {
          // Conflict — notify both sides
          this._sendSyncMessage({ type: 'conflict', filepath });
          this._log(`⚠ Conflict: ${filepath}`);
        }

      } else if (changeType === 'local_only') {
        // File exists locally but not on remote — push it
        this._log(`Pushing local-only file to remote: ${filepath}`);
        const localPath = path.join(this.syncFolder, filepath);
        if (fs.existsSync(localPath)) {
          const fileSize = fs.statSync(localPath).size;
          const vc = this._vcStore.tick(filepath);
          computeDeltaStream(localPath, {}, (deltasChunk) => {
            this._sendSyncMessage({
              type: 'delta',
              filepath,
              deltas: deltasChunk,
              clock: vc,
              change: 'added',
              size: fileSize,
            });
          });
        }
      }
    }

    this._sendSyncMessage({ type: 'sync_complete' });
    this._emit('status', { status: 'synced', message: 'Sync complete' });
    this._emitFiles();
    this._startWatcher();
  }

  // ── Delta handling ────────────────────────────────────────────────

  async _handleDelta(msg) {
    const { filepath, deltas, clock, change, size } = msg;
    this._emit('status', { status: 'syncing', message: `Syncing: ${filepath}` });

    // Guard watcher — prevent it from re-announcing what we just wrote
    this._processingSync = true;
    try {
      if (change === 'deleted') {
        // Mobile is telling us a file was deleted on their side — delete it here too
        const localPath = path.join(this.syncFolder, filepath);
        if (fs.existsSync(localPath)) {
          fs.unlinkSync(localPath);
          this._log(`Deleted (remote requested): ${filepath}`);
        } else {
          this._log(`Delete: file already absent: ${filepath}`);
        }
      } else {
        const localPath = path.join(this.syncFolder, filepath);
        const dir = path.dirname(localPath);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        // Pass the authoritative file size so applyDelta can truncate correctly
        // when the incoming version is shorter than what we have locally.
        applyDelta(localPath, deltas || [], size);
        this._log(`Synced: ${filepath} (${size != null ? size + 'b' : 'size unknown'})`);
      }

      if (clock) {
        this._vcStore.merge(filepath, clock);
      }

      // Update the Merkle snapshot for this one file rather than rebuilding the
      // whole tree — avoids O(n) full-walk after every incoming delta.
      const localPath = path.join(this.syncFolder, filepath);
      if (change === 'deleted' || !fs.existsSync(localPath)) {
        delete this._lastLocalTree[filepath];
      } else {
        this._lastLocalTree[filepath] = md5File(localPath);
      }
      // Recompute the root hash so the watcher snapshot stays accurate
      const entries = Object.entries(this._lastLocalTree)
        .filter(([k]) => k !== '__root__')
        .sort((a, b) => a[0].localeCompare(b[0]));
      this._lastLocalTree['__root__'] = md5(Buffer.from(entries.map(([k, v]) => `${k}:${v}`).join('')));

      this._sendSyncMessage({ type: 'ack', filepath });
      this._emitFiles();
      this._emit('status', { status: 'synced', message: 'Sync complete' });
    } catch (e) {
      this._log(`Error syncing ${filepath}: ${e.message}`);
    } finally {
      this._processingSync = false;
    }
  }

  async _handleDelete(msg) {
    const { filepath, clock } = msg;
    const localPath = path.join(this.syncFolder, filepath);

    // Guard watcher — prevent it from re-reporting the deletion
    this._processingSync = true;
    try {
      if (fs.existsSync(localPath)) {
        fs.unlinkSync(localPath);
        this._log(`Deleted (mobile requested): ${filepath}`);
      } else {
        this._log(`Delete: already absent: ${filepath}`);
      }
      if (clock) this._vcStore.merge(filepath, clock);

      // Update snapshot entry without a full tree rebuild
      delete this._lastLocalTree[filepath];
      const entries = Object.entries(this._lastLocalTree)
        .filter(([k]) => k !== '__root__')
        .sort((a, b) => a[0].localeCompare(b[0]));
      this._lastLocalTree['__root__'] = md5(Buffer.from(entries.map(([k, v]) => `${k}:${v}`).join('')));

      this._sendSyncMessage({ type: 'ack', filepath });
      this._emitFiles();
    } catch (e) {
      this._log(`Error deleting ${filepath}: ${e.message}`);
    } finally {
      this._processingSync = false;
    }
  }

  async _handleRequestDelta(msg) {
    const { filepath, block_checksums } = msg;
    const localPath = path.join(this.syncFolder, filepath);

    if (!fs.existsSync(localPath)) {
      this._log(`Requested file not found: ${filepath}`);
      return;
    }

    const vc = this._vcStore.tick(filepath);

    computeDeltaStream(localPath, block_checksums || {}, (deltasChunk) => {
      this._sendSyncMessage({
        type: 'delta',
        filepath,
        deltas: deltasChunk,
        clock: vc,
        change: 'modified',
      });
    });

    this._log(`Sent to mobile: ${filepath}`);
  }

  // ── Pending change approval flow ──────────────────────────────────

  _handleChangePending(msg) {
    const filepath   = msg.filepath;
    const changeType = msg.change_type || 'modified';

    // Track in _pendingMobileChanges so _handleSyncApproved can look it up
    this._pendingMobileChanges[filepath] = { changeType };

    // Remove any stale entry for the same file then record the new one
    this._pendingChanges = this._pendingChanges.filter(c => c.filepath !== filepath);
    this._pendingChanges.push({
      filepath,
      changeType,
      fileSize:   msg.file_size  || 0,
      modifiedAt: msg.modified_at || 0,
      receivedAt: Date.now(),
    });
    this._log(`Auto-approving mobile change: ${filepath} (${changeType})`);

    // ── AUTO-APPROVE ─────────────────────────────────────────────────────────
    // Mobile changes are applied instantly — no PC user interaction required.
    // Send sync_approved so mobile immediately sends its delta / delete.
    this._sendSyncMessage({ type: 'sync_approved', filepath });

    // Clear from visible pending list (already approved)
    this._pendingChanges = this._pendingChanges.filter(c => c.filepath !== filepath);
    this._emitPending();
  }

  async _handleSyncApproved(msg) {
    const { filepath } = msg;
    this._awaitingRemoteApproval.delete(filepath);

    const localPath = path.join(this.syncFolder, filepath);
    const pending   = this._pendingMobileChanges[filepath] || {};
    delete this._pendingMobileChanges[filepath];

    if (!fs.existsSync(localPath) || pending.changeType === 'deleted') {
      // File is gone or mobile explicitly deleted it — send a delete instruction
      const vc = this._vcStore.tick(filepath);
      this._sendSyncMessage({ type: 'delete', filepath, clock: vc });
      this._log(`Approved — file gone, sent delete for: ${filepath}`);
      this._emitFiles();
      return;
    }

    // Send the current file content as a delta (with correct size for truncation)
    const fileSize = fs.statSync(localPath).size;
    const vc       = this._vcStore.tick(filepath);
    computeDeltaStream(localPath, {}, (deltasChunk) => {
      this._sendSyncMessage({
        type: 'delta',
        filepath,
        deltas: deltasChunk,
        clock: vc,
        change: 'modified',
        size: fileSize,
      });
    });

    this._log(`Sent approved change to mobile: ${filepath} (${fileSize}b)`);
    this._emitFiles();
  }

  _handleSyncRejected(msg) {
    this._awaitingRemoteApproval.delete(msg.filepath);
    this._log(`Mobile rejected change: ${msg.filepath}`);
  }

  // ── Local file watcher ────────────────────────────────────────────

  _startWatcher() {
    this._stopWatcher();
    this._watchInterval = setInterval(() => this._checkLocalChanges(), POLL_INTERVAL_MS);
  }

  _stopWatcher() {
    if (this._watchInterval) {
      clearInterval(this._watchInterval);
      this._watchInterval = null;
    }
  }

  _checkLocalChanges() {
    // Check both WS relay and DataChannel availability
    const wsOpen = this._ws && this._ws.readyState === WebSocket.OPEN;
    const dcOpen = this._dc && this._dc.readyState === 'open';
    if (!wsOpen && !dcOpen) return;
    if (this._processingSync) return;

    try {
      const currentTree = buildMerkleTree(this.syncFolder);

      const expired = new Set();
      const now = Date.now();
      this._awaitingRemoteApproval.forEach((ts, fp) => {
        if (now - ts > 30000) {
          this._awaitingRemoteApproval.delete(fp);
          expired.add(fp);
        }
      });

      if (Object.keys(this._lastLocalTree).length === 0) {
        this._lastLocalTree = currentTree;
        return;
      }

      if (currentTree['__root__'] === this._lastLocalTree['__root__']) return;

      const changed = findChangedFiles(currentTree, this._lastLocalTree);

      for (const [filepath, changeType] of Object.entries(changed)) {
        if (changeType === 'remote_only') {
          // File is in _lastLocalTree (old snapshot) but gone from currentTree = deleted on PC
          if (this._awaitingRemoteApproval.has(filepath)) continue;
          this._awaitingRemoteApproval.set(filepath, Date.now());
          const vc = this._vcStore.tick(filepath);
          this._sendSyncMessage({
            type: 'change_pending',
            filepath,
            change_type: 'deleted',
            file_size: 0,
            modified_at: Math.floor(Date.now() * 0.001),
          });
          if (expired.has(filepath)) {
            this._log(`[watcher] re-notifying ${filepath} (approval TTL expired)`);
          }
          this._log(`Notified mobile of local delete: ${filepath}`);
          continue;
        }

        if (this._awaitingRemoteApproval.has(filepath)) continue;

        // Notify mobile about the change — wait for approval
        this._awaitingRemoteApproval.set(filepath, Date.now());
        const localPath = path.join(this.syncFolder, filepath);
        try {
          const stat = fs.statSync(localPath);
          this._sendSyncMessage({
            type: 'change_pending',
            filepath,
            change_type: changeType,
            file_size: stat.size,
            modified_at: stat.mtimeMs / 1000,
          });
          if (expired.has(filepath)) {
            this._log(`[watcher] re-notifying ${filepath} (approval TTL expired)`);
          }
          this._log(`Notified mobile: ${filepath} (${changeType})`);
        } catch (e) {
          this._awaitingRemoteApproval.delete(filepath);
        }
      }

      this._lastLocalTree = currentTree;
    } catch (e) {
      console.error('[sync-engine] watcher error:', e.message);
    }
  }

  // ── Vector clock comparison ───────────────────────────────────────

  _compareClock(local, remote) {
    const allDevices = new Set([...Object.keys(local), ...Object.keys(remote)]);
    let localNewer = false;
    let remoteNewer = false;

    for (const device of allDevices) {
      const localTs = local[device] || 0;
      const remoteTs = Number(remote[device] || 0);
      if (localTs > remoteTs) localNewer = true;
      if (remoteTs > localTs) remoteNewer = true;
    }

    if (localNewer && !remoteNewer) return 'local_wins';
    if (remoteNewer && !localNewer) return 'remote_wins';
    if (!localNewer && !remoteNewer) return 'identical';
    return 'conflict';
  }

  // ── Transport — smart routing (DataChannel preferred, WS fallback) ─

  /**
   * Send a sync protocol message through the best available transport:
   *   1. DataChannel (P2P) if open
   *   2. WebSocket relay (signaling server) as fallback
   *
   * Messages are queued if neither transport is available.
   */
  _sendSyncMessage(payload) {
    // Prefer DataChannel (P2P) when available
    if (this._dc && this._dc.readyState === 'open') {
      try {
        const data = JSON.stringify(payload);
        this._dc.send(data);
        this._log(`➡ P2P SENT type=${payload.type} size=${data.length}b`);
        return;
      } catch (e) {
        this._log(`🚨 DataChannel send failed, falling back to WS: ${e.message}`);
      }
    }

    // Fall back to WebSocket relay
    this._wsSend(payload);
  }

  /** Send raw payload via the signaling WebSocket (for signaling AND relay fallback). */
  _wsSend(payload) {
    if (this._ws && this._ws.readyState === WebSocket.OPEN) {
      try {
        const data = JSON.stringify(payload);
        this._ws.send(data);
        this._log(`➡ SENT type=${payload.type} size=${data.length}b`);
      } catch (e) {
        this._log(`🚨 Send failed: ${e.message}`);
        // Queue the message for retry on reconnect (except join — that's handled automatically)
        if (payload.type !== 'join' && this._shouldReconnect) {
          this._outgoingQueue.push(payload);
        }
      }
    } else if (this._shouldReconnect && payload.type !== 'join') {
      // Queue message while disconnected — will flush on reconnect
      this._outgoingQueue.push(payload);
      this._log(`📦 Queued type=${payload.type} (WS not open, will send on reconnect)`);
    } else {
      this._log(`🚨 Cannot send type=${payload.type}: WS not open (state=${this._ws?.readyState})`);
    }
  }

  // ── File listing ──────────────────────────────────────────────────

  _listSyncFiles() {
    const items = [];
    try {
      if (!fs.existsSync(this.syncFolder)) return items;
      const files = fs.readdirSync(this.syncFolder);
      for (const name of files) {
        if (name.startsWith('.')) continue;
        const abs = path.join(this.syncFolder, name);
        try {
          const stat = fs.statSync(abs);
          if (stat.isFile()) {
            items.push({
              name,
              path: abs,
              size: stat.size,
              modified: stat.mtimeMs,
            });
          }
        } catch (_) { /* skip */ }
      }
      items.sort((a, b) => b.modified - a.modified);
    } catch (_) { /* empty */ }
    return items;
  }

  // ── Event helpers ─────────────────────────────────────────────────

  _emit(event, data) {
    this.emit(event, data);
  }

  _log(message) {
    const ts = new Date().toISOString().substring(11, 19);
    this.emit('log', `[${ts}] ${message}`);
    console.log(`[sync-engine] ${message}`);
  }

  _emitFiles() {
    this.emit('files', this._listSyncFiles());
  }

  _emitPending() {
    this.emit('pending', [...this._pendingChanges]);
  }

  // ── Cleanup ───────────────────────────────────────────────────────

  _cleanup() {
    this._stopWatcher();
    // Cancel any pending reconnect timer
    if (this._reconnectTimer) {
      clearTimeout(this._reconnectTimer);
      this._reconnectTimer = null;
    }
    // Close DataChannel
    if (this._dc) {
      try { this._dc.close(); } catch (_) { }
      this._dc = null;
    }
    // Close PeerConnection
    if (this._pc) {
      try { this._pc.close(); } catch (_) { }
      this._pc = null;
    }
    // Close WebSocket
    if (this._ws) {
      // Temporarily disable reconnect during cleanup to avoid triggering
      // the 'close' handler's reconnect logic
      const wasReconnect = this._shouldReconnect;
      this._shouldReconnect = false;
      try { this._ws.close(); } catch (_) { /* ignore */ }
      this._ws = null;
      this._shouldReconnect = wasReconnect;
    }
    this._pendingChanges = [];
    this._awaitingRemoteApproval.clear();
    this._messageQueue = [];
    this._outgoingQueue = [];
    this._processingQueue = false;
    this._processingSync = false;
    this._peerReconnecting = false;
    this._iceRestartFailures = 0;
  }

  destroy() {
    this._shouldReconnect = false;
    this._connParams = null;
    this._cleanup();
    this.removeAllListeners();
  }
}

module.exports = { SyncEngine };
