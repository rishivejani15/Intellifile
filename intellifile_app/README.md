# intellifile_app

A new Flutter project.

## Getting Started

This project is a starting point for a Flutter application.

A few resources to get you started if this is your first Flutter project:

- [Lab: Write your first Flutter app](https://docs.flutter.dev/get-started/codelab)
- [Cookbook: Useful Flutter samples](https://docs.flutter.dev/cookbook)

For help getting started with Flutter development, view the
[online documentation](https://docs.flutter.dev/), which offers tutorials,
samples, guidance on mobile development, and a full API reference.

## Sync Modes

IntelliFile supports two sync connection modes:

- LAN: Finds or connects directly to your PC on the same WiFi.
- Remote: Uses signaling plus WebRTC DataChannel to sync over the internet.

To start local signaling for Remote mode, run:

```bash
pip install websockets
python signaling_server.py
```

In the app, tap the Connect button and choose either LAN or Remote.

### Signaling Protocol (Remote)

All signaling messages are JSON objects over a WebSocket connection.

- Client -> server join:
	- `{"type":"join","sessionId":"room-123","isInitiator":true}`
- Server -> client joined ack:
	- `{"type":"joined","sessionId":"room-123","isInitiator":true}`
- Offer/answer relay:
	- `{"type":"offer","sessionId":"room-123","sdp":"...","sdpType":"offer"}`
	- `{"type":"answer","sessionId":"room-123","sdp":"...","sdpType":"answer"}`
- ICE relay:
	- `{"type":"ice-candidate","sessionId":"room-123","candidate":"...","sdpMid":"0","sdpMLineIndex":0}`
- Peer disconnect notification:
	- `{"type":"peer-disconnected","sessionId":"room-123"}`
